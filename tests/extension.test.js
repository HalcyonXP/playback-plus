const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource, settle, FakeElement, FakeMedia, createHarness } = require("./harness");
const sharedSource = readSource("shared/speed.js");

test("speed utilities normalize values and preserve toggle state", () => {
  const context = vm.createContext({});
  vm.runInContext(sharedSource, context);
  const utils = context.VideoSpeedUtils;

  assert.equal(utils.normalizeSpeed(2.13), 2.25);
  assert.equal(utils.normalizeSpeed(0), 0.25);
  assert.equal(utils.normalizeSpeed(100), 8);
  assert.equal(utils.normalizeSpeed("3.5"), 3.5);
  assert.equal(utils.normalizeSpeed("not-a-number", 2.5), 2.5);
  assert.equal(utils.formatSpeed(2), "2×");
  assert.equal(utils.formatSpeed(2.5), "2.5×");
  assert.equal(utils.formatSpeed(1.25), "1.25×");

  let state = utils.readSpeedState({ defaultSpeed: 2.5 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(state)),
    { speed: 2.5, lastNon1xSpeed: 2.5 },
    "the retired default is migrated as the current and alternate speed"
  );

  state = utils.updateSpeedState(state, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state)),
    { speed: 1, lastNon1xSpeed: 2.5 }
  );
  state = utils.toggleSpeedState(state);
  assert.equal(state.speed, 2.5);
  state = utils.toggleSpeedState(state);
  assert.equal(state.speed, 1);
  assert.equal(state.lastNon1xSpeed, 2.5);

  assert.deepEqual(
    JSON.parse(JSON.stringify(utils.readSpeedState({
      playbackSpeed: 1,
      lastNon1xSpeed: 1
    }))),
    { speed: 1, lastNon1xSpeed: 2 },
    "1× is never stored as the non-1× alternate"
  );
});


test("tab adjustments isolate existing tabs; new tabs use the saved default, including 1×", async () => {
  const h = createHarness({ defaults: { defaultSpeed: 2.5 } });
  await settle();
  assert.deepEqual(h.storedValues, { playbackSpeed: 2.5, lastNon1xSpeed: 2.5, savedSpeedDefault: { enabled: true, speed: 2.5 } });
  await h.install();
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 3 });
  assert.equal(h.sessions.get(1).speed, 3);
  assert.equal(h.sessions.get(2).speed, 2.5, "even an existing blank tab retains its initial speed");
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 1 });
  await h.request({ type: "VIDEO_SPEED_DEFAULT_SET", tabId: 1 }, { url: "moz-extension://test-extension/popup/popup.html" });
  await h.createTab(3);
  assert.deepEqual(h.sessions.get(3), { speed: 1, lastNon1xSpeed: 3, revision: 0 });
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 2 });
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 2 });
  assert.equal(h.sessions.get(2).speed, 2.5, "alternates are independent too");
  assert.equal(h.sessions.get(1).speed, 1);
  assert.equal(h.sessions.get(3).speed, 1);
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 4 } });
  await h.createTab(4);
  assert.equal(h.sessions.get(4).speed, 4, "remote Sync changes seed only new tabs");
  assert.equal(h.sessions.get(2).speed, 2.5);
});

test("video, audio, dynamic media and open shadow roots share only their tab's state", async () => {
  const h = createHarness();
  const top = h.createFrame(1);
  const embedded = h.createFrame(1);
  const other = h.createFrame(2);
  const video = top.document.appendChild(new FakeMedia());
  const audio = top.document.appendChild(new FakeMedia("audio"));
  const frameAudio = embedded.document.appendChild(new FakeMedia("audio"));
  const otherVideo = other.document.appendChild(new FakeMedia());
  await settle();
  assert.equal(audio.playbackRate, 2);
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 3.25 });
  await settle();
  for (const media of [video, audio, frameAudio]) {
    assert.equal(media.playbackRate, 3.25);
    assert.equal(media.defaultPlaybackRate, 3.25);
    media.playbackRate = 1;
    media.dispatch("ratechange");
    assert.equal(media.playbackRate, 3.25, "site resets are corrected");
  }
  assert.equal(otherVideo.playbackRate, 2);
  const dynamic = top.addNode(new FakeMedia("audio"));
  const host = new FakeElement("custom-player");
  host.shadowRoot = new FakeElement("#shadow-root");
  host.shadowRoot.nodeType = 11;
  const shadowVideo = host.shadowRoot.appendChild(new FakeMedia());
  const shadowAudio = host.shadowRoot.appendChild(new FakeMedia("audio"));
  top.addNode(host);
  for (const media of [dynamic, shadowVideo, shadowAudio]) assert.equal(media.playbackRate, 3.25);
  assert.ok(top.observers[0].observed.includes(host.shadowRoot));
  const key = embedded.dispatchKey();
  assert.equal(key.defaultPrevented, true);
  assert.equal(key.propagationStopped, true);
  await settle();
  for (const media of [video, audio, dynamic, shadowVideo, shadowAudio, frameAudio]) {
    assert.equal(media.playbackRate, 1);
  }
  assert.equal(otherVideo.playbackRate, 2);
  assert.equal(h.storedValues.playbackSpeed, 1);
  embedded.dispatchKey();
  await settle();
  assert.equal(video.playbackRate, 3.25);
  assert.equal(h.sessions.get(2).lastNon1xSpeed, 2);
});

