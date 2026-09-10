const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource, settle, FakeElement, FakeMedia, createHarness } = require("./harness");
const save = (h, action, code) => h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action, code });

function utilities(browser) {
  const context = vm.createContext({ browser });
  vm.runInContext(readSource("shared/shortcuts.js"), context);
  return context.VideoSpeedShortcuts;
}

test("hotkey normalization, labels, null disabling and duplicate protection", () => {
  const u = utilities();
  assert.equal(u.normalizeHotkeys().increase, "NumpadAdd");
  assert.equal(u.normalizeHotkeys({ toggle: null }).toggle, null);
  assert.equal(u.normalizeHotkeys({ toggle: "Escape" }).toggle, "Numpad0");
  assert.equal(u.normalizeHotkeys({ toggle: "NumpadAdd" }).increase, null);
  assert.throws(() => u.assignHotkey({}, "toggle", "NumpadAdd"), /already assigned/);
  for (const code of ["Escape", "ShiftLeft", "", "Unidentified", "F25"]) {
    assert.throws(() => u.assignHotkey({}, "toggle", code), /Unsupported/);
  }
  assert.throws(() => u.assignHotkey({}, "unknown", "KeyK"), /Unsupported/);
  assert.equal(u.formatHotkey("Numpad0"), "Num 0");
  assert.equal(u.formatHotkey("Equal"), "= / +");
  assert.equal(u.formatHotkey(null), "Not set");
});

test("default adjustments use only numpad +/-; typing, modifiers and repeats are ignored", async () => {
  const h = createHarness();
  const frame = h.createFrame(1);
  const other = h.createFrame(2);
  const video = frame.document.appendChild(new FakeMedia());
  const otherVideo = other.document.appendChild(new FakeMedia());
  await settle();
  for (const code of ["Equal", "Minus", "Digit0"]) {
    assert.equal(frame.dispatchKey({ code }).defaultPrevented, false);
  }
  for (const code of ["NumpadAdd", "NumpadSubtract"]) {
    for (const override of [{ repeat: true }, { isComposing: true }, { altKey: true },
      { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
      { target: new FakeElement("input") }, { target: new FakeElement("textarea") },
      { target: new FakeElement("select") },
      { composedPath() { const e = new FakeElement("div"); e.isContentEditable = true; return [e]; } }]) {
      assert.equal(frame.dispatchKey({ code, ...override }).defaultPrevented, false);
    }
  }
  assert.equal(frame.dispatchKey({ code: "NumpadAdd" }).defaultPrevented, true);
  await settle();
  assert.equal(video.playbackRate, 2.25);
  assert.equal(otherVideo.playbackRate, 2);
  frame.dispatchKey({ code: "NumpadSubtract" });
  await settle();
  assert.equal(video.playbackRate, 2);
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 8 });
  frame.dispatchKey({ code: "NumpadAdd" });
  await settle();
  assert.equal(video.playbackRate, 8);
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 0.25 });
  frame.dispatchKey({ code: "NumpadSubtract" });
  await settle();
  assert.equal(video.playbackRate, 0.25);
});

test("saved bindings update every open frame, persist on reopen and refresh from BFCache", async () => {
  const h = createHarness();
  const frames = [h.createFrame(1), h.createFrame(1), h.createFrame(2)];
  await settle();
  await save(h, "toggle", "KeyK");
  await save(h, "increase", "Equal");
  await save(h, "decrease", "Minus");
  for (const frame of frames) {
    assert.equal(frame.dispatchKey().defaultPrevented, false);
    assert.equal(frame.dispatchKey({ code: "NumpadAdd" }).defaultPrevented, false);
    assert.equal(frame.dispatchKey({ code: "KeyK" }).defaultPrevented, true);
  }
  await settle();
  assert.equal(h.sessions.get(1).speed, 2, "two frame keypresses toggle twice, not once per recipient");
  assert.equal(h.sessions.get(2).speed, 1);
  frames[0].dispatchKey({ code: "Equal", shiftKey: true });
  await settle();
  assert.equal(h.sessions.get(1).speed, 2.25);
  frames[0].dispatchKey({ code: "Minus" });
  await settle();
  assert.equal(h.sessions.get(1).speed, 2);
  await save(h, "toggle", null);
  assert.equal(frames[0].dispatchKey({ code: "KeyK" }).defaultPrevented, false);
  h.restartBackground();
  const popup = h.createPopup();
  const reloaded = h.createFrame(1);
  await settle();
  assert.equal(popup.elements.toggleKeyButton.textContent, "Not set");
  assert.equal(popup.elements.increaseKeyButton.textContent, "= / +");
  assert.equal(reloaded.dispatchKey().defaultPrevented, false);
  // Model a frozen document missing the storage event.
  h.storedValues.hotkeys = { toggle: "KeyJ", increase: null, decrease: null };
  reloaded.pageshow();
  await settle();
  assert.equal(reloaded.dispatchKey({ code: "KeyJ" }).defaultPrevented, true);
  assert.equal(reloaded.dispatchKey({ code: "Equal" }).defaultPrevented, false);
});

