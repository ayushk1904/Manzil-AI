const $ = (id) => document.getElementById(id);

// A static server like Live Server only has files, so the page moves here to reach the app.
const BACKEND = "http://127.0.0.1:8000";

const LOCATIONS = [
  { label: "Bangalore", value: "Bangalore" },
  { label: "Mumbai", value: "Mumbai" },
  { label: "Pune", value: "Pune" },
  { label: "Hyderabad", value: "Hyderabad" },
  { label: "Delhi NCR", value: "Delhi NCR" },
  { label: "Chennai", value: "Chennai" },
  { label: "Remote", value: "Remote" },
  { label: "Anywhere", value: "" },
];

const FOLLOW_UPS = [
  { label: "Which of these suits me best?", prompt: "Which of these jobs suits my resume best, and which skills am I missing for it?" },
  { label: "What should I learn first?", prompt: "Pick the job that suits my resume best, then tell me which 3 skills I should learn first for it and why." },
  { label: "Prepare me for an interview", prompt: "Pick the job that suits my resume best and give me 5 interview questions to prepare for, based on my resume and projects." },
];

const JOBS_PER_PAGE = 6;

let threadId = crypto.randomUUID();
let profile = { has_resume: false };
let hasResume = false;
let started = false;            // Every visit begins at the upload screen, even with a saved resume.
let busy = false;
let uploading = false;
let waitingForAnswer = false;   // The app is paused on a save question.
let online = false;
let dataLoaded = false;
let step = "chat";              // What the composer is answering: "role", "location" or "chat".
let role = "";
let activeReplies = null;       // Quick replies disappear once one question is answered.

/* ---------- Small helpers ---------- */

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
  svg.append(use);
  return svg;
}