test("Numpad0 ignores editable targets, modifiers, composing, repeats and row zero", async () => {
  const h = createHarness();
  const frame = h.createFrame(1);
  await settle();
  const editable = new FakeElement("div");
  editable.isContentEditable = true;
  const cases = [
    { code: "Digit0" }, { repeat: true }, { isComposing: true },
    ...["altKey", "ctrlKey", "metaKey", "shiftKey"].map((key) => ({ [key]: true })),
    ...["input", "textarea", "select"].map((tag) => ({ target: new FakeElement(tag) })),
    { target: editable },
    { composedPath() { return [new FakeElement("input")]; } }
  ];
  for (const overrides of cases) assert.equal(frame.dispatchKey(overrides).defaultPrevented, false);
  await settle();
  assert.equal(h.sessions.get(1).revision, 0);
  frame.dispatchKey();
  frame.dispatchKey();
  await settle();
  assert.equal(h.sessions.get(1).speed, 2, "rapid toggles are serialized");
  assert.equal(h.sessions.get(1).revision, 2);
});

test("content cannot supply another tab ID and requests are serialized", async () => {
  const h = createHarness();
  await settle();
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 4 }, { tab: { id: 1 } });
  assert.equal(h.sessions.get(1).speed, 4);
  assert.equal(h.sessions.get(2).speed, 2);
  await Promise.all(Array.from({ length: 8 }, () => h.request({
    type: "VIDEO_SPEED_NUDGE", tabId: 2, amount: 0.25
  })));
  assert.equal(h.sessions.get(2).speed, 4);
  assert.equal(await h.request({ type: "UNRELATED" }), undefined);
  await assert.rejects(h.request({ type: "VIDEO_SPEED_SET", speed: 3 }), /valid target tab/);
});

test("reload, navigation, event-page restart and restored session data retain tab speeds", async () => {
  const h = createHarness();
  await settle();
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 2.75 });
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 1 });
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 4 });
  const reload = h.createFrame(1);
  const video = reload.document.appendChild(new FakeMedia());
  await settle();
  assert.equal(video.playbackRate, 1);
  h.restartBackground();
  await settle();
  assert.equal(h.sessions.get(1).speed, 1);
  assert.equal(h.sessions.get(2).speed, 4);
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 1 });
  await settle();
  assert.equal(video.playbackRate, 2.75);

  // Model Firefox restoring the session value under a new tab ID, not an ID-keyed map.
  const saved = h.sessions.get(1);
  const restarted = createHarness({ defaults: h.storedValues, tabs: [101], sessions: new Map([[101, saved]]) });
  await settle();
  assert.equal(restarted.sessions.get(101).speed, 2.75);
  await restarted.createTab(102, { speed: 1, lastNon1xSpeed: 3.5, revision: 9 });
  await restarted.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 102 });
  assert.equal(restarted.sessions.get(102).speed, 3.5);
  restarted.closeTab(102);
  await restarted.createTab(102);
  assert.equal(restarted.sessions.get(102).revision, 0, "closed tab state is not cached by tab ID");
});

test("stale messages are ignored and back/forward-cache pages refresh their state", async () => {
  const h = createHarness();
  const frame = h.createFrame(1);
  const video = frame.document.appendChild(new FakeMedia());
  await settle();
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 3 });
  await settle();
  await frame.message({ type: "VIDEO_SPEED_STATE_CHANGED", state: { speed: 2, lastNon1xSpeed: 2, revision: 0 } });
  assert.equal(video.playbackRate, 3);
  h.sessions.set(1, { speed: 4, lastNon1xSpeed: 4, revision: 2 });
  frame.pageshow();
  await settle();
  assert.equal(video.playbackRate, 4);
});

