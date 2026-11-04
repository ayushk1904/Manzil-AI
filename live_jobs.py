"""Real job openings, read from the public career pages of the companies in companies.json.

Greenhouse, Lever and Ashby run the career pages of many companies and startups, and their public
job lists need no API key. We download them all, then search them here, so a user's resume never
leaves this server. Add a company by adding a line to companies.json. See the README for how.

If an Adzuna key is set in .env, each search also asks Adzuna, sending only the role and the place.
Run "python live_jobs.py" to check that the key works and what it finds.
"""
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
COMPANIES = HERE / "companies.json"
CACHE = HERE / "jobs_cache.json"
REFRESH_SECONDS = 6 * 3600       # Openings don't change by the minute, so don't ask for them by the minute.
TIMEOUT_SECONDS = 30
MAX_DESCRIPTION_CHARS = 2000     # Enough for the agent to read, without filling the model's memory.
MAX_PER_COMPANY = 3              # So one big company doesn't fill the first page of results.
CACHE_VERSION = 3                # Raise this when job fields change, so old saved lists are replaced.
CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€", "CAD": "CA$", "AUD": "A$", "SGD": "S$", "JPY": "¥"}
LAKH = 100000
UNPAID_TITLE = re.compile(r"\b(intern|internship|trainee|apprentice)\b", re.IGNORECASE)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<![\d-])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
# Published addresses that aren't for job seekers to contact about the role.
NOT_A_HIRING_CONTACT = re.compile(r"privacy|dpo|gdpr|legal|no-?reply|accommodat|accessib|disab|benefit|security|support|"
                                  r"compliance|ethics|press|abuse|billing|\.(png|jpe?g|gif|svg)$", re.IGNORECASE)
# Words near an address that show it's for something else, like "hr@..." for accommodation requests.
OTHER_PURPOSE_NEARBY = re.compile(r"accommodat|disabilit|equal opportunit|equal employment|privacy|personal data|"
                                  r"discriminat|harass|whistle|report a|fraud|scam", re.IGNORECASE)
CONTACT_CONTEXT_CHARS = 160


def _load_env_file():
    """Read secret settings from .env, which is never published. Real environment variables win."""
    path = HERE / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        name, separator, value = line.partition("=")
        if separator and not name.strip().startswith("#"):
            os.environ.setdefault(name.strip(), value.strip().strip("'\""))


_load_env_file()

ADZUNA_URL = "https://api.adzuna.com/v1/api/jobs/{country}/search/1"
ADZUNA_COUNTRY = os.environ.get("ADZUNA_COUNTRY", "in").strip().lower()
ADZUNA_SITES = {"in": "https://www.adzuna.in", "gb": "https://www.adzuna.co.uk"}
ADZUNA_CURRENCIES = {"in": "INR", "gb": "GBP", "us": "USD", "ca": "CAD", "au": "AUD", "sg": "SGD"}
ADZUNA_RESULTS = 50
ADZUNA_TIMEOUT_SECONDS = 10
ADZUNA_RETRY_SECONDS = 300       # After a failed call, wait a while instead of hitting the limit.
ADZUNA_MAX_SAVED_SEARCHES = 500
ADZUNA_PLACES = {"delhi ncr": "Delhi", "remote": ""}   # How Adzuna should be asked for these places.

# Skills we can check with plain code, and other words that count as the same skill.
SKILL_TERMS = {
    "Python": [], "JavaScript": [], "TypeScript": [], "Java": [], "SQL": ["MySQL"], "Go": ["Golang"], "Rust": [],
    "C++": [], "C#": [], "Ruby": [], "PHP": [], "Scala": [], "Kotlin": [], "Swift": [],
    "HTML": [], "CSS": [], "React": [], "Next.js": [], "Angular": [], "Vue": [], "Node.js": [], "Express.js": [],
    "Flask": [], "Django": [], "Spring": [], "REST APIs": ["REST API"], "GraphQL": [],
    "MongoDB": [], "Postgres": ["PostgreSQL"], "Redis": [], "Kafka": [], "Spark": [], "Airflow": [],
    "RAG": ["Retrieval-Augmented"], "LLMs": ["LLM"], "AI agents": ["AI agent", "agentic"], "LangGraph": [],
    "LangChain": [], "embeddings": [], "vector databases": ["vector database", "vector search", "ChromaDB"],
    "PyTorch": [], "TensorFlow": [], "scikit-learn": [], "pandas": [], "NLP": ["natural language processing"],
    "machine learning": [], "fine-tuning": ["fine-tune", "fine-tuned"],
    "Docker": [], "Kubernetes": [], "Terraform": [], "Linux": [], "CI/CD": [],
    "cloud deployment": ["AWS", "Azure", "GCP"], "testing": ["unit tests"], "Git": ["GitHub"],
    "Tableau": [], "Power BI": [], "Excel": [], "Figma": [], "Salesforce": [], "SEO": [],
}

