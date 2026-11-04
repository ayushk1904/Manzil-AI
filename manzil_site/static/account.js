// Shows whether the current session is still valid, and logs out.
const statusPill = byId("account-status-pill");
const statusCopy = byId("account-status-copy");
const statusBadge = byId("account-status-badge");

function setLoggedOutUI() {
  statusPill.textContent = "Logged out";
  statusPill.classList.remove("is-logged-in");
  statusCopy.textContent = "You are currently browsing as a guest.";
  statusBadge.textContent = "Logged out";
}

function clearSession() {
  localStorage.removeItem("manzilAuthToken");
  localStorage.removeItem("manzilAuthUser");
  localStorage.setItem("manzilAccountStatus", "logged_out");
}

async function updateAccountUI() {
  const token = localStorage.getItem("manzilAuthToken");
  if (!token) {
    localStorage.setItem("manzilAccountStatus", "logged_out");
    setLoggedOutUI();
    return;
  }
  try {
    const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 503) {          // The database is down. The session itself may be fine.
      statusCopy.textContent = "Accounts are unavailable right now, so your session couldn't be checked.";
      return;
    }
    if (!response.ok) throw new Error("Session expired.");
    const data = await readJson(response, "The auth service returned an invalid response.");
    statusPill.textContent = "Logged in";
    statusPill.classList.add("is-logged-in");
    statusCopy.textContent = `Signed in as ${`${data.user.firstName} ${data.user.lastName}`.trim()} (${data.user.email}).`;
    statusBadge.textContent = "Logged in";
    localStorage.setItem("manzilAccountStatus", "logged_in");
    localStorage.setItem("manzilAuthUser", JSON.stringify(data.user));
  } catch {
    clearSession();
    setLoggedOutUI();
  }
}

byId("account-logout-action").addEventListener("click", () => {
  clearSession();
  window.location.href = "/login";
});

updateAccountUI();
