const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, settle, readSource } = require("./harness");
const absent = e => {
  for (const id of ["audioStatus", "dialogueStatus", "audioError", "dialogueError"]) assert.equal(e[id], undefined, id);
};

test("audio status and warnings are removed from DOM/controller, not concealed by CSS", async () => {
  const h = createHarness();
  const { elements:e } = h.createPopup(1); await settle();
  absent(e);
  assert.equal(e.audioEnabled.disabled, true); assert.equal(e.dialogueEnabled.disabled, true);
  assert.equal(e.saveDefault.disabled, false);
  e.configButton.dispatch("click"); assert.equal(e.toggleKeyButton.disabled, false);
  assert.equal(e.dialogueToggleKeyButton.disabled, false);
  const html = readSource("popup/popup.html"), audio = readSource("popup/audio.js");
  assert.doesNotMatch(html + audio, /audioStatus|audioError|dialogueStatus|dialogueError|issuePanel|warning-button|config-note/);
  assert.match(html, /original sound may return suddenly louder/i);
  assert.match(html, /turn both audio features Off and reload/i);
  assert.match(html, /not confirmation that filtering works/);
  assert.equal((html.match(/<p>On\/Off<\/p>/g) || []).length, 2);
  assert.equal((html.match(/<p>By 10%<\/p>/g) || []).length, 2);
});

test("starting, connected, paused, missing, partial and failed audio stay quiet with Off usable", async () => {
  const h = createHarness(); h.createFrame(1);
  const { elements:e, pollAudio } = h.createPopup(1); await settle();
  h.audioReports.set(1, { media:1, eligible:1, connected:0, paused:true }); await pollAudio();
  assert.equal(e.audioEnabled.disabled, false, "eligible paused media remains configurable");
  e.audioEnabled.dispatch("click"); await settle(); e.dialogueEnabled.dispatch("click"); await settle();
  for (const fields of [{ applying:true, dialoguePending:1 }, {}, { contextState:"suspended" },
    { media:0, eligible:0, connected:0, dialogueConnected:0 }, { unavailable:true, eligible:0 },
    { unsupported:1 }, { dialogueConnected:0, dialogueFailed:1, dialogueError:"private filter detail" },
    { eligible:0, connected:0, error:"private engine detail" }]) {
    h.audioReports.set(1, fields); await pollAudio(); await settle();
    absent(e);
    assert.equal(e.audioEnabled.textContent, "On"); assert.equal(e.dialogueEnabled.textContent, "On");
    assert.equal(e.audioEnabled.disabled, false); assert.equal(e.dialogueEnabled.disabled, false);
    assert.equal(e.availabilityText.textContent, "");
  }
  e.dialogueEnabled.dispatch("click"); await settle();
  e.audioEnabled.dispatch("click"); await settle();
  assert.equal(e.audioEnabled.textContent, "Off"); assert.equal(e.dialogueEnabled.textContent, "Off");
});

test("quiet failures retain authoritative values and reject stale status and broadcasts", async () => {
  const h=createHarness(); h.createFrame(1);
  const {elements:e,pollAudio}=h.createPopup(1); await settle();
  e.audioExact.value="700";e.audioExact.dispatch("change");await settle();
  h.failSessions=true;
  e.audioExact.value="900";e.audioExact.dispatch("change");await settle();
  assert.equal(e.audioExact.value,"700");
  e.dialogueMix.value="30";e.dialogueMix.dispatch("input");e.dialogueMix.dispatch("change");await settle();
  assert.equal(e.dialogueValue.textContent,"100%");
  h.failSessions=false;
  const original=h.request;let release;
  h.request=(m,sender)=>m.type==="AUDIO_SYNC_STATUS_GET" ? new Promise(resolve=>{release=resolve;}) : original(m,sender);
  const old=structuredClone(h.audioSessions.get(1));
  const pending=pollAudio();await settle();
  await original({type:"DIALOGUE_MIX",tabId:1,mix:60});await settle();
  release({state:old,frames:[{eligible:0}]});await pending;await settle();
  assert.equal(e.dialogueValue.textContent,"60%");
  assert.equal(e.audioEnabled.disabled,false,"stale eligibility must not disable current controls");
  absent(e);
});
