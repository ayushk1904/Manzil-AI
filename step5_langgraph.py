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
    return json.loads((user_folder(config) / "jobs.json").read_text(encoding="utf-8"))


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


@tool
def save_application(job_id: int, cover_letter: str, config: RunnableConfig) -> str:
    """Save the cover letter for a job. Only use this when the user asks to save."""
    filename = f"application_job_{job_id}.txt"
    (user_folder(config) / filename).write_text(cover_letter, encoding="utf-8")
    return f"Saved to {filename}"


all_tools = [list_jobs, get_job, read_resume, save_application]
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