function scrollDown() {
  const chat = $("chat");
  chat.scrollTop = chat.scrollHeight;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

/* ---------- Talking to the server ---------- */

async function readError(response) {
  const problem = await response.json().catch(() => ({}));
  if (typeof problem.detail === "string") return problem.detail;
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
  $("notice").hidden = ok;
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
    location.replace(BACKEND);
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
  renderProfile(data);
  loadLetters();
}

function startConversation() {
  started = true;
  renderProfile(profile);
  newChat();
  loadLetters();
  showTab("chat");
}

/* ---------- Busy state ---------- */

function setBusy(value) {
  busy = value;
  refreshControls();
}

function placeholderText() {
  if (!started) return "Upload your resume to get started";
  if (waitingForAnswer) return "Choose Yes or Not yet above to continue…";
  if (step === "role") return "Type a role or domain, like Frontend Developer";
  if (step === "location") return "Or type a city or country";
  return "Ask about these jobs…";
}

function refreshControls() {
  const locked = busy || waitingForAnswer || !online || uploading || !started;
  const input = $("input");
  input.disabled = locked;
  input.placeholder = placeholderText();
  $("send").disabled = locked || !input.value.trim();
  document.querySelectorAll(".job-ask, .quick-reply, .match-ask, .search-again").forEach((b) => { b.disabled = locked; });
  $("scan-go").disabled = !online || !started;
  $("continue-resume").disabled = !online || uploading;
  $("replace-resume").disabled = !online || uploading || busy || waitingForAnswer;
  $("dropzone").disabled = !online || uploading;
}

/* ---------- Messages in the chat ---------- */

function addUserMessage(text) {
  $("thread").append(el("div", "msg-user", text));
  scrollDown();
}

function addAgentRow() {
  const wrap = el("div", "msg-agent");
  const mark = el("div", "agent-mark");
  mark.append(icon("plane"));
  const col = el("div", "agent-col");
  wrap.append(mark, col);
  $("thread").append(wrap);
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
  dots.setAttribute("aria-label", "CareerPilot is writing");
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

/* ---------- The guided search: resume, then role, then location, then jobs ---------- */

function firstName() {
  const first = (profile.name || "").split(/\s+/)[0] || "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}

function askForRole(intro) {
  step = "role";
  role = "";
  const col = addAgentMessage(intro);
  addQuickReplies(col, (profile.role_suggestions || []).map((label) => ({ label, onPick: () => chooseRole(label) })));
  refreshControls();
  $("input").focus();
}

function chooseRole(text) {
  clearQuickReplies();
  role = text.trim().slice(0, 80);
  addUserMessage(role);
  step = "location";
  const col = addAgentMessage("Where would you like to work?");
  addQuickReplies(col, LOCATIONS.map(({ label, value }) => ({ label, onPick: () => chooseLocation(label, value) })));
  refreshControls();
  $("input").focus();
}

function chooseLocation(label, value) {
  clearQuickReplies();
  addUserMessage(label);
  step = "chat";
  threadId = crypto.randomUUID();     // A new search is a new conversation about these jobs.
  searchJobs(role, value);
}

function updatedAgo(seconds) {
  const hours = Math.floor((Date.now() / 1000 - seconds) / 3600);
  if (hours < 1) return "updated just now";
  return hours === 1 ? "updated 1 hour ago" : `updated ${hours} hours ago`;
}

function placeText(place) {
  if (!place) return "";
  return place.toLowerCase() === "remote" ? " (remote)" : ` in ${place}`;
}

async function fetchJobs(searchRole, place, count) {
  const query = new URLSearchParams({ role: searchRole, location: place, count });
  const response = await fetch(`/api/jobs?${query}`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

async function searchJobs(searchRole, place) {
  setBusy(true);
  const col = addAgentRow();
  const dots = makeDots();
  col.append(dots);
  scrollDown();
  const thread = threadId;
  try {
    const data = await fetchJobs(searchRole, place, JOBS_PER_PAGE);
    if (thread !== threadId) return;
    dots.remove();
    if (!data.jobs.length) showNoJobs(col, searchRole, place);
    else showResults(col, data, searchRole, place);
  } catch (error) {
    if (thread !== threadId) return;
    dots.remove();
    const message = el("div", "answer error", friendlyError(error));
    col.append(message);
    addQuickReplies(col, [
      { label: "Try again", onPick: () => { clearQuickReplies(); col.closest(".msg-agent").remove(); searchJobs(searchRole, place); } },
    ]);
  } finally {
    if (thread === threadId) setBusy(false);
  }
}

function showNoJobs(col, searchRole, place) {
  const answer = el("div", "answer");
  answer.textContent = `I couldn't find any ${searchRole} openings${placeText(place)} right now.`;
  col.append(answer);
  const replies = [{ label: "Try another role", onPick: () => { clearQuickReplies(); askForRole("Sure. What role or domain should I look for?"); } }];
  if (place) {
    replies.unshift({ label: "Search anywhere", onPick: () => chooseLocation("Anywhere", "") });
  }
  addQuickReplies(col, replies);
}

function showResults(col, data, searchRole, place) {
  const results = el("section", "results");
  const head = el("header", "results-head");
  const count = data.total === 1 ? "1 opening" : `${data.total} openings`;
  head.append(el("h3", "", `${count} for ${searchRole}${placeText(place)}`));
  const from = data.jobs.some((job) => job.source) ? "company career pages and Adzuna" : "company career pages";
  const notes = [`Best matches first, from ${from}, ${updatedAgo(data.updated)}`];
  if (data.entry_level) notes.unshift("Entry-level roles");
  head.append(el("p", "", notes.join(" · ")));

  const list = el("ul", "job-list");
  data.jobs.forEach((job) => list.append(jobCard(job)));

  const foot = el("div", "results-foot");
  let shown = data.jobs.length;
  const shownIds = new Set(data.jobs.map((job) => job.id));
  if (shown < data.total) {
    const more = button("job-btn search-again", "Show more jobs", async () => {
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
        else more.textContent = "Show more jobs";
      } catch {
        more.textContent = "Couldn't load more. Try again";
        more.disabled = false;
      }
    });
    foot.append(more);
  }
  foot.append(button("job-btn search-again", "New search", () => {
    clearQuickReplies();
    askForRole("Sure. What role or domain should I look for?");
  }));

  results.append(head, list, foot);
  col.append(results);
  addQuickReplies(col, FOLLOW_UPS.map(({ label, prompt }) => ({ label, onPick: () => ask(prompt, label) })));
  results.scrollIntoView({ block: "start" });     // The best match is first, so start there.
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
    const content = links.flatMap((link, i) => (i ? [" · ", link] : [link]));
    box.append(detailRow("Contact", ...content));
  } else {
    const search = `https://www.google.com/search?q=${encodeURIComponent(`${job.company} careers contact`)}`;
    box.append(detailRow("Contact", el("span", "job-unknown", "Not published · "), outsideLink("Search for it ↗", search)));
  }
  return box;
}

function jobCard(job) {
  const card = el("li", "job-card");
  card.append(el("div", "job-logo", job.company[0].toUpperCase()));
  card.lastChild.setAttribute("aria-hidden", "true");

  const main = el("div", "job-main");
  const top = el("div");
  top.append(el("h4", "job-title", job.title));
  const meta = el("p", "job-meta");
  meta.append(el("b", "", job.company));
  if (job.startup) meta.append(el("span", "job-badge", "Startup"));
  if (job.location) meta.append(el("span", "", job.location));
  if (job.source) {
    const source = el("a", "job-source", job.source);
    source.href = job.source_url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    meta.append(source);
  }
  top.append(meta);
  const details = jobDetails(job);

  const chips = el("div", "job-skills");
  job.have.slice(0, 6).forEach((skill) => chips.append(el("span", "job-skill", `✓ ${skill}`)));
  job.missing.slice(0, 5).forEach((skill) => chips.append(el("span", "job-skill gap", `✕ ${skill}`)));

  const fit = button("job-btn job-ask", "Check fit", () =>
    ask(`Am I a good fit for ${job.title} at ${job.company}? Tell me what matches my resume and which skills I'm missing.`));
  const letter = button("job-btn job-ask", "Cover letter", () =>
    ask(`Write a short cover letter for ${job.title} at ${job.company}.`));
  const apply = el("a", "job-btn job-apply", "Apply ↗");
  apply.href = job.url;
  apply.target = "_blank";
  apply.rel = "noopener noreferrer";
  fit.setAttribute("aria-label", `Check my fit for ${job.title} at ${job.company}`);
  letter.setAttribute("aria-label", `Write a cover letter for ${job.title} at ${job.company}`);
  apply.setAttribute("aria-label", `Apply for ${job.title} on the ${job.company} website`);

  const actions = el("div", "job-actions");
  actions.append(fit, letter, apply);

  main.append(top, details);
  if (job.have.length || job.missing.length) main.append(chips);
  main.append(actions);
  card.append(main);
  return card;
}

/* ---------- One answer from the agent ---------- */

function startAgentTurn() {
  const col = addAgentRow();
  const dots = makeDots();
  const answer = el("div", "answer");
  answer.hidden = true;
  col.append(dots, answer);
  const turn = { col, dots, answer, draft: "" };
  scrollDown();
  return turn;
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
  } else if (data.type === "saved") {
    loadLetters();
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

  const copy = button("copy", "Copy", async () => {
    await navigator.clipboard.writeText(content);
    copy.textContent = "Copied";
    setTimeout(() => { copy.textContent = "Copy"; }, 1500);
  });
  turn.col.append(copy);
  scrollDown();
}

function showError(turn, message) {
  turn.dots.hidden = true;
  turn.answer.hidden = false;
  turn.answer.classList.remove("typing");
  turn.answer.classList.add("error");
  turn.answer.textContent = message;
  scrollDown();
}

/* ---------- Approval: nothing is saved until the user says yes ---------- */

function showApproval(turn, data) {
  waitingForAnswer = true;
  refreshControls();

  const card = el("section", "clearance");
  const header = el("header");
  header.append(el("p", "eyebrow", "Your cover letter"), el("h3", "", "Save this letter?"));

  const editor = el("textarea", "letter");
  editor.value = data.cover_letter;
  editor.setAttribute("aria-label", "Cover letter. You can edit it before saving.");

  // The job asks for these, the resume lacks them, and the letter claims them.
  const warning = el("p", "clearance-warning");
  const refreshWarning = () => {
    const left = data.unsupported.filter((skill) => editor.value.toLowerCase().includes(skill.toLowerCase()));
    warning.classList.toggle("flagged", left.length > 0);
    warning.textContent = left.length
      ? `✕ Not on your resume: ${left.join(", ")}. Edit this claim before you save.`
      : "You can edit the letter here. Make sure every claim is true before you send it.";
  };
  refreshWarning();
  editor.addEventListener("input", refreshWarning);

  const parts = [header, editor, warning];
  if (data.overwrites) parts.push(el("p", "clearance-note", "This replaces the letter you saved for this job."));

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
  editor.style.height = `${Math.min(editor.scrollHeight + 4, 320)}px`;
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
    if (thread === threadId && !waitingForAnswer) $("input").focus();
  }
}

// `shown` is what appears in the chat, when a button asks a longer question behind the scenes.
function ask(text, shown) {
  if (busy || waitingForAnswer || !online || !text.trim()) return;
  clearQuickReplies();
  step = "chat";
  showTab("chat");
  closeDrawer();
  addUserMessage((shown || text).trim());
  send("/api/chat", { thread_id: threadId, message: text.trim() });
}

function submitComposer() {
  const text = $("input").value.trim();
  if (!text || busy || waitingForAnswer || !online || !hasResume) return;
  $("input").value = "";
  resizeInput();
  if (step === "role") chooseRole(text);
  else if (step === "location") chooseLocation(text, text.slice(0, 80));
  else ask(text);
}

/* ---------- The resume PDF ---------- */

async function uploadResume(file) {
  $("upload-error").hidden = true;
  const isPdf = file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  if (!isPdf) {
    showUploadError("Please choose a PDF file.");
    return;
  }
  uploading = true;
  refreshControls();
  $("replace-resume").textContent = "Reading your resume…";
  $("dropzone").querySelector("b").textContent = "Reading your resume…";
  const wasStarted = started;
  try {
    const response = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    if (!response.ok) throw new Error(await readError(response));
    profile = await response.json();
    uploading = false;
    startConversation();                       // A new chat, so the advice comes from the new resume.
    closeDrawer();
  } catch (error) {
    started = wasStarted;
    showUploadError(friendlyError(error));
  } finally {
    uploading = false;
    $("replace-resume").textContent = "Upload new PDF";
    $("dropzone").querySelector("b").textContent = "Upload your resume to start";
    $("resume-file").value = "";
    refreshControls();
  }
}

async function deleteMyData() {
  if (!confirm("Delete your resume, saved cover letters and chats from CareerPilot? This can't be undone.")) return;
  const response = await fetch("/api/delete-my-data", { method: "POST" }).catch(() => null);
  if (!response || !response.ok) {
    showNotice(false, "I couldn't delete your data. Please try again.");
    return;
  }
  started = false;
  $("thread").replaceChildren();
  await loadData();
  closeDrawer();
  showTab("chat");
}

function showUploadError(message) {
  showTab("chat");
  closeDrawer();
  if (started) {                               // The upload box is gone, so say it in the chat.
    const col = addAgentRow();
    col.append(el("div", "answer error", message));
    scrollDown();
    return;
  }
  $("upload-error").textContent = message;
  $("upload-error").hidden = false;
}

function setUpDropping() {
  const box = $("dropzone");
  const blockBrowser = (e) => e.preventDefault();  // Otherwise the browser opens the dropped file.
  window.addEventListener("dragover", blockBrowser);
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (online && !uploading && !busy && !waitingForAnswer) uploadResume(e.dataTransfer.files[0]);
  });
  box.addEventListener("dragenter", () => box.classList.add("over"));
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", () => box.classList.remove("over"));
  box.addEventListener("click", () => $("resume-file").click());
  $("replace-resume").addEventListener("click", () => $("resume-file").click());
  $("resume-file").addEventListener("change", (e) => uploadResume(e.target.files[0]));
  $("delete-data").addEventListener("click", deleteMyData);
  $("continue-resume").addEventListener("click", startConversation);
}

