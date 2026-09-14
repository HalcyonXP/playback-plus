const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource, settle } = require("./harness");

test("Firefox-style isolated global differs from Window; bridge accepts Window replies and ignores stale reads", async () => {
  const events = new Map();
  const requests = [];
  let messageListener;
  let resolveInitial;
  let initial = true;
  let saved = { enabled: false, delayMs: 0, revision: 0 };
  let engine = { enabled: false, delayMs: 0, media: 1, eligible: 1, connected: 0, contextState: "native" };
  const domWindow = {
    postMessage(m) {
      requests.push(m);
      if (m.type === "apply") engine = { ...engine, enabled: m.enabled, delayMs: m.delayMs };
      for (const fn of events.get("message") || []) fn({ source: domWindow, data: {
        source: "video-speed-audio-v1", direction: "from-page", id: m.id, ok: true, status: engine
      } });
    }
  };
  const context = vm.createContext({ window: domWindow, setTimeout, clearTimeout,
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    browser: { runtime: {
      getURL(path) { return `moz-extension://test/${path}`; },
      onMessage: { addListener(fn) { messageListener = fn; } },
      sendMessage(m) {
        assert.equal(m.type, "AUDIO_SYNC_GET", "page replies cannot issue privileged writes");
        if (initial) { initial = false; return new Promise(resolve => { resolveInitial = resolve; }); }
        return Promise.resolve(saved);
      }
    } }
  });
  vm.runInContext(readSource("shared/audio.js"), context);
  vm.runInContext(readSource("content/audio-bridge.js"), context);
  assert.notEqual(vm.runInContext("globalThis", context), domWindow);
  saved = { enabled: false, delayMs: 750, revision: 2 };
  messageListener({ type: "AUDIO_SYNC_CHANGED", state: saved });
  await settle();
  resolveInitial({ enabled: true, delayMs: 10, revision: 0 });
  await settle();
  assert.equal(requests.findLast(m => m.type === "apply").delayMs, 750);
  const status = await messageListener({ type: "AUDIO_SYNC_STATUS" });
  assert.equal(status.delayMs, 750);
  assert.equal(status.revision, 2);
  assert.equal(status.applying, false);
  assert.equal(status.error, "");
  engine = { ...engine, connected: -4, media: Infinity, error: "x".repeat(500), contextState: "invented" };
  const sanitized = await messageListener({ type: "AUDIO_SYNC_STATUS" });
  assert.equal(sanitized.connected, 0);
  assert.equal(sanitized.media, 0);
  assert.equal(sanitized.error.length, 250);
  assert.equal(sanitized.contextState, "closed");
});


test("audio-key feedback shows the selection, not engine diagnostics or raw write errors", async () => {
  const events = new Map();
  let notice;
  let engineFails = false;
  let writeFails = false;
  let saved = { enabled: false, delayMs: 0, revision: 0 };
  const document = {
    getElementById() { return notice; },
    createElement() { return { style: {}, setAttribute() {} }; },
    body: { appendChild(element) { notice = element; } }
  };
  const window = { postMessage(m) {
    for (const fn of events.get("message") || []) fn({ source: window, data: {
      source: "video-speed-audio-v1", direction: "from-page", id: m.id,
      ok: !(engineFails && m.type === "apply"), error: "RuntimeError in internal WASM adapter",
      status: { media: 1, eligible: 1, contextState: "native" }
    } });
  } };
  const context = vm.createContext({ window, document, setTimeout() { return 1; }, clearTimeout() {},
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    browser: { runtime: {
      getURL(path) { return `moz-extension://test/${path}`; },
      onMessage: { addListener() {} },
      async sendMessage(m) {
        if (m.type === "AUDIO_SYNC_GET") return saved;
        if (writeFails) throw new Error("Internal Sync write rejected");
        saved = { ...saved, delayMs: saved.delayMs + 500, revision: saved.revision + 1 };
        return saved;
      }
    } }
  });
  vm.runInContext(readSource("shared/audio.js"), context);
  vm.runInContext(readSource("content/audio-bridge.js"), context);
  await settle();
  context.VideoAudioBridge.act("audioIncrease");
  await settle();
  assert.equal(notice.textContent, "Audio Sync · 500 ms selected · Off");
  engineFails = true;
  context.VideoAudioBridge.act("audioIncrease");
  await settle();
  assert.match(notice.textContent, /Try reloading the page/);
  assert.doesNotMatch(notice.textContent, /RuntimeError|WASM|adapter/);
  writeFails = true;
  context.VideoAudioBridge.act("audioIncrease");
  await settle();
  assert.equal(notice.textContent, "Couldn't change Audio Sync. Please try again.");
});
