const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource, createHarness, settle, FakeElement, FakeMedia } = require("./harness");
const request = (h, tabId, type, values = {}) => h.request({ type: `AUDIO_SYNC_${type}`, tabId, ...values });

test("audio has no inherited defaults; exact values, fixed nudges, reset and toggles are independent", async () => {
  const h = createHarness();
  await request(h, 1, "SET", { delayMs: 151 });
  assert.equal(h.audioSessions.get(1).enabled, false);
  await request(h, 1, "NUDGE", { direction: 1 });
  assert.equal(h.audioSessions.get(1).delayMs, 651);
  await request(h, 1, "TOGGLE");
  await request(h, 2, "SET", { delayMs: 999 });
  assert.equal(h.audioSessions.get(1).enabled, true);
  assert.equal(h.audioSessions.get(2).enabled, false);
  await request(h, 1, "SET", { delayMs: 0 });
  assert.equal(h.audioSessions.get(1).enabled, true, "Reset does not turn correction Off");
  await request(h, 1, "NUDGE", { direction: -1 });
  assert.equal(h.audioSessions.get(1).delayMs, 0);
  await Promise.all(Array.from({ length: 12 }, () => request(h, 1, "NUDGE", { direction: 1 })));
  assert.equal(h.audioSessions.get(1).delayMs, 5000);
  await request(h, 1, "TOGGLE");
  assert.equal(h.audioSessions.get(1).delayMs, 5000);
  await h.createTab(3);
  assert.deepEqual(await request(h, 3, "GET"), { enabled: false, delayMs: 0, dialogueEnabled: false, dialogueRun: 0, dialogueMix: 100, revision: 0, pageUrl: "https://example.com/3" });
  assert.equal(h.sessions.get(1).speed, 2);
  assert.deepEqual(h.storedValues, { playbackSpeed: 2, lastNon1xSpeed: 2, savedSpeedDefault: { enabled: true, speed: 2 } }, "no audio preferences or channel history are written to Sync");
});

test("audio validates writes, contains content tab targets and survives event-page suspension", async () => {
  const h = createHarness();
  await h.request({ type: "AUDIO_SYNC_SET", tabId: 2, delayMs: 321 }, { tab: { id: 1 } });
  assert.equal(h.audioSessions.get(1).delayMs, 321);
  assert.equal((await request(h, 2, "GET")).delayMs, 0);
  for (const [type, values] of [["SET", { delayMs: "bad" }], ["NUDGE", { direction: 500 }], ["ENABLE", { enabled: "true" }]]) {
    await assert.rejects(request(h, 1, type, values));
  }
  h.failSessions = true;
  await assert.rejects(request(h, 1, "SET", { delayMs: 400 }));
  assert.equal(h.audioSessions.get(1).delayMs, 321);
  h.failSessions = false;
  await request(h, 1, "ENABLE", { enabled: true });
  h.restartBackground();
  assert.equal((await request(h, 1, "GET")).enabled, true);
  await request(h, 1, "NUDGE", { direction: 1 });
  assert.equal(h.audioSessions.get(1).delayMs, 821);
});

test("reload keeps audio; navigation and SPA/fragment changes reset it without altering speed", async () => {
  const h = createHarness();
  await request(h, 1, "SET", { delayMs: 150 });
  await request(h, 1, "ENABLE", { enabled: true });
  const initial = h.audioSessions.get(1);
  await h.navigate(1, "https://example.com/1", "reload");
  assert.deepEqual(h.audioSessions.get(1), initial);
  h.activeTab = 2;
  assert.equal(h.audioSessions.get(1).enabled, true);
  await h.navigate(1, "https://example.com/other");
  assert.equal(h.audioSessions.get(1).enabled, false);
  assert.equal(h.audioSessions.get(1).delayMs, 0);
  await request(h, 1, "SET", { delayMs: 222 });
  await h.navigate(1, "https://example.com/other", "link", "onHistoryStateUpdated");
  assert.equal(h.audioSessions.get(1).delayMs, 222, "same-URL replaceState is not a different page");
  await h.navigate(1, "https://example.com/route", "link", "onHistoryStateUpdated");
  assert.equal(h.audioSessions.get(1).delayMs, 0);
  await request(h, 1, "ENABLE", { enabled: true });
  await h.navigate(1, "https://example.com/route#next", "link", "onReferenceFragmentUpdated");
  assert.equal(h.audioSessions.get(1).enabled, false);
  assert.equal(h.sessions.get(1).speed, 2);
});

