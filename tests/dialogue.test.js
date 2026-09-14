const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { readSource, createHarness, settle } = require("./harness");

const request = (h, type, fields = {}, tabId = 1) => h.request({ type, tabId, ...fields });
test("dialogue settings migrate safely, are independent, serialized, tab-local and reset with navigation", async () => {
  const h = createHarness();
  h.audioSessions.set(1, { enabled: true, delayMs: 153, revision: 7, pageUrl: "https://example.com/1" });
  let s = await request(h, "AUDIO_SYNC_GET");
  assert.equal(s.dialogueEnabled, false);
  assert.equal(s.dialogueMix, 100);
  await request(h, "DIALOGUE_MIX", { mix: 42 });
  s = await request(h, "AUDIO_SYNC_GET");
  assert.equal(s.dialogueEnabled, false, "mix never enables filtering");
  await Promise.all([request(h, "DIALOGUE_ENABLE", { enabled: true }), request(h, "AUDIO_SYNC_NUDGE", { direction: 1 })]);
  s = await request(h, "AUDIO_SYNC_GET");
  assert.equal(s.dialogueMix, 42);
  assert.equal(s.dialogueEnabled, true);
  assert.equal(s.delayMs, 653);
  assert.equal(s.enabled, true);
  await request(h, "AUDIO_SYNC_ENABLE", { enabled: false });
  assert.equal((await request(h, "AUDIO_SYNC_GET")).dialogueEnabled, true);
  await h.request({ type: "DIALOGUE_MIX", tabId: 2, mix: 20 }, { tab: { id: 1 } });
  assert.equal((await request(h, "AUDIO_SYNC_GET", {}, 2)).dialogueMix, 100);
  h.restartBackground();
  await h.navigate(1, "https://example.com/1", "reload");
  s = await request(h, "AUDIO_SYNC_GET");
  assert.equal(s.dialogueEnabled, true);
  assert.equal(s.dialogueMix, 20);
  await request(h, "DIALOGUE_ENABLE", { enabled: false });
  assert.equal((await request(h, "AUDIO_SYNC_GET")).dialogueMix, 20, "Off retains mix");
  await h.navigate(1, "https://example.com/new", "link", "onHistoryStateUpdated");
  s = await request(h, "AUDIO_SYNC_GET");
  assert.equal(s.dialogueEnabled, false);
  assert.equal(s.dialogueMix, 100);
  assert.deepEqual(h.storedValues, { playbackSpeed: 2, lastNon1xSpeed: 2, savedSpeedDefault: { enabled: true, speed: 2 } });
  for (const mix of [-1, 101, 0.5, "42", NaN]) await assert.rejects(request(h, "DIALOGUE_MIX", { mix }));
  await assert.rejects(request(h, "DIALOGUE_ENABLE", { enabled: 1 }));
  h.failSessions = true;
  await assert.rejects(request(h, "DIALOGUE_ENABLE", { enabled: true }));
  assert.equal(h.audioSessions.get(1).dialogueEnabled, false);
});

