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
 *   const room = new Oracle.RoomVoice();
 *   await room.load()            -> true when the voices are there
 *   room.unlock()                // inside a click: browsers start audio on a gesture
 *   await room.speak(text, mask) // resolves when the words end (the room rings on)
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
      reverb: { seconds: 2.6, decay: 2.4, wet: 0.42, tone: 6500 },
      echo: { time: 0.29, feedback: 0.3, level: 0.28, tone: 4200 },
    },
    weary: {
      speech: { variant: "m3", pitch: 18, speed: 112, amplitude: 120, wordgap: 2 },
      reverb: { seconds: 5.5, decay: 2.2, wet: 0.62, tone: 1400 },
      echo: { time: 0.62, feedback: 0.48, level: 0.42, tone: 1300 },
    },
    clinical: {
      speech: { variant: "klatt3", pitch: 46, speed: 165, amplitude: 120 },
      reverb: { seconds: 0.9, decay: 4.5, wet: 0.34, tone: 9000 },
      echo: { time: 0.085, feedback: 0.55, level: 0.32, tone: 7000 },
    },
  };

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

    /* The line with its room, rendered offline: an AudioBuffer including the
     * tail. For tests, and for listening to the masks without the page. */
    async renderRoom(text, mask, sampleRate) {
      const dry = await this.render(text, mask);
      const spec = MASKS[mask] || MASKS.clinical;
      const rate = sampleRate || dry.sampleRate;
      const tail = spec.reverb.seconds + spec.echo.time * 8;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new OAC(2, Math.ceil((dry.duration + tail) * rate), rate);
      const src = ctx.createBufferSource();
      src.buffer = dry;
      src.connect(this._room(mask, ctx));
      src.start();
      return ctx.startRendering();
    }

    /* Say `text` in the mask's voice and room. Resolves when the words end; the
     * reverb and echo ring on under whatever comes next. */
    async speak(text, mask) {
      if (!this.ready) throw new Error("room voices not loaded");
      this.unlock();
      const buffer = await this.render(text, mask);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this._room(mask));
      this.playing.add(src);
      await new Promise((resolve) => {
        const cap = setTimeout(resolve, buffer.duration * 1000 + 1500);
        src.onended = () => {
          clearTimeout(cap);
          this.playing.delete(src);
          resolve();
        };
        src.start();
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
  Oracle.RoomVoice = RoomVoice;
})();
