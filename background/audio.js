(() => {
  "use strict";
  const KEY = "videoAudioState";
  const TYPES = new Set(["AUDIO_SYNC_GET", "AUDIO_SYNC_SET", "AUDIO_SYNC_NUDGE", "AUDIO_SYNC_ENABLE", "AUDIO_SYNC_TOGGLE", "DIALOGUE_ENABLE", "DIALOGUE_MIX"]);
  const { normalize, transition } = globalThis.VideoAudioUtils;
  globalThis.installVideoAudioBackground = (enqueue) => {
    async function get(tabId) {
      if (!Number.isInteger(tabId) || tabId < 0) throw new Error("No valid target tab");
      const saved = await browser.sessions.getTabValue(tabId, KEY);
      if (saved) return normalize(saved);
      const tab = await browser.tabs.get(tabId);
      const state = normalize({ pageUrl: tab.url });
      await browser.sessions.setTabValue(tabId, KEY, state);
      return state;
    }
    function publish(tabId, state) {
      const message = { type: "AUDIO_SYNC_CHANGED", tabId, state };
      // Never await delivery inside the writer queue (frames may be waiting on GET).
      void browser.tabs.sendMessage(tabId, message).catch(() => {});
      void browser.runtime.sendMessage(message).catch(() => {});
    }
    async function navigate(details, committed) {
      if (details.frameId !== 0) return;
      const state = await get(details.tabId);
      if (committed && details.transitionType === "reload" && state.pageUrl === details.url) return;
      if (!committed && state.pageUrl === details.url) return;
      const next = normalize({ pageUrl: details.url, revision: state.revision + 1 });
      await browser.sessions.setTabValue(details.tabId, KEY, next);
      publish(details.tabId, next);
    }
    const onNavigation = committed => details => {
      void enqueue(() => navigate(details, committed)).catch(() => {}); // Tab may close mid-navigation.
    };
    browser.webNavigation.onCommitted.addListener(onNavigation(true));
    browser.webNavigation.onHistoryStateUpdated.addListener(onNavigation(false));
    browser.webNavigation.onReferenceFragmentUpdated.addListener(onNavigation(false));

    async function status(tabId) {
      const state = await enqueue(() => get(tabId));
      const frames = await browser.webNavigation.getAllFrames({ tabId }).catch(() => null);
      // Query each frame, not the arbitrary single response of a tab-wide sendMessage.
      const results = await Promise.all((frames || [{ frameId: 0 }]).map(async frame => {
        try {
          let timer;
          let reply;
          try {
            reply = await Promise.race([
              browser.tabs.sendMessage(tabId, { type: "AUDIO_SYNC_STATUS" }, { frameId: frame.frameId }),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Frame timed out")), 2500); })
            ]);
          } finally { clearTimeout(timer); }
          if (!reply || reply.revision !== state.revision) return { unavailable: true };
          return reply;
        } catch { return { unavailable: true }; }
      }));
      return { state, frames: results };
    }
    browser.runtime.onMessage.addListener((message, sender) => {
      if (!TYPES.has(message?.type) && message?.type !== "AUDIO_SYNC_STATUS_GET") return undefined;
      const extensionPage = sender.url?.startsWith(browser.runtime.getURL(""));
      const tabId = sender.tab && !extensionPage ? sender.tab.id : message.tabId;
      if (message.type === "AUDIO_SYNC_STATUS_GET") return status(tabId);
      return enqueue(async () => {
        const state = await get(tabId);
        if (message.type === "AUDIO_SYNC_GET") return state;
        const next = transition(state, message);
        await browser.sessions.setTabValue(tabId, KEY, next);
        publish(tabId, next);
        return next;
      });
    });
  };
})();
