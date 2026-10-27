/* Voice and physical actions in the terminal: the glue between voice.js,
 * facetrack.js/actions.js and the existing Terminal, without changing either.
 *
 *   Oracle.withVoice(terminal, voice, { personality })
 *     - say() also speaks the line aloud (when speaking is on)
 *     - readLine() listens; the words appear in the answer line as they're heard,
 *       and the answer goes in when the visitor stops talking
 *     - choose() listens for "the rock", "two", "the second one"
 *     The keyboard keeps working throughout: typing takes over from the microphone.
 *
 *   await Oracle.askForAction(terminal, tracker, "look_left", { personality, voice })
 *     -> "done" | "timeout" | "skipped"
 *
 *   Oracle.senses.fromURL(location.search) -> null, or { wrap, beforeNode, stop }
 *     ?voice=1          answer by speaking
 *     ?speak=1          the Oracle reads its lines aloud
 *     ?actions=1        the Oracle asks for physical actions (needs the webcam)
 *     ?actions=look_left,close_eyes   ...only these ones
 *     ?every=2          ask for an action before every 2nd question (default)
 *     ?camera=Logitech  use the camera whose name contains this
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // --- answering by voice ------------------------------------------------------------

  function withVoice(terminal, voice, opts) {
    opts = opts || {};
    const personality = opts.personality || (() => null);
    const orig = {
      say: terminal.say.bind(terminal),
      readLine: terminal.readLine.bind(terminal),
      choose: terminal.choose.bind(terminal),
    };

    terminal.say = async function (text) {
      await Promise.all([orig.say(text), voice.speak(text, personality())]);
    };

    // Keep listening until something is heard, the keyboard takes over, or `until` settles.
    async function listenLoop(onText, onHeard, until) {
      let over = false;
      until.then(() => {
        over = true;
        voice.cancel();
      });
      while (!over && voice.canListen && !terminal.dead) {
        const text = await voice.listen({ onHeard });
        if (over || terminal.dead) return;
        if (text && onText(text)) return;
        if (!text) await wait(150); // nobody spoke: listen again
      }
    }

    terminal.readLine = function (prompt) {
      const answer = orig.readLine(prompt);
      if (!voice.canListen) return answer;
      const line = terminal.lines.lastElementChild;
      const input = line && line.querySelector("input");
      if (!input) return answer;

      line.classList.add("term-listening");
      let typed = false;
      const onKey = (e) => {
        if (e.isTrusted && e.key !== "Enter") {
          typed = true; // they're typing: stop putting words in their mouth
          line.classList.remove("term-listening");
          voice.cancel();
        }
      };
      input.addEventListener("keydown", onKey);
      const show = (text) => {
        if (typed) return;
        input.value = text.slice(0, input.maxLength > 0 ? input.maxLength : 80);
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new Event("input"));
      };
      const stopped = answer.then(() => input.removeEventListener("keydown", onKey));
      listenLoop(
        (text) => {
          if (typed) return true;
          show(text);
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          return true;
        },
        show,
        Promise.race([stopped, new Promise((r) => input.addEventListener("keydown", (e) => e.isTrusted && r()))])
      );
      return answer;
    };

    terminal.choose = function (labels) {
      const picked = orig.choose(labels);
      if (!voice.canListen) return picked;
      const options = terminal.menuEls || [];
      options.forEach((o) => o.classList.add("term-listening-option"));
      let hint = null;
      const showHeard = (text) => {
        if (!hint) hint = terminal._add(make("div", "term-line term-you term-heard"));
        hint.textContent = `>${text}`;
      };
      listenLoop(
        (text) => {
          const index = Oracle.Voice.matchChoice(text, labels);
          if (index < 0) {
            showHeard(`${text} ?`);
            return false; // not an option: keep listening, the menu is still up
          }
          if (hint) hint.remove();
          document.dispatchEvent(new KeyboardEvent("keydown", { key: String(index + 1), bubbles: true }));
          return true;
        },
        (text, final) => !final && showHeard(text),
        picked
      );
      return picked.finally(() => {
        options.forEach((o) => o.classList.remove("term-listening-option"));
        if (hint && hint.isConnected) hint.remove();
      });
    };

    terminal.voice = voice;
    return terminal;
  }

  // --- asking for a physical action ---------------------------------------------------------

  /* The Oracle asks for `actionId`, shows a progress bar while it watches, and
   * reacts. Uses the tracker's newest frame (tracker.latest), whatever fills it. */
  async function askForAction(terminal, tracker, actionId, opts) {
    opts = opts || {};
    const pid = opts.personality || null;
    const random = opts.random || Math.random;
    const A = Oracle.Actions;
    if (!tracker) return "skipped";

    await terminal.say(A.line("ask", actionId, pid, random));
    const slug = A.ACTIONS[actionId].label.replace(/\s+/g, "_");
    const bar = make("div", "term-line term-you term-mash term-action");
    const span = make("span", "term-text");
    bar.appendChild(span);
    terminal._add(bar);
    const N = 12;
    const draw = (state) => {
      const filled = Math.round((state.progress || 0) * N);
      const note = state.status === "settling" ? " watching" : state.hint === "no_face" ? " no_subject" : "";
      span.textContent = `>${slug} [${"█".repeat(filled)}${"░".repeat(N - filled)}]${note}`;
    };
    draw({ progress: 0, status: "settling" });

    let complained = false;
    const final = await Oracle.watchAction(tracker, actionId, {
      timeoutMs: opts.timeoutMs,
      onUpdate: (state) => {
        draw(state);
        // Lost them for a while: say so once, without stopping the check.
        if (state.hint === "no_face" && !complained && state.status !== "settling") {
          complained = true;
          const line = A.line("noFace", actionId, pid, random);
          terminal._add(make("div", "term-line term-oracle", line));
          if (opts.voice) opts.voice.speak(line, pid);
        }
      },
    });
    bar.classList.add("term-done");
    if (final.status === "done") span.textContent += " OK";
    await terminal.say(A.line(final.status === "done" ? "done" : "timeout", actionId, pid, random));
    return final.status;
  }

  // --- switching it all on from the address bar -----------------------------------------------

  function fromURL(search) {
    const q = new URLSearchParams(search || "");
    const on = (k) => q.has(k) && !/^(0|false|off|no)$/i.test(q.get(k));
    const listen = on("voice");
    const speak = on("speak");
    const actions = on("actions");
    // ?actions=look_left,hold_still picks from just those; ?actions=1 from all of them
    const only = (q.get("actions") || "").split(",").filter((id) => Oracle.Actions.ACTIONS[id]);
    const allowed = only.length ? only : Oracle.Actions.ids;
    if (!listen && !speak && !actions) return null;

    const voice = new Oracle.Voice({ lang: q.get("lang") || "en-GB", speak, local: q.get("local") || "prefer" });
    if (!listen) voice.canListen = false;
    let tracker = null;
    let trackerReady = null;
    let used = [];
    let asks = 0;
    const every = Math.max(1, parseInt(q.get("every") || "2", 10));

    // The always-on camera (presence.js), when it is running on this page.
    async function sharedTracker() {
      const presence = Oracle.presence;
      if (!presence || presence.role !== "main") return null;
      for (let i = 0; i < 100 && presence.status === "starting"; i++) await wait(100);
      if (presence.status !== "live") return null;
      const t = new Oracle.FaceTrack();
      const off = presence.onResult((result, now) => t.feed(result, now));
      t.stop = () => {
        off();
        t.latest = { result: null, features: null, at: 0 };
      };
      return t;
    }

    function startCamera() {
      if (!actions || trackerReady) return trackerReady;
      trackerReady = sharedTracker().then((shared) => {
        if (shared) return (tracker = shared);
        if ((q.get("camera") || "").toLowerCase() === "off") return null;
        tracker = new Oracle.FaceTrack({ camera: q.get("camera") || null });
        return tracker.start().then(
        () => tracker,
        (err) => {
          console.warn("physical actions are off:", err.message);
          tracker = null;
          return null;
        }
        );
      });
      return trackerReady;
    }

    return {
      voice,
      startCamera,
      get tracker() {
        return tracker;
      },
      wrap(terminal, personality) {
        startCamera();
        asks = 0;
        used = [];
        if (listen || speak) withVoice(terminal, voice, { personality });
        return terminal;
      },
      /* runStory's beforeNode hook: every `every`th question, ask for an action first. */
      async beforeNode(session, terminal, personality) {
        if (!actions || session.node.type !== "ask") return;
        const n = asks++;
        if (n % every !== 0) return;
        const t = await startCamera();
        if (!t) return;
        let pool = allowed.filter((id) => !used.includes(id));
        if (!pool.length) pool = allowed.slice();
        const id = pool[Math.floor(Math.random() * pool.length)];
        used.push(id);
        await askForAction(terminal, t, id, { personality, voice });
      },
      stop() {
        voice.cancel();
        voice.stopSpeaking();
        if (tracker) tracker.stop();
        tracker = null;
        trackerReady = null;
      },
    };
  }

  Oracle.withVoice = withVoice;
  Oracle.askForAction = askForAction;
  Oracle.senses = { fromURL };
})();
