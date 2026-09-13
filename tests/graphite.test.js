const assert = require("node:assert/strict");
const test = require("node:test");
const { readSource } = require("./harness");

test("GB1 Graphite markup preserves accessible control names without retired branding or default dialogue", () => {
  const html = readSource("popup/popup.html");
  const css = readSource("popup/popup.css");
  const finish = readSource("popup/tactile.css");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const [, references] of html.matchAll(/\baria-(?:labelledby|describedby|controls)="([^"]+)"/g)) {
    for (const id of references.split(/\s+/)) assert.ok(ids.has(id), `Missing accessible reference: ${id}`);
  }
  assert.match(html, /id="speedRange"[^>]+aria-label="Playback speed"/);
  assert.match(html, /id="dialogueMix"[^>]+aria-label="Filter mix"/);
  assert.match(html, /<label for="audioExact">Exact delay<\/label>/);
  assert.match(html, /aria-label="Selected audio delay"/);
  assert.doesNotMatch(html, /class="brand"|class="logo"|class="eyebrow"|defaultKind|defaultHint|current-speed-label/);
  assert.doesNotMatch(html, /Moves sound later, never earlier\.|Save Default/);
  assert.match(html, /id="defaultLabel">Default for new tabs<\/span>/);
  const save = html.match(/<button id="saveDefault"[^>]*>/)[0];
  assert.match(save, /aria-label="Save current playback speed as default for new tabs"/);
  assert.doesNotMatch(save, /role="switch"|aria-checked|aria-pressed/);
  assert.ok(html.indexOf('class="presets"') < html.indexOf('class="default-control"'));
  assert.ok(html.indexOf('class="default-control"') < html.indexOf('id="audioButton"'));
  const readout = html.match(/<div id="defaultReadout"[^>]*>/)[0];
  assert.doesNotMatch(readout, /tabindex|role="button"/);
  assert.match(readout, /aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="configHeading">Configuration<\/h2>\s*<\/div>\s*<p id="hotkeyHint" class="config-help">Choose a shortcut\. Press a key\. Escape clears it\.<\/p>/);
  assert.doesNotMatch(html, /shortcut-scope|Shared shortcuts; changes affect the current tab/);
  assert.equal([...html.matchAll(/id="hotkeyHint"/g)].length, 1);
  assert.match(html, /id="hotkeyFeedback"[^>]+role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.equal([...html.matchAll(/aria-describedby="hotkeyHint hotkeyFeedback"/g)].length, 6);
  assert.doesNotMatch(readSource("popup/popup.js"), /elements\.hotkeyHint/);
  assert.doesNotMatch(css, /default-setting|#defaultSpeed\.inactive|\.header/);
  assert.match(css, /\.default-readout\s*\{[^}]*cursor: default/);
  assert.match(css, /\.presets\s*\{[^}]*gap: 0/);
  assert.match(finish, /\.default-readout\s*\{[^}]*background: transparent; box-shadow: none/);
  assert.doesNotMatch(finish, /translateY\(|proposalSave|\.pi\//);
  assert.match(finish, /GB1 — Charcoal \/ Ice blue/);
  assert.match(finish, /Outlined Graphite/);
  assert.match(finish, /@media \(forced-colors: active\)[\s\S]*text-shadow: none !important/);
  // The production popup must never import local mock controllers or fictional browser APIs.
  assert.doesNotMatch(html, /browser-init|fixture|controller\.js|materials\.css|\.pi\//);
  for (const [, path] of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.doesNotThrow(() => readSource(path.startsWith("../") ? path.slice(3) : `popup/${path}`));
  }
});

test("GB1 production tokens match the selected study without importing its preview canvas or controllers", () => {
  const css = readSource("popup/popup.css"), finish = readSource("popup/tactile.css");
  const study = readSource("demo/themes.css").match(/:root\[data-theme="gb1"\] \{ color-scheme: dark;([\s\S]*?)\n\}/)[1];
  const tokens = text => new Map([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].replace(/\s+/g, "")]));
  const production = tokens(css + finish);
  for (const [name, value] of tokens(study)) assert.equal(production.get(name), value, name);
  assert.match(css, /html, body \{[^}]*background: transparent/);
  assert.match(css, /body \{ width: 360px; min-width: 360px; overflow: visible/);
  assert.match(css, /\.app \{[^}]*border-radius: 8px/);
  assert.match(css, /html \{[^}]*overflow-y: auto/);
  assert.doesNotMatch(css + finish, /392px|data-theme|themes\.css|theme\.js|clip-path|height: 100vh/);
  assert.match(finish, /\.safety-note \{ color: var\(--warning\); border-left-color: var\(--warning\)/);
  assert.match(finish, /\.audio-switch\[aria-checked="true"\]::after \{ background: var\(--accent\)/);
});


test("Voice Clarity is customer-facing wording only; dialogue identifiers and protocol remain stable", () => {
  const html = readSource("popup/popup.html");
  assert.match(html, /id="dialogueButton"[^>]*>[\s\S]*?<strong>Voice Clarity<\/strong>/);
  assert.match(html, /id="dialogueHeading">Voice Clarity<\/h2>/);
  assert.match(html, /id="dialogueEnabled"[^>]*aria-label="Voice Clarity"/);
  assert.match(html, /small delay added by Voice Clarity/);
  for (const name of ["popup/popup.html", "popup/audio.js", "content/audio-engine.js", "content/dialogue-processor.js", "content/vendor/rnnoise/PROVENANCE.md", "demo/index.html"]) {
    assert.doesNotMatch(readSource(name), /dialogue focus/i, name);
  }
  assert.match(readSource("popup/audio.js"), /change\("DIALOGUE_ENABLE"/);
  assert.match(readSource("popup/audio.js"), /change\("DIALOGUE_MIX"/);
  assert.match(readSource("shared/audio.js"), /dialogueEnabled/);
  assert.match(readSource("shared/audio.js"), /dialogueRun/);
});
