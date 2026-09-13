const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, settle, FakeMedia, readSource, run } = require("./harness");
const page = { url: "moz-extension://test-extension/popup/popup.html" };
const getDefault = h => h.request({ type: "VIDEO_SPEED_DEFAULT_GET" }, page);
const saveDefault = (h, tabId = 1) => h.request({ type: "VIDEO_SPEED_DEFAULT_SET", tabId }, page);
const select = (h, speed, tabId = 1) => h.request({ type: "VIDEO_SPEED_SET", tabId, speed });

test("fresh installation starts with a fixed 1× default and useful 2× quick-toggle alternate", async () => {
  const h = createHarness({ defaults: {} });
  const frame = h.createFrame(1);
  const media = frame.document.appendChild(new FakeMedia());
  await settle();
  assert.deepEqual(h.storedValues, { playbackSpeed: 1, lastNon1xSpeed: 2, savedSpeedDefault: { enabled: true, speed: 1 } });
  assert.equal(media.playbackRate, 1);
  frame.dispatchKey();
  await settle();
  assert.equal(media.playbackRate, 2);
  await h.createTab(3);
  assert.equal(h.sessions.get(3).speed, 1);
  assert.equal(h.sessions.get(2).speed, 1);
  assert.equal((await getDefault(h)).speed, 1);
});

test("every Save captures a snapshot; later selections and tab creation never replace it", async () => {
  const h = createHarness({ defaults: {} });
  await settle();
  await select(h, 1.5);
  await saveDefault(h);
  await select(h, 2);
  await h.request({ type: "VIDEO_SPEED_NUDGE", tabId: 2, amount: 2 });
  await h.request({ type: "VIDEO_SPEED_TOGGLE", tabId: 2 });
  assert.deepEqual(h.storedValues.savedSpeedDefault, { enabled: true, speed: 1.5 });
  await h.createTab(3);
  assert.equal(h.sessions.get(3).speed, 1.5);
  assert.equal(h.sessions.get(1).speed, 2);
  assert.equal(h.sessions.get(2).speed, 1);
  const writes = h.writes.length;
  await getDefault(h);
  await h.request({ type: "VIDEO_SPEED_GET_STATE", tabId: 3 });
  await h.createTab(4);
  assert.equal(h.writes.length, writes, "normalized reads/tab creation never become explicit choices");
  await saveDefault(h);
  await h.createTab(5);
  assert.equal(h.sessions.get(5).speed, 2, "re-saving captures the current rate without an Off/On cycle");
  await saveDefault(h, 2);
  await h.createTab(6);
  assert.equal(h.sessions.get(6).speed, 1, "1× can be saved too");
  assert.equal(h.sessions.get(3).speed, 1.5, "existing tabs retain their own speed");
});

test("snapshot writes serialize with rapid choices and capture authoritative tab state", async () => {
  const h = createHarness();
  await settle();
  await Promise.all([
    select(h, 2.75), saveDefault(h), select(h, 4), h.createTab(3)
  ]);
  assert.equal((await getDefault(h)).speed, 2.75);
  assert.equal(h.sessions.get(3).speed, 2.75);
  assert.equal(h.sessions.get(1).speed, 4);
  await Promise.all([saveDefault(h), select(h, 0.75, 2), saveDefault(h, 2)]);
  assert.equal((await getDefault(h)).speed, 0.75);
  await h.request({ type: "VIDEO_SPEED_DEFAULT_SET", tabId: 1, speed: 8 }, page);
  assert.equal((await getDefault(h)).speed, 4, "a client-supplied speed cannot spoof the capture");
});

test("upgrade fixes the previous effective new-tab rate, preserving old On snapshots and existing sessions", async () => {
  for (const [defaults, expected] of [
    [{ defaultSpeed: 2.5 }, 2.5],
    [{ playbackSpeed: 3, lastNon1xSpeed: 3 }, 3],
    [{ playbackSpeed: 3, savedSpeedDefault: { enabled: false, speed: 0.5 } }, 3],
    [{ playbackSpeed: 3, savedSpeedDefault: { enabled: true, speed: 0.5 } }, 0.5]
  ]) {
    const h = createHarness({ defaults, sessions: new Map([[1, { speed: 1.75, lastNon1xSpeed: 1.75, revision: 8 }]]) });
    await settle();
    assert.deepEqual(h.storedValues.savedSpeedDefault, { enabled: true, speed: expected });
    assert.equal(h.storedValues.defaultSpeed, undefined);
    assert.equal(h.sessions.get(1).speed, 1.75);
    assert.equal(h.sessions.get(1).revision, 8);
    await select(h, 4);
    await h.createTab(3);
    assert.equal(h.sessions.get(3).speed, expected);
    h.restartBackground();
    await settle();
    await h.install();
    await h.createTab(4);
    assert.equal(h.sessions.get(4).speed, expected);
    assert.equal(h.sessions.get(1).speed, 4);
  }
});

