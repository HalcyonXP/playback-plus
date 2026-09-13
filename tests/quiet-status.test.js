const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, settle, readSource } = require("./harness");

test("empty and unsupported pages stay quiet without blocking settings or adding an overlay", async () => {
  const h = createHarness();
  const { elements: e } = h.createPopup(1); // No frames: an empty/restricted page.
  await settle();
  assert.equal(e.availability.hidden, true);
  assert.equal(e.availabilityText.textContent, "");
  for (const id of ["audioStatus", "dialogueStatus", "audioError", "dialogueError"]) assert.equal(e[id].textContent, "", id);
  assert.equal(e.audioEnabled.disabled, true);
  assert.equal(e.dialogueEnabled.disabled, true);
  assert.equal(e.saveDefault.disabled, false);
  e.configButton.dispatch("click");
  assert.equal(e.configView.hidden, false);
  assert.equal(e.toggleKeyButton.disabled, false);
  const html = readSource("popup/popup.html");
  assert.doesNotMatch(html, /unavailable-overlay|unavailable-message|\binert\b|Cannot detect media playing/);
  assert.match(html, /id="audioSafety"/);
  assert.match(html, /id="dialogueSafety"/);
  assert.doesNotMatch(readSource("popup/popup.css") + readSource("popup/tactile.css"), /#(?:audioStatus|dialogueStatus|audioError|dialogueError)(?:\s|,)[^{]*\{[^}]*display:\s*none/);
});

test("media disappearing keeps enabled selections quiet, leaves Off usable and recovers on the next report", async () => {
  const h = createHarness();
  h.createFrame(1);
  const { elements: e } = h.createPopup(1);
  await settle();
  // Present, paused media is still eligible. No new playing/paused gate is introduced.
  h.audioReports.set(1, { media: 1, eligible: 1, connected: 0, paused: true });
  e.audioButton.dispatch("click"); await settle();
  assert.equal(e.audioEnabled.disabled, false);
  e.audioEnabled.dispatch("click"); await settle();
  e.dialogueEnabled.dispatch("click"); await settle();
  for (const fields of [{ media: 0 }, { unavailable: true }, { media: 1, unsupported: 1 }]) {
    h.audioReports.set(1, { ...fields, eligible: 0, connected: 0, dialogueConnected: 0 });
    e.audioButton.dispatch("click"); await settle();
    assert.equal(e.audioStatus.textContent, "");
    assert.equal(e.dialogueStatus.textContent, "");
    assert.equal(e.audioSummary.textContent, "On · 0 ms selected");
    assert.equal(e.dialogueSummary.textContent, "On · 100% selected");
    assert.equal(e.audioEnabled.disabled, false, "Audio Off must remain usable");
    assert.equal(e.dialogueEnabled.disabled, false, "Filter Off must remain usable");
    assert.equal(e.audioError.textContent, "");
    assert.equal(e.dialogueError.textContent, "");
  }
  h.audioReports.set(1, {});
  e.audioButton.dispatch("click"); await settle();
  assert.equal(e.audioSummary.textContent, "On · 0 ms");
  assert.equal(e.dialogueSummary.textContent, "On · 100% mix");
  assert.match(e.audioStatus.textContent, /^On/);
  assert.match(e.dialogueStatus.textContent, /^On/);
});

test("quiet no-media UI does not hide filter failure flags, engine failures or retry controls", async () => {
  const h = createHarness(); h.createFrame(1);
  const { elements: e } = h.createPopup(1); await settle();
  e.audioEnabled.dispatch("click"); await settle();
  e.dialogueEnabled.dispatch("click"); await settle();
  h.audioReports.set(1, { eligible: 0, connected: 0, dialogueConnected: 0, dialogueFailed: 1 });
  e.dialogueButton.dispatch("click"); await settle();
  assert.match(e.dialogueStatus.textContent, /Filter unavailable/);
  assert.match(e.dialogueError.textContent, /Off and On/);
  assert.equal(e.dialogueEnabled.disabled, false);
  h.audioReports.set(1, { eligible: 0, connected: 0, dialogueConnected: 0, error: "private engine detail" });
  e.audioButton.dispatch("click"); await settle();
  assert.match(e.audioError.textContent, /both audio features Off and reload/);
  assert.match(e.dialogueError.textContent, /both audio features Off and reload/);
  assert.doesNotMatch(e.audioError.textContent + e.dialogueError.textContent, /private engine detail/);
});
