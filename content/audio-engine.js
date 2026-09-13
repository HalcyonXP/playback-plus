(() => {
  "use strict";
  if (globalThis.__videoAudioEngine) return;
  globalThis.__videoAudioEngine = true;
  const SOURCE = "video-speed-audio-v1";
  const records = new WeakMap();
  const attached = new Set();
  let enabled = false;
  let delayMs = 0;
  let dialogueEnabled = false;
  let dialogueMix = 100;
  let dialogueRun = -1;
  let dialogueModule = null;
  let dialogueError = "";
  let context = null;
  let moduleReady = null;
  let workletUrl = "";
  let queue = Promise.resolve();
  let lastError = "";
  let pageHidden = false;
  let generation = 0;

  function mediaElements() {
    const result = [];
    function visit(root) {
      result.push(...root.querySelectorAll("video, audio"));
      for (const node of root.querySelectorAll("*")) if (node.shadowRoot) visit(node.shadowRoot);
    }
    visit(document);
    return result;
  }
  function unsafeReason(media, checkLoaded = true) {
    if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) return "Web Audio is unavailable on this page";
    if (media.mediaKeys) return "Protected media is not supported";
    if (checkLoaded && (media.error || media.readyState === 0 || (!media.currentSrc && !media.srcObject))) return "Media has no playable loaded source";
    if (media.currentSrc && !media.crossOrigin) {
      try {
        const url = new URL(media.currentSrc, location.href);
        if (url.origin !== location.origin) return "Cross-origin media without CORS was left native";
      } catch { return "Unknown media source was left native"; }
    }
    return "";
  }
  function post(record, type, payload = {}) {
    record.node.port.postMessage({ type, ...payload });
    if (type !== "delay") record.filter?.port.postMessage({ type, ...payload });
  }
  function removeFilter(record, error = "") {
    if (error) record.filterError = error;
    if (!record.filter) return;
    const filter = record.filter;
    record.filter = null;
    record.filterReady = false;
    clearTimeout(record.filterTimer);
    filter.onprocessorerror = null;
    filter.port.onmessage = null;
    try { record.node.disconnect(); } catch {}
    try { filter.disconnect(); filter.port.postMessage({ type: "dispose" }); } catch {}
    if (record.connected) record.node.connect(context.destination);
  }
  async function loadDialogue() {
    if (!dialogueEnabled || dialogueError) return;
    if (!dialogueModule) {
      // Failure is sticky until Off/On, preventing repeated compilation every poll.
      dialogueModule = context.audioWorklet.addModule(new URL("dialogue-processor.js", workletUrl).href);
    }
    const module = dialogueModule;
    let timer;
    try {
      await Promise.race([module, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("module loading timed out")), 4000);
      })]);
    } catch (error) {
      if (dialogueEnabled && dialogueModule === module) {
        dialogueError = `RNNoise unavailable: ${error.message || "module loading failed"}. Using unfiltered audio.`;
      }
    } finally { clearTimeout(timer); }
  }
  function setFilter(record) {
    if (!dialogueEnabled) { removeFilter(record); record.filterError = ""; return; }
    if (record.filter) { record.filter.port.postMessage({ type: "mix", value: dialogueMix }); return; }
    if (dialogueError || record.filterError || record.error || !record.connected) return;
    let filter;
    try {
      filter = new AudioWorkletNode(context, "video-dialogue-focus", {
        channelCount: 2, channelCountMode: "explicit", outputChannelCount: [2],
        processorOptions: { mix: dialogueMix }
      });
      record.filter = filter;
      record.filterReady = false;
      const fail = message => {
        if (record.filter !== filter) return;
        removeFilter(record, `${message}. Using unfiltered audio; turn Voice Clarity Off/On to retry.`);
      };
      filter.onprocessorerror = () => fail("RNNoise processor failed");
      filter.port.onmessage = ({ data: m }) => {
        if (record.filter !== filter) return;
        if (m?.type === "ready" && !record.filterReady) {
          clearTimeout(record.filterTimer);
          record.filterReady = true;
          // Keep the original route until the processor is ready.
          try {
            record.node.disconnect();
            record.node.connect(filter);
            filter.connect(context.destination);
            filter.port.postMessage({ type: "volume", value: record.media.muted ? 0 : record.media.volume });
            filter.port.postMessage({ type: record.playing ? "start" : "stop" });
          } catch { fail("RNNoise connection failed"); }
        } else if (m?.type === "failed") fail("RNNoise processing failed");
      };
      record.filterTimer = setTimeout(() => fail("RNNoise did not become ready"), 4000);
    } catch (error) {
      if (record.filter) removeFilter(record, "RNNoise could not start. Using unfiltered audio.");
      else record.filterError = "RNNoise could not start. Using unfiltered audio.";
    }
  }
  function setVolume(record) { post(record, "volume", { value: record.media.muted ? 0 : record.media.volume }); }
  function setDelay(record) { post(record, "delay", { frames: Math.round((enabled ? delayMs : 0) * context.sampleRate / 1000) }); }
  function stop(record) {
    record.playing = false;
    post(record, "stop");
  }
  function start(record) {
    if (pageHidden || !record.connected || record.media.paused || record.media.ended || record.media.seeking) return;
    if (!record.playing) {
      record.playing = true;
      post(record, "start");
    }
    setVolume(record);
    void context.resume().catch(() => {});
  }
  function schedule(operation) {
    const result = queue.then(operation);
    queue = result.catch(error => { lastError = error.message || String(error); });
    return result;
  }
  async function createContext() {
    if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new Error("Web Audio is unavailable on this page");
    if (!workletUrl) throw new Error("Audio processor not initialized; reload this tab");
    if (!context) {
      context = new AudioContext({ sampleRate: 48000 });
      moduleReady = context.audioWorklet.addModule(workletUrl);
    }
    await moduleReady; // Fail before attaching any media source.
  }
  function connect(media) {
    let record = records.get(media);
    if (record?.error) return;
    if (record) {
      if (!record.connected) {
        record.node.connect(context.destination);
        record.connected = true;
        attached.add(record);
      }
      setFilter(record);
      setDelay(record);
      setVolume(record);
      start(record);
      return;
    }
    let node;
    let source;
    try {
      // Create/connect the destination first: do not reroute media until the processor exists.
      node = new AudioWorkletNode(context, "video-audio-delay", {
        channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers",
        processorOptions: { maxFrames: Math.ceil(context.sampleRate * 5) }
      });
      node.connect(context.destination);
      source = context.createMediaElementSource(media);
      source.connect(node);
      record = { media, source, node, playing: false, connected: true };
      records.set(media, record);
      attached.add(record);
      setDelay(record);
      setVolume(record);
      const fail = () => {
        record.error = "Audio routing failed; disable correction and reload this tab";
        lastError = record.error;
        stop(record);
      };
      node.onprocessorerror = () => {
        // A dead delay worklet outputs silence permanently. Preserve sound via
        // the existing media source, not a second attachment or a native claim.
        removeFilter(record);
        record.error = "Audio processor failed; using unfiltered audio without delay. Reload to restore processing.";
        lastError = record.error;
        try { source.disconnect(); node.disconnect(); source.connect(context.destination); } catch {}
      };
      media.addEventListener("encrypted", fail);
      for (const event of ["pause", "waiting", "seeking", "emptied", "ended", "abort"]) {
        media.addEventListener(event, () => stop(record));
      }
      for (const event of ["play", "playing", "seeked"]) media.addEventListener(event, () => {
        // Sources can change to cross-origin/protected content after attachment.
        // play can precede loaded data during a same-origin source swap.
        if (unsafeReason(media, false) || media.error) { fail(); return; }
        start(record);
      });
      media.addEventListener("volumechange", () => setVolume(record));
      setFilter(record);
      start(record);
    } catch (error) {
      try { node?.disconnect(); node?.port.close(); } catch {}
      // If attachment already happened, do our best to preserve sound, without claiming recovery.
      if (source) { try { source.disconnect(); source.connect(context.destination); } catch {} }
      records.set(media, { error: `${error.message || "Audio routing failed"}. Reload if sound is lost.` });
    }
  }
  async function scan() {
    if (pageHidden) return;
    const currentGeneration = generation;
    const media = mediaElements();
    const found = new Set(media);
    for (const record of attached) {
      if (!found.has(record.media)) {
        stop(record);
        record.connected = false;
        removeFilter(record);
        record.node.disconnect();
        attached.delete(record);
      }
    }
    if (enabled || dialogueEnabled) {
      const candidates = media.filter(item => !unsafeReason(item) && !records.get(item)?.error);
      if (candidates.length) {
        await createContext();
        await loadDialogue();
        if (pageHidden || currentGeneration !== generation || (!enabled && !dialogueEnabled)) return;
        for (const item of candidates) connect(item);
      }
    }
    // Reinserted, previously routed media must reconnect even while Off, or it is silent.
    if (!enabled && !dialogueEnabled && context) for (const item of media) {
      const record = records.get(item);
      if (record && !record.error && !record.connected) connect(item);
    }
    // Off changes only already-attached media. Newly discovered media remains native.
    for (const record of attached) {
      setFilter(record);
      setDelay(record);
      setVolume(record);
      if (unsafeReason(record.media, false) && record.media.currentSrc) {
        record.error = "Source changed to unsupported media; reload this tab if audio fails";
      }
      if (!record.error) start(record);
    }
    if (context && attached.size) void context.resume().catch(() => {});
  }
  function status() {
    const media = mediaElements();
    let connected = 0;
    let eligible = 0;
    let unsupported = 0;
    const errors = [];
    for (const item of media) {
      const record = records.get(item);
      const reason = record?.error || unsafeReason(item);
      if (reason) { unsupported++; if (!errors.includes(reason)) errors.push(reason); }
      else {
        eligible++;
        if (record?.connected) connected++;
      }
    }
    const current = [...attached];
    return { enabled, delayMs, media: media.length, eligible, connected, unsupported,
      dialogueConnected: current.filter(r => r.filterReady && !r.error).length,
      dialoguePending: current.filter(r => r.filter && !r.filterReady).length,
      dialogueFailed: current.filter(r => r.filterError).length,
      dialogueError: dialogueError || current.find(r => r.filterError)?.filterError || "",
      contextState: context?.state || "native", error: lastError || errors[0] || "" };
  }
  globalThis.addEventListener("message", event => {
    const m = event.data;
    if (event.source !== window || !m || m.source !== SOURCE || m.direction !== "to-page") return;
    if (typeof m.id !== "string" || m.id.length > 100) return;
    function reply(ok, error = "") {
      window.postMessage({ source: SOURCE, direction: "from-page", id: m.id, ok, status: status(), error }, "*");
    }
    if (m.type === "configure") {
      try {
        const url = new URL(m.url);
        if (url.protocol !== "moz-extension:" || url.pathname !== "/content/audio-processor.js" || url.search || url.hash) return;
        if (workletUrl && workletUrl !== url.href) return;
        workletUrl = url.href;
        reply(true);
      } catch {}
      return;
    }
    if (m.type === "status") { reply(true); return; }
    if (m.type !== "apply" || typeof m.enabled !== "boolean" || !Number.isInteger(m.delayMs) || m.delayMs < 0 || m.delayMs > 5000) return;
    if (m.dialogueEnabled !== undefined && typeof m.dialogueEnabled !== "boolean") return;
    if (m.dialogueMix !== undefined && (!Number.isInteger(m.dialogueMix) || m.dialogueMix < 0 || m.dialogueMix > 100)) return;
    if (m.dialogueRun !== undefined && (!Number.isSafeInteger(m.dialogueRun) || m.dialogueRun < 0)) return;
    const nextDialogue = m.dialogueEnabled === true;
    // A quick Off/On can be coalesced by revision guards or missed broadcasts.
    // A persisted run token makes the explicit retry survive that coalescing.
    if (!nextDialogue || (m.dialogueRun ?? 0) !== dialogueRun) {
      if (dialogueError) dialogueModule = null;
      dialogueError = "";
      for (const record of attached) { removeFilter(record); record.filterError = ""; }
    }
    dialogueRun = m.dialogueRun ?? 0;
    dialogueEnabled = nextDialogue;
    dialogueMix = m.dialogueMix ?? 100;
    enabled = m.enabled;
    delayMs = m.delayMs;
    pageHidden = false;
    generation++;
    lastError = "";
    void schedule(scan).then(() => reply(true), error => reply(false, error.message || "Audio routing failed"));
  });
  // Bounded polling covers late open shadow roots and player replacements without
  // patching site prototypes. No AudioContext/source is created just to discover media.
  let scanning = false;
  setInterval(() => {
    if (pageHidden || scanning || (!enabled && !dialogueEnabled && !attached.size)) return;
    scanning = true;
    void schedule(scan).catch(() => {}).finally(() => { scanning = false; });
  }, 1000);
  for (const event of ["pointerdown", "keydown"]) {
    document.addEventListener(event, () => {
      if (context && attached.size && !pageHidden) void context.resume().catch(() => {});
    }, { capture: true, passive: true });
  }
  globalThis.addEventListener("pagehide", () => {
    pageHidden = true;
    generation++;
    for (const record of attached) stop(record);
  });
})();
