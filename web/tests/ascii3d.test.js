/* Tests for the ASCII half of web/js/ascii3d.js (no WebGL needed):
 *
 *     node web/tests/ascii3d.test.js
 */
"use strict";
const assert = require("assert");
const path = require("path");

const A = require(path.join(__dirname, "..", "js", "ascii3d.js"));
const RAMP = A.RAMP;

// The Bayer thresholds are the 16 evenly spaced values, each once.
assert.deepStrictEqual(
  [...A.BAYER4].sort((a, b) => a - b),
  Array.from({ length: 16 }, (_, i) => (i + 0.5) / 16)
);

// Black and white map to the ends of the ramp (after the blank), wherever the cell is.
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 4; x++) {
    assert.strictEqual(A.glyphLevel(0, x, y, RAMP.length), 1);
    assert.strictEqual(A.glyphLevel(1, x, y, RAMP.length), RAMP.length - 1);
  }
}

// Dithering: halfway between two levels, a 4x4 tile is half one glyph, half the next,
// and the average level over the tile follows the brightness.
{
  const steps = RAMP.length - 2;
  const b = (3 + 0.5) / steps;
  const counts = {};
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const l = A.glyphLevel(b, x, y, RAMP.length);
    counts[l] = (counts[l] || 0) + 1;
  }
  assert.deepStrictEqual(counts, { 4: 8, 5: 8 });

  for (let k = 0; k <= 20; k++) {
    const v = k / 20;
    let sum = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += A.glyphLevel(v, x, y, RAMP.length) - 1;
    assert.ok(Math.abs(sum / 16 - v * steps) <= 1 / 16 + 1e-9, `mean level off at ${v}`);
  }
}

// Coverage decides blank vs glyph; dark covered cells are the lightest glyph, not blank;
// "hole" cuts pure black paint out.
{
  const cols = 4, rows = 1;
  const bright = Float32Array.from([0.9, 0.0, 0.0, 0.5]);
  const cover = Float32Array.from([1, 1, 0.1, 1]);
  const f = A.cellsToFrame(cols, rows, bright, cover);
  assert.ok(f.level[0] >= RAMP.length - 2);
  assert.strictEqual(f.chars[1], RAMP[1]);
  assert.strictEqual(f.chars[2], " ");
  assert.strictEqual(f.level[2], 0);
  const holed = A.cellsToFrame(cols, rows, bright, cover, { hole: 0.01 });
  assert.strictEqual(holed.chars[1], " ");
  assert.strictEqual(holed.chars[3], f.chars[3]);
  assert.strictEqual(A.frameToText(f).length, cols);
}

// frameToText: one line per row.
{
  const f = A.cellsToFrame(3, 2, new Float32Array(6).fill(1), new Float32Array(6).fill(1));
  assert.strictEqual(A.frameToText(f), "@@@\n@@@");
}

// fitCamera: the sphere fits inside both the vertical and the horizontal view.
{
  const cam = { fov: 30, position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, lookAt() {}, updateProjectionMatrix() {} };
  for (const [cols, rows] of [[160, 60], [40, 60]]) {
    A.fitCamera(cam, cols, rows, 0.6, { x: 0, y: 0, z: 0 }, 1, 1);
    const halfV = (15 * Math.PI) / 180;
    const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
    const dist = cam.position.z;
    assert.ok(Math.asin(1 / dist) <= Math.min(halfV, halfH) + 1e-9);
    assert.ok(Math.abs(Math.asin(1 / dist) - Math.min(halfV, halfH)) < 1e-9, "fits snugly");
  }
}

console.log("ascii3d tests passed");
