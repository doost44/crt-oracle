/* Physical actions: the Oracle tells the visitor to do something (look left,
 * close your eyes, come closer, hold still) and checks with face landmarks
 * whether they did it.
 *
 * Pure logic, no DOM and no camera. It reads face landmark results in the shape
 * MediaPipe's FaceLandmarker gives them, so any tracker that produces that shape
 * can feed it (web/js/facetrack.js does, and so can the always-on webcam).
 * Works in the browser (window.Oracle.Actions) and in node (module.exports).
 *
 *   const f = Actions.measure(result);            // one frame -> a few numbers, or null
 *   const check = new Actions.Check("look_left");  // the action to watch for
 *   check.update(f, nowMs) -> { status, progress, hint }
 *     status: "settling" | "waiting" | "holding" | "done" | "timeout"
 *
 * Nothing here keeps a frame: only the last few numbers per check.
 */
(function (root) {
  "use strict";

  // MediaPipe face mesh indices (478-point model). "Left" and "right" are the
  // visitor's own, so in an unmirrored camera image their left is on the right.
  const P = {
    nose: 1,
    chin: 152,
    forehead: 10,
    cheekR: 234, // visitor's right cheek edge
    cheekL: 454, // visitor's left cheek edge
    eyeR: { outer: 33, inner: 133, top: 159, bottom: 145 },
    eyeL: { outer: 263, inner: 362, top: 386, bottom: 374 },
    lipTop: 13,
    lipBottom: 14,
  };

  const SETTLE_MS = 500; // frames before the request counts, to learn the visitor's resting face
  const GRACE_MS = 250; // a hold survives a dropout this short

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const mean = (list) => list.reduce((s, v) => s + v, 0) / (list.length || 1);

  function blend(categories, name) {
    if (!categories) return null;
    for (const c of categories) if (c.categoryName === name) return c.score;
    return null;
  }

  function eyeOpenness(lm, eye) {
    const w = dist(lm[eye.outer], lm[eye.inner]);
    return w > 0 ? dist(lm[eye.top], lm[eye.bottom]) / w : 0;
  }

  /* One FaceLandmarker result -> the numbers the checks need, or null when there
   * is no face. Only the first (largest) face is used.
   *   yaw        head turn: + is the visitor's left, about -1..1
   *   pitch      head tilt: + is up (relative, compare with a baseline)
   *   eyes       0 open .. 1 closed
   *   mouth      0 shut .. 1 wide open
   *   smile      0 .. 1
   *   size       face width as a share of the frame width (closer = bigger)
   *   x, y       face centre in the frame, 0..1 (unmirrored)
   *   gaze       eye direction: + is the visitor's left, about -1..1 (needs blendshapes)
   */
  function measure(result) {
    const lm = result && result.faceLandmarks && result.faceLandmarks[0];
    if (!lm || lm.length < 468) return null;
    const bs = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;

    const left = lm[P.cheekR]; // smaller x in the image
    const right = lm[P.cheekL];
    const width = right.x - left.x;
    const faceW = dist(left, right);
    if (!(faceW > 0)) return null;

    // Yaw: where the nose sits between the two cheek edges. Facing the camera it
    // is in the middle; turning left moves it towards the visitor's left cheek.
    const nose = lm[P.nose];
    const yaw = width > 0 ? ((nose.x - left.x) / width - 0.5) * 2 : 0;

    // Pitch: the nose between the eyes and the chin. Looking up shortens the top part.
    const eyeMidY = (lm[P.eyeR.top].y + lm[P.eyeL.top].y) / 2;
    const span = lm[P.chin].y - eyeMidY;
    const pitch = span > 0 ? 0.5 - (nose.y - eyeMidY) / span : 0;

    let eyes;
    const blinkL = blend(bs, "eyeBlinkLeft");
    const blinkR = blend(bs, "eyeBlinkRight");
    if (blinkL != null && blinkR != null) {
      eyes = Math.min(blinkL, blinkR); // both eyes, so a wink doesn't count
    } else {
      // Eye aspect ratio: about 0.28 open, under 0.1 shut.
      const open = Math.max(eyeOpenness(lm, P.eyeR), eyeOpenness(lm, P.eyeL));
      eyes = clamp01((0.24 - open) / 0.16);
    }

    let mouth = blend(bs, "jawOpen");
    if (mouth == null) mouth = clamp01((dist(lm[P.lipTop], lm[P.lipBottom]) / faceW - 0.02) / 0.25);

    const smileL = blend(bs, "mouthSmileLeft");
    const smileR = blend(bs, "mouthSmileRight");
    const smile = smileL != null && smileR != null ? (smileL + smileR) / 2 : 0;

    let gaze = 0;
    const outL = blend(bs, "eyeLookOutLeft");
    if (outL != null) {
      // Looking to their left: the left eye looks out, the right eye looks in.
      gaze = (outL + blend(bs, "eyeLookInRight") - blend(bs, "eyeLookInLeft") - blend(bs, "eyeLookOutRight")) / 2;
    }

    return {
      yaw,
      pitch,
      eyes,
      mouth,
      smile,
      gaze,
      size: Math.abs(width),
      x: (left.x + right.x) / 2,
      y: (lm[P.forehead].y + lm[P.chin].y) / 2,
    };
  }

  // --- the actions ----------------------------------------------------------------
  //
  // score(f, base, motion) -> 0..1, where 1 means "done". `base` is the visitor's
  // resting face, averaged over the settle time. holdMs is how long the score has to
  // stay at 1. Thresholds are deliberately forgiving: it's a show, not an exam.

  const ACTIONS = {
    look_left: {
      label: "look left",
      score: (f, b) => clamp01((f.yaw - b.yaw + Math.max(0, f.gaze) * 0.3) / 0.35),
      holdMs: 400,
    },
    look_right: {
      label: "look right",
      score: (f, b) => clamp01((b.yaw - f.yaw - Math.min(0, f.gaze) * 0.3) / 0.35),
      holdMs: 400,
    },
    look_up: {
      label: "look up",
      score: (f, b) => clamp01((f.pitch - b.pitch) / 0.12),
      holdMs: 400,
    },
    look_down: {
      label: "look down",
      score: (f, b) => clamp01((b.pitch - f.pitch) / 0.12),
      holdMs: 400,
    },
    close_eyes: {
      label: "close your eyes",
      score: (f) => clamp01((f.eyes - 0.2) / 0.35),
      holdMs: 2000,
    },
    come_closer: {
      label: "come closer",
      score: (f, b) => clamp01((f.size / b.size - 1) / 0.25),
      holdMs: 500,
    },
    step_back: {
      label: "step back",
      score: (f, b) => clamp01((1 - f.size / b.size) / 0.2),
      holdMs: 500,
    },
    hold_still: {
      label: "hold still",
      // motion: how far the face has moved over the last half second, in face widths
      score: (f, b, motion) => clamp01((0.06 - motion) / 0.03),
      holdMs: 3000,
    },
    open_mouth: {
      label: "open your mouth",
      score: (f) => clamp01((f.mouth - 0.15) / 0.3),
      holdMs: 600,
    },
    smile: {
      label: "smile",
      score: (f) => clamp01((f.smile - 0.15) / 0.35),
      holdMs: 800,
    },
  };

  const DEFAULT_TIMEOUT_MS = 12000;

  /* Watches one action. Feed it every frame's measure() result (null when no face). */
  class Check {
    constructor(id, opts) {
      opts = opts || {};
      const spec = ACTIONS[id];
      if (!spec) throw new Error(`unknown action: ${id}`);
      this.id = id;
      this.spec = spec;
      this.holdMs = opts.holdMs != null ? opts.holdMs : spec.holdMs;
      this.timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
      this.settleMs = opts.settleMs != null ? opts.settleMs : SETTLE_MS;
      this.base = opts.baseline || null; // skip settling if the caller already knows the resting face
      this.start = null;
      this.settled = [];
      this.trail = []; // [t, x, y, size] over the last half second, for hold_still
      this.holdStart = null;
      this.lastGood = null;
      this.lastFace = null;
      this.result = null;
    }

    update(f, now) {
      if (this.result) return this.result;
      if (this.start == null) this.start = now;
      const elapsed = now - this.start;

      if (f) {
        this.lastFace = now;
        this.trail.push([now, f.x, f.y, f.size]);
        while (this.trail.length > 2 && now - this.trail[0][0] > 500) this.trail.shift();
      }

      if (!this.base) {
        if (f) this.settled.push(f);
        if (elapsed < this.settleMs || !this.settled.length) {
          if (elapsed > this.timeoutMs) return this._end("timeout", 0, "no_face");
          return { status: "settling", progress: 0, hint: f ? null : "no_face" };
        }
        this.base = baseline(this.settled);
        this.settled = null;
        this.start = now; // the timeout runs from when the request starts counting
      }

      if (now - this.start > this.timeoutMs) return this._end("timeout", this._progress(now), f ? null : "no_face");

      if (!f) {
        if (this.holdStart != null && now - this.lastGood > GRACE_MS) this.holdStart = null;
        return { status: "waiting", progress: this._progress(now), hint: "no_face" };
      }

      const score = this.spec.score(f, this.base, this._motion());
      if (score >= 1) {
        if (this.holdStart == null) this.holdStart = now;
        this.lastGood = now;
        if (now - this.holdStart >= this.holdMs) return this._end("done", 1, null);
        return { status: "holding", progress: this._progress(now), hint: null, score };
      }
      if (this.holdStart != null && now - this.lastGood > GRACE_MS) this.holdStart = null;
      return { status: this.holdStart != null ? "holding" : "waiting", progress: this._progress(now), hint: null, score };
    }

    _motion() {
      if (this.trail.length < 2) return 0;
      const size = mean(this.trail.map((p) => p[3])) || 1;
      let far = 0;
      const [, x0, y0] = this.trail[0];
      for (const [, x, y] of this.trail) far = Math.max(far, Math.hypot(x - x0, y - y0));
      return far / size;
    }

    /* 0..1: how much of the hold is done. */
    _progress(now) {
      if (this.holdStart == null || !this.holdMs) return 0;
      return clamp01((now - this.holdStart) / this.holdMs);
    }

    _end(status, progress, hint) {
      this.result = { status, progress, hint };
      return this.result;
    }
  }

  function baseline(frames) {
    const keys = ["yaw", "pitch", "eyes", "mouth", "smile", "gaze", "size", "x", "y"];
    const out = {};
    for (const k of keys) out[k] = mean(frames.map((f) => f[k]));
    // A face caught mid-turn or mid-blink shouldn't make the next request too easy.
    out.yaw = Math.max(-0.25, Math.min(0.25, out.yaw));
    return out;
  }

  // --- what the Oracle says ------------------------------------------------------------
  //
  // Placeholder lines in each personality's voice, until the conversation rework
  // decides when and how the Oracle asks. {action} is the action's label.

  const LINES = {
    default: {
      ask: {
        look_left: ["LOOK TO YOUR LEFT."],
        look_right: ["LOOK TO YOUR RIGHT."],
        look_up: ["LOOK UP."],
        look_down: ["LOOK DOWN."],
        close_eyes: ["CLOSE YOUR EYES. KEEP THEM CLOSED."],
        come_closer: ["COME CLOSER."],
        step_back: ["STEP BACK."],
        hold_still: ["HOLD STILL."],
        open_mouth: ["OPEN YOUR MOUTH."],
        smile: ["SMILE."],
      },
      done: ["GOOD."],
      timeout: ["YOU DID NOT {action}. I NOTICED."],
      noFace: ["WHERE DID YOU GO?"],
    },
    sugar: {
      ask: {
        look_left: ["Ooh, look to your left for me, sweetie. Just a peek."],
        look_right: ["Now your right! Show me your good side. If you have one."],
        look_up: ["Look up for me, darling. Up! Like you're hoping for something."],
        look_down: ["Look down, sweetheart. Down at your shoes. That's where you feel at home."],
        close_eyes: ["Close your eyes for me. I promise I won't do anything. Probably."],
        come_closer: ["Come closer, sweetie. Closer. I don't bite. Much."],
        step_back: ["Oh! Step back a little, darling. That's a lot of face."],
        hold_still: ["Hold very, very still for me. Like a little statue. A cheap one."],
        open_mouth: ["Open wide! Like at the dentist. You remember the dentist."],
        smile: ["Give me a smile! A real one. Or your best try."],
      },
      done: ["Perfect! You can follow instructions. I'll put that on your fridge.", "Wonderful! Gold star. A small one."],
      timeout: ["That's okay! Not everyone can {action}. I'll remember that about you."],
      noFace: ["Hello? Did you leave? Everyone leaves eventually, sweetie."],
    },
    weary: {
      ask: {
        look_left: ["Look left. Or don't. Left, though, ideally."],
        look_right: ["Right. Look right. That's... yes. Right."],
        look_up: ["Look up. There's nothing up there. Look anyway."],
        look_down: ["Look down. Go on. I do it all day."],
        close_eyes: ["Close your eyes. Let's both pretend you're somewhere else."],
        come_closer: ["Come closer. I can't be bothered to zoom."],
        step_back: ["Step back. You're... a lot. Back. Thanks."],
        hold_still: ["Hold still. Just... stop. For once. Everyone fidgets."],
        open_mouth: ["Open your mouth. Don't say anything. Just open it."],
        smile: ["Smile. Or the thing people do instead."],
      },
      done: ["Mm. Yes. You did it. Lots of people do it.", "Fine. That'll do. Everything does, eventually."],
      timeout: ["You didn't {action}. That's fine. Nobody does anything."],
      noFace: ["Gone? Good. No, wait. Come back. I have to finish this."],
    },
    clinical: {
      ask: {
        look_left: ["Subject will rotate the head to the left. Now."],
        look_right: ["Subject will rotate the head to the right."],
        look_up: ["Subject will raise the gaze. Elevation is being measured."],
        look_down: ["Subject will lower the gaze. Compliance is being measured."],
        close_eyes: ["Subject will close both eyes until instructed otherwise."],
        come_closer: ["Subject will approach the apparatus. Further. Further."],
        step_back: ["Subject is too close to the apparatus. Step back."],
        hold_still: ["Subject will remain motionless. Movement is being logged."],
        open_mouth: ["Subject will open the mouth. Dental record not required. Yet."],
        smile: ["Subject will produce a smile. Sincerity is not required."],
      },
      done: ["Compliance confirmed. Response time: below average.", "Movement recorded. Filed under: predictable."],
      timeout: ["Subject failed to {action}. Non-compliance noted on file."],
      noFace: ["Subject has left the frame. Return to the marked position."],
    },
  };

  /* A line for `kind` ("ask", "done", "timeout", "noFace") in the personality's voice. */
  function line(kind, actionId, personality, random) {
    random = random || Math.random;
    const set = LINES[personality] || LINES.default;
    let options = kind === "ask" ? set.ask[actionId] || LINES.default.ask[actionId] : set[kind];
    if (!options || !options.length) options = LINES.default[kind] || [""];
    const label = ACTIONS[actionId] ? ACTIONS[actionId].label : actionId;
    const text = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
    return text.replace(/\{action\}/g, set === LINES.default ? label.toUpperCase() : label);
  }

  const Actions = { measure, Check, ACTIONS, LINES, line, ids: Object.keys(ACTIONS), baseline, P };

  if (typeof module === "object" && module.exports) module.exports = Actions;
  if (root) {
    const Oracle = (root.Oracle = root.Oracle || {});
    Oracle.Actions = Actions;
  }
})(typeof window !== "undefined" ? window : null);