# Roles to suggest, and the skills on a resume that point to each one.
ROLE_SUGGESTIONS = {
    "AI Engineer": ["RAG", "LLMs", "AI agents", "embeddings", "vector databases", "LangChain", "LangGraph"],
    "Machine Learning Engineer": ["machine learning", "PyTorch", "TensorFlow", "scikit-learn", "NLP"],
    "Full Stack Developer": ["React", "Node.js", "Express.js", "Next.js", "MongoDB"],
    "Frontend Developer": ["React", "HTML", "CSS", "JavaScript", "TypeScript", "Angular", "Vue"],
    "Backend Developer": ["Node.js", "Django", "Flask", "Spring", "REST APIs", "Postgres", "Go"],
    "Data Analyst": ["SQL", "Excel", "Tableau", "Power BI", "pandas"],
    "DevOps Engineer": ["Docker", "Kubernetes", "Terraform", "CI/CD", "Linux"],
}

# Searching a place should also find jobs that name another part of it. Add other places the same way.
PLACE_NAMES = {
    "india": ["bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida",
              "chennai", "kolkata", "ahmedabad", "jaipur", "surat", "karnataka", "maharashtra", "tamil nadu",
              "telangana", "uttar pradesh", "gujarat", "rajasthan"],
    "bangalore": ["bengaluru", "karnataka"],
    "bengaluru": ["bangalore", "karnataka"],
    "delhi ncr": ["delhi", "gurgaon", "gurugram", "noida", "ncr", "haryana"],
    "delhi": ["ncr", "gurgaon", "gurugram", "noida"],
    "gurgaon": ["gurugram"],
    "gurugram": ["gurgaon"],
}
REMOTE = re.compile(r"\b(remote|worldwide|anywhere|work from home)\b", re.IGNORECASE)
OTHER_COUNTRY = re.compile(r"\b(us|usa|united states|canada|brazil|europe|eu|emea|uk|united kingdom|germany|ireland|"
                           r"france|spain|poland|greece|mexico|australia|singapore|japan|latam|americas|apac)\b",
                           re.IGNORECASE)

# Words like these say little about a role, so "AI Engineer" is mostly a search for "AI".
GENERIC_ROLE_WORDS = {"engineer", "engineering", "developer", "development", "dev", "specialist", "analyst", "associate",
                      "intern", "internship", "manager", "lead", "executive", "consultant", "role", "job", "jobs",
                      "position", "fresher", "junior", "senior", "in", "for", "and", "of", "the", "a", "an"}
ROLE_SPELLINGS = {"full stack": "fullstack", "full-stack": "fullstack", "front end": "frontend", "front-end": "frontend",
                  "back end": "backend", "back-end": "backend", "machine learning": "ml",
                  "artificial intelligence": "ai", "human resources": "hr", "dev ops": "devops"}
ROLE_SYNONYMS = {
    "ai": ["ml", "machine learning", "artificial intelligence", "llm", "genai", "gen ai", "generative ai", "nlp"],
    "ml": ["machine learning", "ai", "artificial intelligence", "llm", "nlp"],
    "fullstack": ["full stack", "full-stack"],
    "frontend": ["front end", "front-end", "ui engineer", "web developer"],
    "backend": ["back end", "back-end"],
    "devops": ["sre", "site reliability", "infrastructure", "platform engineer"],
    "software": ["sde", "fullstack", "full stack", "backend", "frontend"],
    "sde": ["software engineer", "software developer"],
    "hr": ["human resources", "talent", "recruiter", "recruitment", "people"],
    "ui": ["ux", "product designer", "frontend"],
    "ux": ["ui", "product designer"],
}
TITLE_MATCH_ALL = 10
TITLE_MATCH_SOME = 5
DESCRIPTION_MATCH = 2
MIN_DESCRIPTION_MENTIONS = 3     # One passing mention of AI doesn't make it an AI job.
GENERIC_WORD_BONUS = 3
ENTRY_LEVEL_BONUS = 3