test("popup shows and edits its tab rather than the latest global default", async () => {
  const h = createHarness();
  h.createFrame(1);
  await settle();
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 4 });
  const { elements, presets } = h.createPopup(1);
  assert.equal(elements.speedRange.disabled, true, "controls wait for tab state");
  await settle();
  assert.equal(elements.speedValue.textContent, "2.00×");
  assert.equal(elements.speedRange.disabled, false);
  assert.equal(elements.availability.hidden, true);
  assert.equal(elements.availabilityText.textContent, "");
  presets.find((preset) => preset.dataset.speed === "2.5").dispatch("click");
  await settle();
  assert.equal(h.sessions.get(1).speed, 2.5);
  assert.equal(h.sessions.get(2).speed, 4);
  assert.equal(elements.notice.textContent, "", "successful speed changes are silent");
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 3 });
  await settle();
  assert.equal(elements.speedValue.textContent, "2.50×");
  h.activeTab = 1;
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 1 });
  await settle();
  assert.equal(elements.speedValue.textContent, "1.00×");
  assert.equal(elements.alternateValue.textContent, "2.5×");
  elements.increaseButton.dispatch("click");
  await settle();
  assert.equal(h.sessions.get(1).speed, 1.25);
});

test("protected-page settings work and persistence failures are reported without cross-tab changes", async () => {
  const h = createHarness();
  await settle();
  const { elements } = h.createPopup(1);
  await settle();
  assert.equal(elements.availabilityText.textContent, "");
  assert.equal(elements.availability.hidden, true);
  assert.equal(elements.saveDefault.disabled, false);
  elements.configButton.dispatch("click");
  assert.equal(elements.configView.hidden, false);
  assert.equal(elements.toggleKeyButton.disabled, false);
  h.failSync = true;
  elements.speedRange.value = "3";
  elements.speedRange.dispatch("input");
  await settle();
  assert.equal(h.sessions.get(1).speed, 3);
  assert.equal(h.storedValues.playbackSpeed, 2);
  assert.match(elements.notice.textContent, /fixed default is unchanged/);
  h.failSync = false;
  h.failSessions = true;
  elements.increaseButton.dispatch("click");
  await settle();
  assert.equal(h.sessions.get(1).speed, 3);
  assert.equal(elements.speedValue.textContent, "3.00×");
  assert.match(elements.notice.textContent, /Couldn't change the speed/);
  h.failSessions = false;
  elements.increaseButton.dispatch("click");
  await settle();
  assert.equal(h.sessions.get(1).speed, 3.25, "a failed operation does not poison the queue");
  assert.equal(h.sessions.get(2).speed, 2);
  assert.equal(elements.notice.textContent, "", "a successful retry clears its failure without a success banner");
});

test("manifest and popup expose tab-local media control and session persistence", () => {
  const manifest = JSON.parse(readSource("manifest.json"));
  const popup = readSource("popup/popup.html");
  assert.equal(manifest.name, "Playback Plus");
  assert.equal(manifest.version, "1.9.0");
  assert.equal(manifest.action.default_title, "Playback Plus");
  assert.equal(manifest.browser_specific_settings.gecko.id, "video-speed@local");
  assert.match(popup, /<title>Playback Plus<\/title>/);
  assert.match(popup, /href="popup\.css"[\s\S]*href="tactile\.css"/);
  assert.doesNotThrow(() => readSource("popup/tactile.css"));
  assert.doesNotMatch(popup, /extension-title|class="brand"|class="logo"/);
  assert.match(popup, /aria-label="Playback Plus controls"/);
  assert.match(popup, /id="dialogueControls"[^>]*aria-labelledby="dialogueHeading"/);
  assert.ok(manifest.web_accessible_resources[0].resources.includes("content/dialogue-processor.js"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "sessions", "webNavigation"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.commands, undefined);
  assert.match(popup, /id="configView"[^>]*hidden/);
  assert.match(popup, /id="increaseKeyButton"/);
  assert.match(popup, /id="playbackHeading">Playback Speed/);


  const referencedFiles = [
    manifest.action.default_popup, ...Object.values(manifest.icons),
    ...manifest.background.scripts, ...manifest.content_scripts.flatMap((entry) => entry.js)
  ];
  for (const file of referencedFiles) assert.doesNotThrow(() => readSource(file), `missing: ${file}`);
});
