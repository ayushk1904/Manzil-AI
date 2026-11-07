"""Step 5: Control the agent with a graph. It now has memory and asks before saving."""
import json
from pathlib import Path

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt


def user_folder(config: RunnableConfig) -> Path:
    """Each user's files live in their own folder. The model never sees this setting."""
    return Path(config.get("configurable", {}).get("user_dir", "."))


def read_jobs(config: RunnableConfig) -> list:
    path = user_folder(config) / "jobs.json"
    if not path.exists():           # No job search yet. An empty list, not a crash, so the agent can say so.
        return []
    return json.loads(path.read_text(encoding="utf-8"))


@tool
def list_jobs(config: RunnableConfig) -> str:
    """List every job with its id, title and company."""
    return json.dumps([{"id": j["id"], "title": j["title"], "company": j["company"]} for j in read_jobs(config)])


@tool
def get_job(job_id: int, config: RunnableConfig) -> str:
    """Get the full details of one job using its id."""
    for job in read_jobs(config):
        if job["id"] == job_id:
            return json.dumps(job)
    return f"No job found with id {job_id}"


@tool
def read_resume(config: RunnableConfig) -> str:
    """Read the user's resume."""
    return (user_folder(config) / "resume.txt").read_text(encoding="utf-8")


MAX_PLACES = 4            # One request can name a few cities, not a whole country's worth.
JOBS_PER_PLACE = 6        # Cards shown for each place.
JOBS_TOLD_TO_MODEL = 4    # Enough for the model to pick the best one, without filling its memory.


def _opening(job) -> str:
    from job_search import verdict
    return (f"- {job['title']} at {job['company']}, {job['location'] or 'location not given'}. "
            f"Pay: {job.get('pay') or 'not published'}. On the resume: {', '.join(job['have']) or 'none'}. "
            f"Missing: {', '.join(job['missing']) or 'none'}. Verdict: {verdict(job)}.")


@tool(response_format="content_and_artifact")
def search_jobs(role: str, locations: list[str], config: RunnableConfig) -> tuple[str, list]:
    """Search real, current job openings and show them to the user as cards.

    role: one job title, such as "AI Engineer" or "Data Analyst".
    locations: the places to search, one per item, such as ["Mumbai", "Pune"]. Use ["Remote"] for remote
    work and [] to search anywhere. For two different roles, call this tool once per role.
    """
    import job_search                       # Here, so the lesson files above still run on their own.
    folder = user_folder(config)
    resume = (folder / "resume.txt").read_text(encoding="utf-8")
    role = (role or "").strip()[:80]
    if isinstance(locations, str):          # The model sometimes sends "Mumbai, Pune" as one string.
        locations = locations.split(",")
    places = list(dict.fromkeys(p.strip()[:80] for p in locations or [] if p and p.strip()))[:MAX_PLACES] or [""]
    if not role:
        return "No role was given. Call search_jobs again with a job title.", []

    searches, report = [], []
    for place in places:
        where = place or "anywhere"
        try:
            found = job_search.find_openings(folder, resume, role, place, JOBS_PER_PLACE)
        except Exception as error:          # One place failing shouldn't lose the others.
            print(f"search_jobs error: {error!r}")
            report.append(f"{where}: the search failed, so say you couldn't search there right now.")
            continue
        searches.append({"role": role, "location": place, **found})
        if not found["jobs"]:
            report.append(f"{where}: no {role} openings found.")
            continue
        report.append(f"{where}: {found['total']} {role} openings, best matches first:")
        report.extend(_opening(job) for job in found["jobs"][:JOBS_TOLD_TO_MODEL])
    return "\n".join(report), searches


@tool
def save_application(job_id: int, cover_letter: str, config: RunnableConfig) -> str:
    """Save the cover letter for a job. Only use this when the user asks to save."""
    filename = f"application_job_{job_id}.txt"
    (user_folder(config) / filename).write_text(cover_letter, encoding="utf-8")
    return f"Saved to {filename}"


all_tools = [list_jobs, get_job, read_resume, search_jobs, save_application]
model = ChatOllama(model="qwen2.5:7b", temperature=0, num_ctx=8192).bind_tools(all_tools)  # Room for a whole resume.
NEEDS_APPROVAL = {"save_application"}


# --- The nodes: each one does one job ---
def call_model(state: MessagesState):
    return {"messages": [model.invoke(state["messages"])]}


def ask_human(state: MessagesState) -> Command:
    calls = state["messages"][-1].tool_calls
    risky = [c for c in calls if c["name"] in NEEDS_APPROVAL]
    if risky and interrupt(risky[0]["args"]) != "yes":        # The graph pauses here.
        rejected = [{"role": "tool", "tool_call_id": c["id"], "content": "The user said no. Nothing was saved."}
                    for c in calls]
        return Command(goto="model", update={"messages": rejected})
    return Command(goto="tools")


# --- The edge that chooses: did the AI ask for a tool? ---
def after_model(state: MessagesState):
    return "ask_human" if state["messages"][-1].tool_calls else END


# --- Build the flowchart ---
graph = StateGraph(MessagesState)
graph.add_node("model", call_model)
graph.add_node("ask_human", ask_human, destinations=("model", "tools"))
graph.add_node("tools", ToolNode(all_tools))
graph.add_edge(START, "model")
graph.add_conditional_edges("model", after_model, ["ask_human", END])
graph.add_edge("tools", "model")
app = graph.compile(checkpointer=InMemorySaver())   # The checkpointer gives it memory.

if __name__ == "__main__":
    config = {"configurable": {"thread_id": "ayush-1"}, "recursion_limit": 20}

    out = app.invoke({"messages": [("user", "Read job 1 and tell me what it asks for.")]}, config)
    print("TURN 1:", out["messages"][-1].content, "\n")

    # "That job" only makes sense if the agent remembers turn 1.
    out = app.invoke({"messages": [("user", "Write a 3-line cover letter for that job and save it.")]}, config)

    while "__interrupt__" in out:
        print("WANTS TO SAVE:", out["__interrupt__"][0].value)
        answer = input("Save it? (yes/no): ").strip().lower()
        out = app.invoke(Command(resume=answer), config)

    print("\nTURN 2:", out["messages"][-1].content)