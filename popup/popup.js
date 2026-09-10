(() => {
  "use strict";

  const {
    DEFAULT_SPEED,
    MIN_SPEED,
    MAX_SPEED,
    SPEED_STEP,
    speedsMatch,
    createSpeedState,
    updateSpeedState,
    formatSpeed
  } = globalThis.VideoSpeedUtils;

  const elements = {
    availability: document.querySelector("#availability"),
    availabilityText: document.querySelector("#availabilityText"),
    speedValue: document.querySelector("#speedValue"),
    speedRange: document.querySelector("#speedRange"),
    decreaseButton: document.querySelector("#decreaseButton"),
    increaseButton: document.querySelector("#increaseButton"),
    presets: [...document.querySelectorAll("[data-speed]")],
    alternateValue: document.querySelector("#alternateValue"),
    notice: document.querySelector("#notice"),
    toggleKeyButton: document.querySelector("#toggleKeyButton"),
    increaseKeyButton: document.querySelector("#increaseKeyButton"),
    decreaseKeyButton: document.querySelector("#decreaseKeyButton"),
    hotkeyHint: document.querySelector("#hotkeyHint"),
    mainView: document.querySelector("#mainView"),
    configView: document.querySelector("#configView"),
    configButton: document.querySelector("#configButton"),
    backButton: document.querySelector("#backButton"),
    audioView: document.querySelector("#audioView"),
    dialogueView: document.querySelector("#dialogueView")
  };

  const initialSpeedState = createSpeedState(DEFAULT_SPEED, DEFAULT_SPEED);
  const state = {
    speed: initialSpeedState.speed,
    lastNon1xSpeed: initialSpeedState.lastNon1xSpeed,
    tabId: null,
    tabAvailable: null,
    ready: false,
    revision: -1
  };

  const { ACTIONS, assignHotkey, formatHotkey, hasUnsupportedModifiers, observeHotkeys } = globalThis.VideoSpeedShortcuts;
  const keyButtons = { toggle: elements.toggleKeyButton, increase: elements.increaseKeyButton, decrease: elements.decreaseKeyButton,
    audioToggle: document.querySelector("#audioToggleKeyButton"), audioIncrease: document.querySelector("#audioIncreaseKeyButton"), audioDecrease: document.querySelector("#audioDecreaseKeyButton") };
  const actionLabels = { toggle: "Quick toggle", increase: "Increase speed", decrease: "Decrease speed",
    audioToggle: "Toggle audio correction", audioIncrease: "Increase audio delay", audioDecrease: "Decrease audio delay" };
  let hotkeys = Object.fromEntries(ACTIONS.map(action => [action, null]));
  let capturingAction = null;
  let savingKey = false;
  let keyReady = false;
  let suppressActivationCode = null;

  function renderHotkeys() {
    for (const action of ACTIONS) {
      const button = keyButtons[action];
      button.disabled = !keyReady || savingKey;
      button.textContent = capturingAction === action ? "Press key…" : formatHotkey(hotkeys[action]);
      button.setAttribute("aria-pressed", String(capturingAction === action));
      button.setAttribute("aria-label", `${actionLabels[action]} shortcut: ${formatHotkey(hotkeys[action])}. Click to change.`);
    }
    elements.hotkeyHint.textContent = capturingAction
      ? `${actionLabels[capturingAction]}: press one key. Escape exits and clears. Click the same shortcut or Back to cancel without changes.`
      : "Choose a shortcut. Press a key. Escape clears it.";
  }

  function showConfiguration(show) {
    capturingAction = null;
    elements.audioView.hidden = true;
    elements.dialogueView.hidden = true;
    elements.mainView.hidden = show;
    elements.configView.hidden = !show;
    renderHotkeys();
    (show ? elements.backButton : elements.configButton).focus();
  }
  elements.configButton.addEventListener("click", () => showConfiguration(true));
  elements.backButton.addEventListener("click", () => showConfiguration(false));

  for (const action of ACTIONS) {
    keyButtons[action].addEventListener("click", () => {
      if (!keyReady || savingKey) return;
      capturingAction = capturingAction === action ? null : action;
      renderHotkeys();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!capturingAction && event.code !== suppressActivationCode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!capturingAction || event.repeat || event.isComposing) return;
    suppressActivationCode = event.code;
    const code = event.code === "Escape" ? null : event.code;
    try {
      if (code !== null && hasUnsupportedModifiers(event)) throw new Error("Use a single key");
      assignHotkey(hotkeys, capturingAction, code);
    } catch (error) {
      const reason = error.message.includes("already assigned")
        ? "That key is already assigned to another action."
        : "That key combination can't be used.";
      elements.hotkeyHint.textContent = `${reason} Choose another key, or Escape to clear.`;
      return;
    }
    const action = capturingAction;
    capturingAction = null;
    savingKey = true;
    renderHotkeys();
    void browser.runtime.sendMessage({ type: "VIDEO_SPEED_SET_HOTKEY", action, code }).then(() => {
      clearNotice("shortcuts");
    }).catch(() => {
      showNotice("Couldn't change the shortcut. Please try again.", "shortcuts");
    }).finally(() => {
      savingKey = false;
      renderHotkeys();
    });
  }, true);

  // Space/Enter capture must not activate the focused button on key release.
  document.addEventListener("keyup", (event) => {
    if (event.code !== suppressActivationCode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressActivationCode = null;
  }, true);

  renderHotkeys();
  const shortcutObserver = observeHotkeys((next) => {
    hotkeys = next;
    keyReady = true;
    renderHotkeys();
  });
  void shortcutObserver.refresh().catch(() => {
    renderHotkeys();
    showNotice("Couldn't load your shortcuts. Close and reopen Playback Plus to try again.", "shortcuts");
  });

  let latestRequest = 0;
  let noticeSource = null;
  elements.notice.textContent = "";

  function adoptSpeedState(nextState) {
    if (nextState?.revision !== undefined) {
      if (nextState.revision < state.revision) {
        return;
      }
      state.revision = nextState.revision;
    }
    const normalizedState = createSpeedState(
      nextState?.speed,
      nextState?.lastNon1xSpeed
    );
    state.speed = normalizedState.speed;
    state.lastNon1xSpeed = normalizedState.lastNon1xSpeed;
  }

  function renderAvailability() {
    // Ordinary readiness is not customer feedback. Keep only the useful limitation.
    elements.availability.hidden = state.tabAvailable !== false;
    elements.availabilityText.textContent = state.tabAvailable === false ? "Unavailable on this page" : "";
  }

  function render() {
    const speedText = formatSpeed(state.speed);
    // Fixed precision belongs to the deck readout only; notices/keys keep compact labels.
    const readoutText = `${state.speed.toFixed(2)}×`;
    elements.speedValue.value = readoutText;
    elements.speedValue.textContent = readoutText;
    elements.speedRange.value = String(state.speed);
    elements.speedRange.setAttribute("aria-valuetext", speedText);
    elements.alternateValue.textContent = formatSpeed(state.lastNon1xSpeed);

    elements.decreaseButton.disabled = !state.ready || state.speed <= MIN_SPEED;
    elements.increaseButton.disabled = !state.ready || state.speed >= MAX_SPEED;
    elements.speedRange.disabled = !state.ready;

    for (const preset of elements.presets) {
      preset.disabled = !state.ready;
      const isActive = speedsMatch(Number(preset.dataset.speed), state.speed);
      preset.setAttribute("aria-pressed", String(isActive));
    }

    renderAvailability();
  }

  function showNotice(message, source = "speed") {
    noticeSource = source;
    elements.notice.textContent = message;
  }

  function clearNotice(source) {
    if (noticeSource !== source) return;
    noticeSource = null;
    elements.notice.textContent = "";
  }

  function request(type, values = {}) {
    return browser.runtime.sendMessage({ type, tabId: state.tabId, ...values });
  }

  async function getActiveTabId() {
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    return activeTab?.id ?? null;
  }

  async function detectTabAvailability() {
    try {
      if (state.tabId === null) {
        throw new Error("No active tab");
      }

      await browser.tabs.sendMessage(state.tabId, {
        type: "VIDEO_SPEED_GET_STATE"
      });
      state.tabAvailable = true;
    } catch {
      state.tabAvailable = false;
    }

    render();
  }

  async function reloadTabState() {
    adoptSpeedState(await request("VIDEO_SPEED_GET_STATE"));
    render();
  }

  async function chooseSpeed(value) {
    if (!state.ready) {
      return;
    }
    const requestNumber = ++latestRequest;
    const nextState = updateSpeedState(state, value);
    adoptSpeedState(nextState);
    render();

    try {
      const saved = await request("VIDEO_SPEED_SET", { speed: nextState.speed });
      if (requestNumber === latestRequest) {
        adoptSpeedState(saved);
        render();
        if (saved.defaultSaved === false) {
          showNotice("The speed changed, but it couldn't be remembered for new tabs.");
        } else {
          clearNotice("speed");
        }
      }
    } catch {
      if (requestNumber !== latestRequest) {
        return;
      }
      try {
        await reloadTabState();
      } catch {
        state.ready = false;
        render();
      }
      showNotice("Couldn't change the speed. Please try again.");
    }
  }

  async function initialize() {
    render();
    try {
      state.tabId = await getActiveTabId();
      if (state.tabId === null) {
        throw new Error("No active tab");
      }
      await reloadTabState();
      state.ready = true;
      render();
      await detectTabAvailability();
    } catch {
      state.tabAvailable = false;
      render();
      showNotice("Couldn't load the playback controls. Close and reopen Playback Plus to try again.");
    }
  }

  elements.speedRange.addEventListener("input", (event) => {
    void chooseSpeed(event.currentTarget.value);
  });

  elements.decreaseButton.addEventListener("click", () => {
    void chooseSpeed(state.speed - SPEED_STEP);
  });

  elements.increaseButton.addEventListener("click", () => {
    void chooseSpeed(state.speed + SPEED_STEP);
  });

  for (const preset of elements.presets) {
    preset.addEventListener("click", () => {
      void chooseSpeed(preset.dataset.speed);
    });
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "VIDEO_SPEED_STATE_CHANGED" && message.tabId === state.tabId) {
      adoptSpeedState(message.state);
      render();
    }
    return undefined;
  });

  void initialize();
})();
