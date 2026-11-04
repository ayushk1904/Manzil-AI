// The Resource Hub: the learning search, the guide and About.
const topicSearchForm = byId("topic-search-form");
const topicSearchInput = byId("topic-search-input");
const topicSearchButton = byId("topic-search-button");
const topicSearchFeedback = byId("topic-search-feedback");
const resultsHeading = byId("results-heading");
const resultsGrid = byId("results-grid");
const emptyState = byId("empty-state");
const filterTabs = document.querySelectorAll("[data-filter]");

let activeFilter = "all";
let currentResults = [];
let lastSearchTopic = "";

const cardIcons = {
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 6.25A2.25 2.25 0 0 0 3.25 8.5v7A2.25 2.25 0 0 0 5.5 17.75h8A2.25 2.25 0 0 0 15.75 15.5v-7A2.25 2.25 0 0 0 13.5 6.25h-8Zm12.11 2.09-1.86 1.07v5.18l1.86 1.07A1.25 1.25 0 0 0 19.5 14.6V9.4a1.25 1.25 0 0 0-1.89-1.06Z"/></svg>',
  resource: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.75 5.25A2.75 2.75 0 0 0 2 8v8a2.75 2.75 0 0 0 2.75 2.75h4.88c.8 0 1.57.22 2.25.64.68-.42 1.45-.64 2.25-.64h4.87A2.75 2.75 0 0 0 21.75 16V8A2.75 2.75 0 0 0 19 5.25h-4.87c-.8 0-1.57.22-2.25.64a4.2 4.2 0 0 0-2.25-.64H4.75Z"/></svg>',
  paper: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.75 3.5A2.75 2.75 0 0 0 5 6.25v11.5a2.75 2.75 0 0 0 2.75 2.75h8.5A2.75 2.75 0 0 0 19 17.75V9.44a2.75 2.75 0 0 0-.8-1.94l-3.7-3.7a2.75 2.75 0 0 0-1.94-.8h-4.8Z"/></svg>'
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Search results come from outside, so only real web links become clickable.
function webLink(url) {
  return /^https?:\/\//i.test(url || "") ? escapeHtml(url) : "#";
}

function resultCard(item) {
  const link = webLink(item.url);
  const source = item.type === "video" ? item.channelTitle || "YouTube" : item.source || "Google Search";
  const domain = item.type === "video" ? "" : `<span class="resource-domain">${escapeHtml(item.displayUrl || item.url)}</span>`;
  const thumbnail = item.type === "video" && item.thumbnail
    ? `<a class="resource-thumb" href="${link}" target="_blank" rel="noopener noreferrer"><img src="${webLink(item.thumbnail)}" alt="${escapeHtml(item.title)} thumbnail"></a>`
    : "";
  return `
    <li class="job-card" data-type="${escapeHtml(item.type)}">
      ${thumbnail}
      <div class="job-logo" aria-hidden="true">${cardIcons[item.type] || cardIcons.resource}</div>
      <div class="job-main">
        <div>
          <h3 class="job-title">${escapeHtml(item.title)}</h3>
          <p class="job-meta"><span class="job-badge resource-type">${escapeHtml(item.type)}</span><b>${escapeHtml(source)}</b>${domain}</p>
        </div>
        <p class="resource-snippet">${escapeHtml(item.snippet)}</p>
        <div class="job-actions">
          <a class="job-btn job-apply" href="${link}" target="_blank" rel="noopener noreferrer">Open Link ↗</a>
        </div>
      </div>
    </li>`;
}

function renderResults() {
  const shown = currentResults.filter((item) => activeFilter === "all" || item.type === activeFilter);
  resultsGrid.innerHTML = shown.map(resultCard).join("");

  if (!shown.length) {
    const label = activeFilter === "all" ? "results" : `${activeFilter} results`;
    emptyState.querySelector("h3").textContent = lastSearchTopic
      ? `No ${label} found for "${lastSearchTopic}"`
      : "Ask for a topic and build a study lane";
    emptyState.querySelector("p").textContent = lastSearchTopic
      ? `Try another topic or switch filters to see the available learning links for ${lastSearchTopic}.`
      : "Try searching for a subject like JavaScript, operating systems, machine learning, or UI design.";
  }
  emptyState.hidden = shown.length > 0;
  resultsGrid.hidden = shown.length === 0;
}

function setSearchState({ feedback, busy = false, error = false }) {
  topicSearchFeedback.textContent = feedback;
  topicSearchFeedback.classList.toggle("is-error", error);
  topicSearchButton.disabled = busy;
}

async function checkBackendHealth() {
  try {
    const response = await fetch("/api/site/health");
    const data = await readJson(response, "Backend returned a non-JSON response.");
    if (!response.ok || !data.ok) throw new Error();
    if (!topicSearchInput.value.trim()) {
      topicSearchFeedback.textContent = "";
      topicSearchFeedback.classList.remove("is-error");
    }
  } catch {
    topicSearchFeedback.textContent = "Manzil AI isn't running. Start it with python main.py.";
    topicSearchFeedback.classList.add("is-error");
  }
}

async function runSearch(topic) {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    setSearchState({ feedback: "Please enter a topic to search.", error: true });
    return;
  }

  setSearchState({ feedback: `Searching live resources for "${trimmedTopic}"...`, busy: true });

  try {
    const response = await fetch(`/api/resources/search?topic=${encodeURIComponent(trimmedTopic)}`);
    const data = await readJson(response, "Backend returned an invalid JSON response.");
    if (!response.ok) throw new Error(data.message || "Search failed.");

    currentResults = [...(data.resources || []), ...(data.videos || []), ...(data.papers || [])];
    lastSearchTopic = data.topic;
    resultsHeading.textContent = `Live results for "${data.topic}"`;

    const warnings = Array.isArray(data.providerWarnings) ? data.providerWarnings.join(" ") : "";
    setSearchState({ feedback: `Loaded ${currentResults.length} results for "${data.topic}". ${warnings}`.trim() });
    renderResults();
  } catch (error) {
    currentResults = [];
    lastSearchTopic = trimmedTopic;
    resultsHeading.textContent = `Search results for "${trimmedTopic}"`;
    renderResults();
    setSearchState({ feedback: error instanceof TypeError ? "I lost the connection. Please try again in a moment." : error.message, error: true });
  } finally {
    topicSearchButton.disabled = false;
  }
}

topicSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(topicSearchInput.value);
});

document.querySelectorAll(".quick-topic").forEach((button) => {
  button.addEventListener("click", () => {
    topicSearchInput.value = button.dataset.topic;
    runSearch(button.dataset.topic);
  });
});

filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeFilter = tab.dataset.filter;
    filterTabs.forEach((other) => {
      const active = other === tab;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-pressed", String(active));
    });
    renderResults();
  });
});

/* ---------- Choosing a section ---------- */

function showSection() {
  const wanted = window.location.hash.slice(1);
  const sections = document.querySelectorAll("[data-hub-section]");
  const name = [...sections].some((section) => section.dataset.hubSection === wanted) ? wanted : "search";
  sections.forEach((section) => { section.hidden = section.dataset.hubSection !== name; });
  document.querySelectorAll("[data-hub-link]").forEach((link) => {
    if (link.dataset.hubLink === name) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  byId("hub-scroll").scrollTop = 0;
  closeDrawer();
}

window.addEventListener("hashchange", showSection);

/* ---------- The guide and About: choose an option and the text beside it changes ---------- */

function setUpChoices(buttons, activeClass, onChoose) {
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((other) => {
        other.classList.remove(activeClass);
        if (other.hasAttribute("aria-pressed")) other.setAttribute("aria-pressed", "false");
      });
      button.classList.add(activeClass);
      if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", "true");
      onChoose(button);
    });
  });
}

const guideViews = {
  discover: { kicker: "Explore clearly", title: "See what the Hub offers before diving into the workspace.",
              description: "The guide introduces the Hub, highlights value quickly, and gives new users a friendly starting point." },
  plan: { kicker: "Build confidence", title: "Understand the path from curiosity to action.",
          description: "Visitors can move from learning about the Hub to understanding its structure before committing to a deeper search workflow." },
  launch: { kicker: "Start fast", title: "Move into the search when you are ready to work.",
            description: "Clear calls to action make the transition into the main resource area feel intentional instead of abrupt." }
};

const flowViews = {
  guide: "Start here to understand the Hub and get comfortable with the experience.",
  about: "Visit About to learn the story, goals, and what each section is designed to do.",
  search: "Open Search when you want a denser workspace for browsing and filtering resources."
};

const phases = {
  idea: { title: "A need for a simpler starting point",
          copy: "The Resource Hub begins with a common problem: learners waste energy jumping between random tutorials, docs, and tool lists." },
  design: { title: "Separate sections with separate jobs",
            copy: "The Hub was shaped so the Guide introduces, About explains, and Search helps people act inside a more useful workspace." },
  impact: { title: "A calmer way to keep moving",
            copy: "When each section has a purpose, users can explore without feeling buried under information or distracted by mixed goals." }
};

const values = {
  clarity: { title: "Clarity first", copy: "Every section has a specific role so users are never wondering what the screen is trying to do." },
  guidance: { title: "Guided flow", copy: "Navigation helps users move naturally from introduction to explanation and then into the resource workspace." },
  action: { title: "Action-ready", copy: "The Hub is not just descriptive. It always points toward the next useful step." }
};

setUpChoices(document.querySelectorAll("[data-guide-view]"), "is-active", (button) => {
  const view = guideViews[button.dataset.guideView];
  byId("guide-kicker").textContent = view.kicker;
  byId("guide-title").textContent = view.title;
  byId("guide-description").textContent = view.description;
});

setUpChoices(document.querySelectorAll("[data-flow]"), "is-active", (button) => {
  byId("flow-copy").textContent = flowViews[button.dataset.flow];
});

setUpChoices(document.querySelectorAll("[data-phase]"), "is-active", (button) => {
  const phase = phases[button.dataset.phase];
  byId("phase-title").textContent = phase.title;
  byId("phase-copy").textContent = phase.copy;
});

setUpChoices(document.querySelectorAll("[data-value]"), "is-active", (button) => {
  const value = values[button.dataset.value];
  byId("value-title").textContent = value.title;
  byId("value-copy").textContent = value.copy;
});

document.querySelectorAll(".faq-card").forEach((card, _, cards) => {
  const question = card.querySelector(".faq-question");
  const answer = card.querySelector(".faq-answer");
  question.addEventListener("click", () => {
    const opening = answer.hidden;
    cards.forEach((other) => {
      other.querySelector(".faq-answer").hidden = true;
      other.querySelector(".faq-question").setAttribute("aria-expanded", "false");
    });
    answer.hidden = !opening;
    question.setAttribute("aria-expanded", String(opening));
  });
});

showSection();
renderResults();
checkBackendHealth();
