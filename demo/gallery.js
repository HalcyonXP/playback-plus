// Public design gallery: CSS-only messages, with no iframe document access.
(() => {
  const frame = document.getElementById("preview");
  const status = document.getElementById("galleryStatus");
  const link = document.getElementById("paletteLink");
  const buttons = [...document.querySelectorAll("button[data-theme]")];
  const themes = new Set(buttons.map(button => button.dataset.theme));
  const requested = new URLSearchParams(location.search).get("theme");
  const targetOrigin = location.protocol === "file:" ? "*" : location.origin;
  let selected = themes.has(requested) ? requested : "n1";
  let timer;

  function sendSelection() {
    frame.contentWindow.postMessage({ type: "PLAYBACK_PLUS_THEME_SELECT", theme: selected }, targetOrigin);
  }
  function choose(theme) {
    if (!themes.has(theme)) return;
    selected = theme;
    status.textContent = "Loading palette…";
    frame.setAttribute("aria-busy", "true");
    clearTimeout(timer);
    timer = setTimeout(() => {
      frame.setAttribute("aria-busy", "false");
      status.textContent = "Preview did not respond. Click a palette to retry, or reload this page.";
    }, 5000);
    sendSelection();
  }
  addEventListener("message", event => {
    if (event.source !== frame.contentWindow) return;
    if (targetOrigin !== "*" && event.origin !== targetOrigin) return;
    if (event.data?.type === "PLAYBACK_PLUS_THEME_READY") {
      sendSelection();
      return;
    }
    if (event.data?.type !== "PLAYBACK_PLUS_THEME_APPLIED"
      || event.data.theme !== selected || !themes.has(event.data.theme)) return;
    clearTimeout(timer);
    frame.setAttribute("aria-busy", "false");
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.theme === selected));
    status.textContent = "Showing " + buttons.find(button => button.dataset.theme === selected).textContent.trim();
    const share = new URL(location.href);
    share.searchParams.set("theme", selected);
    share.hash = "";
    link.href = share.href;
    // Palette links are shareable; fictional settings remain memory-only.
    history.replaceState(null, "", share.href);
    document.documentElement.dataset.appliedTheme = selected;
  });
  frame.addEventListener("load", sendSelection);
  for (const button of buttons) {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => choose(button.dataset.theme));
  }
  choose(selected);
})();
