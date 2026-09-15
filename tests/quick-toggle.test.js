const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource, settle, FakeMedia, createHarness } = require("./harness");

test("quick toggle round-trips every supported custom speed without remembering 1x instead", () => {
  const context = vm.createContext({});
  vm.runInContext(readSource("shared/speed.js"), context);
  const u = context.VideoSpeedUtils;
  let state = u.createSpeedState(1);
  for (let speed = u.MIN_SPEED; speed <= u.MAX_SPEED; speed += u.SPEED_STEP) {
    if (speed === 1) continue;
    state = u.updateSpeedState(state, speed);
    for (let cycle = 0; cycle < 3; cycle++) {
      state = u.toggleSpeedState(state);
      assert.equal(state.speed, 1);
      assert.equal(state.lastNon1xSpeed, speed);
      state = u.toggleSpeedState(state);
      assert.equal(state.speed, speed);
    }
    state = u.updateSpeedState(state, 1);
    state = u.updateSpeedState(state, 1);
    assert.equal(u.toggleSpeedState(state).speed, speed, "explicit/repeated 1x preserves custom speed");
  }
});

test("popup choices and page shortcuts share the latest tab-local custom speed across normal-speed selections and restart", async () => {
  const h = createHarness({ defaults: {} });
  const frame = h.createFrame(1);
  const media = frame.document.appendChild(new FakeMedia());
  const { elements: e, presets } = h.createPopup(1);
  await settle();
  const preset = speed => presets.find(p => Number(p.dataset.speed) === speed).dispatch("click");
  const press = async code => {
    assert.equal(frame.dispatchKey({ code }).defaultPrevented, true);
    await settle();
  };
  const roundTrip = async speed => {
    assert.equal(h.sessions.get(1).speed, speed);
    assert.equal(media.playbackRate, speed);
    await press("Numpad0");
    assert.equal(media.playbackRate, 1);
    assert.equal(e.alternateValue.textContent, `${speed}×`);
    await press("Numpad0");
    assert.equal(media.playbackRate, speed);
    assert.equal(h.sessions.get(1).lastNon1xSpeed, speed);
    assert.equal(h.sessions.get(2).speed, 1);
  };

  for (const speed of [0.5, 1.5, 2, 2.5, 3]) {
    preset(speed);
    await settle();
    await roundTrip(speed);
    preset(1);
    await settle();
    await press("Numpad0");
    assert.equal(media.playbackRate, speed, "1x preset keeps the last custom value");
  }
  e.speedRange.value = "1.75";
  e.speedRange.dispatch("input");
  await settle();
  await roundTrip(1.75);
  e.increaseButton.dispatch("click");
  await settle();
  await roundTrip(2);
  e.decreaseButton.dispatch("click");
  await settle();
  await roundTrip(1.75);
  await press("NumpadAdd");
  await roundTrip(2);
  await press("NumpadSubtract");
  await roundTrip(1.75);

  e.speedRange.value = "1";
  e.speedRange.dispatch("input");
  await settle();
  // Neither another tab's custom choice nor saving a normal-speed default
  // may overwrite this tab's alternate.
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 2, speed: 4 });
  e.saveDefault.dispatch("click");
  await settle();
  h.restartBackground();
  await settle();
  await press("Numpad0");
  assert.equal(media.playbackRate, 1.75);
  assert.equal(h.sessions.get(2).speed, 4);
  assert.equal(h.storedValues.savedSpeedDefault.speed, 1);

  // Stepping onto 1x must not erase the last below/above-normal value either.
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 0.75 });
  await settle();
  await press("NumpadAdd");
  assert.equal(media.playbackRate, 1);
  await press("Numpad0");
  assert.equal(media.playbackRate, 0.75);
  await h.request({ type: "VIDEO_SPEED_SET", tabId: 1, speed: 1.25 });
  await settle();
  await press("NumpadSubtract");
  assert.equal(media.playbackRate, 1);
  await press("Numpad0");
  assert.equal(media.playbackRate, 1.25);
});
