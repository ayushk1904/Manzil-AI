"""Write a proper application letter from the user's own resume.

Plain code builds the parts that must be exact: the sender, date, recipient, subject and signature.
The model only writes the three body paragraphs, from the resume chunks retrieved for this job.
Plain code then checks each sentence against the resume, so the letter can't overstate the user.
"""
import datetime
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_ollama import ChatOllama

import resume_search
from live_jobs import names_skill

MODEL = "qwen2.5:7b"
EVIDENCE_CHUNKS = 4
JOB_DESCRIPTION_CHARS = 1500
ATTEMPTS = 3
COPIED_PHRASE_WORDS = 3

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<![\d-])(?:\+\d{1,3}[\s-]?)?\d{5}[\s-]?\d{5}(?!\d)")
GREETING_OR_SIGN_OFF = re.compile(r"^\s*(dear\b|to whom|subject:|yours\b|sincerely|regards|best\b|warm regards|thank you,?$|my name is)",
                                  re.IGNORECASE)
PLACEHOLDER = re.compile(r"\[[^\]]*\]|\{[^}]*\}|<[^>]+>")
EMPTY_PHRASES = re.compile(r"passion|strong background|well-equipped|committed to learning|eager to learn|"
                           r"quick learner|team player|hard-?working|proven track record|deep understanding|"
                           r"as an ai\b|synerg", re.IGNORECASE)
# A sentence where the candidate says they have done or can do something.
CLAIM = re.compile(r"\b(i have|i've|i am (?:skilled|proficient|experienced|confident|able)|my (?:experience|expertise|skills?|ability)|"
                   r"i (?:built|developed|designed|created|implemented|led|optimi[sz]ed|worked)|experience (?:in|with))\b",
                   re.IGNORECASE)
PROPER_NOUN = re.compile(r"(?<=[a-z,;:] )[A-Z][a-zA-Z.-]+")
EVERYDAY_NAMES = {"cloud deployment": ["cloud"], "machine learning": ["ML"], "testing": ["tests"]}
EDUCATION = re.compile(r"(?:EDUCATION|Education)\b.{0,400}", re.DOTALL)
YEAR = re.compile(r"\b20\d{2}\b")
GRADUATED = re.compile(r"\b(graduated|graduate of|recent graduate|having (?:recently )?completed|recently completed|"
                       r"completed my|hold a|holding a|have earned|earned my)\b", re.IGNORECASE)
COMMON_CAPITALS = {"I", "AI", "ML", "API", "APIs", "Python", "Computer", "Science", "Engineering", "Bachelor", "Machine", "Learning"}
TITLE_END = re.compile(r"\s+[—–-]\s+|\s*\|\s*|,\s")
WORDS = re.compile(r"[a-z0-9+#.-]+")
JOINING_WORDS = {"and", "or", "the", "a", "an", "of", "to", "in", "on", "for", "with", "our", "your", "that", "this", "is", "are"}

WRITER = """You write the body of a job application letter for a candidate, in the first person.

Rules:
- Write exactly three short paragraphs, 120 to 170 words in total, separated by a blank line.
- Paragraph 1: say which position and company this is for, then who the candidate is, using the degree and college from the evidence. If the education dates end in the future, say the candidate is currently studying. Never say they have graduated.
- Paragraph 2: describe two specific projects or experiences from the evidence, by their exact names. Say what the candidate actually built and with which tools, and connect each one to something this job needs.
- Paragraph 3: one specific reason this role fits, taken from the job description, then ask politely for an interview.
- The job description says what the company wants, not what the candidate has. Everything you say about the candidate must come from the evidence. Never reuse a requirement from the job description as the candidate's experience.
- Never invent numbers, employers, results, years, cities or skills.
- Only mention the skills listed as matching. Never mention skills the candidate lacks, or say they will learn them.
- Plain, confident, specific language. No greeting, no subject line, no signature, no placeholders, no headings, no lists. Do not state the candidate's name.
- Avoid empty phrases such as "passion", "strong background", "team player" and "eager to learn".
- Output only the three paragraphs."""


def _contact_line(resume):
    found = [match[0] for match in (EMAIL.search(resume), PHONE.search(resume)) if match]
    return " | ".join(part.strip() for part in found)


def _evidence_titles(chunks):
    titles = []
    for chunk in chunks:
        title = TITLE_END.split(chunk["text"], maxsplit=1)[0].strip()
        if 2 < len(title) <= 60 and not re.search("education|skill|summary", chunk["section"], re.IGNORECASE):
            titles.append(title)
    return titles


def _copied_from_job(sentence, job_text, resume_lower):
    """A phrase the job post uses but the resume doesn't, in a sentence claiming the candidate has it."""
    if not CLAIM.search(sentence):
        return None
    words = WORDS.findall(sentence.lower())
    for start in range(len(words) - COPIED_PHRASE_WORDS + 1):
        phrase = words[start:start + COPIED_PHRASE_WORDS]
        if sum(word not in JOINING_WORDS for word in phrase) < 2:
            continue
        text = " ".join(phrase)
        if text in job_text and text not in resume_lower:
            return text
    return None


def _unknown_name(sentence, known_text):
    """A place or name the model added that appears in neither the resume nor the job."""
    for word in PROPER_NOUN.findall(sentence):
        word = word.rstrip(".-")
        if word not in COMMON_CAPITALS and word.lower() not in known_text:
            return word
    return None


