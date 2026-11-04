"""Manzil AI: the career agent and the Resource Hub in one app.

Run: python main.py   then open http://127.0.0.1:8000

The agent is step9_web_ui.py and is used exactly as it is. This file only adds the site's routes in
front of it. Keep this to one server process with no --reload: the agent keeps chats in memory.
"""
import socket
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

import step9_web_ui
from manzil_site import pages, resource_hub

app = FastAPI(title="Manzil AI", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(resource_hub.router)
app.include_router(pages.router)
app.mount("/site", StaticFiles(directory=HERE / "manzil_site" / "static"))
app.mount("/", step9_web_ui.web)  # Keep last: the agent's app matches every path, like its own static files do.

if __name__ == "__main__":
    url = f"http://127.0.0.1:{step9_web_ui.PORT}"
    with socket.socket() as probe:
        already_running = probe.connect_ex(("127.0.0.1", step9_web_ui.PORT)) == 0
    if already_running:
        print(f"Manzil AI is already running at {url}")
        webbrowser.open(url)
        sys.exit()
    step9_web_ui.remove_old_sessions()
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, webbrowser.open, [url]).start()
    uvicorn.run(app, host=step9_web_ui.HOST, port=step9_web_ui.PORT)