TOO_SENIOR = re.compile(r"\b(senior|sr|staff|principal|lead|manager|director|head|vp|vice president|chief|architect|"
                        r"executive|ii|iii|iv)\b", re.IGNORECASE)
ENTRY_LEVEL = re.compile(r"\b(intern|internship|graduate|trainee|junior|jr|apprentice|entry|new grad|early career)\b",
                         re.IGNORECASE)
MAX_ENTRY_LEVEL_YEARS = 2
# "5+ years of experience", "3-5 yrs experience", "Experience : 5-8 yrs"
YEARS_ASKED = re.compile(r"(\d+)\s*(?:\+|-\s*\d+|to\s*\d+)?\s*(?:years|yrs)[^.]{0,40}experience"
                         r"|experience\s*:?\s*(\d+)", re.IGNORECASE)

_lock = threading.Lock()
_jobs = []
_updated = 0.0
_refreshing = False
_adzuna_lock = threading.Lock()
_adzuna_searches = {}            # (role, place) -> (time it stops being fresh, jobs)


def names_skill(text, names):
    # Short names must match exactly, so the word "go" doesn't count as knowing Go.
    return any(re.search(rf"(?<![\w.-]){re.escape(name)}(?!\w)", text, re.IGNORECASE if len(name) > 3 else 0)
               for name in names)


def skills_named_in(text):
    lowered = text.lower()
    found = []
    for skill, others in SKILL_TERMS.items():
        names = [skill] + others
        # A plain text search is far quicker, so only run the exact check on likely matches.
        if any(name.lower() in lowered for name in names) and names_skill(text, names):
            found.append(skill)
    return found


def on_resume(skill, resume):
    return names_skill(resume, [skill] + SKILL_TERMS.get(skill, []))


def suggest_roles(resume, count=4):
    hits = {role: sum(on_resume(skill, resume) for skill in skills) for role, skills in ROLE_SUGGESTIONS.items()}
    return [role for role in sorted(hits, key=hits.get, reverse=True) if hits[role]][:count]


# --- Downloading ---
def _get_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "CareerPilot (open-source job matcher)"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def _plain_text(markup):
    # Greenhouse escapes its HTML, so it has to be unescaped both before and after removing the tags.
    text = re.sub(r"<[^>]+>", " ", html.unescape(markup or ""))
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _format_pay(low, high, currency, title, period="year"):
    """Only ever built from figures the source published. None means the job didn't say."""
    if not low and not high:
        return None
    low, high = low or high, high or low
    if currency == "INR" and period == "year" and not UNPAID_TITLE.search(title):
        amount = f"{low / LAKH:.1f}".removesuffix(".0")
        if high != low:
            amount += f"–{high / LAKH:.1f}".removesuffix(".0")
        return f"₹{amount} LPA"
    if currency == "INR" and period == "year":                # Stipends are talked about per month.
        low, high, period = low / 12, high / 12, "month"
    symbol = CURRENCY_SYMBOLS.get(currency, f"{currency} ")
    amount = f"{symbol}{low:,.0f}" if high == low else f"{symbol}{low:,.0f}–{symbol}{high:,.0f}"
    return f"{amount} a {period}"


def _find_contacts(description):
    """Contact details that the job post itself publishes. We never guess them or look elsewhere."""
    def for_hiring(match):
        nearby = description[max(match.start() - CONTACT_CONTEXT_CHARS, 0):match.end() + CONTACT_CONTEXT_CHARS]
        return not NOT_A_HIRING_CONTACT.search(match[0]) and not OTHER_PURPOSE_NEARBY.search(nearby)

    emails = list(dict.fromkeys(match[0] for match in EMAIL.finditer(description) if for_hiring(match)))
    phones = list(dict.fromkeys(match[0] for match in PHONE.finditer(description) if for_hiring(match)))
    return {"emails": emails[:2], "phones": phones[:1]}