/* ---------- The sidebar ---------- */

function renderProfile(data) {
  profile = data;
  hasResume = data.has_resume;
  $("profile-box").hidden = !started;
  $("delete-data").hidden = !hasResume;
  $("sidebar-note").hidden = started;
  $("hello").hidden = started;
  $("upload-error").hidden = true;
  $("skills").replaceChildren();
  $("continue-resume").hidden = !hasResume;
  if (hasResume) $("continue-resume").textContent = `Continue with the saved resume of ${data.name}`;
  if (!hasResume) {
    refreshControls();
    return;
  }

  $("pilot-name").textContent = data.name;
  $("pilot-place").textContent = data.location;
  const parts = data.name.split(/\s+/);
  $("avatar").textContent = (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();

  data.skills.forEach(({ group, items }) => {
    const box = el("div", "skill-group");
    const chips = el("div", "chips");
    items.forEach((item) => chips.append(el("span", "chip", item)));
    box.append(el("h4", "", group), chips);
    $("skills").append(box);
  });
  refreshControls();
}

async function loadLetters() {
  const letters = await fetch("/api/applications").then((r) => r.json()).catch(() => []);
  const list = $("letters");
  list.replaceChildren();
  letters.forEach(({ id, label }) => {
    const link = el("a", "", label);
    link.href = `/api/applications/${id}`;
    link.target = "_blank";
    link.rel = "noopener";
    const item = el("li");
    item.append(link);
    list.append(item);
  });
  $("letters-section").hidden = !letters.length || !started;
}

/* ---------- Job Match ---------- */

async function runScan() {
  const post = $("scan-input").value.trim();
  if (!post || !online) return;
  const go = $("scan-go");
  const result = $("scan-result");
  go.disabled = true;
  go.textContent = "Checking…";
  result.hidden = false;
  result.replaceChildren(el("p", "note", "Reading the job post…"));
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post }),
    });
    if (!response.ok) throw new Error(await readError(response));
    renderScan(await response.json(), post);
  } catch (error) {
    result.replaceChildren(el("p", "error-text", friendlyError(error)));
  } finally {
    go.disabled = !online;
    go.textContent = "Check my match";
  }
}

