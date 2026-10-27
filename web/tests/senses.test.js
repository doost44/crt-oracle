/* Tests for web/js/actions.js and the pure parts of web/js/voice.js. Plain node:
 *
 *     node web/tests/senses.test.js
 *
 * Builds fake face landmark results (the shape MediaPipe's FaceLandmarker returns)
 * and checks that each physical action is seen when it happens and not before.
 */
"use strict";
const assert = require("assert");
const path = require("path");

const A = require(path.join(__dirname, "..", "js", "actions.js"));
const V = require(path.join(__dirname, "..", "js", "voice.js"));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

/* A fake face. yaw: + turns to the visitor's left; pitch: + looks up; eyes: 0 open,
 * 1 shut; size: face width as a share of the frame; x/y: centre. With blend=false
 * there are no blendshapes, so the landmark fallbacks are used. */
function face(o) {
  o = Object.assign({ yaw: 0, pitch: 0, eyes: 0, mouth: 0, smile: 0, size: 0.3, x: 0.5, y: 0.5, blend: true }, o);
  const P = A.P;
  const w = o.size;
  const h = w * 1.3;
  const lm = Array.from({ length: 478 }, () => ({ x: o.x, y: o.y, z: 0 }));
  const at = (i, dx, dy) => (lm[i] = { x: o.x + dx * w, y: o.y + dy * h, z: 0 });
  at(P.cheekR, -0.5, 0);
  at(P.cheekL, 0.5, 0);
  at(P.forehead, 0, -0.5);
  at(P.chin, 0, 0.5);
  // nose: sideways with yaw, up with pitch
  at(P.nose, o.yaw * 0.3, 0.1 - o.pitch * 0.25);
  const eyeGap = 0.08 * (1 - o.eyes); // lid opening
  for (const [eye, side] of [[P.eyeR, -1], [P.eyeL, 1]]) {
    at(eye.outer, side * 0.32, -0.15);
    at(eye.inner, side * 0.1, -0.15);
    at(eye.top, side * 0.21, -0.15 - eyeGap / 2);
    at(eye.bottom, side * 0.21, -0.15 + eyeGap / 2);
  }
  // the pitch measure reads the top eyelids, so keep them where the eye line is
  at(P.lipTop, 0, 0.25);
  at(P.lipBottom, 0, 0.25 + o.mouth * 0.2);
  const result = { faceLandmarks: [lm] };
  if (o.blend) {
    const s = (categoryName, score) => ({ categoryName, score });
    result.faceBlendshapes = [
      {
        categories: [
          s("eyeBlinkLeft", o.eyes),
          s("eyeBlinkRight", o.eyes),
          s("jawOpen", o.mouth),
          s("mouthSmileLeft", o.smile),
          s("mouthSmileRight", o.smile),
          s("eyeLookOutLeft", 0),
          s("eyeLookInRight", 0),
          s("eyeLookInLeft", 0),
          s("eyeLookOutRight", 0),
        ],
      },
    ];
  }
  return result;
}

/* Play frames through a Check at 20 fps: `script(tMs)` gives the face options at
 * each moment (null for no face). Returns the final state. */
function play(id, script, ms, opts) {
  const check = new A.Check(id, Object.assign({ timeoutMs: 6000 }, opts));
  let state;
  for (let t = 0; t <= ms; t += 50) {
    const o = script(t);
    state = check.update(o ? A.measure(face(o)) : null, t);
    if (state.status === "done" || state.status === "timeout") return Object.assign({ at: t }, state);
  }
  return state;
}

const STILL = () => ({});
const after = (t0, change) => (t) => (t >= t0 ? change : {});

// --- measure -----------------------------------------------------------------------

test("no face gives null", () => {
  assert.strictEqual(A.measure(null), null);
  assert.strictEqual(A.measure({ faceLandmarks: [] }), null);
});

test("a face looking straight ahead", () => {
  const f = A.measure(face({}));
  assert(Math.abs(f.yaw) < 0.01, `yaw ${f.yaw}`);
  assert(f.eyes < 0.1);
  assert(Math.abs(f.size - 0.3) < 1e-9);
});

test("yaw follows the head turn, + is the visitor's left", () => {
  assert(A.measure(face({ yaw: 0.6 })).yaw > 0.3);
  assert(A.measure(face({ yaw: -0.6 })).yaw < -0.3);
});

test("eyes from blendshapes and from the landmark fallback agree", () => {
  for (const blend of [true, false]) {
    assert(A.measure(face({ eyes: 0, blend })).eyes < 0.2, `open, blend=${blend}`);
    assert(A.measure(face({ eyes: 1, blend })).eyes > 0.8, `shut, blend=${blend}`);
  }
});

// --- each action is seen when done ------------------------------------------------------

const DOING = {
  look_left: { yaw: 0.7 },
  look_right: { yaw: -0.7 },
  look_up: { pitch: 0.8 },
  look_down: { pitch: -0.8 },
  close_eyes: { eyes: 1 },
  come_closer: { size: 0.45 },
  step_back: { size: 0.2 },
  open_mouth: { mouth: 0.8 },
  smile: { smile: 0.8 },
};

