/* The Oracle's ears and mouth: speech-to-text for the visitor's answers, and
 * (optionally) the browser's built-in voices so the Oracle speaks its lines.
 *
 *   const voice = new Oracle.Voice({ lang: "en-GB" });
 *   voice.canListen                      // false in browsers without speech recognition
 *   await voice.listen({ onHeard, maxMs, silenceMs }) -> "what they said" or null
 *   voice.cancel();                      // stop listening now (listen() resolves null)
 *   await voice.speak(text, personality) // resolves when the line has been spoken
 *   Oracle.Voice.matchChoice("the rock", ["A sun", "A rock", "A tree"]) -> 1
 *
 * Listening uses the Web Speech API (Chrome, Edge). Newer Chrome can transcribe on
 * the laptop itself ("processLocally"); this asks for that first and otherwise
 * falls back to the browser's online service, which sends the audio to Google to
 * transcribe. Our code never records, saves or uploads audio itself.
 *
 * Works in node for the pure parts (matchChoice, speakable) via module.exports.
 */
(function (root) {
  "use strict";

  // --- picking an option by voice ------------------------------------------------

  const NUMBER_WORDS = [
    ["one", "1", "first", "won", "number one"],
    ["two", "2", "second", "to", "too", "number two"],
    ["three", "3", "third", "tree?", "free", "number three"],
    ["four", "4", "fourth", "for", "number four"],
    ["five", "5", "fifth", "number five"],
  ];
  const FILLER = new Set(["a", "an", "the", "um", "uh", "er", "erm", "i", "pick", "choose", "want", "like", "go", "with", "say", "please", "option", "number", "it's", "its", "is"]);

  const words = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean);

  /* Which of `labels` did they say? Matches words from a label ("rock", "the sun")
   * first, then numbers ("two", "the second one"). -1 when it isn't clear. */
  function matchChoice(transcript, labels) {
    const heard = words(transcript);
    if (!heard.length) return -1;
    const heardSet = new Set(heard);

    // Words that belong to one label only: "sun", "rock", "tree".
    const labelWords = labels.map((l) => words(l).filter((w) => !FILLER.has(w)));
    const hits = labelWords.map((ws) => ws.filter((w) => heardSet.has(w) || heardSet.has(w + "s")).length);
    const best = Math.max(...hits);
    if (best > 0 && hits.filter((h) => h === best).length === 1) return hits.indexOf(best);

    // Numbers. "tree?" only counts as three when no label contains "tree".
    const found = new Set();
    // "the second one" is two, not one and two; "the last one" is the last option.
    const text = (" " + heard.join(" ") + " ").replace(/ (first|second|third|fourth|fifth|last) one /g, " $1 ");
    if (/ last /.test(text)) return labels.length - 1;
    NUMBER_WORDS.slice(0, labels.length).forEach((forms, i) => {
      for (let form of forms) {
        const fuzzy = form.endsWith("?");
        form = form.replace("?", "");
        if (fuzzy && labelWords.some((ws) => ws.includes(form))) continue;
        if (text.includes(" " + form + " ")) found.add(i);
      }
    });
    // Ambiguous "to"/"for" next to a real number: trust the real number.
    if (found.size > 1) {
      const strong = [...found].filter((i) => NUMBER_WORDS[i].slice(0, 3).some((f) => text.includes(" " + f + " ") && !["to", "too", "for"].includes(f)));
      if (strong.length === 1) return strong[0];
      return -1;
    }
    return found.size === 1 ? [...found][0] : -1;
  }

  /* Text as it should be spoken: the Oracle SHOUTS IN CAPITALS, which some voices
   * spell out letter by letter, and the ASCII art and >prompts shouldn't be read. */
  function speakable(text) {
    let s = String(text || "").replace(/\[[^\]]*\]/g, " "); // [PLACEHOLDER ...] notes
    const letters = s.replace(/[^A-Za-z]/g, "");
    if (letters && letters === letters.toUpperCase()) {
      s = s.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
      s = s.replace(/\bi\b/g, "I");
    }
    return s.replace(/\.{3,}|…/g, ", ").replace(/\s+/g, " ").trim();
  }

  // How each personality sounds with whatever voice the system has.
  const VOICES = {
    sugar: { pitch: 1.35, rate: 1.05, prefer: ["female", "zira", "aria", "jenny", "samantha", "libby"] },
    weary: { pitch: 0.6, rate: 0.82, prefer: ["male", "david", "guy", "ryan", "george", "daniel"] },
    clinical: { pitch: 1.0, rate: 1.0, prefer: ["mark", "hazel", "susan", "google uk english", "sonia"] },
    default: { pitch: 0.8, rate: 0.95, prefer: ["david", "mark", "google uk english male"] },
  };

  // --- the browser side ------------------------------------------------------------

  const g = root || {};
  const Recognition = g.SpeechRecognition || g.webkitSpeechRecognition || null;

  class Voice {
    constructor(opts) {
      opts = opts || {};
      this.lang = opts.lang || "en-GB";
      this.local = opts.local || "prefer"; // "prefer" | "require" | "off": on-device transcription
      this.speakOn = opts.speak !== false;
      this.canListen = !!Recognition;
      this.canSpeak = !!g.speechSynthesis;
      this.where = null; // "device" or "online", once known
      this._rec = null;
      this._done = null;
      this._localChecked = null;
    }

    /* Is on-device transcription available? Chrome 139+ answers this; older browsers can't. */
    async _checkLocal() {
      if (this._localChecked) return this._localChecked;
      this._localChecked = (async () => {
        if (this.local === "off" || !Recognition || typeof Recognition.available !== "function") return false;
        try {
          const opts = { langs: [this.lang], processLocally: true };
          let status = await Recognition.available(opts);
          if (status === "downloadable" || status === "downloading") {
            // A one-time language pack download. Returns false if it needs a click first.
            const ok = await Recognition.install(opts).catch(() => false);
            status = ok ? "available" : status;
          }
          return status === "available";
        } catch (err) {
          return false;
        }
      })();
      return this._localChecked;
    }

    /* Listen for one answer. Resolves with the text (trimmed), or null when nothing
     * was heard, listening isn't possible, or cancel() was called.
     * opts.onHeard(text, final) is called as words come in, for showing them live. */
    async listen(opts) {
      opts = opts || {};
      if (!this.canListen) return null;
      this.cancel();
      const local = await this._checkLocal();
      if (!local && this.local === "require") return null;
      const maxMs = opts.maxMs || 20000; // the longest an answer can go on
      const silenceMs = opts.silenceMs || 1400; // quiet after speech that ends an answer
      const startMs = opts.startMs || 9000; // how long to wait for them to start
      const onHeard = opts.onHeard || function () {};

      return new Promise((resolve) => {
        const rec = new Recognition();
        rec.lang = this.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        if (local) rec.processLocally = true;
        this.where = local ? "device" : "online";
        this._rec = rec;

        let finalText = "";
        let interim = "";
        let silence = null;
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(silence);
          clearTimeout(cap);
          clearTimeout(nobody);
          rec.onresult = rec.onerror = rec.onend = null;
          try {
            rec.abort();
          } catch (err) {
            /* already stopped */
          }
          if (this._rec === rec) {
            this._rec = null;
            this._done = null;
          }
          const text = value == null ? null : value.replace(/\s+/g, " ").trim();
          resolve(text || null);
        };
        this._done = () => finish(null);
        const current = () => (finalText + " " + interim).trim();
        const cap = setTimeout(() => finish(current()), maxMs);
        const nobody = setTimeout(() => {
          if (!current()) finish(null);
        }, startMs);

        rec.onresult = (e) => {
          interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += " " + r[0].transcript;
            else interim += " " + r[0].transcript;
          }
          clearTimeout(nobody);
          onHeard(current(), !interim.trim());
          clearTimeout(silence);
          silence = setTimeout(() => finish(current()), silenceMs);
        };
        rec.onerror = (e) => {
          // "no-speech" and "aborted" are normal; "not-allowed" means the mic was refused.
          if (e.error === "not-allowed" || e.error === "service-not-allowed") this.canListen = false;
          if (e.error === "language-not-supported" && local) this._localChecked = Promise.resolve(false);
          finish(current());
        };
        // Chrome ends a session on its own after a pause; restart until we decide it's over.
        rec.onend = () => {
          if (settled) return;
          try {
            rec.start();
          } catch (err) {
            finish(current());
          }
        };
        try {
          rec.start();
        } catch (err) {
          finish(null);
        }
      });
    }

    cancel() {
      if (this._done) this._done();
    }

    _pickVoice(personality) {
      const all = g.speechSynthesis.getVoices();
      const lang = this.lang.slice(0, 2);
      const mine = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
      const pool = mine.length ? mine : all;
      const prefer = (VOICES[personality] || VOICES.default).prefer;
      // Offline voices first: no audio round trip, and they work without a network.
      const ranked = pool.slice().sort((a, b) => (b.localService === true) - (a.localService === true));
      for (const word of prefer) {
        const hit = ranked.find((v) => v.name.toLowerCase().includes(word));
        if (hit) return hit;
      }
      return ranked[0] || null;
    }

    async _voicesReady() {
      if (g.speechSynthesis.getVoices().length) return;
      await new Promise((resolve) => {
        const done = () => {
          g.speechSynthesis.removeEventListener("voiceschanged", done);
          resolve();
        };
        g.speechSynthesis.addEventListener("voiceschanged", done);
        setTimeout(done, 1500);
      });
    }

    /* Say `text` aloud in the personality's voice. Resolves when it's finished (or
     * at once when speaking is off or unsupported). */
    async speak(text, personality) {
      if (!this.speakOn || !this.canSpeak) return;
      const words = speakable(text);
      if (!words) return;
      await this._voicesReady();
      const style = VOICES[personality] || VOICES.default;
      const u = new g.SpeechSynthesisUtterance(words);
      const v = this._pickVoice(personality);
      if (v) u.voice = v;
      u.lang = (v && v.lang) || this.lang;
      u.pitch = style.pitch;
      u.rate = style.rate;
      await new Promise((resolve) => {
        const cap = setTimeout(resolve, 2000 + words.length * 120); // never hang the visit on a stuck voice
        u.onend = u.onerror = () => {
          clearTimeout(cap);
          resolve();
        };
        g.speechSynthesis.speak(u);
      });
    }

    stopSpeaking() {
      if (this.canSpeak) g.speechSynthesis.cancel();
    }
  }

  /* A stand-in for tests and for trying the flow without a microphone: answers come
   * from a list, or from window.prompt-free calls to voice.hear("text"). */
  class FakeVoice {
    constructor(answers, opts) {
      opts = opts || {};
      this.answers = (answers || []).slice();
      this.canListen = true;
      this.canSpeak = false;
      this.speakOn = false;
      this.where = "fake";
      this.delayMs = opts.delayMs != null ? opts.delayMs : 300;
      this.spoken = [];
      this._pending = null;
    }
    listen(opts) {
      opts = opts || {};
      return new Promise((resolve) => {
        const deliver = (text) => {
          this._pending = null;
          if (text) (opts.onHeard || function () {})(text, true);
          resolve(text || null);
        };
        this._pending = deliver;
        if (this.answers.length) {
          const next = this.answers.shift();
          setTimeout(() => this._pending === deliver && deliver(next), this.delayMs);
        }
      });
    }
    hear(text) {
      if (this._pending) this._pending(text);
    }
    cancel() {
      if (this._pending) this._pending(null);
    }
    async speak(text) {
      this.spoken.push(text);
    }
    stopSpeaking() {}
  }

  const exported = { Voice, FakeVoice, matchChoice, speakable, VOICES };
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root) {
    const Oracle = (root.Oracle = root.Oracle || {});
    Voice.matchChoice = matchChoice;
    Voice.speakable = speakable;
    Oracle.Voice = Voice;
    Oracle.FakeVoice = FakeVoice;
  }
})(typeof window !== "undefined" ? window : null);
