// Preview-only messaging: file:// frames may have separate opaque origins.
(() => {
  const themes = new Set(["n1", "n2", "n3", "go1", "go2", "go3", "gb1", "gb2", "gb3"]);
  const key = new URLSearchParams(location.search).get("theme");
  document.documentElement.dataset.theme = themes.has(key) ? key : "n1";
  const targetOrigin = location.protocol === "file:" ? "*" : location.origin;
  const notify = type => {
    // '*' is required for opaque local-file origins; validate the source window
    // and whitelist the only allowed payload. No privileged API or storage use.
    if (parent !== window) parent.postMessage({ type, theme: document.documentElement.dataset.theme }, targetOrigin);
  };
  addEventListener("message", event => {
    if (event.source !== parent || parent === window) return;
    if (targetOrigin !== "*" && event.origin !== targetOrigin) return;
    if (event.data?.type !== "PLAYBACK_PLUS_THEME_SELECT" || !themes.has(event.data.theme)) return;
    document.documentElement.dataset.theme = event.data.theme;
    notify("PLAYBACK_PLUS_THEME_APPLIED");
  });
  notify("PLAYBACK_PLUS_THEME_READY");
})();
