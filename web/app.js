"use strict";
// Manzil AI's browser side. It talks to the same API as before:
// /api/resume, /api/profile, /api/chat, /api/approve, /api/jobs, /api/scan,
// /api/applications, /api/delete-my-data, /api/health and /api/resources/search.

const $ = (id) => document.getElementById(id);

// A static server like Live Server only has files, so the page moves here to reach the app.
const BACKEND = "http://127.0.0.1:8000";
const VIEWS = ["chat", "match", "letters", "resources", "privacy"];
const JOBS_PER_PAGE = 6;
const RESUME_META_KEY = "manzil.resume";      // The PDF's file name, which the server doesn't keep.
const LOCAL_LETTERS_KEY = "manzil.letters";   // Letters for jobs the server can't save against.

const FOLLOW_UPS = [
  { label: "Which of these suits me best?", prompt: "Which of these jobs suits my resume best, and which skills am I missing for it?" },
  { label: "What should I learn first?", prompt: "Pick the job that suits my resume best, then tell me which 3 skills I should learn first for it and why." },
  { label: "Prepare me for an interview", prompt: "Pick the job that suits my resume best and give me 5 interview questions to prepare for, based on my resume and projects." },
];

const SAMPLE_POST = `Junior Frontend Developer at Kitekite Labs (Pune, hybrid)

Kitekite Labs builds simple tools that help schools run their labs and classrooms. We're a team of twelve and we ship every week.

What you'll do
- Build and polish features in our React web app, written in TypeScript
- Turn Figma designs into accessible, responsive pages with HTML, CSS and Tailwind CSS
- Connect the UI to our REST APIs and handle loading and error states well
- Write tests with Jest and review code with Git and GitHub

What we're looking for
- 0 to 2 years of experience with JavaScript, HTML and CSS
- Comfort with React, or a project that shows you can pick it up
- Bonus: Next.js, Node.js or experience with SQL

We offer mentoring from senior engineers, a learning budget and flexible hours.`;

const ICONS = { video: "video", resource: "book", paper: "paper" };
const TYPE_LABELS = { video: "Video", resource: "Reading", paper: "Research" };

/* ---------- State ---------- */

let online = false;
let dataLoaded = false;
let profile = { has_resume: false };
let inApp = false;
let currentView = "chat";
let landingStage = "upload";   // "upload", "reading" or "ready"
let returning = false;         // A resume was already saved before this visit.
let uploading = false;

// Chat
let threadId = newId();
let busy = false;
let waitingForAnswer = false;  // The chat is paused on a save question.
let activeReplies = null;
const seenJobs = new Map();    // Jobs shown in this visit, so Letters can save against them.

// Job Match
let scanning = false;

// Letters
let letter = { mode: "empty" };
let letterBusy = false;
let serverLetters = [];

// Resource Hub
let hubResults = [];
let hubFilter = "all";
let hubTopic = "";

/* ---------- Small helpers ---------- */

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}

function withIcon(node, name, before = true) {
  if (before) node.prepend(icon(name));
  else node.append(icon(name));
  return node;
}

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* The browser won't remember it, and that's fine. */ }
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// The model replies in Markdown. Escaping comes first, so nothing it writes can become real HTML.
function inlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^\s*][^*]*?)\*/g, "$1<em>$2</em>");
}

function renderMarkdown(source) {
  const html = [];
  let list = null;
  let paragraph = [];
  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const raw of escapeHtml(source).split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const number = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) {
      closeParagraph();
      closeList();
    } else if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 2, 5);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet || number) {
      closeParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) {
        closeList();
        html.push(`<${wanted}>`);
        list = wanted;
      }
      html.push(`<li>${inlineMarkdown((bullet || number)[1])}</li>`);
    } else {
      closeList();
      paragraph.push(inlineMarkdown(line));
    }
  }
  closeParagraph();
  closeList();
  return html.join("");
}

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function firstName() {
  const first = (profile.name || "").split(/\s+/)[0] || "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}

function resumeMeta() {
  return readStore(RESUME_META_KEY, null);
}

function resumeLabel() {
  const meta = resumeMeta();
  if (meta && meta.name) return meta.name;
  return profile.name ? `${profile.name}'s resume` : "your resume";
}

let toastTimer = null;
function toast(message, isError = false) {
  const box = $("toast");
  box.textContent = message;
  box.classList.toggle("is-error", isError);
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 6000 : 3500);
}

async function copyText(text, trigger) {
  try {
    await navigator.clipboard.writeText(text);
    if (trigger) {
      const label = trigger.lastChild;
      const before = label.textContent;
      label.textContent = "Copied";
      setTimeout(() => { label.textContent = before; }, 1500);
    } else {
      toast("Copied to your clipboard.");
    }
  } catch {
    toast("Couldn't copy. Select the text and copy it instead.", true);
  }
}

function downloadText(text, name) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = el("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${(name || "cover-letter").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "cover-letter"}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- Talking to the server ---------- */

async function readError(response) {
  const problem = await response.json().catch(() => ({}));
  if (typeof problem.detail === "string") return problem.detail;
  if (typeof problem.message === "string") return problem.message;
  return "Something went wrong. Please try again.";
}

// Each line of a streamed response is one JSON event, sent as soon as it happens.
async function streamEvents(url, body, onEvent) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response));
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (line && onEvent(JSON.parse(line)) === false) {
        reader.cancel();
        return;
      }
    }
  }
}

function friendlyError(error) {
  return error instanceof TypeError ? "I lost the connection. Please try again in a moment." : error.message;
}

/* ---------- Connection: the page finds the app by itself ---------- */

function showNotice(ok, message) {
  $("notice").hidden = ok || !message;
  $("notice").textContent = message;
}

function showServerState(isUp) {
  online = isUp;
  $("offline").hidden = isUp;
  if (!isUp) showNotice(true, "");
  refreshControls();
}

async function findBackend() {
  try {
    await fetch(`${BACKEND}/api/health`, { mode: "no-cors", cache: "no-store" });
    location.replace(BACKEND + location.hash);
  } catch {
    showServerState(false);
    setTimeout(findBackend, 2000);
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("no app here");
    const health = await response.json();
    showServerState(true);
    showNotice(health.ok, health.message);
    if (!dataLoaded) await loadData();
  } catch {
    if (!dataLoaded && location.origin !== BACKEND) {   // Opened from Live Server or as a file.
      findBackend();
      return;
    }
    showServerState(false);
  }
  setTimeout(checkHealth, online ? 15000 : 2000);
}

async function loadData() {
  const data = await fetch("/api/profile").then((r) => r.json());
  dataLoaded = true;
  returning = data.has_resume;
  applyProfile(data);
  if (landingStage !== "reading") setLandingStage(data.has_resume ? "ready" : "upload");
  loadServerLetters();
}

