/* The character screen: a grid of cells drawn on one canvas.
 *
 * Every scene draws by calling grid.set(x, y, ch, color) between grid.clear()
 * and grid.render(). Colors are palette keys (see PALETTE), so the look can
 * change in one place: theme.js re-tints the palette per personality.
 *
 * grid.rowShift[y] slides a whole row sideways by a fraction of a cell when it
 * is drawn, for the VHS tracking wobble. It is cleared with the grid.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // theme.js fills this in (and changes it in place); these are only the fallback.
  const PALETTE = (Oracle.PALETTE = Oracle.PALETTE || {
    bg: "#03110a",
    fg: "#6dff9e",
    dim: "#2a8f55",
    bright: "#e2ffe9",
    orange: "#ffb347",
    red: "#ff4a3d",
    teal: "#5fe8d6",
    ink: "#010a05",
  });
  const FONT = 'Consolas, "Lucida Console", "Courier New", monospace';
  const TARGET_ROWS = 60; // about 60 rows tall on any screen; columns follow the width

  class Grid {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.cellH = Math.max(8, Math.min(24, Math.floor(h / TARGET_ROWS)));
      this.cellW = Math.round(this.cellH * 0.6 * 100) / 100;
      this.cols = Math.max(20, Math.floor(w / this.cellW));
      this.rows = Math.max(10, Math.floor(h / this.cellH));
      this.offsetX = (w - this.cols * this.cellW) / 2;
      this.offsetY = (h - this.rows * this.cellH) / 2;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      document.documentElement.style.setProperty("--cell", this.cellH + "px");
      const n = this.cols * this.rows;
      this.chars = new Array(n).fill(" ");
      this.colors = new Array(n).fill("fg");
      this.rowShift = new Float32Array(this.rows);
    }

    clear() {
      this.chars.fill(" ");
      this.colors.fill("fg");
      this.rowShift.fill(0);
    }

    inside(x, y) {
      return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
    }

    set(x, y, ch, color) {
      x = Math.floor(x);
      y = Math.floor(y);
      if (!this.inside(x, y)) return;
      const i = y * this.cols + x;
      this.chars[i] = ch;
      this.colors[i] = color || "fg";
    }

    get(x, y) {
      x = Math.floor(x);
      y = Math.floor(y);
      if (!this.inside(x, y)) return " ";
      return this.chars[y * this.cols + x];
    }

    /* Write a string starting at (x, y). */
    text(x, y, str, color) {
      for (let i = 0; i < str.length; i++) this.set(x + i, y, str[i], color);
    }

    render() {
      const ctx = this.ctx;
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.font = `${this.cellH}px ${FONT}`;
      ctx.textBaseline = "top";
      let last = null;
      for (let y = 0; y < this.rows; y++) {
        const ox = this.offsetX + this.rowShift[y] * this.cellW;
        for (let x = 0; x < this.cols; x++) {
          const i = y * this.cols + x;
          const ch = this.chars[i];
          if (ch === " ") continue;
          const color = this.colors[i];
          if (color !== last) {
            ctx.fillStyle = PALETTE[color] || color;
            last = color;
          }
          ctx.fillText(ch, ox + x * this.cellW, this.offsetY + y * this.cellH);
        }
      }
    }
  }

  /* Small seeded random generator, so glitches can be repeatable in tests. */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  Oracle.Grid = Grid;
  Oracle.rng = rng;
  Oracle.scenes = Oracle.scenes || {};
})();
