/* The Oracle's sounds, all synthesised with Web Audio: no audio files.
 *
 *   Oracle.sound.scene(name, opts)  "boot" | "hallway" | "face"; sets the background bed
 *   Oracle.sound.tick()             one teletype tick (the Oracle typing)
 *   Oracle.sound.key(enter)         a key click (the visitor typing); heavier for Enter
 *   Oracle.sound.print(seconds, steps)  the thermal printer feeding paper
 *   Oracle.sound.toggleMute()       also Ctrl+M
 *
 * Always on, quietly: the CRT's mains hum and a faint flyback whine.
 * Browsers keep sound off until the first key press or click; the kiosk launcher
 * passes --autoplay-policy=no-user-gesture-required so the hum starts at once.
 *
 * URL options: ?volume=0.6 (0 to 1), ?sound=0 to start muted.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const params = new URLSearchParams(location.search);
  const VOLUME = clamp01(parseFloat(params.get("volume") || "0.7"));
  const HUM_HZ = 50; // UK mains; 60 in the US

  let ctx = null;
  let master = null;
  let noise = null; // a shared two-second buffer of white noise
  let hiss = null; // the hallway's tape hiss, { gain }
  let muted = params.get("sound") === "0";
  let lastTick = 0;
  let pendingScene = null; // a scene that started before the audio was allowed

  function clamp01(v) {
    return isNaN(v) ? 0.7 : Math.max(0, Math.min(1, v));
  }

  /* Make the audio graph on first use. Returns false if audio isn't available. */
  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(comp);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    startHum();
    startHiss();
    return true;
  }

  function ready() {
    return init() && ctx.state === "running";
  }

  /* Try to start; the browser lets it happen on a key press or click (or always, in kiosk). */
  function unlock() {
    if (!init()) return;
    if (ctx.state === "suspended") ctx.resume().then(flushScene, () => {});
    else flushScene();
  }

  function flushScene() {
    if (pendingScene && ctx.state === "running") {
      const s = pendingScene;
      pendingScene = null;
      scene(s.name, s.opts);
    }
  }

  function gain(value, to) {
    const g = ctx.createGain();
    g.gain.value = value;
    g.connect(to || master);
    return g;
  }

  function noiseSource(loop) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = !!loop;
    return src;
  }

  function filter(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  // --- the bed: hum and hiss -------------------------------------------------------

  function startHum() {
    const bed = gain(0.9);
    // A slow wobble, like the set's supply sagging.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoDepth = gain(0.15, bed.gain);
    lfo.connect(lfoDepth);
    lfo.start();

    const partials = [
      [HUM_HZ, 0.05],
      [HUM_HZ * 2, 0.035],
      [HUM_HZ * 3, 0.012],
    ];
    for (const [hz, level] of partials) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      o.connect(gain(level, bed));
      o.start();
    }
    // A buzzier edge on top, kept dull.
    const buzz = ctx.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.value = HUM_HZ * 2;
    const lp = filter("lowpass", 420, 0.7);
    buzz.connect(lp);
    lp.connect(gain(0.012, bed));
    buzz.start();
    // The flyback transformer's whine (15.6 kHz on a PAL set). Many adults can't hear it.
    const whine = ctx.createOscillator();
    whine.frequency.value = 15625;
    whine.connect(gain(0.0025, bed));
    whine.start();
  }

  function startHiss() {
    const src = noiseSource(true);
    const bp = filter("bandpass", 1800, 0.6);
    const g = gain(0);
    src.connect(bp);
    bp.connect(g);
    src.start();
    hiss = { gain: g };
  }

  function hissTo(level, seconds) {
    const p = hiss.gain.gain;
    const now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(level, now + seconds);
  }

  // --- one-shots ----------------------------------------------------------------------

  /* Switching the set on: a thump, then the degauss coil's falling warble. */
  function degauss() {
    const now = ctx.currentTime;
    const thump = noiseSource(false);
    const lp = filter("lowpass", 160);
    const tg = gain(0);
    thump.connect(lp);
    lp.connect(tg);
    tg.gain.setValueAtTime(0.9, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.start(now);
    thump.stop(now + 0.2);

    const coil = ctx.createOscillator();
    coil.frequency.value = HUM_HZ;
    const cg = gain(0);
    coil.connect(cg);
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.exponentialRampToValueAtTime(0.35, now + 0.05);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    // The warble: the coil's field beating against the hum.
    const wob = ctx.createOscillator();
    wob.frequency.setValueAtTime(9, now);
    wob.frequency.linearRampToValueAtTime(3, now + 1.6);
    const wd = gain(0.2, cg.gain);
    wob.connect(wd);
    coil.start(now);
    wob.start(now);
    coil.stop(now + 1.7);
    wob.stop(now + 1.7);
  }

  function burst(at, length, type, freq, q, level) {
    const src = noiseSource(false);
    const f = filter(type, freq, q);
    const g = gain(0);
    src.connect(f);
    f.connect(g);
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.start(at, Math.random() * 1.5);
    src.stop(at + length + 0.01);
  }

  function thock(at, hz, length, level) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(hz, at);
    o.frequency.exponentialRampToValueAtTime(hz * 0.6, at + length);
    const g = gain(0);
    o.connect(g);
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.start(at);
    o.stop(at + length + 0.01);
  }

  /* The Oracle typing: a dry tick, a little different each time. At most one per 20 ms. */
  function tick() {
    if (!ready()) return;
    const now = ctx.currentTime;
    if (now - lastTick < 0.02) return;
    lastTick = now;
    burst(now, 0.008, "highpass", 2600 + Math.random() * 1400, 0.8, 0.09);
  }

  /* The visitor's keyboard: a click on top of a small plastic thock. */
  function key(enter) {
    if (!ready()) return;
    const now = ctx.currentTime;
    burst(now, enter ? 0.03 : 0.018, "bandpass", enter ? 1500 : 2200 + Math.random() * 600, 1.2, enter ? 0.35 : 0.22);
    thock(now, enter ? 110 : 160 + Math.random() * 30, enter ? 0.07 : 0.04, enter ? 0.3 : 0.15);
  }

  /* A thermal printer feeding paper in `steps` jerks over `seconds` (the receipt animation is 1.5 s, 16 steps). */
  function print(seconds, steps) {
    if (!ready()) return;
    seconds = seconds || 1.5;
    steps = steps || 16;
    const now = ctx.currentTime + 0.05;
    const step = seconds / steps;
    for (let i = 0; i < steps; i++) {
      const at = now + i * step;
      burst(at, step * 0.7, "bandpass", 3200, 2, 0.12); // the head burning a line
      thock(at, 210, step * 0.5, 0.05); // the stepper motor
    }
    // The paper tearing off at the end.
    burst(now + seconds + 0.08, 0.12, "highpass", 1800, 0.7, 0.25);
  }

  // --- scenes ---------------------------------------------------------------------------

  function scene(name, opts) {
    opts = opts || {};
    if (!ready()) {
      pendingScene = { name, opts };
      return;
    }
    if (name === "boot") {
      hissTo(0, 0.4);
      degauss();
    } else if (name === "hallway") {
      // The tape hiss swells as the corridor runs on, then cuts when the face arrives.
      hissTo(0.05, 0.6);
      setTimeout(() => {
        if (ready()) hissTo(0.16, Math.max(0.5, (opts.duration || 8) - 1));
      }, 600);
    } else {
      hissTo(0, 0.15);
    }
  }

  function setMuted(on) {
    muted = !!on;
    if (!ctx) return;
    const p = master.gain;
    p.cancelScheduledValues(ctx.currentTime);
    p.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05);
  }

  // --- input --------------------------------------------------------------------------------

  document.addEventListener(
    "keydown",
    (e) => {
      unlock();
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        setMuted(!muted);
        return;
      }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") Oracle.sound.key(true);
      else if (e.key.length === 1 || e.key === "Backspace") Oracle.sound.key(false);
    },
    true
  );
  document.addEventListener("pointerdown", unlock, true);

  Oracle.sound = {
    scene,
    tick,
    key,
    print,
    unlock,
    get muted() {
      return muted;
    },
    setMuted,
    toggleMute: () => setMuted(!muted),
    get state() {
      return ctx ? ctx.state : "off";
    },
  };
})();
