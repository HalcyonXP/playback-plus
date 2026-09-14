const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const python = process.platform === "win32" ? "python" : "python3";

test("package retains MIT and third-party notices, excludes private files and is repeatable", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "playback-plus-package-"));
  try {
    const entries = ["LICENSE", "manifest.json", "background", "content", "icons", "popup", "shared"];
    for (const entry of entries) fs.cpSync(path.join(ROOT, entry), path.join(temporary, entry), { recursive: true });
    fs.mkdirSync(path.join(temporary, "tools"));
    fs.copyFileSync(path.join(ROOT, "tools/package_extension.py"), path.join(temporary, "tools/package_extension.py"));
    fs.writeFileSync(path.join(temporary, "AGENTS.md"), "private: never package");
    fs.writeFileSync(path.join(temporary, ".env"), "private: never package");
    const manifest = JSON.parse(fs.readFileSync(path.join(temporary, "manifest.json")));
    const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json")));
    assert.equal(metadata.version, manifest.version);
    assert.equal(metadata.license, "MIT");
    const license = fs.readFileSync(path.join(temporary, "LICENSE"), "utf8");
    assert.match(license, /MIT License[\s\S]*Copyright \(c\) 2026 HalcyonXP/);
    assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
    const run = () => execFileSync(python, ["tools/package_extension.py"], { cwd: temporary, windowsHide: true });
    run();
    const archive = path.join(temporary, "dist", `playback-plus-${manifest.version}.xpi`);
    const first = fs.readFileSync(archive);
    run();
    assert.deepEqual(fs.readFileSync(archive), first);
    execFileSync(python, ["-c", `
from pathlib import Path
from zipfile import ZipFile
import sys
root = Path.cwd()
with ZipFile(sys.argv[1]) as archive:
    expected = {"LICENSE", "manifest.json"}
    for directory in ("background", "content", "icons", "popup", "shared"):
        expected.update(p.relative_to(root).as_posix() for p in (root / directory).rglob("*") if p.is_file())
    assert set(archive.namelist()) == expected
    for name in expected:
        assert archive.read(name) == (root / name).read_bytes(), name
    for notice in ("LICENSE", "content/vendor/rnnoise/LICENSE", "content/vendor/rnnoise/RNNOISE-COPYING"):
        assert notice in expected
`, archive], { cwd: temporary, windowsHide: true });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