function renderScan(data, post) {
  const result = $("scan-result");
  result.replaceChildren();
  const have = data.skills.filter((s) => s.on_resume);
  const facts = el("div", "scan-facts");
  const stat = (value, label) => {
    const box = el("div", "scan-stat");
    box.append(el("b", "", value), el("span", "", label));
    return box;
  };
  if (data.skills.length) {
    facts.append(stat(`${have.length} of ${data.skills.length}`, "skills you already have"));
  }
  if (data.years !== null) facts.append(stat(data.years, data.years === 1 ? "year of experience asked" : "years of experience asked"));
  result.append(facts);

  if (data.skills.length) {
    const chips = el("div", "job-skills scan-skills");
    data.skills.forEach((s) => chips.append(
      el("span", `job-skill${s.on_resume ? "" : " gap"}`, `${s.on_resume ? "✓" : "✕"} ${s.name}`)));
    result.append(chips);
  } else {
    result.append(el("p", "note", "I couldn't pick out specific skills from this post. Ask me about it instead."));
  }

  const actions = el("div", "match-actions");
  actions.append(
    button("primary-btn match-ask", "Ask if it's right for me", () =>
      ask(`Here is a job post:\n\n${post}\n\nIs this job right for me, based on my resume? Tell me what matches and what I'm missing.`)),
    button("secondary-btn match-ask", "Write a cover letter", () =>
      ask(`Here is a job post:\n\n${post}\n\nWrite a short cover letter for this job, based on my resume.`)),
  );
  result.append(actions);
  refreshControls();
}

