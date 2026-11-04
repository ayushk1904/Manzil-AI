"""Step 4: The same agent as step 3, in far fewer lines."""
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_ollama import ChatOllama

import tools

SYSTEM = ("You are a career assistant. You can read the user's resume and the jobs with your "
          "tools, so never ask the user for them. Read the full details of a job before you "
          "judge it. If asked for the best job, choose exactly one. A skill is missing only "
          "if the job description names it and the resume does not. Never guess.")

agent = create_agent(
    ChatOllama(model="qwen2.5:7b", temperature=0),
    tools=[tool(tools.list_jobs), tool(tools.get_job), tool(tools.read_resume)],
    system_prompt=SYSTEM,
)

if __name__ == "__main__":
    result = agent.invoke(
        {"messages": [("user", "Which job suits my resume best, and which skills am I missing for it?")]},
        {"recursion_limit": 16},  # The same idea as MAX_STEPS in step 3.
    )
    for message in result["messages"]:
        if message.type == "ai" and message.tool_calls:
            print("TOOL CALL:", [c["name"] for c in message.tool_calls])
    print("\nANSWER:", result["messages"][-1].content)