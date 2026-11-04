"""Step 2: The AI asks for a tool. Your code runs it."""
import ollama

import tools

MODEL = "qwen2.5:7b"

# The menu: this is how the AI learns that the tool exists.
JOB_TOOL = {
    "type": "function",
    "function": {
        "name": "get_job",
        "description": "Get the full details of one job using its id.",
        "parameters": {
            "type": "object",
            "properties": {"job_id": {"type": "integer", "description": "The job's id"}},
            "required": ["job_id"],
        },
    },
}

messages = [{"role": "user", "content": "What skills does job 1 ask for?"}]

# 1. The AI replies with a request. It does not run anything.
reply = ollama.chat(model=MODEL, messages=messages, tools=[JOB_TOOL]).message
messages.append(reply)
print("AI ASKED FOR:", reply.tool_calls)

# 2. Your code runs the tool.
for call in reply.tool_calls:
    result = tools.get_job(**call.function.arguments)
    print("TOOL RETURNED:", result)
    messages.append({"role": "tool", "tool_name": call.function.name, "content": result})

# 3. The AI uses the result to answer.
answer = ollama.chat(model=MODEL, messages=messages, tools=[JOB_TOOL]).message
print("FINAL ANSWER:", answer.content)