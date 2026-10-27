/* 3D in ASCII: render a three.js scene off-screen at one pixel per character cell
 * (times a small supersample), then turn each cell's brightness into a glyph.
 *
 * The same technique as the chair on the CharlieCilla home page:
 *   1. render the scene into a tiny off-screen target, one cell = ss x ss pixels
 *   2. average each cell: brightness (lit colour) and coverage (alpha)
 *   3. brightness + a 4x4 Bayer threshold picks a glyph from a ramp
 * Empty cells stay blank; a covered cell is at least the lightest glyph, so the
 * silhouette always reads, and dark paint (eyes, mouths) reads as sparse dots.
 *
 * The conversion half (glyphLevel, cellsToFrame, frameToText) is plain JS and
 * runs in Node for tests. AsciiRenderer needs THREE (web/vendor/three.min.js).
 */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const Oracle = (root.Oracle = root.Oracle || {});

  // Lightest to densest. Index 0 is "nothing here".
  const RAMP = " .:-=+*#%@";

  // 4x4 Bayer matrix as thresholds in (0, 1).
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  /* Ramp index (1..ramp.length-1) for a covered cell of brightness b (0..1) at
   * cell (x, y). The fractional step between two glyphs is dithered, so smooth
   * gradients come out as an ordered mix of neighbouring glyphs, not bands. */
  function glyphLevel(b, x, y, rampLength) {
    const steps = rampLength - 2; // levels 1..rampLength-1
    const v = Math.max(0, Math.min(1, b)) * steps;
    const base = Math.floor(v);
    const up = v - base > BAYER4[(y & 3) * 4 + (x & 3)] ? 1 : 0;
    return 1 + Math.min(steps, base + up);
  }

  /* Turn per-cell brightness and coverage into a frame.
   *   bright, cover  Float32Array(cols * rows), both 0..1
   *   opts.ramp      glyph ramp (default RAMP)
   *   opts.minCover  coverage below this is empty (default 0.35)
   *   opts.gamma     applied to brightness before dithering (default 1)
   *   opts.black, opts.white  brightness window (default 0, 1)
   *   opts.hole      covered cells darker than this (raw, before the window) stay
   *                  blank, so pure black paint reads as a cut-out (default -1: off)
   * Returns { cols, rows, ramp, level: Uint8Array, chars: string[] }. */
  function cellsToFrame(cols, rows, bright, cover, opts) {
    opts = opts || {};
    const ramp = opts.ramp || RAMP;
    const minCover = opts.minCover == null ? 0.35 : opts.minCover;
    const gamma = opts.gamma || 1;
    const black = opts.black || 0;
    const white = opts.white == null ? 1 : opts.white;
    const hole = opts.hole == null ? -1 : opts.hole;
    const n = cols * rows;
    const level = new Uint8Array(n);
    const chars = new Array(n);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (cover[i] < minCover || bright[i] < hole) {
          level[i] = 0;
          chars[i] = " ";
          continue;
        }
        let b = (bright[i] - black) / (white - black);
        b = Math.pow(Math.max(0, Math.min(1, b)), gamma);
        const l = glyphLevel(b, x, y, ramp.length);
        level[i] = l;
        chars[i] = ramp[l];
      }
    }
    return { cols, rows, ramp, level, chars };
  }

  /* The frame as a plain text block, one line per row. */
  function frameToText(frame) {
    const lines = [];
    for (let y = 0; y < frame.rows; y++) {
      lines.push(frame.chars.slice(y * frame.cols, (y + 1) * frame.cols).join(""));
    }
    return lines.join("\n");
  }

  /* Off-screen WebGL renderer that produces ASCII frames. One per page is plenty:
   * it can render any scene and camera at any cell size. */
  class AsciiRenderer {
    constructor(opts) {
      opts = opts || {};
      const THREE = root.THREE;
      if (!THREE) throw new Error("AsciiRenderer needs THREE (load web/vendor/three.min.js first)");
      this.THREE = THREE;
      this.ss = opts.supersample || 2;
      this.convert = opts.convert || {};
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x000000, 0);
      this.target = null;
      this.cols = 0;
      this.rows = 0;
    }

    setSize(cols, rows) {
      cols = Math.max(1, Math.floor(cols));
      rows = Math.max(1, Math.floor(rows));
      if (cols === this.cols && rows === this.rows) return;
      this.cols = cols;
      this.rows = rows;
      const w = cols * this.ss;
      const h = rows * this.ss;
      if (this.target) this.target.dispose();
      this.target = new this.THREE.WebGLRenderTarget(w, h);
      this.pixels = new Uint8Array(w * h * 4);
      this.bright = new Float32Array(cols * rows);
      this.cover = new Float32Array(cols * rows);
    }

    /* Render scene through camera into a frame of the current size. The camera's
     * aspect should already match the cells (see Oracle.ascii3d.fitCamera). */
    render(scene, camera, convert) {
      const { cols, rows, ss } = this;
      const w = cols * ss;
      const h = rows * ss;
      const r = this.renderer;
      r.setRenderTarget(this.target);
      r.clear();
      r.render(scene, camera);
      r.readRenderTargetPixels(this.target, 0, 0, w, h, this.pixels);
      r.setRenderTarget(null);

      const px = this.pixels;
      const inv = 1 / (ss * ss * 255);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          let lum = 0;
          let a = 0;
          for (let sy = 0; sy < ss; sy++) {
            // WebGL rows start at the bottom.
            const row = h - 1 - (cy * ss + sy);
            let p = (row * w + cx * ss) * 4;
            for (let sx = 0; sx < ss; sx++, p += 4) {
              const alpha = px[p + 3];
              lum += (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) * (alpha / 255);
              a += alpha;
            }
          }
          const i = cy * cols + cx;
          this.cover[i] = a * inv;
          // Average brightness of the covered part of the cell, linear 0..1.
          this.bright[i] = a > 0 ? lum / a : 0;
        }
      }
      const opts = Object.assign({}, this.convert, convert);
      if (opts.exposure) opts.white = this.autoWhite(opts);
      return cellsToFrame(cols, rows, this.bright, this.cover, opts);
    }

    /* Auto exposure: the brightness that opts.exposure (e.g. 0.97) of the covered
     * cells stay under becomes full white, eased over a few frames so a turn into
     * the light doesn't flicker. Keeps the whole ramp in use whatever the lights do. */
    autoWhite(opts) {
      const hist = (this.hist = this.hist || new Uint32Array(256));
      hist.fill(0);
      const minCover = opts.minCover == null ? 0.35 : opts.minCover;
      let total = 0;
      for (let i = 0; i < this.bright.length; i++) {
        if (this.cover[i] < minCover || this.bright[i] < (opts.hole || 0)) continue;
        hist[Math.min(255, (this.bright[i] * 255) | 0)]++;
        total++;
      }
      let target = 1;
      if (total) {
        let seen = 0;
        for (let b = 0; b < 256; b++) {
          seen += hist[b];
          if (seen >= total * opts.exposure) {
            target = Math.max(0.1, (b + 1) / 255);
            break;
          }
        }
      }
      this.white = this.white == null ? target : this.white + (target - this.white) * 0.15;
      return this.white;
    }

    dispose() {
      if (this.target) this.target.dispose();
      this.renderer.dispose();
    }
  }

  /* Point a perspective camera at a sphere (center, radius) so it fills a
   * cols x rows block of cells that are cellAspect wide per 1 tall. */
  function fitCamera(camera, cols, rows, cellAspect, center, radius, margin) {
    const aspect = (cols * cellAspect) / rows;
    camera.aspect = aspect;
    const halfV = (camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const half = Math.min(halfV, halfH);
    const dist = (radius * (margin || 1.1)) / Math.sin(half);
    camera.position.set(center.x, center.y, center.z + dist);
    camera.near = Math.max(0.01, dist - radius * 3);
    camera.far = dist + radius * 3;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  const api = { RAMP, BAYER4, glyphLevel, cellsToFrame, frameToText, fitCamera, AsciiRenderer };
  Oracle.ascii3d = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
