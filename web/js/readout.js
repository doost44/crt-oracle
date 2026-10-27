/* The readout screen: the participant's live face, framed like degraded surveillance
 * software (see the references folder): a VHS-tinted picture with a date stamp, a
 * red head box and a blue face box, X marks on the eyes, landmark dots, a
 * triangulated mesh, torn-off numbered blocks, ranked "match" slots that never
 * match, and analysis labels that change with the face's expression.
 *
 * Linked to the spoken Oracle (talk.html), it also shows what the visitor said
 * and the Oracle's private notes on them, and it is where the Oracle's physical
 * commands land: the instruction appears over the picture, the face landmarks
 * check it (actions.js), and the result goes back to the Oracle to react to.
 *
 * All of it is theatre. Nothing identifies anyone, and no picture is kept: each
 * frame is drawn, measured and thrown away.
 *
 * Keys: C next camera, F fullscreen, M mirror the picture, H hide the key line.
 */
(function () {
  "use strict";
  const Oracle = window.Oracle;
  const presence = Oracle.presence;
  const R = Oracle.faceReading;

  const canvas = document.getElementById("readout");
  const ctx = canvas.getContext("2d");
  const FONT = 'Consolas, "Lucida Console", "Courier New", monospace';

  // The screen re-tints with whoever is speaking (Weary keeps the CRT green).
  const TINTS = {
    none: { fg: [107, 255, 158], bg: "#020a05" },
    weary: { fg: [107, 255, 158], bg: "#020a05" },
    sugar: { fg: [255, 184, 82], bg: "#0d0702" },
    clinical: { fg: [214, 232, 255], bg: "#03060c" },
  };
  const C = {
    head: "#ff3030",
    face: "#4a6bff",
    eyeR: "#3cff4a",
    eyeL: "#ffe83c",
    dot: "#3cff4a",
    mesh: "#3fe8ff",
    search: "#ffe83c",
    link: "#ff3030",
    tag: "#d4ff3c",
    tagShadow: "#5a2cff",
    stamp: "#f2f2f2",
  };
  const STAGES = ["FACE DETECTION", "FEATURE SEARCH", "FINAL FEATURE POSNS", "TRIANGULATION", "WARPING", "FEATURE EXTRACTION"];
  const STAGE_AT = [0, 0.7, 1.5, 2.3, 3.2]; // seconds after a face appears

  const Actions = Oracle.Actions;
  const COMMAND_SHOW_MS = 3500; // the verdict stays over the picture this long

  const state = {
    oracle: { scene: "", personality: null, talking: false },
    heard: "", // the visitor's last words, from the spoken Oracle
    command: null, // { id, action, label, check, status, progress, start, result, ended }
    linked: 0, // last message from the Oracle's screen
    mirror: readFlag("oracle.mirror"),
    help: true,
    subject: 0,
    subjectSince: -1,
    lastAbsent: performance.now(),
    mood: "absent",
    moodSince: 0,
    log: [],
    lastLog: 0,
    mesh: null, // triangles over R.MESH_POINTS, fixed at lock
    tiles: [],
    tileId: 52900 + Math.floor(Math.random() * 900),
    prevCenter: null,
    motion: 0,
    matchSeed: Math.random() * 1000,
  };

  function readFlag(key) {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch (e) {
      return false;
    }
  }
  function writeFlag(key, on) {
    try {
      window.localStorage.setItem(key, on ? "1" : "0");
    } catch (e) {
      // fine: lasts until reload
    }
  }

  // --- the picture: tinted, noisy, bleeding red at the edges ------------------

  const PIC_W = 320;
  const PIC_H = 240;
  const pic = document.createElement("canvas");
  pic.width = PIC_W;
  pic.height = PIC_H;
  const pctx = pic.getContext("2d", { willReadFrequently: true });

  function processPicture(t, tint) {
    const video = presence.video;
    if (!video || video.readyState < 2) return false;
    pctx.save();
    if (state.mirror) {
      pctx.translate(PIC_W, 0);
      pctx.scale(-1, 1);
    }
    pctx.drawImage(video, 0, 0, PIC_W, PIC_H);
    pctx.restore();
    const img = pctx.getImageData(0, 0, PIC_W, PIC_H);
    const d = img.data;
    const [tr, tg, tb] = tint.fg;
    // A tracking band that drifts down the picture, like a worn tape.
    const band = ((t * 0.07) % 1.3) * PIC_H;
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < PIC_H; y++) {
      const inBand = Math.abs(y - band) < 6;
      const shift = inBand ? Math.round(Math.sin(y * 0.9 + t * 20) * 6) : Math.random() < 0.004 ? 3 : 0;
      const edgeY = Math.max(0, 1 - y / (PIC_H * 0.28)); // red bleed is strongest at the top
      for (let x = 0; x < PIC_W; x++) {
        const sx = Math.min(PIC_W - 1, Math.max(0, x + shift));
        const i = (y * PIC_W + x) * 4;
        const j = (y * PIC_W + sx) * 4;
        let lum = (src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11) / 255;
        lum = 0.12 + Math.pow(lum, 0.85) * 0.88; // washed out: blacks lifted
        const n = (Math.random() - 0.5) * (inBand ? 0.5 : 0.16);
        const v = Math.max(0, lum + n);
        // Red smears in from the edges, sampled a few pixels to the side.
        const k = (y * PIC_W + Math.min(PIC_W - 1, sx + 4)) * 4;
        const edgeX = Math.max(0, 1 - Math.min(x, PIC_W - x) / (PIC_W * 0.08));
        const bleed = Math.max(edgeY, edgeX * 0.6) ** 1.5 * (src[k] / 255) * 0.8;
        d[i] = tr * v + 230 * bleed;
        d[i + 1] = tg * v * (1 - bleed * 0.6);
        d[i + 2] = tb * v * (1 - bleed * 0.7);
        d[i + 3] = 255;
      }
    }
    pctx.putImageData(img, 0, 0);
    return true;
  }

  // --- layout ----------------------------------------------------------------

  let W = 0, H = 0, L = null;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const m = Math.round(Math.min(W, H) * 0.025);
    const fs = Math.max(10, Math.round(Math.min(H / 44, W / 70)));
    if (W / H >= 1.2) {
      const stripH = Math.round(H * 0.2);
      let vh = H - stripH - m * 3;
      let vw = Math.round((vh * 4) / 3);
      if (vw > W * 0.66) {
        vw = Math.round(W * 0.66);
        vh = Math.round((vw * 3) / 4);
      }
      L = {
        fs, m,
        video: { x: m, y: m, w: vw, h: vh },
        panel: { x: m * 2 + vw, y: m, w: W - vw - m * 3, h: H - m * 2 },
        strip: { x: m, y: m * 2 + vh, w: vw, h: H - vh - m * 3 },
      };
    } else {
      const vw = W - m * 2;
      const vh = Math.round((vw * 3) / 4);
      const stripH = Math.round(H * 0.14);
      L = {
        fs, m,
        video: { x: m, y: m, w: vw, h: vh },
        strip: { x: m, y: m * 2 + vh, w: vw, h: stripH },
        panel: { x: m, y: m * 3 + vh + stripH, w: vw, h: H - vh - stripH - m * 4 },
      };
    }
  }
  window.addEventListener("resize", resize);
  resize();

  // --- helpers ---------------------------------------------------------------

  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;
  const pad = (n, w) => String(Math.abs(Math.round(n))).padStart(w || 2, "0");
  const signed = (n, w) => (Math.round(n) < 0 ? "-" : "+") + pad(n, w);
  function clock(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function duration(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  /* Normalised camera coordinates -> screen, inside the video rectangle. */
  function toScreen(x, y) {
    const v = L.video;
    return [v.x + (state.mirror ? 1 - x : x) * v.w, v.y + y * v.h];
  }
  function rectToScreen(r) {
    const [x1, y1] = toScreen(r.x, r.y);
    const [x2, y2] = toScreen(r.x + r.w, r.y + r.h);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  function point(f, i) {
    return toScreen(f.pts[i * 2], f.pts[i * 2 + 1]);
  }

  function text(str, x, y, color, size, align) {
    ctx.font = `${size || L.fs}px ${FONT}`;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /* Text with a hard drop shadow, like a camcorder's burned-in stamp. */
  function stamp(str, x, y, size, align) {
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillText(str, x + size * 0.08, y + size * 0.08);
    ctx.fillStyle = C.stamp;
    ctx.fillText(str, x, y);
  }

  function tag(str, x, y, size) {
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = C.tagShadow;
    ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = C.tag;
    ctx.fillText(str, x, y);
  }

  function box(r, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  function cross(x, y, s, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, s / 4);
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
    ctx.stroke();
  }

  // --- triangulation (Bowyer-Watson), for the coarse mesh ---------------------

  function delaunay(points) {
    const big = [[-10, -10], [10, -10], [0.5, 20]];
    const all = points.concat(big);
    const n = points.length;
    let tris = [[n, n + 1, n + 2]];
    const circum = (t) => {
      const [ax, ay] = all[t[0]], [bx, by] = all[t[1]], [cx, cy] = all[t[2]];
      const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(d) < 1e-12) return { x: 0, y: 0, r: Infinity };
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
      const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
      return { x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
    };
    for (let i = 0; i < n; i++) {
      const [px, py] = all[i];
      const bad = [], keep = [];
      for (const t of tris) {
        const c = circum(t);
        ((px - c.x) ** 2 + (py - c.y) ** 2 < c.r ? bad : keep).push(t);
      }
      const edges = new Map();
      for (const t of bad) {
        for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
          const k = a < b ? `${a},${b}` : `${b},${a}`;
          edges.set(k, edges.has(k) ? null : [a, b]);
        }
      }
      tris = keep;
      for (const e of edges.values()) if (e) tris.push([e[0], e[1], i]);
    }
    return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
  }

  function buildMesh(f) {
    const pts = R.MESH_POINTS.map((i) => [f.pts[i * 2], f.pts[i * 2 + 1]]);
    return delaunay(pts).map((t) => t.map((k) => R.MESH_POINTS[k]));
  }

  // --- the torn-off numbered blocks (glitch tracking collage) ------------------

  function updateTiles(f, t, dt) {
    const now = performance.now();
    state.tiles = state.tiles.filter((tile) => now - tile.born < tile.life);
    if (!f) return;
    const rate = 2 + state.motion * 60; // blocks per second; more when the face moves
    let spawn = rate * dt;
    while (spawn > 0 && state.tiles.length < 36) {
      if (spawn < 1 && Math.random() > spawn) break;
      spawn -= 1;
      const h = f.head;
      const sw = (0.03 + Math.random() * 0.07) * (Math.random() < 0.2 ? 2.2 : 1);
      const sh = sw * (0.6 + Math.random() * 0.8);
      const sx = h.x + Math.random() * Math.max(0.01, h.w - sw);
      const sy = h.y + Math.random() * Math.max(0.01, h.h - sh);
      // Thrown outward from the middle of the face.
      const ox = sx + sw / 2 - f.center.x;
      const oy = sy + sh / 2 - f.center.y;
      const len = Math.hypot(ox, oy) || 1;
      const push = (0.05 + Math.random() * 0.35) * f.box.w * 2;
      state.tiles.push({
        sx, sy, sw, sh,
        dx: sx + (ox / len) * push,
        dy: sy + (oy / len) * push,
        id: state.tileId++,
        born: now,
        life: 600 + Math.random() * 1800,
      });
    }
  }

  function drawTiles() {
    const v = L.video;
    const size = Math.max(9, Math.round(L.fs * 0.8));
    for (const tile of state.tiles) {
      const src = { x: tile.sx * PIC_W, y: tile.sy * PIC_H, w: tile.sw * PIC_W, h: tile.sh * PIC_H };
      const mx = state.mirror ? 1 - tile.dx - tile.sw : tile.dx;
      const dst = { x: v.x + mx * v.w, y: v.y + tile.dy * v.h, w: tile.sw * v.w, h: tile.sh * v.h };
      // The picture canvas is already mirrored, so sample it at the mirrored spot too.
      if (state.mirror) src.x = (1 - tile.sx - tile.sw) * PIC_W;
      ctx.drawImage(pic, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
      box(dst, "rgba(212,255,60,0.55)", 1);
      tag(String(tile.id), dst.x + 2, dst.y + 2, size);
    }
  }

  // --- the face overlays -------------------------------------------------------

  function drawFace(f, t, since) {
    const age = since;
    const stage = STAGE_AT.filter((s) => age >= s).length - 1; // 0..4
    const faceR = rectToScreen(f.box);
    const headR = rectToScreen(f.head);
    const flicker = stage === 0 && Math.floor(t * 12) % 2 === 0;

    if (stage >= 4) drawTiles();

    // Red: the detection box. Locked, it grows into the head box and the face box turns blue.
    if (!flicker) box(stage >= 4 ? headR : faceR, C.head, 2.5);
    if (stage >= 4) box(faceR, C.face, 2.5);

    // Feature search: yellow boxes on the eyes, nose and mouth, joined by red lines.
    const rescan = stage >= 4 && t % 7 < 1.1;
    if (stage === 1 || rescan) {
      const parts = [
        [33, 133, 159, 145], // right eye
        [362, 263, 386, 374], // left eye
        [98, 327, 1, 6], // nose
        [61, 291, 0, 17], // mouth
      ];
      const centers = [];
      for (const idx of parts) {
        const xs = idx.map((i) => point(f, i)[0]);
        const ys = idx.map((i) => point(f, i)[1]);
        const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        const g = Math.max(6, faceR.w * 0.05);
        box({ x: r.x - g, y: r.y - g, w: r.w + g * 2, h: r.h + g * 2 }, C.search, 1.5);
        centers.push([r.x + r.w / 2, r.y + r.h / 2]);
      }
      ctx.strokeStyle = C.link;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...centers[0]);
      ctx.lineTo(...centers[2]);
      ctx.lineTo(...centers[1]);
      ctx.moveTo(...centers[2]);
      ctx.lineTo(...centers[3]);
      ctx.stroke();
    }

    // Triangulation: a coarse cyan mesh, faint once locked.
    if (stage >= 3) {
      if (!state.mesh) state.mesh = buildMesh(f);
      ctx.strokeStyle = C.mesh;
      ctx.globalAlpha = stage >= 4 ? 0.35 : 0.9;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const tri of state.mesh) {
        const [a, b, c] = tri.map((i) => point(f, i));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Final feature positions: green dots.
    if (stage >= 2) {
      ctx.fillStyle = C.dot;
      const s = Math.max(2, faceR.w * 0.012);
      for (const i of R.KEY_POINTS) {
        const [x, y] = point(f, i);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }

    // X marks on the eyes: green on the participant's right, yellow on their left.
    if (stage >= 4) {
      const s = Math.max(5, faceR.w * 0.045);
      const [rx, ry] = toScreen(f.eyes.right.x, f.eyes.right.y);
      const [lx, ly] = toScreen(f.eyes.left.x, f.eyes.left.y);
      if (!f.eyesClosed) {
        cross(rx, ry, s, C.eyeR);
        cross(lx, ly, s, C.eyeL);
      }
      const small = Math.max(9, Math.round(L.fs * 0.75));
      tag(`SUBJ ${state.subject}`, headR.x, headR.y - small - 4, small);
    } else {
      text(STAGES[stage], faceR.x, faceR.y - L.fs - 4, C.head, L.fs);
    }
    return stage;
  }

  // --- the camera panel ----------------------------------------------------------

  function drawVideo(t, f, stage, tint) {
    const v = L.video;
    ctx.fillStyle = "#000";
    ctx.fillRect(v.x, v.y, v.w, v.h);
    const ok = processPicture(t, tint);
    if (ok) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(pic, v.x, v.y, v.w, v.h);
    } else {
      drawNoise(v, tint, 1);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.clip();
    if (f) stage = drawFace(f, t, (performance.now() - presence.since) / 1000);
    else if (ok) drawSearching(t, tint);
    ctx.restore();

    // Burned-in camcorder stamp.
    const big = Math.round(v.h / 13);
    const now = new Date();
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    stamp(`${months[now.getMonth()]} ${pad(now.getDate())} ${now.getFullYear()}`, v.x + big * 0.8, v.y + v.h - big * 2.6, big);
    stamp(clock(now), v.x + big * 0.8, v.y + v.h - big * 1.4, big);
    const small = Math.round(big * 0.55);
    if (f && Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = C.head;
      ctx.beginPath();
      ctx.arc(v.x + small * 1.6, v.y + small * 1.5, small * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    stamp(f ? "REC" : "STBY", v.x + small * 2.4, v.y + small, small);
    stamp("SP", v.x + v.w - small * 1.2, v.y + small, small, "right");
    box(v, rgb(tint.fg, 0.5), 1);
    return stage;
  }

  function drawSearching(t, tint) {
    const v = L.video;
    const y = v.y + ((t * 0.35) % 1) * v.h;
    ctx.fillStyle = rgb(tint.fg, 0.18);
    ctx.fillRect(v.x, y - 2, v.w, 4);
    if (Math.floor(t * 1.5) % 2 === 0) text("NO SUBJECT", v.x + v.w / 2, v.y + v.h / 2 - L.fs, C.head, L.fs * 1.6, "center");
  }

  function drawNoise(r, tint, alpha) {
    const cell = Math.max(3, Math.round(r.w / 90));
    for (let y = r.y; y < r.y + r.h; y += cell) {
      for (let x = r.x; x < r.x + r.w; x += cell) {
        const v = Math.random();
        ctx.fillStyle = rgb([tint.fg[0] * v, tint.fg[1] * v, tint.fg[2] * v], alpha * 0.8);
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }

  // --- the side panel --------------------------------------------------------------

  function bar(x, y, w, value, color, dim) {
    const cells = Math.max(6, Math.floor(w / (L.fs * 0.62)));
    const on = Math.round(value * cells);
    text("█".repeat(on), x, y, color);
    text("░".repeat(cells - on), x + on * L.fs * 0.6, y, dim);
  }

  function drawPanel(t, f, stage, tint) {
    const p = L.panel;
    const fg = rgb(tint.fg);
    const dim = rgb(tint.fg, 0.45);
    const lh = Math.round(L.fs * 1.35);
    const cols = Math.floor(p.w / (L.fs * 0.6));
    let y = p.y;
    const line = (str, color) => {
      if (y + lh > p.y + p.h) return;
      text(str.slice(0, cols), p.x, y, color || fg);
      y += lh;
    };
    const rule = () => line("─".repeat(cols), dim);

    const linked = performance.now() - state.linked < 3000;
    line(`ORACLE//WATCH  ${Math.floor(t * 2) % 2 ? "●" : " "} LIVE`);
    line(`CAM  ${(presence.cameraLabel || "NONE").toUpperCase()}`, dim);
    line(`SRC  ${presence.tracking === "remote" ? "LINKED TO ORACLE" : presence.tracking === "local" ? "LOCAL TRACKER" : "WAITING"}`, dim);
    rule();
    const now = performance.now();
    line(`SUBJECT   ${f ? "#" + state.subject : "------"}`);
    line(`IN VIEW   ${f ? duration(now - presence.since) : "--:--:--"}`);
    const who = linked && state.oracle.personality ? state.oracle.personality.toUpperCase() : "------";
    const doing = !linked ? "OFFLINE" : state.oracle.talking ? "SPEAKING" : (state.oracle.scene || "").toUpperCase();
    line(`ORACLE    ${who} / ${doing}`);
    if (state.heard) line(`HEARD     "${state.heard.toUpperCase()}"`, linked ? fg : dim);
    rule();
    line("PIPELINE", dim);
    for (let i = 0; i < STAGES.length; i++) {
      const done = f && stage >= i && i < 4;
      const working = f && stage >= 4 && i >= 4;
      const pct = working ? ` ${pad(((t * (i === 4 ? 23 : 11)) % 100) | 0, 2)}%` : "";
      line(` [${done ? "x" : working ? (Math.floor(t * 4) % 2 ? "/" : "\\") : " "}] ${STAGES[i]}${pct}`, done || working ? fg : dim);
    }
    rule();
    if (f) {
      line(`HEAD  YAW ${signed(f.turn * 60)}° NOD ${signed(f.nod * 40)}° ROLL ${signed(f.roll)}°`);
      const range = f.size > 0.42 ? "NEAR" : f.size < 0.14 ? "FAR" : "MID";
      line(`RANGE ${f.size.toFixed(2)} (${range})   EYES ${f.eyesClosed ? "CLOSED" : "OPEN"}`);
    } else {
      line("HEAD  YAW ---° NOD ---° ROLL ---°", dim);
      line("RANGE ----          EYES ----", dim);
    }
    const g = R.gauges(f);
    for (const [name, v] of [["AFFECT   ", g.affect], ["TENSION  ", g.tension], ["ATTENTION", g.attention], ["VOCAL    ", g.vocal]]) {
      if (y + lh > p.y + p.h) break;
      text(name, p.x, y, f ? fg : dim);
      bar(p.x + L.fs * 0.6 * 10, y, p.w - L.fs * 0.6 * 16, f ? v : 0, fg, dim);
      text(f ? v.toFixed(2) : "-.--", p.x + p.w, y, f ? fg : dim, L.fs, "right");
      y += lh;
    }
    rule();
    line("ANALYSIS", dim);
    // The newest entries that fit; the Oracle's own notes wrap onto more lines.
    const room = Math.max(0, Math.floor((p.y + p.h - y) / lh) - 1);
    const rows = [];
    for (let i = state.log.length - 1; i >= 0 && rows.length < room; i--) {
      const entry = state.log[i];
      const wrapped = wrap(entry.label, cols - 10);
      const color = i === state.log.length - 1 ? fg : entry.oracle ? rgb(tint.fg, 0.8) : dim;
      for (let k = wrapped.length - 1; k >= 0 && rows.length < room; k--) rows.unshift([`${k ? "        " : entry.time}  ${wrapped[k]}`, color]);
    }
    rows.forEach(([str, color]) => line(str, color));
    if (state.help && y + lh <= p.y + p.h) {
      y = p.y + p.h - lh;
      line("C CAM  F FULL  M MIRROR  H HIDE", dim);
    }
  }

  function wrap(str, width) {
    const out = [];
    let cur = "";
    for (const word of String(str).split(/\s+/)) {
      if (cur && (cur + " " + word).length > width) {
        out.push(cur);
        cur = word;
      } else cur = cur ? cur + " " + word : word;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  }

  // --- the Oracle's commands, over the picture --------------------------------------

  function startCommand(msg) {
    if (!Actions || !Actions.ACTIONS[msg.action]) {
      presence.post({ type: "command-result", id: msg.id, action: msg.action, status: "lost" });
      return;
    }
    state.command = {
      id: msg.id,
      action: msg.action,
      label: Actions.ACTIONS[msg.action].label,
      check: new Actions.Check(msg.action),
      status: "settling",
      progress: 0,
      start: performance.now(),
      result: null,
      ended: 0,
    };
    logEntry(`INSTRUCTION: ${state.command.label.toUpperCase()}`, true);
  }

  // Every tracker result while a command is open: is the visitor doing it?
  presence.onResult((result, now) => {
    const c = state.command;
    if (!c || c.result) return;
    const r = c.check.update(Actions.measure(result), now);
    c.status = r.status;
    c.progress = r.progress;
    c.hint = r.hint;
    if (r.status === "done" || r.status === "timeout") {
      c.result = r.status;
      c.ended = performance.now();
      presence.post({ type: "command-result", id: c.id, action: c.action, status: r.status, hint: r.hint || null });
      logEntry(r.status === "done" ? `COMPLIED: ${c.label.toUpperCase()}` : `NON-COMPLIANCE: ${c.label.toUpperCase()}`, true);
    }
  });

  function drawCommand(t, tint) {
    const c = state.command;
    if (!c) return;
    if (c.result && performance.now() - c.ended > COMMAND_SHOW_MS) {
      state.command = null;
      return;
    }
    const v = L.video;
    const big = Math.round(v.h / 11);
    const small = Math.round(big * 0.42);
    const cx = v.x + v.w / 2;
    const top = v.y + v.h * 0.52; // below the face, above the date stamp
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(v.x + v.w * 0.08, top - small * 0.6, v.w * 0.84, big + small * 4.2);
    if (!c.result) {
      text(Math.floor(t * 2) % 2 ? "INSTRUCTION" : "INSTRUCTION ▮", cx, top, C.tag, small, "center");
      stamp(c.label.toUpperCase(), cx, top + small * 1.4, big, "center");
      const w = v.w * 0.6;
      const x = cx - w / 2;
      const y = top + small * 1.6 + big * 1.15;
      ctx.strokeStyle = C.tag;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, small * 0.9);
      ctx.fillStyle = C.tag;
      ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * c.progress), small * 0.9 - 4);
      const left = Math.max(0, (c.check.timeoutMs - (performance.now() - c.start)) / 1000);
      const status = c.hint === "no_face" ? "SUBJECT NOT IN FRAME" : c.status === "settling" ? "CALIBRATING" : c.status === "holding" ? "HOLD" : "WAITING FOR SUBJECT";
      text(`${status}  ${left.toFixed(1)}S`, cx, y + small * 1.3, rgb(tint.fg), small, "center");
    } else {
      const ok = c.result === "done";
      text(ok ? "COMPLIANCE CONFIRMED" : "NON-COMPLIANCE LOGGED", cx, top, ok ? C.dot : C.head, small, "center");
      stamp(ok ? "COMPLIED" : "FAILED", cx, top + small * 1.4, big, "center");
    }
  }

  function logEntry(label, oracle) {
    state.log.push({ mood: oracle ? "oracle" : state.mood, label, time: clock(new Date()), oracle: !!oracle });
    if (state.log.length > 40) state.log.shift();
    state.lastLog = performance.now();
  }

  // --- the "match" strip: ranked slots that never find anyone -------------------

  function drawStrip(t, f, tint) {
    const s = L.strip;
    const fg = rgb(tint.fg);
    const dim = rgb(tint.fg, 0.45);
    text("MATCH RESULTS", s.x, s.y, dim);
    const top = s.y + L.fs * 1.5;
    const gap = L.m;
    const w = (s.w - gap * 2) / 3;
    const h = s.h - L.fs * 1.5;
    for (let i = 0; i < 3; i++) {
      const x = s.x + i * (w + gap);
      const slot = { x, y: top + L.fs * 1.4, w, h: h - L.fs * 1.4 };
      // The ID rolls while a face is in view, and never settles on a record.
      const rolling = f ? Math.floor((t * (7 + i * 3) + state.matchSeed * (i + 1)) % 1e8) : 0;
      text(`${i + 1}: ID`, x, top, f ? fg : dim);
      text(String(rolling).padStart(8, "0"), x + w, top, f ? fg : dim, L.fs, "right");
      drawNoise(slot, tint, f ? 0.55 : 0.25);
      if (f) {
        const pct = Math.round(18 + 60 * Math.abs(Math.sin(t * (0.4 + i * 0.17) + i)));
        text(pct > 70 && i === 0 ? "NO RECORD" : `SEARCHING ${pct}%`, slot.x + slot.w / 2, slot.y + slot.h / 2 - L.fs / 2, fg, L.fs, "center");
      }
      box(slot, i === 0 && f ? C.head : dim, i === 0 && f ? 2.5 : 1);
    }
  }

  /* No camera: static where the picture goes. The panel still runs, so the
   * Oracle's notes and what the visitor said show without a camera too. */
  function drawNoSignal(tint) {
    const v = L.video;
    drawNoise(v, tint, 0.35);
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    text("NO SIGNAL", cx, cy - L.fs * 3, C.head, L.fs * 2.4, "center");
    text(presence.status === "starting" ? "WAITING FOR THE CAMERA" : (presence.error || "CAMERA OFF").toUpperCase().slice(0, 60), cx, cy, rgb(tint.fg), L.fs, "center");
    const hint = presence.status === "error" ? "CLICK HERE TO TURN ON THE CAMERA" : "C: TRY THE NEXT CAMERA   ?camera=NAME PICKS ONE";
    text(hint, cx, cy + L.fs * 2, rgb(tint.fg, presence.status === "error" ? 1 : 0.6), L.fs * (presence.status === "error" ? 1.1 : 0.85), "center");
    box(v, rgb(tint.fg, 0.5), 1);
  }

  // --- bookkeeping per frame ---------------------------------------------------------

  function track(f, now) {
    if (!f) {
      state.lastAbsent = now;
      state.mesh = null;
      state.prevCenter = null;
      state.motion *= 0.9;
    } else {
      if (state.subjectSince !== presence.since) {
        state.subjectSince = presence.since;
        // A new subject number each time someone steps up. A random number, nothing more.
        state.subject = 10000 + Math.floor(Math.random() * 90000);
      }
      if (state.prevCenter) {
        const m = Math.hypot(f.center.x - state.prevCenter.x, f.center.y - state.prevCenter.y);
        state.motion = state.motion * 0.85 + m * 0.15;
      }
      state.prevCenter = f.center;
    }
    const mood = R.mood(f);
    if (mood !== state.mood) {
      state.mood = mood;
      state.moodSince = now;
    }
    // Log a label once a mood has held for a moment, and now and then while it lasts.
    const held = now - state.moodSince > 600;
    const last = state.log[state.log.length - 1];
    if (held && (!last || last.mood !== mood || now - state.lastLog > 5000)) {
      state.log.push({ mood, label: R.label(mood), time: clock(new Date()) });
      if (state.log.length > 40) state.log.shift();
      state.lastLog = now;
    }
  }

  let lastFrame = performance.now();
  const startedAt = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const t = (now - startedAt) / 1000;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const tint = TINTS[state.oracle.personality] || TINTS.none;
    document.body.style.background = tint.bg;
    ctx.fillStyle = tint.bg;
    ctx.fillRect(0, 0, W, H);
    try {
      const f = presence.current;
      track(f, now);
      if (presence.status !== "live") {
        drawNoSignal(tint);
        drawPanel(t, null, -1, tint);
        drawStrip(t, null, tint);
        return;
      }
      updateTiles(f, t, dt);
      let stage = -1;
      stage = drawVideo(t, f, stage, tint);
      drawCommand(t, tint);
      drawPanel(t, f, stage, tint);
      drawStrip(t, f, tint);
    } catch (err) {
      console.warn(err);
    }
  }

  // --- talking to the Oracle's screen, and keys -----------------------------------------

  presence.listen((msg) => {
    if (!msg || msg.from !== "main") return;
    state.linked = performance.now();
    if (msg.type === "oracle") state.oracle = { scene: msg.scene, personality: msg.personality, talking: msg.talking };
    if (msg.type === "said" && msg.who === "visitor") state.heard = String(msg.text || "").slice(0, 140);
    if (msg.type === "note" && msg.text) logEntry(`${(msg.personality || "oracle").toUpperCase()}: ${String(msg.text).toUpperCase()}`, true);
    if (msg.type === "command") startCommand(msg);
    if (msg.type === "reset") {
      state.heard = "";
      state.command = null;
    }
  });

  // Tell the spoken Oracle whether the eye is open, so it only gives commands it can check.
  setInterval(() => presence.post({ type: "eye", camera: presence.status, face: !!presence.current }), 1000);

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "c") {
      Oracle.camera.listCameras().then((cams) => {
        const next = Oracle.camera.next(cams, presence.cameraLabel);
        if (next) presence.switchCamera(next.label);
      });
    } else if (k === "f") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (k === "m") {
      state.mirror = !state.mirror;
      writeFlag("oracle.mirror", state.mirror);
    } else if (k === "h") {
      state.help = !state.help;
    }
  });
  // A click asks for the camera again: Chrome shows its permission prompt for a click.
  canvas.addEventListener("click", () => {
    if (presence.status === "error") presence.retry();
  });
  canvas.addEventListener("dblclick", () => document.documentElement.requestFullscreen().catch(() => {}));

  Oracle.readout = { state };
  presence.role = "readout";
  presence.start({ role: "readout" }).then(() => presence.post({ type: "hello" }));
  presence.post({ type: "hello" });
  requestAnimationFrame(frame);
})();
