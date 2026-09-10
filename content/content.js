(() => {
  "use strict";

  const { DEFAULT_SPEED, SPEED_STEP, createSpeedState } = globalThis.VideoSpeedUtils;
  const { ACTIONS, hasUnsupportedModifiers, observeHotkeys } = globalThis.VideoSpeedShortcuts;
  let hotkeys = {};
  const shortcutObserver = observeHotkeys((next) => { hotkeys = next; });
  const shortcutsReady = shortcutObserver.refresh()
    .catch((error) => console.warn("Playback Plus: shortcuts could not be loaded", error));

  const trackedMedia = new WeakSet();
  const observedRoots = new WeakSet();
  const RATE_EPSILON = 0.001;

  let speedState = createSpeedState(DEFAULT_SPEED, DEFAULT_SPEED);
  let revision = -1;
  let isReady = false;

  const mutationObserver = new MutationObserver((records) => {
    if (!isReady) {
      return;
    }

    for (const record of records) {
      for (const node of record.addedNodes) {
        discoverMedia(node);
      }
    }
  });

  function isMediaElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE && (node.localName === "video" || node.localName === "audio");
  }

  function isQueryableNode(node) {
    return node && typeof node.querySelectorAll === "function";
  }

  function valuesDiffer(first, second) {
    return !Number.isFinite(first) || Math.abs(first - second) > RATE_EPSILON;
  }

  function applySpeed(media) {
    if (!isReady || !media) {
      return;
    }

    try {
      if (valuesDiffer(media.defaultPlaybackRate, speedState.speed)) {
        media.defaultPlaybackRate = speedState.speed;
      }

      if (valuesDiffer(media.playbackRate, speedState.speed)) {
        media.playbackRate = speedState.speed;
      }
    } catch {
      // A site may expose a media-like element with protected properties.
    }
  }

  function handleMediaEvent(event) {
    applySpeed(event.currentTarget);
  }

  function trackMedia(media) {
    if (!trackedMedia.has(media)) {
      trackedMedia.add(media);
      media.addEventListener("play", handleMediaEvent);
      media.addEventListener("playing", handleMediaEvent);
      media.addEventListener("loadedmetadata", handleMediaEvent);
      media.addEventListener("durationchange", handleMediaEvent);
      media.addEventListener("ratechange", handleMediaEvent);
    }

    applySpeed(media);
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) {
      return;
    }

    observedRoots.add(root);
    mutationObserver.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function discoverOpenShadowRoots(root) {
    if (!isQueryableNode(root)) {
      return;
    }

    const elements = root.querySelectorAll("*");
    for (const element of elements) {
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        discoverMedia(element.shadowRoot);
      }
    }
  }

  function discoverMedia(node) {
    if (!node) {
      return;
    }

    if (isMediaElement(node)) {
      trackMedia(node);
    }

    if (node.shadowRoot) {
      observeRoot(node.shadowRoot);
      discoverMedia(node.shadowRoot);
    }

    if (isQueryableNode(node)) {
      for (const media of node.querySelectorAll("video, audio")) {
        trackMedia(media);
      }

      discoverOpenShadowRoots(node);
    }
  }

  function applyToAllMedia() {
    discoverMedia(document);
  }

  function getState() {
    return { ...speedState, revision };
  }

  function adoptState(nextState) {
    if (!nextState || nextState.revision < revision) {
      return getState();
    }
    revision = nextState.revision;
    speedState = createSpeedState(nextState.speed, nextState.lastNon1xSpeed);
    applyToAllMedia();
    return getState();
  }

  async function refreshState() {
    const state = await browser.runtime.sendMessage({ type: "VIDEO_SPEED_GET_STATE" });
    return adoptState(state);
  }

  async function initialize() {
    await refreshState();
    isReady = true;
    observeRoot(document);
    applyToAllMedia();
    return getState();
  }

  function isEditableTarget(target) {
    const localName = String(target?.localName ?? "").toLowerCase();
    return Boolean(target?.isContentEditable)
      || localName === "input"
      || localName === "textarea"
      || localName === "select";
  }

  function handleKeyDown(event) {
    if (event.repeat
      || event.isComposing
      || hasUnsupportedModifiers(event)
      || isEditableTarget(event.composedPath?.()[0] ?? event.target)) {
      return;
    }

    const action = ACTIONS.find(name => hotkeys[name] && hotkeys[name] === event.code);
    if (!action) return;
    if (action.startsWith("audio")) {
      if (!globalThis.VideoAudioBridge) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      globalThis.VideoAudioBridge.act(action);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const message = action === "toggle"
      ? { type: "VIDEO_SPEED_TOGGLE" }
      : { type: "VIDEO_SPEED_NUDGE", amount: action === "increase" ? SPEED_STEP : -SPEED_STEP };
    void ready.then(() => browser.runtime.sendMessage(message))
      .catch((error) => console.warn("Playback Plus: shortcut failed", error));
  }

  const ready = initialize();

  globalThis.addEventListener?.("keydown", handleKeyDown, true);

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "VIDEO_SPEED_GET_STATE") {
      return ready.then(getState);
    }
    if (message?.type === "VIDEO_SPEED_STATE_CHANGED") {
      return ready.then(() => adoptState(message.state));
    }
    return undefined;
  });

  // A document restored from the back/forward cache may have missed updates.
  globalThis.addEventListener?.("pageshow", (event) => {
    if (event.persisted) {
      void Promise.all([ready.then(refreshState), shortcutsReady.then(() => shortcutObserver.refresh())])
        .catch((error) => console.warn("Playback Plus:", error));
    }
  });
  void ready.catch((error) => console.warn("Playback Plus: initialization failed", error));
})();