def _job(job_id, title, company, location, url, description, pay=None):
    # A company saying its own name, like "Figma" at Figma, isn't asking for that skill.
    skills = [skill for skill in skills_named_in(description) if skill.lower() != company["name"].lower()]
    return {"id": job_id, "title": title.strip(), "company": company["name"], "startup": company.get("startup", False),
            "location": (location or "").strip(), "url": url, "description": description[:MAX_DESCRIPTION_CHARS],
            "skills": skills, "pay": pay, "contact": _find_contacts(description)}


def _from_greenhouse(company):
    url = f"https://boards-api.greenhouse.io/v1/boards/{company['slug']}/jobs?content=true&pay_transparency=true"
    jobs = []
    for job in _get_json(url)["jobs"]:
        ranges = job.get("pay_input_ranges") or []
        pay = None
        if ranges:
            first = ranges[0]
            pay = _format_pay((first.get("min_cents") or 0) / 100, (first.get("max_cents") or 0) / 100,
                              first.get("currency_type"), job["title"])
        jobs.append(_job(job["id"], job["title"], company, job["location"]["name"], job["absolute_url"],
                         _plain_text(job.get("content")), pay))
    return jobs


def _from_lever(company):
    jobs = []
    periods = {"per-year-salary": "year", "per-month-salary": "month", "per-hour-wage": "hour"}
    for job in _get_json(f"https://api.lever.co/v0/postings/{company['slug']}?mode=json"):
        parts = [job.get("descriptionPlain", ""), job.get("additionalPlain", "")]
        parts += [f"{part.get('text', '')} {part.get('content', '')}" for part in job.get("lists", [])]
        salary = job.get("salaryRange") or {}
        pay = _format_pay(salary.get("min"), salary.get("max"), salary.get("currency"), job["text"],
                          periods.get(salary.get("interval"), "year")) if salary else None
        jobs.append(_job(zlib.crc32(job["id"].encode()), job["text"], company,
                         job["categories"].get("location"), job["hostedUrl"], _plain_text(" ".join(parts)), pay))
    return jobs


def _from_ashby(company):
    jobs = []
    url = f"https://api.ashbyhq.com/posting-api/job-board/{company['slug']}?includeCompensation=true"
    for job in _get_json(url)["jobs"]:
        if job.get("isListed", True):
            places = [job.get("location") or ""] + [p.get("location", "") for p in job.get("secondaryLocations", [])]
            pay = (job.get("compensation") or {}).get("compensationTierSummary") or None
            jobs.append(_job(zlib.crc32(job["id"].encode()), job["title"], company, ", ".join(filter(None, places)),
                             job["jobUrl"], _plain_text(job.get("descriptionPlain") or job.get("descriptionHtml")), pay))
    return jobs


READERS = {"greenhouse": _from_greenhouse, "lever": _from_lever, "ashby": _from_ashby}


def _download_company(company):
    """One company being down must not stop the others."""
    try:
        return READERS[company["board"]](company)
    except Exception as error:
        print(f"Couldn't read jobs from {company['name']}: {error!r}")
        return []


def _refresh():
    global _jobs, _updated, _refreshing
    started = time.time()
    try:
        companies = json.loads(COMPANIES.read_text(encoding="utf-8"))
        with ThreadPoolExecutor(max_workers=8) as pool:
            found = [job for jobs in pool.map(_download_company, companies) for job in jobs]
        if found:                                          # Keep the old list if every company failed.
            _jobs, _updated = found, time.time()
            temporary = CACHE.with_suffix(".tmp")
            temporary.write_text(json.dumps({"version": CACHE_VERSION, "updated": _updated, "jobs": found}), encoding="utf-8")
            os.replace(temporary, CACHE)
            print(f"Loaded {len(found)} openings from {len(companies)} companies in {time.time() - started:.0f}s")
    finally:
        _refreshing = False


def all_jobs():
    """Every opening, and when it was downloaded. Only the very first load makes anyone wait."""
    global _jobs, _updated, _refreshing
    with _lock:
        if not _jobs and CACHE.exists():
            saved = json.loads(CACHE.read_text(encoding="utf-8"))
            if saved.get("version") == CACHE_VERSION:
                _jobs, _updated = saved["jobs"], saved["updated"]
        if not _jobs:
            _refreshing = True
            _refresh()
        else:
            is_old = time.time() - _updated > REFRESH_SECONDS or COMPANIES.stat().st_mtime > _updated
            if is_old and not _refreshing:
                _refreshing = True
                threading.Thread(target=_refresh, daemon=True).start()
        return _jobs, _updated


