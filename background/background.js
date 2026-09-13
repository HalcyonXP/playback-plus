(() => {
  "use strict";

  const {
    SAVED_DEFAULT_KEY,
    readSpeedDefaults,
    seedSpeedState,
    STORAGE_KEY,
    LAST_NON_1X_SPEED_KEY,
    LEGACY_STORAGE_KEY,
    createSpeedState,
    readSpeedState,
    updateSpeedState,
    toggleSpeedState,
    toStoredSpeedState
  } = globalThis.VideoSpeedUtils;

  const ALL_STORAGE_KEYS = [STORAGE_KEY, LAST_NON_1X_SPEED_KEY, LEGACY_STORAGE_KEY, SAVED_DEFAULT_KEY];
  const TAB_STATE_KEY = "videoSpeedState";
  const REQUEST_TYPES = new Set([
    "VIDEO_SPEED_GET_STATE", "VIDEO_SPEED_SET", "VIDEO_SPEED_NUDGE", "VIDEO_SPEED_TOGGLE"
  ]);
  let updateQueue = Promise.resolve();

  // One writer orders defaults, tab initialization, and adjustments from every frame.
  // Session values, rather than background memory, survive event-page suspension.
  function enqueue(operation) {
    const result = updateQueue.then(operation);
    updateQueue = result.catch((error) => console.warn("Playback Plus:", error));
    return result;
  }

  globalThis.installVideoAudioBackground(enqueue);

  async function getDefaultState() {
    // Also persist migration if older settings arrive through Sync after startup.
    await ensureStoredState();
    return seedSpeedState(await browser.storage.sync.get(ALL_STORAGE_KEYS));
  }

  async function ensureStoredState() {
    const stored = await browser.storage.sync.get(ALL_STORAGE_KEYS);
    const defaults = readSpeedDefaults(stored);
    const normalized = {
      ...toStoredSpeedState(readSpeedState(stored)),
      [SAVED_DEFAULT_KEY]: { enabled: defaults.enabled, speed: defaults.speed }
    };
    if (stored[STORAGE_KEY] !== normalized[STORAGE_KEY]
      || stored[LAST_NON_1X_SPEED_KEY] !== normalized[LAST_NON_1X_SPEED_KEY]
      || stored[SAVED_DEFAULT_KEY]?.enabled !== defaults.enabled
      || stored[SAVED_DEFAULT_KEY]?.speed !== defaults.speed) {
      await browser.storage.sync.set(normalized);
    }
    if (stored[LEGACY_STORAGE_KEY] !== undefined) {
      await browser.storage.sync.remove(LEGACY_STORAGE_KEY);
    }
  }

  async function getTabState(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("No valid target tab");
    }
    const saved = await browser.sessions.getTabValue(tabId, TAB_STATE_KEY);
    if (saved) {
      return {
        ...createSpeedState(saved.speed, saved.lastNon1xSpeed),
        revision: Number.isSafeInteger(saved.revision) ? saved.revision : 0
      };
    }
    const initial = { ...await getDefaultState(), revision: 0 };
    await browser.sessions.setTabValue(tabId, TAB_STATE_KEY, initial);
    return initial;
  }

  function publish(tabId, state) {
    const message = { type: "VIDEO_SPEED_STATE_CHANGED", tabId, state };
    // Do not await delivery: a newly loading frame may still be awaiting its
    // queued GET_STATE request. Revisions let recipients reject stale delivery.
    void browser.tabs.sendMessage(tabId, message).catch(() => undefined);
    void browser.runtime.sendMessage(message).catch(() => undefined);
  }

  async function handleRequest(tabId, message) {
    const current = await getTabState(tabId);
    if (message.type === "VIDEO_SPEED_GET_STATE") {
      return current;
    }
    let next;
    switch (message.type) {
      case "VIDEO_SPEED_SET":
        next = updateSpeedState(current, message.speed);
        break;
      case "VIDEO_SPEED_NUDGE":
        next = updateSpeedState(current, current.speed + Number(message.amount));
        break;
      case "VIDEO_SPEED_TOGGLE":
        next = toggleSpeedState(current);
        break;
      default:
        throw new Error("Unknown speed action");
    }
    next.revision = current.revision + 1;
    await browser.sessions.setTabValue(tabId, TAB_STATE_KEY, next);
    let defaultSaved = true;
    try {
      // Retain explicit-choice history for upgrade continuity and the alternate;
      // NEVER overwrite the saved new-tab snapshot.
      // Reads, tab creation and switching tabs do not write this history.
      await browser.storage.sync.set(toStoredSpeedState(next));
    } catch (error) {
      defaultSaved = false;
      console.warn("Playback Plus: tab saved, but last-used speed could not be saved", error);
    }
    publish(tabId, next);
    return { ...next, defaultSaved };
  }

  enqueue(async () => {
    await ensureStoredState();
    // Pin already-open tabs, including tabs with no accessible media yet.
    for (const tab of await browser.tabs.query({})) {
      try {
        await getTabState(tab.id);
      } catch (error) {
        console.warn("Playback Plus: could not initialize tab", error);
      }
    }
  });

  // Normalize old/deleted snapshot settings arriving from another installation.
  // Do not return/await the writer from a storage notification (it may be the
  // writer's own set operation). Normal explicit speed history needs no rewrite.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (SAVED_DEFAULT_KEY in changes || LEGACY_STORAGE_KEY in changes)) {
      void enqueue(ensureStoredState).catch(() => undefined);
    }
  });
  browser.runtime.onInstalled.addListener(() => enqueue(ensureStoredState));
  browser.tabs.onCreated.addListener((tab) => enqueue(() => getTabState(tab.id)));

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "VIDEO_SPEED_DEFAULT_GET" || message?.type === "VIDEO_SPEED_DEFAULT_SET") {
      // Shared preferences are configurable only by verified extension pages.
      if (!sender.url?.startsWith(browser.runtime.getURL(""))) {
        return Promise.reject(new Error("Only extension pages can configure Save Default"));
      }
      return enqueue(async () => {
        await ensureStoredState();
        const defaults = readSpeedDefaults(await browser.storage.sync.get(ALL_STORAGE_KEYS));
        if (message.type === "VIDEO_SPEED_DEFAULT_GET") return defaults;
        // Reject obsolete toggle messages rather than silently treating Off as Save.
        if ("enabled" in message) throw new Error("Invalid Save Default action");
        // Every click captures the target's authoritative state at its queue position;
        // never trust a popup's optimistic readout or a supplied speed value.
        const speed = (await getTabState(message.tabId)).speed;
        await browser.storage.sync.set({ [SAVED_DEFAULT_KEY]: { enabled: true, speed } });
        return { ...defaults, speed };
      });
    }
    if (message?.type === "VIDEO_SPEED_SET_HOTKEY") {
      // Only extension pages configure shared shortcuts, never content frames.
      if (sender.tab && !sender.url?.startsWith(browser.runtime.getURL(""))) {
        return Promise.reject(new Error("Only extension pages can set shortcuts"));
      }
      const { HOTKEYS_KEY, assignHotkey } = globalThis.VideoSpeedShortcuts;
      return enqueue(async () => {
        const stored = await browser.storage.sync.get(HOTKEYS_KEY);
        const hotkeys = assignHotkey(stored[HOTKEYS_KEY], message.action, message.code);
        await browser.storage.sync.set({ [HOTKEYS_KEY]: hotkeys });
        return { hotkeys };
      });
    }
    if (!REQUEST_TYPES.has(message?.type)) {
      return undefined;
    }
    // Content scripts can only act on their own tab. Verified extension pages
    // (including a popup embedded in an extension page) may target the active tab.
    const extensionPage = sender.url?.startsWith(browser.runtime.getURL(""));
    const tabId = sender.tab && !extensionPage ? sender.tab.id : message.tabId;
    return enqueue(() => handleRequest(tabId, message));
  });

})();
