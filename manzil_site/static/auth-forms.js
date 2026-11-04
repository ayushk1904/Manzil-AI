// The log in and register forms.
const authProblem = "The auth service returned an invalid response. Make sure Manzil AI is running.";
const redirectAfterAuth = window.safeNextPage("/resources");

function setUpAuthForm(formId, submitId, feedbackId, busyText, path, readBody, check) {
  const form = byId(formId);
  const submit = byId(submitId);
  const feedback = byId(feedbackId);
  const setFeedback = (text, isError = false) => {
    feedback.textContent = text;
    feedback.classList.toggle("is-error", isError);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const problem = check ? check() : "";
    if (problem) {
      setFeedback(problem, true);
      return;
    }
    submit.disabled = true;
    setFeedback(busyText);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readBody()),
      });
      const data = await readJson(response, authProblem);
      if (!response.ok) throw new Error(data.message || "That didn't work. Please try again.");
      localStorage.setItem("manzilAccountStatus", "logged_in");
      localStorage.setItem("manzilAuthToken", data.token);
      localStorage.setItem("manzilAuthUser", JSON.stringify(data.user));
      window.location.href = redirectAfterAuth;
    } catch (error) {
      localStorage.setItem("manzilAccountStatus", "logged_out");
      setFeedback(error instanceof TypeError ? "I lost the connection. Please try again in a moment." : error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

// Keep the place the visitor was going when they switch between the two forms.
document.querySelectorAll("[data-auth-switch]").forEach((link) => {
  link.href = `${link.getAttribute("href")}${window.location.search}`;
});

if (byId("login-form")) {
  setUpAuthForm("login-form", "login-submit", "login-feedback", "Logging you in...", "/api/auth/login", () => ({
    email: byId("login-email").value.trim(),
    password: byId("login-password").value,
  }));
}

if (byId("register-form")) {
  setUpAuthForm("register-form", "register-submit", "register-feedback", "Creating your account...", "/api/auth/register", () => ({
    firstName: byId("first-name").value.trim(),
    lastName: byId("last-name").value.trim(),
    email: byId("register-email").value.trim(),
    password: byId("register-password").value,
    confirmPassword: byId("confirm-password").value,
  }), () => (byId("terms-check").checked ? "" : "Please accept the terms and privacy policy."));
}
