/* The Oracle: a floating ASCII sun/face built from Charlie's painted face.
 *
 * The face maps (web/data/face.js, made by tools/export_web.py) are decoded once:
 *   sculpt  the big volume (normals + depth for parallax)
 *   height  the paint thickness (brushwork detail in the normals)
 *   mask    the torn-edge silhouette
 *   luma    how bright the painting is (the blue strokes are dark)
 *   color   colour class per pixel (orange, blue, red, green, white)
 *
 * Every frame each cell of the face is traced back to the painting through a
 * gentle yaw rotation (squashed by cos(yaw), shifted by depth), lit by a light
 * that drifts, and turned into a character. The darker the paint, the denser the
 * character, so the blue strokes (eyes, brows, nose, mouth) come out as the
 * heaviest white glyphs, as in face_ascii_preview.png; the orange paint is light
 * characters shaded by the light, with a few orange sparks; the rim is heavy
 * white with the painting's red band. Sparse sun rays drift around it.
 *
 * Contract (main.js): Oracle.scenes.face.frame(grid, t, opts)
 *   opts.region      {x, y, w, h} cells it may draw in
 *   opts.reveal      0..1, builds in from scattered characters and a sweep
 *   opts.personality null | "sugar" | "weary" | "clinical"
 *   opts.mood        "talking" | "idle"
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  Oracle.scenes = Oracle.scenes || {};

  // --- the painting, decoded once -------------------------------------------------

  let F = null; // decoded and precomputed maps

  const KIND_FIELD = 1;
  const KIND_RIM_BLUE = 2;
  const KIND_RIM_RED = 3;

  function decodeB64(str, n) {
    const bin = atob(str);
    const out = new Uint8Array(n);
    for (let i = 0; i < n && i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function prepare() {
    const src = window.ORACLE_FACE;
    if (!src) return null;
    const W = src.w;
    const H = src.h;
    const N = W * H;
    const C = src.classes || { none: 0, orange: 1, blue: 2, red: 3, green: 4, white: 5 };
    const height = decodeB64(src.height, N);
    const sculpt = decodeB64(src.sculpt, N);
    const maskRaw = decodeB64(src.mask, N);
    const lumaRaw = decodeB64(src.luma, N);
    const cls = decodeB64(src.color, N);

    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = maskRaw[i] >= 128 ? 1 : 0;

    // Distance (in painting pixels) to the outside of the mask: a two-pass chamfer.
    const dist = new Float32Array(N);
    const BIG = 1e6;
    for (let i = 0; i < N; i++) dist[i] = mask[i] ? BIG : 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!dist[i]) continue;
        let d = dist[i];
        if (x === 0 || y === 0) d = 1;
        else {
          d = Math.min(d, dist[i - 1] + 1, dist[i - W] + 1, dist[i - W - 1] + 1.414);
          if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 1.414);
        }
        dist[i] = d;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (!dist[i]) continue;
        let d = dist[i];
        if (x === W - 1 || y === H - 1) d = 1;
        else {
          d = Math.min(d, dist[i + 1] + 1, dist[i + W] + 1, dist[i + W + 1] + 1.414);
          if (x > 0) d = Math.min(d, dist[i + W - 1] + 1.414);
        }
        dist[i] = d;
      }
    }

    // Brushwork, softened a little so the normals show strokes, not pixel noise.
    const hs = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            s += height[yy * W + xx];
            n++;
          }
        }
        hs[y * W + x] = s / n / 255;
      }
    }

    // Surface: the sculpt is the big volume, the paint sits on top of it.
    const RELIEF_SCULPT = 34; // in painting pixels
    const RELIEF_PAINT = 5;
    const surf = new Float32Array(N);
    const depth = new Float32Array(N); // 0..~1, for parallax
    for (let i = 0; i < N; i++) {
      const s = sculpt[i] / 255;
      surf[i] = s * RELIEF_SCULPT + hs[i] * RELIEF_PAINT;
      depth[i] = mask[i] ? s + hs[i] * 0.08 : 0;
    }
    const nx = new Float32Array(N);
    const ny = new Float32Array(N);
    const nz = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const xl = x > 0 ? i - 1 : i;
        const xr = x < W - 1 ? i + 1 : i;
        const yu = y > 0 ? i - W : i;
        const yd = y < H - 1 ? i + W : i;
        const gx = (surf[xr] - surf[xl]) * 0.5;
        const gy = (surf[yd] - surf[yu]) * 0.5;
        const l = Math.sqrt(gx * gx + gy * gy + 1);
        nx[i] = -gx / l;
        ny[i] = -gy / l;
        nz[i] = 1 / l;
      }
    }

    // What each painting pixel is: plain paint, a painted stroke, or the rim.
    const kind = new Uint8Array(N);
    const ink = new Float32Array(N); // how dark the paint is (the blue strokes ~0.8, the orange ~0.1)
    const luma = new Float32Array(N);
    const tone = new Uint8Array(N); // 1 orange, 2 green, 3 white highlight
    for (let i = 0; i < N; i++) {
      luma[i] = lumaRaw[i] / 255;
      if (!mask[i]) continue;
      const c = cls[i];
      const d = dist[i];
      const L = lumaRaw[i];
      if (d <= 3.5 || (d <= 7 && L < 105 && c !== C.red)) kind[i] = KIND_RIM_BLUE;
      else if (d <= 10 && c === C.red) kind[i] = KIND_RIM_RED;
      else {
        kind[i] = KIND_FIELD;
        // the blue strokes are the darkest paint (luma < ~95; the orange sits at ~140)
        // (green and orange paint only counts a little: it is texture, not a feature)
        const k = ((138 - L) / 62) * (c === C.orange || c === C.green || c === C.white ? 0.45 : 1);
        ink[i] = d < 7 ? 0 : k < 0 ? 0 : k > 1 ? 1 : k;
      }
      tone[i] = c === C.orange ? 1 : c === C.green ? 2 : c === C.white ? 3 : 0;
    }

    // Stable per-pixel noise so characters stick to the surface as it turns.
    const noise = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) noise[y * W + x] = hash2(x, y);

    return { W, H, mask, depth, nx, ny, nz, kind, ink, luma, tone, noise };
  }

  // --- characters ------------------------------------------------------------------

  // Lit paint, darkest to brightest, two variants per step (the poster's n/z/x texture).
  const FIELD = [
    [".", "`"],
    [".", ":"],
    [":", "-"],
    ["-", "~"],
    ["~", "="],
    ["=", "+"],
    ["+", "x"],
    ["x", "n"],
  ];
  const STROKE = ["@", "#", "%", "&", "M", "W", "8", "B"];
  const STROKE_SOFT = ["*", "z", "x", "#", "*", "n"];
  const RIM = [
    [":", "+"],
    ["+", "*"],
    ["*", "#"],
    ["#", "%"],
    ["%", "@"],
    ["@", "#"],
  ];
  const SCATTER = "#%*+=-:znxo01/\\|";
  const RAY_CHARS = { h: ["-", "-"], v: ["|", ":"], d1: ["/", "/"], d2: ["\\", "\\"] };

  // --- sun rays, precomputed once ---------------------------------------------------

  const RAY_COUNT = 24;
  const rays = [];
  (function makeRays() {
    const r = Oracle.rng ? Oracle.rng(4242) : Math.random;
    for (let i = 0; i < RAY_COUNT; i++) {
      rays.push({
        angle: (i / RAY_COUNT) * Math.PI * 2 + (r() - 0.5) * 0.1,
        length: (i % 2 ? 0.3 : 0.6) + r() * 0.5, // in face radii, long and short in turn
        speed: 0.6 + r() * 0.9,
        phase: r() * 10,
        seed: Math.floor(r() * 100000),
      });
    }
  })();

  function rayChar(angle, k) {
    // Screen angle of the ray decides the stroke direction.
    const a = ((angle % Math.PI) + Math.PI) % Math.PI; // 0..pi
    let set;
    if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) set = RAY_CHARS.h;
    else if (a > (3 * Math.PI) / 8 && a < (5 * Math.PI) / 8) set = RAY_CHARS.v;
    else if (a < Math.PI / 2) set = RAY_CHARS.d2;
    else set = RAY_CHARS.d1;
    return set[k % set.length];
  }

  // --- per-personality feel ----------------------------------------------------------

  // speed: time scale; bob/bobRate/droop: the float; yaw: how far it turns; gain: brightness;
  // warm: share of accent-coloured paint cells; sparkle: orange glints; scan: clinical line.
  const MOODS = {
    none: { speed: 1, bob: 0.9, bobRate: 0.8, droop: 0, yaw: 0.34, gain: 1, warm: 0.025, accent: "orange", accentTone: 1, sparkle: 0, scan: false, ray: 1 },
    sugar: { speed: 1.2, bob: 1.1, bobRate: 1.1, droop: 0, yaw: 0.36, gain: 1.1, warm: 0.16, accent: "orange", accentTone: 1, sparkle: 0.022, scan: false, ray: 1.15 },
    weary: { speed: 0.55, bob: 0.8, bobRate: 0.45, droop: 1, yaw: 0.22, gain: 0.82, warm: 0.012, accent: "orange", accentTone: 1, sparkle: 0, scan: false, ray: 0.6 },
    clinical: { speed: 0.85, bob: 0.45, bobRate: 0.7, droop: 0, yaw: 0.28, gain: 0.95, warm: 0.12, accent: "teal", accentTone: 2, sparkle: 0, scan: true, ray: 0.85 },
  };

  // Mouth area in painting coordinates (0..1), for the talking flicker.
  const MOUTH = { u: 0.5, v: 0.735, ru: 0.2, rv: 0.12 };

  function smooth(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // --- the frame ----------------------------------------------------------------------

  // 3 x 3 samples per cell (index 4 is the centre)
  const SUB_X = [-0.33, 0, 0.33, -0.33, 0, 0.33, -0.33, 0, 0.33];
  const SUB_Y = [-0.33, -0.33, -0.33, 0, 0, 0, 0.33, 0.33, 0.33];
  const NSUB = SUB_X.length;

  function frame(grid, t, opts) {
    if (!F) F = prepare();
    if (!F) return;
    opts = opts || {};
    const region = opts.region || { x: 0, y: 0, w: grid.cols, h: Math.floor(grid.rows * 0.6) };
    const reveal = opts.reveal == null ? 1 : Math.max(0, Math.min(1, opts.reveal));
    const m = MOODS[opts.personality] || MOODS.none;
    const talking = opts.mood === "talking";
    const { W, H, mask, depth, nx, ny, nz, kind, ink, luma, tone, noise } = F;

    const aspect = grid.cellW && grid.cellH ? grid.cellW / grid.cellH : 0.6;
    const ts = t * m.speed;

    // Size: fit the face to the region (normally its height), keep the painting's shape.
    const faceRows = Math.max(8, Math.min(region.h - 2.6, (region.w - 2) * aspect * (H / W)));
    const faceCols = (faceRows * (W / H)) / aspect;
    const half = faceCols / 2;

    // Floating: a slow bob (weary sags, and lingers at the bottom).
    let bob = Math.sin(ts * m.bobRate) * m.bob;
    if (m.droop) bob = m.bob * (Math.sin(ts * m.bobRate) * 0.6 + Math.abs(Math.sin(ts * m.bobRate * 0.5)) * 0.8) - 0.2;
    const cx = region.x + region.w / 2 + Math.sin(ts * 0.31) * 0.6;
    const cy = region.y + region.h / 2 + bob + m.droop * 0.5;
    const top = cy - faceRows / 2;

    // Turning a little left and right.
    const yaw = m.yaw * Math.sin(ts * 0.37) + 0.05 * Math.sin(ts * 0.93 + 1.3);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const DEPTH = 0.32; // parallax, in face half-widths

    // The light drifts around the upper left.
    let lx = -0.55 + 0.45 * Math.sin(ts * 0.23);
    let ly = -0.55 + 0.25 * Math.sin(ts * 0.17 + 0.7);
    let lz = 0.75;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    lx /= ll;
    ly /= ll;
    lz /= ll;

    // Talking: the mouth opens and shuts, and the face pulses a little.
    let open = 0;
    let pulse = 0;
    if (talking) {
      const s = Math.sin(t * 13) * 0.5 + 0.5;
      const s2 = Math.sin(t * 7.3 + 1) * 0.5 + 0.5;
      open = s * s2;
      pulse = 0.06 * Math.sin(t * 9);
    }
    const gain = m.gain * (1 + pulse);

    // Reveal: a sweep down the face, scattered characters ahead of it.
    const sweep = reveal >= 1 ? 2 : reveal * 1.35 - 0.15; // in face heights
    const scatterOdds = reveal >= 1 ? 0 : 0.55 * Math.min(1, reveal * 2.2);
    const scatterTick = Math.floor(t * 12);

    // Glitches: a row of the face slips sideways now and then.
    const gslot = Math.floor(t * 6);
    const glitchOn = reveal >= 1 && hash2(gslot, 77) < 0.035;
    const glitchRow = glitchOn ? Math.floor(top + hash2(gslot, 78) * faceRows) : -999;
    const glitchShift = glitchOn ? (hash2(gslot, 79) < 0.5 ? -1 : 1) * (1 + Math.floor(hash2(gslot, 80) * 3)) : 0;

    // Clinical: a thin scanning line passes down the face.
    const scanRow = m.scan ? Math.floor(top + (((t * 0.22) % 1.3) - 0.15) * faceRows) : -999;

    // --- rays (behind the face) ---
    const rayGrow = smooth(0.45, 1, reveal) * m.ray;
    if (rayGrow > 0) {
      const R = faceRows * 0.5; // face radius in rows
      const spin = ts * 0.025;
      const rx0 = region.x;
      const ry0 = region.y;
      const rx1 = region.x + region.w;
      const ry1 = region.y + region.h;
      for (let k = 0; k < RAY_COUNT; k++) {
        const ray = rays[k];
        // each ray comes and goes on its own slow cycle
        const life = Math.sin(ts * 0.21 * ray.speed + ray.phase);
        if (life < -0.5) continue;
        const a = ray.angle + spin;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // walk one cell at a time along the ray, in row units
        const ds = 1 / Math.max(Math.abs(sa), Math.abs(ca) / aspect);
        const len = R * ray.length * rayGrow * (0.6 + 0.4 * life) * (1 + Math.abs(ca) * 1.4);
        const r0 = R * 1.12;
        const travel = ts * ray.speed * 3 + ray.phase * 4;
        const steps = Math.floor(len / ds);
        for (let s = 0; s < steps; s++) {
          const r = r0 + s * ds;
          const x = Math.floor(cx + (ca * r) / aspect);
          const y = Math.floor(cy + sa * r);
          if (x < rx0 || y < ry0 || x >= rx1 || y >= ry1) continue;
          const phase = (((r - travel) % 9) + 9) % 9; // a dash travelling outward
          const head = phase < 1;
          const dash = phase < 3.5;
          const hs = hash2(ray.seed, s);
          const fade = s / Math.max(1, steps);
          // the ray thins out towards its end
          if (hs < fade * fade * 1.1 - (dash ? 0.25 : 0)) continue;
          let col = "dim";
          let ch = rayChar(a, s & 1);
          if (head) {
            ch = fade < 0.5 ? "*" : "+";
            col = fade < 0.6 ? "bright" : "fg";
          } else if (dash) {
            col = fade < 0.5 ? "fg" : "dim";
          } else if (fade > 0.55 && hs > 0.6) ch = ".";
          if (m.sparkle && hs > 0.88) col = "orange";
          else if (m.scan && hs > 0.95) col = "teal";
          grid.set(x, y, ch, col);
        }
      }
    }

    // --- the face ---
    const y0 = Math.max(region.y, Math.floor(top) - 1);
    const y1 = Math.min(region.y + region.h, Math.ceil(top + faceRows) + 1);
    const x0 = Math.max(region.x, Math.floor(cx - half * 1.05) - 1);
    const x1 = Math.min(region.x + region.w, Math.ceil(cx + half * 1.05) + 1);
    const mu = MOUTH.u;
    const mv = MOUTH.v;

    for (let row = y0; row < y1; row++) {
      const shift = row === glitchRow ? glitchShift : 0;
      for (let col = x0; col < x1; col++) {
        let cov = 0;
        let shade = 0;
        let lum = 0;
        let nStroke = 0;
        let nRimB = 0;
        let nRimR = 0;
        let accentHit = false;
        let uMid = 0;
        let nz0 = 0;
        let lastIdx = -1;
        let vMid = 0;
        for (let k = 0; k < NSUB; k++) {
          let v = (row + 0.5 + SUB_Y[k] - top) / faceRows;
          if (v < 0 || v >= 1) continue;
          const px = (col + 0.5 + SUB_X[k] + shift - cx) / half;
          // inverse yaw: one fixed-point step through the depth map
          let u = px / cosY;
          let ui = Math.floor((u * 0.5 + 0.5) * W);
          let vi = Math.floor(v * H);
          if (ui >= 0 && ui < W) {
            u = (px - depth[vi * W + ui] * DEPTH * sinY) / cosY;
          }
          let uu = u * 0.5 + 0.5;
          if (open > 0) {
            const du = (uu - mu) / MOUTH.ru;
            const dv = (v - mv) / MOUTH.rv;
            const w = 1 - (du * du + dv * dv);
            if (w > 0) v = mv + (v - mv) * (1 - 0.32 * open * w);
          }
          ui = Math.floor(uu * W);
          vi = Math.floor(v * H);
          if (ui < 0 || ui >= W || vi < 0 || vi >= H) continue;
          const i = vi * W + ui;
          if (!mask[i]) continue;
          cov++;
          // rotate the normal with the face
          const rnx = nx[i] * cosY + nz[i] * sinY;
          const rnz = -nx[i] * sinY + nz[i] * cosY;
          const d = rnx * lx + ny[i] * ly + rnz * lz;
          shade += d > 0 ? d : 0;
          nz0 += rnz;
          lum += luma[i];
          const kd = kind[i];
          nStroke += ink[i];
          if (kd === KIND_RIM_BLUE) nRimB++;
          else if (kd === KIND_RIM_RED) nRimR++;
          if (k === 4 || lastIdx < 0) {
            lastIdx = i;
            accentHit = tone[i] === m.accentTone && noise[i] < m.warm;
          }
          uMid += uu;
          vMid += v;
        }
        if (!cov) continue;
        const inv = 1 / cov;
        shade *= inv;
        lum *= inv;
        vMid *= inv;
        const n = noise[lastIdx];
        const vRow = (row + 0.5 - top) / faceRows;

        // reveal: above the sweep is solid, the sweep line glows, below is scatter
        if (vRow > sweep) {
          if (scatterOdds > 0 && hash2(col * 31 + scatterTick, row * 17) < scatterOdds * (0.35 + 0.65 * (cov * inv))) {
            const h = hash2(col + scatterTick * 7, row);
            grid.set(col, row, SCATTER[Math.floor(h * SCATTER.length)], h < 0.25 ? "fg" : "dim");
          }
          continue;
        }
        if (reveal < 1 && vRow > sweep - 0.04) {
          grid.set(col, row, n < 0.5 ? "=" : "#", "bright");
          continue;
        }

        // light: diffuse + ambient, a little of the painting's own brightness
        let b = (0.2 + 0.85 * shade) * (0.78 + 0.32 * lum) * gain;
        // the turned-away side darkens, like a ball
        b *= 0.75 + 0.25 * (nz0 * inv);
        const edge = cov < NSUB * 0.5;

        let ch;
        let color;
        if (row === scanRow) {
          ch = n < 0.5 ? "=" : "-";
          color = "teal";
        } else if (edge || nRimB * 2 >= cov) {
          // heavy rim / torn edge
          const lvl = Math.max(0, Math.min(RIM.length - 1, Math.floor(b * RIM.length * 1.05)));
          ch = RIM[lvl][n < 0.5 ? 0 : 1];
          if (edge && cov <= 2) ch = n < 0.5 ? "'" : ",";
          color = b > 0.85 ? "bright" : b > 0.45 ? "fg" : "dim";
        } else if (nRimR * 2 >= cov) {
          const lvl = Math.max(1, Math.min(RIM.length - 1, Math.floor(b * RIM.length)));
          ch = RIM[lvl][n < 0.5 ? 0 : 1];
          color = n < 0.7 || b < 0.3 ? "red" : "fg";
        } else {
          // paint: the darker the paint, the denser the character (the blue strokes come
          // out as the heaviest glyphs); the light adds a little and sets the colour
          const dk = nStroke * inv;
          let q = dk * 1.05 + b * 0.32 - 0.04;
          q = q < 0 ? 0 : q > 0.999 ? 0.999 : q;
          let mouth = false;
          if (talking) {
            const du = (uMid * inv - mu) / MOUTH.ru;
            const dv = (vMid - mv) / MOUTH.rv;
            mouth = du * du + dv * dv < 1;
          }
          if (q > 0.6) {
            ch = q > 0.72 ? STROKE[Math.floor(n * STROKE.length)] : STROKE_SOFT[Math.floor(n * STROKE_SOFT.length)];
            color = b > 0.35 ? "bright" : "fg";
            if (mouth && hash2(col + scatterTick * 3, row) < 0.35 * open + 0.1) color = "orange";
          } else {
            const lvl = Math.floor((q / 0.6) * FIELD.length * 0.999);
            ch = FIELD[lvl][n < 0.5 ? 0 : 1];
            color = b > 0.9 ? "fg" : "dim";
            if (accentHit) color = m.accent;
            if (m.sparkle && hash2(col * 13 + scatterTick, row * 7) < m.sparkle) {
              ch = n < 0.5 ? "*" : "+";
              color = "orange";
            }
            if (mouth && hash2(col * 3 + scatterTick, row) < 0.3) {
              ch = FIELD[Math.min(FIELD.length - 1, lvl + 2)][n < 0.5 ? 0 : 1];
              color = "fg";
            }
          }
        }
        // the face fades in with the reveal
        if (reveal < 1 && hash2(col, row) > reveal * 1.6) color = "dim";
        grid.set(col, row, ch, color);
      }
    }

    // Now and then a bigger glitch from the shared helper (hallway.js), more while it builds in.
    if (Oracle.glitch && Oracle.rng) {
      const odds = reveal < 1 ? 0.3 : 0.012;
      if (hash2(gslot, 91) < odds) {
        const amount = reveal < 1 ? 0.04 + 0.12 * (1 - reveal) : 0.06;
        Oracle.glitch(grid, amount, Oracle.rng(gslot * 7919 + 1));
      }
    }
  }

  Oracle.scenes.face = { frame };
})();
