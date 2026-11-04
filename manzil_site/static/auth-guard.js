// Runs before the page draws. The Resource Hub and Account need a login. The agent's pages don't.
(function () {
  const publicPages = new Set(["/login", "/register"]);
  const token = localStorage.getItem("manzilAuthToken");
  const isPublicPage = publicPages.has(window.location.pathname);

  const tokenIsUsable = (value) => {
    if (!value) return false;
    try {
      const encoded = (value.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(encoded));
      return !payload.exp || payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  };

  // Only ever go back to a page in this app, never to another site named in the link.
  window.safeNextPage = (fallback) => {
    const next = new URLSearchParams(window.location.search).get("next") || "";
    return /^\/(?![/\\])/.test(next) ? next : fallback;
  };

  const hasToken = tokenIsUsable(token);
  if (token && !hasToken) {
    localStorage.removeItem("manzilAuthToken");
    localStorage.removeItem("manzilAuthUser");
    localStorage.setItem("manzilAccountStatus", "logged_out");
  }

  if (!hasToken && !isPublicPage) {
    const here = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(`/login?next=${encodeURIComponent(here)}`);
  } else if (hasToken && isPublicPage) {
    window.location.replace(window.safeNextPage("/resources"));
  }
})();
