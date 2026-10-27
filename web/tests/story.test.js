/* Tests for web/js/story.js. Run from anywhere with plain node:
 *
 *     node web/tests/story.test.js
 *
 * Loads web/data/content.js (the exported story and personalities) and walks
 * every branch with scripted answers and a seeded random.
 */
"use strict";
const assert = require("assert");
const path = require("path");

global.window = {};
require(path.join(__dirname, "..", "data", "content.js"));
const content = global.window.ORACLE_CONTENT;
const S = require(path.join(__dirname, "..", "js", "story.js"));

/* xorshift32, the same generator as Oracle.rng in grid.js */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const BRANCHES = [
  { option: 0, branch: "sun", pid: "sugar" },
  { option: 1, branch: "rock", pid: "weary" },
  { option: 2, branch: "tree", pid: "clinical" },
];
const KEYS = ["proud", "worry", "wish"];
const NOW = new Date(2026, 9, 26, 12, 0);
// whitespace collapsed, and lines broken after a hyphen joined back up
const flat = (s) => s.split(/\s+/).filter(Boolean).join(" ").replace(/- /g, "-");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok   " + name);
  } catch (err) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + (err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n     ") : err));
  }
}

/* Walk the whole story like runner.py, recording what would be shown on screen. */
function play(option, answers, opts) {
  opts = opts || {};
  const session = new S.Session(content, rng(opts.seed || 1), opts.sessionOpts);
  const shown = [];
  const asked = [];
  const results = [];
  let i = 0;
  for (let guard = 0; guard < 100; guard++) {
    const node = session.node;
    if (node.type === "say") {
      shown.push(session.text());
      session.advance();
    } else if (node.type === "choice") {
      shown.push(session.text());
      session.choose(option);
    } else if (node.type === "ask") {
      const q = session.text();
      shown.push(q);
      asked.push(q);
      const r = session.answer(answers[i++]);
      results.push(r);
      shown.push(r.misheard ? session.mishearLine(r.heard) : session.reaction());
    } else if (node.type === "mash") {
      shown.push(session.text());
      session.advance();
    } else if (node.type === "end") {
      if (session.personality) shown.push(session.personality.verdictHeader);
      shown.push(...session.verdictLines());
      const receipt = S.buildReceipt(session, opts.width || 32, NOW);
      return { session, shown, asked, results, receipt };
    }
  }
  throw new Error("story never reached an end node");
}

// --- the content -----------------------------------------------------------------------

test("content.js loads a valid story and three personalities", () => {
  const story = S.loadStory(content.story);
  assert.strictEqual(story.start, "welcome");
  const ps = S.loadPersonalities(content.personalities);
  assert.deepStrictEqual(Object.keys(ps).sort(), ["clinical", "sugar", "weary"]);
  for (const p of Object.values(ps)) {
    assert.ok(p.reactions.length && p.interruptions.length && p.mishearWords.length && p.mishearLines.length);
    assert.ok(p.receiptTitle && p.receiptTitle !== S.DEFAULT_TITLE, p.id + " has its own receipt title");
    assert.ok(content.art[p.symbol], p.id + " has art for its symbol");
  }
  assert.ok(content.config.mishear_rate >= 0 && content.config.receipt_width > 0);
});

test("a broken story is rejected", () => {
  assert.throws(() => S.loadStory({ start: "a", nodes: { a: { type: "say", next: "missing" }, z: { type: "end" } } }), S.StoryError);
  assert.throws(() => S.loadStory({ start: "a", nodes: { a: { type: "dance" } } }), S.StoryError);
  assert.throws(() => S.loadStory({ start: "a", nodes: { a: { type: "say", next: "a" } } }), /no 'end' node/);
});

// --- every branch ------------------------------------------------------------------------

