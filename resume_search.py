"""Find the parts of a resume that matter most for a job: a small RAG retriever.

The resume is split into chunks, one per project or job, and each chunk gets an embedding from
Ollama. A job post is embedded the same way, and the closest chunks are the evidence the letter and
the fit check use. If the embedding model isn't installed, a keyword match does the same job less well.
"""
import hashlib
import json
import math
import re
from pathlib import Path

import ollama

EMBED_MODEL = "nomic-embed-text"
MAX_CHUNK_CHARS = 700
MIN_CHUNK_CHARS = 25
BULLET = re.compile(r"^[•·▪◦*\-–]\s*")
WORD = re.compile(r"[a-z][a-z0-9+#.]{1,}")
STOP_WORDS = {"the", "and", "for", "with", "you", "our", "are", "will", "that", "this", "from", "have", "your",
              "was", "were", "has", "their", "they", "who", "all", "can", "using", "use", "used", "work"}
SECTION_BONUS = {"project": 0.05, "experience": 0.05, "hackathon": 0.03, "skill": 0.02}
LOW_VALUE_SECTION = re.compile(r"achievement|leadership|hobb|interest|reference|language", re.IGNORECASE)
LOW_VALUE_PENALTY = 0.1
EDUCATION_SECTION = re.compile(r"education|academic", re.IGNORECASE)


def _is_heading(line):
    words = line.split()
    return (len(words) <= 5 and ":" not in line and line[-1] not in ".,;"
            and (line.isupper() or (line.istitle() and len(words) <= 3)))


def chunk_resume(text):
    """One chunk for each project, job or section, each labelled with the section it came from."""
    chunks, section, current, saw_bullet = [], "Profile", [], False

    def flush():
        nonlocal current, saw_bullet
        joined = " ".join(current).strip()
        if len(joined) >= MIN_CHUNK_CHARS:
            chunks.append({"section": section, "text": joined[:MAX_CHUNK_CHARS]})
        current, saw_bullet = [], False

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if _is_heading(line):
            flush()
            section = line
        elif BULLET.match(line):
            current.append(BULLET.sub("", line))
            saw_bullet = True
        elif saw_bullet and line[0].isupper() and not current[-1].rstrip().endswith((",", "and", "of", "the", "a", "for", "to", "in", "with")):
            flush()                # A new title after a list of bullets starts a new project or job.
            current.append(line)
        else:
            current.append(line)   # A wrapped line, or the first lines of an item.
    flush()
    return chunks


def _words(text):
    return {word.strip(".") for word in WORD.findall(text.lower())} - STOP_WORDS


def _cosine(a, b):
    top = sum(x * y for x, y in zip(a, b))
    size = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return top / size if size else 0.0


def _embed(texts):
    return ollama.embed(model=EMBED_MODEL, input=texts).embeddings


def _chunks_with_embeddings(resume, user_dir):
    """Embeddings only change when the resume does, so they are saved next to it."""
    path = Path(user_dir) / "resume_chunks.json"
    version = hashlib.sha256(resume.encode()).hexdigest()
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved["version"] == version:
            return saved["chunks"]
    chunks = chunk_resume(resume)
    vectors = _embed([f"{c['section']}: {c['text']}" for c in chunks])
    for chunk, vector in zip(chunks, vectors):
        chunk["embedding"] = vector
    path.write_text(json.dumps({"version": version, "chunks": chunks}), encoding="utf-8")
    return chunks


def _score_with_embeddings(resume, query, user_dir):
    chunks = _chunks_with_embeddings(resume, user_dir)
    query_vector = _embed([query])[0]
    return [(_cosine(query_vector, chunk["embedding"]), chunk) for chunk in chunks]


def _score_with_keywords(resume, query):
    wanted = _words(query)
    scored = []
    for chunk in chunk_resume(resume):
        words = _words(chunk["text"])
        scored.append((len(wanted & words) / (len(words) ** 0.5 or 1), chunk))
    return scored


def retrieve(resume, query, user_dir, count=4):
    """The chunks that best fit this query, best first, always including the education chunk last."""
    try:
        scored = _score_with_embeddings(resume, query, user_dir)
    except Exception as error:
        print(f"Using keyword search for the resume: {type(error).__name__}. To improve it: ollama pull {EMBED_MODEL}")
        scored = _score_with_keywords(resume, query)

    wanted = _words(query)
    ranked = []
    for score, chunk in scored:
        section = chunk["section"].lower()
        # Words in common as well as similar meaning: a job asking for React should find React.
        score += 0.02 * len(wanted & _words(chunk["text"]))
        score += sum(bonus for name, bonus in SECTION_BONUS.items() if name in section)
        if LOW_VALUE_SECTION.search(section):
            score -= LOW_VALUE_PENALTY
        ranked.append((score, chunk))
    ranked.sort(key=lambda item: item[0], reverse=True)

    is_education = lambda chunk: bool(EDUCATION_SECTION.search(chunk["section"]))
    best = [{"section": c["section"], "text": c["text"]} for _, c in ranked if not is_education(c)][:count]
    education = [{"section": c["section"], "text": c["text"]} for _, c in ranked if is_education(c)][:1]
    return best + education


def evidence_text(chunks):
    return "\n".join(f"- [{chunk['section']}] {chunk['text']}" for chunk in chunks)
