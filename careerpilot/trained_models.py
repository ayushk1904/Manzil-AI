"""Load the fine-tuned skills model (step 6) for the web app.

Step 6 starts training as soon as it is imported, so the parts needed to run the
model are repeated here, the same way try_model.py does it.
"""
import json
import threading
from functools import cache

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
SYSTEM = "Extract the skills and years of experience from the job post. Output only JSON."
load_lock = threading.Lock()  # Two browser tabs must not load the same model twice.


@cache
def _load_skills_model():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    base = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.float32).to(DEVICE)
    model = PeftModel.from_pretrained(base, "skills_adapter")
    model.eval()
    return tokenizer, model


def extract_skills(post):
    """The skills the model finds in a job post. An empty list if it doesn't return valid JSON."""
    with load_lock:
        tokenizer, model = _load_skills_model()
    prompt = tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": post}],
        tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(DEVICE)
    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=60, do_sample=False,
                                pad_token_id=tokenizer.pad_token_id)
    raw = tokenizer.decode(output[0][inputs.input_ids.shape[1]:], skip_special_tokens=True).strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    skills = parsed.get("skills", []) if isinstance(parsed, dict) else []
    return [str(skill) for skill in skills] if isinstance(skills, list) else []