test("audio key defaults are unset, duplicate speed keys rejected, bound actions target only their tab", async () => {
  const h = createHarness();
  const frame = h.createFrame(1);
  const other = h.createFrame(2);
  await settle();
  await assert.rejects(h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action: "audioToggle", code: "Numpad0" }), /already assigned/);
  for (const [action, code] of [["audioToggle", "KeyJ"], ["audioIncrease", "KeyK"], ["audioDecrease", "KeyL"]]) {
    await h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action, code });
  }
  assert.equal(frame.dispatchKey({ code: "KeyK" }).defaultPrevented, true);
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 500);
  assert.equal(h.audioSessions.get(1).enabled, false);
  frame.dispatchKey({ code: "KeyJ" });
  other.dispatchKey({ code: "KeyK", target: new FakeElement("input") });
  await settle();
  assert.equal(h.audioSessions.get(1).enabled, true);
  assert.equal(h.audioSessions.has(2), false);
  frame.dispatchKey({ code: "KeyL" });
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 0);
});

test("audio popup uses exact input, fixed step, tab-local status and failure-safe saves", async () => {
  const h = createHarness();
  h.createFrame(1);
  const { elements: e, pollAudio } = h.createPopup(1);
  assert.equal(e.audioExact.disabled, true);
  await settle();
  await pollAudio();
  assert.equal(e.mainView.hidden, false);
  e.audioExact.value = "151";
  e.audioExact.dispatch("change");
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 151);
  assert.equal(h.audioSessions.get(1).enabled, false);
  e.audioIncrease.dispatch("click");
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 651);
  e.audioEnabled.dispatch("click");
  await settle();
  assert.equal(e.audioEnabled.textContent, "On");
  e.audioExact.value = "12.5";
  e.audioExact.dispatch("change");
  assert.equal(e.audioExact.value, "651", "invalid input quietly restores selected delay");
  h.failSessions = true;
  e.audioDecrease.dispatch("click");
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 651);
  assert.equal(e.audioExact.value, "651", "failed write preserves selected delay");
  h.failSessions = false;
  e.audioReset.dispatch("click");
  await settle();
  assert.equal(h.audioSessions.get(1).delayMs, 0);
  assert.equal(h.audioSessions.get(1).enabled, true);
  assert.equal(e.mainView.hidden, false);
  e.configButton.dispatch("click");
  assert.equal(e.audioToggleKeyButton.textContent, "Not set");
});

test("audio polling/write failures stay quiet and preserve selection until recovery", async () => {
  const h = createHarness(); h.createFrame(1);
  const original = h.request;
  let failPoll = false, failWrite = false;
  h.request = (m, sender) => (failPoll && m.type === "AUDIO_SYNC_STATUS_GET") || (failWrite && m.type === "AUDIO_SYNC_ENABLE")
    ? Promise.reject(new Error("Internal storage/bridge details")) : original(m, sender);
  const { elements:e, pollAudio } = h.createPopup(1); await settle();
  failPoll = true; await pollAudio(); await settle();
  assert.equal(e.audioEnabled.textContent, "Off");
  assert.equal(e.audioEnabled.disabled, false);
  failWrite = true; e.audioEnabled.dispatch("click"); await settle();
  assert.equal(e.audioEnabled.textContent, "Off");
  failPoll = false; await pollAudio(); await settle();
  assert.equal(e.audioEnabled.textContent, "Off", "poll recovery does not invent successful write");
  failWrite = false; e.audioEnabled.dispatch("click"); await settle();
  assert.equal(e.audioEnabled.textContent, "On");
  assert.equal(e.audioStatus, undefined); assert.equal(e.audioError, undefined);
  failPoll = true;
  const cold = h.createPopup(2); await settle();
  assert.equal(cold.elements.audioEnabled.disabled, true);
  assert.equal(cold.elements.dialogueMix.disabled, true);
  failPoll = false; await cold.pollAudio(); await settle();
  assert.equal(cold.elements.dialogueMix.disabled, false);
});

