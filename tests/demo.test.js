const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readSource } = require("./harness");
const ROOT = path.resolve(__dirname, "..");
const python = process.platform === "win32" ? "python" : "python3";
const expected = [".nojekyll", "index.html", "build-info.json", "demo/index.html", "demo/gallery.css", "demo/gallery.js", "demo/theme.js", "demo/themes.css", "demo/palettes.json", "demo/preview.html",
  ...["popup.css", "tactile.css", "popup.js", "audio.js", "help.js", "speed.js", "shortcuts.js", "shared-audio.js", "fixture.js"].map(n => "demo/assets/" + n)];
function files(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name), prefix + entry.name + "/") : [prefix + entry.name]);
}
function build(output) {
  return execFileSync(python, ["tools/build_demo.py", "--output", output], { cwd: ROOT, windowsHide: true });
}

test("Pages export is deterministic, explicit and self-contained without extension engines or private files", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "playback-plus-demo-"));
  try {
    const a = path.join(temporary, "a"), b = path.join(temporary, "b");
    build(a); build(b);
    assert.deepEqual(files(a).sort(), [...expected].sort());
    let total = 0;
    for (const name of expected) {
      const first = fs.readFileSync(path.join(a, name));
      assert.deepEqual(first, fs.readFileSync(path.join(b, name)), name);
      assert.doesNotMatch(name, /AGENTS|\.pi|\.github|rnnoise|audio-engine|\.xpi|tests\//);
      total += first.length;
      if (name.endsWith(".html")) {
        for (const [, relative] of first.toString().matchAll(/(?:src|href)="([^"]+)"/g)) {
          if (/^https?:/.test(relative)) continue;
          const url = new URL(relative, "https://demo.invalid/" + name);
          const file = path.join(a, decodeURIComponent(url.pathname));
          assert.ok(fs.existsSync(file), `Missing demo dependency: ${name} -> ${relative}`);
        }
      }
    }
    assert.ok(total < 1024 * 1024, "The text-only demo should stay below 1 MB");
    const info = JSON.parse(fs.readFileSync(path.join(a, "build-info.json")));
    for (const [name, record] of Object.entries(info.files)) {
      const data = fs.readFileSync(path.join(a, name));
      assert.equal(data.length, record.bytes);
      assert.equal(createHash("sha256").update(data).digest("hex"), record.sha256);
    }
    assert.deepEqual(fs.readFileSync(path.join(a, "demo/assets/fixture.js")), fs.readFileSync(path.join(ROOT, "tests/browser-init.js")));
    const html = fs.readFileSync(path.join(a, "demo/preview.html"), "utf8");
    assert.ok(html.indexOf('src="assets/fixture.js"') >= 0);
    assert.ok(html.indexOf('src="assets/fixture.js"') < html.indexOf('src="assets/popup.js"'));
    assert.doesNotMatch(html, /\.\.\//);
    assert.match(html, /connect-src 'none'/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("Pages builder refuses unexpected output files rather than publishing or deleting them", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "playback-plus-demo-boundary-"));
  try {
    fs.writeFileSync(path.join(temporary, "private-note.txt"), "do not deploy");
    const result = spawnSync(python, ["tools/build_demo.py", "--output", temporary], { cwd: ROOT, windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString(), /unreviewed files/);
    assert.equal(fs.readFileSync(path.join(temporary, "private-note.txt"), "utf8"), "do not deploy");
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("public gallery names all palettes, discloses the simulation and uses checked cross-frame messages", () => {
  const palettes = Object.keys(JSON.parse(readSource("demo/palettes.json")));
  const html = readSource("demo/index.html"), gallery = readSource("demo/gallery.js"), theme = readSource("demo/theme.js");
  assert.deepEqual([...html.matchAll(/data-theme="([^"]+)"/g)].map(m => m[1]), palettes);
  assert.match(html, /Simulation only/);
  assert.match(html, /IP addresses for security/);
  assert.match(html, /settings reset when you reload/);
  for (const id of palettes) {
    assert.ok(theme.includes('"' + id + '"'));
    assert.ok(readSource("demo/themes.css").includes(`data-theme="${id}"`));
  }
  assert.doesNotMatch(gallery, /contentWindow\.document/);
  assert.match(gallery, /event\.source !== frame\.contentWindow/);
  assert.match(theme, /event\.source !== parent/);
  assert.match(gallery, /event\.origin !== targetOrigin/);
  assert.match(theme, /event\.origin !== targetOrigin/);
  for (const source of ["demo/gallery.js", "demo/theme.js"]) {
    execFileSync(process.execPath, ["--check", source], { cwd: ROOT, windowsHide: true });
  }
  const workflow = readSource(".github/workflows/pages.yml");
  assert.match(workflow, /path: _site/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|path: \.\s|enablement: true/);
  for (const [, action] of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(action, /@[a-f0-9]{40}\b/);
});
