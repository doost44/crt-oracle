/* The console look (talk-console.html, readout-console.html): an old computer's
 * plain console text, blue on a white tube, with a strange digital space showing
 * through it in tiny characters.
 *
 * Over each page lies a field of tiny glyphs, on a canvas above the page's own
 * text. Patches open in it, most of them mirrored across the middle of the screen:
 * odd glyphs, runs of words and hex, box-drawn tables, hatching, flat blocks of
 * blue and lime, bars, shards, streaks running down, rows torn sideways. Each lives
 * a few seconds and is replaced, so the screen drifts by itself, over a minute or
 * so, between nearly clean and nearly gone, and back. The visit pushes it further:
 * each answer wears it down, a mask switch or a command jolts it, and a new visitor
 * brings it back clean. The start screen's title is drawn in the field too, in
 * dense tiny glyphs, and letters of the page's text turn into odd ones now and then.
 * (The start screen's menu and its arrow keys are menu.js.)
 *
 * It stands in for signal.js on these pages, with the same calls, so talk.js and
 * readout.js treat both looks alike:
 *
 *   Oracle.signal.post(canvas, now);   // once a frame: the field moves on
 *   Oracle.signal.kick({ strength });  // a jolt
 *   Oracle.signal.wear(0.5);           // at least this broken now (0..1)
 *   Oracle.signal.reset();             // a new visitor: clean again
 *   Oracle.signal.garble(str);         // text drawn on a canvas, with its letters turning
 *
 * ?decay=0.8 starts that broken (to preview the end); Alt+D steps it up by a fifth.
 * The field is made of random characters, redrawn; nothing is kept or sent.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // White, the blues of the text, and the lime of a highlighter. Each mask adds one
  // colour of its own, sparingly.
  const INK = "#1414e6";
  const NAVY = "#0b0f7a";
  const DEEP = "#2b2fd0";
  const PERI = "#8e98dc";
  const LAV = "#b4aee6";
  const PALE = "#cfd3f6";
  const LIME = "#cdf25a";
  const WHITE = "#ffffff";
  const ACCENT = { neutral: LAV, sugar: "#e8792e", weary: "#7fb88a", clinical: "#2bb5c9" };

  const STRANGE = "▖▗▘▝▚▞▙▛▜▟▀▄▌▐░▒▓╱╲╳┼╋╬═║╔╗╚╝▤▥▦▧▨▩◢◣◤◥◆◇○◌◍◐◑⁘⁙⁖∴∵≡≣⌇⌗⍁⍂⍉⍟⎔⠿⡇⢸⣿⡿⢿⣤⣀⠛";
  const MAZE = "┘└┐┌╧╤╟╢╚╝╔╗╠╣╦╩═║╙╜╓╖╘╛╒╕┴┬├┤";
  const MIRROR = {};
  for (const pair of ["◢◣", "◤◥", "╱╲", "▌▐", "▖▗", "▘▝", "▛▜", "▙▟", "▚▞", "▧▨", "╔╗", "╚╝", "◐◑", "⡇⢸", "┘└", "┐┌", "├┤", "╟╢", "╠╣", "╙╜", "╓╖", "╘╛", "╒╕", "[]", "()", "{}", "<>", "/\\", "⡿⢿"]) {
    MIRROR[pair[0]] = pair[1];
    MIRROR[pair[1]] = pair[0];
  }
  const WORDS = ["null", "none", "fill", "time", "void", "self", "echo", "mask", "you"];
  const LABELS = ["SUN", "ROCK", "TREE", "EYE", "VOID", "SELF", "ECHO", "HERE", "NOWHERE"];
  // What the page's letters turn into: characters the console font has, so a line
  // keeps its width while they are swapped.
  const SWAPS = "¤§¦¬±×÷Þþðµ¶¿¡°#%&@$*=<>^~|/\\{}[]";

  const GLYPH_FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Lucida Console", monospace';
  const FIELD_ROWS = 100; // about 100 rows of tiny glyphs on any screen
  const TICK_MS = 66; // the field changes about 15 times a second, like an old machine

  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function random(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }
  const R = random((Math.random() * 4294967295) >>> 0);
  const pick = (r, s) => s[Math.floor(r() * s.length)];

  const state = {
    born: performance.now(),
    floor: 0,
    mood: null,
    burst: { start: -1e9, len: 0, strength: 0 },
    nextIdle: performance.now() + 5000,
    patches: [],
    lastTick: -1e9,
    force: false,
    k: 0,
  };
  const fromURL = parseFloat(new URLSearchParams(location.search).get("decay"));
  if (fromURL >= 0) state.floor = Math.min(1, fromURL);

  // --- how broken: wandering by itself, worn down by the visit ----------------------

  /* 0..1, slow and smooth: three slow waves, starting near clean. */
  function wander(now) {
    const t = (now - state.born) / 1000;
    const TAU = Math.PI * 2;
    const w = 0.5 + 0.36 * Math.sin((TAU * t) / 83 - Math.PI / 2) + 0.18 * Math.sin((TAU * t) / 37 + 0.6) + 0.05 * Math.sin((TAU * t) / 11);
    return Math.pow(Math.min(1, Math.max(0, w)), 1.5);
  }

  function burstLevel(now) {
    const b = state.burst;
    const p = (now - b.start) / b.len;
    if (p < 0 || p > 1) return 0;
    return b.strength * Math.pow(1 - p, 0.6) * (reduced ? 0.3 : 1);
  }

  /* How much of the strange space shows through, 0..1. */
  function level(now) {
    const d = state.floor * 0.85;
    return Math.min(1, d + (1 - d) * wander(now) * 0.85 + burstLevel(now) * 0.35);
  }

  function wear(v) {
    state.floor = Math.min(1, Math.max(state.floor, v));
  }

  function reset() {
    state.born = performance.now();
    state.floor = fromURL >= 0 ? Math.min(1, fromURL) : 0;
    state.patches = [];
    restoreLetters();
    kick({ strength: 0.7, ms: 500 });
  }

  function kick(opts) {
    opts = opts || {};
    const strength = opts.strength == null ? 1 : opts.strength;
    const now = performance.now();
    if (burstLevel(now) > strength) return;
    Object.assign(state.burst, { start: now, len: opts.ms || 650, strength });
    state.jolt = strength;
    state.force = true;
  }

  function colours() {
    const id = state.mood || document.documentElement.dataset.theme || "neutral";
    const a = ACCENT[id] || ACCENT.neutral;
    return { soft: [PERI, LAV, PALE, PERI, LAV, PALE, a], hard: [INK, NAVY, DEEP, INK, INK, a, NAVY] };
  }

  // --- the field -------------------------------------------------------------------------

  let F = null;
  function setup() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const canvas = (F && F.canvas) || document.createElement("canvas");
    if (!canvas.parentNode) {
      canvas.className = "glyph-field";
      canvas.setAttribute("aria-hidden", "true");
      const glass = document.querySelector(".crt-glass, .readout-glass");
      document.body.insertBefore(canvas, glass || null);
    }
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ch = Math.max(7, Math.round(h / FIELD_ROWS));
    const cw = ch * 0.6;
    const cols = Math.ceil(w / cw);
    const rows = Math.ceil(h / ch);
    const n = cols * rows;
    F = {
      canvas, ctx: canvas.getContext("2d"), w, h, dpr, cw, ch, cols, rows,
      chars: new Array(n), fgs: new Array(n), bgs: new Array(n), styles: new Uint8Array(n), titled: new Uint8Array(n),
      prev: new Array(n), prevFg: new Array(n), keep: new Float32Array(n),
      xs: new Float32Array(cols + 1),
    };
    for (let x = 0; x <= cols; x++) F.xs[x] = Math.round(x * cw * dpr) / dpr;
    state.patches = [];
    title = null;
  }
  window.addEventListener("resize", () => {
    if (F) setup();
  });

  function clearField() {
    F.prev = F.chars;
    F.prevFg = F.fgs;
    const n = F.cols * F.rows;
    F.chars = new Array(n);
    F.fgs = new Array(n);
    F.bgs.fill(null);
    F.styles.fill(0);
    F.titled.fill(0);
  }

  function setCell(x, y, ch, fg, bg, style) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= F.cols || y >= F.rows) return;
    const i = y * F.cols + x;
    if (F.keep[i] && R() < F.keep[i]) return;
    F.chars[i] = ch;
    F.fgs[i] = fg;
    F.bgs[i] = bg || null;
    F.styles[i] = style || 0;
    F.titled[i] = 0;
  }
  /* A cell and its reflection across the middle of the screen. */
  function setSym(x, y, ch, fg, bg, style) {
    setCell(x, y, ch, fg, bg, style);
    setCell(F.cols - 1 - Math.floor(x), y, ch ? MIRROR[ch] || ch : ch, fg, bg, style);
  }
  /* Lay a colour under whatever is already there (the highlighter). */
  function tint(x, y, bg) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= F.cols || y >= F.rows) return;
    const i = y * F.cols + x;
    if (F.keep[i] && R() < F.keep[i]) return;
    if (!F.bgs[i]) F.bgs[i] = bg;
    if (F.chars[i] && F.fgs[i] === LIME) F.fgs[i] = INK;
  }

  /* Parts of the page the field mostly leaves alone: the controls stay usable, and
   * the Oracle's lines stay half readable. */
  let keepAt = -1e9;
  function updateKeep(now) {
    if (now - keepAt < 500) return;
    keepAt = now;
    F.keep.fill(0);
    const mark = (sel, v) => {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const x0 = Math.max(0, Math.floor(r.left / F.cw) - 1);
        const x1 = Math.min(F.cols, Math.ceil(r.right / F.cw) + 1);
        const y0 = Math.max(0, Math.floor(r.top / F.ch));
        const y1 = Math.min(F.rows, Math.ceil(r.bottom / F.ch));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) F.keep[y * F.cols + x] = Math.max(F.keep[y * F.cols + x], v);
      }
    };
    mark(".controls:not([hidden])", 1);
    mark(".said .line.now", 0.6);
  }

  // --- the title, in dense tiny glyphs ------------------------------------------------

  let title = null;
  function titleCells(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const fontsReady = document.fonts ? document.fonts.status : "";
    const key = [F.cols, F.rows, r.left, r.top, r.width, r.height, fontsReady].map((v) => (typeof v === "number" ? Math.round(v) : v)).join();
    if (title && title.key === key) return title;
    // Draw the words on a small canvas, a few samples to a cell, and fill each cell
    // with a glyph as dense as the ink that falls in it.
    const SUB = 4;
    const c = document.createElement("canvas");
    c.width = F.cols * SUB;
    c.height = F.rows * SUB;
    const g = c.getContext("2d");
    g.scale(SUB / F.cw, SUB / F.ch);
    const size = r.height * 0.92;
    g.font = `bold ${size}px ${GLYPH_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#000";
    const words = (el.textContent || "").trim().toUpperCase();
    const fit = Math.min(1, (F.w * 0.94) / Math.max(1, g.measureText(words).width));
    g.font = `bold ${size * fit}px ${GLYPH_FONT}`;
    g.fillText(words, r.left + r.width / 2, r.top + r.height / 2);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const cells = [];
    const y0 = Math.max(0, Math.floor(r.top / F.ch) - 2);
    const y1 = Math.min(F.rows, Math.ceil(r.bottom / F.ch) + 2);
    const top = new Int16Array(F.cols).fill(-1);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < F.cols; x++) {
        let s = 0;
        for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) s += data[((y * SUB + sy) * c.width + x * SUB + sx) * 4 + 3];
        const v = s / (SUB * SUB * 255);
        if (v < 0.08) continue;
        cells.push({ i: y * F.cols + x, v, ch: inkGlyph(v, R) });
        if (top[x] < 0) top[x] = y;
      }
    }
    title = { key, cells, top };
    return title;
  }
  function inkGlyph(v, r) {
    return v > 0.85 ? pick(r, "█▓█▓@#") : v > 0.5 ? pick(r, "▓▒%&#") : v > 0.25 ? pick(r, "▒░+=") : pick(r, "░:·");
  }

  // --- patches ---------------------------------------------------------------------------

  const EARLY = ["noise", "noise", "copy", "vbars", "words", "hex", "symbols", "noise"];
  const LATE = ["noise", "noise", "hatch", "solid", "vbars", "copy", "dither", "words", "hex", "table", "maze", "symbols", "letters", "brackets", "highlight", "noise", "words", "table"];

  function stream(r, kind, len) {
    let s = "";
    while (s.length < len) {
      if (kind === "hex") {
        for (let i = 0; i < 6; i++) s += r() < 0.85 ? pick(r, "0af1") : pick(r, "0123456789abcdef");
        s += r() < 0.8 ? " " : "";
      } else if (kind === "symbols") s += r() < 0.8 ? pick(r, "$§¤*#&%") : " ";
      else if (kind === "letters") s += r() < 0.82 ? pick(r, "MWXxwmXM") : " ";
      else if (kind === "brackets") s += r() < 0.75 ? pick(r, "[]+-|_") : " ";
      else {
        s += pick(r, WORDS);
        if (r() < 0.25) s += " ";
        if (r() < 0.12) s += "l".repeat(2 + Math.floor(r() * 10));
      }
    }
    return s;
  }

  function spawn(now, k, an, kind, short) {
    const pal = colours();
    const r = R;
    const p = { kind, born: now, seed: (r() * 4294967295) >>> 0, soft: pick(r, pal.soft), hard: pick(r, pal.hard), vx: 0, vy: 0, style: 0, bg: null, fg: null };
    p.life = short ? 160 + r() * 600 : (1500 + r() * 6500) * (0.6 + k * 1.2);
    p.every = 90 + r() * 320; // how often its glyphs change
    p.mirror = r() < (["words", "hex", "table"].includes(kind) ? 0.5 : 0.85);
    let w = Math.floor(3 + r() * (6 + k * 26));
    let h = Math.floor(2 + r() * (2 + k * 10));
    if (kind === "words" || kind === "hex" || kind === "symbols" || kind === "letters" || kind === "brackets") {
      w = Math.floor(6 + r() * (10 + k * 34));
      h = Math.floor(1 + r() * (1 + k * 7));
      p.text = stream(r, kind, w * h * 2 + 40);
      p.scroll = r() < 0.45 ? (r() < 0.5 ? 1 : -1) : 0; // a marquee
      const s = r();
      if (s < 0.22) (p.fg = WHITE), (p.bg = INK);
      else if (s < 0.3) (p.fg = INK), (p.bg = LIME);
      else p.fg = r() < 0.7 ? INK : NAVY;
      p.style = r() < 0.4 ? 1 : 0; // bold italic, like a printout's emphasis
    } else if (kind === "table") {
      w = Math.floor(10 + r() * (14 + k * 30));
      h = Math.floor(4 + r() * (4 + k * 8));
      p.colW = 5 + Math.floor(r() * 8);
      p.rowH = 2 + Math.floor(r() * 4);
      p.box = r() < 0.5;
      p.fill = pick(r, ["words", "hex", "symbols", "letters", "brackets"]);
      p.text = stream(r, p.fill, w * h + 40);
      p.inverseCol = r() < 0.5 ? Math.floor(r() * 4) : -1;
      p.limeCol = r() < 0.35 ? Math.floor(r() * 4) : -1;
    } else if (kind === "solid") {
      p.bg = pick(r, [INK, INK, NAVY, DEEP, INK, LIME, p.hard, NAVY]);
      p.label = r() < 0.4 ? pick(r, LABELS) : null;
    } else if (kind === "shard") {
      w = h = Math.floor(4 + r() * (4 + k * 14));
      p.up = r() < 0.5;
      p.colour = pick(r, [NAVY, INK, INK, DEEP, NAVY, pal.hard[5]]);
    } else if (kind === "streak") {
      w = 1;
      h = Math.floor(6 + Math.pow(r(), 1.5) * (20 + k * 50));
      p.colour = pick(r, pal.soft.concat([PERI, INK]));
      p.mirror = r() < 0.8;
    } else if (kind === "tear") {
      h = 1 + Math.floor(r() * (1 + k * 5));
      p.shift = Math.round((r() - 0.5) * (10 + k * 60));
      p.life = short ? 120 + r() * 400 : 300 + r() * 2500;
    } else if (kind === "copy") {
      p.sx = Math.floor((r() - 0.5) * 60);
      p.sy = Math.floor((r() - 0.5) * 16);
    }
    // Where: near the title or the figure at first, spreading out as it gets worse.
    const ax = F.cols / 2;
    const ay = an.y / F.ch;
    const spreadX = F.cols * (0.12 + k * 0.4);
    const spreadY = F.rows * (0.08 + k * 0.42);
    let x;
    let y;
    if (kind === "tear") {
      x = 0;
      y = Math.floor(ay + (r() - 0.5) * 2 * (spreadY + 6));
    } else if (r() < k * 0.25) {
      x = r() * (F.cols / 2);
      y = r() * F.rows;
    } else {
      x = ax - r() * spreadX - w * 0.3;
      y = ay + (r() - 0.5) * 2 * spreadY - h / 2;
    }
    if (!p.mirror && kind !== "tear" && r() < 0.5) x = F.cols - x - w;
    if (kind === "streak" && title) {
      const col = Math.max(0, Math.min(F.cols - 1, Math.floor(ax + (r() - 0.5) * 2 * Math.min(F.cols / 2, spreadX))));
      if (title.top[col] >= 0 && r() < 0.7) (x = col), (y = title.top[col] + 4);
    }
    // Some slide, like stuck blocks of an old picture.
    if (kind !== "tear" && kind !== "streak" && r() < 0.3) {
      p.vx = (r() - 0.5) * 2 * (1 + k * 6);
      p.vy = r() < 0.3 ? (r() - 0.3) * 3 : 0;
    }
    Object.assign(p, { x: Math.floor(x), y: Math.floor(y), w, h });
    return p;
  }

  function update(now, k, an) {
    const live = { block: 0, shard: 0, streak: 0, tear: 0 };
    const group = (p) => (p.kind === "shard" || p.kind === "streak" || p.kind === "tear" ? p.kind : "block");
    state.patches = state.patches.filter((p) => now - p.born < p.life);
    for (const p of state.patches) if (!p.short) live[group(p)]++;
    const want = {
      block: Math.floor(1 + k * k * 110),
      shard: Math.floor(k * k * 12),
      streak: Math.floor(2 + k * 44),
      tear: Math.floor(k * k * 8),
    };
    for (const g of Object.keys(want)) {
      // Too many for how broken it is now: the oldest go a little sooner.
      if (live[g] > want[g]) {
        let extra = live[g] - want[g];
        for (const p of state.patches) {
          if (extra <= 0) break;
          if (group(p) !== g || p.short || p.leaving) continue;
          p.life = Math.min(p.life, now - p.born + 200 + R() * 1500);
          p.leaving = true;
          extra--;
        }
      }
      for (let i = 0, n = Math.min(want[g] - live[g], g === "block" ? 4 : 2); i < n; i++) {
        const kind = g === "block" ? pick(R, k < 0.3 ? EARLY : LATE) : g;
        state.patches.push(spawn(now, k, an, kind, false));
      }
    }
    // A jolt: a handful of brief patches and tears at once.
    if (state.jolt) {
      const n = Math.floor(4 + state.jolt * 20);
      for (let i = 0; i < n; i++) {
        const p = spawn(now, Math.min(1, k + 0.3), an, R() < 0.35 ? "tear" : pick(R, LATE), true);
        p.short = true;
        state.patches.push(p);
      }
      state.jolt = 0;
    }
  }

  function paint(p, now, k) {
    const age = now - p.born;
    const r = random(p.seed + Math.floor(now / p.every) * 7919);
    const x0 = Math.round(p.x + (p.vx * age) / 1000);
    const y0 = Math.round(p.y + (p.vy * age) / 1000);
    const put = p.mirror ? setSym : setCell;
    const { w, h } = p;
    switch (p.kind) {
      case "noise":
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() > 0.08) put(x0 + x, y0 + y, pick(r, STRANGE), r() < 0.8 ? p.soft : p.hard);
        break;
      case "hatch":
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x0 + x, y0 + y, (x + y) % 3 === 0 ? "╱" : r() < 0.5 ? "▨" : "·", p.hard);
        break;
      case "solid": {
        const fg = p.bg === LIME ? INK : WHITE;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x0 + x, y0 + y, r() < 0.06 ? pick(r, "▓▒·") : null, fg, p.bg);
        if (p.label && w >= p.label.length + 2 && h >= 1) {
          const lx = x0 + Math.floor((w - p.label.length) / 2);
          const ly = y0 + Math.floor(h / 2);
          for (let i = 0; i < p.label.length; i++) setCell(lx + i, ly, p.label[i], fg, p.bg, 1);
        }
        break;
      }
      case "vbars":
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x0 + x, y0 + y, x % 2 ? "▌" : r() < 0.5 ? "┃" : "│", x % 3 ? p.soft : p.hard);
        break;
      case "dither":
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x0 + x, y0 + y, (x + y) % 2 ? "▒" : "░", p.soft);
        break;
      case "copy":
        // An echo of what was on the field a moment ago, moved and paled.
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const sx = x0 + x + p.sx;
            const sy = y0 + y + p.sy;
            if (sx < 0 || sy < 0 || sx >= F.cols || sy >= F.rows) continue;
            const ch = F.prev[sy * F.cols + sx];
            if (ch && ch !== " ") put(x0 + x, y0 + y, ch, p.soft);
            else if (r() < 0.2) put(x0 + x, y0 + y, pick(r, "·:░"), p.soft);
          }
        }
        break;
      case "words":
      case "hex":
      case "symbols":
      case "letters":
      case "brackets": {
        const scroll = p.scroll ? Math.floor(age / 110) * p.scroll : 0;
        const L = p.text.length;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const ch = p.text[(((y * w + x + scroll) % L) + L) % L];
            if (ch === " " && !p.bg) continue;
            put(x0 + x, y0 + y, ch, p.fg, p.bg, p.style);
          }
        }
        break;
      }
      case "table": {
        const L = p.text.length;
        const B = p.box ? { h: "─", v: "│", c: "┼", tl: "┌", tr: "┐", bl: "└", br: "┘", t: "┬", b: "┴", l: "├", r: "┤" } : { h: "-", v: "|", c: "+", tl: "+", tr: "+", bl: "+", br: "+", t: "+", b: "+", l: "+", r: "+" };
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const edgeY = y === 0 || y === h - 1 || y % p.rowH === 0;
            const edgeX = x === 0 || x === w - 1 || x % p.colW === 0;
            let ch;
            if (edgeY && edgeX) ch = y === 0 ? (x === 0 ? B.tl : x === w - 1 ? B.tr : B.t) : y === h - 1 ? (x === 0 ? B.bl : x === w - 1 ? B.br : B.b) : x === 0 ? B.l : x === w - 1 ? B.r : B.c;
            else if (edgeY) ch = B.h;
            else if (edgeX) ch = B.v;
            if (ch) {
              put(x0 + x, y0 + y, ch, NAVY);
              continue;
            }
            const col = Math.floor(x / p.colW);
            const c = p.text[(y * w + x) % L];
            if (col === p.inverseCol) put(x0 + x, y0 + y, c, WHITE, INK, 1);
            else if (col === p.limeCol) put(x0 + x, y0 + y, c, INK, LIME);
            else if (c !== " ") put(x0 + x, y0 + y, c, INK);
          }
        }
        break;
      }
      case "maze":
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r() < 0.75) put(x0 + x, y0 + y, pick(r, MAZE), r() < 0.7 ? NAVY : INK);
        break;
      case "highlight":
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            tint(x0 + x, y0 + y, LIME);
            if (p.mirror) tint(F.cols - 1 - (x0 + x), y0 + y, LIME);
          }
        }
        break;
      case "shard": {
        const s = w;
        for (let y = 0; y < s; y++) {
          for (let x = 0; x <= y; x++) {
            const gx = x0 + (p.up ? s - x : x);
            const gy = y0 + (p.up ? y : s - y);
            if (x === y) put(gx, gy, p.up ? "◢" : "◥", p.colour);
            else put(gx, gy, null, p.colour, p.colour);
          }
        }
        break;
      }
      case "streak": {
        const len = Math.floor(h * Math.min(1, age / 700));
        for (let y = 1; y < len; y++) {
          const t = y / h;
          put(x0, y0 + y, t < 0.3 ? pick(r, "┃│║") : t < 0.7 ? pick(r, "│¦╎:") : pick(r, ":·˙"), p.colour);
        }
        break;
      }
    }
  }

  /* Rows of the field slid sideways (a tear), with a little jitter. */
  function tear(p) {
    const shift = p.shift + Math.round((R() - 0.5) * 3);
    for (let y = p.y; y < p.y + p.h; y++) {
      if (y < 0 || y >= F.rows) continue;
      const a = y * F.cols;
      const chars = F.chars.slice(a, a + F.cols);
      const fgs = F.fgs.slice(a, a + F.cols);
      const bgs = F.bgs.slice(a, a + F.cols);
      const styles = F.styles.slice(a, a + F.cols);
      const titled = F.titled.slice(a, a + F.cols);
      for (let x = 0; x < F.cols; x++) {
        const s = (((x - shift) % F.cols) + F.cols) % F.cols;
        F.chars[a + x] = chars[s];
        F.fgs[a + x] = fgs[s];
        F.bgs[a + x] = bgs[s];
        F.styles[a + x] = styles[s];
        F.titled[a + x] = titled[s];
      }
    }
  }

  function anchor() {
    const h1 = document.querySelector(".start:not([hidden]) h1");
    if (h1) {
      const r = h1.getBoundingClientRect();
      if (r.height) return { y: r.top + r.height / 2, title: h1 };
    }
    // The talking screen: around the figure. The camera screen: the middle.
    return { y: F.h * (document.querySelector(".talk") ? 0.3 : 0.45) };
  }

  function compose(now, k) {
    const an = anchor();
    update(now, k, an);
    clearField();
    updateKeep(now);
    // The title first, in dense glyphs that shimmer, eaten away as it gets worse.
    title = an.title ? titleCells(an.title) : null;
    if (title) {
      const pal = colours();
      for (const c of title.cells) {
        if (R() < 0.03 + k * 0.2) c.ch = inkGlyph(c.v, R);
        const lost = R() < k * k * 0.3;
        F.chars[c.i] = lost ? pick(R, STRANGE) : c.ch;
        F.fgs[c.i] = lost ? pick(R, pal.soft) : INK;
        F.titled[c.i] = 1;
      }
    }
    for (const p of state.patches) if (p.kind !== "tear") paint(p, now, k);
    for (const p of state.patches) if (p.kind === "tear") tear(p);
  }

  function draw() {
    const { ctx, dpr, cols, rows, ch, xs } = F;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, F.canvas.width, F.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ys = (y) => Math.round(y * ch * dpr) / dpr;
    // Backgrounds: each tiny glyph covers what is under it (the title's don't).
    let last = null;
    for (let y = 0; y < rows; y++) {
      const top = ys(y);
      const hgt = ys(y + 1) - top;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const bg = F.bgs[i] || (F.chars[i] && F.chars[i] !== " " && !F.titled[i] ? WHITE : null);
        if (!bg) continue;
        if (bg !== last) ctx.fillStyle = last = bg;
        ctx.fillRect(xs[x], top, xs[x + 1] - xs[x], hgt);
      }
    }
    const fonts = [`${ch}px ${GLYPH_FONT}`, `italic bold ${ch}px ${GLYPH_FONT}`];
    let font = -1;
    last = null;
    ctx.textBaseline = "top";
    for (let y = 0; y < rows; y++) {
      const top = ys(y) + ch * 0.04;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const c = F.chars[i];
        if (!c || c === " ") continue;
        if (F.styles[i] !== font) ctx.font = fonts[(font = F.styles[i])];
        if (F.fgs[i] !== last) ctx.fillStyle = last = F.fgs[i];
        ctx.fillText(c, xs[x], top);
      }
    }
  }

  // --- the page's own letters ---------------------------------------------------------------

  const swaps = [];
  let textNodes = [];
  let textAt = -1e9;
  function collectText(now) {
    if (now - textAt < 800) return;
    textAt = now;
    textNodes = [];
    for (const root of document.querySelectorAll(".start:not([hidden]), .masks")) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        // Not the title (the field draws it), and never a live region: a screen
        // reader would read every swap out.
        if (/\S/.test(n.data) && !n.parentElement.closest("h1, [aria-live]")) textNodes.push(n);
      }
    }
  }
  function swapLetters(now, k, dt) {
    for (let i = swaps.length - 1; i >= 0; i--) {
      const s = swaps[i];
      if (now < s.until) continue;
      if (s.node.data[s.i] === s.now) s.node.data = s.node.data.slice(0, s.i) + s.was + s.node.data.slice(s.i + 1);
      swaps.splice(i, 1);
    }
    collectText(now);
    if (!textNodes.length) return;
    let n = ((k * k * 13 + burstLevel(now) * 30) * dt) / 1000 * (reduced ? 0.3 : 1);
    while (n > 0 && swaps.length < 4 + k * 24) {
      if (R() > n) break;
      n -= 1;
      const node = textNodes[Math.floor(R() * textNodes.length)];
      const i = Math.floor(R() * node.data.length);
      const was = node.data[i];
      if (!/\S/.test(was) || swaps.some((s) => s.node === node && s.i === i)) continue;
      const ch = pick(R, SWAPS);
      node.data = node.data.slice(0, i) + ch + node.data.slice(i + 1);
      swaps.push({ node, i, was, now: ch, until: now + 80 + R() * (300 + k * 1500) });
    }
  }
  function restoreLetters() {
    for (const s of swaps) if (s.node.data[s.i] === s.now) s.node.data = s.node.data.slice(0, s.i) + s.was + s.node.data.slice(s.i + 1);
    swaps.length = 0;
  }

  /* For text drawn on a canvas (the camera screen): the same swaps, steady between
   * ticks so they don't flicker every frame. */
  function garble(str) {
    const k = state.k;
    const p = k * k * 0.05 + burstLevel(performance.now()) * 0.08;
    if (p < 0.002) return str;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    const r = random((h ^ Math.floor(state.lastTick / (TICK_MS * 3))) >>> 0);
    let out = "";
    for (const c of str) out += c !== " " && r() < p ? pick(r, SWAPS) : c;
    return out;
  }

  // --- each frame -------------------------------------------------------------------------

  let burstClass = false;
  function post(canvas, now) {
    if (!document.body) return;
    if (!F) setup();
    if (now > state.nextIdle) {
      // Left alone it still twitches now and then.
      state.nextIdle = now + (9000 - state.k * 6000) * (0.5 + R());
      if (state.k > 0.15) kick({ strength: 0.2 + state.k * 0.6, ms: 200 + R() * 500 });
    }
    const on = burstLevel(now) > 0.15;
    if (on !== burstClass) document.documentElement.classList.toggle("signal-burst", (burstClass = on));
    if (now - state.lastTick < TICK_MS && !state.force) return;
    const dt = Math.min(250, now - state.lastTick);
    state.lastTick = now;
    state.force = false;
    const k = (state.k = level(now));
    compose(now, k);
    draw();
    swapLetters(now, k, dt);
    document.documentElement.style.setProperty("--decay", k.toFixed(3));
  }

  // Alt+D: a fifth more broken (from fully broken, back to fresh), to preview it.
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyD") {
      e.preventDefault();
      if (state.floor >= 0.99) reset();
      else wear(Math.min(1, Math.round((state.floor + 0.2) * 5) / 5));
      kick({ strength: 0.8 });
    }
  });

  Oracle.signal = {
    light: true,
    post,
    kick,
    wear,
    reset,
    garble,
    set mood(id) {
      state.mood = id || null;
    },
    get decay() {
      return state.floor;
    },
  };
})();