function applyProfile(data) {
  profile = data;
  if (!data.has_resume) writeStore(RESUME_META_KEY, null);
  renderResumeCard();
  renderChatHome();
  renderPrivacy();
  refreshControls();
}

/* ---------- Theme ---------- */

function isDark() {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* The choice just won't be remembered. */ }
  updateThemeButtons();
}

function updateThemeButtons() {
  const dark = isDark();
  $("landing-theme").textContent = dark ? "Light mode" : "Dark mode";
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  });
}

/* ---------- Landing ---------- */

function showLanding() {
  inApp = false;
  $("landing").hidden = false;
  $("app").hidden = true;
  closeResumeMenu();
  if (location.hash) history.replaceState(null, "", location.pathname);
  document.title = "Manzil AI";
}

function enterApp(view = "chat") {
  inApp = true;
  $("landing").hidden = true;
  $("app").hidden = false;
  showView(view);
}

function setLandingStage(stage) {
  landingStage = stage;
  const order = ["upload", "reading", "ready"];
  const at = order.indexOf(stage);
  document.querySelectorAll("#steps .step").forEach((node, i) => {
    node.classList.toggle("is-done", i < at || (i === at && stage !== "reading"));
    node.classList.toggle("is-active", i === at && stage === "reading");
  });

  $("stage-upload").hidden = stage === "ready";
  $("stage-ready").hidden = stage !== "ready";
  $("dropzone").classList.toggle("is-reading", stage === "reading");
  $("dropzone-title").textContent = stage === "reading" ? "Reading your resume…" : "Drop your PDF here";

  if (stage === "ready") {
    const meta = resumeMeta();
    const name = firstName();
    $("ready-title").textContent = returning ? (name ? `Welcome back, ${name}` : "Welcome back") : "You're all set";
    $("ready-file").textContent = meta && meta.name
      ? `${meta.name}${meta.size ? ` · ${formatSize(meta.size)}` : ""}`
      : "Your saved resume is ready.";
  }
  refreshControls();
}

/* ---------- Views ---------- */

function showView(name) {
  if (!VIEWS.includes(name)) name = "chat";
  currentView = name;
  VIEWS.forEach((view) => { $(`view-${view}`).hidden = view !== name; });
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === name;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $("privacy-open").classList.toggle("is-active", name === "privacy");
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  const titles = { chat: "Chat", match: "Job Match", letters: "Letters", resources: "Resource Hub", privacy: "Privacy" };
  document.title = `${titles[name]} · Manzil AI`;
  closeDrawer();
  closeResumeMenu();
  if (name === "letters") loadServerLetters();
  if (name === "privacy") { resetDeleteConfirm(); renderPrivacy(); }
  if (name === "chat" && !$("input").disabled) $("input").focus({ preventScroll: true });
}

function openDrawer() {
  $("sidebar").classList.add("open");
  $("scrim").hidden = false;
}

function closeDrawer() {
  $("sidebar").classList.remove("open");
  $("scrim").hidden = true;
}

/* ---------- Controls ---------- */

function chatLocked() {
  return busy || waitingForAnswer || !online || uploading || !profile.has_resume;
}

function placeholderText() {
  if (!profile.has_resume) return "Upload your resume to start chatting";
  if (waitingForAnswer) return "Choose Save or Not yet above to continue…";
  if (matchMedia("(max-width: 560px)").matches) return "Ask Manzil anything…";
  return "Ask about roles, interviews, or try “Find React jobs in Bengaluru”";
}

function refreshControls() {
  const locked = chatLocked();
  const input = $("input");
  input.disabled = locked;
  input.placeholder = placeholderText();
  $("send").disabled = locked || !input.value.trim();
  document.querySelectorAll(".job-ask, .quick-reply, .suggestion").forEach((b) => { b.disabled = locked; });

  const noResume = !profile.has_resume;
  $("scan-go").disabled = !online || noResume || scanning || !$("scan-input").value.trim();
  $("scan-go").textContent = scanning ? "Checking…" : "Check my fit";
  $("scan-needs-resume").hidden = !noResume || !dataLoaded;
  document.querySelectorAll(".match-ask").forEach((b) => { b.disabled = !online || noResume || busy || waitingForAnswer; });

  $("letter-write").disabled = !online || noResume || letterBusy;
  $("letter-write").textContent = letter.mode === "writing" ? "Writing…" : "Write my letter";
  document.querySelectorAll("#letter-actions button").forEach((b) => {
    if (b.dataset.needsServer) b.disabled = letterBusy || !online;
  });

  $("dropzone").disabled = !online || uploading;
  $("start").disabled = uploading;
  $("resume-toggle").disabled = uploading || (!online && !profile.has_resume);
  $("replace-resume").disabled = !online || uploading || busy || waitingForAnswer;
  $("chat-upload").disabled = !online || uploading;
  $("delete-data").disabled = !online || busy || letterBusy || uploading;
  $("delete-yes").disabled = !online;
}

/* ---------- The resume PDF ---------- */

function chooseFile() {
  if (!online || uploading) return;
  $("resume-file").click();
}

async function uploadResume(file) {
  if (!file || uploading || !online) return;
  $("landing-error").hidden = true;
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    uploadFailed("Please choose a PDF file.");
    return;
  }
  uploading = true;
  const before = landingStage;
  setLandingStage("reading");
  renderResumeCard(file.name);
  refreshControls();
  try {
    const response = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    writeStore(RESUME_META_KEY, { name: file.name, size: file.size });
    returning = false;
    uploading = false;
    applyProfile(data);
    newChat();                                  // A new chat, so the advice comes from the new resume.
    setLandingStage("ready");
    if (inApp) {
      showView("chat");
      toast("Got it. I'll use your new resume from now on.");
    }
  } catch (error) {
    uploading = false;
    setLandingStage(before === "reading" ? "upload" : before);
    uploadFailed(friendlyError(error));
  } finally {
    uploading = false;
    $("resume-file").value = "";
    renderResumeCard();
    refreshControls();
  }
}

function uploadFailed(message) {
  if (inApp) {
    toast(message, true);
    return;
  }
  setLandingStage("upload");
  $("landing-error").textContent = message;
  $("landing-error").hidden = false;
}

function renderResumeCard(readingName) {
  const card = $("resume-card");
  card.classList.toggle("is-reading", uploading);
  card.classList.toggle("is-empty", !uploading && !profile.has_resume);
  if (uploading) {
    $("resume-status").textContent = "Reading your resume…";
    $("resume-name").textContent = readingName || "";
  } else if (profile.has_resume) {
    $("resume-status").textContent = "Resume loaded";
    $("resume-name").textContent = resumeLabel();
  } else {
    $("resume-status").textContent = "No resume yet";
    $("resume-name").textContent = "Upload a PDF to start";
  }
  $("resume-toggle").title = profile.has_resume ? "View or replace your resume" : "Upload your resume";
}

