(() => {
  "use strict";

  const {
    DEFAULT_SPEED,
    SAVED_DEFAULT_KEY,
    MIN_SPEED,
    MAX_SPEED,
    SPEED_STEP,
    speedsMatch,
    createSpeedState,
    updateSpeedState,
    formatSpeed
  } = globalThis.VideoSpeedUtils;

  const elements = {
    saveDefault: document.querySelector("#saveDefault"),
    defaultSpeed: document.querySelector("#defaultSpeed"),
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
    hotkeyFeedback: document.querySelector("#hotkeyFeedback"),
    mainView: document.querySelector("#mainView"),
    configView: document.querySelector("#configView"),
    configButton: document.querySelector("#configButton"),
    backButton: document.querySelector("#backButton")
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
  let keyFeedbackKind = null;

  function showKeyFeedback(message, kind) {
    keyFeedbackKind = kind;
    elements.hotkeyFeedback.textContent = message;
  }

  function clearKeyFeedback(kind) {
    if (kind && keyFeedbackKind !== kind) return;
    keyFeedbackKind = null;
    elements.hotkeyFeedback.textContent = "";
  }
  clearKeyFeedback();

  function renderHotkeys() {
    for (const action of ACTIONS) {
      const button = keyButtons[action];
      button.disabled = !keyReady || savingKey;
      button.textContent = capturingAction === action ? "Press key…" : formatHotkey(hotkeys[action]);
      button.setAttribute("aria-pressed", String(capturingAction === action));
      const label = capturingAction === action
        ? `${actionLabels[action]} shortcut: Press a key. Escape clears this binding. Click again or go Back to cancel.`
        : `${actionLabels[action]} shortcut: ${formatHotkey(hotkeys[action])}. Click to change.`;
      button.setAttribute("aria-label", label);
      button.title = label; // Full names remain available when the fixed-width label is ellipsized.
    }
    // The instruction below Configuration is static HTML, never capture/status text.
  }

  function showConfiguration(show) {
    capturingAction = null;
    clearKeyFeedback("validation");
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
      clearKeyFeedback("validation");
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
      showKeyFeedback(`${actionLabels[capturingAction]}: ${reason} Choose another key, or Escape to clear.`, "validation");
      return;
    }
    const action = capturingAction;
    capturingAction = null;
    savingKey = true;
    clearKeyFeedback();
    renderHotkeys();
    void browser.runtime.sendMessage({ type: "VIDEO_SPEED_SET_HOTKEY", action, code }).then(() => {
      clearKeyFeedback("save");
    }).catch(() => {
      showKeyFeedback("Couldn't change the shortcut. Please try again.", "save");
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
    clearKeyFeedback("load");
    renderHotkeys();
  });
  void shortcutObserver.refresh().catch(() => {
    renderHotkeys();
    showKeyFeedback("Couldn't load your shortcuts. Close and reopen Playback Plus to try again.", "load");
  });

  let latestRequest = 0;
  let pendingSpeedRequests = 0;
  let deferredSpeedState = null;
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
    // Routine page/bridge unavailability stays quiet. Settings remain usable;
    // persistence and actionable failures are reported separately in notice.
    elements.availability.hidden = true;
    elements.availabilityText.textContent = "";
  }

  let defaults = null;
  let defaultsReady = false;
  let savingDefault = false;
  let defaultsRequest = 0;

  function renderDefaults() {
    elements.saveDefault.disabled = !state.ready || !defaultsReady || savingDefault;
    elements.saveDefault.setAttribute("aria-busy", String(savingDefault));
    elements.saveDefault.textContent = "Save";
    elements.defaultSpeed.textContent = defaultsReady ? formatSpeed(defaults.speed) : "—";
  }

  async function refreshDefaults() {
    const generation = ++defaultsRequest;
    try {
      const next = await request("VIDEO_SPEED_DEFAULT_GET");
      if (generation !== defaultsRequest) return;
      defaults = next;
      defaultsReady = true;
      clearNotice("defaults-load");
      renderDefaults();
    } catch {
      if (generation !== defaultsRequest) return;
      defaultsReady = false;
      renderDefaults();
      showNotice("Couldn't load the new-tab default. Close and reopen Playback Plus to try again.", "defaults-load");
    }
  }

  elements.saveDefault.addEventListener("click", async () => {
    if (!state.ready || !defaultsReady || savingDefault) return;
    savingDefault = true;
    renderDefaults();
    try {
      await request("VIDEO_SPEED_DEFAULT_SET");
      clearNotice("defaults-save");
    } catch {
      showNotice("Couldn't save the new-tab default. Check the displayed setting and try again.", "defaults-save");
    } finally {
      // Re-read rather than adopting a potentially stale reply from another popup.
      await refreshDefaults();
      savingDefault = false;
      renderDefaults();
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && SAVED_DEFAULT_KEY in changes) {
      // Never await a queued read from a storage notification inside the writer.
      void refreshDefaults();
    }
  });

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let faderTarget = null;
  let visualSpeed = DEFAULT_SPEED;
  let faderAnimation = null;

  function stopFaderAnimation() {
    if (faderAnimation !== null) cancelAnimationFrame(faderAnimation);
    faderAnimation = null;
    visualSpeed = state.speed;
    elements.speedRange.style.setProperty("--speed-thumb-offset", "0px");
  }

  function renderFader(animate) {
    // Keep the native range's value/step truthful throughout the purely visual glide.
    elements.speedRange.value = String(state.speed);
    if (faderTarget === state.speed) return; // acknowledgements must not interrupt a glide
    const initialized = faderTarget !== null;
    faderTarget = state.speed;
    if (!animate || !initialized || reducedMotion.matches) {
      stopFaderAnimation();
      return;
    }
    if (faderAnimation !== null) cancelAnimationFrame(faderAnimation);
    const startSpeed = visualSpeed;
    const target = state.speed;
    const start = performance.now();
    // Firefox's cap is 16px + two 1px borders. Native range semantics stay intact.
    const travel = Math.max(0, elements.speedRange.clientWidth - 18);
    const offset = () => elements.speedRange.style.setProperty("--speed-thumb-offset", `${(visualSpeed - target) / (MAX_SPEED - MIN_SPEED) * travel}px`);
    offset();
    function frame(now) {
      const progress = Math.min(1, (now - start) / 220);
      visualSpeed = startSpeed + (target - startSpeed) * (1 - (1 - progress) ** 3);
      offset();
      if (progress < 1) faderAnimation = requestAnimationFrame(frame);
      else stopFaderAnimation();
    }
    faderAnimation = requestAnimationFrame(frame);
  }

  // Direct manipulation is never animated, even if it interrupts a preset glide.
  elements.speedRange.addEventListener("pointerdown", stopFaderAnimation);
  elements.speedRange.addEventListener("keydown", stopFaderAnimation);
  reducedMotion.addEventListener("change", stopFaderAnimation);
  addEventListener("pagehide", stopFaderAnimation);

  function render(animate = false) {
    const speedText = formatSpeed(state.speed);
    // Fixed precision belongs to the deck readout only; notices/keys keep compact labels.
    const readoutText = `${state.speed.toFixed(2)}×`;
    elements.speedValue.value = readoutText;
    elements.speedValue.textContent = readoutText;
    renderFader(animate);
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
    renderDefaults();
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

  async function chooseSpeed(value, animate = false) {
    if (!state.ready) {
      return;
    }
    const requestNumber = ++latestRequest;
    pendingSpeedRequests++;
    const nextState = updateSpeedState(state, value);
    adoptSpeedState(nextState);
    render(animate);

    try {
      const saved = await request("VIDEO_SPEED_SET", { speed: nextState.speed });
      if (requestNumber === latestRequest) {
        adoptSpeedState(saved);
        render();
        if (saved.defaultSaved === false) {
          showNotice("The speed changed, but the last-used speed couldn't be saved. Your fixed default is unchanged.");
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
    } finally {
      pendingSpeedRequests--;
      if (!pendingSpeedRequests && deferredSpeedState) {
        adoptSpeedState(deferredSpeedState);
        deferredSpeedState = null;
        render();
      }
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
      await refreshDefaults();
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
    void chooseSpeed(state.speed - SPEED_STEP, true);
  });

  elements.increaseButton.addEventListener("click", () => {
    void chooseSpeed(state.speed + SPEED_STEP, true);
  });

  for (const preset of elements.presets) {
    preset.addEventListener("click", () => {
      void chooseSpeed(preset.dataset.speed, true);
    });
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "VIDEO_SPEED_STATE_CHANGED" && message.tabId === state.tabId) {
      if (pendingSpeedRequests) {
        if (!deferredSpeedState || message.state.revision >= deferredSpeedState.revision) deferredSpeedState = message.state;
      } else {
        adoptSpeedState(message.state);
        render();
      }
    }
    return undefined;
  });

  void initialize();
})();
