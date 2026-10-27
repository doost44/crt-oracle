/* The three personalities' faces, for the centre of the screen while they talk.
 *
 *   Sugar     the sun:  a beaming disc, crinkled happy eyes, blushing cheeks, rays
 *   Weary     the rock: a lumpy, cracked boulder with heavy lids and a flat frown
 *   Clinical  the tree: a round canopy with two ringed eyes whose crosshairs scan
 *
 * These are 2D placeholders until the 3D models (roadmap phase 3), but they are
 * already built the way those will be: every cell asks the shape for a height,
 * the height gives a normal, a drifting light shades it, and the brightness picks
 * a character from a ramp with Bayer dithering. The features (eyes, mouth) are
 * drawn as the heaviest glyphs, like the strokes on the painted sun face. The
 * colours are palette keys, so theme.js tints each face with its personality.
 *
 * Contract (main.js): Oracle.scenes.persona.frame(grid, t, opts)
 *   opts.region      {x, y, w, h} cells it may draw in
 *   opts.personality "sugar" | "weary" | "clinical"
 *   opts.reveal      0..1, builds in from scattered characters
 *   opts.mood        "talking" | "idle"
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  Oracle.scenes = Oracle.scenes || {};

  // --- small helpers ---------------------------------------------------------------

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  /* Distance from (u, v) to a circle's arc, and where on the arc (angle). */
  function ringDist(u, v, cu, cv, r) {
    const du = u - cu;
    const dv = v - cv;
    return Math.abs(Math.sqrt(du * du + dv * dv) - r);
  }

  // 4x4 ordered dither, centred on zero.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

  // The body: light characters, so the features can be the heavy ones.
  const BODY = " .`:-~=+xzn";
  const BODY_TOP = BODY.length - 1;
  const RIM = ":;+*#%";
  const FEATURE = "@#%&8WM";
  const SCATTER = "#%*+=-:znxo01/\\|";

  // Feature codes a shape can return.
  const F_NONE = 0;
  const F_STROKE = 1; // eyes, brows, mouth: heavy bright glyphs
  const F_SOFT = 2; // lids, bags, lips: lighter strokes
  const F_ACCENT = 3; // cheeks, sparks: the palette's accent
  const F_HOLE = 4; // an open mouth: dark
  const F_LINE = 5; // a drawn line; the shape sets out.ch

  // --- the shapes ---------------------------------------------------------------------
  //
  // shape(u, v, s, out) -> height (< 0 is outside). u right, v down, in face radii.
  // s holds the per-frame state (blink, talking, scan...). out.f is a feature code,
  // out.ch a character for F_LINE, out.c a colour override.

  const SUN_R = 0.8;

  const sugar = {
    speed: 1.15,
    bob: 0.9,
    yaw: 0.3,
    light: 1.05,
    height(u, v) {
      const r = Math.sqrt(u * u + v * v) / SUN_R;
      return r < 1 ? Math.sqrt(1 - r * r) : -1;
    },
    shape(u, v, s, out) {
      out.f = F_NONE;
      const h = this.height(u, v);
      if (h < 0) return h;
      // Crinkled happy eyes: upside-down arcs.
      for (const side of [-1, 1]) {
        const cu = side * 0.29;
        const cv = -0.06;
        if (v < cv + 0.02 && ringDist(u, v, cu, cv, 0.14) < 0.055 + 0.03 * s.blink) {
          out.f = F_STROKE;
          return h;
        }
        // blush
        const bu = u - side * 0.5;
        const bv = v - 0.15;
        if (bu * bu + bv * bv * 2.2 < 0.016) {
          out.f = F_ACCENT;
          out.c = "red";
          return h;
        }
      }
      // A wide grin, and an open mouth when talking.
      const open = s.open;
      if (v > 0.12 && ringDist(u, v, 0, -0.02, 0.4) < 0.055 && Math.abs(u) < 0.36) {
        out.f = F_STROKE;
        return h;
      }
      if (open > 0.05) {
        const mu = u / 0.25;
        const mv = (v - 0.3) / (0.03 + 0.1 * open);
        if (mu * mu + mv * mv < 1 && v > 0.22) {
          out.f = F_HOLE;
          return h;
        }
      }
      return h;
    },
    // Rays around the disc, turning slowly, long and short in turn.
    halo(u, v, s, out) {
      const r = Math.sqrt(u * u + v * v);
      if (r < SUN_R * 1.12 || r > SUN_R * 2.1) return false;
      const a = Math.atan2(v, u) + s.tt * 0.05;
      const n = 16;
      const k = Math.floor(((a / (Math.PI * 2)) * n + n * 10) % n);
      const centre = ((k + 0.5) / n) * Math.PI * 2;
      let da = (((a - centre) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      const len = (k % 2 ? 1.5 : 1.95) + 0.12 * Math.sin(s.tt * 1.3 + k);
      const width = 0.11 * (1 - (r - SUN_R) / (SUN_R * (len - 1)));
      if (r > SUN_R * len || Math.abs(da) > width) return false;
      // a dash travelling outward
      const phase = (((r * 9 - s.tt * 3 - k) % 4) + 4) % 4;
      out.ch = Math.abs(da) < width * 0.45 ? rayChar(centre) : ".";
      out.c = phase < 1 ? "bright" : phase < 2.2 ? "fg" : hash2(k, Math.floor(r * 20)) < 0.2 ? "orange" : "dim";
      return true;
    },
  };

  const weary = {
    speed: 0.5,
    bob: 0.45,
    sag: true,
    yaw: 0.16,
    light: 0.85,
    edge(u, v) {
      const a = Math.atan2(v, u);
      return 0.8 * (1 + 0.09 * Math.sin(a * 3 + 0.6) + 0.06 * Math.sin(a * 5 + 2.1) + 0.05 * Math.sin(a * 7 + 0.3));
    },
    height(u, v) {
      if (v > 0.6) return -1; // it sits flat on the ground
      const vv = v < 0 ? v * 1.12 : v * 0.92; // squat
      const r = Math.sqrt(u * u + vv * vv) / this.edge(u, v);
      if (r >= 1) return -1;
      const bumps = 0.12 * (vnoise(u * 4 + 7, v * 4) - 0.5) + 0.05 * (vnoise(u * 11, v * 11 + 3) - 0.5);
      return Math.sqrt(1 - r * r) * 0.9 + bumps;
    },
    shape(u, v, s, out) {
      out.f = F_NONE;
      const h = this.height(u, v);
      if (h < 0) return h;
      // Cracks.
      const c = vnoise(u * 3.2 + 11, v * 3.2 - 4);
      if (Math.abs(c - 0.5) < 0.02 && (u < -0.5 || u > 0.5 || v > 0.42)) {
        out.f = F_LINE;
        out.ch = (u > 0) === (v > 0) ? "\\" : "/";
        out.c = "dim";
        return h;
      }
      // Heavy-lidded eyes; the lids come all the way down for a slow blink.
      for (const side of [-1, 1]) {
        const eu = (u - side * 0.3) / 0.17;
        const ev = (v + 0.06) / 0.1;
        const e2 = eu * eu + ev * ev;
        const lid = -0.1 + 1.1 * s.blink; // in eye radii: where the lid's edge sits
        if (e2 < 1) {
          if (ev < lid) {
            out.f = F_SOFT;
            out.ch = ev > lid - 0.45 ? "=" : "-";
            return h;
          }
          // the pupil sinks to the bottom of the eye
          const pu = eu - s.look * 0.4;
          const pv = ev - 0.55;
          out.f = pu * pu + pv * pv < 0.3 ? F_STROKE : F_HOLE;
          return h;
        }
        // bags under them
        if (ev > 1.1 && ev < 1.9 && Math.abs(eu) < 0.8 && ringDist(eu, ev, 0, 0, 1.5) < 0.22) {
          out.f = F_SOFT;
          out.ch = "~";
          return h;
        }
      }
      // A flat mouth that turns down at the ends, and barely opens.
      const mv = 0.3 + 0.7 * u * u;
      if (Math.abs(u) < 0.24) {
        const open = s.open * 0.04;
        if (Math.abs(v - mv) < 0.032 + open) {
          out.f = open > 0.012 && Math.abs(v - mv) < open ? F_HOLE : F_STROKE;
          return h;
        }
      }
      return h;
    },
    ground: true,
  };

  const CANOPY = [
    [0, -0.3, 0.52],
    [-0.4, -0.12, 0.36],
    [0.4, -0.12, 0.36],
    [-0.24, -0.62, 0.32],
    [0.24, -0.62, 0.32],
    [0, -0.78, 0.26],
  ];

  const clinical = {
    speed: 0.8,
    bob: 0.25,
    yaw: 0.22,
    light: 0.95,
    sway(v, s) {
      return 0.05 * Math.sin(s.tt * 0.7) * clamp01(-v + 0.3);
    },
    height(u, v) {
      let h = -1;
      for (const [cu, cv, r] of CANOPY) {
        const du = u - cu;
        const dv = v - cv;
        const d2 = (du * du + dv * dv) / (r * r);
        if (d2 < 1) h = Math.max(h, Math.sqrt(1 - d2) * (0.6 + r));
      }
      if (h > 0) return h + 0.03 * (vnoise(u * 6, v * 6) - 0.5);
      // the trunk, flaring at the foot
      const w = 0.12 + 0.1 * clamp01((v - 0.62) / 0.3) ** 2;
      if (v > 0.05 && v < 0.94 && Math.abs(u) < w) return Math.sqrt(1 - (u / w) ** 2) * 0.35;
      return -1;
    },
    shape(u, v, s, out) {
      out.f = F_NONE;
      const h = this.height(u, v);
      if (h < 0) return h;
      const canopy = v < 0.08 && h > 0.2;
      if (!canopy) {
        // bark: vertical grain
        if (vnoise(u * 30, v * 3) > 0.72) {
          out.f = F_LINE;
          out.ch = "|";
          out.c = "dim";
        }
        return h;
      }
      // Two ringed eyes with crosshair pupils that scan side to side.
      for (const side of [-1, 1]) {
        const cu = side * 0.22;
        const cv = -0.36;
        const du = u - cu;
        const dv = (v - cv) * 1.05;
        const d = Math.sqrt(du * du + dv * dv);
        if (s.blink > 0.8 && Math.abs(dv) < 0.03 && d < 0.15) {
          out.f = F_LINE;
          out.ch = "-";
          out.c = "bright";
          return h;
        }
        if (s.blink <= 0.8 && Math.abs(d - 0.13) < 0.035) {
          out.f = F_STROKE;
          return h;
        }
        if (d < 0.1 && s.blink <= 0.8) {
          const pu = du - s.look * 0.05;
          if (Math.abs(pu) < 0.018 && Math.abs(dv) < 0.07) {
            out.f = F_LINE;
            out.ch = "|";
            out.c = "bright";
          } else if (Math.abs(dv) < 0.025 && Math.abs(pu) < 0.07) {
            out.f = F_LINE;
            out.ch = "-";
            out.c = "bright";
          } else out.f = F_HOLE;
          return h;
        }
      }
      // A mouth ruled with a straight edge; talking shows a second line.
      if (Math.abs(u) < 0.2) {
        if (Math.abs(v + 0.1) < 0.025) {
          out.f = F_LINE;
          out.ch = s.open > 0.5 && hash2(Math.floor(u * 40), s.tick) < 0.4 ? "=" : "-";
          out.c = "bright";
          return h;
        }
        if (s.open > 0.25 && Math.abs(v + 0.1 - 0.05 * s.open) < 0.02) {
          out.f = F_LINE;
          out.ch = "_";
          out.c = "fg";
          return h;
        }
      }
      // leaves: clumps, picked out by the light
      const leaf = vnoise(u * 7 + 3, v * 7);
      if (leaf > 0.8 && (Math.abs(u) > 0.4 || v < -0.55)) {
        out.f = F_LINE;
        out.ch = leaf > 0.87 ? "*" : "o";
        out.c = null;
      }
      return h;
    },
    ground: true,
    scan: true,
  };

  const PERSONAS = { sugar, weary, clinical };

  function rayChar(angle) {
    const a = ((angle % Math.PI) + Math.PI) % Math.PI; // 0..pi
    if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return "-";
    if (a > (3 * Math.PI) / 8 && a < (5 * Math.PI) / 8) return "|";
    return a < Math.PI / 2 ? "\\" : "/";
  }

  // --- the frame --------------------------------------------------------------------------

  const out = { f: 0, ch: null, c: null };
  const tmp = { f: 0, ch: null, c: null };

  function frame(grid, t, opts) {
    opts = opts || {};
    const p = PERSONAS[opts.personality];
    if (!p) return;
    const region = opts.region || { x: 0, y: 0, w: grid.cols, h: Math.floor(grid.rows * 0.6) };
    const reveal = opts.reveal == null ? 1 : clamp01(opts.reveal);
    const talking = opts.mood === "talking";
    const aspect = grid.cellW && grid.cellH ? grid.cellW / grid.cellH : 0.6;
    const tt = t * p.speed;

    // Size: the face (radius 1) fits the region with room for a halo.
    const R = Math.max(5, Math.min(region.h * 0.5, region.w * aspect * 0.32));

    // Floating; Weary sags and lingers at the bottom.
    let bob = Math.sin(tt * 0.9) * p.bob;
    if (p.sag) bob = p.bob * (Math.abs(Math.sin(tt * 0.5)) * 0.9 - 0.2);
    const cx = region.x + region.w / 2 + Math.sin(tt * 0.31) * 0.6;
    const cy = region.y + region.h / 2 + bob;

    const yaw = p.yaw * Math.sin(tt * 0.37) + 0.04 * Math.sin(tt * 0.93 + 1.3);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // The light drifts around the upper left.
    let lx = -0.5 + 0.4 * Math.sin(tt * 0.23);
    let ly = -0.55 + 0.2 * Math.sin(tt * 0.17 + 0.7);
    let lz = 0.8;
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
    lx /= ll;
    ly /= ll;
    lz /= ll;

    // Per-frame state for the shapes.
    const tick = Math.floor(t * 12);
    const blinkPhase = (t + (opts.personality === "weary" ? 0 : 1.7)) % (opts.personality === "weary" ? 6.5 : 4.3);
    const blinkLen = opts.personality === "weary" ? 0.9 : 0.16;
    let blink = blinkPhase < blinkLen ? Math.sin((blinkPhase / blinkLen) * Math.PI) : 0;
    if (opts.personality === "weary") blink = Math.max(0.42 + 0.08 * Math.sin(t * 0.3), blink); // never fully awake
    let open = 0;
    if (talking) open = (Math.sin(t * 13) * 0.5 + 0.5) * (Math.sin(t * 7.3 + 1) * 0.5 + 0.5);
    // Clinical's crosshairs jump between fixed points; Weary's eyes drift.
    const look =
      opts.personality === "clinical"
        ? [-1, 0, 1, 0, 0.4, -0.6][Math.floor(t / 1.3) % 6]
        : 0.6 * Math.sin(t * 0.21);
    const s = { tt, blink, open, look, tick };

    // Reveal: scattered characters, then a sweep down the face.
    const sweep = reveal >= 1 ? 9 : reveal * 2.6 - 1.2; // in face radii, from the top
    const scatterOdds = reveal >= 1 ? 0 : 0.6 * (1 - reveal * 0.6);

    // Clinical: a thin scanning line passes down the face.
    const scanV = p.scan ? ((t * 0.3) % 2.6) - 1.2 : 99;

    const halfW = (R * 2.2) / aspect;
    const x0 = Math.max(region.x, Math.floor(cx - halfW));
    const x1 = Math.min(region.x + region.w, Math.ceil(cx + halfW));
    const y0 = Math.max(region.y, Math.floor(cy - R * 2.15));
    const y1 = Math.min(region.y + region.h, Math.ceil(cy + R * 1.05));
    const eps = 0.5 / R;

    for (let row = y0; row < y1; row++) {
      const v = (row + 0.5 - cy) / R;
      const by = (row & 3) * 4;
      for (let col = x0; col < x1; col++) {
        const su = ((col + 0.5 - cx) * aspect) / R;
        // inverse yaw: one fixed-point step through the height
        let u = su / cosY;
        const h0 = p.height(u, v);
        if (h0 > 0) u = (su - h0 * 0.3 * sinY) / cosY;
        if (p.sway) u -= p.sway(v, s);

        if (v > sweep) {
          if (scatterOdds > 0 && p.height(u, v) > -0.5 && hash2(col * 31 + tick, row * 17) < scatterOdds * 0.5) {
            const k = hash2(col + tick * 7, row);
            grid.set(col, row, SCATTER[Math.floor(k * SCATTER.length)], k < 0.3 ? "fg" : "dim");
          }
          continue;
        }

        out.ch = null;
        out.c = null;
        const h = p.shape(u, v, s, out);
        if (h < 0) {
          if (p.halo) {
            tmp.ch = null;
            tmp.c = null;
            if (p.halo(su, v, s, tmp)) grid.set(col, row, tmp.ch, tmp.c);
          }
          if (p.ground && Math.abs(v - (opts.personality === "weary" ? 0.6 : 0.94) - 0.04) < 0.5 / R && Math.abs(su) < 1.15) {
            const g = hash2(col, 3) < 0.5 ? "~" : "_";
            grid.set(col, row, g, Math.abs(su) < 0.8 ? "fg" : "dim");
          }
          continue;
        }

        // Shade: normal from the height around this point.
        const hx = p.height(u + eps, v) - p.height(u - eps, v);
        const hy = p.height(u, v + eps) - p.height(u, v - eps);
        let nx = -hx / (2 * eps);
        let ny = -hy / (2 * eps);
        nx = nx > 4 ? 4 : nx < -4 ? -4 : nx;
        ny = ny > 4 ? 4 : ny < -4 ? -4 : ny;
        const nl = Math.sqrt(nx * nx + ny * ny + 1);
        // rotate the normal with the turn
        const rnx = (nx / nl) * cosY + (1 / nl) * sinY;
        const rnz = (-nx / nl) * sinY + (1 / nl) * cosY;
        const d = rnx * lx + (ny / nl) * ly + rnz * lz;
        let b = (0.22 + 0.7 * (d > 0 ? d : 0)) * p.light;
        const n = hash2(col, row);
        const dither = BAYER[by + (col & 3)];

        let ch;
        let color;
        if (Math.abs(v - scanV) < 0.5 / R) {
          ch = n < 0.5 ? "=" : "-";
          color = "teal";
        } else if (out.f === F_STROKE) {
          ch = FEATURE[Math.floor(n * FEATURE.length)];
          color = b > 0.3 ? "bright" : "fg";
        } else if (out.f === F_SOFT) {
          ch = out.ch || "=";
          color = "fg";
        } else if (out.f === F_ACCENT) {
          ch = n < 0.5 ? "*" : "+";
          color = out.c || "orange";
        } else if (out.f === F_HOLE) {
          ch = n < 0.3 ? "." : " ";
          color = "dim";
        } else if (out.f === F_LINE) {
          ch = out.ch;
          color = out.c || (b > 0.6 ? "bright" : "fg");
        } else if (h < 0.22) {
          // the rim: heavier, so the silhouette reads
          ch = RIM[Math.max(0, Math.min(RIM.length - 1, Math.floor(b * RIM.length + dither)))];
          color = b > 0.7 ? "bright" : b > 0.35 ? "fg" : "dim";
        } else {
          let k = Math.floor(b * BODY_TOP * 0.85 + 0.5 + dither);
          k = k < 1 ? 1 : k > BODY_TOP ? BODY_TOP : k;
          ch = BODY[k];
          color = b > 0.75 ? "fg" : "dim";
        }
        if (reveal < 1 && v > sweep - 0.08) {
          ch = n < 0.5 ? "=" : "#";
          color = "bright";
        }
        grid.set(col, row, ch, color);
      }
    }

    // Weary, left alone, nods off.
    if (opts.personality === "weary" && !talking) {
      const zt = t % 7;
      if (zt < 3) {
        for (let k = 0; k < 3; k++) {
          const a = zt - k * 0.6;
          if (a < 0) continue;
          grid.set(cx + (R * 0.95) / aspect + a * 3 + k, cy - R * 0.55 - a * 2.2 - k, k === 2 ? "Z" : "z", a > 2 ? "dim" : "fg");
        }
      }
    }
  }

  Oracle.PERSONAS = PERSONAS;
  Oracle.scenes.persona = { frame };
})();
