(() => {
  "use strict";
  // Text-only, non-modal help. No privileged API, dynamic HTML or saved state.
  const app = document.querySelector(".app");
  const buttons = [...document.querySelectorAll("[data-help]")];
  let active = null;
  let pinned = false;
  let dismissed = null;
  let timer = null;
  const panelFor = button => document.getElementById(button.dataset.help);

  function close() {
    clearTimeout(timer);
    if (active) {
      panelFor(active).hidden = true;
      active.setAttribute("aria-expanded", "false");
    }
    active = null;
    pinned = false;
  }

  function position() {
    if (!active) return;
    const panel = panelFor(active);
    const bounds = app.getBoundingClientRect();
    const anchor = active.getBoundingClientRect();
    // Fixed positioning and bounded overflow keep help inside the actual viewport,
    // including a short native toolbar popup; opening help must not resize it.
    if (anchor.bottom < 0 || anchor.top > innerHeight) { close(); return; }
    const above = Math.max(1, anchor.top - 18);
    const below = Math.max(1, innerHeight - anchor.bottom - 18);
    const useAbove = above > below;
    // Never cover the info button itself: long guidance scrolls on the roomier
    // side, so the same button always remains clickable for pin/unpin.
    panel.style.maxHeight = `${useAbove ? above : below}px`;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(12, Math.min(bounds.left + 24, innerWidth - rect.width - 12));
    const top = useAbove ? anchor.top - rect.height - 6 : anchor.bottom + 6;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function open(button) {
    clearTimeout(timer);
    if (dismissed === button) return;
    if (active !== button) close();
    active = button;
    panelFor(button).hidden = false;
    button.setAttribute("aria-expanded", "true");
    position();
  }

  function later(button) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (active === button && !pinned && document.activeElement !== button &&
          !button.matches(":hover") && !panelFor(button).matches(":hover")) close();
    }, 160);
  }

  for (const button of buttons) {
    const panel = panelFor(button);
    button.addEventListener("mouseenter", () => { dismissed = null; open(button); });
    button.addEventListener("focus", () => { dismissed = null; open(button); });
    button.addEventListener("mouseleave", () => { dismissed = null; later(button); });
    button.addEventListener("blur", () => { dismissed = null; later(button); });
    button.addEventListener("click", () => {
      if (active === button && pinned) { close(); dismissed = button; }
      else { dismissed = null; open(button); pinned = true; }
    });
    panel.addEventListener("mouseenter", () => clearTimeout(timer));
    panel.addEventListener("mouseleave", () => later(button));
  }
  document.addEventListener("pointerdown", event => {
    if (active && !active.contains(event.target) && !panelFor(active).contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (!active) return;
    if (document.activeElement === active && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
      const panel = panelFor(active);
      const end = Math.max(0, panel.scrollHeight - panel.clientHeight);
      const amount = ({ ArrowDown: 36, ArrowUp: -36, PageDown: panel.clientHeight * .8, PageUp: -panel.clientHeight * .8 })[event.key];
      panel.scrollTop = event.key === "Home" ? 0 : event.key === "End" ? end : Math.max(0, Math.min(end, panel.scrollTop + amount));
      event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    const button = active;
    close();
    dismissed = button;
    event.preventDefault();
    // Dismiss help, not the native popup. Configuration capture has its own
    // earlier capture-phase handler; navigation always closes help first.
    event.stopPropagation();
  });
  document.getElementById("configButton").addEventListener("click", close);
  addEventListener("resize", position);
  document.addEventListener("scroll", event => {
    if (active && event.target !== panelFor(active)) position();
  }, true);
  addEventListener("pagehide", close, { once: true });
})();
