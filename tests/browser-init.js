// Lightweight single-tab mock for manual popup/real-DOM previews, not Firefox API validation.
(() => {
  const listeners = [];
  const storageListeners = [];
  const preferences = { playbackSpeed: 2, lastNon1xSpeed: 2, savedSpeedDefault: { enabled: true, speed: 1 } };
  let state = { speed: 2, lastNon1xSpeed: 2, revision: 0 };
  let audio = { enabled: false, delayMs: 0, dialogueEnabled: false, dialogueMix: 100, revision: 0 }; // UI fiction, no audio graph.
  const tabId = 42;
  let audioReport = {}; // Preview-only status injection; never packaged.

  async function request(message) {
    const utils = window.VideoSpeedUtils;
    if (message.type === "AUDIO_SYNC_GET") return { ...audio };
    if (message.type === "AUDIO_SYNC_STATUS_GET") return { state: { ...audio }, frames: [{
      ...audio, media: 1, eligible: 1, connected: audio.enabled || audio.dialogueEnabled ? 1 : 0, dialogueConnected: audio.dialogueEnabled ? 1 : 0, contextState: audio.enabled || audio.dialogueEnabled ? "running" : "native", ...audioReport
    }] };
    if (["AUDIO_SYNC_SET", "AUDIO_SYNC_NUDGE", "AUDIO_SYNC_ENABLE", "AUDIO_SYNC_TOGGLE", "DIALOGUE_ENABLE", "DIALOGUE_MIX"].includes(message.type)) {
      audio = window.VideoAudioUtils.transition(audio, message);
      for (const listener of listeners) void listener({ type: "AUDIO_SYNC_CHANGED", tabId, state: { ...audio } });
      return { ...audio };
    }
    if (message.type === "VIDEO_SPEED_SET_HOTKEY") {
      const hotkeys = window.VideoSpeedShortcuts.assignHotkey(preferences.hotkeys, message.action, message.code);
      const oldValue = preferences.hotkeys;
      preferences.hotkeys = hotkeys;
      for (const listener of storageListeners) listener({ hotkeys: { oldValue, newValue: hotkeys } }, "sync");
      return { hotkeys };
    }
    if (message.type === "VIDEO_SPEED_DEFAULT_GET") return utils.readSpeedDefaults(preferences);
    if (message.type === "VIDEO_SPEED_DEFAULT_SET") {
      const oldValue = preferences.savedSpeedDefault;
      if ("enabled" in message) throw new Error("Invalid Save Default action");
      preferences.savedSpeedDefault = { enabled: true, speed: state.speed };
      for (const listener of storageListeners) listener({ savedSpeedDefault: { oldValue, newValue: preferences.savedSpeedDefault } }, "sync");
      return utils.readSpeedDefaults(preferences);
    }
    if (message.type === "VIDEO_SPEED_GET_STATE") return { ...state };
    let next;
    if (message.type === "VIDEO_SPEED_SET") next = utils.updateSpeedState(state, message.speed);
    else if (message.type === "VIDEO_SPEED_TOGGLE") next = utils.toggleSpeedState(state);
    else if (message.type === "VIDEO_SPEED_NUDGE") next = utils.updateSpeedState(state, state.speed + message.amount);
    else return undefined;
    state = { ...next, revision: state.revision + 1 };
    const oldValue = preferences.playbackSpeed;
    Object.assign(preferences, utils.toStoredSpeedState(state));
    for (const listener of storageListeners) listener({ playbackSpeed: { oldValue, newValue: state.speed } }, "sync");
    const change = { type: "VIDEO_SPEED_STATE_CHANGED", tabId, state: { ...state } };
    for (const listener of listeners) void listener(change);
    return { ...state, defaultSaved: true };
  }

  window.__videoSpeedMock = {
    get currentSpeed() { return state.speed; },
    get lastNon1xSpeed() { return state.lastNon1xSpeed; }
  };
  window.browser = {
    storage: {
      sync: { async get() { return { ...preferences }; } },
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    },
    runtime: {
      sendMessage: request,
      onMessage: { addListener(listener) { listeners.push(listener); } }
    },
    tabs: {
      async query() { return [{ id: tabId }]; },
      async sendMessage() { return { ...state }; }
    }
  };
  window.fixtureApi = {
    message: request,
    setAudioReport(report) { audioReport = { ...report }; },
    changeSpeed(speed) { return request({ type: "VIDEO_SPEED_SET", speed }); },
    get storedValues() {
      return { playbackSpeed: state.speed, lastNon1xSpeed: state.lastNon1xSpeed };
    }
  };
})();
