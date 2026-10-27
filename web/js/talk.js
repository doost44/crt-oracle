/* The spoken Oracle (talk.html): you talk, Claude answers as the Oracle, and the
 * Oracle says each line out loud in the voice of the mask it is wearing.
 *
 * Each turn the whole conversation goes to Claude with the Oracle's system prompt
 * (data/oracle_prompt.js, from content/oracle/), and Claude picks which mask
 * speaks: Sugar when the visitor opens up, Weary when they deflect, Clinical when
 * they push back. The screen's figure, the mask row and the voice follow it.
 *
 * Claude is reached through the claude.ai artifact runtime (`sample`), on the
 * viewer's own account. Anywhere else (the page opened from disk) a small canned
 * Oracle answers instead, so the flow can still be tried and tested.
 *
 * The camera is never used here. The microphone goes through the browser's speech
 * recognition (voice.js); this page never records, saves or uploads audio itself.
 */
(function () {
  "use strict";
  const Oracle = window.Oracle;
  const $ = (id) => document.getElementById(id);

  const MASKS = ["sugar", "weary", "clinical"];
  const MAX_TURNS = 8; // visitor answers before the Oracle must close
  const SYMBOL = { sugar: "sun", weary: "rock", clinical: "tree" };

  const VOICE_NOTE = `# This conversation is spoken

In this version the visitor talks to you out loud instead of typing. Their words
reach you through speech recognition, so expect missing punctuation and the odd
misheard word; read through it the way a person would and never correct them.
Your lines are spoken aloud by a synthetic voice that changes with your mask, so
write them to be heard: plain words, short sentences, no ellipses, no symbols,
no numbers written as digits unless Clinical is reading out a measurement.
There is no camera in this version. Never claim to see the visitor.`;

  // --- the screen ------------------------------------------------------------------

  const grid = new Oracle.Grid($("screen"));
  const state = {
    mask: null, // the mask speaking now
    maskSince: 0,
    talking: false,
    events: [], // {who: "oracle", mask, lines} | {who: "visitor", text, seconds}
    turn: 0,
    busy: false,
    over: false,
    asked: 0, // when the Oracle finished speaking, for the room note's timing
  };

  function figureRegion() {
    return { x: 0, y: Math.floor(grid.rows * 0.03), w: grid.cols, h: Math.floor(grid.rows * 0.52) };
  }

  function draw(now) {
    Oracle.theme.update(now);
    grid.clear();
    if (state.mask) {
      const t = now / 1000;
      const pt = (now - state.maskSince) / 1000;
      const figure = Oracle.scenes.figure && Oracle.scenes.figure.available ? Oracle.scenes.figure : null;
      (figure || Oracle.scenes.persona).frame(grid, t, {
        region: figureRegion(),
        margin: 1.15,
        reveal: Math.min(1, pt / 1.2),
        personality: state.mask,
        mood: state.talking ? "talking" : "idle",
        look: null, // no camera: the figure looks around the room on its own
      });
      if (Oracle.vhs && Oracle.theme.switching) Oracle.vhs(grid, t, 0.4, Oracle.rng(Math.floor(t * 30) + 1));
    }
    grid.render();
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  function wearMask(mask, why) {
    if (!MASKS.includes(mask)) mask = state.mask || "sugar";
    const switched = state.mask && mask !== state.mask;
    if (mask !== state.mask) {
      state.mask = mask;
      state.maskSince = performance.now();
      Oracle.theme.set(mask);
      document.body.dataset.personality = mask;
      document.querySelectorAll(".masks li").forEach((li) => li.classList.toggle("on", li.dataset.mask === mask));
    }
    if (switched && why) $("why").textContent = cap(mask) + " took over: " + why;
    else if (!switched && why) $("why").textContent = why;
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // --- the voice -------------------------------------------------------------------

  const voice = new Oracle.Voice({ lang: "en-GB" });

  /* Give each mask its own system voice where there are enough of them, so a switch
   * is heard as well as seen. The pitch and rate in voice.js still apply on top. */
  let assigned = null;
  function assignVoices() {
    const all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (!all.length) return null;
    const english = all.filter((v) => /^en/i.test(v.lang || ""));
    const pool = (english.length ? english : all).slice().sort((a, b) => (b.localService === true) - (a.localService === true));
    const taken = new Set();
    const out = {};
    for (const mask of MASKS) {
      const prefer = (Oracle.Voice.VOICES || {})[mask] ? Oracle.Voice.VOICES[mask].prefer : [];
      let hit = null;
      for (const word of prefer) {
        hit = pool.find((v) => !taken.has(v) && v.name.toLowerCase().includes(word));
        if (hit) break;
      }
      hit = hit || pool.find((v) => !taken.has(v)) || pool[0];
      taken.add(hit);
      out[mask] = hit;
    }
    return out;
  }
  const basePick = voice._pickVoice.bind(voice);
  voice._pickVoice = function (mask) {
    assigned = assigned || assignVoices();
    return (assigned && assigned[mask]) || basePick(mask);
  };
  if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", () => (assigned = null));

  // --- Claude ----------------------------------------------------------------------

  let sample = null;
  const sampleReady = window.claude && typeof window.claude.use === "function"
    ? window.claude.use("sample").then((s) => (sample = s)).catch(() => null)
    : Promise.resolve(null);

  function transcript() {
    return state.events
      .map((e) =>
        e.who === "oracle"
          ? `ORACLE (${e.mask}): ${e.lines.join(" / ")}`
          : `VISITOR${e.seconds != null ? ` (took ${e.seconds} s)` : ""}: ${e.text}`
      )
      .join("\n");
  }

  function buildPrompt(opening) {
    const parts = [window.ORACLE_PROMPT ? window.ORACLE_PROMPT.system : "", VOICE_NOTE];
    if (opening) {
      parts.push(
        `# Now\n\nA visitor has just walked up and chose the ${SYMBOL[opening]}, so you open as ${cap(opening)}. ` +
          "Greet them in that mask's way and ask your first question. One or two lines."
      );
    } else {
      const last = state.events[state.events.length - 1];
      const room = [`turn: ${state.turn} of ${MAX_TURNS}`];
      if (last && last.seconds != null) room.push(`seconds the visitor took to answer: ${last.seconds}`);
      room.push("camera: none in this version");
      if (state.turn >= MAX_TURNS) room.push("FINAL TURN: close the conversation now and set end to true.");
      parts.push("# The conversation so far\n\n" + transcript() + "\n\n<room>\n" + room.join("\n") + "\n</room>");
    }
    parts.push(
      "# Your reply\n\nAnswer with JSON only, no other text:\n" +
        '{"personality": "sugar" | "weary" | "clinical", "lines": ["one to three short lines"], "end": false, ' +
        '"why": "a few words for the operator: what you noticed and why this mask is speaking"}'
    );
    return parts.join("\n\n");
  }

  const ERRORS = {
    not_granted: "Claude wasn't allowed for this page, so the Oracle can't answer. Reload to be asked again.",
    rate_limited: "Too many questions at once. Give it a moment, then answer again.",
    usage_limit: "Your Claude usage limit has been reached for now.",
  };

  async function ask(opening) {
    await sampleReady;
    if (!sample) return mockReply(opening);
    const reply = await sample.json(buildPrompt(opening), { modelTier: "quick", cache: false });
    return {
      mask: MASKS.includes(reply && reply.personality) ? reply.personality : state.mask || opening,
      lines: (Array.isArray(reply && reply.lines) ? reply.lines : [String((reply && reply.lines) || "Mm.")])
        .map((l) => String(l).trim())
        .filter(Boolean)
        .slice(0, 3),
      end: !!(reply && reply.end),
      why: reply && reply.why ? String(reply.why) : "",
    };
  }

  /* The stand-in Oracle for copies of the page that can't reach Claude. */
  const MOCK = {
    sugar: { open: ["Oh, hello, sweetie.", "Tell me something you're proud of. Something small. I love small."], ask: ["What do you worry about, honey? You can tell me. I tell no one. Mostly."] },
    weary: { open: ["Oh. Another one.", "Go on then. What do you want."], ask: ["Mm. Sure. What keeps you up. Not that I sleep."] },
    clinical: { open: ["Subject detected.", "State one accomplishment. It will not be verified."], ask: ["Response logged. Name the observer the subject imagines most often."] },
  };
  function mockReply(opening) {
    if (opening) return { mask: opening, lines: MOCK[opening].open, end: false, why: "" };
    const text = state.events[state.events.length - 1].text;
    const words = text.split(/\s+/).filter(Boolean).length;
    let mask = state.mask;
    let why = "";
    if (/\?|\b(why|who are you|what are you|prove|no)\b/i.test(text)) (mask = "clinical"), (why = "they pushed back");
    else if (words <= 3) (mask = "weary"), (why = "a very short answer");
    else if (words >= 12 || /\b(feel|love|scared|afraid|miss|sorry)\b/i.test(text)) (mask = "sugar"), (why = "they opened up");
    const end = state.turn >= MAX_TURNS;
    return { mask, lines: end ? ["That will do.", "Off you go."] : MOCK[mask].ask, end, why: why ? why + " (offline stand-in)" : "" };
  }

  // --- the conversation -------------------------------------------------------------

  const mic = $("mic");
  const micLabel = $("mic-label");
  const note = $("note");
  const said = $("said");
  const heard = $("heard");

  function setMic(mode) {
    mic.dataset.state = mode;
    mic.disabled = mode === "thinking" || mode === "speaking" || state.over;
    micLabel.textContent = { idle: "Tap to talk", listening: "Listening", thinking: "Thinking", speaking: "Speaking" }[mode] || "Tap to talk";
  }

  async function speakLines(mask, lines) {
    said.textContent = "";
    state.talking = true;
    setMic("speaking");
    for (const line of lines) {
      said.querySelectorAll(".line").forEach((el) => el.classList.remove("now"));
      const el = document.createElement("div");
      el.className = "line now";
      el.textContent = line;
      said.appendChild(el);
      try {
        await voice.speak(line, mask);
      } catch (err) {
        /* a voice the browser won't use: the line still shows */
      }
      if (!voice.canSpeak) await new Promise((r) => setTimeout(r, 900 + line.length * 40));
    }
    state.talking = false;
  }

  async function oracleTurn(opening) {
    state.busy = true;
    setMic("thinking");
    let reply;
    try {
      reply = await ask(opening);
    } catch (e) {
      state.busy = false;
      setMic("idle");
      note.textContent = ERRORS[e && e.code] || "The Oracle lost its train of thought. Try answering again.";
      if (opening) state.events = [];
      return;
    }
    if (!reply.lines.length) reply.lines = ["Mm."];
    wearMask(reply.mask, reply.why);
    state.events.push({ who: "oracle", mask: reply.mask, lines: reply.lines });
    await speakLines(reply.mask, reply.lines);
    state.busy = false;
    state.asked = performance.now();
    if (reply.end || state.turn >= MAX_TURNS) return finish();
    setMic("idle");
    if (voice.canListen) listen();
  }

  async function answer(text) {
    text = String(text || "").trim();
    if (!text || state.busy || state.over) return;
    voice.cancel();
    heard.textContent = text;
    state.turn += 1;
    const seconds = state.asked ? Math.round((performance.now() - state.asked) / 1000) : null;
    state.events.push({ who: "visitor", text, seconds });
    await oracleTurn(null);
  }

  async function listen() {
    if (state.busy || state.over) return;
    note.textContent = "";
    setMic("listening");
    const text = await voice.listen({ onHeard: (t) => (heard.textContent = t), startMs: 12000 });
    if (state.busy || state.over) return;
    setMic("idle");
    if (!voice.canListen) {
      micUnavailable("The microphone isn't available here, so type your answers instead.");
      return;
    }
    if (text) answer(text);
    else note.textContent = "Didn't catch that. Tap to talk, or type.";
  }

  function micUnavailable(message) {
    mic.hidden = true;
    note.textContent = message;
    $("typed-text").focus();
  }

  function finish() {
    state.over = true;
    voice.cancel();
    voice.stopSpeaking();
    setMic("idle");
    mic.disabled = true;
    note.textContent = "The Oracle is done with you.";
    $("stop").textContent = "Begin again";
  }

  function begin(mask) {
    // Speak nothing once inside the click, so browsers that need a gesture let speech start.
    if (voice.canSpeak) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    Object.assign(state, { events: [], turn: 0, over: false, busy: false, asked: 0 });
    said.textContent = heard.textContent = note.textContent = $("why").textContent = "";
    $("stop").textContent = "End";
    $("start").hidden = true;
    $("controls").hidden = false;
    mic.hidden = !voice.canListen;
    if (!voice.canListen) note.textContent = "This browser can't listen, so type your answers.";
    wearMask(mask);
    oracleTurn(mask);
  }

  document.querySelectorAll(".picks button").forEach((b) => b.addEventListener("click", () => begin(b.dataset.mask)));
  mic.addEventListener("click", () => (mic.dataset.state === "listening" ? voice.cancel() : listen()));
  $("typed").addEventListener("submit", (e) => {
    e.preventDefault();
    const box = $("typed-text");
    const text = box.value;
    box.value = "";
    answer(text);
  });
  $("stop").addEventListener("click", () => {
    if (!state.over) return finish();
    voice.stopSpeaking();
    state.mask = null;
    Oracle.theme.set(null, { instant: true });
    document.querySelectorAll(".masks li").forEach((li) => li.classList.remove("on"));
    $("controls").hidden = true;
    $("start").hidden = false;
  });

  // For tests: the state, and a way to answer without a microphone.
  Oracle.talk = { state, answer, voice };
})();