for (const { option, branch, pid } of BRANCHES) {
  test(`branch ${branch} -> ${pid}: walks to the end with placeholder questions`, () => {
    const run = play(option, ["my garden", "the dark", "a boat"], { sessionOpts: { mishearRate: 0 } });
    const s = run.session;
    assert.strictEqual(s.personality.id, pid);
    assert.deepStrictEqual(s.path, ["welcome", "pick_symbol", `${branch}_intro`, `${branch}_q1`, `${branch}_q2`, `${branch}_q3`, "wake"]);
    assert.ok(s.finished);
    assert.strictEqual(run.asked.length, 3);
    run.asked.forEach((q, n) => assert.ok(q.includes(`[PLACEHOLDER Q${n + 1} ${branch}]`), q));
    assert.deepStrictEqual(s.answers, { proud: "my garden", worry: "the dark", wish: "a boat" });
    assert.deepStrictEqual(s.heard, s.answers);
    // intro and wake speak in this personality's voice, not the default
    const story = content.story.nodes;
    assert.ok(run.shown.includes(story[`${branch}_intro`].text[pid]));
    assert.ok(run.shown.includes(story.wake.text[pid]));
    // reactions come from this personality
    const p = content.personalities[pid];
    [4, 6, 8].map((k) => run.shown[k]).forEach((r) => assert.ok(p.reactions.includes(r), r));
    // verdict lines are filled with what was heard
    const verdict = s.verdictLines();
    assert.strictEqual(verdict.length, p.receipt.lines.length);
    assert.ok(verdict.join(" ").includes("my garden") && verdict.join(" ").includes("a boat"));
    assert.ok(!verdict.join(" ").includes("{"));
  });

  test(`branch ${branch}: receipt fits, names ${pid}, has title, heard note, fine print`, () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const width of [24, 32, 42]) {
        const run = play(
          option,
          ["an extraordinarily_long_unbroken_word_that_cannot_wrap_nicely at all", "short", "a boat"],
          { seed, width, sessionOpts: { mishearRate: 0.5 } }
        );
        const p = run.session.personality;
        const lines = run.receipt.split("\n");
        assert.strictEqual(lines.pop(), "", "receipt ends with a newline");
        for (const line of lines) assert.ok(Array.from(line).length <= width, `width ${width}: '${line}'`);
        const text = flat(run.receipt);
        assert.ok(text.includes(flat(p.receiptTitle)), "title");
        assert.ok(!run.receipt.includes(S.DEFAULT_TITLE));
        assert.ok(text.includes(p.name), "name");
        assert.ok(run.receipt.includes("2026-10-26 12:00"), "date");
        assert.ok(run.receipt.includes("WHAT YOU SAID") && text.includes(flat(p.heardNote)));
        assert.ok(text.includes(flat(p.verdictHeader)));
        assert.ok(text.includes(flat(p.verdictFooter)));
        assert.strictEqual(p.finePrint.filter((f) => text.includes(flat(f))).length, 1, "exactly one fine print line");
        assert.strictEqual(lines[0], "=".repeat(width));
        assert.strictEqual(lines[lines.length - 1], "=".repeat(width));
        assert.ok(!run.receipt.includes("{"));
      }
    }
  });
}

// --- mishearing ----------------------------------------------------------------------------

test("mishearing keeps what was typed and what was heard apart", () => {
  for (const { option, pid } of BRANCHES) {
    const typed = ["I fixed a bike", "the dark", "a boat"];
    const run = play(option, typed, { seed: 7, sessionOpts: { mishearRate: 1 } });
    const s = run.session;
    const p = s.personality;
    assert.strictEqual(p.id, pid);
    assert.deepStrictEqual(s.answers, { proud: typed[0], worry: typed[1], wish: typed[2] });
    KEYS.forEach((key, n) => {
      const r = run.results[n];
      assert.ok(r.misheard, `${pid} ${key} misheard at rate 1`);
      assert.strictEqual(s.heard[key], r.heard);
      assert.notStrictEqual(s.heard[key], s.answers[key]);
      // exactly one word swapped, for one of this personality's words
      const before = s.answers[key].split(" ");
      const swapped = p.mishearWords.filter((w) => s.heard[key].includes(w));
      assert.ok(swapped.length >= 1, s.heard[key]);
      const kept = before.filter((w) => s.heard[key].split(" ").includes(w));
      assert.ok(kept.length >= before.length - 1);
    });
    // the mishear line on screen quotes the heard version
    const lines = run.shown.filter((line) => KEYS.some((k) => line.includes(s.heard[k])));
    assert.ok(lines.length >= 3);
    // the receipt shows the heard answers, not the typed ones
    const text = flat(run.receipt);
    for (const key of KEYS) assert.ok(text.includes(flat(s.heard[key])), s.heard[key]);
    assert.ok(!text.includes("I fixed a bike"));
  }
});

test("a mishear never swaps a word for itself", () => {
  const p = new S.Personality({
    id: "x", name: "X", symbol: "sun", reactions: ["ok"], interruptions: ["{emotion}"],
    mishear: { lines: ["'{heard}'"], words: ["moss", "gravel"] }, receipt: {},
  });
  for (let seed = 1; seed < 200; seed++) {
    assert.strictEqual(p.mishear("moss", rng(seed)), "gravel");
  }
  assert.strictEqual(p.mishear("   ", rng(1)), "   ");
  assert.strictEqual(p.mishearLine("a b", rng(1)), "'a b'");
});

