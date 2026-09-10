(() => {
  "use strict";
  const ids = ["audioButton", "audioSummary", "audioView", "audioBackButton", "audioEnabled", "audioValue",
    "audioExact", "audioDecrease", "audioIncrease", "audioReset", "audioStatus", "audioError", "mainView", "configView",
    "dialogueButton", "dialogueSummary", "dialogueView", "dialogueBackButton", "dialogueEnabled",
    "dialogueMix", "dialogueValue", "dialogueStatus", "dialogueError"];
  const e = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  let tabId = null;
  let state = { enabled: false, delayMs: 0, dialogueEnabled: false, dialogueMix: 100, revision: -1 };
  let draftMix = null;
  let ready = false;
  let busy = false;
  let polling = false;
  let frames = [];
  let writeError = "";
  let statusError = false;
  function adopt(next) {
    if (next && next.revision >= state.revision) state = globalThis.VideoAudioUtils.normalize(next);
  }
  function render() {
    const sum = name => frames.reduce((total, f) => total + (Number.isInteger(f[name]) ? f[name] : 0), 0);
    const connected = sum("connected");
    const eligible = sum("eligible");
    const unavailable = frames.some(f => f.unavailable);
    const partial = unavailable || sum("unsupported") > 0;
    const applying = frames.some(f => f.applying);
    const suspended = frames.some(f => f.connected && f.contextState !== "running");
    const engineError = frames.find(f => f.error)?.error || "";
    const unavailableHelp = "Audio controls aren't available on this page. Try reloading it.";
    const startHelp = "Start a video or audio player to use this feature.";
    const limitedHelp = "Some players on this page may be unaffected.";
    let status;
    if (!ready) status = statusError ? "Audio controls unavailable" : "Loading…";
    else if (!state.enabled) status = `Off · ${state.delayMs} ms selected`;
    else if (statusError) status = "Can't check audio right now";
    else if (applying && engineError) status = "Audio sync unavailable";
    else if (applying) status = "Starting Audio sync…";
    else if (suspended && connected) status = "Click the page to start audio";
    else if (connected) status = `${partial ? "Limited support" : "On"} · ${state.delayMs} ms`;
    else if (unavailable || engineError) status = "Audio sync unavailable";
    else status = "Start a video or audio player";
    e.audioSummary.textContent = status;
    // Normal Off state needs no technical commentary beneath the controls.
    e.audioStatus.textContent = ready && !state.enabled
      ? (!eligible ? (unavailable || !frames.length ? unavailableHelp : startHelp) : "")
      : `${status}${status.endsWith("…") ? "" : "."}${state.enabled && partial && connected && !statusError ? ` ${limitedHelp}` : ""}`;
    e.audioError.textContent = writeError || (statusError
      ? "Couldn't check the audio controls. Close and reopen Playback Plus."
      : state.enabled && engineError ? "Audio sync isn't working. Turn both audio features Off and reload the page." : "");
    e.audioValue.textContent = `${state.delayMs} ms`;
    if (document.activeElement !== e.audioExact || busy) e.audioExact.value = String(state.delayMs);
    e.audioEnabled.textContent = state.enabled ? "On" : "Off";
    e.audioEnabled.setAttribute("aria-checked", String(state.enabled));
    e.audioEnabled.disabled = !ready || busy || (!state.enabled && !eligible);
    const disabled = !ready || busy || (!state.enabled && !eligible);
    e.audioExact.disabled = disabled;
    e.audioDecrease.disabled = disabled || state.delayMs === 0;
    e.audioIncrease.disabled = disabled || state.delayMs === 5000;
    e.audioReset.disabled = disabled || state.delayMs === 0;

    const filtered = sum("dialogueConnected");
    const filterError = frames.find(f => f.dialogueError)?.dialogueError || "";
    const filterPartial = partial || sum("dialogueFailed") > 0 || Boolean(filterError);
    let dialogueStatus;
    if (!ready) dialogueStatus = statusError ? "Audio controls unavailable" : "Loading…";
    else if (!state.dialogueEnabled) dialogueStatus = "Off";
    else if (statusError) dialogueStatus = "Can't check audio right now";
    else if (applying || sum("dialoguePending")) dialogueStatus = "Starting filter…";
    else if (filtered && suspended) dialogueStatus = "Click the page to start audio";
    else if (filtered) dialogueStatus = `${filterPartial ? "Limited support" : "On"} · ${state.dialogueMix}% mix`;
    else if (filterError) dialogueStatus = "Filter unavailable";
    else if (unavailable || engineError) dialogueStatus = "Dialogue focus unavailable";
    else dialogueStatus = "Start a video or audio player";
    e.dialogueSummary.textContent = dialogueStatus;
    e.dialogueStatus.textContent = ready && !state.dialogueEnabled
      ? (!eligible ? (unavailable || !frames.length ? unavailableHelp : startHelp) : "")
      : `${dialogueStatus}${dialogueStatus.endsWith("…") ? "" : "."}${state.dialogueEnabled && filterPartial && filtered && !statusError ? ` ${limitedHelp}` : ""}`;
    e.dialogueError.textContent = writeError || (statusError
      ? "Couldn't check the audio controls. Close and reopen Playback Plus."
      : state.dialogueEnabled && filterError ? "The filter isn't working. Turn it Off and On to try again."
        : state.dialogueEnabled && engineError ? "Audio processing isn't available here. Turn both audio features Off and reload the page." : "");
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
      statusError = false;
      if (result.state.revision >= state.revision) {
        adopt(result.state);
        frames = result.frames;
        ready = true;
      }
    } catch { statusError = true; }
    finally { polling = false; render(); }
  }
  async function change(type, values = {}) {
    if (!ready || busy) return;
    busy = true;
    writeError = "";
    render();
    try {
      adopt(await request(type, values));
      // Do not present the previous revision's engine result as current success.
      frames = frames.map(frame => ({ ...frame, applying: true }));
    } catch { writeError = "Couldn't change this setting. Please try again."; }
    finally { busy = false; render(); void poll(); }
  }
  e.audioButton.addEventListener("click", () => {
    e.mainView.hidden = true;
    e.configView.hidden = true;
    e.audioView.hidden = false;
    e.dialogueView.hidden = true;
    e.audioBackButton.focus();
    void poll();
  });
  e.audioBackButton.addEventListener("click", () => {
    e.audioView.hidden = true;
    e.mainView.hidden = false;
    e.audioButton.focus();
  });
  e.dialogueButton.addEventListener("click", () => {
    e.mainView.hidden = e.configView.hidden = e.audioView.hidden = true;
    e.dialogueView.hidden = false;
    e.dialogueBackButton.focus();
    void poll();
  });
  e.dialogueBackButton.addEventListener("click", () => {
    e.dialogueView.hidden = true;
    e.mainView.hidden = false;
    e.dialogueButton.focus();
  });
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
      writeError = "Enter a whole number from 0 to 5,000 milliseconds.";
      render();
      return;
    }
    if (number !== state.delayMs) void change("AUDIO_SYNC_SET", { delayMs: number });
    else { writeError = ""; render(); }
  }
  e.audioExact.addEventListener("change", exact);
  e.audioExact.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); exact(); }
  });
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === "AUDIO_SYNC_CHANGED" && message.tabId === tabId && message.state.revision > state.revision) {
      adopt(message.state);
      frames = frames.map(frame => ({ ...frame, applying: true }));
      render();
    }
  });
  render();
  void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    tabId = tab?.id ?? null;
    if (tabId === null) throw new Error("No active tab");
    await poll();
  }).catch(() => { writeError = "Open a webpage, then reopen Playback Plus."; render(); });
  const timer = setInterval(() => void poll(), 1500);
  globalThis.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
