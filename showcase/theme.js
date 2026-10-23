(() => {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference;
  try { preference = localStorage.getItem("readflow-showcase-theme"); } catch { /* Use system theme. */ }
  let theme = preference === "light" || preference === "dark" ? preference : system.matches ? "dark" : "light";

  function apply() {
    root.dataset.theme = theme;
    document.querySelectorAll('picture source[media]').forEach(source => {
      source.media = theme === "dark" ? "all" : "not all";
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      const english = root.lang === "en";
      button.textContent = theme === "dark" ? (english ? "Light theme" : "Açık tema") : (english ? "Dark theme" : "Koyu tema");
      button.setAttribute("aria-label", button.textContent);
    });
  }
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      button.hidden = false;
      button.addEventListener("click", () => {
        theme = theme === "dark" ? "light" : "dark";
        preference = theme;
        try { localStorage.setItem("readflow-showcase-theme", theme); } catch { /* Session still works. */ }
        apply();
      });
    });
  });
  system.addEventListener("change", event => {
    if (preference === "light" || preference === "dark") return;
    theme = event.matches ? "dark" : "light";
    apply();
  });
})();