function toggleResumeMenu() {
  if (!profile.has_resume) {
    chooseFile();
    return;
  }
  const menu = $("resume-menu");
  menu.hidden = !menu.hidden;
  $("resume-toggle").setAttribute("aria-expanded", String(!menu.hidden));
}

function closeResumeMenu() {
  $("resume-menu").hidden = true;
  $("resume-toggle").setAttribute("aria-expanded", "false");
}

function setUpDropping() {
  const box = $("dropzone");
  window.addEventListener("dragover", (e) => e.preventDefault());   // Otherwise the browser opens the file.
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("over");
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    const landingOpen = !inApp && landingStage === "upload";
    if (landingOpen || (inApp && !busy && !waitingForAnswer)) uploadResume(file);
  });
  box.addEventListener("dragenter", () => box.classList.add("over"));
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("click", chooseFile);
  $("resume-file").addEventListener("change", (e) => uploadResume(e.target.files[0]));
}

/* ---------- Chat: the home screen ---------- */

function topRoles() {
  const roles = profile.role_suggestions || [];
  return [roles[0] || "frontend developer", roles[1] || roles[0] || "data analyst"];
}

function suggestionPrompt(kind) {
  const [first, second] = topRoles();
  return {
    advice: "What roles suit my background best?",
    interview: `Give me a mock interview for a ${first} role.`,
    gaps: `What skills am I missing for a ${second} job?`,
    jobs: `Find ${first} jobs in ${cityGuess()}`,
  }[kind];
}

function renderChatHome() {
  const has = profile.has_resume;
  const [first, second] = topRoles();
  $("home-sub").textContent = has
    ? `I've read ${resumeLabel()}. Ask me anything about your next step.`
    : "Share your resume and I'll guide you with advice built on your real experience.";
  $("suggestions").hidden = !has;
  $("no-resume").hidden = has;
  $("quote-interview").textContent = `“Give me a mock interview for a ${first} role.”`;
  $("quote-gaps").textContent = `“What skills am I missing for a ${second} job?”`;
  $("quote-jobs").textContent = `“Find ${first} jobs in ${cityGuess()}”`;
  updateChatChrome();
}

function cityGuess() {
  return "Mumbai";        // Always Mumbai, whatever town the resume names.
}

function updateChatChrome() {
  const hasMessages = $("thread").childElementCount > 0;
  $("chat-home").hidden = hasMessages;
  $("chat-toolbar").hidden = !hasMessages;
}

function scrollDown() {
  const box = $("chat-scroll");
  box.scrollTop = box.scrollHeight;
}

/* ---------- Chat: messages ---------- */

function addUserMessage(text) {
  $("thread").append(el("div", "msg-user", text));
  updateChatChrome();
  scrollDown();
}

function addAgentRow() {
  const wrap = el("div", "msg-agent");
  const mark = el("div", "agent-mark");
  mark.append(el("span"));
  mark.setAttribute("aria-hidden", "true");
  const col = el("div", "agent-col");
  wrap.append(mark, col);
  $("thread").append(wrap);
  updateChatChrome();
  return col;
}

function addAgentMessage(text) {
  const col = addAgentRow();
  const answer = el("div", "answer");
  answer.innerHTML = renderMarkdown(text);
  col.append(answer);
  scrollDown();
  return col;
}

function makeDots() {
  const dots = el("div", "typing-dots");
  dots.setAttribute("aria-label", "Manzil is writing");
  dots.append(el("i"), el("i"), el("i"));
  return dots;
}

function addQuickReplies(col, replies) {
  clearQuickReplies();
  const box = el("div", "quick-replies");
  replies.forEach(({ label, onPick }) => box.append(button("quick-reply", label, onPick)));
  col.append(box);
  activeReplies = box;
  refreshControls();
  scrollDown();
}

function clearQuickReplies() {
  if (activeReplies) activeReplies.remove();
  activeReplies = null;
}

/* ---------- Chat: job openings the agent found ---------- */

function updatedAgo(seconds) {
  const hours = Math.floor((Date.now() / 1000 - seconds) / 3600);
  if (hours < 1) return "updated just now";
  return hours === 1 ? "updated 1 hour ago" : `updated ${hours} hours ago`;
}

function placeText(place) {
  if (!place) return " anywhere";
  return place.toLowerCase() === "remote" ? " (remote)" : ` in ${place}`;
}

async function fetchJobs(searchRole, place, count) {
  const query = new URLSearchParams({ role: searchRole, location: place, count });
  const response = await fetch(`/api/jobs?${query}`);
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  data.jobs.forEach((job) => seenJobs.set(job.id, job));
  return data;
}

// The agent's search_jobs tool sends one search per role and place. Each becomes its own group of cards.
function showSearches(turn, searches) {
  searches.forEach((search) => {
    search.jobs.forEach((job) => seenJobs.set(job.id, job));
    turn.col.append(resultsBlock(search));   // Below the summary, which streams in above them.
  });
  turn.hadJobs = true;
  refreshControls();
  scrollDown();
}

function resultsBlock(data) {
  const searchRole = data.role;
  const place = data.location;
  const results = el("section", "results");
  const head = el("header", "results-head");
  if (!data.jobs.length) {
    head.append(el("h3", "", `No ${searchRole} openings${placeText(place)} right now`));
    results.append(head);
    return results;
  }
  const count = data.total === 1 ? "1 opening" : `${data.total} openings`;
  head.append(el("h3", "", `${count} for ${searchRole}${placeText(place)}`));
  const from = data.jobs.some((job) => job.source) ? "company career pages and Adzuna" : "company career pages";
  const notes = [`Best matches first, from ${from}, ${updatedAgo(data.updated)}`];
  if (data.entry_level) notes.unshift("Entry-level roles");
  head.append(el("p", "", notes.join(" · ")));

  const list = el("ul", "job-list");
  data.jobs.forEach((job) => list.append(jobCard(job)));
  results.append(head, list);

  let shown = data.jobs.length;
  const shownIds = new Set(data.jobs.map((job) => job.id));
  if (shown < data.total) {
    const foot = el("div", "results-foot");
    const more = button("job-btn", `Show more${placeText(place)}`, async () => {
      more.textContent = "Loading…";
      more.disabled = true;
      try {
        const next = await fetchJobs(searchRole, place, shown + JOBS_PER_PAGE);
        next.jobs.filter((job) => !shownIds.has(job.id)).forEach((job) => {
          shownIds.add(job.id);
          list.append(jobCard(job));
        });
        shown = next.jobs.length;
        refreshControls();
        if (shown >= next.total) more.remove();
        else {
          more.textContent = `Show more${placeText(place)}`;
          more.disabled = false;
        }
      } catch {
        more.textContent = "Couldn't load more. Try again";
        more.disabled = false;
      }
    });
    foot.append(more);
    results.append(foot);
  }
  return results;
}

