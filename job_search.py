"""Finding openings for one role in one place. The web page's job search and the agent's search_jobs tool
both use this, so a search gives the same cards whoever asks for it."""
import json
import os
import re
import threading

import live_jobs

EARLY_CAREER = re.compile(r"\b(student|fresher|intern|internship|undergraduate)\b", re.IGNORECASE)
MAX_JOBS_KEPT = 60       # Older result cards in the chat keep working, up to this many.
_files_lock = threading.Lock()


def read_jobs(user_dir):
    """The openings shown to this user. The agent's tools read the same file."""
    path = user_dir / "jobs.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def verdict(job):
    """The model miscounts skills, so plain code decides this."""
    have, missing = len(job["have"]), len(job["missing"])
    if not have and not missing:
        return "unclear, the post lists no skills to compare, so don't call it a good fit"
    if not have:
        return "a weak fit, none of its listed skills are on the resume"
    if have > missing:
        return "a good fit, most of its listed skills are on the resume"
    return "a partial fit, it would take some skill-building"


def _write_json(path, data):
    """Write to a temporary file, then swap it in, so a reader never sees half a file."""
    temporary = path.with_suffix(f".{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(data), encoding="utf-8")
    os.replace(temporary, path)


def remember_jobs(shown, user_dir):
    """The agent's tools read these. Newest come first, and older cards in the chat keep working."""
    with _files_lock:              # The agent can search two places at once, and both save here.
        new_ids = {job["id"] for job in shown}
        kept = shown + [job for job in read_jobs(user_dir) if job["id"] not in new_ids]
        _write_json(user_dir / "jobs.json", kept[:MAX_JOBS_KEPT])
        labels = user_dir / "job_labels.json"              # Saved letters keep their names after a job closes.
        known = json.loads(labels.read_text(encoding="utf-8")) if labels.exists() else {}
        known.update({str(j["id"]): f"{j['title']} at {j['company']}" for j in shown})
        _write_json(labels, known)


def find_openings(user_dir, resume, role, location, count):
    """Real openings for this role and place, best first. The resume is only used here and never sent anywhere."""
    entry_level = bool(EARLY_CAREER.search(resume))
    matches = live_jobs.search(resume, role, location, entry_level)
    all_levels = entry_level and not matches               # Better some senior roles than an empty answer.
    if all_levels:
        matches = live_jobs.search(resume, role, location, False)
    _, updated = live_jobs.all_jobs()
    shown = matches[:count]
    remember_jobs(shown, user_dir)
    return {"jobs": shown, "total": len(matches), "updated": updated, "entry_level": entry_level and not all_levels}
