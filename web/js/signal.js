/* The glitch look's bad signal (talk-glitch.html, readout-glitch.html, glitch.html),
 * after the K.TV poster in docs/references: black, with VHS colour bars torn
 * sideways, the red, green and blue pulled apart, and the picture slipping in
 * horizontal bands as the tracking goes.
 *
 * Each page renders its canvas as usual, then hands it over once per frame:
 *
 *   Oracle.signal.bars(ctx, x, y, w, h, t);   // torn colour bars, in the ctx's units
 *   Oracle.signal.post(canvas, now);          // split and tear what is on the canvas
 *   Oracle.signal.kick({ strength, bars });   // a burst: a mask switch, a command
 *
 * The picture always wobbles a little. Now and then, and on every kick, the signal
 * breaks up for a moment: wide tears, a wider colour split, and sometimes the
 * colour bars flash through. While a burst is on, <html> has the class
 * "signal-burst", so the page's own text can jump with it (css/glitch.css).
 *
 * It only rearranges pixels already on the canvas; nothing is kept between frames.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // The poster's bars, left to right: grey-white, yellow, cyan, green, magenta, red, blue.
  const BARS = ["#c8d0e6", "#e6d838", "#9fd6e8", "#a3bf63", "#c374d6", "#d8323a", "#2f6ae0"];
  // The row of blocks under the bars.
  const BLOCKS = ["#2f6ae0", "#000000", "#c374d6", "#000000", "#9fd6e8", "#000000", "#e8e8ee"];

  // The same small seeded generator as grid.js (the readout page doesn't load grid.js).
  function random(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const burst = { start: -1e9, len: 0, strength: 0, bars: false };
  let nextIdle = performance.now() + 3000 + Math.random() * 4000;

  /* Break the signal up for a moment. */
  function kick(opts) {
    opts = opts || {};
    const strength = opts.strength == null ? 1 : opts.strength;
    const now = performance.now();
    // A weaker kick during a stronger burst doesn't cut it short.
    if (level(now) > strength) return;
    Object.assign(burst, { start: now, len: opts.ms || 650, strength, bars: !!opts.bars });
  }

  /* How broken the signal is right now, 0..1. Starts the idle bursts too. */
  function level(now) {
    if (now > nextIdle) {
      nextIdle = now + 6000 + Math.random() * 9000;
      if (now - burst.start > burst.len) {
        Object.assign(burst, {
          start: now,
          len: 180 + Math.random() * 520,
          strength: 0.3 + Math.random() * 0.45,
          bars: Math.random() < 0.3,
        });
      }
    }
    const p = (now - burst.start) / burst.len;
    if (p < 0 || p > 1) return 0;
    // It stutters as it fades, rather than fading smoothly.
    const stutter = Math.sin(now * 0.09) * Math.sin(now * 0.053 + 1.3) > -0.2 ? 1 : 0.35;
    return burst.strength * Math.pow(1 - p, 0.6) * stutter * (reduced ? 0.3 : 1);
  }

  let burstClass = false;
  function markBurst(on) {
    if (on === burstClass) return;
    burstClass = on;
    document.documentElement.classList.toggle("signal-burst", on);
  }

  /* Colour bars in (x, y, w, h), in the context's current units, with wavy edges
   * and rows torn sideways like a tape losing tracking. With opts.full the last two
   * bars run to the top while the rest start lower down, as on the poster. */
  function bars(ctx, x, y, w, h, t, opts) {
    opts = opts || {};
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    if (alpha <= 0 || w <= 0 || h <= 0) return;
    const n = BARS.length;
    const bw = w / n;
    const slice = Math.max(2, Math.round(h / 160));
    const blockH = opts.blocks === false ? 0 : Math.round(h * 0.07);
    const barsH = h - blockH;
    // With opts.full the others start lower down; the red and blue always reach the top.
    const lowTop = opts.full ? Math.round(barsH * 0.42) : 0;
    const step = Math.floor(t * 7); // the torn blocks jump a few times a second
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let yy = 0; yy < barsH; yy += slice) {
      const r = random(((Math.floor(yy / (slice * 9)) + 1) * 7919 + step * 104729) >>> 0);
      // The wavy edges: a slow sway down the bars, plus the odd row knocked aside.
      let shift = Math.sin(yy * 0.021 + t * 1.7) * bw * 0.06 + Math.sin(yy * 0.0057 - t * 0.6) * bw * 0.12;
      if (r() < 0.18) shift += (r() - 0.5) * bw * 0.9;
      const squeeze = 1 + (r() < 0.1 ? (r() - 0.5) * 0.25 : 0);
      for (let i = 0; i < n; i++) {
        const top = i >= n - 2 ? 0 : lowTop;
        if (yy < top) continue;
        // Each bar's edge wobbles on its own, so they don't move as one block.
        const own = Math.sin(yy * 0.05 + i * 2.1 + t * 2.3) * bw * 0.035;
        const bx = x + w / 2 + (i * bw - w / 2) * squeeze + shift + own;
        ctx.fillStyle = BARS[i];
        ctx.fillRect(bx, y + yy, bw + 1, slice + 0.5);
      }
    }
    for (let i = 0; i < n && blockH; i++) {
      ctx.fillStyle = BLOCKS[i];
      ctx.fillRect(x + i * bw, y + barsH, bw + 1, blockH);
    }
    ctx.restore();
  }

  /* The colour bars over a whole canvas during a burst that brought them. Call it
   * after rendering and before post(), so the bars get torn too. */
  function flash(ctx, w, h, now) {
    const lv = level(now);
    if (!burst.bars || lv < 0.12) return;
    const t = now / 1000;
    // Only some of the screen: a band of bars, as if another channel bled through.
    const r = random((Math.floor(now / 90) * 2654435761) >>> 0);
    const bandH = h * (0.25 + lv * 0.6);
    const top = r() * (h - bandH);
    bars(ctx, 0, top, w, bandH, t, { alpha: Math.min(1, lv * 1.3), blocks: false });
  }

  // One pair of scratch canvases per target, reused every frame.
  const scratch = new WeakMap();
  function buffers(canvas) {
    let b = scratch.get(canvas);
    if (!b || b.w !== canvas.width || b.h !== canvas.height) {
      const make = () => {
        const c = document.createElement("canvas");
        c.width = canvas.width;
        c.height = canvas.height;
        return c;
      };
      b = { w: canvas.width, h: canvas.height, copy: make(), chan: make() };
      b.copyCtx = b.copy.getContext("2d");
      b.chanCtx = b.chan.getContext("2d");
      scratch.set(canvas, b);
    }
    return b;
  }

  /* Split and tear what is on the canvas, in place. */
  function post(canvas, now, opts) {
    opts = opts || {};
    const lv = Math.min(1, level(now) + (opts.extra || 0));
    markBurst(lv > 0.15);
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const unit = h / 1080;
    const t = now / 1000;
    const b = buffers(canvas);

    b.copyCtx.globalCompositeOperation = "copy";
    b.copyCtx.drawImage(canvas, 0, 0);

    // The bands: thin rows, each slid sideways by the wobble, the tracking band
    // and, during a burst, a few wide tears.
    const slice = Math.max(2, Math.round(h / 140));
    const track = (((t * 0.045) % 1.35) - 0.15) * h;
    const trackH = h * 0.045;
    const r = random((Math.floor(now / 70) * 40503 + 17) >>> 0);
    const tears = [];
    const count = lv > 0 ? 2 + Math.floor(lv * 7) : 0;
    for (let i = 0; i < count; i++) {
      tears.push({ y: r() * h, h: (0.01 + r() * 0.08) * h, shift: (r() - 0.5) * w * 0.14 * lv, chroma: (r() - 0.5) * 30 * unit * lv });
    }
    const calm = reduced ? 0.4 : 1;
    const bands = [];
    for (let y = 0; y < h; y += slice) {
      let shift = (Math.sin(y * 0.011 / unit + t * 1.3) * 1.2 + Math.sin(y * 0.0023 / unit - t * 0.45) * 1.8) * unit * calm;
      let chroma = 0;
      const d = Math.abs(y - track);
      if (d < trackH) {
        const k = 1 - d / trackH;
        shift += Math.sin(y * 0.7 + t * 31) * 9 * unit * k * calm;
        chroma += 3 * unit * k;
      }
      for (const tear of tears) {
        if (y >= tear.y && y < tear.y + tear.h) {
          shift += tear.shift;
          chroma += tear.chroma;
        }
      }
      bands.push({ y, h: Math.min(slice, h - y), shift, chroma });
    }

    const split = (1.6 + lv * 12) * unit * (opts.split == null ? 1 : opts.split);
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const channels = [
      ["#ff0000", -1],
      ["#00ff00", 0],
      ["#0000ff", 1],
    ];
    for (const [colour, dir] of channels) {
      b.chanCtx.globalCompositeOperation = "copy";
      b.chanCtx.drawImage(b.copy, 0, 0);
      b.chanCtx.globalCompositeOperation = "multiply";
      b.chanCtx.fillStyle = colour;
      b.chanCtx.fillRect(0, 0, w, h);
      for (const band of bands) {
        const dx = Math.round(band.shift + dir * (split + band.chroma));
        ctx.drawImage(b.chan, 0, band.y, w, band.h, dx, band.y, w, band.h);
      }
    }
    // A few bright dropout lines while the signal is breaking up.
    if (lv > 0.2) {
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < 1 + lv * 5; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`;
        ctx.fillRect(r() * w * 0.6, r() * h, w * (0.1 + r() * 0.5), Math.max(1, unit * 1.5));
      }
    }
    ctx.restore();
  }

  Oracle.signal = {
    BARS,
    bars,
    flash,
    post,
    kick,
    level: () => level(performance.now()),
  };
})();