function detailRow(label, ...content) {
  const row = el("div", "job-detail");
  row.append(el("dt", "", label));
  const value = el("dd");
  value.append(...content);
  row.append(value);
  return row;
}

function outsideLink(text, href) {
  const link = el("a", "", text);
  link.href = href;
  if (href.startsWith("http")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  return link;
}

// Pay and contacts are only what the job post published. Nothing here is guessed.
function jobDetails(job) {
  const box = el("dl", "job-details");
  const isStipend = /\b(intern|internship|trainee|apprentice)\b/i.test(job.title);
  box.append(detailRow(isStipend ? "Stipend" : "Salary", job.pay || el("span", "job-unknown", "Not disclosed")));
  const contact = job.contact || { emails: [], phones: [] };
  const links = [
    ...contact.emails.map((email) => outsideLink(email, `mailto:${email}`)),
    ...contact.phones.map((phone) => outsideLink(phone, `tel:${phone.replace(/[\s-]/g, "")}`)),
  ];
  if (links.length) {
    box.append(detailRow("Contact", ...links.flatMap((link, i) => (i ? [" · ", link] : [link]))));
  } else {
    box.append(detailRow("Contact", el("span", "job-unknown", "Not published")));
  }
  return box;
}

function skillChip(name, have) {
  const chip = el("span", have ? "skill" : "skill gap");
  chip.append(icon(have ? "check" : "plus"), document.createTextNode(name));
  return chip;
}

function jobCard(job) {
  const card = el("li", "job-card");
  const logo = el("div", "job-logo", job.company[0].toUpperCase());
  logo.setAttribute("aria-hidden", "true");
  card.append(logo);

  const main = el("div", "job-main");
  const top = el("div");
  top.append(el("h4", "job-title", job.title));
  const meta = el("p", "job-meta");
  meta.append(el("b", "", job.company));
  if (job.startup) meta.append(el("span", "job-badge", "Startup"));
  if (job.location) meta.append(el("span", "", job.location));
  if (job.source) meta.append(outsideLink(job.source, job.source_url || "#"));
  if (meta.lastChild.tagName === "A") meta.lastChild.className = "job-source";
  top.append(meta);

  const chips = el("div", "skill-chips");
  job.have.slice(0, 6).forEach((skill) => chips.append(skillChip(skill, true)));
  job.missing.slice(0, 5).forEach((skill) => chips.append(skillChip(skill, false)));

  const about = button("job-btn", "", () => openJobBrief(job));
  about.append(icon("info"), el("span", "", "Description"));
  about.setAttribute("aria-label", `Read about ${job.title} at ${job.company} in plain words`);
  const fit = button("job-btn job-ask", "Check fit", () =>
    ask(`Am I a good fit for ${job.title} at ${job.company}? Tell me what matches my resume and which skills I'm missing.`));
  const letterBtn = button("job-btn job-ask", "Cover letter", () => openLetterForJob(job));
  const apply = outsideLink("Apply", job.url);
  apply.className = "job-btn job-apply";
  withIcon(apply, "external", false);
  fit.setAttribute("aria-label", `Check my fit for ${job.title} at ${job.company}`);
  letterBtn.setAttribute("aria-label", `Write a cover letter for ${job.title} at ${job.company}`);
  apply.setAttribute("aria-label", `Apply for ${job.title} on the ${job.company} website`);

  const actions = el("div", "job-actions");
  actions.append(about, fit, letterBtn, apply);

  main.append(top, jobDetails(job));
  if (job.have.length || job.missing.length) main.append(chips);
  main.append(actions);
  card.append(main);
  return card;
}

/* ---------- Job description: the post explained in plain words ---------- */

const briefs = new Map();      // job id -> Markdown, so reopening is instant.
let briefJob = null;

function factChip(label, value, muted) {
  const chip = el("span", `brief-fact${muted ? " is-muted" : ""}`);
  chip.append(el("small", "", label), el("b", "", value));
  return chip;
}

function openJobBrief(job) {
  briefJob = job;
  const dialog = $("brief-dialog");
  $("brief-logo").textContent = job.company[0].toUpperCase();
  $("brief-title").textContent = job.title;
  $("brief-company").textContent = [job.company, job.location].filter(Boolean).join(" · ");

  const isStipend = /\b(intern|internship|trainee|apprentice)\b/i.test(job.title);
  const facts = $("brief-facts");
  facts.replaceChildren(
    factChip(isStipend ? "Stipend" : "Salary", job.pay || "Not disclosed", !job.pay),
    factChip("Location", job.location || "Not given", !job.location),
    factChip("Your skills", job.have.length + job.missing.length ? `${job.have.length} of ${job.have.length + job.missing.length} match` : "Not listed", !(job.have.length + job.missing.length)),
  );
  if (job.startup) facts.append(factChip("Company", "Startup"));

  $("brief-apply").href = job.url;
  $("brief-post").href = job.url;
  if (!dialog.open) dialog.showModal();
  loadJobBrief(job);
}

async function loadJobBrief(job) {
  const body = $("brief-body");
  if (briefs.has(job.id)) {
    body.innerHTML = renderMarkdown(briefs.get(job.id));
    return;
  }
  body.replaceChildren();
  const loading = el("div", "brief-loading");
  loading.append(el("span", "line"), el("span", "line"), el("span", "line short"), el("p", "muted small", "Reading the job post for you…"));
  body.append(loading);
  try {
    const response = await fetch(`/api/jobs/${job.id}/brief`);
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    briefs.set(job.id, data.brief);
    if (briefJob && briefJob.id === job.id) body.innerHTML = renderMarkdown(data.brief);
  } catch (error) {
    if (!briefJob || briefJob.id !== job.id) return;
    body.replaceChildren(el("p", "answer error", friendlyError(error)));
    body.append(button("job-btn", "Try again", () => loadJobBrief(job)));
  }
}

function closeJobBrief() {
  briefJob = null;
  $("brief-dialog").close();
}

/* ---------- Chat: one answer from the agent ---------- */

function setBusy(value) {
  busy = value;
  refreshControls();
}

function startAgentTurn() {
  const col = addAgentRow();
  const dots = makeDots();
  const answer = el("div", "answer");
  answer.hidden = true;
  col.append(dots, answer);
  scrollDown();
  return { col, dots, answer, draft: "" };
}

function handleEvent(turn, data) {
  if (data.type === "token") {
    turn.dots.hidden = true;
    turn.draft += data.text;
    turn.answer.hidden = false;
    turn.answer.classList.add("typing");
    turn.answer.innerHTML = renderMarkdown(turn.draft);
    scrollDown();
  } else if (data.type === "reset") {
    turn.draft = "";
    turn.answer.hidden = true;
    turn.answer.classList.remove("typing");
    turn.dots.hidden = false;
  } else if (data.type === "jobs") {
    showSearches(turn, data.searches);
  } else if (data.type === "saved") {
    loadServerLetters();
  } else if (data.type === "approval") {
    turn.dots.hidden = true;
    turn.answer.hidden = true;
    showApproval(turn, data);
  } else if (data.type === "done") {
    turn.dots.hidden = true;
    showAnswer(turn, data.content);
  } else if (data.type === "error") {
    showError(turn, data.message);
  }
}

function showAnswer(turn, content) {
  turn.answer.hidden = false;
  turn.answer.classList.remove("typing");
  turn.answer.innerHTML = renderMarkdown(content);
  const tools = el("div", "msg-tools");
  const copy = button("tiny-btn", "", () => copyText(content, copy));
  copy.append(icon("copy"), el("span", "", "Copy"));
  tools.append(copy);
  turn.col.append(tools);
  if (turn.hadJobs) {
    addQuickReplies(turn.col, FOLLOW_UPS.map(({ label, prompt }) => ({ label, onPick: () => ask(prompt, label) })));
    const first = turn.col.querySelector(".results");
    turn.answer.scrollIntoView({ block: "start" });   // The summary, then the best matches right under it.
    if (!first) scrollDown();
  } else {
    scrollDown();
  }
}

function showError(turn, message) {
  turn.dots.hidden = true;
  turn.answer.hidden = false;
  turn.answer.classList.remove("typing");
  turn.answer.classList.add("error");
  turn.answer.textContent = message;
  scrollDown();
}

// The job asks for these, the resume lacks them, and the letter claims them.
function wireClaimWarning(editor, warning, unsupported) {
  const refresh = () => {
    const left = (unsupported || []).filter((skill) => editor.value.toLowerCase().includes(skill.toLowerCase()));
    warning.classList.toggle("flagged", left.length > 0);
    warning.textContent = left.length
      ? `Not on your resume: ${left.join(", ")}. Edit this claim before you save.`
      : "You can edit the letter here. Make sure every claim is true before you send it.";
  };
  refresh();
  editor.oninput = refresh;
}

// A letter asked for in the chat: nothing is saved until the user says yes.
function showApproval(turn, data) {
  waitingForAnswer = true;
  refreshControls();

  const card = el("section", "clearance");
  const header = el("header");
  header.append(el("p", "eyebrow", "Your cover letter"), el("h3", "", "Save this letter?"));
  const editor = el("textarea", "letter-editor");
  editor.value = data.cover_letter;
  editor.setAttribute("aria-label", "Cover letter. You can edit it before saving.");
  const warning = el("p", "letter-warning");
  wireClaimWarning(editor, warning, data.unsupported);

  const parts = [header, editor, warning];
  if (data.overwrites) parts.push(el("p", "letter-note", "This replaces the letter you saved for this job."));

  const actions = el("div", "clearance-actions");
  const decide = (answer) => {
    const edited = editor.value.trim();
    editor.readOnly = true;
    actions.remove();
    waitingForAnswer = false;
    const body = { thread_id: threadId, answer };
    if (answer === "yes" && edited && edited !== data.cover_letter) body.cover_letter = edited;
    send("/api/approve", body);
  };
  const save = button("primary-btn", "Yes, save it", () => decide("yes"));
  const skip = button("secondary-btn", "Not yet", () => decide("no"));
  actions.append(save, skip);

  card.append(...parts, actions);
  turn.col.append(card);
  editor.style.height = `${Math.min(editor.scrollHeight + 4, 360)}px`;
  scrollDown();
  save.focus({ preventScroll: true });
}

async function send(url, body) {
  setBusy(true);
  const turn = startAgentTurn();
  const thread = threadId;
  try {
    await streamEvents(url, body, (data) => {
      if (thread !== threadId) return false;   // "New chat" was pressed.
      handleEvent(turn, data);
      return true;
    });
  } catch (error) {
    if (thread === threadId) showError(turn, friendlyError(error));
  } finally {
    if (thread === threadId) setBusy(false);
    if (thread === threadId && !waitingForAnswer && currentView === "chat") $("input").focus({ preventScroll: true });
  }
}

// `shown` is what appears in the chat, when a button asks a longer question behind the scenes.
function ask(text, shown) {
  if (chatLocked() || !text.trim()) return;
  clearQuickReplies();
  showView("chat");
  addUserMessage((shown || text).trim());
  send("/api/chat", { thread_id: threadId, message: text.trim() });
}

function submitComposer() {
  const text = $("input").value.trim();
  if (!text || chatLocked()) return;
  $("input").value = "";
  resizeInput();
  ask(text);           // Everything goes to the agent, which decides what to do, searching included.
}

function newChat() {
  threadId = newId();
  waitingForAnswer = false;
  activeReplies = null;
  setBusy(false);
  $("thread").replaceChildren();
  updateChatChrome();
  renderChatHome();
}

function resizeInput() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  input.style.overflowY = input.scrollHeight > 180 ? "auto" : "hidden";
  refreshControls();
}

