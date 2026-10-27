/* The glitch look's failing machine (talk-glitch.html, readout-glitch.html, glitch.html):
 * an old computer on a hazy CRT, slowly coming apart.
 *
 * Each page renders its canvas as usual, then hands it over once per frame:
 *
 *   Oracle.signal.post(canvas, now);       // haze, smears, drips, stuck blocks, snow
 *   Oracle.signal.kick({ strength });      // a jolt: a mask switch, a command
 *   Oracle.signal.wear(0.5);               // it is at least this broken now (0..1)
 *   Oracle.signal.reset();                 // a new visitor: the screen comes back clean
 *
 * How broken it is (decay, 0..1) creeps up on its own while the page is open, and
 * the pages push it further as the visit goes on. At first there is only the haze:
 * a soft bloom, lifted blacks, the colours a little apart, a faint roll of snow.
 * Then the faults start and stay longer the worse it gets: rows smear sideways from
 * one stuck pixel, columns drip down the screen, blocks of the last picture stick
 * and slide (the datamosh look), blocks die into bands of flat colour, and near the
 * end the picture loses its vertical hold and rolls.
 *
 * The page's own text gets the same treatment through an SVG filter (#signal-warp):
 * it wavers sideways and its colours pull apart as decay rises. While a jolt is on,
 * <html> has the class "signal-burst".
 *
 * The drawing look (talk-plan.html, readout-plan.html: window.ORACLE_LOOK = "plan")
 * is the same machine on white paper with blue ink: the ghosts become ink trails,
 * the bloom an ink bleed, the haze a blue tint creeping into the white, and things
 * die into the drawings' coloured inks (plans.js draws the drawings).
 *
 * ?decay=0.8 starts that broken (to preview the end); Alt+D steps it up by a fifth.
 *
 * The only thing kept between frames is the last picture shown, in memory, for the
 * smears and ghosts; on the camera screen that is the live picture, for a moment.
 * Nothing is written anywhere or sent.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // The colours things die into, per mask: what each one's screen bleeds.
  const PALETTES = {
    neutral: ["#2a5cff", "#58d6ff", "#e8f0ff", "#7a3cff", "#0b1f8c", "#ff5a3c"],
    sugar: ["#ff2e6e", "#ffb02e", "#ffe14a", "#ff7ad9", "#a020f0", "#fff3d6"],
    weary: ["#8a5cc8", "#d4b21c", "#1f6b5a", "#5a1e2e", "#3cc8a0", "#c86478"],
    clinical: ["#1f3cff", "#00e0ff", "#3cff6e", "#ffffff", "#ff2a2a", "#0a1a3c"],
  };
  // The haze: what the blacks lift towards.
  const HAZE = { neutral: "#1a2a6a", sugar: "#5a1a2a", weary: "#1a3a2a", clinical: "#0a2a5a" };

  // The drawing look: white paper, so everything works the other way round.
  const LIGHT = window.ORACLE_LOOK === "plan";
  if (LIGHT) {
    Object.assign(PALETTES, {
      neutral: ["#ff2fb4", "#1fc84a", "#f2d400", "#00b4e6", "#1f2bd6", "#ff9ad5"],
      sugar: ["#ff2fb4", "#f2d400", "#ff9a3c", "#ff9ad5", "#1f2bd6", "#ff3a2a"],
      weary: ["#1fc84a", "#b8f06a", "#8a3cff", "#1f2bd6", "#f2d400", "#ff9ad5"],
      clinical: ["#00b4e6", "#1f2bd6", "#5bc8ff", "#1fc84a", "#ff2fb4", "#ffffff"],
    });
    // What the white goes towards: blue, a little different per mask.
    Object.assign(HAZE, { neutral: "#c9d4ff", sugar: "#ffd0ec", weary: "#d4f0c8", clinical: "#c4ecff" });
  }

  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CREEP_MS = 180000; // left alone, it gets about half broken in three minutes
  const CREEP_MAX = 0.55;

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
  const R = random((Math.random() * 4294967295) >>> 0);

  const state = {
    born: performance.now(),
    floor: 0,
    mood: null, // a palette id; null follows <html data-theme>
    burst: { start: -1e9, len: 0, strength: 0 },
    nextIdle: performance.now() + 4000,
    faults: [],
    roll: 0, // vertical hold: how far the picture has slipped, in pixels
    rollSpeed: 0,
    lastNow: performance.now(),
    rebooted: -1e9,
  };

  const fromURL = parseFloat(new URLSearchParams(location.search).get("decay"));
  if (fromURL >= 0) state.floor = Math.min(1, fromURL);

  function decay(now) {
    const creep = Math.min(1, (now - state.born) / CREEP_MS) * CREEP_MAX;
    return Math.min(1, Math.max(creep, state.floor));
  }

  /* It is at least this broken now. Never goes back down until reset(). */
  function wear(v) {
    state.floor = Math.min(1, Math.max(state.floor, v));
  }

  /* A new visitor: the screen comes back (with a degauss wobble) and starts over. */
  function reset() {
    const now = performance.now();
    state.born = now;
    state.floor = fromURL >= 0 ? Math.min(1, fromURL) : 0;
    state.faults = [];
    state.roll = 0;
    state.rollSpeed = 0;
    state.rebooted = now;
  }

  /* A jolt. */
  function kick(opts) {
    opts = opts || {};
    const strength = opts.strength == null ? 1 : opts.strength;
    const now = performance.now();
    if (burstLevel(now) > strength) return;
    Object.assign(state.burst, { start: now, len: opts.ms || 650, strength });
  }

  function burstLevel(now) {
    const b = state.burst;
    const p = (now - b.start) / b.len;
    if (p < 0 || p > 1) return 0;
    const stutter = Math.sin(now * 0.09) * Math.sin(now * 0.053 + 1.3) > -0.2 ? 1 : 0.35;
    return b.strength * Math.pow(1 - p, 0.6) * stutter * (reduced ? 0.3 : 1);
  }

  function palette() {
    const id = state.mood || document.documentElement.dataset.theme || "neutral";
    return { colours: PALETTES[id] || PALETTES.neutral, haze: HAZE[id] || HAZE.neutral };
  }

  // --- the faults: things that go wrong and stay wrong for a while -----------------

  /* Start new faults, more and longer-lived the more broken it is. */
  function spawn(now, d, jolt, w, h, unit) {
    const dt = Math.min(100, now - state.lastNow);
    // Expected new faults per second: none when fresh, a handful when broken, a burst on a jolt.
    const rate = Math.pow(Math.max(0, d - 0.08), 1.4) * 14 + jolt * 40;
    let n = rate * (dt / 1000);
    const cap = 12 + Math.floor(d * 70);
    const cols = palette().colours;
    while (n > 0 && state.faults.length < cap) {
      if (R() > n) break;
      n -= 1;
      const life = (200 + R() * 1400) * (0.4 + d * 2.2);
      const kind = R();
      const f = { born: now, life };
      if (kind < 0.32) {
        // A row smeared sideways from one stuck pixel.
        Object.assign(f, { type: "smear", x: R() * w * 0.8, y: R() * h, h: (1 + R() * (4 + d * 26)) * unit });
      } else if (kind < 0.55 && d > 0.2) {
        // A column dripping down from one row, longer as it lives.
        Object.assign(f, { type: "drip", x: R() * w, y: R() * h * 0.8, w: (2 + R() * (6 + d * 40)) * unit, life: life * 1.6 });
      } else if (kind < 0.8 && d > 0.25) {
        // A block of the last picture stuck in place and sliding (datamosh).
        const s = Math.round((12 + R() * (24 + d * 90)) * unit);
        Object.assign(f, { type: "mosh", x: R() * w, y: R() * h, w: s * (1 + Math.floor(R() * 3)), h: s, mx: (R() - 0.5) * 6 * unit, my: (R() - 0.6) * 4 * unit });
      } else if (d > 0.4) {
        // A block gone to flat bands of colour; near the end some never come back.
        const bw = (30 + R() * (60 + d * 260)) * unit;
        const bands = [];
        for (let i = 0, k = 1 + Math.floor(R() * 6); i < k; i++) bands.push(cols[Math.floor(R() * cols.length)]);
        Object.assign(f, { type: "dead", x: R() * w, y: R() * h, w: bw, h: (4 + R() * (20 + d * 80)) * unit, bands, life: d > 0.8 && R() < 0.3 ? Infinity : life });
      } else {
        Object.assign(f, { type: "smear", x: R() * w * 0.8, y: R() * h, h: (1 + R() * 6) * unit });
      }
      state.faults.push(f);
    }
    state.faults = state.faults.filter((f) => now - f.born < f.life);
  }

  function drawFaults(ctx, now, b, w, h) {
    for (const f of state.faults) {
      const age = (now - f.born) / (f.life === Infinity ? 8000 : f.life);
      if (f.type === "smear") {
        const x = Math.floor(f.x);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(b.frame, x, f.y, 2, f.h, x, f.y, w - x, f.h);
      } else if (f.type === "drip") {
        const len = Math.min(h - f.y, (0.1 + Math.min(1, age) * 0.9) * h * 0.7);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(b.frame, f.x, f.y, f.w, 2, f.x, f.y, f.w, len);
      } else if (f.type === "mosh") {
        // Copied from the last picture shown, a little to the side: it keeps itself going.
        ctx.globalAlpha = 1;
        ctx.drawImage(b.prev, f.x - f.mx, f.y - f.my, f.w, f.h, f.x, f.y, f.w, f.h);
        if (now - f.born > 120) {
          f.x += f.mx * 0.3;
          f.y += f.my * 0.3;
        }
      } else if (f.type === "dead") {
        const bh = f.h / f.bands.length;
        ctx.globalAlpha = 0.92;
        f.bands.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(f.x, f.y + i * bh, f.w, Math.ceil(bh));
        });
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- the scratch canvases ------------------------------------------------------------

  const scratch = new WeakMap();
  function buffers(canvas) {
    let b = scratch.get(canvas);
    if (!b || b.w !== canvas.width || b.h !== canvas.height) {
      const make = (cw, ch) => {
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        return c;
      };
      const w = canvas.width;
      const h = canvas.height;
      b = { w, h, frame: make(w, h), chan: make(w, h), prev: make(w, h), haze: make(Math.max(1, w >> 4), Math.max(1, h >> 4)), haze2: make(Math.max(1, w >> 6), Math.max(1, h >> 6)) };
      for (const k of ["frame", "chan", "prev", "haze", "haze2"]) b[k + "Ctx"] = b[k].getContext("2d");
      b.prevCtx.fillStyle = "#000";
      b.prevCtx.fillRect(0, 0, w, h);
      scratch.set(canvas, b);
    }
    return b;
  }

  // Snow: a tile of coloured noise, stretched sideways so it streaks like a bad tape.
  // On white paper it is the negative: mostly white, with specks of ink.
  const SNOW = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      const hot = v > 0.82;
      img.data[i] = hot ? 120 + Math.random() * 135 : v * 90;
      img.data[i + 1] = hot ? Math.random() * 255 : v * 70;
      img.data[i + 2] = hot ? 140 + Math.random() * 115 : v * 120;
      if (LIGHT) for (let k = 0; k < 3; k++) img.data[i + k] = 255 - img.data[i + k] * 0.8;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();

  // --- the frame -------------------------------------------------------------------

  let burstClass = false;
  function markBurst(on) {
    if (on === burstClass) return;
    burstClass = on;
    document.documentElement.classList.toggle("signal-burst", on);
  }

  /* Break what is on the canvas, in place. */
  function post(canvas, now, opts) {
    opts = opts || {};
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const d = decay(now);
    if (now > state.nextIdle) {
      // Left alone it still twitches now and then, more often the worse it is.
      state.nextIdle = now + (9000 - d * 6500) * (0.5 + R());
      if (d > 0.05) kick({ strength: 0.2 + d * 0.6 + R() * 0.2, ms: 200 + R() * 600 });
    }
    const jolt = burstLevel(now);
    const rebootAge = now - state.rebooted;
    const reboot = rebootAge < 900 ? 1 - rebootAge / 900 : 0;
    const lv = Math.min(1, jolt + reboot * 0.6 + (opts.extra || 0));
    markBurst(lv > 0.15);
    const unit = h / 1080;
    const t = now / 1000;
    const b = buffers(canvas);
    const pal = palette();

    b.frameCtx.globalCompositeOperation = "copy";
    b.frameCtx.drawImage(canvas, 0, 0);

    // 1. The picture in rows: a slow sway, the tracking band, wide tears on a jolt,
    //    and the red, green and blue drawn apart.
    const slice = Math.max(2, Math.round(h / 140));
    const track = (((t * 0.045) % 1.35) - 0.15) * h;
    const trackH = h * (0.03 + d * 0.06);
    const rr = random((Math.floor(now / 70) * 40503 + 17) >>> 0);
    const tears = [];
    const count = lv > 0 ? 2 + Math.floor(lv * 7) : 0;
    for (let i = 0; i < count; i++) tears.push({ y: rr() * h, h: (0.01 + rr() * 0.08) * h, shift: (rr() - 0.5) * w * 0.14 * lv, chroma: (rr() - 0.5) * 30 * unit * lv });
    const calm = reduced ? 0.4 : 1;
    const sway = (1 + d * 3) * calm;
    const bands = [];
    for (let y = 0; y < h; y += slice) {
      let shift = (Math.sin(y * 0.011 / unit + t * 1.3) * 1.2 + Math.sin(y * 0.0023 / unit - t * 0.45) * 1.8) * unit * sway;
      let chroma = 0;
      const dist = Math.abs(y - track);
      if (dist < trackH) {
        const k = 1 - dist / trackH;
        shift += Math.sin(y * 0.7 + t * 31) * (6 + d * 20) * unit * k * calm;
        chroma += (2 + d * 6) * unit * k;
      }
      for (const tear of tears) {
        if (y >= tear.y && y < tear.y + tear.h) {
          shift += tear.shift;
          chroma += tear.chroma;
        }
      }
      if (reboot) shift += Math.sin(y * 0.02 + t * 40) * 30 * unit * reboot; // the degauss wobble
      bands.push({ y, h: Math.min(slice, h - y), shift, chroma });
    }
    const split = (1.2 + d * 5 + lv * 12) * unit * (opts.split == null ? 1 : opts.split);

    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const [colour, dir] of [["#ff0000", -1], ["#00ff00", 0], ["#0000ff", 1]]) {
      b.chanCtx.globalCompositeOperation = "copy";
      b.chanCtx.drawImage(b.frame, 0, 0);
      b.chanCtx.globalCompositeOperation = "multiply";
      b.chanCtx.fillStyle = colour;
      b.chanCtx.fillRect(0, 0, w, h);
      for (const band of bands) {
        const dx = Math.round(band.shift + dir * (split + band.chroma));
        ctx.drawImage(b.chan, 0, band.y, w, band.h, dx, band.y, w, band.h);
      }
    }

    // 2. Ghosts: the last picture shown, drifting up and fading, so movement smears
    //    (on white paper, ink trails).
    ctx.globalCompositeOperation = LIGHT ? "multiply" : "screen";
    ctx.globalAlpha = Math.min(0.7, 0.12 + d * 0.5 + lv * 0.15);
    ctx.drawImage(b.prev, (R() - 0.5) * 2 * unit * (1 + d * 3), -(0.6 + d * 2.5) * unit);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 3. The faults.
    spawn(now, d, jolt, w, h, unit);
    b.frameCtx.drawImage(canvas, 0, 0); // what the faults copy from: this frame so far
    drawFaults(ctx, now, b, w, h);
    // Remember the picture for next frame's ghosts and stuck blocks, before the snow
    // and haze go on, so those don't pile up frame after frame into a grey fog.
    b.prevCtx.globalCompositeOperation = "copy";
    b.prevCtx.drawImage(canvas, 0, 0);

    // 4. Snow, streaked sideways, thicker as it goes and on a jolt.
    ctx.globalCompositeOperation = LIGHT ? "multiply" : "screen";
    ctx.globalAlpha = Math.min(0.4, 0.03 + d * 0.14 + lv * 0.22) * (LIGHT ? 0.8 : 1);
    const sx = Math.floor(R() * 256);
    const sy = Math.floor(R() * 256);
    const stretch = 3 + d * 8;
    for (let y = -sy; y < h; y += 256) {
      for (let x = -sx * stretch; x < w; x += 256 * stretch) ctx.drawImage(SNOW, x, y, 256 * stretch, 256);
    }

    // 5. The haze: the picture bloomed (drawn tiny and back up) and the blacks lifted.
    //    On white paper: the ink bleeds, and the white tints towards blue.
    b.hazeCtx.globalCompositeOperation = "copy";
    b.hazeCtx.drawImage(canvas, 0, 0, b.haze.width, b.haze.height);
    b.haze2Ctx.globalCompositeOperation = "copy";
    b.haze2Ctx.drawImage(b.haze, 0, 0, b.haze2.width, b.haze2.height);
    ctx.globalAlpha = (0.3 + d * 0.25) * (LIGHT ? 0.45 : 1);
    ctx.drawImage(b.haze, 0, 0, w, h);
    ctx.globalAlpha = (0.25 + d * 0.3) * (LIGHT ? 0.35 : 1);
    ctx.drawImage(b.haze2, 0, 0, w, h);
    ctx.globalAlpha = LIGHT ? 0.18 + d * 0.5 : 0.05 + d * 0.12;
    ctx.fillStyle = pal.haze;
    ctx.fillRect(0, 0, w, h);

    // 6. Losing vertical hold: near the end the picture slips and rolls, with the
    //    black blanking bar going past.
    const dt = Math.min(100, now - state.lastNow);
    if (d > 0.6 && jolt > 0.5 && state.rollSpeed === 0 && R() < 0.3) state.rollSpeed = (0.3 + R() * 1.2) * h;
    if (state.rollSpeed) {
      state.roll += (state.rollSpeed * dt) / 1000;
      state.rollSpeed *= 0.985;
      if (state.rollSpeed < h * 0.05 && state.roll % h < h * 0.04) {
        state.rollSpeed = 0;
        state.roll = 0;
      }
    }
    const roll = Math.round(state.roll % h);
    if (roll) {
      b.frameCtx.drawImage(canvas, 0, 0);
      ctx.globalCompositeOperation = "copy";
      ctx.globalAlpha = 1;
      ctx.drawImage(b.frame, 0, roll - h);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(b.frame, 0, roll);
      ctx.fillStyle = LIGHT ? "#0b159e" : "#000";
      ctx.fillRect(0, roll - 18 * unit, w, 36 * unit);
    }

    // A few bright dropout lines on a jolt.
    ctx.globalCompositeOperation = "source-over";
    if (lv > 0.2) {
      ctx.fillStyle = LIGHT ? pal.colours[0] : "#ffffff";
      for (let i = 0; i < 1 + lv * 5; i++) {
        ctx.globalAlpha = 0.25 + rr() * 0.5;
        ctx.fillRect(rr() * w * 0.6, rr() * h, w * (0.1 + rr() * 0.5), Math.max(1, unit * 1.5));
      }
    }
    ctx.restore();
    state.lastNow = now;
    warpText(now, d, lv);
    document.documentElement.style.setProperty("--decay", d.toFixed(3));
  }

  // --- the page's own text: an SVG filter that wavers and splits -----------------------

  let svg = null;
  let lastWarp = 0;
  function makeFilter() {
    const NS = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    // Shift sideways by noise (green held at the middle, so nothing moves up or down),
    // draw red, green and blue apart, and add a soft glow (not on white paper, where
    // it would only wash the ink out).
    svg.innerHTML = `
      <filter id="signal-warp" x="-4%" y="-10%" width="108%" height="120%" color-interpolation-filters="sRGB">
        <feTurbulence id="signal-noise" type="fractalNoise" baseFrequency="0.0008 0.22" numOctaves="1" seed="3" result="noise"/>
        <feColorMatrix in="noise" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="sideways"/>
        <feDisplacementMap id="signal-shift" in="SourceGraphic" in2="sideways" scale="2" xChannelSelector="R" yChannelSelector="G" result="moved"/>
        <feColorMatrix in="moved" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
        <feColorMatrix in="moved" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
        <feColorMatrix in="moved" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
        <feOffset id="signal-r" in="r" dx="-1" result="r2"/>
        <feOffset id="signal-b" in="b" dx="1" result="b2"/>
        <feComposite in="r2" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>
        <feComposite in="rg" in2="b2" operator="arithmetic" k2="1" k3="1" result="rgb"/>
        <feGaussianBlur id="signal-glow" in="rgb" stdDeviation="2" result="glow"/>
        <feComposite in="rgb" in2="glow" operator="arithmetic" k2="1" k3="${LIGHT ? 0 : 0.8}"/>
      </filter>`;
    document.body.appendChild(svg);
  }

  function warpText(now, d, lv) {
    if (!document.body) return;
    if (!svg) makeFilter();
    if (now - lastWarp < 90) return; // about ten changes a second is plenty for text
    lastWarp = now;
    const q = (id) => svg.querySelector("#" + id);
    const shake = (2 + d * 14 + lv * 40) * (reduced ? 0.3 : 1);
    q("signal-noise").setAttribute("seed", String(Math.floor(R() * 1000)));
    q("signal-noise").setAttribute("baseFrequency", `0.0008 ${(0.12 + R() * 0.2).toFixed(3)}`);
    q("signal-shift").setAttribute("scale", shake.toFixed(1));
    const s = (1 + d * 3 + lv * 6).toFixed(1);
    q("signal-r").setAttribute("dx", "-" + s);
    q("signal-b").setAttribute("dx", s);
    q("signal-glow").setAttribute("stdDeviation", (1.5 + d * 3).toFixed(1));
  }

  // Alt+D: a fifth more broken (from fully broken, back to fresh), to preview the decay.
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyD") {
      e.preventDefault();
      const d = decay(performance.now());
      if (d >= 0.99) reset();
      else wear(Math.min(1, Math.round((d + 0.2) * 5) / 5));
      kick({ strength: 0.8 });
    }
  });

  Oracle.signal = {
    light: LIGHT,
    post,
    kick,
    wear,
    reset,
    /* The palette to break into: a mask id, or null to follow the screen's theme. */
    set mood(id) {
      state.mood = id || null;
    },
    get decay() {
      return decay(performance.now());
    },
  };
})();