test("fixed snapshots survive full restart and Sync; legacy Off arriving remotely migrates once", async () => {
  const h = createHarness();
  await settle();
  await select(h, 2.5);
  await saveDefault(h);
  await select(h, 3);
  const restarted = createHarness({ defaults: h.storedValues });
  await settle();
  assert.equal(restarted.sessions.get(1).speed, 2.5);
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 0.5 } });
  await h.createTab(3);
  assert.equal(h.sessions.get(3).speed, 0.5);
  await h.storage.sync.set({ savedSpeedDefault: { enabled: false, speed: 0.5 } });
  await settle();
  assert.deepEqual(h.storedValues.savedSpeedDefault, { enabled: true, speed: 3 });
  await select(h, 4);
  await h.createTab(4);
  assert.equal(h.sessions.get(4).speed, 3);
  assert.equal(h.sessions.get(3).speed, 0.5);
});

test("only verified extension pages save; obsolete toggle, invalid target and failed writes leave snapshot intact", async () => {
  const h = createHarness();
  await settle();
  for (const sender of [{}, { tab: { id: 1 }, url: "https://example.com" }, { url: "moz-extension://test-extension.evil/popup.html" }]) {
    for (const type of ["VIDEO_SPEED_DEFAULT_GET", "VIDEO_SPEED_DEFAULT_SET"]) {
      await assert.rejects(h.request({ type, tabId: 2 }, sender), /Only extension pages/);
    }
  }
  for (const enabled of [true, false, "true"]) {
    await assert.rejects(h.request({ type: "VIDEO_SPEED_DEFAULT_SET", enabled, tabId: 1 }, page), /Invalid/);
  }
  for (const tabId of [null, -1, "1", 999]) await assert.rejects(saveDefault(h, tabId), /valid target tab|Tab closed/);
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 4 }, { ...page, tab: { id: 1 } });
  await h.request({ type: "VIDEO_SPEED_DEFAULT_SET", tabId: 2 }, { ...page, tab: { id: 1 } });
  assert.equal((await getDefault(h)).speed, 4, "verified embedded popup honors its selected tab");
  assert.equal(h.sessions.get(1).speed, 2);
  h.failSync = true;
  await assert.rejects(saveDefault(h), /Sync unavailable/);
  assert.equal((await getDefault(h)).speed, 4);
  const changed = await select(h, 3);
  assert.equal(changed.defaultSaved, false);
  assert.equal((await getDefault(h)).speed, 4);
  assert.equal(h.sessions.get(1).speed, 3);
  h.failSync = false;
  await saveDefault(h);
  assert.equal((await getDefault(h)).speed, 3);
});

test("popups share a truthful saved readout without changing each other's tab rates", async () => {
  const h = createHarness({ defaults: {} });
  await settle();
  const a = h.createPopup(1), b = h.createPopup(2);
  await settle();
  assert.equal(a.elements.saveDefault.attributes["aria-checked"], undefined);
  assert.equal(a.elements.saveDefault.textContent, "Save");
  assert.equal(a.elements.defaultSpeed.textContent, "1×");
  a.presets.find(p => p.dataset.speed === "2").dispatch("click");
  await settle();
  assert.equal(a.elements.speedRange.value, "2");
  assert.equal(a.elements.defaultSpeed.textContent, "1×");
  assert.equal(b.elements.speedRange.value, "1");
  a.elements.saveDefault.dispatch("click");
  await settle();
  assert.equal(b.elements.defaultSpeed.textContent, "2×");
  b.presets.find(p => p.dataset.speed === "0.5").dispatch("click");
  await settle();
  assert.equal(b.elements.defaultSpeed.textContent, "2×");
  assert.equal(b.elements.speedRange.value, "0.5");
  b.elements.saveDefault.dispatch("click");
  await settle();
  assert.equal(a.elements.defaultSpeed.textContent, "0.5×");
  assert.equal(a.elements.speedRange.value, "2");
  assert.equal(a.elements.notice.textContent, "");
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 1.25 } });
  await settle();
  assert.equal(a.elements.defaultSpeed.textContent, "1.25×");
  assert.equal(b.elements.defaultSpeed.textContent, "1.25×");
  assert.equal(b.elements.speedRange.value, "0.5");
});