/* ---------- Page controls ---------- */

function showTab(name) {
  document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  $("new-chat").hidden = name !== "chat";
}

function resizeInput() {
  const input = $("input");
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  refreshControls();
}

function openDrawer() {
  $("cockpit").classList.add("open");
  $("scrim").hidden = false;
}

function closeDrawer() {
  $("cockpit").classList.remove("open");
  $("scrim").hidden = true;
}

function newChat() {
  threadId = crypto.randomUUID();
  waitingForAnswer = false;
  activeReplies = null;
  setBusy(false);
  $("thread").replaceChildren();
  $("upload-error").hidden = true;
  if (started) {
    const name = firstName();
    askForRole(`${name ? `Hi ${name}, I've` : "I've"} read your resume. What role or domain are you looking for?`);
  } else {
    step = "chat";
    refreshControls();
  }
}

function savedTheme() {
  try { return localStorage.getItem("theme"); } catch { return null; }
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* The choice just won't be remembered. */ }
}

function start() {
  const theme = savedTheme();
  if (theme) document.documentElement.dataset.theme = theme;

  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
  showTab("chat");

  $("composer").addEventListener("submit", (e) => { e.preventDefault(); submitComposer(); });
  $("input").addEventListener("input", resizeInput);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitComposer();
    }
  });
  $("new-chat").addEventListener("click", newChat);
  $("theme").addEventListener("click", toggleTheme);
  $("menu").addEventListener("click", openDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("scan-form").addEventListener("submit", (e) => { e.preventDefault(); runScan(); });
  setUpDropping();

  refreshControls();
  checkHealth();
  $("input").focus();
}

start();