/* ---------- Job Match ---------- */

function setRing(percent, label) {
  const circumference = 2 * Math.PI * 52;
  const fill = $("ring-fill");
  fill.style.strokeDasharray = `${circumference}`;
  fill.style.strokeDashoffset = `${circumference * (1 - (percent ?? 0) / 100)}`;
  fill.style.stroke = percent === null ? "" : percent >= 60 ? "var(--teal)" : percent >= 35 ? "var(--orange)" : "var(--red)";
  $("ring-value").textContent = label;
}

function resetScan() {
  $("ring").classList.remove("is-loading");
  $("scan-result").classList.remove("has-result");
  setRing(null, "–");
  $("ring-caption").textContent = "Your match score will appear here.";
  $("match-details").hidden = true;
  $("match-details").replaceChildren();
}

async function runScan() {
  const post = $("scan-input").value.trim();
  if (!post || !online || !profile.has_resume || scanning) return;
  scanning = true;
  refreshControls();
  resetScan();
  $("ring").classList.add("is-loading");
  setRing(null, "");
  $("ring-caption").textContent = "Reading the job post…";
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post }),
    });
    if (!response.ok) throw new Error(await readError(response));
    renderScan(await response.json(), post);
  } catch (error) {
    resetScan();
    $("ring-caption").textContent = friendlyError(error);
  } finally {
    scanning = false;
    $("ring").classList.remove("is-loading");
    refreshControls();
  }
}