test("configuration navigation, capture, duplicate rejection, cancel and Escape clearing", async () => {
  const h = createHarness();
  const popup = h.createPopup();
  const { elements: e, dispatchKey } = popup;
  assert.equal(e.toggleKeyButton.disabled, true);
  await settle();
  assert.equal(e.configView.hidden, true);
  e.configButton.dispatch("click");
  assert.equal(e.mainView.hidden, true);
  assert.equal(e.configView.hidden, false);
  assert.equal(e.backButton.focused, true);
  e.toggleKeyButton.dispatch("click");
  assert.equal(dispatchKey({ code: "NumpadAdd" }).defaultPrevented, true);
  assert.match(e.hotkeyHint.textContent, /already assigned/);
  assert.equal(e.toggleKeyButton.attributes["aria-pressed"], "true");
  for (const key of [{ code: "KeyK", repeat: true }, { code: "KeyK", isComposing: true },
    { code: "ShiftLeft", shiftKey: true }, { code: "KeyK", ctrlKey: true }]) dispatchKey(key);
  assert.equal(h.storedValues.hotkeys, undefined);
  dispatchKey({ code: "Space" });
  assert.equal(e.toggleKeyButton.disabled, true);
  assert.equal(dispatchKey({ code: "Space" }, "keyup").defaultPrevented, true);
  await settle();
  assert.equal(h.storedValues.hotkeys.toggle, "Space");
  assert.equal(e.toggleKeyButton.attributes["aria-pressed"], "false");
  assert.equal(e.notice.textContent, "", "shortcut changes do not produce success banners");
  e.increaseKeyButton.dispatch("click");
  dispatchKey({ code: "Equal", shiftKey: true });
  await settle();
  assert.equal(h.storedValues.hotkeys.increase, "Equal");
  e.decreaseKeyButton.dispatch("click");
  dispatchKey({ code: "Escape" });
  dispatchKey({ code: "Escape" }, "keyup");
  await settle();
  assert.equal(h.storedValues.hotkeys.decrease, null);
  assert.equal(e.decreaseKeyButton.textContent, "Not set");
  e.toggleKeyButton.dispatch("click");
  e.toggleKeyButton.dispatch("click");
  assert.equal(dispatchKey({ code: "KeyJ" }).defaultPrevented, false);
  e.toggleKeyButton.dispatch("click");
  e.backButton.dispatch("click");
  assert.equal(e.mainView.hidden, false);
  assert.equal(e.configView.hidden, true);
  assert.equal(dispatchKey({ code: "KeyJ" }).defaultPrevented, false);
  assert.equal(h.storedValues.hotkeys.toggle, "Space");
  assert.equal(dispatchKey({ code: "Escape" }).defaultPrevented, false, "Escape outside capture is left to Firefox");
});

test("writer rejects duplicate races, content configuration and failed saves without losing bindings", async () => {
  const h = createHarness();
  await settle();
  const requests = await Promise.allSettled([save(h, "toggle", "KeyK"), save(h, "increase", "KeyK")]);
  assert.equal(requests[0].status, "fulfilled");
  assert.equal(requests[1].status, "rejected");
  assert.equal(h.storedValues.hotkeys.increase, "NumpadAdd");
  await assert.rejects(h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action: "toggle", code: null }, { tab: { id: 1 } }), /extension pages/);
  await assert.rejects(h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action: "toggle", code: null },
    { tab: { id: 1 }, url: "https://example.com/" }), /extension pages/);
  await h.request({ type: "VIDEO_SPEED_SET_HOTKEY", action: "toggle", code: "KeyK" },
    { tab: { id: 1 }, url: "moz-extension://test-extension/popup/popup.html" });
  await assert.rejects(save(h, "toggle", "Escape"), /Unsupported/);
  const popup = h.createPopup();
  await settle();
  h.failSync = true;
  popup.elements.configButton.dispatch("click");
  popup.elements.toggleKeyButton.dispatch("click");
  popup.dispatchKey({ code: "Escape" });
  await settle();
  assert.equal(h.storedValues.hotkeys.toggle, "KeyK");
  assert.equal(popup.elements.toggleKeyButton.textContent, "K");
  assert.match(popup.elements.notice.textContent, /Couldn't change the shortcut/);
  assert.equal(popup.elements.toggleKeyButton.disabled, false);
  h.failSync = false;
  await save(h, "toggle", null);
  assert.equal(popup.elements.toggleKeyButton.textContent, "Not set");
});

test("storage observation ignores unrelated changes and stale reads; removal restores defaults", async () => {
  let listener;
  let resolveRead;
  const values = [];
  const u = utilities({ storage: {
    onChanged: { addListener(fn) { listener = fn; } },
    sync: { get() { return new Promise(resolve => { resolveRead = resolve; }); } }
  } });
  const observer = u.observeHotkeys(value => values.push(value));
  const read = observer.refresh();
  listener({ hotkeys: { newValue: { toggle: "KeyK" } } }, "sync");
  resolveRead({ hotkeys: { toggle: "KeyJ" } });
  await read;
  assert.equal(values.length, 1);
  assert.equal(values[0].toggle, "KeyK");
  listener({ playbackSpeed: { newValue: 4 } }, "sync");
  listener({ hotkeys: { newValue: {} } }, "local");
  assert.equal(values.length, 1);
  listener({ hotkeys: { oldValue: {} } }, "sync");
  assert.equal(values[1].toggle, "Numpad0");
});

test("failed hotkey reads leave configuration disabled rather than overwriting unknown settings", async () => {
  const h = createHarness();
  await settle();
  h.failRead = true;
  const popup = h.createPopup();
  await settle();
  for (const id of ["toggleKeyButton", "increaseKeyButton", "decreaseKeyButton"]) {
    assert.equal(popup.elements[id].disabled, true);
  }
});
