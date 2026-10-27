/* Turns the tracker's raw output into things the Oracle can use: where the face
 * is, where it points, whether the eyes are shut, and a mood for the readout.
 *
 * Pure functions, no browser needed (node web/tests/presence.test.js tests them).
 * Nothing here identifies anyone: it measures one frame at a time and forgets it.
 *
 * Coordinates are 0..1 across the camera picture, not mirrored: x grows to the
 * camera's right, which is the participant's left.
 */
(function (root) {
  "use strict";

  // MediaPipe face mesh landmark indices.
  const P = {
    forehead: 10,
    chin: 152,
    nose: 1,
    cheekR: 234, // participant's right cheek (image left)
    cheekL: 454,
    eyeROuter: 33,
    eyeRInner: 133,
    eyeLInner: 362,
    eyeLOuter: 263,
    irisR: 468,
    irisL: 473,
  };

  // A sparse set of points for the "final feature positions" dots and the mesh:
  // brows, eyes, nose, mouth, jaw (like the landmark pipeline reference).
  const KEY_POINTS = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
    150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, // jaw and forehead outline
    70, 105, 107, 336, 334, 300, // brows
    33, 133, 159, 145, 362, 263, 386, 374, // eyes
    168, 6, 1, 98, 327, // nose
    61, 291, 0, 17, 13, 14, // mouth
  ];
  // Fewer points for the coarse triangulated mesh.
  const MESH_POINTS = [10, 338, 284, 389, 454, 361, 397, 377, 152, 148, 172, 132, 234, 162, 54, 109, 70, 107, 336, 300, 33, 133, 362, 263, 168, 1, 98, 327, 61, 291, 0, 17];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function blend(shapes, name) {
    if (!shapes) return 0;
    for (const c of shapes) if (c.categoryName === name) return c.score;
    return 0;
  }

  /* landmarks: [{x, y, z}] from FaceLandmarker; shapes: its blendshape categories;
   * aspect: picture width / height. Returns null when there is no usable face. */
  function describe(landmarks, shapes, aspect, now) {
    if (!landmarks || landmarks.length < 468) return null;
    aspect = aspect || 4 / 3;
    const n = landmarks.length;
    const pts = new Float32Array(n * 2);
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < n; i++) {
      const p = landmarks[i];
      pts[i * 2] = p.x;
      pts[i * 2 + 1] = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const at = (i) => landmarks[i];
    const mid = (a, b) => ({ x: (at(a).x + at(b).x) / 2, y: (at(a).y + at(b).y) / 2 });
    const eyeR = n > P.irisR ? { x: at(P.irisR).x, y: at(P.irisR).y } : mid(P.eyeROuter, P.eyeRInner);
    const eyeL = n > P.irisL ? { x: at(P.irisL).x, y: at(P.irisL).y } : mid(P.eyeLInner, P.eyeLOuter);

    const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    // The head is bigger than the face mesh: hair above, a little either side.
    const head = { x: box.x - box.w * 0.25, y: box.y - box.h * 0.32, w: box.w * 1.5, h: box.h * 1.42 };

    // Turn: how far the nose sits from the middle of the cheeks. Positive = the
    // participant turned to their own right (the nose moves to the image left).
    const nose = at(P.nose);
    const cheeks = mid(P.cheekR, P.cheekL);
    const halfW = Math.max(1e-6, Math.abs(at(P.cheekL).x - at(P.cheekR).x) / 2);
    const turn = clamp((-(nose.x - cheeks.x) / halfW) * 1.6, -1, 1);
    // Nod: where the nose sits between the eyes and the chin. Positive = looking down.
    const eyesY = (eyeR.y + eyeL.y) / 2;
    const chin = at(P.chin);
    const ratio = (nose.y - eyesY) / Math.max(1e-6, chin.y - eyesY);
    const nod = clamp((ratio - 0.35) * 4, -1, 1); // 0.35: looking straight ahead
    // Roll in degrees: positive = the head tipped clockwise in the camera picture.
    const roll = (Math.atan2((eyeL.y - eyeR.y), (eyeL.x - eyeR.x) * aspect) * 180) / Math.PI;

    const blinkR = blend(shapes, "eyeBlinkRight");
    const blinkL = blend(shapes, "eyeBlinkLeft");
    const scores = {
      blink: (blinkR + blinkL) / 2,
      jaw: blend(shapes, "jawOpen"),
      smile: (blend(shapes, "mouthSmileLeft") + blend(shapes, "mouthSmileRight")) / 2,
      frown: (blend(shapes, "browDownLeft") + blend(shapes, "browDownRight")) / 2,
      surprise: Math.max(blend(shapes, "browInnerUp"), (blend(shapes, "eyeWideLeft") + blend(shapes, "eyeWideRight")) / 2),
      squint: (blend(shapes, "eyeSquintLeft") + blend(shapes, "eyeSquintRight")) / 2,
    };

    return {
      t: now || 0,
      pts,
      box,
      head,
      eyes: { right: eyeR, left: eyeL },
      center: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
      size: box.w, // share of the picture's width; bigger = closer
      turn,
      nod,
      roll,
      eyesClosed: blinkR > 0.5 && blinkL > 0.5,
      scores,
    };
  }

  /* One word for what the face is doing right now. */
  function mood(f) {
    if (!f) return "absent";
    const s = f.scores;
    if (f.eyesClosed) return "eyes_closed";
    if (Math.abs(f.turn) > 0.5 || Math.abs(f.nod) > 0.6) return "away";
    if (s.jaw > 0.35) return "speaking";
    if (s.smile > 0.45) return "smile";
    if (s.surprise > 0.5) return "surprise";
    if (s.frown > 0.35 || s.squint > 0.6) return "frown";
    if (f.size > 0.42) return "close";
    if (f.size < 0.14) return "far";
    return "neutral";
  }

  // Made-up analysis labels, by mood. Theatre only: none of it is a real judgement.
  const LABELS = {
    absent: ["NO SUBJECT", "SEARCHING", "ROOM EMPTY", "AWAITING SUBJECT"],
    neutral: ["BASELINE", "FLAT AFFECT", "CALIBRATING", "SUBJECT COMPOSED", "READING SUBJECT", "NO DEVIATION"],
    smile: ["AFFECT: POSITIVE", "COMPLIANCE LIKELY", "TRUST INDEX RISING", "SUBJECT IS PLEASED", "MASKING? 0.31"],
    frown: ["HOSTILITY 0.62", "DEFENSIVE POSTURE", "RESISTANCE NOTED", "TENSION IN BROW", "SUBJECT DOUBTS"],
    surprise: ["STARTLE RESPONSE", "PUPIL EVENT", "SUBJECT ALERTED", "UNEXPECTED INPUT"],
    speaking: ["VOCALISATION", "SUBJECT SPEAKING", "LISTENING", "MOUTH OPEN"],
    eyes_closed: ["EYES CLOSED", "SIGNAL LOST: EYES", "SUBJECT NOT LOOKING", "WAITING"],
    away: ["AVERTED GAZE", "EVASION", "SUBJECT LOOKING AWAY", "ATTENTION DRIFT"],
    close: ["SUBJECT TOO CLOSE", "PROXIMITY WARNING", "DETAIL ACQUIRED", "CLOSER. GOOD."],
    far: ["SUBJECT DISTANT", "LOW DETAIL", "COME CLOSER", "RANGE: FAR"],
  };

  function label(moodName, random) {
    const pool = LABELS[moodName] || LABELS.neutral;
    return pool[Math.floor((random ? random() : Math.random()) * pool.length) % pool.length];
  }

  /* 0..1 gauges for the readout's bars. */
  function gauges(f) {
    if (!f) return { affect: 0, tension: 0, attention: 0, vocal: 0 };
    const s = f.scores;
    return {
      affect: clamp(0.5 + s.smile * 0.6 - s.frown * 0.5, 0, 1),
      tension: clamp(s.frown * 0.8 + s.squint * 0.4 + s.surprise * 0.3, 0, 1),
      attention: clamp(1 - Math.abs(f.turn) * 0.8 - Math.abs(f.nod) * 0.4 - s.blink * 0.6, 0, 1),
      vocal: clamp(s.jaw * 1.4, 0, 1),
    };
  }

  const api = { describe, mood, label, gauges, LABELS, KEY_POINTS, MESH_POINTS, POINTS: P };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) (root.Oracle = root.Oracle || {}).faceReading = api;
})(typeof window !== "undefined" ? window : null);
