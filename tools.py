import json


def list_jobs() -> str:
    """List every job with its id, title and company."""
    with open("jobs.json", encoding="utf-8") as f:
        jobs = json.load(f)
    return json.dumps([{"id": j["id"], "title": j["title"], "company": j["company"]} for j in jobs])


def get_job(job_id: int) -> str:
    """Get the full details of one job using its id."""
    with open("jobs.json", encoding="utf-8") as f:
        jobs = json.load(f)
    for job in jobs:
        if job["id"] == job_id:
            return json.dumps(job)
    return f"No job found with id {job_id}"


def read_resume() -> str:
    """Read the user's resume."""
    with open("resume.txt", encoding="utf-8") as f:
        return f.read()


if __name__ == "__main__":
    print(list_jobs())
    print(get_job(1))
    print(get_job(99))
    print(read_resume()[:200])