"""Step 7: A test paper for your agent. Run it after every change."""
from step4_langchain import agent

# Each test: the question, a tool it must use, and a word the answer must contain.
TESTS = [
    ("How many jobs are listed?", "list_jobs", "3"),
    ("Which company posted the Frontend Developer job?", "list_jobs", "Sample Tech"),
    ("Besides TypeScript, which two technologies does job 2 name?", "get_job", "React"),
    ("Which job needs PyTorch? Give its title.", "get_job", "Machine Learning"),
    ("What does job 1 say is required?", "get_job", "vector"),
    ("Is there a job with id 99? Answer yes or no.", "get_job", "no"),
    ("Which university or college is on my resume?", "read_resume", "Vishwaniketan"),
    ("Does my resume mention ChromaDB? Answer yes or no.", "read_resume", "yes"),
    ("Which job suits my resume best? Give its title.", "read_resume", "AI Engineer"),
    ("Does my resume mention Docker? Answer yes or no.", "read_resume", "no"),
]

passed = 0
for question, needed_tool, needed_word in TESTS:
    messages = agent.invoke({"messages": [("user", question)]}, {"recursion_limit": 16})["messages"]
    used = {c["name"] for m in messages if m.type == "ai" for c in m.tool_calls}
    answer = messages[-1].content

    tool_ok = needed_tool in used                        # Did it check the facts?
    answer_ok = needed_word.lower() in answer.lower()    # Is the answer right?
    passed += tool_ok and answer_ok
    print(f"{'PASS' if tool_ok and answer_ok else 'FAIL'}  {question}")
    if not (tool_ok and answer_ok):
        print(f"      tools used: {sorted(used)}\n      answer: {answer[:150]}")

print(f"\nSCORE: {passed} out of {len(TESTS)}")