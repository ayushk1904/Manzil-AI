# Manzil AI

An AI career agent that runs on your own computer, with a Resource Hub for learning new skills. Upload your resume as a PDF and it gives you job advice, skill gaps, interview practice and cover letters based on your own experience.

The AI model runs locally through [Ollama](https://ollama.com), so the agent needs no paid AI service.

## Features

**The career agent**

- **Chat about your career:** answers stream in live and draw on your resume.
- **Guided job search in the chat:** upload your resume, say what role you want and where, and get real openings from company and startup career pages, with a link to apply on the company's own site.
- **Job Match:** paste any job post to compare it with your resume.
- **Application letters:** written from the parts of your resume that best fit the job. Edit and approve each one before it's saved.
- **Pay and contacts:** shown when the job post publishes them. Anything not published is marked as such, never guessed.
- **Private sessions:** each browser has its own resume and letters, and "Delete my data" removes them.

**The Resource Hub**

- **Learning search:** search a topic to get resources, videos and papers on one board, with filters.
- **Guide and About:** how the Hub works and what it's for.

## Run it

You need Python 3.12 or newer and [Ollama](https://ollama.com). A GPU with about 8 GB of memory is recommended. Without one the agent still works, but slowly.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS and Linux

pip install -r requirements.txt
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

Copy `.env.example` to a new file named `.env` and fill in your values. Git ignores this file, so don't publish it. Then start the app with one command:

```bash
python main.py
```

Your browser opens http://127.0.0.1:8000. On Windows you can also double-click `start.bat`.

The first Job Match check downloads a small model of about 270 MB.

## Environment variables

| Name | Needed for |
|---|---|
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `YOUTUBE_API_KEY` | Resource Hub search |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_COUNTRY` | Optional: more jobs |
| `CAREERPILOT_HOST`, `CAREERPILOT_PORT` | Optional: where the app runs |

The `CAREERPILOT_` names and the session cookie keep the agent's original name so that nothing about it had to change. Users never see them.

## Limits

- It reads PDFs with selectable text. Scanned PDFs need OCR first.
- Jobs come only from the companies in `companies.json`, and skill matching uses the list in `live_jobs.py`.
- AI answers can be wrong. Check every cover letter before you send it.
- A resume belongs to the browser it was uploaded in. There are no user accounts yet.

## Where the jobs come from

The agent reads the public job lists of the companies in `companies.json`, through [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api) and [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api). No API key is needed. The lists are downloaded every 6 hours, and matching happens on the server, so your resume is never sent to these services. Applying happens on the company's own site.

To add a company, find its careers page:

- A link like `boards.greenhouse.io/acme` or `job-boards.greenhouse.io/acme` means `"board": "greenhouse", "slug": "acme"`.
- A link like `jobs.lever.co/acme` means `"board": "lever", "slug": "acme"`.
- A link like `jobs.ashbyhq.com/acme` means `"board": "ashby", "slug": "acme"`.

Then add a line to `companies.json`:

```json
{"name": "Acme", "board": "greenhouse", "slug": "acme", "startup": true}
```

Leave out `"startup": true` if it isn't one. It only adds a Startup label to the job card.

### Optional: more jobs from Adzuna

The agent can also search [the Adzuna API](https://www.adzuna.in), which covers many more companies:

1. Register at [developer.adzuna.com](https://developer.adzuna.com) to get an app ID and key, and put them in `.env`.
2. Run `python live_jobs.py` to check that the key works and what it finds in your country.
3. Restart the app.

Only the role and place you choose are sent to Adzuna, never your resume. Searches are saved for 6 hours to stay within your key's limits, and without a key the app simply uses the companies above.

Before hosting the app for others, read [Adzuna's terms](https://developer.adzuna.com/docs/terms_of_service). Its free tier is meant for evaluating the API, and use that earns money needs a licence.

## Hosting it for other people

By default the server only accepts connections from your own computer. To host it, set `CAREERPILOT_HOST=0.0.0.0`, but first add the following, because resumes are personal data:

- **A server that can run Ollama**, ideally with a GPU. Most simple web hosts can't.
- **HTTPS**, using a reverse proxy such as Caddy or nginx.
- **Rate limits and an upload limit at the proxy.** The agent has no abuse protection of its own, and each chat uses your GPU.
- **A privacy policy.** Uploaded resumes are stored in plain files in `users/` until they are deleted, or for 30 days after a session's last visit.
- **One server process only.** Chats are kept in memory, so they are lost when the server restarts.

## How it's built

`main.py` starts the app. It adds the site's routes from `manzil_site/` in front of the agent's own FastAPI app, which it mounts without changing.

| Path | What it is |
|---|---|
| `main.py` | Starts everything |
| `manzil_site/` | Resource Hub search and its page |
| `step9_web_ui.py`, `web/` | The agent's web app |
| `step5_langgraph.py` | The agent's graph, with memory and human approval |
| `application_letter.py`, `resume_search.py`, `live_jobs.py`, `trained_models.py` | Letters, resume search, job search and the skills model |

The agent grew in steps, and these files are working lessons you can read and run. The web app doesn't use them:

| File | What it teaches |
|---|---|
| `tools.py`, `tool_call.py` | Tools and tool calling |
| `agent.py` | An agent is tool calling in a loop |
| `step4_langchain.py` | The same agent with LangChain |
| `step6_finetune.py`, `try_model.py` | Fine-tuning a small model with LoRA. Job Match uses the result. |
| `step7_test_agent.py` | A test paper for the agent |
| `step8_train_gpt.py` | Training a tiny GPT from scratch |

These lessons use the sample jobs in `jobs.json` and a `resume.txt` in the project folder, which isn't included. Create one from your own resume to run them. The questions in `step7_test_agent.py` were written for the author's resume, so change them to match yours.

## License

[MIT](LICENSE)