function engineHarness({ moduleFails = false, dialogueFails = false } = {}) {
  const document = new FakeElement("#document");
  const events = new Map();
  const replies = [];
  const nodes = [];
  const modules = [];
  let contexts = 0;
  let sources = 0;
  const intervals = [];
  class AudioContext {
    constructor() {
      contexts++;
      this.sampleRate = 1000;
      this.state = "running";
      this.destination = {};
      this.audioWorklet = { addModule: async url => { modules.push(url); if (moduleFails || (dialogueFails && url.includes("dialogue-processor"))) throw new Error("Module rejected"); } };
    }
    async resume() {}
    createMediaElementSource() { sources++; return { connect() {}, disconnect() {} }; }
  }
  class AudioWorkletNode {
    constructor(_context, name) { this.name = name; this.messages = []; this.port = { postMessage: m => this.messages.push(m), close() {} }; nodes.push(this); }
    connect(destination) { this.connected = true; this.destination = destination; }
    disconnect() { this.connected = false; }
  }
  const context = vm.createContext({ URL, document, AudioContext, AudioWorkletNode, setTimeout, clearTimeout,
    location: { href: "https://example.com/page", origin: "https://example.com" },
    setInterval(fn) { intervals.push(fn); },
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    postMessage(m) { replies.push(m); }
  });
  vm.runInContext("globalThis.window = globalThis", context);
  vm.runInContext(readSource("content/audio-engine.js"), context);
  const window = vm.runInContext("globalThis", context);
  async function send(type, fields = {}) {
    const id = String(replies.length + 1);
    for (const fn of events.get("message")) fn({ source: window, data: { source: "video-speed-audio-v1", direction: "to-page", id, type, ...fields } });
    await settle();
    return replies.findLast(r => r.id === id);
  }
  function media(src = "https://example.com/audio.wav", options = {}) {
    const m = new FakeMedia("audio");
    Object.assign(m, { currentSrc: src, paused: false, ended: false, seeking: false, muted: false, volume: 1, ...options });
    document.appendChild(m);
    return m;
  }
  return { send, media, document, nodes, modules, events, intervals, get contexts() { return contexts; }, get sources() { return sources; } };
}

test("page engine leaves native media untouched until enabled and skips known unsafe media", async () => {
  const h = engineHarness();
  const first = h.media();
  h.media("https://other.example/audio.wav");
  h.media("https://example.com/protected", { mediaKeys: {} });
  h.media("https://other.example/cors.wav", { crossOrigin: "anonymous" });
  await h.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  await h.send("apply", { enabled: false, delayMs: 151 });
  assert.equal(h.contexts, 0);
  assert.equal(h.sources, 0);
  let reply = await h.send("apply", { enabled: true, delayMs: 151 });
  assert.equal(h.sources, 2);
  assert.equal(reply.status.connected, 2);
  assert.equal(reply.status.unsupported, 2);
  assert.ok(h.nodes[0].messages.some(m => m.type === "delay" && m.frames === 151));
  first.muted = true;
  first.dispatch("volumechange");
  assert.equal(h.nodes[0].messages.at(-1).value, 0);
  first.dispatch("pause");
  assert.equal(h.nodes[0].messages.at(-1).type, "stop");
  first.dispatch("playing");
  assert.ok(h.nodes[0].messages.some(m => m.type === "start"));
  await h.send("apply", { enabled: false, delayMs: 151 });
  h.media();
  for (const tick of h.intervals) tick();
  await settle();
  assert.equal(h.sources, 2, "new media remains native while Off");
  assert.ok(h.nodes[0].messages.some(m => m.type === "delay" && m.frames === 0));
  h.document.children = h.document.children.filter(m => m !== first);
  for (const tick of h.intervals) tick();
  await settle();
  assert.equal(h.nodes[0].connected, false);
  h.document.appendChild(first);
  for (const tick of h.intervals) tick();
  await settle();
  assert.equal(h.nodes[0].connected, true, "reinserted routed media reconnects even when Off");
  assert.equal(h.sources, 2, "never create a second source for the same media element");
});

test("worklet loading failure does not attach a media source; pagehide stops delayed output", async () => {
  const h = engineHarness({ moduleFails: true });
  h.media();
  await h.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  const result = await h.send("apply", { enabled: true, delayMs: 500 });
  assert.equal(result.ok, false);
  assert.equal(h.sources, 0);
  const good = engineHarness();
  good.media();
  await good.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  await good.send("apply", { enabled: true, delayMs: 500 });
  for (const fn of good.events.get("pagehide")) fn();
  assert.equal(good.nodes[0].messages.at(-1).type, "stop");
});

test("processor delays individual samples, clamps bounds and stops buffered sound immediately", () => {
  let Processor;
  const context = vm.createContext({ sampleRate: 1000,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor(_name, value) { Processor = value; }
  });
  vm.runInContext(readSource("content/audio-processor.js"), context);
  const p = new Processor({ processorOptions: { maxFrames: 5000 } });
  const send = m => p.port.onmessage({ data: m });
  function process(values) {
    const out = new Float32Array(values.length);
    p.process([[Float32Array.from(values)]], [[out]]);
    return [...out];
  }
  send({ type: "delay", frames: 2 });
  send({ type: "start" });
  assert.deepEqual(process([0.25, 0.5, 0.75, 1]), [0, 0, 0.25, 0.5]);
  send({ type: "volume", value: 0.5 });
  assert.deepEqual(process([0.125, 0.25]), [0.375, 0.5], "buffered samples follow current volume immediately");
  assert.deepEqual(process([0.375, 0.5]), [0.125, 0.25], "new pre-scaled Firefox input is not attenuated twice");
  send({ type: "volume", value: 0 });
  assert.deepEqual(process([0, 0]), [0, 0]);
  send({ type: "stop" });
  assert.deepEqual(process([0, 0]), [0, 0]);
  send({ type: "volume", value: 0.5 });
  send({ type: "start" });
  assert.deepEqual(process([0.25, 0.5]), [0, 0], "resume does not replay old buffered audio");
  send({ type: "delay", frames: 9000 });
  assert.equal(p.delayFrames, 5000);
  send({ type: "delay", frames: 0 });
  assert.deepEqual(process([0.25, 0.5]), [0.25, 0.5], "Off path preserves already-scaled current input");
});


