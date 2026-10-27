/* The terminal: the talking panel at the bottom of the screen, the story
 * runner (a port of oracle/runner.py) and the on-screen receipt.
 *
 *   const t = new Oracle.Terminal(el, { onTyping });
 *   await t.say(text); await t.art(text); t.menu(labels);
 *   await t.readLine(prompt); await t.choose(labels); await t.pressEnter(count, text);
 *   t.clear(); t.destroy();
 *
 *   const { receipt, session } = await Oracle.runStory(content, terminal, { random, onPersonality });
 *   Oracle.showReceipt(el, receipt, { personality, onAgain });
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const NOT_AN_OPTION = "THAT WAS NOT AN OPTION. I WILL ASK AGAIN.";
  const PRINTING = "YOUR RECEIPT IS PRINTING. DO NOT READ IT IN FRONT OF ME.";
  const MAX_INPUT = 80;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* Menu labels and prompts in the poster's terminal style: "A sun" -> "a_sun". */
  function slug(text) {
    return String(text).trim().toLowerCase().replace(/\s+/g, "_");
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // --- the terminal panel ------------------------------------------------------------

  class Terminal {
    constructor(el, opts) {
      opts = opts || {};
      this.el = el;
      this.onTyping = opts.onTyping || function () {};
      this.charMs = opts.charMs != null ? opts.charMs : 25;
      this.pauseMs = opts.pauseMs != null ? opts.pauseMs : 450;
      this.mode = null; // the current handler for keys and clicks, or null
      this.menuEls = null;
      this.dead = false;
      this.typeahead = []; // keys typed while the Oracle was still talking, like a real terminal

      el.innerHTML = "";
      el.classList.add("term");
      this.log = make("div", "term-log");
      this.lines = make("div", "term-lines");
      this.log.appendChild(this.lines);
      el.appendChild(this.log);

      // Ignore the very event that created the terminal (the Enter or click that skipped the hallway).
      this.createdAt = performance.now();
      const live = (e) => !this.dead && this.mode && this.el.isConnected && e.timeStamp >= this.createdAt;
      this._onKey = (e) => {
        if (live(e) && this.mode.key) this.mode.key(e);
      };
      // A click anywhere counts (to skip text, or tap through the mash), except on buttons
      // and on the receipt overlay.
      this._onClick = (e) => {
        if (!live(e) || !this.mode.click) return;
        const t = e.target;
        if (t && t.closest && t.closest("button, a, input, .receipt-overlay")) return;
        this.mode.click(e);
      };
      this._onResize = () => this.fit();
      document.addEventListener("keydown", this._onKey);
      document.addEventListener("click", this._onClick);
      window.addEventListener("resize", this._onResize);
    }

    destroy() {
      this.dead = true;
      this.mode = null;
      document.removeEventListener("keydown", this._onKey);
      document.removeEventListener("click", this._onClick);
      window.removeEventListener("resize", this._onResize);
    }

    clear() {
      this.lines.innerHTML = "";
      this.menuEls = null;
      this.typeahead = [];
    }

    /* Keep a printable key pressed while text is still coming; choose() and readLine() use it. */
    _buffer(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.repeat) return;
      if (this.typeahead.length < MAX_INPUT) this.typeahead.push(e.key);
      e.preventDefault();
    }

    /* Add a line at the bottom; older lines move up, fade, and drop off the top. */
    _add(node) {
      this.lines.appendChild(node);
      this.fit();
      return node;
    }

    fit() {
      const room = this.log.clientHeight;
      if (!room) return;
      // Drop lines that have scrolled completely out of view; keep one cut-off line on top.
      while (this.lines.children.length > 1) {
        const first = this.lines.firstElementChild;
        if (this.lines.offsetHeight - first.offsetHeight < room) break;
        if (this.menuEls && this.menuEls.includes(first)) break; // never drop a live menu
        first.remove();
      }
      const kids = Array.from(this.lines.children);
      kids.forEach((kid, i) => {
        const age = kids.length - 1 - i;
        kid.style.opacity = String(Math.max(0.35, 1 - age * 0.09));
      });
    }

    _setCurrent(line) {
      this.lines.querySelectorAll(".term-current").forEach((n) => n.classList.remove("term-current"));
      if (line) line.classList.add("term-current");
    }

    /* Type `text` out like a teletype. Enter or a click shows the rest at once. */
    async say(text) {
      text = String(text == null ? "" : text);
      const line = make("div", "term-line term-oracle term-speaking");
      const span = make("span", "term-text");
      line.appendChild(span);
      this._setCurrent(line);
      this._add(line);
      const chars = Array.from(text);
      this.onTyping(true);
      try {
        await new Promise((resolve) => {
          let shown = 0;
          const started = performance.now();
          let timer = null;
          const finish = () => {
            clearTimeout(timer);
            span.textContent = text;
            line.classList.remove("term-speaking");
            this.fit();
            resolve();
          };
          const skip = (e) => {
            if (e && e.type === "keydown") {
              if (e.key !== "Enter") return this._buffer(e);
              e.preventDefault();
            }
            this.mode = null;
            finish();
          };
          this.mode = { key: skip, click: skip };
          const tick = () => {
            if (this.dead) return finish();
            const due = this.charMs > 0 ? Math.floor((performance.now() - started) / this.charMs) + 1 : chars.length;
            if (due > shown) {
              shown = Math.min(chars.length, due);
              span.textContent = chars.slice(0, shown).join("");
              this.fit();
            }
            if (shown >= chars.length) {
              this.mode = null;
              finish();
            } else {
              timer = setTimeout(tick, Math.max(8, this.charMs));
            }
          };
          tick();
        });
      } finally {
        this.onTyping(false);
      }
      await this._pause(this.pauseMs);
    }

    /* A short wait that Enter or a click cuts short. */
    _pause(ms) {
      if (!ms) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(done, ms);
        const self = this;
        function done() {
          clearTimeout(timer);
          if (self.mode && self.mode.pause) self.mode = null;
          resolve();
        }
        this.mode = {
          pause: true,
          key: (e) => (e.key === "Enter" ? (e.preventDefault(), done()) : this._buffer(e)),
          click: done,
        };
      });
    }

    async art(text) {
      const pre = make("pre", "term-line term-art", String(text || "").replace(/\s+$/, ""));
      this._add(pre);
      await this._pause(this.pauseMs * 2);
    }

    /* Show numbered options. choose() reads the answer. */
    menu(labels) {
      const els = labels.map((label, i) => {
        const line = make("div", "term-line term-option");
        line.dataset.index = String(i);
        line.appendChild(make("span", "term-text", `>${i + 1}/${slug(label)}`));
        return line;
      });
      this.menuEls = [];
      for (const line of els) {
        this.menuEls.push(line);
        this._add(line);
      }
      return els;
    }

    _echo(text, extra) {
      return this._add(make("div", "term-line term-you" + (extra ? " " + extra : ""), ">" + text));
    }

    /* Wait for a number key (1..N) or a click on an option. Returns the index. */
    async choose(labels) {
      if (!this.menuEls || this.menuEls.length !== labels.length) this.menu(labels);
      const options = this.menuEls;
      options.forEach((o) => o.classList.add("term-live"));
      const pick = (key) => {
        const n = /^[0-9]$/.test(key) ? parseInt(key, 10) : NaN;
        return n >= 1 && n <= labels.length ? n - 1 : -1;
      };
      let index;
      for (;;) {
        index = await new Promise((resolve) => {
          if (this.typeahead.length) return resolve(pick(this.typeahead.shift()));
          this.mode = {
            key: (e) => {
              if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
              const isChar = e.key.length === 1;
              if (!isChar && e.key !== "Enter") return;
              e.preventDefault();
              resolve(pick(e.key));
            },
            click: (e) => {
              const hit = e.target.closest && e.target.closest(".term-option.term-live");
              if (hit) resolve(parseInt(hit.dataset.index, 10));
            },
          };
        });
        this.mode = null;
        if (index >= 0) break;
        await this.say(NOT_AN_OPTION);
      }
      this.typeahead = [];
      options.forEach((o) => o.classList.remove("term-live"));
      options[index].classList.add("term-picked");
      this.menuEls = null;
      this._echo(String(index + 1));
      return index;
    }

    /* A typed line with a ">" prompt and a blinking block cursor. Resolves on Enter. */
    async readLine(prompt) {
      prompt = prompt == null ? ">" : String(prompt).replace(/\s+$/, "") || ">";
      const line = make("div", "term-line term-you term-input");
      const field = make("label", "term-field");
      field.appendChild(make("span", "term-prompt", prompt));
      const before = make("span", "term-typed");
      const cursor = make("span", "term-cursor", " ");
      const after = make("span", "term-typed");
      const input = make("input", "term-hidden-input");
      input.type = "text";
      input.maxLength = MAX_INPUT;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.setAttribute("aria-label", "Your answer");
      input.value = this.typeahead.join("").slice(0, MAX_INPUT);
      this.typeahead = [];
      field.append(before, cursor, after, input);
      line.appendChild(field);
      this._add(line);

      const render = () => {
        const chars = Array.from(input.value);
        // selectionStart counts UTF-16 units; map it to a character position
        const pos = Array.from(input.value.slice(0, input.selectionStart == null ? input.value.length : input.selectionStart)).length;
        before.textContent = chars.slice(0, pos).join("");
        cursor.textContent = chars[pos] || " ";
        after.textContent = chars.slice(pos + 1).join("");
        line.classList.toggle("term-typing", true);
        clearTimeout(render.timer);
        render.timer = setTimeout(() => line.classList.remove("term-typing"), 500);
        this.fit();
      };
      const refocus = () => {
        if (!this.dead && line.isConnected && document.activeElement !== input) input.focus({ preventScroll: true });
      };
      const onBlur = () => setTimeout(refocus, 0);
      const onDocDown = (e) => {
        if (e.target !== input && !(e.target.closest && e.target.closest("button, a, input, textarea, select"))) {
          e.preventDefault(); // keep the focus in the answer
          refocus();
        }
      };
      ["input", "keyup", "click", "select"].forEach((t) => input.addEventListener(t, render));
      document.addEventListener("selectionchange", render);
      input.addEventListener("blur", onBlur);
      document.addEventListener("pointerdown", onDocDown, true);

      const value = await new Promise((resolve) => {
        this.mode = {}; // the input handles its own keys
        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing || e.repeat) return;
          e.preventDefault();
          e.stopPropagation();
          resolve(input.value);
        });
        render();
        refocus();
      });

      this.mode = null;
      input.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("selectionchange", render);
      clearTimeout(render.timer);
      line.replaceWith(this._echoNode(value, prompt));
      this.fit();
      return value;
    }

    _echoNode(value, prompt) {
      const node = make("div", "term-line term-you");
      node.appendChild(make("span", "term-prompt", prompt || ">"));
      node.appendChild(document.createTextNode(value));
      return node;
    }

    /* The keyboard moment: press Enter `count` times (a tap also counts). */
    async pressEnter(count, text) {
      count = Math.max(1, count | 0);
      const label = slug(text || "press Enter");
      const line = make("div", "term-line term-you term-mash");
      const span = make("span", "term-text");
      line.appendChild(span);
      this._add(line);
      this.typeahead = [];
      let pressed = 0;
      const show = () => {
        const bar = "█".repeat(pressed) + "░".repeat(count - pressed);
        span.textContent = `>${label} [${bar}] ${pressed}/${count}`;
      };
      show();
      await new Promise((resolve) => {
        const hit = () => {
          pressed += 1;
          show();
          line.classList.remove("term-bump");
          void line.offsetWidth; // restart the little flash
          line.classList.add("term-bump");
          if (pressed >= count) resolve();
        };
        this.mode = {
          key: (e) => {
            if (e.key !== "Enter" || e.repeat) return;
            e.preventDefault();
            hit();
          },
          click: hit,
        };
      });
      this.mode = null;
      line.classList.add("term-done");
      await wait(250);
    }
  }

  // --- the story runner (oracle/runner.py) -------------------------------------------

  /* Play the whole story in `terminal`. Returns { receipt, session }.
   * opts: random, onPersonality(id), width, now, mishearRate,
   *       beforeNode(session, terminal) (async; a hook for camera interruptions). */
  async function runStory(content, terminal, opts) {
    opts = opts || {};
    const config = content.config || {};
    const sessionOpts = opts.mishearRate != null ? { mishearRate: opts.mishearRate } : {};
    const session = new Oracle.Session(content, opts.random || Math.random, sessionOpts);
    const art = content.art || {};
    const onPersonality = opts.onPersonality || function () {};

    for (;;) {
      const node = session.node;
      if (node.type !== "end" && opts.beforeNode) await opts.beforeNode(session, terminal);

      if (node.type === "say") {
        await terminal.say(session.text());
        session.advance();
      } else if (node.type === "choice") {
        await terminal.say(session.text());
        const labels = node.options.map((o) => o.label);
        terminal.menu(labels);
        const index = await terminal.choose(labels);
        const option = node.options[index];
        if (option.art && art[option.art]) await terminal.art(art[option.art]);
        session.choose(index);
        if (option.personality) onPersonality(session.personality ? session.personality.id : option.personality);
      } else if (node.type === "ask") {
        await terminal.say(session.text());
        const { heard, misheard } = session.answer(await terminal.readLine(">"));
        if (misheard) {
          await terminal.say(session.mishearLine(heard));
        } else {
          const reaction = session.reaction();
          if (reaction) await terminal.say(reaction);
        }
      } else if (node.type === "mash") {
        await terminal.say(session.text());
        await terminal.pressEnter(node.count, "press Enter");
        session.advance();
      } else if (node.type === "end") {
        if (session.personality) await terminal.say(session.personality.verdictHeader);
        for (const line of session.verdictLines()) await terminal.say(line);
        const receipt = Oracle.buildReceipt(session, opts.width || config.receipt_width || 32, opts.now);
        await terminal.say(PRINTING);
        return { receipt, session };
      }
    }
  }

  // --- the receipt on screen -----------------------------------------------------------

  function fileStamp(date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  }

  function saveText(text, date) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oracle-receipt-${fileStamp(date || new Date())}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return a.download;
  }

  /* Fill the #receipt overlay with a paper ticket and PRINT / SAVE / AGAIN. */
  function showReceipt(el, text, opts) {
    opts = opts || {};
    const enterDelay = opts.enterDelay != null ? opts.enterDelay : 1200;
    if (el._oracleReceiptCleanup) el._oracleReceiptCleanup();
    const cols = Math.max(16, ...String(text).split("\n").map((l) => Array.from(l).length));

    el.innerHTML = "";
    el.classList.add("receipt-overlay");
    const stage = make("div", "receipt-stage");
    const slot = make("div", "receipt-slot");
    const ticket = make("div", "ticket");
    if (opts.personality) ticket.dataset.personality = opts.personality;
    ticket.style.setProperty("--receipt-cols", String(cols));
    const pre = make("pre", "ticket-text", String(text).replace(/\n$/, ""));
    ticket.appendChild(pre);
    slot.appendChild(ticket);

    const actions = make("div", "receipt-actions");
    const btn = (label, hint, fn) => {
      const b = make("button", "receipt-btn");
      b.type = "button";
      b.appendChild(make("span", "receipt-btn-label", ">" + label.toLowerCase()));
      if (hint) b.appendChild(make("span", "receipt-btn-hint", hint));
      b.addEventListener("click", fn);
      actions.appendChild(b);
      return b;
    };
    const created = new Date();
    btn("PRINT", "", () => window.print());
    btn("SAVE", ".txt", () => saveText(String(text), created));
    let gone = false;
    const again = () => {
      if (gone) return;
      gone = true;
      cleanup();
      if (opts.onAgain) opts.onAgain();
    };
    btn("AGAIN", "enter", again);

    stage.append(slot, actions);
    el.appendChild(stage);
    el.hidden = false;

    const shownAt = performance.now();
    const onKey = (e) => {
      if (e.key !== "Enter" || e.repeat) return;
      if (e.target && e.target.closest && e.target.closest("#" + el.id + " button")) return; // the button clicks itself
      if (performance.now() - shownAt < enterDelay) return;
      e.preventDefault();
      again();
    };
    document.addEventListener("keydown", onKey);
    function cleanup() {
      document.removeEventListener("keydown", onKey);
      el._oracleReceiptCleanup = null;
    }
    el._oracleReceiptCleanup = cleanup;
    return { el, ticket, again, save: () => saveText(String(text), created), cleanup };
  }

  Oracle.Terminal = Terminal;
  Oracle.runStory = runStory;
  Oracle.showReceipt = showReceipt;
  Oracle.saveReceipt = saveText;
  Oracle.NOT_AN_OPTION = NOT_AN_OPTION;
})();