# --- Adzuna: more companies, but only used if this copy of the app has its own key ---
def adzuna_enabled():
    return bool(os.environ.get("ADZUNA_APP_ID") and os.environ.get("ADZUNA_APP_KEY"))


def _ask_adzuna(role, place):
    """Only the role and the place are sent. The key is part of the URL, so never print the URL."""
    wanted = place.strip().lower()
    params = {"app_id": os.environ["ADZUNA_APP_ID"], "app_key": os.environ["ADZUNA_APP_KEY"],
              "results_per_page": ADZUNA_RESULTS, "what": f"{role} remote" if wanted == "remote" else role}
    where = ADZUNA_PLACES.get(wanted, place.strip())
    if where:
        params["where"] = where
    url = f"{ADZUNA_URL.format(country=ADZUNA_COUNTRY)}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=ADZUNA_TIMEOUT_SECONDS) as response:
        return json.load(response)


def _from_adzuna(result):
    company = {"name": (result.get("company") or {}).get("display_name") or "Company not listed"}
    title = _plain_text(result.get("title"))
    # Adzuna's own salary estimates have separate labelling rules, so only figures from the employer are shown.
    stated = str(result.get("salary_is_predicted")) == "0"
    pay = _format_pay(result.get("salary_min"), result.get("salary_max"), ADZUNA_CURRENCIES.get(ADZUNA_COUNTRY), title) if stated else None
    job = _job(zlib.crc32(f"adzuna:{result['id']}".encode()), title, company,
               (result.get("location") or {}).get("display_name"), result["redirect_url"],
               _plain_text(result.get("description")), pay)
    # Adzuna's terms ask for this label, with this link, on every job from them.
    return {**job, "source": "Adzuna", "source_url": ADZUNA_SITES.get(ADZUNA_COUNTRY, ADZUNA_SITES["gb"])}


def adzuna_jobs(role, place):
    """Jobs from Adzuna, saved so repeat searches don't use up the key's limit. Never raises."""
    if not adzuna_enabled():
        return []
    key = (role.strip().lower(), place.strip().lower())
    with _adzuna_lock:
        saved = _adzuna_searches.get(key)
        if saved and saved[0] > time.time():
            return saved[1]
    try:
        jobs, fresh_for = [_from_adzuna(r) for r in _ask_adzuna(role, place).get("results", [])], REFRESH_SECONDS
    except urllib.error.HTTPError as error:              # Not the error text: it could include the URL.
        print(f"Adzuna answered with status {error.code}")
        jobs, fresh_for = [], ADZUNA_RETRY_SECONDS
    except Exception as error:
        print(f"Couldn't reach Adzuna: {type(error).__name__}")
        jobs, fresh_for = [], ADZUNA_RETRY_SECONDS
    with _adzuna_lock:
        if len(_adzuna_searches) >= ADZUNA_MAX_SAVED_SEARCHES:
            _adzuna_searches.clear()
        _adzuna_searches[key] = (time.time() + fresh_for, jobs)
    return jobs


# --- Searching. All of this runs here, so the resume stays on this server ---
def in_location(job_location, wanted):
    wanted = wanted.strip().lower()
    if not wanted:
        return True
    if wanted == "remote":
        # "Remote - Brazil" isn't remote for everyone, so it has to be open or name no other country.
        return bool(REMOTE.search(job_location)) and not OTHER_COUNTRY.search(job_location)
    names = [wanted] + PLACE_NAMES.get(wanted, [])
    return any(re.search(rf"\b{re.escape(name)}\b", job_location, re.IGNORECASE) for name in names)


def _role_words(role):
    role = role.lower()
    for spelling, word in ROLE_SPELLINGS.items():
        role = role.replace(spelling, word)
    words = re.findall(r"[a-z0-9+#.]+", role)
    return [w for w in words if w not in GENERIC_ROLE_WORDS], [w for w in words if w in GENERIC_ROLE_WORDS]


def _mentions(text, word):
    names = [word] + ROLE_SYNONYMS.get(word, [])
    return sum(len(re.findall(rf"(?<!\w){re.escape(name)}(?!\w)", text, re.IGNORECASE)) for name in names)


