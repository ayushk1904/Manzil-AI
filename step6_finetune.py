"""Step 6: Fine-tune a small model to pull skills out of job posts, as JSON.

The first run downloads SmolLM2-135M, about 270 MB.
"""
import json
import random

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
EPOCHS = 3
BATCH_SIZE = 4
LEARNING_RATE = 2e-4
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

random.seed(42)
torch.manual_seed(42)

# 1. DATA: the test skills never appear in training, so the score shows real learning.
TRAIN_SKILLS = ["Python", "React", "Docker", "SQL", "Java", "AWS", "Git", "Linux", "Node.js",
                "MongoDB", "Kubernetes", "TypeScript", "Flask", "Azure"]
TEST_SKILLS = ["PyTorch", "LangGraph", "Django", "Redis", "Go", "Spark"]
TEMPLATES = ["We need a developer who knows {a} and {b}, with {y} years of experience.",
             "Hiring now: {y} years of experience required. Skills: {a}, {b}.",
             "You will work with {a} and {b}. At least {y} years of experience is needed."]


def make_example(skills):
    a, b = random.sample(skills, 2)
    years = random.randint(0, 8)
    post = random.choice(TEMPLATES).format(a=a, b=b, y=years)
    return post, json.dumps({"skills": [a, b], "years": years})


train_set = [make_example(TRAIN_SKILLS) for _ in range(300)]
test_set = [make_example(TEST_SKILLS) for _ in range(40)]

SYSTEM = "Extract the skills and years of experience from the job post. Output only JSON."

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.float32).to(DEVICE)


def prompt_text(post):
    return tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": post}],
        tokenize=False, add_generation_prompt=True)


def encode_example(post, answer):
    """Labels of -100 tell the model not to learn the prompt, only the answer."""
    prompt_ids = tokenizer(prompt_text(post), add_special_tokens=False).input_ids
    answer_ids = tokenizer(answer + tokenizer.eos_token, add_special_tokens=False).input_ids
    return prompt_ids + answer_ids, [-100] * len(prompt_ids) + answer_ids


def make_batch(batch):
    width = max(len(ids) for ids, _ in batch)
    input_ids, labels, attention = [], [], []
    for ids, labs in batch:
        pad = width - len(ids)
        input_ids.append(ids + [tokenizer.pad_token_id] * pad)
        labels.append(labs + [-100] * pad)
        attention.append([1] * len(ids) + [0] * pad)
    return {"input_ids": torch.tensor(input_ids, device=DEVICE),
            "labels": torch.tensor(labels, device=DEVICE),
            "attention_mask": torch.tensor(attention, device=DEVICE)}


def generate(net, post):
    inputs = tokenizer(prompt_text(post), return_tensors="pt", add_special_tokens=False).to(DEVICE)
    output = net.generate(**inputs, max_new_tokens=40, do_sample=False,
                          pad_token_id=tokenizer.pad_token_id)
    return tokenizer.decode(output[0][inputs.input_ids.shape[1]:], skip_special_tokens=True).strip()


# 2. TEST: without a before and after score, you can't know if training helped.
@torch.no_grad()
def score(net):
    net.eval()
    correct = 0
    for post, answer in test_set:
        try:
            correct += json.loads(generate(net, post)) == json.loads(answer)
        except json.JSONDecodeError:
            pass
    net.train()
    return correct / len(test_set)


print(f"BEFORE fine-tuning: {score(model):.0%} correct")

# 3. LORA: freeze the model and add the small trainable parts ("sticky notes").
lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
                  target_modules=["q_proj", "k_proj", "v_proj", "o_proj"])
model = get_peft_model(model, lora)
model.print_trainable_parameters()

# 4. TRAIN
encoded = [encode_example(*example) for example in train_set]
optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
model.train()
for epoch in range(1, EPOCHS + 1):
    random.shuffle(encoded)
    total = 0.0
    for i in range(0, len(encoded), BATCH_SIZE):
        loss = model(**make_batch(encoded[i:i + BATCH_SIZE])).loss
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        total += loss.item()
    print(f"epoch {epoch}  average loss {total / (len(encoded) / BATCH_SIZE):.4f}")

print(f"AFTER fine-tuning: {score(model):.0%} correct")

# 5. SAVE only the small parts, then show one example.
model.save_pretrained("skills_adapter")
post, answer = test_set[0]
print("\nJOB POST:", post)
print("MODEL:   ", generate(model, post))
print("CORRECT: ", answer)