test("dialogue popup has independent On/Off and mix, navigation, partial and fail-open status", async () => {
  const h = createHarness();
  h.createFrame(1);
  const { elements: e, pollAudio } = h.createPopup(1);
  assert.equal(e.dialogueMix.disabled, true);
  await settle();
  await pollAudio();
  assert.equal(e.mainView.hidden, false);
  assert.equal(e.dialogueEnabled.textContent, "Off");
  e.dialogueMix.value = "65";
  e.dialogueMix.dispatch("input");
  assert.equal(e.dialogueValue.textContent, "65%");
  e.dialogueMix.dispatch("change");
  await settle();
  assert.equal(h.audioSessions.get(1).dialogueMix, 65);
  assert.equal(h.audioSessions.get(1).dialogueEnabled, false);
  e.dialogueEnabled.dispatch("click");
  await settle();
  assert.equal(h.audioSessions.get(1).enabled, false);
  assert.match(e.dialogueStatus.textContent, /On.*65% mix/);
  h.audioReports.set(1, { dialogueConnected: 0, dialogueFailed: 1, dialogueError: "RNNoise failed. Using unfiltered audio." });
  await pollAudio();
  await settle();
  assert.equal(e.dialogueStatus.textContent, "Filter unavailable.");
  assert.match(e.dialogueError.textContent, /Turn it Off and On/);
  assert.doesNotMatch(e.dialogueError.textContent, /RNNoise/);
  assert.equal(e.dialogueEnabled.textContent, "On", "requested state is not silently overwritten on failure");
  h.audioReports.set(1, { dialogueConnected: 1, unsupported: 1 });
  await pollAudio();
  await settle();
  assert.match(e.dialogueStatus.textContent, /Limited support/);
  h.failSessions = true;
  e.dialogueEnabled.dispatch("click");
  await settle();
  assert.equal(e.dialogueEnabled.textContent, "On");
  assert.match(e.dialogueError.textContent, /Couldn't change this setting/);
  assert.equal(e.mainView.hidden, false);
  e.configButton.dispatch("click");
});

function wasmHarness() {
  const source = readSource("content/vendor/rnnoise/rnnoise-sync.js");
  assert.equal(crypto.createHash("sha256").update(source).digest("hex"), "05a553f523d59502d133a6d05dbf1878137c9e7bcff06edf5561f7001b62f95f");
  const context = vm.createContext({ console, WebAssembly });
  // Only adapt the ES-module wrapper to this Node VM; execute the exact bundled WASM.
  vm.runInContext(source.replace("import.meta.url", '"file:///rnnoise-sync.js"')
    .replace("export default createRNNWasmModuleSync;", "globalThis.factory = createRNNWasmModuleSync;"), context);
  vm.runInContext(readSource("content/dialogue-core.js"), context);
  return { context, module: context.factory(), DSP: context.VideoDialogueDSP };
}
function runDSP(dsp, left, right = left, volume = 1) {
  const outputs = [new Float32Array(left.length), new Float32Array(left.length)];
  for (let pos = 0; pos < left.length; pos += 128) {
    const count = Math.min(128, left.length - pos);
    dsp.process([left.subarray(pos, pos + count), right.subarray(pos, pos + count)],
      outputs.map(out => out.subarray(pos, pos + count)), volume);
  }
  return outputs;
}

test("pinned real RNNoise WASM processes stereo, has aligned 30 ms dry mix, and releases states", () => {
  const { module, DSP } = wasmHarness();
  const impulse = new Float32Array(4800); impulse[0] = 0.9;
  const zero = new Float32Array(4800);
  const p = new DSP(module);
  const [wet, other] = runDSP(p, impulse, zero);
  let peak = 0;
  for (let i = 0; i < wet.length; i++) if (Math.abs(wet[i]) > Math.abs(wet[peak])) peak = i;
  assert.equal(peak, 1440, "model + adapter peak alignment is 30 ms at 48 kHz");
  assert.ok(wet[peak] > 0.001 && wet[peak] < impulse[0], "real model changes the non-speech impulse");
  assert.ok(other.every(x => x === 0), "left and right have independent model state");
  p.targetMix = 0; p.reset();
  const [dry] = runDSP(p, impulse, zero);
  assert.equal(dry[1440], impulse[0]);
  assert.equal(dry.filter(x => x !== 0).length, 1);
  p.targetMix = 0.5; p.reset();
  const [mixed] = runDSP(p, impulse, zero);
  for (let i = 0; i < mixed.length; i++) assert.ok(Math.abs(mixed[i] - (wet[i] + dry[i]) / 2) < 1e-6);
  p.reset();
  assert.ok(runDSP(p, zero)[0].every(x => x === 0), "reset clears sample and neural state");
  p.dispose(); p.dispose();
  assert.equal(p.states.length, 0);
  assert.equal(p.pointer, 0);
});

test("real RNNoise respects normalized player volume; worklet stop/mute clears history and failure passes through", () => {
  const { context, module } = wasmHarness();
  let Processor;
  const messages = [];
  context.sampleRate = 48000;
  context.AudioWorkletProcessor = class { constructor() { this.port = { postMessage(m) { messages.push(m); }, close() {} }; } };
  context.registerProcessor = (_name, value) => { Processor = value; };
  context.createRNNWasmModuleSync = () => module;
  vm.runInContext(readSource("content/dialogue-processor.js").replace(/^import .*;\r?\n/gm, ""), context);
  const p = new Processor({ processorOptions: { mix: 0 } });
  const send = m => p.port.onmessage({ data: m });
  function block(value, count = 128) {
    const input = new Float32Array(count).fill(value);
    const out = [new Float32Array(count), new Float32Array(count)];
    p.process([[input, input]], [out]);
    return out[0];
  }
  send({ type: "start" });
  block(0.4, 2400);
  send({ type: "volume", value: 0.5 });
  const half = block(0.2, 2400);
  assert.ok(half.every(x => Math.abs(x - 0.2) < 1e-6), "volume is applied once, including already-buffered samples");
  send({ type: "volume", value: 0 });
  assert.ok(block(0).every(x => x === 0));
  send({ type: "volume", value: 1 });
  assert.ok(block(0.4).every(x => x === 0), "unmuting starts with fresh history");
  send({ type: "stop" });
  assert.ok(block(0.4).every(x => x === 0));
  send({ type: "start" });
  assert.ok(block(0.4).every(x => x === 0));
  p.dsp.process = () => { throw new Error("injected failure"); };
  assert.ok(block(0.4).every(x => Math.abs(x - 0.4) < 1e-6), "failure returns original samples in the same callback");
  assert.equal(messages.filter(m => m.type === "failed").length, 1);
  block(0.4);
  assert.equal(messages.filter(m => m.type === "failed").length, 1);
  send({ type: "dispose" });
  assert.equal(p.process([[]], [[new Float32Array(128)]]), false);
});
