(() => {
  "use strict";
  const ids = ["audioEnabled", "audioExact", "audioDecrease", "audioIncrease", "audioReset",
    "dialogueEnabled", "dialogueMix", "dialogueValue"];
  const e = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  let tabId = null;
  let state = { enabled: false, delayMs: 0, dialogueEnabled: false, dialogueMix: 100, revision: -1 };
  let draftMix = null;
  let ready = false;
  let busy = false;
  let polling = false;
  let frames = [];
  function adopt(next) {
    if (next && next.revision >= state.revision) state = globalThis.VideoAudioUtils.normalize(next);
  }
  function render() {
    const sum = name => frames.reduce((total, f) => total + (Number.isInteger(f[name]) ? f[name] : 0), 0);
    const eligible = sum("eligible");
    // Switches show requested state, not processing success. Automatic audio
    // status/warnings are intentionally absent; guidance remains in the info panels.
    if (document.activeElement !== e.audioExact || busy) e.audioExact.value = String(state.delayMs);
    e.audioEnabled.textContent = state.enabled ? "On" : "Off";
    e.audioEnabled.setAttribute("aria-checked", String(state.enabled));
    e.audioEnabled.disabled = !ready || busy || (!state.enabled && !eligible);
    const disabled = !ready || busy || (!state.enabled && !eligible);
    e.audioExact.disabled = disabled;
    e.audioDecrease.disabled = disabled || state.delayMs === 0;
    e.audioIncrease.disabled = disabled || state.delayMs === 5000;
    e.audioReset.disabled = disabled || state.delayMs === 0;

    e.dialogueEnabled.textContent = state.dialogueEnabled ? "On" : "Off";
    e.dialogueEnabled.setAttribute("aria-checked", String(state.dialogueEnabled));
    e.dialogueEnabled.disabled = !ready || busy || (!state.dialogueEnabled && !eligible);
    e.dialogueMix.disabled = !ready || busy;
    e.dialogueMix.value = String(draftMix ?? state.dialogueMix);
    e.dialogueValue.textContent = `${draftMix ?? state.dialogueMix}%`;
    e.dialogueMix.setAttribute("aria-valuetext", `${draftMix ?? state.dialogueMix}% filtered`);
  }
  const request = (type, values = {}) => browser.runtime.sendMessage({ type, tabId, ...values });
  async function poll() {
    if (polling || tabId === null) return;
    polling = true;
    try {
      const result = await request("AUDIO_SYNC_STATUS_GET");
      if (result.state.revision >= state.revision) {
        adopt(result.state);
        frames = result.frames;
        ready = true;
      }
    } catch { /* Retain the last known selection; initial load stays disabled. */ }
    finally { polling = false; render(); }
  }
  async function change(type, values = {}) {
    if (!ready || busy) return;
    busy = true;
    render();
    try {
      adopt(await request(type, values));
    } catch {
      // Quiet failure must never leave an unsaved input looking authoritative.
      e.audioExact.value = String(state.delayMs);
    }
    finally { busy = false; render(); void poll(); }
  }
  e.dialogueEnabled.addEventListener("click", () => void change("DIALOGUE_ENABLE", { enabled: !state.dialogueEnabled }));
  e.dialogueMix.addEventListener("input", () => {
    draftMix = Number(e.dialogueMix.value);
    render();
  });
  e.dialogueMix.addEventListener("change", () => {
    const mix = Number(e.dialogueMix.value);
    draftMix = null;
    if (mix !== state.dialogueMix) void change("DIALOGUE_MIX", { mix });
    else render();
  });
  e.audioEnabled.addEventListener("click", () => void change("AUDIO_SYNC_ENABLE", { enabled: !state.enabled }));
  e.audioDecrease.addEventListener("click", () => void change("AUDIO_SYNC_NUDGE", { direction: -1 }));
  e.audioIncrease.addEventListener("click", () => void change("AUDIO_SYNC_NUDGE", { direction: 1 }));
  e.audioReset.addEventListener("click", () => void change("AUDIO_SYNC_SET", { delayMs: 0 }));
  function exact() {
    const value = e.audioExact.value.trim();
    const number = Number(value);
    if (!value || !Number.isInteger(number) || number < 0 || number > 5000) {
      e.audioExact.value = String(state.delayMs);
      render();
      return;
    }
    if (number !== state.delayMs) void change("AUDIO_SYNC_SET", { delayMs: number });
    else render();
  }
  e.audioExact.addEventListener("change", exact);
  e.audioExact.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); exact(); }
  });
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "AUDIO_SYNC_CHANGED" && message.tabId === tabId && message.state.revision > state.revision) {
      adopt(message.state);
      render();
    }
  });
  render();
  void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    tabId = tab?.id ?? null;
    if (tabId === null) throw new Error("No active tab");
    await poll();
  }).catch(() => { render(); });
  const timer = setInterval(() => void poll(), 1500);
  globalThis.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
