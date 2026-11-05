// The Resource Hub: the learning search.
const topicSearchForm = byId("topic-search-form");
const topicSearchInput = byId("topic-search-input");
const topicSearchButton = byId("topic-search-button");
const topicSearchFeedback = byId("topic-search-feedback");
const resultsSection = byId("results-section");
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
  const source = item.type === "video" ? item.channelTitle || "YouTube" : item.source || "Web";
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

  const label = activeFilter === "all" ? "results" : `${activeFilter} results`;
  emptyState.textContent = `No ${label} for "${lastSearchTopic}".`;
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

  setSearchState({ feedback: "Searching…", busy: true });

  try {
    const response = await fetch(`/api/resources/search?topic=${encodeURIComponent(trimmedTopic)}`);
    const data = await readJson(response, "Backend returned an invalid JSON response.");
    if (!response.ok) throw new Error(data.message || "Search failed.");

    currentResults = [...(data.resources || []), ...(data.videos || []), ...(data.papers || [])];
    lastSearchTopic = data.topic;
    resultsHeading.textContent = `Results for "${data.topic}"`;
    resultsSection.hidden = false;

    // A provider failing means fallback links fill its place, so say these aren't all live results.
    setSearchState({ feedback: data.providerWarnings?.length ? "Web search is unavailable, so some of these are suggested links, not live results." : "" });
    renderResults();
  } catch (error) {
    resultsSection.hidden = true;
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

checkBackendHealth();