def _says(text, word):
    return _mentions(text, word) > 0


def role_score(job, core, generic):
    """How well a job fits the role the user asked for, or None if it doesn't fit."""
    title = job["title"]
    has_generic = any(_says(title, word) for word in generic)
    score = GENERIC_WORD_BONUS if has_generic else 0
    if not core:
        return TITLE_MATCH_SOME + score if has_generic else None
    hits = sum(_says(title, word) for word in core)
    if hits == len(core):
        return TITLE_MATCH_ALL + score
    if hits:
        return TITLE_MATCH_SOME + score
    # "AI Engineer" can also be a "Software Engineer" whose job post is really about AI.
    if has_generic and all(_mentions(job["description"], word) >= MIN_DESCRIPTION_MENTIONS for word in core):
        return DESCRIPTION_MATCH + score
    return None


def too_experienced(job):
    if TOO_SENIOR.search(job["title"]):
        return True
    asked = YEARS_ASKED.finditer(f"{job['title']}. {job['description']}")
    return any(int(match[1] or match[2]) > MAX_ENTRY_LEVEL_YEARS for match in asked)


def search(resume, role, location, entry_level):
    """Jobs for this role and place, best first, ready to show."""
    has_skill = {skill: on_resume(skill, resume) for skill in SKILL_TERMS}
    core, generic = _role_words(role)
    jobs, _ = all_jobs()
    company_jobs = [job for job in jobs if in_location(job["location"], location)]
    from_adzuna = adzuna_jobs(role, location)                 # Adzuna has already filtered by place.
    if location.strip().lower() == "remote":                  # But it has no filter for remote work.
        from_adzuna = [job for job in from_adzuna
                       if REMOTE.search(f"{job['title']} {job['location']} {job['description']}")]

    scored = []
    for job in company_jobs + from_adzuna:
        if entry_level and too_experienced(job):
            continue
        fit = role_score(job, core, generic)
        if fit is None:
            continue
        have = [s for s in job["skills"] if has_skill.get(s)]
        missing = [s for s in job["skills"] if not has_skill.get(s)]
        score = fit + len(have) - 0.5 * len(missing)
        if entry_level and ENTRY_LEVEL.search(job["title"]):
            score += ENTRY_LEVEL_BONUS
        scored.append((score, job, have, missing))
    scored.sort(key=lambda item: item[0], reverse=True)

    first, rest, per_company, seen = [], [], {}, set()
    for _, job, have, missing in scored:
        # Many companies post one job per city, and Adzuna can list the same job again.
        same_job = (job["company"].lower(), job["title"].lower())
        if same_job in seen:
            continue
        seen.add(same_job)
        fields = ("id", "title", "company", "startup", "location", "url", "description", "source", "source_url",
                  "pay", "contact")
        result = {**{k: job.get(k) for k in fields}, "have": have, "missing": missing}
        per_company[job["company"]] = per_company.get(job["company"], 0) + 1
        (first if per_company[job["company"]] <= MAX_PER_COMPANY else rest).append(result)
    return first + rest


def check_adzuna():
    """A quick test of the key: python live_jobs.py"""
    if not adzuna_enabled():
        print("No Adzuna key found. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the .env file.")
        return
    print(f"Key found. Country: {ADZUNA_COUNTRY}\n")
    for role, place in (("Software Engineer", "Bangalore"), ("Frontend Developer", "Pune"), ("Backend Developer", "Hyderabad"),
                        ("Data Analyst", "Mumbai"), ("AI Engineer", "Delhi NCR"), ("Software Engineer", "")):
        try:
            results = _ask_adzuna(role, place).get("results", [])
        except urllib.error.HTTPError as error:
            print(f"Adzuna answered with status {error.code}. 401 or 403 means check the key. 429 means too many requests.")
            return
        except Exception as error:
            print(f"Couldn't reach Adzuna: {type(error).__name__}")
            return
        print(f"{role} in {place or 'anywhere'}: {len(results)} results")
        for result in results[:2]:
            print(f"    {_from_adzuna(result)['title'][:50]} | {_from_adzuna(result)['company'][:25]} | {_from_adzuna(result)['location'][:30]}")


if __name__ == "__main__":
    check_adzuna()
