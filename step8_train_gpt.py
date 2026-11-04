"""Step 8: Train a tiny GPT from scratch, predicting one character at a time.

It has the same parts as a real LLM: embeddings, self-attention, a training
loop. Only the size differs. About 2 million weights instead of billions.

Run: python step8_train_gpt.py   (about 2 minutes on an RTX 5060)
"""
import math
import os
import urllib.request

import torch
import torch.nn as nn
import torch.nn.functional as F

BLOCK_SIZE = 128     # How many characters the model sees at once (context window).
BATCH_SIZE = 64
N_EMBD = 192         # Size of each token's vector.
N_HEAD = 6
N_LAYER = 4
DROPOUT = 0.1
LEARNING_RATE = 3e-4
MAX_ITERS = 3000
EVAL_EVERY = 300
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

torch.manual_seed(42)

# 1. DATA: read text and turn characters into integers (a tiny tokenizer).
DATA_FILE = "tiny_shakespeare.txt"
DATA_URL = "https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt"
if not os.path.exists(DATA_FILE):
    urllib.request.urlretrieve(DATA_URL, DATA_FILE)
with open(DATA_FILE, encoding="utf-8") as f:
    text = f.read()

chars = sorted(set(text))
VOCAB_SIZE = len(chars)
stoi = {c: i for i, c in enumerate(chars)}
itos = {i: c for c, i in stoi.items()}
encode = lambda s: [stoi[c] for c in s]
decode = lambda ids: "".join(itos[i] for i in ids)

data = torch.tensor(encode(text), dtype=torch.long)
split = int(0.9 * len(data))
train_data, val_data = data[:split], data[split:]  # Val data checks for overfitting.


def get_batch(source):
    """The target y is the input x shifted by one: predict the next character."""
    starts = torch.randint(len(source) - BLOCK_SIZE - 1, (BATCH_SIZE,))
    x = torch.stack([source[i:i + BLOCK_SIZE] for i in starts])
    y = torch.stack([source[i + 1:i + BLOCK_SIZE + 1] for i in starts])
    return x.to(DEVICE), y.to(DEVICE)


# 2. MODEL
class SelfAttention(nn.Module):
    """Each token asks (query), offers (key), and shares (value) information."""

    def __init__(self):
        super().__init__()
        self.n_head = N_HEAD
        self.qkv = nn.Linear(N_EMBD, 3 * N_EMBD, bias=False)
        self.proj = nn.Linear(N_EMBD, N_EMBD)
        self.drop = nn.Dropout(DROPOUT)
        # The causal mask stops a token from looking at the future.
        self.register_buffer("mask", torch.tril(torch.ones(BLOCK_SIZE, BLOCK_SIZE)))

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).chunk(3, dim=-1)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        scores = q @ k.transpose(-2, -1) / math.sqrt(k.size(-1))
        scores = scores.masked_fill(self.mask[:T, :T] == 0, float("-inf"))
        weights = self.drop(F.softmax(scores, dim=-1))
        out = (weights @ v).transpose(1, 2).contiguous().view(B, T, C)
        return self.drop(self.proj(out))


class Block(nn.Module):
    """Attention lets tokens talk to each other. The MLP lets each one think."""

    def __init__(self):
        super().__init__()
        self.ln1 = nn.LayerNorm(N_EMBD)
        self.attn = SelfAttention()
        self.ln2 = nn.LayerNorm(N_EMBD)
        self.mlp = nn.Sequential(nn.Linear(N_EMBD, 4 * N_EMBD), nn.GELU(),
                                 nn.Linear(4 * N_EMBD, N_EMBD), nn.Dropout(DROPOUT))

    def forward(self, x):
        x = x + self.attn(self.ln1(x))  # The "+" is a residual connection.
        return x + self.mlp(self.ln2(x))


class TinyGPT(nn.Module):
    def __init__(self):
        super().__init__()
        self.tok_emb = nn.Embedding(VOCAB_SIZE, N_EMBD)   # What the token is.
        self.pos_emb = nn.Embedding(BLOCK_SIZE, N_EMBD)   # Where the token is.
        self.blocks = nn.Sequential(*[Block() for _ in range(N_LAYER)])
        self.ln = nn.LayerNorm(N_EMBD)
        self.head = nn.Linear(N_EMBD, VOCAB_SIZE)         # Scores for the next token.

    def forward(self, idx, targets=None):
        pos = torch.arange(idx.size(1), device=idx.device)
        x = self.blocks(self.tok_emb(idx) + self.pos_emb(pos))
        logits = self.head(self.ln(x))
        if targets is None:
            return logits, None
        loss = F.cross_entropy(logits.view(-1, VOCAB_SIZE), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, new_tokens, temperature=0.8):
        for _ in range(new_tokens):
            logits, _ = self(idx[:, -BLOCK_SIZE:])
            probs = F.softmax(logits[:, -1] / temperature, dim=-1)
            idx = torch.cat([idx, torch.multinomial(probs, 1)], dim=1)
        return idx


@torch.no_grad()
def estimate_loss(model):
    model.eval()
    out = {}
    for name, source in (("train", train_data), ("val", val_data)):
        losses = [model(*get_batch(source))[1].item() for _ in range(50)]
        out[name] = sum(losses) / len(losses)
    model.train()
    return out


# 3. TRAINING LOOP: these lines are the core of all deep learning.
model = TinyGPT().to(DEVICE)
optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE)
print(f"device={DEVICE} params={sum(p.numel() for p in model.parameters()):,}")
print(f"untrained loss should be near ln(vocab) = {math.log(VOCAB_SIZE):.2f}")

for step in range(MAX_ITERS + 1):
    if step % EVAL_EVERY == 0:
        losses = estimate_loss(model)
        print(f"step {step:5d}  train {losses['train']:.3f}  val {losses['val']:.3f}")
    x, y = get_batch(train_data)
    _, loss = model(x, y)                  # Forward pass: how wrong are we?
    optimizer.zero_grad(set_to_none=True)
    loss.backward()                        # Backprop: which way should each weight move?
    nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()                       # Update: move every weight a little.

torch.save(model.state_dict(), "tiny_gpt.pt")

# 4. SAMPLE
model.eval()
start = torch.tensor([encode("ROMEO:\n")], device=DEVICE)
print("\n--- generated text ---\n" + decode(model.generate(start, 400)[0].tolist()))