function renderScan(data, post) {
  const have = data.skills.filter((s) => s.on_resume);
  const missing = data.skills.filter((s) => !s.on_resume);
  const total = data.skills.length;
  const details = $("match-details");
  details.replaceChildren();
  $("scan-result").classList.add("has-result");

  if (total) {
    const percent = Math.round((have.length / total) * 100);
    setRing(percent, `${percent}%`);
    $("ring-caption").textContent = percent >= 60 ? "A strong match" : percent >= 35 ? "A partial match" : "A stretch for now";
  } else {
    setRing(null, "–");
    $("ring-caption").textContent = "No clear skills listed";
  }

  if (total) {
    details.append(el("p", "match-fact", `You already bring ${have.length} of the ${total} skills this post names.`));
  } else {
    details.append(el("p", "match-fact", "I couldn't pick out specific skills from this post. Ask me about it in the chat instead."));
  }
  if (data.years !== null && data.years !== undefined) {
    details.append(el("p", "match-fact", `It asks for ${data.years} ${data.years === 1 ? "year" : "years"} of experience.`));
  }
  const group = (title, skills, isHave) => {
    if (!skills.length) return;
    const box = el("div", "match-group");
    box.append(el("h3", "", title));
    const chips = el("div", "skill-chips");
    skills.forEach((s) => chips.append(skillChip(s.name, isHave)));
    box.append(chips);
    details.append(box);
  };
  group("What you already bring", have, true);
  group("What to build next", missing, false);

  const actions = el("div", "match-actions");
  actions.append(
    button("primary-btn wide match-ask", "Ask if it's right for me", () =>
      ask(`Here is a job post:\n\n${post}\n\nIs this job right for me, based on my resume? Tell me what matches and what I'm missing.`,
        "Is this job post right for me?")),
    button("secondary-btn match-ask", "Write a cover letter for it", () => openLetterForPost(post)),
  );
  details.append(actions);
  details.hidden = false;
  refreshControls();
}

function updateScanCount() {
  $("scan-count").textContent = `${$("scan-input").value.length} / 2000`;
  refreshControls();
}

/* ---------- Letters ---------- */

function localLetters() {
  return readStore(LOCAL_LETTERS_KEY, []);
}

async function loadServerLetters() {
  try {
    const response = await fetch("/api/applications");
    serverLetters = response.ok ? await response.json() : [];
  } catch {
    serverLetters = [];
  }
  renderSavedLetters();
  renderPrivacy();
}

function allSavedLetters() {
  const server = serverLetters.map(({ id, label }) => ({ key: `s${id}`, id, label, source: "server" }));
  const local = localLetters().map((item) => ({ ...item, key: item.id, source: "local" }));
  return [...server, ...local];
}

function renderSavedLetters() {
  const query = $("saved-search").value.trim().toLowerCase();
  const all = allSavedLetters();
  const shown = all.filter((item) => item.label.toLowerCase().includes(query));
  const list = $("saved-list");
  list.replaceChildren();
  shown.forEach((item) => {
    const row = el("li");
    const open = button(`saved-item${letter.mode === "saved" && letter.key === item.key ? " is-active" : ""}`, "", () => openSaved(item));
    const text = el("span");
    text.append(el("b", "", item.label), el("small", "", item.source === "local" ? "Saved in this browser" : "Saved"));
    open.append(icon("file"), text);
    row.append(open);
    list.append(row);
  });
  $("saved-empty").hidden = shown.length > 0;
  $("saved-empty").textContent = all.length ? `No letters match “${$("saved-search").value.trim()}”.` : "Approved letters will live here.";
}

async function openSaved(item) {
  if (letterBusy) return;
  if (letter.mode === "server-draft") rejectServerDraft();
  let text = item.text;
  if (item.source === "server") {
    try {
      const response = await fetch(`/api/applications/${item.id}`);
      if (!response.ok) throw new Error(await readError(response));
      text = await response.text();
    } catch (error) {
      toast(friendlyError(error), true);
      return;
    }
  }
  setLetter({ mode: "saved", key: item.key, label: item.label, text, source: item.source, id: item.id });
}

function setLetter(next) {
  letter = { mode: "empty", ...next };
  renderLetter();
  renderSavedLetters();
}

function letterError(message) {
  $("letter-error").textContent = message;
  $("letter-error").hidden = !message;
}

function renderLetter() {
  const mode = letter.mode;
  $("letter-empty").hidden = mode !== "empty";
  $("letter-writing").hidden = mode !== "writing";
  $("letter-draft").hidden = !["server-draft", "local-draft", "saved"].includes(mode);
  refreshControls();
  if ($("letter-draft").hidden) return;

  const label = $("letter-label");
  label.replaceChildren(document.createTextNode(letter.label || "Cover letter"));
  if (mode === "saved") label.append(el("span", "badge", "Saved"));

  const editor = $("letter-editor");
  editor.value = letter.text || "";
  editor.readOnly = mode === "saved";
  const warning = $("letter-warning");
  if (mode === "saved") {
    editor.oninput = null;
    warning.classList.remove("flagged");
    warning.textContent = "";
    warning.hidden = true;
  } else {
    warning.hidden = false;
    wireClaimWarning(editor, warning, letter.unsupported);
  }

  const actions = $("letter-actions");
  actions.replaceChildren();
  if (letter.overwrites && mode === "server-draft") actions.append(el("p", "letter-note", "This replaces the letter you saved for this job."));
  const copy = button("secondary-btn", "", () => copyText(editor.value, copy));
  copy.append(icon("copy"), el("span", "", "Copy"));
  const download = button("secondary-btn", "", () => downloadText(editor.value, letter.label));
  download.append(icon("download"), el("span", "", "Download"));
  download.setAttribute("aria-label", "Download as a text file");

  if (mode === "saved") {
    const close = button("secondary-btn", "Close", () => setLetter({ mode: "empty" }));
    actions.append(copy, download, el("span", "spacer"));
    if (letter.source === "local") {
      const remove = button("secondary-btn", "", () => deleteLocalLetter(letter.key));
      remove.append(icon("trash"), el("span", "", "Delete"));
      actions.append(remove);
    }
    actions.append(close);
  } else {
    const approve = button("primary-btn", "", approveLetter);
    approve.append(icon("check"), el("span", "", "Approve & save"));
    const reject = button("secondary-btn", "Reject", rejectLetter);
    if (mode === "server-draft") { approve.dataset.needsServer = "1"; reject.dataset.needsServer = "1"; }
    actions.append(approve, reject, el("span", "spacer"), copy, download);
  }
  refreshControls();
}

function matchingSeenJob(company, roleName) {
  const c = company.toLowerCase();
  const r = roleName.toLowerCase();
  for (const job of seenJobs.values()) {
    if (job.company.toLowerCase() === c && job.title.toLowerCase() === r) return job;
  }
  return null;
}

function openLetterForJob(job) {
  showView("letters");
  $("letter-company").value = job.company;
  $("letter-role").value = job.title;
  $("letter-details").value = "";
  $("letter-post-box").open = false;
  writeLetter();
}