test("mishear rate 0 never mishears, blank answers are never misheard", () => {
  const s = new S.Session(content, rng(3), { mishearRate: 1 });
  s.advance();
  s.choose(0);
  s.advance();
  assert.deepStrictEqual(s.answer("   "), { heard: "   ", misheard: false });
  const t = new S.Session(content, rng(3), { mishearRate: 0 });
  t.advance();
  t.choose(1);
  t.advance();
  assert.deepStrictEqual(t.answer("my bike"), { heard: "my bike", misheard: false });
});

test("the mishear rate comes from content.config by default", () => {
  const s = new S.Session(content, rng(1));
  assert.strictEqual(s.mishearRate, content.config.mishear_rate);
});

test("the same seed replays the same visit", () => {
  const a = play(1, ["one two three", "four five", "six"], { seed: 99, sessionOpts: { mishearRate: 0.5 } });
  const b = play(1, ["one two three", "four five", "six"], { seed: 99, sessionOpts: { mishearRate: 0.5 } });
  assert.deepStrictEqual(a.shown, b.shown);
  assert.strictEqual(a.receipt, b.receipt);
});

// --- text, placeholders, edge cases --------------------------------------------------------

test("text picks the personality's version, then default; {missing} becomes 'nothing'", () => {
  const s = new S.Session(content, rng(1), { mishearRate: 0 });
  assert.strictEqual(s.text(), content.story.nodes.welcome.text);
  const intro = { id: "x", type: "say", text: { default: "D {proud}", sugar: "S {proud} {nope} {{x}}" } };
  assert.strictEqual(s.text(intro), "D nothing");
  s.advance();
  s.choose(0);
  s.heard.proud = "{wish}";
  assert.strictEqual(s.text(intro), "S {wish} nothing {x}", "no recursive filling, braces escape");
  assert.strictEqual(s.text({ text: { default: "only default" } }), "only default");
});

test("verdict without a personality, and wrong moves throw", () => {
  const s = new S.Session(content, rng(1));
  assert.deepStrictEqual(s.verdictLines(), ["I CANNOT JUDGE SOMEONE WHO WILL NOT CHOOSE."]);
  assert.strictEqual(s.reaction(), null);
  assert.throws(() => s.choose(0), /not a choice/);
  assert.throws(() => s.answer("x"), /not an ask/);
  s.advance();
  assert.throws(() => s.advance(), /cannot simply advance/);
  assert.throws(() => s.choose(9), RangeError);
  const r = S.buildReceipt(s, 32, NOW);
  assert.ok(r.includes("THE ORACLE HAS SPOKEN") && r.includes("UNCHOSEN") && !r.includes("WHAT YOU SAID"));
});

test("interruptions fill in the guessed emotion", () => {
  const s = new S.Session(content, rng(5));
  s.advance();
  s.choose(2);
  for (let k = 0; k < 20; k++) {
    const line = s.interruption("sleepy");
    assert.ok(line.includes("sleepy") && !line.includes("{"), line);
  }
});

test("wrap and center behave like Python's textwrap and str.center", () => {
  assert.deepStrictEqual(S.wrap("", 10), []);
  assert.deepStrictEqual(S.wrap("hello world", 5), ["hello", "world"]);
  assert.deepStrictEqual(S.wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepStrictEqual(S.wrap("- a long answer here", 10, { subsequentIndent: "  " }), ["- a long", "  answer", "  here"]);
  assert.deepStrictEqual(S.wrap("self-evident truths", 8), ["self-", "evident", "truths"]);
  assert.strictEqual(S.center("ab", 7), "   ab");
  assert.strictEqual(S.center("abc", 8), "  abc");
  assert.strictEqual(S.center("SUGAR", 32), " ".repeat(13) + "SUGAR");
});

test("long and odd answers still fit the receipt", () => {
  const weird = ["x".repeat(200), "tabs\tand\nnewlines   and  spaces", "emoji \u{1F600}\u{1F600} café 日本語"];
  for (const { option } of BRANCHES) {
    const run = play(option, weird, { seed: 11, width: 32, sessionOpts: { mishearRate: 0.5 } });
    for (const line of run.receipt.split("\n")) assert.ok(Array.from(line).length <= 32, line);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
