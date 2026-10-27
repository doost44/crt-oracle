/* Tests for the camera picker (web/js/camera.js) and the face reading
 * (web/js/face-reading.js). Plain node, no browser:
 *
 *     node web/tests/presence.test.js
 */
"use strict";
const assert = require("assert");
const path = require("path");

global.window = { localStorage: { getItem: () => null, setItem: () => {} } };
require(path.join(__dirname, "..", "js", "camera.js"));
const camera = global.window.Oracle.camera;
const R = require(path.join(__dirname, "..", "js", "face-reading.js"));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

const cam = (label, id) => ({ kind: "videoinput", label, deviceId: id || label });
const mic = (label) => ({ kind: "audioinput", label, deviceId: label });

// --- camera.pick ------------------------------------------------------------

test("skips NVIDIA Broadcast even when it is listed first", () => {
  const devices = [cam("Camera (NVIDIA Broadcast)"), mic("Microphone (Realtek)"), cam("Integrated Webcam (0bda:5520)")];
  assert.strictEqual(camera.pick(devices, "").label, "Integrated Webcam (0bda:5520)");
});

test("skips other virtual cameras", () => {
  const devices = [cam("OBS Virtual Camera"), cam("Snap Camera"), cam("XSplit VCam"), cam("USB Video")];
  assert.strictEqual(camera.pick(devices, "").label, "USB Video");
});

test("a wanted name wins, matched loosely", () => {
  const devices = [cam("Integrated Webcam"), cam("USB2.0 PC CAMERA"), cam("USB Video")];
  assert.strictEqual(camera.pick(devices, "usb video").label, "USB Video");
});

test("a wanted name can even pick a virtual camera on purpose", () => {
  const devices = [cam("Integrated Webcam"), cam("Camera (NVIDIA Broadcast)")];
  assert.strictEqual(camera.pick(devices, "nvidia").label, "Camera (NVIDIA Broadcast)");
});

test("an unknown wanted name falls back to the first real camera", () => {
  const devices = [cam("Camera (NVIDIA Broadcast)"), cam("Integrated Webcam")];
  assert.strictEqual(camera.pick(devices, "capture card").label, "Integrated Webcam");
});

test("only virtual cameras: no pick", () => {
  assert.strictEqual(camera.pick([cam("Camera (NVIDIA Broadcast)"), mic("Mic")], ""), null);
});

test("?camera=off turns the camera off; ?camera=name asks for it", () => {
  assert.deepStrictEqual(camera.preference("?camera=off"), { off: true, wanted: "" });
  assert.deepStrictEqual(camera.preference("?camera=USB%20Video"), { off: false, wanted: "USB Video" });
  assert.deepStrictEqual(camera.preference(""), { off: false, wanted: "" });
});

test("next() cycles through the cameras", () => {
  const cams = [cam("A"), cam("B"), cam("C")];
  assert.strictEqual(camera.next(cams, "A").label, "B");
  assert.strictEqual(camera.next(cams, "C").label, "A");
  assert.strictEqual(camera.next(cams, "gone").label, "A");
});

// --- face reading -------------------------------------------------------------

/* A flat, front-on face in the middle of the picture. */
function face(changes) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i, x, y) => (lm[i] = { x, y, z: 0 });
  set(R.POINTS.forehead, 0.5, 0.3);
  set(R.POINTS.chin, 0.5, 0.7);
  set(R.POINTS.cheekR, 0.4, 0.5);
  set(R.POINTS.cheekL, 0.6, 0.5);
  set(R.POINTS.irisR, 0.45, 0.45);
  set(R.POINTS.irisL, 0.55, 0.45);
  set(R.POINTS.nose, 0.5, 0.45 + 0.25 * 0.35);
  if (changes) changes(set);
  return lm;
}
const shapes = (scores) => Object.entries(scores).map(([categoryName, score]) => ({ categoryName, score }));

test("no landmarks: no face", () => {
  assert.strictEqual(R.describe(null), null);
  assert.strictEqual(R.describe([]), null);
});

