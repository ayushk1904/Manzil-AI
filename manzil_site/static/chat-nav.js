// Links from the other pages can open Job Match. The agent's own tab button does the work.
if (window.location.hash === "#match") {
  document.querySelector('.tab[data-tab="match"]').click();
}

if (!localStorage.getItem("manzilAuthToken")) {
  const link = document.getElementById("account-link");
  link.textContent = "Log in";
  link.href = "/login";
}