for (const [id, doing] of Object.entries(DOING)) {
  test(`${id}: done when they do it`, () => {
    const s = play(id, after(1000, doing), 6000);
    assert.strictEqual(s.status, "done", JSON.stringify(s));
    assert(s.at >= 1000 + A.ACTIONS[id].holdMs - 50, `too early: ${s.at}`);
  });
  test(`${id}: not done when they don't`, () => {
    const s = play(id, STILL, 7000);
    assert.strictEqual(s.status, "timeout", JSON.stringify(s));
  });
  test(`${id}: works without blendshapes too`, () => {
    if (id === "smile") return; // smiling needs blendshapes
    const s = play(id, (t) => Object.assign({ blend: false }, t >= 1000 ? doing : {}), 6000);
    assert.strictEqual(s.status, "done", JSON.stringify(s));
  });
}

test("look_left is not done by looking right", () => {
  assert.strictEqual(play("look_left", after(1000, { yaw: -0.7 }), 7000).status, "timeout");
});

test("a glance is not enough: the pose has to be held", () => {
  // eyes shut for half a second, then open again: close_eyes wants two seconds
  const s = play("close_eyes", (t) => (t >= 1000 && t < 1500 ? { eyes: 1 } : {}), 7000);
  assert.strictEqual(s.status, "timeout");
});

test("the resting face is the baseline: already turned a bit doesn't count", () => {
  // someone standing a little to the side, head turned slightly left all along
  const s = play("look_left", () => ({ yaw: 0.2 }), 7000);
  assert.strictEqual(s.status, "timeout");
});

test("come_closer is relative to where they started", () => {
  const far = play("come_closer", () => ({ size: 0.15 }), 7000);
  assert.strictEqual(far.status, "timeout");
  const s = play("come_closer", (t) => ({ size: t >= 1000 ? 0.2 : 0.15 }), 7000);
  assert.strictEqual(s.status, "done");
});

test("hold_still: done when still, not while fidgeting", () => {
  assert.strictEqual(play("hold_still", STILL, 6000).status, "done");
  const fidget = (t) => ({ x: 0.5 + 0.06 * Math.sin(t / 120) });
  assert.strictEqual(play("hold_still", fidget, 7000).status, "timeout");
});

test("a short dropout doesn't break a hold, a long one does", () => {
  const blip = (t) => (t >= 1000 && t < 1150 ? null : t >= 600 ? { eyes: 1 } : {});
  assert.strictEqual(play("close_eyes", blip, 4000).status, "done");
  const gone = (t) => (t >= 1500 && t < 2600 ? null : t >= 600 ? { eyes: 1 } : {});
  const s = play("close_eyes", gone, 7000);
  assert(s.at === undefined || s.at > 4400, `held through a long dropout: ${JSON.stringify(s)}`);
});

test("no face at all times out with a hint", () => {
  const s = play("look_left", () => null, 7000);
  assert.strictEqual(s.status, "timeout");
  assert.strictEqual(s.hint, "no_face");
});

test("progress climbs during a hold", () => {
  const check = new A.Check("close_eyes", { baseline: A.measure(face({})) });
  const f = A.measure(face({ eyes: 1 }));
  check.update(f, 0);
  const mid = check.update(f, 1000);
  assert.strictEqual(mid.status, "holding");
  assert(mid.progress > 0.4 && mid.progress < 0.6, `progress ${mid.progress}`);
});

test("unknown actions are refused", () => {
  assert.throws(() => new A.Check("juggle"));
});

test("every action has a line in every voice", () => {
  for (const pid of [null, "sugar", "weary", "clinical"]) {
    for (const id of A.ids) {
      for (const kind of ["ask", "done", "timeout", "noFace"]) {
        const text = A.line(kind, id, pid, () => 0.5);
        assert(text && !text.includes("{"), `${pid}/${id}/${kind}: ${text}`);
      }
    }
  }
  assert(/close your eyes/.test(A.line("timeout", "close_eyes", "weary", () => 0)));
});

// --- voice: picking an option --------------------------------------------------------------

const SYMBOLS = ["A sun", "A rock", "A tree"];
const cases = [
  ["the sun", 0],
  ["sun", 0],
  ["Rock.", 1],
  ["um the rocks", 1],
  ["I'll go with the tree", 2],
  ["one", 0],
  ["number two", 1],
  ["the third one", 2],
  ["2", 1],
  ["I want to choose three", 2],
  ["I'd like to pick two", 1],
  ["", -1],
  ["banana", -1],
  ["sun or rock", -1],
];
for (const [said, want] of cases) {
  test(`matchChoice("${said}") is ${want}`, () => assert.strictEqual(V.matchChoice(said, SYMBOLS), want));
}

test("matchChoice ignores numbers past the last option", () => {
  assert.strictEqual(V.matchChoice("four", SYMBOLS), -1);
  assert.strictEqual(V.matchChoice("yes", ["Yes", "No"]), 0);
  assert.strictEqual(V.matchChoice("no", ["Yes", "No"]), 1);
});

// --- voice: what gets spoken -------------------------------------------------------------------

test("speakable turns SHOUTING into a sentence and drops placeholders", () => {
  assert.strictEqual(V.speakable("THAT WAS NOT AN OPTION. I WILL ASK AGAIN."), "That was not an option. I will ask again.");
  assert.strictEqual(V.speakable("[PLACEHOLDER Q1 sun] Something you're proud of?"), "Something you're proud of?");
  assert.strictEqual(V.speakable("Right. Of course it is. It always is..."), "Right. Of course it is. It always is,");
  assert.strictEqual(V.speakable(""), "");
});

// --- report ------------------------------------------------------------------------------------

if (failures.length) {
  console.error(`${failures.length} failed, ${passed} passed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`senses: ${passed} tests passed`);
