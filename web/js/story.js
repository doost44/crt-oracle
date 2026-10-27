/* The story, the personalities and the receipt: a port of oracle/story.py,
 * oracle/personalities.py, oracle/session.py and oracle/receipt.py.
 *
 * Pure logic, no DOM. Works in the browser (window.Oracle.Session, ...) and in
 * node (module.exports). Every random choice goes through the `random`
 * function given to Session, so a seeded generator replays the same visit.
 */
(function (root) {
  "use strict";

  const DEFAULT_TITLE = "THE ORACLE HAS SPOKEN";
  const DEFAULT_HEARD_NOTE = "(as I heard it)";
  const NODE_TYPES = ["say", "choice", "ask", "mash", "end"];
  const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

  // --- small helpers ---------------------------------------------------------------

  /* Python's str.format_map(_Safe(values)): {key} is filled in, unknown keys
   * become "nothing", {{ and }} are literal braces. One pass, no recursion. */
  function fill(template, values) {
    values = values || {};
    return String(template).replace(/\{\{|\}\}|\{([^{}]*)\}/g, (match, field) => {
      if (match === "{{") return "{";
      if (match === "}}") return "}";
      const name = field.split(/[!:.[]/)[0];
      return has(values, name) ? String(values[name]) : "nothing";
    });
  }

  /* random.choice and random.randrange, driven by a () => [0, 1) function. */
  function randrange(random, n) {
    return Math.min(n - 1, Math.floor(random() * n));
  }
  function choice(random, list) {
    if (!list || !list.length) throw new Error("cannot choose from an empty list");
    return list[randrange(random, list.length)];
  }

  /* Length and slicing by code point, like Python's len() and str slicing. */
  const cpLen = (s) => Array.from(s).length;
  const cpSlice = (s, a, b) => Array.from(s).slice(a, b).join("");

  /* textwrap.wrap(text, width, subsequent_indent=...), with Python's defaults:
   * whitespace collapsed to spaces, words split after hyphens, long words broken. */
  const WS = "\\t\\n\\x0b\\x0c\\r ";
  const WORD_PUNCT = "[\\p{L}\\p{N}_!\"'&.,?]";
  const LETTER = "[\\p{L}_]";
  const WORDSEP = new RegExp(
    "([" + WS + "]+" +
      "|(?<=" + WORD_PUNCT + ")-{2,}(?=[\\p{L}\\p{N}_])" +
      "|[^" + WS + "]+?(?:" +
        "-(?:(?<=" + LETTER + "{2}-)|(?<=" + LETTER + "-" + LETTER + "-))(?=" + LETTER + "-?" + LETTER + ")" +
        "|(?=[" + WS + "]|$)" +
        "|(?<=" + WORD_PUNCT + ")(?=-{2,}[\\p{L}\\p{N}_])" +
      "))",
    "gu"
  );

  function wrap(text, width, opts) {
    opts = opts || {};
    const initialIndent = opts.initialIndent || "";
    const subsequentIndent = opts.subsequentIndent || "";
    // _munge_whitespace: tabs to 8-column stops, every whitespace char to a space
    let col = 0;
    let munged = "";
    for (const ch of String(text)) {
      if (ch === "\t") {
        const n = 8 - (col % 8);
        munged += " ".repeat(n);
        col += n;
      } else {
        munged += /[\n\x0b\x0c\r]/.test(ch) ? " " : ch;
        col = ch === "\n" || ch === "\r" ? 0 : col + 1;
      }
    }
    const chunks = (munged.match(WORDSEP) || []).filter(Boolean).reverse();
    const lines = [];
    const blank = (s) => s.trim() === "";
    while (chunks.length) {
      const curLine = [];
      let curLen = 0;
      const indent = lines.length ? subsequentIndent : initialIndent;
      const w = width - cpLen(indent);
      if (blank(chunks[chunks.length - 1]) && lines.length) chunks.pop();
      while (chunks.length) {
        const l = cpLen(chunks[chunks.length - 1]);
        if (curLen + l <= w) {
          curLine.push(chunks.pop());
          curLen += l;
        } else break;
      }
      if (chunks.length && cpLen(chunks[chunks.length - 1]) > w) {
        // _handle_long_word
        const spaceLeft = w < 1 ? 1 : w - curLen;
        if (spaceLeft > 0) {
          const chunk = chunks[chunks.length - 1];
          let end = spaceLeft;
          if (cpLen(chunk) > spaceLeft) {
            const hyphen = Array.from(chunk).slice(0, spaceLeft).lastIndexOf("-");
            if (hyphen > 0 && /[^-]/.test(cpSlice(chunk, 0, hyphen))) end = hyphen + 1;
          }
          curLine.push(cpSlice(chunk, 0, end));
          chunks[chunks.length - 1] = cpSlice(chunk, end);
        } else if (!curLine.length) {
          curLine.push(chunks.pop());
        }
        curLen = curLine.reduce((n, c) => n + cpLen(c), 0);
      }
      if (curLine.length && blank(curLine[curLine.length - 1])) {
        curLen -= cpLen(curLine.pop());
      }
      if (curLine.length) lines.push(indent + curLine.join(""));
    }
    return lines;
  }

  /* Python's str.center(width).rstrip(). */
  function center(text, width) {
    const len = cpLen(text);
    if (len >= width) return text.replace(/\s+$/, "");
    const marg = width - len;
    const left = Math.floor(marg / 2) + (marg & width & 1);
    return (" ".repeat(left) + text).replace(/\s+$/, "");
  }

  function centeredBlock(text, width) {
    return wrap(text, width).map((line) => center(line, width));
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  function stamp(date) {
    return (
      date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes())
    );
  }

  // --- the story graph ---------------------------------------------------------------

  class StoryError extends Error {}

  function loadStory(data) {
    if (!data || typeof data !== "object" || !has(data, "start") || !has(data, "nodes")) {
      throw new StoryError("story needs 'start' and 'nodes'");
    }
    const nodes = {};
    for (const id of Object.keys(data.nodes)) {
      const raw = data.nodes[id] || {};
      if (!NODE_TYPES.includes(raw.type)) {
        throw new StoryError(`node '${id}': unknown type ${JSON.stringify(raw.type)}`);
      }
      nodes[id] = {
        id,
        type: raw.type,
        text: has(raw, "text") ? raw.text : "",
        next: raw.next || null,
        key: raw.key || null,
        count: parseInt(raw.count == null ? 1 : raw.count, 10),
        options: (raw.options || []).map((o) => ({
          label: o.label,
          next: o.next,
          art: o.art || null,
          personality: o.personality || null,
        })),
      };
    }
    const story = { start: data.start, nodes };
    validateStory(story);
    return story;
  }

  function validateStory(story) {
    const nodes = story.nodes;
    if (!has(nodes, story.start)) throw new StoryError(`start node '${story.start}' does not exist`);
    if (!Object.values(nodes).some((n) => n.type === "end")) throw new StoryError("story has no 'end' node");
    for (const node of Object.values(nodes)) {
      const targets = [];
      if (["say", "ask", "mash"].includes(node.type)) {
        if (!node.next) throw new StoryError(`node '${node.id}' needs 'next'`);
        targets.push(node.next);
      }
      if (node.type === "ask" && !node.key) throw new StoryError(`node '${node.id}' needs 'key'`);
      if (node.type === "choice") {
        if (!node.options.length) throw new StoryError(`node '${node.id}' needs 'options'`);
        node.options.forEach((o) => targets.push(o.next));
      }
      for (const t of targets) {
        if (!has(nodes, t)) throw new StoryError(`node '${node.id}' points to missing node '${t}'`);
      }
    }
  }

  // --- personalities -----------------------------------------------------------------

  class Personality {
    /* `data` is the raw YAML dict, as exported into content.js. */
    constructor(data) {
      // `receipt:` is the current section; `verdict:` is the older name. receipt wins.
      const receipt = Object.assign({}, data.verdict || {}, data.receipt || {});
      const mishear = data.mishear || {};
      let lines = (mishear.lines || []).slice();
      const template = mishear.template || (lines.length ? lines[0] : "");
      if (template && !lines.length) lines = [template];
      this.id = data.id;
      this.name = data.name;
      this.symbol = data.symbol;
      this.reactions = (data.reactions || []).slice();
      this.interruptions = (data.interruptions || []).slice();
      this.mishearTemplate = template;
      this.mishearWords = (mishear.words || []).slice();
      this.mishearLines = lines;
      this.verdictHeader = has(receipt, "header") ? receipt.header : "VERDICT";
      this.verdictLines = (receipt.lines || []).slice();
      this.verdictFooter = has(receipt, "footer") ? receipt.footer : "";
      this.receiptTitle = receipt.title || DEFAULT_TITLE;
      this.heardNote = receipt.heard_note || DEFAULT_HEARD_NOTE;
      this.finePrint = (receipt.fine_print || []).slice();
    }

    reaction(random) {
      return choice(random, this.reactions);
    }

    interruption(random, emotion) {
      return fill(choice(random, this.interruptions), { emotion: emotion || "unreadable" });
    }

    /* `answer` with one word swapped for something the Oracle "heard". */
    mishear(answer, random) {
      const words = String(answer).split(/\s+/).filter(Boolean);
      if (!words.length) return answer;
      const index = randrange(random, words.length);
      const options = this.mishearWords.filter((w) => w.toLowerCase() !== words[index].toLowerCase());
      if (options.length) words[index] = choice(random, options);
      return words.join(" ");
    }

    mishearLine(heard, random) {
      const lines = this.mishearLines.length ? this.mishearLines : [this.mishearTemplate || "'{heard}'."];
      return fill(choice(random || Math.random, lines), { heard });
    }

    verdict(answers) {
      return this.verdictLines.map((line) => fill(line, answers));
    }

    finePrintLine(random) {
      return this.finePrint.length ? choice(random || Math.random, this.finePrint) : "";
    }
  }

  function loadPersonalities(dicts) {
    const found = {};
    for (const key of Object.keys(dicts || {}).sort()) {
      const p = new Personality(dicts[key]);
      found[p.id] = p;
    }
    return found;
  }

  // --- one visitor's walk through the story ------------------------------------------

  class Session {
    /* content: window.ORACLE_CONTENT. random: () => [0, 1). */
    constructor(content, random, opts) {
      opts = opts || {};
      const config = content.config || {};
      this.content = content;
      this.story = loadStory(content.story);
      this.personalities = loadPersonalities(content.personalities);
      this.random = random || Math.random;
      this.mishearRate = has(opts, "mishearRate")
        ? opts.mishearRate
        : has(config, "mishear_rate") ? config.mishear_rate : 0.25;
      this.nodeId = this.story.start;
      this.personality = null;
      this.answers = {}; // what the visitor typed
      this.heard = {}; // what the Oracle claims it heard
      this.path = [];
    }

    get node() {
      return this.story.nodes[this.nodeId];
    }

    get finished() {
      return this.node.type === "end";
    }

    /* A node's text for the current personality, with {answers} as heard. */
    text(node) {
      node = node || this.node;
      let raw = node.text;
      if (raw && typeof raw === "object") {
        const pid = this.personality ? this.personality.id : "default";
        raw = has(raw, pid) ? raw[pid] : has(raw, "default") ? raw.default : "";
      }
      return fill(raw == null ? "None" : raw, this.heard);
    }

    _go(target) {
      this.path.push(this.nodeId);
      this.nodeId = target;
    }

    choose(index) {
      const node = this.node;
      if (node.type !== "choice") throw new Error(`node '${node.id}' is not a choice`);
      const option = node.options[index];
      if (!option) throw new RangeError(`node '${node.id}' has no option ${index}`);
      if (option.personality) {
        if (!has(this.personalities, option.personality)) {
          throw new Error(`unknown personality '${option.personality}'`);
        }
        this.personality = this.personalities[option.personality];
      }
      this._go(option.next);
    }

    /* Record an answer. Returns {heard, misheard}. */
    answer(text) {
      const node = this.node;
      if (node.type !== "ask") throw new Error(`node '${node.id}' is not an ask`);
      text = String(text);
      let heard = text;
      let misheard = false;
      if (this.personality && text.trim() && this.random() < this.mishearRate) {
        const twisted = this.personality.mishear(text, this.random);
        if (twisted !== text) {
          heard = twisted;
          misheard = true;
        }
      }
      this.answers[node.key] = text;
      this.heard[node.key] = heard;
      this._go(node.next);
      return { heard, misheard };
    }

    advance() {
      const node = this.node;
      if (node.type !== "say" && node.type !== "mash") {
        throw new Error(`node '${node.id}' cannot simply advance`);
      }
      this._go(node.next);
    }

    reaction() {
      return this.personality ? this.personality.reaction(this.random) : null;
    }

    mishearLine(heard) {
      return this.personality ? this.personality.mishearLine(heard, this.random) : `'${heard}'.`;
    }

    interruption(emotion) {
      return this.personality ? this.personality.interruption(this.random, emotion || "unreadable") : null;
    }

    verdictLines() {
      if (!this.personality) return ["I CANNOT JUDGE SOMEONE WHO WILL NOT CHOOSE."];
      return this.personality.verdict(this.heard);
    }

    receipt(width, now) {
      return buildReceipt(this, width, now);
    }
  }

  // --- the printed verdict -----------------------------------------------------------

  /* oracle/receipt.py build_receipt: plain text, no line wider than `width`. */
  function buildReceipt(session, width, now) {
    width = width || (session.content && session.content.config && session.content.config.receipt_width) || 32;
    now = now || new Date();
    const rule = "=".repeat(width);
    const dash = "-".repeat(width);
    const p = session.personality;
    const out = [rule, ...centeredBlock(p ? p.receiptTitle : DEFAULT_TITLE, width), rule];
    out.push(...centeredBlock(p ? p.name : "UNCHOSEN", width));
    out.push(center(stamp(now), width));
    out.push(dash);
    const keys = Object.keys(session.heard);
    if (keys.length) {
      out.push("WHAT YOU SAID");
      out.push(...wrap(p ? p.heardNote : DEFAULT_HEARD_NOTE, width));
      for (const key of keys) {
        out.push(...wrap(`- ${session.heard[key]}`, width, { subsequentIndent: "  " }));
      }
      out.push(dash);
    }
    out.push(...wrap(p ? p.verdictHeader : "VERDICT", width));
    for (const line of session.verdictLines()) {
      const wrapped = wrap(line, width);
      out.push(...(wrapped.length ? wrapped : [""]));
    }
    if (p && p.verdictFooter) {
      out.push(dash);
      out.push(...wrap(p.verdictFooter, width));
    }
    const fine = p ? p.finePrintLine(session.random) : "";
    if (fine) {
      out.push("");
      out.push(...centeredBlock(fine, width));
    }
    out.push(rule);
    return out.join("\n") + "\n";
  }

  const api = {
    DEFAULT_TITLE,
    DEFAULT_HEARD_NOTE,
    StoryError,
    Personality,
    Session,
    loadStory,
    loadPersonalities,
    buildReceipt,
    fill,
    wrap,
    center,
    stamp,
  };

  root.Oracle = Object.assign(root.Oracle || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