test("popup failed Save is retryable; rapid presets then Save capture the final choice", async () => {
  const h = createHarness();
  await settle();
  const { elements, presets } = h.createPopup();
  await settle();
  h.failSync = true;
  elements.saveDefault.dispatch("click");
  await settle();
  assert.equal(elements.defaultSpeed.textContent, "2×");
  assert.equal(elements.saveDefault.disabled, false);
  assert.match(elements.notice.textContent, /Couldn't save the new-tab default/);
  h.failSync = false;
  for (const speed of [0.5, 3, 1.5]) presets.find(p => Number(p.dataset.speed) === speed).dispatch("click");
  elements.saveDefault.dispatch("click");
  await settle();
  assert.equal(elements.speedRange.value, "1.5");
  assert.equal(elements.defaultSpeed.textContent, "1.5×");
  assert.equal((await getDefault(h)).speed, 1.5);
  assert.equal(elements.notice.textContent, "");
});

test("failed default reads show an unknown value, disable Save and recover after a storage update", async () => {
  const h = createHarness();
  await settle();
  h.failRead = true;
  const popup = h.createPopup();
  await settle();
  assert.equal(popup.elements.saveDefault.disabled, true);
  assert.equal(popup.elements.defaultSpeed.textContent, "—");
  assert.match(popup.elements.notice.textContent, /Couldn't load the new-tab default/);
  h.failRead = false;
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 1.25 } });
  await settle();
  assert.equal(popup.elements.saveDefault.disabled, false);
  assert.equal(popup.elements.defaultSpeed.textContent, "1.25×");
  assert.equal(popup.elements.notice.textContent, "");
});

test("Save remains a single action while pending; its final read cannot adopt an older acknowledgement", async () => {
  const h = createHarness();
  await settle();
  const { elements } = h.createPopup();
  await settle();
  const original = h.request;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let saves = 0;
  h.request = async (message, sender) => {
    const result = await original(message, sender);
    if (message.type === "VIDEO_SPEED_DEFAULT_SET" && ++saves === 1) {
      entered();
      await new Promise(resolve => { release = resolve; });
    }
    return result;
  };
  elements.saveDefault.dispatch("click");
  await started;
  assert.equal(elements.saveDefault.disabled, true);
  assert.equal(elements.saveDefault.attributes["aria-busy"], "true");
  elements.saveDefault.dispatch("click");
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 0.75 } });
  await settle();
  release();
  await settle();
  assert.equal(saves, 1);
  assert.equal(elements.defaultSpeed.textContent, "0.75×");
  assert.equal(elements.saveDefault.disabled, false);
});

test("compact markup, presets and malformed/missing defaults remain consistent", () => {
  const html = readSource("popup/popup.html");
  assert.deepEqual([...html.matchAll(/data-speed="([\d.]+)"/g)].map(m => Number(m[1])), [0.5, 1, 1.5, 2, 2.5, 3]);
  assert.match(html, /id="defaultLabel">Default for new tabs<\/span>/);
  assert.doesNotMatch(html, /defaultKind|defaultHint|<header|channel-index/);
  const { VideoSpeedUtils: u } = run("shared/speed.js", {});
  assert.equal(u.DEFAULT_SPEED, 1);
  assert.equal(u.DEFAULT_ALTERNATE_SPEED, 2);
  assert.equal(u.readSpeedDefaults({ savedSpeedDefault: { enabled: true, speed: 900 } }).speed, 8);
  assert.equal(u.readSpeedDefaults({ savedSpeedDefault: { enabled: true, speed: "broken" } }).speed, 1);
  assert.equal(u.readSpeedDefaults({ playbackSpeed: 3, savedSpeedDefault: { enabled: "yes", speed: 0.5 } }).speed, 3);
});

test("stale preference reads cannot overwrite a newer shared snapshot", async () => {
  const h = createHarness();
  await settle();
  const { elements } = h.createPopup();
  await settle();
  const original = h.request;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let delayOnce = true;
  h.request = async (message, sender) => {
    const result = await original(message, sender);
    if (message.type === "VIDEO_SPEED_DEFAULT_GET" && delayOnce) {
      delayOnce = false;
      entered();
      await new Promise(resolve => { release = resolve; });
    }
    return result;
  };
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 3 } });
  await started;
  await h.storage.sync.set({ savedSpeedDefault: { enabled: true, speed: 0.5 } });
  await settle();
  assert.equal(elements.defaultSpeed.textContent, "0.5×");
  release();
  await settle();
  assert.equal(elements.defaultSpeed.textContent, "0.5×");
  h.failSync = true;
  elements.increaseButton.dispatch("click");
  await settle();
  assert.match(elements.notice.textContent, /fixed default is unchanged/);
  assert.equal(elements.defaultSpeed.textContent, "0.5×");
});
