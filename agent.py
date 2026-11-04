"""Step 3: An agent is tool calling inside a loop."""
import ollama

import tools

MODEL = "qwen2.5:7b"
MAX_STEPS = 8  # Safety limit, so the agent can never run forever.

# The ollama library builds each tool's menu entry from its name, type hints and docstring.
FUNCTIONS = {"list_jobs": tools.list_jobs, "get_job": tools.get_job, "read_resume": tools.read_resume}

SYSTEM = ("You are a career assistant. You can read the user's resume and the jobs with your "
          "tools, so never ask the user for them. Read the full details of a job before you "
          "judge it. If asked for the best job, choose exactly one. A skill is missing only "
          "if the job description names it and the resume does not. Never guess.")


def run_agent(question):
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]

    for step in range(1, MAX_STEPS + 1):
        reply = ollama.chat(model=MODEL, messages=messages, tools=list(FUNCTIONS.values()),
                            options={"temperature": 0}).message       # 1. The AI decides.
        messages.append(reply)

        if not reply.tool_calls:                                      # 2. No tool? It's finished.
            return reply.content

        for call in reply.tool_calls:                                 # 3. Run what it asked for.
            name = call.function.name
            result = FUNCTIONS[name](**call.function.arguments)
            print(f"Step {step}: {name}({call.function.arguments})")
            messages.append({"role": "tool", "tool_name": name, "content": result})  # 4. Give it back.

    return "Stopped: reached the step limit."


if __name__ == "__main__":
    print("\nANSWER:", run_agent("Which job suits my resume best, and which skills am I missing for it?"))