function openLetterForPost(post) {
  showView("letters");
  $("letter-company").value = "";
  $("letter-role").value = "";
  $("letter-details").value = post.slice(0, 1800);
  $("letter-post-box").open = true;
  writeLetter();
}

async function writeLetter() {
  if (letterBusy || !online || !profile.has_resume) return;
  letterError("");
  const company = $("letter-company").value.trim();
  const roleName = $("letter-role").value.trim();
  const details = $("letter-details").value.trim();
  if (!(company && roleName) && !details) {
    letterError("Add the company and role, or paste the job post.");
    return;
  }
  if (letter.mode === "server-draft") rejectServerDraft();

  // A job from a search can be saved by the server. Anything else is written from what the user typed.
  const job = company && roleName ? matchingSeenJob(company, roleName) : null;
  const facts = [roleName && `Position: ${roleName}`, company && `Company: ${company}`, details].filter(Boolean).join("\n");
  const message = job
    ? `Write a short cover letter for ${job.title} at ${job.company}.`
    : `Here is a job post:\n\n${facts}\n\nWrite a short cover letter for this job, based on my resume.`;
  const label = job ? `${job.title} at ${job.company}` : roleName && company ? `${roleName} at ${company}` : roleName || company || "Cover letter for a job post";

  const tid = newId();
  letterBusy = true;
  setLetter({ mode: "writing", threadId: tid, label });
  let finished = false;
  try {
    await streamEvents("/api/chat", { thread_id: tid, message }, (data) => {
      if (letter.threadId !== tid) return false;
      if (data.type === "approval") {
        finished = true;
        setLetter({ mode: "server-draft", threadId: tid, label, original: data.cover_letter, text: data.cover_letter,
          unsupported: data.unsupported || [], overwrites: data.overwrites });
      } else if (data.type === "done") {
        finished = true;
        setLetter({ mode: "local-draft", label, original: data.content, text: data.content });
      } else if (data.type === "error") {
        finished = true;
        setLetter({ mode: "empty" });
        letterError(data.message);
      }
      return true;
    });
    if (!finished && letter.threadId === tid) {
      setLetter({ mode: "empty" });
      letterError("I couldn't write that letter. Please try again.");
    }
  } catch (error) {
    if (letter.threadId === tid) {
      setLetter({ mode: "empty" });
      letterError(friendlyError(error));
    }
  } finally {
    letterBusy = false;
    refreshControls();
  }
}

async function approveLetter() {
  const text = $("letter-editor").value.trim();
  if (!text || letterBusy) return;
  if (letter.mode === "local-draft") {
    const item = { id: `local-${Date.now()}`, label: letter.label, text, savedAt: Date.now() };
    writeStore(LOCAL_LETTERS_KEY, [item, ...localLetters()]);
    setLetter({ mode: "saved", key: item.id, label: item.label, text, source: "local" });
    toast("Saved in this browser.");
    renderPrivacy();
    return;
  }
  if (letter.mode !== "server-draft") return;

  const body = { thread_id: letter.threadId, answer: "yes" };
  if (text !== letter.original.trim()) body.cover_letter = text;
  const label = letter.label;
  letterBusy = true;
  refreshControls();
  let saved = false;
  let problem = "";
  try {
    await streamEvents("/api/approve", body, (data) => {
      if (data.type === "saved") saved = true;
      if (data.type === "error") problem = data.message;
      return true;
    });
  } catch (error) {
    problem = friendlyError(error);
  } finally {
    letterBusy = false;
  }
  if (saved) {
    await loadServerLetters();
    const match = serverLetters.find((item) => item.label === label);
    setLetter({ mode: "saved", key: match ? `s${match.id}` : "", label, text, source: "server", id: match && match.id });
    toast("Letter saved.");
  } else {
    // The save question has been answered, so keep the text as a draft the browser can save.
    setLetter({ ...letter, mode: "local-draft", text, original: text, threadId: null, overwrites: false });
    toast(problem || "I couldn't save that letter. Please try again.", true);
  }
}

function rejectServerDraft() {
  // Tell the agent "no", so that chat isn't left waiting. Nothing is saved.
  const tid = letter.threadId;
  if (!tid) return;
  streamEvents("/api/approve", { thread_id: tid, answer: "no" }, () => true).catch(() => {});
}

function rejectLetter() {
  if (letterBusy) return;
  if (letter.mode === "server-draft") rejectServerDraft();
  setLetter({ mode: "empty" });
  $("letter-company").focus();
}

function deleteLocalLetter(key) {
  writeStore(LOCAL_LETTERS_KEY, localLetters().filter((item) => item.id !== key));
  setLetter({ mode: "empty" });
  renderPrivacy();
  toast("Letter deleted.");
}

/* ---------- Resource Hub ---------- */

// Search results come from outside, so only real web links become clickable.
function webLink(url) {
  return /^https?:\/\//i.test(url || "") ? url : "";
}

function hubCard(item) {
  const card = el("li", "hub-card");
  const link = webLink(item.url);
  if (item.type === "video" && webLink(item.thumbnail)) {
    const thumb = el("a", "hub-thumb");
    if (link) { thumb.href = link; thumb.target = "_blank"; thumb.rel = "noopener noreferrer"; }
    const img = el("img");
    img.src = item.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
    thumb.setAttribute("aria-hidden", "true");
    thumb.tabIndex = -1;
    card.append(thumb);
  }
  const body = el("div", "hub-body");
  const type = el("span", "hub-type", TYPE_LABELS[item.type] || "Reading");
  type.prepend(icon(ICONS[item.type] || "book"));
  const title = el("h3");
  if (link) {
    const a = outsideLink(item.title, link);
    title.append(a);
  } else {
    title.textContent = item.title;
  }
  const source = item.type === "video" ? item.channelTitle || "YouTube" : item.source || "Web";
  body.append(type, title, el("p", "hub-source", source), el("p", "hub-snippet", item.snippet || ""));
  if (link) {
    const open = outsideLink(item.type === "video" ? "Watch" : "Open", link);
    open.className = "job-btn hub-open";
    withIcon(open, "external", false);
    body.append(open);
  }
  card.append(body);
  return card;
}

function renderHub() {
  const shown = hubResults.filter((item) => hubFilter === "all" || item.type === hubFilter);
  $("hub-grid").replaceChildren(...shown.map(hubCard));
  const counts = { all: hubResults.length };
  hubResults.forEach((item) => { counts[item.type] = (counts[item.type] || 0) + 1; });
  document.querySelectorAll("[data-filter]").forEach((tab) => {
    const name = { all: "All", video: "Videos", resource: "Reading", paper: "Research" }[tab.dataset.filter];
    tab.replaceChildren(document.createTextNode(name), el("span", "count", String(counts[tab.dataset.filter] || 0)));
  });
  const label = hubFilter === "all" ? "results" : `${TYPE_LABELS[hubFilter].toLowerCase()} results`;
  $("hub-none").textContent = `No ${label} for “${hubTopic}”.`;
  $("hub-none").hidden = shown.length > 0;
  $("hub-grid").hidden = shown.length === 0;
}

