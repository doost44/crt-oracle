/* The Oracle's room voices: speech that sounds like it is somewhere. Each mask
 * speaks in its own space, with reverb and an echo:
 *
 *   SUGAR     a bright hall, a sweet slap-back echo
 *   WEARY     a deep, dark cave; the echo keeps going after it has stopped caring
 *   CLINICAL  a small hard room; a short metallic flutter, like a lab intercom
 *
 * The browser's own voices (speechSynthesis) play straight to the speakers and
 * can't be routed through effects, so these voices come from meSpeak (eSpeak in
 * the browser, web/vendor/mespeak/, fetched by tools/fetch_voices.py). It speaks
 * into a sound buffer, which goes through Web Audio: dry voice, a convolution
 * reverb whose impulse is made here from decaying noise, and a feedback delay.
 *
 * The masks are one mind, so the voices glitch into each other: under every line
 * the other two masks say the same words, silent except for short torn-in slices
 * where they cut through and the speaking voice drops out, and now and then a
 * fragment stutters. Just after a switch the mask that was speaking bleeds
 * through for a moment.
 *
 *   const room = new Oracle.RoomVoice();
 *   await room.load()            -> true when the voices are there
 *   room.unlock()                // inside a click: browsers start audio on a gesture
 *   await room.speak(text, mask, { from }) // resolves when the words end (the room rings on)
 *                                           // from: the mask that spoke last, to bleed through
 *   room.stop()
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const VOICES_VERSION = "2.0.2"; // keep in step with VERSION in tools/fetch_voices.py
  const BASE = "vendor/mespeak/";

  // eSpeak settings (variant, pitch 0-99, speed in words per minute) and the space.
  //   reverb: seconds of tail, decay curve (higher dies faster), wet level, tone (Hz)
  //   echo:   delay seconds, feedback, level, tone (Hz) of each repeat
  const MASKS = {
    sugar: {
      speech: { variant: "f5", pitch: 78, speed: 158, amplitude: 120 },
      reverb: { seconds: 1.0, decay: 3.5, wet: 0.07, tone: 6500 },
      echo: { time: 0.24, feedback: 0.08, level: 0.04, tone: 4200 },
    },
    weary: {
      speech: { variant: "m3", pitch: 18, speed: 112, amplitude: 120, wordgap: 2 },
      reverb: { seconds: 1.6, decay: 3.5, wet: 0.1, tone: 1600 },
      echo: { time: 0.38, feedback: 0.1, level: 0.05, tone: 1400 },
    },
    clinical: {
      speech: { variant: "klatt3", pitch: 46, speed: 165, amplitude: 120 },
      reverb: { seconds: 0.45, decay: 5, wet: 0.06, tone: 9000 },
      echo: { time: 0.07, feedback: 0.15, level: 0.04, tone: 7000 },
    },
  };

  // The glitches between voices.
  //   perSecond   torn-in slices of another mask, on average, per second of speech
  //   slice       how long each lasts, seconds (min, max)
  //   stutter     chance that a glitch is a stutter of the speaking voice instead
  //   bleed       level of the last mask under the first moments after a switch
  //   bleedFor    seconds that bleed takes to fade
  const GLITCH = { perSecond: 0.9, slice: [0.06, 0.2], stutter: 0.3, bleed: 0.35, bleedFor: 1.6 };

  const url = (p) => new URL(p, document.baseURI).href;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("could not load " + src));
      document.head.appendChild(s);
    });
  }

  /* A reverb impulse: stereo noise under an exponential decay, softened by a
   * running low-pass so dark rooms are dark. */
  function impulse(ctx, spec) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * spec.seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const k = Math.min(1, (2 * Math.PI * spec.tone) / ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += k * (Math.random() * 2 - 1 - lp);
        data[i] = lp * Math.pow(1 - i / len, spec.decay);
      }
    }
    return buf;
  }

  class RoomVoice {
    constructor(opts) {
      opts = opts || {};
      this.base = opts.base || BASE;
      this.ready = false;
      this.ctx = null;
      this.rooms = {};
      this.playing = new Set();
    }

    /* Load meSpeak and its English voice. Resolves false when they aren't there. */
    async load() {
      if (this.ready) return true;
      if (this._loading) return this._loading;
      this._loading = (async () => {
        try {
          const version = await fetch(url(this.base + "VERSION"), { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
          if (version.trim() !== VOICES_VERSION) return false;
          if (!window.meSpeak) await loadScript(url(this.base + "mespeak.js"));
          const [config, voice] = await Promise.all(
            ["mespeak_config.json", "en.json"].map((f) => fetch(url(this.base + f)).then((r) => r.json()))
          );
          window.meSpeak.loadConfig(config);
          window.meSpeak.loadVoice(voice);
          this.ready = window.meSpeak.isConfigLoaded() && window.meSpeak.isVoiceLoaded("en/en");
        } catch (err) {
          console.warn("Oracle room voices:", err);
          this.ready = false;
        }
        return this.ready;
      })();
      return this._loading;
    }

    /* Make (or wake) the audio output. Call it inside a click. */
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();
    }

    /* The dry speech for `text` in the mask's voice, as an AudioBuffer. */
    async render(text, mask) {
      const spec = (MASKS[mask] || MASKS.clinical).speech;
      const words = Oracle.Voice && Oracle.Voice.speakable ? Oracle.Voice.speakable(text) : String(text);
      const wav = window.meSpeak.speak(words, Object.assign({ voice: "en/en", rawdata: "arraybuffer" }, spec));
      if (!wav) throw new Error("no speech");
      const ctx = this.ctx || new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 22050);
      return ctx.decodeAudioData(wav);
    }

    /* Each mask's space: dry, reverb and echo, mixed into a limiter. Built once
     * for the live output; `ctx` builds a fresh one (for renderRoom). */
    _room(mask, ctx) {
      const live = !ctx;
      if (live && this.rooms[mask]) return this.rooms[mask];
      ctx = ctx || this.ctx;
      const spec = MASKS[mask] || MASKS.clinical;
      const input = ctx.createGain();
      const out = ctx.createDynamicsCompressor();
      out.threshold.value = -14;
      out.ratio.value = 4;
      out.connect(ctx.destination);

      const dry = ctx.createGain();
      dry.gain.value = 0.85;
      input.connect(dry).connect(out);

      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx, spec.reverb);
      const wet = ctx.createGain();
      wet.gain.value = spec.reverb.wet;
      input.connect(verb);
      verb.connect(wet).connect(out);

      // The echo: each repeat a little duller, and the repeats ring in the room too.
      const delay = ctx.createDelay(2);
      delay.delayTime.value = spec.echo.time;
      const feedback = ctx.createGain();
      feedback.gain.value = spec.echo.feedback;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = spec.echo.tone;
      const echo = ctx.createGain();
      echo.gain.value = spec.echo.level;
      input.connect(delay);
      delay.connect(tone).connect(feedback).connect(delay);
      tone.connect(echo);
      echo.connect(out);
      echo.connect(verb);

      if (live) this.rooms[mask] = input;
      return input;
    }

    /* The line in the speaking mask's voice, and the same words in the other two. */
    async _voices(text, mask) {
      mask = MASKS[mask] ? mask : "clinical";
      const main = await this.render(text, mask);
      const ghosts = {};
      for (const other of Object.keys(MASKS)) if (other !== mask) ghosts[other] = await this.render(text, other);
      return { mask, main, ghosts };
    }

    /* Schedule a line and its glitches into `dest` on `ctx`, starting at t0.
     * Returns the speaking voice's source (its end is the end of the words). */
    _schedule(ctx, dest, v, t0, from, random) {
      random = random || Math.random;
      const dur = v.main.duration;
      const source = (buffer, rate) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate || 1;
        return src;
      };

      const mainGain = ctx.createGain();
      mainGain.connect(dest);
      const main = source(v.main);
      main.connect(mainGain);
      main.start(t0);

      // The other masks say the same words, stretched to the same length, muted
      // except where they tear through.
      const ghostGains = {};
      const ghosts = [];
      for (const [other, buffer] of Object.entries(v.ghosts)) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        if (other === from) {
          g.gain.setValueAtTime(GLITCH.bleed, t0);
          g.gain.linearRampToValueAtTime(0, t0 + Math.min(GLITCH.bleedFor, dur));
        }
        g.connect(dest);
        const src = source(buffer, buffer.duration / dur);
        src.connect(g);
        src.start(t0);
        ghostGains[other] = g;
        ghosts.push(src);
      }

      // The glitches: hard cuts, no fades, like a tape jumping between voices.
      const names = Object.keys(ghostGains);
      const count = Math.round(dur * GLITCH.perSecond * (0.6 + random() * 0.8));
      for (let i = 0; i < count; i++) {
        const len = GLITCH.slice[0] + random() * (GLITCH.slice[1] - GLITCH.slice[0]);
        const at = 0.15 + random() * Math.max(0.01, dur - len - 0.3);
        if (random() < GLITCH.stutter) {
          // The speaking voice catches on a fragment and repeats it.
          for (let k = 1; k <= 2; k++) {
            const rep = source(v.main);
            const g = ctx.createGain();
            g.gain.value = 0.8 / k;
            rep.connect(g).connect(dest);
            rep.start(t0 + at + len * k, at, len);
          }
        } else {
          const g = ghostGains[names[Math.floor(random() * names.length)]].gain;
          g.setValueAtTime(0.95, t0 + at);
          g.setValueAtTime(0, t0 + at + len);
          mainGain.gain.setValueAtTime(0.12, t0 + at);
          mainGain.gain.setValueAtTime(1, t0 + at + len);
        }
      }
      return { main, ghosts };
    }

    /* The line with its room and glitches, rendered offline: an AudioBuffer
     * including the tail. For tests, and for listening without the page. */
    async renderRoom(text, mask, opts) {
      opts = opts || {};
      const v = await this._voices(text, mask);
      const spec = MASKS[v.mask];
      const rate = opts.sampleRate || v.main.sampleRate;
      const tail = spec.reverb.seconds + spec.echo.time * 8 + GLITCH.slice[1] * 3;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new OAC(2, Math.ceil((v.main.duration + tail) * rate), rate);
      this._schedule(ctx, this._room(v.mask, ctx), v, 0, opts.from, opts.random);
      return ctx.startRendering();
    }

    /* Say `text` in the mask's voice and room, with the other masks glitching
     * through. Resolves when the words end; the room rings on. */
    async speak(text, mask, opts) {
      if (!this.ready) throw new Error("room voices not loaded");
      opts = opts || {};
      this.unlock();
      const v = await this._voices(text, mask);
      const { main, ghosts } = this._schedule(this.ctx, this._room(v.mask), v, this.ctx.currentTime + 0.03, opts.from);
      const all = [main, ...ghosts];
      all.forEach((src) => this.playing.add(src));
      await new Promise((resolve) => {
        const cap = setTimeout(resolve, v.main.duration * 1000 + 1500);
        main.onended = () => {
          clearTimeout(cap);
          all.forEach((src) => this.playing.delete(src));
          resolve();
        };
      });
    }

    stop() {
      this.playing.forEach((src) => {
        try {
          src.stop();
        } catch (e) {
          /* already stopped */
        }
      });
      this.playing.clear();
    }
  }

  RoomVoice.MASKS = MASKS;
  RoomVoice.GLITCH = GLITCH;
  Oracle.RoomVoice = RoomVoice;
})();
