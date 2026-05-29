(function () {
  const publicPages = new Set(["login.html", "register.html"]);
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const token = localStorage.getItem("manzilAuthToken");
  const isPublicPage = publicPages.has(currentPage);
  const tokenIsUsable = (value) => {
    if (!value) {
      return false;
    }

    try {
      const payload = JSON.parse(atob(value.split(".")[1] || ""));
      return !payload.exp || payload.exp * 1000 > Date.now();
    } catch (error) {
      return false;
    }
  };
  const hasToken = tokenIsUsable(token);

  if (token && !hasToken) {
    localStorage.removeItem("manzilAuthToken");
    localStorage.removeItem("manzilAuthUser");
    localStorage.setItem("manzilAccountStatus", "logged_out");
  }

  if (!hasToken && !isPublicPage) {
    const nextPage = encodeURIComponent(currentPage + window.location.search + window.location.hash);
    window.location.replace(`login.html?next=${nextPage}`);
    return;
  }

  if (hasToken && isPublicPage) {
    const params = new URLSearchParams(window.location.search);
    window.location.replace(params.get("next") || "dashboard.html");
  }
})();