function hubFeedback(text, isError = false) {
  $("hub-feedback").textContent = text;
  $("hub-feedback").classList.toggle("is-error", isError);
}

async function runHubSearch(topic) {
  const wanted = topic.trim();
  if (!wanted) {
    hubFeedback("Type a topic to search.", true);
    return;
  }
  hubFeedback("Searching…");
  $("hub-go").disabled = true;
  try {
    const response = await fetch(`/api/resources/search?topic=${encodeURIComponent(wanted)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Search failed. Please try again.");
    hubResults = [...(data.resources || []), ...(data.videos || []), ...(data.papers || [])];
    hubTopic = data.topic;
    $("hub-heading").textContent = `Your board for “${data.topic}”`;
    $("hub-results").hidden = false;
    $("hub-empty").hidden = true;
    // A provider failing means saved links fill its place, so say these aren't all live results.
    hubFeedback(data.providerWarnings && data.providerWarnings.length ? "Some live searches were unavailable, so a few of these are saved links." : "");
    renderHub();
  } catch (error) {
    hubFeedback(friendlyError(error), true);
  } finally {
    $("hub-go").disabled = false;
  }
}

/* ---------- Privacy ---------- */

function renderPrivacy() {
  $("keep-resume").textContent = profile.has_resume ? resumeLabel() : "None";
  $("keep-letters").textContent = String(serverLetters.length + localLetters().length);
}

function resetDeleteConfirm() {
  $("delete-zone").hidden = false;
  $("delete-confirm").hidden = true;
}

async function deleteMyData() {
  $("delete-yes").disabled = true;
  const response = await fetch("/api/delete-my-data", { method: "POST" }).catch(() => null);
  if (!response || !response.ok) {
    $("delete-yes").disabled = false;
    toast("I couldn't delete your data. Please try again.", true);
    return;
  }
  writeStore(RESUME_META_KEY, null);
  writeStore(LOCAL_LETTERS_KEY, null);
  seenJobs.clear();
  serverLetters = [];
  setLetter({ mode: "empty" });
  newChat();
  resetScan();
  $("scan-input").value = "";
  updateScanCount();
  returning = false;
  await loadData();
  resetDeleteConfirm();
  setLandingStage("upload");
  showLanding();
  toast("Your data has been deleted.");
}

/* ---------- Start ---------- */

function start() {
  updateThemeButtons();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeButtons);
  $("landing-theme").addEventListener("click", toggleTheme);
  $("theme-toggle").addEventListener("click", toggleTheme);
  $("theme-toggle-mobile").addEventListener("click", toggleTheme);

  // Landing
  $("skip").addEventListener("click", () => enterApp("chat"));
  $("start").addEventListener("click", () => enterApp("chat"));
  $("different-resume").addEventListener("click", () => {
    setLandingStage("upload");
    chooseFile();
  });
  setUpDropping();

  // Shell
  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => showView(item.dataset.go)));
  $("privacy-open").addEventListener("click", () => showView("privacy"));
  $("open-menu").addEventListener("click", openDrawer);
  $("close-menu").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  $("resume-toggle").addEventListener("click", toggleResumeMenu);
  $("replace-resume").addEventListener("click", () => { closeResumeMenu(); chooseFile(); });
  document.addEventListener("click", (e) => {
    if (!$("resume-card").contains(e.target)) closeResumeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDrawer(); closeResumeMenu(); }
  });
  document.querySelectorAll("a.brand").forEach((link) => link.addEventListener("click", (e) => {
    e.preventDefault();
    showLanding();
  }));
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (VIEWS.includes(view) && (!inApp || view !== currentView)) enterApp(view);
  });

  // Chat
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); submitComposer(); });
  $("input").addEventListener("input", resizeInput);
  matchMedia("(max-width: 560px)").addEventListener("change", refreshControls);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitComposer();
    }
  });
  $("new-chat").addEventListener("click", newChat);
  $("chat-upload").addEventListener("click", chooseFile);
  document.querySelectorAll(".suggestion").forEach((card) => card.addEventListener("click", () => {
    ask(suggestionPrompt(card.dataset.suggestion));
  }));

  // Job description
  $("brief-close").addEventListener("click", closeJobBrief);
  $("brief-dialog").addEventListener("close", () => { briefJob = null; });
  $("brief-dialog").addEventListener("click", (e) => { if (e.target === $("brief-dialog")) closeJobBrief(); });
  $("brief-letter").addEventListener("click", () => {
    const job = briefJob;
    closeJobBrief();
    if (job) openLetterForJob(job);
  });

  // Job Match
  $("scan-form").addEventListener("submit", (e) => { e.preventDefault(); runScan(); });
  $("scan-input").addEventListener("input", updateScanCount);
  $("sample-post").addEventListener("click", () => {
    $("scan-input").value = SAMPLE_POST;
    updateScanCount();
    $("scan-input").focus();
  });

  // Letters
  $("letter-form").addEventListener("submit", (e) => { e.preventDefault(); writeLetter(); });
  $("saved-search").addEventListener("input", renderSavedLetters);

  // Resource Hub
  $("hub-form").addEventListener("submit", (e) => { e.preventDefault(); runHubSearch($("hub-input").value); });
  document.querySelectorAll("[data-topic]").forEach((chip) => chip.addEventListener("click", () => {
    $("hub-input").value = chip.dataset.topic;
    runHubSearch(chip.dataset.topic);
  }));
  document.querySelectorAll("[data-filter]").forEach((tab) => tab.addEventListener("click", () => {
    hubFilter = tab.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((other) => {
      const active = other === tab;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-pressed", String(active));
    });
    renderHub();
  }));

  // Privacy
  $("delete-data").addEventListener("click", () => {
    $("delete-zone").hidden = true;
    $("delete-confirm").hidden = false;
    $("delete-cancel").focus();
  });
  $("delete-cancel").addEventListener("click", resetDeleteConfirm);
  $("delete-yes").addEventListener("click", deleteMyData);

  // First screen: a link to a section opens the app there, anything else starts at the landing page.
  const initial = location.hash.slice(1);
  if (VIEWS.includes(initial)) enterApp(initial);
  else showLanding();
  setLandingStage("upload");
  renderResumeCard();
  renderChatHome();
  renderLetter();
  renderSavedLetters();
  renderPrivacy();
  resetScan();
  refreshControls();
  checkHealth();
}

start();
