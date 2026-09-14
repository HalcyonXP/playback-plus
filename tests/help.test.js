const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readSource } = require("./harness");

function fixture(height = 600) {
  const timers = new Map(); let sequence = 0;
  class Element {
    constructor(rect = {}) { this.rect = { left: 25, top: 280, width: 310, height: 260, bottom: 540, ...rect }; this.listeners = {}; this.style = {}; this.attributes = {}; this.hidden = true; this.hover = false; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, values = {}) { const event = { target: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values }; for (const fn of this.listeners[name] || []) fn(event); return event; }
    setAttribute(name, value) { this.attributes[name] = value; }
    matches() { return this.hover; }
    contains(target) { return target === this; }
    getBoundingClientRect() { return { ...this.rect, height: Math.min(this.rect.height, parseFloat(this.style.maxHeight) || Infinity) }; }
  }
  const app = new Element({ left: 0, bottom: 597 });
  const buttons = [new Element({ width: 25, height: 30, top: 300, bottom: 330 }), new Element({ width: 25, height: 30, top: 300, bottom: 330 })];
  const panels = [new Element(), new Element()];
  buttons.forEach((button, i) => { button.dataset = { help: `panel${i}` }; });
  const config = new Element();
  const document = new Element();
  document.querySelector = () => app;
  document.querySelectorAll = () => buttons;
  document.getElementById = id => id === "configButton" ? config : panels[Number(id.slice(-1))];
  document.activeElement = null;
  const globalEvents = new Element();
  const context = vm.createContext({ document, innerHeight: height, innerWidth: 360,
    setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) { timers.delete(id); },
    addEventListener: (name, fn) => globalEvents.addEventListener(name, fn) });
  vm.runInContext(readSource("popup/help.js"), context);
  return { buttons, panels, document, config, globalEvents, context, flush() { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); } };
}

test("info is hoverable, focusable, pinnable and Escape dismisses without closing the popup", () => {
  const h = fixture(); const [b] = h.buttons, [p] = h.panels;
  b.hover = true; b.emit("mouseenter"); assert.equal(p.hidden, false); assert.equal(b.attributes["aria-expanded"], "true");
  b.hover = false; p.hover = true; b.emit("mouseleave"); h.flush(); assert.equal(p.hidden, false, "pointer can enter the text panel");
  p.hover = false; p.emit("mouseleave"); h.flush(); assert.equal(p.hidden, true);
  h.document.activeElement = b; b.emit("focus"); assert.equal(p.hidden, false);
  const event = h.document.emit("keydown", { key: "Escape" });
  assert.equal(p.hidden, true); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  b.emit("click"); assert.equal(p.hidden, false); h.document.activeElement = null; b.emit("blur"); h.flush(); assert.equal(p.hidden, false);
  b.emit("click"); assert.equal(p.hidden, true, "second click unpins and closes");
});

test("only one info panel opens; outside clicks, Configuration and pagehide close it", () => {
  const h = fixture(); const [a,b] = h.buttons;
  a.emit("click"); b.emit("click"); assert.equal(h.panels[0].hidden, true); assert.equal(h.panels[1].hidden, false);
  h.document.emit("pointerdown", { target: h.panels[1] }); assert.equal(h.panels[1].hidden, false);
  h.document.emit("pointerdown", { target: h.config }); assert.equal(h.panels[1].hidden, true);
  a.emit("click"); h.config.emit("click"); assert.equal(h.panels[0].hidden, true);
  a.emit("click"); h.globalEvents.emit("pagehide"); assert.equal(h.panels[0].hidden, true);
});

test("help positioning bounds its height and placement in a short popup without changing app geometry", () => {
  const h = fixture(180); Object.assign(h.buttons[0].rect, { top: 60, bottom: 90 });
  h.buttons[0].emit("focus"); const p=h.panels[0];
  assert.equal(p.style.maxHeight, "72px"); assert.equal(p.style.top, "96px"); assert.equal(p.style.left, "24px");
  h.context.innerHeight = 420; h.globalEvents.emit("resize");
  assert.equal(p.style.maxHeight, "312px"); assert.ok(parseFloat(p.style.top) >= 90, "never cover the originating info button"); assert.ok(parseFloat(p.style.top) + 260 <= 408);
});

test("focused info buttons scroll all guidance by keyboard without moving focus", () => {
  const h = fixture(), b = h.buttons[0], p = h.panels[0];
  Object.assign(p, { scrollHeight: 800, clientHeight: 280, scrollTop: 0 });
  h.document.activeElement = b; b.emit("focus");
  assert.equal(h.document.emit("keydown", { key: "End" }).prevented, true); assert.equal(p.scrollTop, 520);
  h.document.emit("keydown", { key: "ArrowUp" }); assert.equal(p.scrollTop, 484);
  h.document.emit("keydown", { key: "Home" }); assert.equal(p.scrollTop, 0);
  h.document.emit("keydown", { key: "PageDown" }); assert.equal(p.scrollTop, 224);
  assert.equal(h.document.activeElement, b); assert.equal(p.hidden, false);
});

test("unified markup keeps real controls and complete safety help without retired navigation or mock code", () => {
  const html=readSource("popup/popup.html"), audio=readSource("popup/audio.js"), css=readSource("popup/popup.css");
  assert.doesNotMatch(html+audio, /audioButton|dialogueButton|audioBackButton|dialogueBackButton|audioSummary|dialogueSummary|audioView|dialogueView|data-switch|mock\.js/);
  for (const heading of ["Playback Speed", "Audio Sync", "Voice Clarity"]) assert.ok(html.includes(`>${heading}</h2>`));
  assert.doesNotMatch(html+audio, /Audio sync/);
  assert.equal([...html.matchAll(/data-help=/g)].length, 2);
  assert.equal([...html.matchAll(/class="info-panel" role="tooltip" hidden/g)].length, 2);
  assert.doesNotMatch(html + audio, /audioStatus|audioError|dialogueStatus|dialogueError/);
  assert.match(html, /original sound may return suddenly louder/i);
  assert.match(html, /On shows your requested setting/);
  assert.match(html, /turn both Off and reload|turn both audio features Off and reload/i);
  assert.match(css, /\.audio-deck \{[^}]*padding-top: 1px/);
  assert.match(css, /\.info-panel \{[^}]*position: fixed[^}]*overflow-y: auto/);
  assert.doesNotMatch(readSource("popup/help.js"), /browser\.|innerHTML|storage\.|fetch\(/);
});
