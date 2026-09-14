(() => {
  "use strict";
  const SOURCE = "video-speed-audio-v1";
  const pending = new Map();
  let counter = 0;
  let state = { enabled: false, delayMs: 0, revision: -1 };
  let appliedRevision = -1;
  let lastStatus = null;
  let failure = "";
  let sequence = Promise.resolve();
  let configured = false;
  const count = value => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : 0;
  function sanitize(raw) {
    return {
      enabled: raw?.enabled === true,
      delayMs: count(raw?.delayMs), media: count(raw?.media), eligible: count(raw?.eligible),
      connected: count(raw?.connected), unsupported: count(raw?.unsupported),
      dialogueConnected: count(raw?.dialogueConnected), dialoguePending: count(raw?.dialoguePending),
      dialogueFailed: count(raw?.dialogueFailed),
      dialogueError: typeof raw?.dialogueError === "string" ? raw.dialogueError.slice(0, 250) : "",
      contextState: ["native", "running", "suspended", "closed", "interrupted"].includes(raw?.contextState) ? raw.contextState : "closed",
      error: typeof raw?.error === "string" ? raw.error.slice(0, 250) : ""
    };
  }
  globalThis.addEventListener("message", event => {
    const m = event.data;
    // Firefox's isolated-world globalThis is a sandbox, not the DOM Window.
    if (event.source !== window || !m || m.source !== SOURCE || m.direction !== "from-page") return;
    const request = pending.get(m.id);
    if (!request) return;
    pending.delete(m.id);
    clearTimeout(request.timer);
    // Page data is informational only. It can never write preferences or request APIs.
    const result = sanitize(m.status);
    if (m.ok === true) request.resolve(result);
    else request.reject(new Error(typeof m.error === "string" ? m.error.slice(0, 250) : "Audio engine failed"));
  });
  function send(type, values = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++counter}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Audio engine unavailable; reload this tab")); }, 1800);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ source: SOURCE, direction: "to-page", id, type, ...values }, "*");
    });
  }
  async function configure() {
    if (configured) return;
    await send("configure", { url: browser.runtime.getURL("content/audio-processor.js") });
    configured = true;
  }
  function adopt(next) {
    if (!next || !Number.isSafeInteger(next.revision) || next.revision < state.revision) return sequence;
    state = globalThis.VideoAudioUtils.normalize(next);
    const snapshot = state;
    sequence = sequence.catch(() => {}).then(async () => {
      if (snapshot.revision < state.revision) return;
      try {
        await configure();
        lastStatus = await send("apply", { enabled: snapshot.enabled, delayMs: snapshot.delayMs,
          dialogueEnabled: snapshot.dialogueEnabled, dialogueMix: snapshot.dialogueMix, dialogueRun: snapshot.dialogueRun });
        appliedRevision = snapshot.revision;
        failure = "";
      } catch (error) { failure = error.message; }
    });
    return sequence;
  }
  async function refresh() {
    return adopt(await browser.runtime.sendMessage({ type: "AUDIO_SYNC_GET" }));
  }
  let toastTimer;
  function toast(message) {
    let element = document.getElementById("video-speed-audio-notice");
    if (!element) {
      element = document.createElement("div");
      element.id = "video-speed-audio-notice";
      element.setAttribute("role", "status");
      Object.assign(element.style, { position: "fixed", bottom: "24px", left: "24px", zIndex: "2147483647",
        padding: "12px 16px", background: "#30332e", color: "#e2e1cf", border: "1px solid #edb658",
        borderRadius: "2px", font: "14px system-ui", pointerEvents: "none", maxWidth: "420px" });
      (document.body || document.documentElement).appendChild(element);
    }
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 2500);
  }
  globalThis.VideoAudioBridge = {
    act(action) {
      // Relative actions are applied atomically by the background writer, never
      // computed from this frame's possibly stale state. Unknown actions do nothing.
      const actions = {
        audioToggle: { type: "AUDIO_SYNC_TOGGLE" },
        audioIncrease: { type: "AUDIO_SYNC_NUDGE", direction: 1 },
        audioDecrease: { type: "AUDIO_SYNC_NUDGE", direction: -1 },
        dialogueToggle: { type: "DIALOGUE_TOGGLE" },
        dialogueIncrease: { type: "DIALOGUE_NUDGE", direction: 1 },
        dialogueDecrease: { type: "DIALOGUE_NUDGE", direction: -1 }
      };
      const message = Object.hasOwn(actions, action) ? actions[action] : null;
      if (!message) return;
      const quiet = action.startsWith("dialogue");
      void browser.runtime.sendMessage(message).then(async next => {
        await adopt(next);
        if (!quiet) toast(failure ? "Audio Sync isn't available here. Try reloading the page."
          : `Audio Sync · ${next.delayMs} ms selected · ${next.enabled ? "On" : "Off"}`);
      }).catch(() => { if (!quiet) toast("Couldn't change Audio Sync. Please try again."); });
    }
  };
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "AUDIO_SYNC_CHANGED") { void adopt(message.state); return undefined; }
    if (message?.type !== "AUDIO_SYNC_STATUS") return undefined;
    return (async () => {
      try {
        // Status is independent of the writer queue. Polling also refreshes missed broadcasts.
        await refresh();
        await configure();
        lastStatus = await send("status");
      } catch (error) { failure = error.message; }
      return { ...lastStatus, revision: state.revision, applying: appliedRevision !== state.revision,
        error: failure || lastStatus?.error || "" };
    })();
  });
  globalThis.addEventListener("pageshow", event => {
    if (event.persisted) void refresh().catch(error => { failure = error.message; });
  });
  void refresh().catch(error => { failure = error.message; });
})();
