/* The boot screen and the hallway: a first-person drift down a tiled corridor,
 * drawn in characters, that glitches apart and flares white at the far end.
 *
 * The hallway is a tiny raycaster into a box corridor. For every cell we cast
 * one ray, find where it hits a wall, the floor or the ceiling, look up the
 * tile pattern there (checkerboard floor and ceiling, diamond tiles on the
 * walls, after reference 01) and shade it by distance with a character ramp
 * (after reference 03). Glitches (after reference 02) come from two places:
 * bands of rows that sample the corridor from a different depth, and
 * Oracle.glitch, a post pass over the finished grid that the face scene can
 * reuse.
 *
 * Exports:
 *   Oracle.scenes.boot    = { frame(grid, t) }
 *   Oracle.scenes.hallway = { duration, frame(grid, t) }
 *   Oracle.glitch(grid, amount, random)
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

  // --- hallway -----------------------------------------------------------------

  const DURATION = 9;
  const HALF_W = 1.1; // corridor half width
  const HALF_H = 1.0; // corridor half height
  const FLOOR_TILE = 0.625; // 4 checker tiles across the floor
  const WALL_TILE = 0.85;
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

  function hallwayFrame(grid, t) {
    const cols = grid.cols;
    const rows = grid.rows;
    const chars = grid.chars;
    const colors = grid.colors;
    ensureBands(rows);

    const flare = smoothstep(DURATION - 1.6, DURATION, t); // the far end turns white
    const late = smoothstep(4.0, DURATION - 0.4, t); // glitch builds toward the end
    const burst = burstAt(t);
    const step = Math.floor(t * 30);

    // Camera: drift forward, speed up near the end, sway and roll a little.
    const extra = Math.max(0, t - 6.5);
    const camZ = 1.1 * t + 0.55 * extra * extra;
    const camX = 0.2 * Math.sin(t * 0.61) + 0.04 * Math.sin(t * 1.9);
    const camY = -0.1 + 0.05 * Math.sin(t * 1.23);
    const roll = 0.045 * Math.sin(t * 0.47 + 0.4) + 0.02 * late * Math.sin(t * 6.1);
    const yaw = 0.06 * Math.sin(t * 0.37 + 1.0);
    const pitch = 0.035 * Math.sin(t * 0.29 + 2.0);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);

    // Fog: far things fade into the blue. During the flare the far end turns
    // white and a glow grows out of the vanishing point until it fills the screen.
    const fogK = 0.26;
    const fogLevel = 0.02 + flare * 0.55;
    const glowStrength = 0.55 + flare * 1.6;
    const glowWidth = 0.0012 + flare * flare * flare * 2.4; // in (tan of angle) squared

    // Geometric tears: bands of rows that sample the corridor from another depth
    // and slide sideways. Held for a few frames so the eye can catch them.
    bandDepth.fill(0);
    bandShift.fill(0);
    const tearAmount = 0.05 + 0.45 * late + 0.6 * burst;
    const tearRandom = makeRng(Math.floor(t * 10) * 7919 + 17);
    const tears = Math.floor(tearAmount * (1 + tearRandom() * 6));
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

        const tw = dx > 0 ? (HALF_W - camX) / dx : dx < 0 ? (-HALF_W - camX) / dx : 1e9;
        const th = dy > 0 ? (HALF_H - camY) / dy : dy < 0 ? (-HALF_H - camY) / dy : 1e9;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

        let v; // surface brightness, 0..1
        let lineCh = null; // a drawn tile edge or corner seam, when close enough to see it
        let seam = false;
        let wall;
        let dist;
        if (tw < th) {
          // Wall: diamond tiles, u along the corridor, v up the wall.
          wall = true;
          dist = tw * len;
          const hy = camY + dy * tw;
          const u = (rowZ + dz * tw) / WALL_TILE;
          const w = (hy + 7) / WALL_TILE;
          const fu = u - Math.floor(u) - 0.5;
          const fv = w - Math.floor(w) - 0.5;
          const d = Math.abs(fu) + Math.abs(fv); // 0 at the centre, 0.5 on the diamond's edge
          // How many tiles fit in one cell here (walls are seen at a grazing angle).
          const grazing = (dist * dist * pixAngle) / (HALF_W + 0.3) / WALL_TILE;
          // Each diamond is split into a lit and a shaded half, like quilted tiles,
          // and outlined: the outline is what reads at this resolution.
          const lit = fu * fv > 0;
          if (d < 0.5) v = d < 0.12 ? 0.85 : lit ? 0.42 : 0.2;
          else v = lit ? 0.14 : 0.04;
          const px = (dx < 0 ? -HALF_W : HALF_W) - camX; // hit point, relative to the camera
          const py = hy - camY;
          const pz = dz * tw;
          if (grazing < 0.3 && Math.abs(d - 0.5) < 0.06 + grazing * 0.1) {
            // Diamond edges run at 45 degrees on the wall: (0, s, 1) in the world.
            lineCh = lineChar(-px / pz, (lit ? -1 : 1) - py / pz);
          }
          const aa = clamp01((grazing - 0.2) / 0.6);
          v += (0.22 - v) * aa;
          // The seam where the wall meets the floor or ceiling, running along z.
          if (HALF_H - Math.abs(hy) < dist * pixAngle * 0.9) {
            seam = true;
            lineCh = lineChar(-px, -py);
          }
        } else {
          // Floor or ceiling: checkerboard.
          wall = false;
          dist = th * len;
          const hx = camX + dx * th;
          const px = hx / FLOOR_TILE;
          const pz = (rowZ + dz * th) / FLOOR_TILE;
          const light = ((Math.floor(px) + Math.floor(pz)) & 1) === 0;
          const grazing = (dist * dist * pixAngle) / (HALF_H + 0.1) / FLOOR_TILE;
          v = light ? 1.0 : 0.04;
          const aa = clamp01((grazing - 0.3) / 0.7);
          v += (0.32 - v) * aa;
          if (HALF_W - Math.abs(hx) < dist * pixAngle * 0.5) {
            seam = true;
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
        if (lineCh !== null && (seam ? fog > 0.12 : fog > 0.5)) {
          chars[i] = lineCh;
          colors[i] = seam ? (fog > 0.4 ? "bright" : "fg") : fog > 0.7 ? "fg" : "dim";
          continue;
        }
        let k = Math.floor(b * RAMP_TOP + 0.5 + dither * 0.9);
        if (k < 0) k = 0;
        else if (k > RAMP_TOP) k = RAMP_TOP;
        chars[i] = RAMP[k];
        colors[i] = torn && k > 6 ? "bright" : wall ? (b > 0.7 ? "fg" : "dim") : b > 0.3 ? "fg" : "dim";
      }
    }

    // Post pass: tears, corrupted characters, the odd accent colour.
    const amount = (0.04 + 0.5 * late + 0.45 * burst) * (1 - 0.6 * flare * flare);
    glitch(grid, amount, makeRng(step * 40503 + 99991));
  }

  Oracle.glitch = glitch;
  Oracle.scenes.hallway = { duration: DURATION, frame: hallwayFrame };
})();