def _still_studying(resume):
    """True if the education section ends in a future year, like 2023-2027."""
    match = EDUCATION.search(resume)
    years = [int(year) for year in YEAR.findall(match[0])] if match else []
    return bool(years) and max(years) > datetime.date.today().year


def _names_missing_skill(sentence, job):
    """Also counts everyday words for a skill, like "cloud", but not when it's only the job's own title."""
    text = re.sub(re.escape(job["title"]), " ", sentence, flags=re.IGNORECASE)
    names = [name for skill in job.get("missing", []) for name in (skill, *EVERYDAY_NAMES.get(skill, []))]
    return any(names_skill(text, [name]) for name in names)


def _check_body(text, job, resume):
    """Keep what the resume supports. Returns the clean text and what was wrong with the rest."""
    studying = _still_studying(resume)
    resume_lower = " ".join(resume.lower().split())
    job_text = " ".join(job["description"].lower().split())
    known_text = f"{resume_lower} {job_text} {job['title'].lower()} {(job.get('company') or '').lower()} {(job.get('location') or '').lower()}"
    paragraphs, problems = [], []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        kept = []
        for sentence in re.split(r"(?<=[.!?])\s+", " ".join(paragraph.split())):
            if GREETING_OR_SIGN_OFF.match(sentence) or PLACEHOLDER.search(sentence) or EMPTY_PHRASES.search(sentence):
                continue
            if studying and GRADUATED.search(sentence):
                problems.append(f'The candidate has not graduated and is still studying. Fix this: "{sentence}"')
                continue
            if _names_missing_skill(sentence, job):
                problems.append(f'Don\'t mention skills the candidate lacks, as in: "{sentence}"')
                continue
            copied = _copied_from_job(sentence, job_text, resume_lower)
            if copied:
                problems.append(f'"{copied}" comes from the job description, not the evidence. Remove that claim.')
                continue
            unknown = _unknown_name(sentence, known_text)
            if unknown:
                problems.append(f'"{unknown}" is not in the evidence. Remove it.')
                continue
            kept.append(sentence)
        if kept:
            paragraphs.append(" ".join(kept))
    return "\n\n".join(paragraphs), problems


def _problems_with(body, chunks):
    problems = []
    titles = _evidence_titles(chunks)
    if len(body.split()) < 70:
        problems.append("It is too short. Write all three paragraphs, 120 to 170 words in total.")
    if titles and not any(title.lower() in body.lower() for title in titles):
        problems.append(f"It names no project. Describe at least one of these by its exact name: {', '.join(titles[:4])}.")
    return problems


def write_body(resume, job, user_dir):
    query = f"{job['title']}. {' '.join(job.get('have', []))}. {job['description'][:JOB_DESCRIPTION_CHARS]}"
    chunks = resume_search.retrieve(resume, query, user_dir, EVIDENCE_CHUNKS)
    company = f" at {job['company']}" if job.get("company") else ""
    request = (f"Today's year: {datetime.date.today().year}\n"
               f"Position: {job['title']}{company}\n"
               f"Job description: {job['description'][:JOB_DESCRIPTION_CHARS]}\n"
               f"Matching skills: {', '.join(job.get('have', [])) or 'see the evidence'}\n\n"
               f"Evidence from the candidate's resume:\n{resume_search.evidence_text(chunks)}")
    writer = ChatOllama(model=MODEL, temperature=0.2, num_ctx=8192)
    messages = [SystemMessage(WRITER), HumanMessage(request)]
    best, fewest = "", None
    for _ in range(ATTEMPTS):
        body, problems = _check_body(writer.invoke(messages).content, job, resume)
        problems += _problems_with(body, chunks)
        if fewest is None or len(problems) < fewest:     # The draft that needed the least removed.
            best, fewest = body, len(problems)
        if not problems:
            break
        feedback = "\n".join(f"- {problem}" for problem in problems[:5])
        messages = [SystemMessage(WRITER), HumanMessage(f"{request}\n\nYour last draft had these problems. Write it again without them:\n{feedback}")]
    return _with_opening(best, job)


def _with_opening(body, job):
    """Whatever the checks removed, a letter must still say which job it is for."""
    first_sentence = re.split(r"(?<=[.!?])\s+", body, maxsplit=1)[0].lower()
    if "appl" in first_sentence and (job.get("company") or "").lower() in first_sentence:
        return body
    title = job["title"].title() if job["title"].islower() else job["title"]
    place = f" at {job['company']}" if job.get("company") else ""
    return f"I am writing to apply for the position of {title}{place}. {body}"


def write_letter(resume, job, name, user_dir):
    today = datetime.date.today()
    title = job["title"].title() if job["title"].islower() else job["title"]
    location = job.get("location") or ""
    recipient = ["The Hiring Team", job.get("company"), location.title() if location.islower() else location]
    subject = f"Application for the position of {title}" if job.get("company") else "Job application"
    sender = [name, _contact_line(resume), f"{today.day} {today:%B %Y}"]
    parts = [*filter(None, sender), "",
             *filter(None, recipient), "",
             f"Subject: {subject}", "",
             "Dear Hiring Manager,", "",
             write_body(resume, job, user_dir), "",
             "Yours sincerely,", name]
    return "\n".join(parts)
