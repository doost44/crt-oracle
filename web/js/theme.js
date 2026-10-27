/* The screen's tint: one palette per personality, and the switch between them.
 *
 * Everything on screen takes its colours from here. The grid (grid.js) looks up
 * Oracle.PALETTE when it renders, and the terminal and receipt read the same
 * colours as CSS variables (--bg, --fg, ...), so one call re-tints the lot:
 *
 *   Oracle.theme.set("clinical");   // starts a short, flickery switch
 *   Oracle.theme.update(now);       // once per frame (main.js does this)
 *
 * Before anyone has picked a symbol the screen is cobalt blue with white
 * characters (the boot screen look). Each palette keeps the same keys, so scenes never
 * need to know which personality is on: "orange", "red" and "teal" are the
 * accent slots (the face's sparks, the VHS red bleed, the cold scan line).
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const THEMES = {
    // Cobalt blue with white characters: the boot screen, before anyone has chosen.
    neutral: {
      bg: "#1530e8",
      fg: "#f4f6ff",
      dim: "#93a3ff",
      bright: "#ffffff",
      orange: "#ff9b2f",
      red: "#ff3b3b",
      teal: "#37d6c5",
      ink: "#0b1a8c",
      bleed: "#ff3a2e",
    },
    // Sugar (sun): warm amber, like an old amber monitor left on too long.
    sugar: {
      bg: "#140902",
      fg: "#ffb341",
      dim: "#a35e14",
      bright: "#fff1cc",
      orange: "#ffd27a",
      red: "#ff5a6e",
      teal: "#ffe08a",
      ink: "#0b0501",
      bleed: "#ff3d6b",
    },
    // Weary (rock): the same green, washed out and tired.
    weary: {
      bg: "#06120b",
      fg: "#7fd99a",
      dim: "#3a7a50",
      bright: "#d4f2dc",
      orange: "#c9b25e",
      red: "#d9564a",
      teal: "#66bfa8",
      ink: "#020805",
      bleed: "#c8402f",
    },
    // Clinical (tree): cold blue-white, a light box in an empty office.
    clinical: {
      bg: "#040912",
      fg: "#cfe4ff",
      dim: "#56769c",
      bright: "#ffffff",
      orange: "#8fd0ff",
      red: "#ff4d4d",
      teal: "#7ff6ff",
      ink: "#02050b",
      bleed: "#3d6bff",
    },
  };

  // The clean demo look (clean.html sets window.ORACLE_LOOK = "clean"): white
  // paper and blue ink for the boot screen and every personality alike, like a
  // plain terminal. The accent slots are blues too, so nothing breaks the two tones.
  if (window.ORACLE_LOOK === "clean") {
    const ink = {
      bg: "#ffffff",
      fg: "#1f2bd6",
      dim: "#8a91ea",
      bright: "#0b159e",
      orange: "#3445ff",
      red: "#1f2bd6",
      teal: "#5b6bff",
      ink: "#ffffff",
      bleed: "#1f2bd6",
    };
    for (const id of Object.keys(THEMES)) THEMES[id] = Object.assign({}, ink);
  }

  // The glitch look (talk-glitch.html, glitch.html set window.ORACLE_LOOK = "glitch"):
  // a failing computer's white phosphor on black. Each mask keeps a colour of its own
  // in the accent slot; signal.js has the colours each one breaks into.
  if (window.ORACLE_LOOK === "glitch") {
    const black = {
      bg: "#000000",
      fg: "#e4ecff",
      dim: "#6f7aa0",
      bright: "#ffffff",
      orange: "#c8d0e6",
      red: "#d8323a",
      teal: "#9fd6e8",
      ink: "#000000",
      bleed: "#d8323a",
    };
    const accent = { neutral: "#8fb4ff", sugar: "#ffb02e", weary: "#b48cff", clinical: "#3cf0ff" };
    for (const id of Object.keys(THEMES)) THEMES[id] = Object.assign({}, black, { orange: accent[id] });
  }

  // The drawing look (talk-plan.html sets window.ORACLE_LOOK = "plan"): the clean
  // look's white paper and blue ink, with each mask's accent in one of the drawings'
  // inks (plans.js draws them).
  if (window.ORACLE_LOOK === "plan") {
    const paper = {
      bg: "#ffffff",
      fg: "#1f2bd6",
      dim: "#7d86e6",
      bright: "#0b159e",
      orange: "#1f2bd6",
      red: "#ff2a2a",
      teal: "#00b4e6",
      ink: "#ffffff",
      bleed: "#ff2fb4",
    };
    const accent = { neutral: "#1f2bd6", sugar: "#ff2fb4", weary: "#1fa83e", clinical: "#00a2e0" };
    for (const id of Object.keys(THEMES)) THEMES[id] = Object.assign({}, paper, { orange: accent[id] });
  }

  // The console look (talk-console.html sets window.ORACLE_LOOK = "console"): an old
  // computer's plain console text, blue on white for everyone. Each mask keeps a
  // colour of its own in the accent slot, the one its glyph field shows (console.js).
  if (window.ORACLE_LOOK === "console") {
    const tube = {
      bg: "#ffffff",
      fg: "#1414e6",
      dim: "#8e98dc",
      bright: "#0b0f7a",
      orange: "#1414e6",
      red: "#1414e6",
      teal: "#8e98dc",
      ink: "#ffffff",
      bleed: "#1414e6",
    };
    const accent = { neutral: "#1414e6", sugar: "#e8792e", weary: "#4f9a5e", clinical: "#1a9fb8" };
    for (const id of Object.keys(THEMES)) THEMES[id] = Object.assign({}, tube, { orange: accent[id] });
  }

  // The text-mode look (talk-text.html sets window.ORACLE_LOOK = "text"): an old home
  // computer's console, pale blue letters on a blue screen, the same for every mask.
  if (window.ORACLE_LOOK === "text") {
    const screen = {
      bg: "#2436d6",
      fg: "#c9d2ff",
      dim: "#8494f0",
      bright: "#ffffff",
      orange: "#ffffff",
      red: "#ffffff",
      teal: "#a9b6ff",
      ink: "#2436d6",
      bleed: "#c9d2ff",
    };
    for (const id of Object.keys(THEMES)) THEMES[id] = Object.assign({}, screen);
  }

  const KEYS = Object.keys(THEMES.neutral);
  const SWITCH_MS = 900;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(c) {
    return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }

  const RGB = {};
  for (const id of Object.keys(THEMES)) {
    RGB[id] = {};
    for (const k of KEYS) RGB[id][k] = hexToRgb(THEMES[id][k]);
  }

  // The live palette. grid.js keeps a reference to this object, so it is
  // changed in place, never replaced.
  const PALETTE = Oracle.PALETTE || {};
  Object.assign(PALETTE, THEMES.neutral);
  Oracle.PALETTE = PALETTE;

  const state = {
    id: "neutral",
    from: "neutral",
    start: 0,
    progress: 1, // 0..1 through the current switch
    dirty: true, // CSS variables need writing
  };

  function resolve(id) {
    return id && THEMES[id] ? id : "neutral";
  }

  /* Switch to a personality's palette (null for the cobalt-blue boot look). */
  function set(id, opts) {
    id = resolve(id);
    if (id === state.id && state.progress >= 1) return;
    state.from = state.id; // a switch during a switch starts again from the last target
    state.id = id;
    state.start = performance.now();
    state.progress = opts && opts.instant ? 1 : 0;
    if (state.progress >= 1) write(1);
  }

  /* The switch isn't a smooth fade: it flickers between the two palettes, the way
   * a VHS picture jumps when the tracking catches, and settles on the new one. */
  function mix(p, now) {
    if (p >= 1) return 1;
    const flick = Math.sin(now * 0.047) * Math.sin(now * 0.031 + 1.7);
    const jump = flick > 0.55 - p * 0.9 ? 1 : 0;
    const eased = p * p * (3 - 2 * p);
    return Math.max(0, Math.min(1, eased * 0.8 + jump * 0.35 * (1 - p) + (p > 0.7 ? (p - 0.7) * 0.66 : 0)));
  }

  function write(m) {
    const a = RGB[state.from];
    const b = RGB[state.id];
    const root = document.documentElement.style;
    for (const k of KEYS) {
      const c = [0, 1, 2].map((j) => a[k][j] + (b[k][j] - a[k][j]) * m);
      const hex = rgbToHex(c);
      PALETTE[k] = hex;
      root.setProperty("--" + k, hex);
      if (k === "fg") root.setProperty("--glow", `rgba(${c.map(Math.round).join(", ")}, 0.55)`);
      if (k === "bleed") root.setProperty("--bleed-a", `rgba(${c.map(Math.round).join(", ")}, 0.5)`);
      if (k === "ink") root.setProperty("--ink-a", `rgba(${c.map(Math.round).join(", ")}, 0.66)`);
    }
    document.documentElement.dataset.theme = state.id;
    state.dirty = false;
  }

  /* Call once per frame. Returns how far the switch has got (1 when settled). */
  function update(now) {
    if (state.progress < 1) {
      state.progress = Math.min(1, (now - state.start) / SWITCH_MS);
      write(mix(state.progress, now));
    } else if (state.dirty) {
      write(1);
    }
    return state.progress;
  }

  Oracle.THEMES = THEMES;
  Oracle.theme = {
    set,
    update,
    get id() {
      return state.id;
    },
    /* True while a switch is under way (scenes add a glitch burst). */
    get switching() {
      return state.progress < 1;
    },
  };
})();
