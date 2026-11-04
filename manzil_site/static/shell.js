// The parts the Resource Hub shares with the agent's page: the theme and the mobile drawer.
const byId = (id) => document.getElementById(id);

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

function openDrawer() {
  byId("cockpit").classList.add("open");
  byId("scrim").hidden = false;
}

function closeDrawer() {
  byId("cockpit").classList.remove("open");
  byId("scrim").hidden = true;
}

async function readJson(response, problem) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(problem);
  }
}

function setUpShell() {
  const theme = savedTheme();
  if (theme) document.documentElement.dataset.theme = theme;
  byId("theme").addEventListener("click", toggleTheme);
  byId("menu").addEventListener("click", openDrawer);
  byId("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
}

setUpShell();