test("front-on face: centred, no turn, no nod, no roll", () => {
  const f = R.describe(face(), [], 4 / 3, 0);
  assert.ok(Math.abs(f.turn) < 0.01, `turn ${f.turn}`);
  assert.ok(Math.abs(f.nod) < 0.01, `nod ${f.nod}`);
  assert.ok(Math.abs(f.roll) < 0.01, `roll ${f.roll}`);
  assert.ok(Math.abs(f.center.x - 0.5) < 0.01 && Math.abs(f.center.y - 0.5) < 0.01);
  assert.ok(Math.abs(f.size - 0.2) < 1e-6, `size ${f.size}`);
  assert.strictEqual(f.pts.length, 478 * 2);
  assert.ok(f.head.w > f.box.w && f.head.h > f.box.h, "the head box is bigger than the face box");
  assert.strictEqual(R.mood(f), "neutral");
});

test("turning to their own right moves the nose to the image left: positive turn", () => {
  const f = R.describe(face((set) => set(R.POINTS.nose, 0.46, 0.5375)), [], 4 / 3, 0);
  assert.ok(f.turn > 0.3, `turn ${f.turn}`);
  const g = R.describe(face((set) => set(R.POINTS.nose, 0.54, 0.5375)), [], 4 / 3, 0);
  assert.ok(g.turn < -0.3, `turn ${g.turn}`);
  assert.strictEqual(R.mood(f), "away");
});

test("looking down: positive nod", () => {
  const f = R.describe(face((set) => set(R.POINTS.nose, 0.5, 0.62)), [], 4 / 3, 0);
  assert.ok(f.nod > 0.5, `nod ${f.nod}`);
});

test("eyes shut needs both eyes", () => {
  const both = R.describe(face(), shapes({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.7 }), 4 / 3, 0);
  const wink = R.describe(face(), shapes({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.1 }), 4 / 3, 0);
  assert.strictEqual(both.eyesClosed, true);
  assert.strictEqual(wink.eyesClosed, false);
  assert.strictEqual(R.mood(both), "eyes_closed");
});

test("moods follow the expression", () => {
  const mood = (s) => R.mood(R.describe(face(), shapes(s), 4 / 3, 0));
  assert.strictEqual(mood({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }), "smile");
  assert.strictEqual(mood({ jawOpen: 0.6 }), "speaking");
  assert.strictEqual(mood({ browDownLeft: 0.6, browDownRight: 0.6 }), "frown");
  assert.strictEqual(mood({ browInnerUp: 0.8 }), "surprise");
  assert.strictEqual(R.mood(null), "absent");
});

test("distance moods from the face's size", () => {
  const big = R.describe(face((set) => { set(R.POINTS.cheekR, 0.2, 0.5); set(R.POINTS.cheekL, 0.8, 0.5); }), [], 4 / 3, 0);
  assert.strictEqual(R.mood(big), "close");
});

test("every mood has labels, and label() picks from them", () => {
  for (const m of ["absent", "neutral", "smile", "frown", "surprise", "speaking", "eyes_closed", "away", "close", "far"]) {
    assert.ok(R.LABELS[m] && R.LABELS[m].length, `no labels for ${m}`);
    assert.ok(R.LABELS[m].includes(R.label(m, () => 0.999)));
  }
});

test("gauges stay between 0 and 1", () => {
  const f = R.describe(face(), shapes({ mouthSmileLeft: 1, mouthSmileRight: 1, jawOpen: 1, browDownLeft: 1, browDownRight: 1 }), 4 / 3, 0);
  for (const [k, v] of Object.entries(R.gauges(f))) assert.ok(v >= 0 && v <= 1, `${k} ${v}`);
  assert.deepStrictEqual(R.gauges(null), { affect: 0, tension: 0, attention: 0, vocal: 0 });
});

test("the mesh and dot points are real landmark indices", () => {
  for (const i of R.KEY_POINTS.concat(R.MESH_POINTS)) assert.ok(Number.isInteger(i) && i >= 0 && i < 468, `bad index ${i}`);
});

if (failures.length) {
  console.error(`FAIL: ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`PASS: ${passed} tests`);