test("dialogue shares one media source, loads lazily, fails open and leaves Audio Sync independent", async () => {
  const h = engineHarness(); h.media();
  await h.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  await h.send("apply", { enabled: true, delayMs: 151 });
  assert.equal(h.modules.length, 1, "delay-only does not load RNNoise");
  await h.send("apply", { enabled: true, delayMs: 151, dialogueEnabled: true, dialogueMix: 65 });
  assert.equal(h.sources, 1);
  assert.equal(h.modules.length, 2);
  const delay = h.nodes[0], filter = h.nodes[1];
  assert.equal(filter.name, "video-dialogue-focus");
  filter.port.onmessage({ data: { type: "ready" } });
  assert.equal(delay.destination, filter);
  let status = (await h.send("status")).status;
  assert.equal(status.dialogueConnected, 1);
  filter.onprocessorerror();
  assert.notEqual(delay.destination, filter);
  assert.equal(filter.connected, false);
  assert.equal(filter.messages.at(-1).type, "dispose");
  status = (await h.send("status")).status;
  assert.equal(status.dialogueConnected, 0);
  assert.equal(status.dialogueFailed, 1);
  assert.match(status.dialogueError, /unfiltered/);
  assert.equal(status.enabled, true);
  assert.equal(status.delayMs, 151);
  for (const tick of h.intervals) tick();
  await settle();
  assert.equal(h.nodes.length, 2, "no infinite processor retry on status polling");
  await h.send("apply", { enabled: false, delayMs: 151, dialogueEnabled: false });
  await h.send("apply", { enabled: false, delayMs: 151, dialogueEnabled: true, dialogueMix: 0 });
  const retry = h.nodes[2];
  retry.port.onmessage({ data: { type: "ready" } });
  assert.equal(h.sources, 1);
  assert.ok(delay.messages.some(m => m.type === "delay" && m.frames === 0));
  await h.send("apply", { enabled: false, delayMs: 151, dialogueEnabled: false });
  assert.equal(retry.connected, false);
});

test("RNNoise module failure preserves unfiltered routing and delay without poisoning the engine", async () => {
  const h = engineHarness({ dialogueFails: true }); h.media();
  await h.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  const result = await h.send("apply", { enabled: false, delayMs: 200, dialogueEnabled: true });
  assert.equal(result.ok, true);
  assert.match(result.status.dialogueError, /unfiltered/);
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].connected, true);
  assert.equal(result.status.delayMs, 200);
  assert.equal(result.status.enabled, false);
  for (const tick of h.intervals) tick();
  await settle();
  assert.equal(h.modules.length, 2, "failed WASM is not loaded repeatedly");
  await h.send("apply", { enabled: true, delayMs: 200, dialogueEnabled: false });
  assert.ok(h.nodes[0].messages.some(m => m.type === "delay" && m.frames === 200));
});


test("same-origin source loading is transient, and a new dialogue run retries even if Off delivery was coalesced", async () => {
  const h = engineHarness(); const media = h.media();
  await h.send("configure", { url: "moz-extension://test/content/audio-processor.js" });
  await h.send("apply", { enabled: false, delayMs: 0, dialogueEnabled: true, dialogueRun: 1 });
  h.nodes[1].port.onmessage({ data: { type: "ready" } });
  media.currentSrc = "https://example.com/next.wav";
  media.readyState = 0; media.dispatch("play");
  media.readyState = 4; media.dispatch("playing");
  assert.equal((await h.send("status")).status.unsupported, 0);
  h.nodes[1].onprocessorerror();
  await h.send("apply", { enabled: false, delayMs: 0, dialogueEnabled: true, dialogueRun: 3 });
  h.nodes[2].port.onmessage({ data: { type: "ready" } });
  const status = (await h.send("status")).status;
  assert.equal(status.dialogueConnected, 1);
  assert.equal(status.dialogueFailed, 0);
  assert.equal(h.sources, 1);
  await h.send("apply", { enabled: false, delayMs: 0, dialogueEnabled: false });
});
