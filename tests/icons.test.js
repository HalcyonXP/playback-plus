const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { readSource } = require("./harness");

test("all manifest icon sizes match the approved GB1 play-plus artwork", () => {
  const hashes = {
    16: "a66e57d4c79eb372cc1411c2869436470c2c47059b598691e25f3ab360e64e11",
    32: "e506f27128048eb44dc5f8319553f839cacd0cd15adf16902b4e7b7cddbacb5c",
    48: "921bceba3e8945f51dddb9f8234d839a83d4f3632ff83335ef6e095ba0b70ba8",
    96: "1204b0fa550562bc96c8485396ba9f75236e13f5e1e8ef44b4721fecf105552a"
  };
  const manifest = JSON.parse(readSource("manifest.json"));
  for (const [size, hash] of Object.entries(hashes)) {
    const name = `icons/icon-${size}.png`;
    const data = fs.readFileSync(path.join(__dirname, "..", name));
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(data.readUInt32BE(16), Number(size));
    assert.equal(data.readUInt32BE(20), Number(size));
    assert.equal(data[25], 6, "PNG uses RGBA");
    assert.equal(createHash("sha256").update(data).digest("hex"), hash);
    assert.equal(manifest.icons[size], name);
    assert.equal(manifest.action.default_icon[size], name);
  }
  const svg = readSource("icons/icon.svg");
  for (const colour of ["#30343b", "#20242b", "#9bcaff", "#58616e", "#0d1017"]) assert.ok(svg.includes(colour));
  assert.equal([...svg.matchAll(/<path\b/g)].length, 2);
  assert.match(svg, /M29 34L29 94L73 64Z/);
  assert.match(svg, /M80 60L90 60L90 50L98 50/);
  assert.doesNotMatch(svg, /filter|glow|ff8a3d|ff7938/);
  assert.match(readSource("tools/generate_icons.py"), /for shape in SHAPES/);
});
