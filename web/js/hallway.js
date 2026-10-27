/* The boot screen and the hallway: a first-person drift down a corridor, drawn
 * in characters, that decays as you go and flares white at the far end.
 *
 * The hallway is a tiny raycaster into a corridor that won't hold still: it
 * bends, its walls bulge and lean and the floor sags (smooth noise along its
 * length), and its tiles are worn into blotches. For every cell we cast one ray,
 * find the wall, floor or ceiling it hits, and shade it by distance with a
 * character ramp (after reference 03). Then the tape degrades it: bands of rows
 * sampled from another depth, Oracle.glitch's tears and corrupted characters,
 * blocks torn out and tagged with running numbers (the glitch tracking collage),
 * static creeping in from the edges, and every row wobbling sideways like bad
 * VHS tracking. The face scene reuses the last three.
 *
 * Exports:
 *   Oracle.scenes.boot    = { frame(grid, t) }
 *   Oracle.scenes.hallway = { duration, frame(grid, t) }
 *   Oracle.glitch(grid, amount, random)
 *   Oracle.edgeNoise(grid, amount, t, random)
 *   Oracle.vhs(grid, t, amount, random)
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  Oracle.scenes = Oracle.scenes || {};

  // --- shared bits -------------------------------------------------------------

  // Dark to light, the poster's mix of characters.
  const RAMP = " .:-=+*xzn#%";
  const RAMP_TOP = RAMP.length - 1;
  // Beyond the top of the ramp, for the white flare at the end.
  const FLARE = "%░▒▓█";
  const GLITCH_CHARS = "#%&$@!?/\\|<>[]{}=+*xzn01_~^";
  const BAR_CHARS = "▀▄█▬■=";
  const ACCENTS = ["red", "orange", "teal"];

  // 4x4 ordered dither, centred on zero, so gradients break up into texture.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function smoothstep(a, b, v) {
    const x = clamp01((v - a) / (b - a));
    return x * x * (3 - 2 * x);
  }

  function makeRng(seed) {
    if (Oracle.rng) return Oracle.rng(seed);
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  // Buffers reused between frames, so nothing is allocated per cell.
  let rowChars = [];
  let rowColors = [];
  let bandDepth = new Float32Array(0);
  let bandShift = new Float32Array(0);

  function ensureRowBuffer(cols) {
    if (rowChars.length < cols) {
      rowChars = new Array(cols).fill(" ");
      rowColors = new Array(cols).fill("fg");
    }
  }

  function ensureBands(rows) {
    if (bandDepth.length !== rows) {
      bandDepth = new Float32Array(rows);
      bandShift = new Float32Array(rows);
    }
  }

  /* The character that best draws a line with this direction on screen
   * (x right, y up, in the same units both ways). Cells are 0.6 wide by 1 tall,
   * so '/' and '\\' sit near 59 degrees, not 45. */
  function lineChar(sdx, sdy) {
    const ax = sdx < 0 ? -sdx : sdx;
    const ay = sdy < 0 ? -sdy : sdy;
    if (ay < ax * 0.42) return "-";
    if (ay > ax * 3.7) return "|";
    return (sdx > 0) === (sdy > 0) ? "/" : "\\";
  }

  // --- glitch ------------------------------------------------------------------

  /* Tear and corrupt whatever is already in the grid. amount is 0..1. */
  function glitch(grid, amount, random) {
    random = random || Math.random;
    if (!(amount > 0)) return;
    if (amount > 1) amount = 1;
    const cols = grid.cols;
    const rows = grid.rows;
    const chars = grid.chars;
    const colors = grid.colors;
    const n = cols * rows;
    ensureRowBuffer(cols);

    // 1. Horizontal band tears: a few rows slide sideways, some smear or drop out.
    const bands = Math.floor(amount * 3 + random() * (1 + amount * 9));
    for (let b = 0; b < bands; b++) {
      const y0 = Math.floor(random() * rows);
      const h = 1 + Math.floor(random() * (1 + amount * 4));
      const shift = Math.round((random() * 2 - 1) * (2 + amount * cols * 0.22));
      const kind = random();
      for (let y = y0; y < y0 + h && y < rows; y++) {
        const base = y * cols;
        if (kind < 0.7) {
          // Slide the row, wrapping around.
          for (let x = 0; x < cols; x++) {
            rowChars[x] = chars[base + x];
            rowColors[x] = colors[base + x];
          }
          for (let x = 0; x < cols; x++) {
            let sx = (x - shift) % cols;
            if (sx < 0) sx += cols;
            chars[base + x] = rowChars[sx];
            colors[base + x] = rowColors[sx];
          }
        } else if (kind < 0.88 && y0 > 0) {
          // Smear: repeat the row above the band, shifted.
          const src = (y0 - 1) * cols;
          for (let x = 0; x < cols; x++) {
            let sx = (x - shift) % cols;
            if (sx < 0) sx += cols;
            chars[base + x] = chars[src + sx];
            colors[base + x] = "dim";
          }
        } else {
          // Dropout: a run of the row goes blank.
          const x0 = Math.floor(random() * cols);
          const len = Math.floor(cols * (0.1 + random() * 0.5));
          for (let x = x0; x < x0 + len && x < cols; x++) chars[base + x] = " ";
        }
      }
    }

    // 2. Corrupted characters, mostly where something is already drawn.
    const corrupt = Math.floor(n * amount * amount * 0.05 + random() * amount * 30);
    for (let k = 0; k < corrupt; k++) {
      const i = Math.floor(random() * n);
      if (chars[i] === " " && random() < 0.85) continue;
      chars[i] = GLITCH_CHARS[Math.floor(random() * GLITCH_CHARS.length)];
      const r = random();
      colors[i] = r < 0.06 * (0.3 + amount) ? ACCENTS[Math.floor(random() * 3)] : r < 0.5 ? "bright" : "dim";
    }

    // 3. Short coloured bars, like the album cover's fragments. Sparse.
    const bars = Math.floor(random() * (0.5 + amount * 7));
    for (let b = 0; b < bars; b++) {
      const y = Math.floor(random() * rows);
      const x0 = Math.floor(random() * cols);
      const len = 2 + Math.floor(random() * (3 + amount * 16));
      const color = ACCENTS[Math.floor(random() * 3)];
      const ch = BAR_CHARS[Math.floor(random() * BAR_CHARS.length)];
      const base = y * cols;
      for (let x = x0; x < x0 + len && x < cols; x++) {
        if (random() < 0.15) continue;
        chars[base + x] = ch;
        colors[base + x] = color;
      }
    }
  }

  // --- boot screen -------------------------------------------------------------

  const PROMPT = ">press_enter_to_start";

  function bootFrame(grid, t) {
    const cols = grid.cols;
    const rows = grid.rows;
    const step = Math.floor(t * 30);
    const random = makeRng(step * 2654435761 + 12345);

    // A little static.
    const specks = Math.floor(cols * rows * 0.0025);
    for (let k = 0; k < specks; k++) {
      const x = Math.floor(random() * cols);
      const y = Math.floor(random() * rows);
      grid.set(x, y, random() < 0.75 ? "." : ":", "dim");
    }

    const x0 = Math.floor((cols - PROMPT.length - 1) / 2);
    const y0 = Math.floor(rows / 2);
    // Now and then the prompt line jitters by a cell, like a weak signal.
    const jitter = random() < 0.035 ? (random() < 0.5 ? -1 : 1) : 0;
    grid.text(x0 + jitter, y0, PROMPT, "fg");
    if (t % 1 < 0.55) grid.set(x0 + jitter + PROMPT.length, y0, "█", "bright");
  }

  Oracle.scenes.boot = { frame: bootFrame };

  // --- noise ---------------------------------------------------------------------

  function hashInt(i, seed) {
    let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* Smooth 1D value noise, -1..1. */
  function noise1(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return (hashInt(i, seed) * (1 - u) + hashInt(i + 1, seed) * u) * 2 - 1;
  }

  /* Smooth 2D value noise, 0..1. */
  function noise2(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const s0 = Math.imul(iy, 57) + seed;
    const s1 = s0 + 57;
    const a = hashInt(ix, s0);
    const b = hashInt(ix + 1, s0);
    const c = hashInt(ix, s1);
    const d = hashInt(ix + 1, s1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  // --- VHS: tracking wobble and static creeping in from the edges ------------------

  const STATIC = " .`',:;-~^\"*░▒";

  /* Make rows wobble sideways like a tape with bad tracking (grid.rowShift, in
   * fractions of a cell, drawn by grid.render), with a band of worse tracking
   * that rolls slowly down the screen. amount is 0..1. */
  function vhs(grid, t, amount, random) {
    if (!(amount > 0)) return;
    random = random || Math.random;
    const rows = grid.rows;
    const cols = grid.cols;
    const shift = grid.rowShift;
    if (!shift) return;
    const bandY = ((t * 0.09) % 1.5 - 0.25) * rows;
    const bandH = 2 + amount * 5;
    for (let y = 0; y < rows; y++) {
      let s = amount * (0.45 * Math.sin(y * 0.19 + t * 2.1) + 0.25 * Math.sin(y * 0.047 - t * 0.8));
      s += (random() - 0.5) * 0.25 * amount;
      const d = (y - bandY) / bandH;
      if (d > -1 && d < 1) {
        const k = 1 - d * d;
        s += k * amount * (2.5 + 2 * noise1(t * 7 + y * 0.6, 5));
        // the band chews up the picture a little
        const base = y * cols;
        const bites = Math.floor(k * amount * cols * 0.08);
        for (let b = 0; b < bites; b++) {
          const i = base + Math.floor(random() * cols);
          grid.chars[i] = STATIC[1 + Math.floor(random() * 6)];
          grid.colors[i] = "dim";
        }
      }
      shift[y] += s;
    }
  }

  /* Static that creeps in from the edges of the screen. amount is 0..1, how far in
   * it reaches (as a share of the way to the centre); its front is ragged and
   * drifts, and it is thickest at the edge. Mostly dim, a few cold specks, like
   * the blue noise around the tracking collage. */
  function edgeNoise(grid, amount, t, random) {
    if (!(amount > 0)) return;
    random = random || Math.random;
    const cols = grid.cols;
    const rows = grid.rows;
    const chars = grid.chars;
    const colors = grid.colors;
    const hx = cols / 2;
    const hy = rows / 2;
    for (let y = 0; y < rows; y++) {
      const ey = Math.min(y + 0.5, rows - y - 0.5) / hy;
      const base = y * cols;
      for (let x = 0; x < cols; x++) {
        const ex = Math.min(x + 0.5, cols - x - 0.5) / hx;
        // corners go first; the sides follow
        const e = Math.min(ex * 1.15, ey, Math.sqrt(ex * ey) * 1.05);
        if (e > amount) continue;
        const reach = amount * (0.45 + 0.75 * noise2(x * 0.07 + t * 0.35, y * 0.16 - t * 0.22, 77));
        if (e >= reach) continue;
        const k = 1 - e / reach; // 1 at the edge, 0 at the front
        const i = base + x;
        if (random() > k * 0.9 + 0.08) {
          // near the front, only dim what is there
          if (chars[i] !== " ") colors[i] = "dim";
          continue;
        }
        const r = random();
        chars[i] = STATIC[Math.floor(Math.min(0.999, r * (0.4 + k * 0.7)) * STATIC.length)];
        const c = random();
        colors[i] = c < 0.05 ? "teal" : c < 0.08 ? "bright" : c < 0.09 ? "red" : k > 0.6 && c < 0.45 ? "fg" : "dim";
      }
    }
  }

  /* Torn-out blocks of the picture, each tagged with a running number, after the
   * glitch tracking collage. slot changes a few times a second, so a block holds
   * still long enough to read and the numbers keep counting up. */
  function tagBlocks(grid, count, slot) {
    const random = makeRng(slot * 6151 + 3);
    const cols = grid.cols;
    const rows = grid.rows;
    const chars = grid.chars;
    const colors = grid.colors;
    for (let k = 0; k < count; k++) {
      const w = 5 + Math.floor(random() * 11);
      const h = 2 + Math.floor(random() * 3);
      const x0 = Math.floor(random() * (cols - w));
      const y0 = Math.floor(random() * (rows - h));
      const sx = Math.round((random() * 2 - 1) * 9);
      const sy = Math.round((random() * 2 - 1) * 4);
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          const fx = x + sx;
          const fy = y + sy;
          if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) continue;
          const i = y * cols + x;
          chars[i] = chars[fy * cols + fx];
          colors[i] = colors[fy * cols + fx] === "dim" ? "fg" : "bright";
        }
      }
      grid.text(x0, y0, String(52957 + slot * 4 + k), k % 2 ? "teal" : "orange");
    }
  }

  // --- hallway -----------------------------------------------------------------

  /* A first-person drift down a corridor that won't hold still. The corridor
   * bends, its walls bulge and lean, the floor sags, and the tiles are worn into
   * blotches, so it reads as a place half remembered rather than a grid. The rows
   * wobble like a tape with bad tracking, and static creeps in from the edges
   * until the light at the far end takes over. */

  const DURATION = 9;
  const HALF_W = 1.1; // corridor half width, before it bulges
  const HALF_H = 1.0; // corridor half height
  const FLOOR_TILE = 0.7;
  const FOCAL = 0.8;

  // Short bursts of heavier glitch, at fixed times so every visit feels the same.
  const BURSTS = [
    [1.55, 0.12],
    [2.9, 0.1],
    [4.05, 0.16],
    [5.2, 0.14],
    [6.0, 0.2],
    [6.7, 0.12],
    [7.15, 0.22],
    [7.7, 0.18],
  ];

  function burstAt(t) {
    let b = 0;
    for (let i = 0; i < BURSTS.length; i++) {
      const d = (t - BURSTS[i][0]) / BURSTS[i][1];
      if (d > -1 && d < 1) b = Math.max(b, 1 - d * d);
    }
    return b;
  }

  // The corridor's shape along its length (z).
  function centreAt(z) {
    return 0.8 * noise1(z * 0.27, 11) + 0.18 * noise1(z * 0.7, 12);
  }
  function wallAt(z, y, side) {
    // side is +1 (right) or -1 (left); y lets the wall lean and bulge
    const seed = side > 0 ? 21 : 23;
    return centreAt(z) + side * HALF_W * (1 + 0.28 * noise1(z * 0.6, seed) + 0.1 * noise1(z * 1.9 + y * 1.4, seed + 1));
  }
  function side0(dx) {
    return dx > 0 ? 1 : 0;
  }
  function floorAt(z, x) {
    return -HALF_H * (1 + 0.14 * noise1(z * 0.5, 31) + 0.05 * noise1(z * 1.7 + x * 2.1, 33));
  }
  function ceilAt(z) {
    return HALF_H * (1 + 0.12 * noise1(z * 0.45, 32));
  }

  function hallwayFrame(grid, t) {
    const cols = grid.cols;
    const rows = grid.rows;
    const chars = grid.chars;
    const colors = grid.colors;
    ensureBands(rows);

    const flare = smoothstep(DURATION - 1.6, DURATION, t); // the far end turns white
    const late = smoothstep(3.0, DURATION - 0.4, t); // the decay builds toward the end
    const burst = burstAt(t);
    const step = Math.floor(t * 30);

    // Camera: drift forward, speed up near the end, follow the bends, sway and roll.
    const extra = Math.max(0, t - 6.5);
    const camZ = 1.1 * t + 0.55 * extra * extra;
    const camX = centreAt(camZ + 0.6) * 0.85 + 0.12 * Math.sin(t * 0.61) + 0.04 * Math.sin(t * 1.9);
    const camY = -0.1 + 0.06 * Math.sin(t * 1.23);
    const roll = 0.06 * Math.sin(t * 0.47 + 0.4) + 0.03 * late * Math.sin(t * 6.1);
    // look a little into the bend ahead
    const yaw = 0.5 * (centreAt(camZ + 2.5) - centreAt(camZ)) + 0.05 * Math.sin(t * 0.37 + 1.0);
    const pitch = 0.04 * Math.sin(t * 0.29 + 2.0);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);

    // Fog: far things fade into the dark. During the flare the far end turns
    // white and a glow grows out of the vanishing point until it fills the screen.
    const fogK = 0.3;
    const fogLevel = 0.02 + flare * 0.55;
    const glowStrength = 0.5 + flare * 1.6;
    const glowWidth = 0.0016 + flare * flare * flare * 2.4; // in (tan of angle) squared

    // Geometric tears: bands of rows that sample the corridor from another depth
    // and slide sideways. Held for a few frames so the eye can catch them.
    bandDepth.fill(0);
    bandShift.fill(0);
    const tearAmount = 0.04 + 0.35 * late + 0.6 * burst;
    const tearRandom = makeRng(Math.floor(t * 10) * 7919 + 17);
    const tears = Math.floor(tearAmount * (1 + tearRandom() * 5));
    for (let k = 0; k < tears; k++) {
      const y0 = Math.floor(tearRandom() * rows);
      const h = 1 + Math.floor(tearRandom() * (2 + 6 * tearAmount));
      const dz = (tearRandom() * 2 - 1) * (0.5 + 3 * tearAmount);
      const dx = Math.round((tearRandom() * 2 - 1) * (1 + 14 * tearAmount));
      for (let y = y0; y < y0 + h && y < rows; y++) {
        bandDepth[y] = dz;
        bandShift[y] = dx;
      }
    }

    const cellAspect = grid.cellW && grid.cellH ? grid.cellW / grid.cellH : 0.6;
    const halfRows = rows / 2;
    const halfCols = cols / 2;
    const sxScale = cellAspect / halfRows;
    const syScale = 1 / halfRows;
    const pixAngle = syScale / FOCAL; // angular size of one cell, roughly
    const drift = t * 0.15; // the stains crawl, slowly

    for (let y = 0; y < rows; y++) {
      const sy = (halfRows - y - 0.5) * syScale;
      const rowZ = camZ + bandDepth[y];
      const shift = bandShift[y];
      const torn = bandDepth[y] !== 0;
      const base = y * cols;
      const by = (y & 3) * 4;
      for (let x = 0; x < cols; x++) {
        const sx = (x + 0.5 + shift - halfCols) * sxScale;
        // Roll the screen, then pitch and yaw the ray.
        const rx = sx * cr - sy * sr;
        const ry = sx * sr + sy * cr + pitch * FOCAL;
        const dx = rx * cyw + FOCAL * syw;
        const dz = FOCAL * cyw - rx * syw;
        const dy = ry;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Walls and floor are uneven, so the hit is found by a few fixed-point
        // steps: guess a distance, look up the surface there, aim again.
        let tw = 1e9;
        if (dx !== 0) {
          const side = dx > 0 ? 1 : -1;
          tw = (centreAt(rowZ) + side * HALF_W - camX) / dx;
          for (let k = 0; k < 2; k++) {
            if (!(tw > 0)) break;
            const w = wallAt(rowZ + dz * tw, camY + dy * tw, side);
            tw = (w - camX) / dx;
          }
          if (!(tw > 0)) tw = 1e9;
        }
        let th = 1e9;
        if (dy !== 0) {
          th = ((dy > 0 ? HALF_H : -HALF_H) - camY) / dy;
          for (let k = 0; k < 1; k++) {
            if (!(th > 0)) break;
            const z = rowZ + dz * th;
            const h = dy > 0 ? ceilAt(z) : floorAt(z, camX + dx * th);
            th = (h - camY) / dy;
          }
          if (!(th > 0)) th = 1e9;
        }

        let v; // surface brightness, 0..1
        let lineCh = null; // the wobbly seam where wall meets floor or ceiling
        let wall;
        let dist;
        if (tw < th) {
          // Wall: worn plaster, with the ghost of tiles warped out of line.
          wall = true;
          dist = tw * len;
          const hz = rowZ + dz * tw;
          const hy = camY + dy * tw;
          const warp = 0.35 * noise2(hz * 0.9, hy * 0.9 + drift, 41);
          const u = hz / 0.85 + warp;
          const w = (hy + 7) / 0.85 + warp * 0.7;
          const fu = u - Math.floor(u) - 0.5;
          const fv = w - Math.floor(w) - 0.5;
          const tile = Math.abs(fu) + Math.abs(fv) < 0.42 ? 0.16 : 0;
          const blotch = 0.7 * noise2(hz * 1.6, hy * 2.2 - drift, 43) + 0.3 * noise2(hz * 5, hy * 6, 45);
          v = 0.12 + 0.42 * blotch + tile * (0.4 + blotch) - 0.22 * smoothstep(0.6, 0.85, warp * 2.6);
          const grazing = (dist * dist * pixAngle) / (HALF_W + 0.3);
          v += (0.24 - v) * clamp01((grazing - 0.3) / 0.8);
          const ceil = ceilAt(hz);
          const floor = floorAt(hz, camX + dx * tw);
          const toEdge = Math.min(ceil - hy, hy - floor);
          // the seams are broken in places, so the corridor's edges don't rule the picture
          if (toEdge < dist * pixAngle * 0.9 && noise2(hz * 1.3, side0(dx), 61) > 0.38) {
            const px = camX + dx * tw - camX;
            lineCh = lineChar(-px, -(hy - camY));
          }
        } else {
          // Floor or ceiling: a checkerboard worn nearly away, warped and smudged.
          wall = false;
          dist = th * len;
          const hx = camX + dx * th;
          const hz = rowZ + dz * th;
          const warp = 0.45 * noise2(hx * 0.8, hz * 0.5 + drift, 51);
          const px = (hx + warp) / FLOOR_TILE;
          const pz = (hz + warp) / FLOOR_TILE;
          const light = ((Math.floor(px) + Math.floor(pz)) & 1) === 0;
          const smudge = noise2(hx * 1.4 + 3, hz * 1.1, 53);
          const ceiling = dy > 0;
          v = (light ? 0.62 : 0.1) * (0.35 + 0.65 * smudge) + (ceiling ? -0.06 : 0.04);
          const grazing = (dist * dist * pixAngle) / (HALF_H + 0.1) / FLOOR_TILE;
          v += (0.26 - v) * clamp01((grazing - 0.3) / 0.7);
          if (Math.abs(hx - centreAt(hz)) > HALF_W * 0.6) {
            const wl = wallAt(hz, -HALF_H, -1);
            const wr = wallAt(hz, -HALF_H, 1);
            if (Math.min(hx - wl, wr - hx) < dist * pixAngle * 0.5 && noise2(hz * 1.3, hx > 0 ? 1 : 0, 61) > 0.38)
              lineCh = lineChar(camX - hx, -dy * th);
          }
        }

        const fog = Math.exp(-Math.max(0, dist - 1.2) * fogK);
        let b = v * fog + fogLevel * (1 - fog);
        // Light at the end of the corridor: a glow around the vanishing direction.
        const r2 = (dx * dx + dy * dy) / (dz * dz);
        b += glowStrength * Math.exp(-r2 / glowWidth);
        const i = base + x;
        const dither = BAYER[by + (x & 3)];

        if (b > 0.9 && flare > 0) {
          // Into the light: past '%' into solid blocks.
          let f = Math.floor((b - 0.9) * 3.2 + 0.5 + dither);
          if (f < 0) f = 0;
          else if (f > FLARE.length - 1) f = FLARE.length - 1;
          chars[i] = FLARE[f];
          colors[i] = "bright";
          continue;
        }
        if (lineCh !== null && fog > 0.15) {
          chars[i] = lineCh;
          colors[i] = fog > 0.6 ? "bright" : fog > 0.3 ? "fg" : "dim";
          continue;
        }
        let k = Math.floor(b * RAMP_TOP + 0.5 + dither * 1.1);
        if (k < 0) k = 0;
        else if (k > RAMP_TOP) k = RAMP_TOP;
        chars[i] = RAMP[k];
        colors[i] = torn && k > 6 ? "bright" : wall ? (b > 0.6 ? "fg" : "dim") : b > 0.35 ? "fg" : "dim";
      }
    }

    // Post passes: tears and corrupted characters, the collage's tagged blocks,
    // static creeping in from the edges, and the tracking wobble.
    const fade = 1 - 0.6 * flare * flare;
    const amount = (0.04 + 0.45 * late + 0.45 * burst) * fade;
    const random = makeRng(step * 40503 + 99991);
    glitch(grid, amount, random);
    const tags = Math.floor((burst * 3 + late * 1.5) * fade * random());
    if (tags > 0) tagBlocks(grid, tags, Math.floor(t * 6));
    // The clean demo look keeps the edges calm: a quarter of the static and wobble.
    const calm = window.ORACLE_LOOK === "clean" ? 0.25 : 1;
    edgeNoise(grid, (0.12 + 0.75 * late + 0.15 * burst) * (1 - flare) * calm, t, random);
    vhs(grid, t, (0.35 + 0.5 * late + 0.8 * burst) * calm, random);
  }

  Oracle.glitch = glitch;
  Oracle.vhs = vhs;
  Oracle.edgeNoise = edgeNoise;
  Oracle.scenes.hallway = { duration: DURATION, frame: hallwayFrame };
})();
