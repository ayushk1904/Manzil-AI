"""Try your fine-tuned model on new job posts, without training again."""
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
SYSTEM = "Extract the skills and years of experience from the job post. Output only JSON."
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Write your own job posts here.
POSTS = [
    "We need a developer who knows Rust and Kafka, with 3 years of experience.",
    "Looking for a backend engineer. You should be comfortable with Golang and Postgres. Freshers can apply.",
    "Join our data team! Must have strong SQL, Python and Tableau skills and 2+ years in analytics.",
    "Our startup makes great coffee and we are hiring a friendly store manager in Pune.",
]

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
base = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.float32).to(DEVICE)
model = PeftModel.from_pretrained(base, "skills_adapter")   # Add your "sticky notes".
model.eval()

for post in POSTS:
    prompt = tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": post}],
        tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(DEVICE)
    output = model.generate(**inputs, max_new_tokens=40, do_sample=False,
                            pad_token_id=tokenizer.pad_token_id)
    answer = tokenizer.decode(output[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    print(f"\nJOB POST: {post}\nMODEL:    {answer.strip()}")