#!/usr/bin/env node
/* End-to-end test of the spoken Oracle (talk.html) in headless Chromium.
 *
 *   node web/tests/talk.e2e.js
 *
 * The browser's voices and Claude are both stubbed: speechSynthesis finishes each
 * line at once and records which voice said it, and window.claude answers with a
 * scripted run of masks. A second pass runs with no Claude at all (the page opened
 * from disk) and checks the canned stand-in still plays. Answers are typed, since
 * headless Chromium has no speech recognition. Screenshots go to $E2E_SCREENSHOTS
 * (default: a temp folder). Exits 1 on any failed step or page error.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
const SHOTS = process.env.E2E_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "talk-e2e-"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(WEB, decodeURIComponent(req.url.split("?")[0]));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The browser's voices, made instant, with three to share out between the masks.
function stubSpeech() {
  const voices = ["Microsoft David", "Microsoft Zira", "Google UK English Male", "Microsoft Mark"].map((name) => ({ name, lang: "en-GB", localService: true }));
  window.__spoken = [];
  // No microphone in headless Chromium (its recognizer crashes the tab): answers are typed.
  window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => voices,
      speak(u) {
        if (u.text) window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, pitch: u.pitch });
        setTimeout(() => u.onend && u.onend(), 5);
      },
      cancel() {},
      addEventListener() {},
      removeEventListener() {},
    },
  });
}

// Claude, scripted: opens as Sugar, goes Weary on a short answer, Clinical on a challenge, then ends.
function stubClaude() {
  const script = [
    { personality: "sugar", lines: ["Oh, hello, sweetie.", "What are you proud of?"], end: false, why: "opening" },
    { personality: "weary", lines: ["Mm. Sure."], end: false, why: "a one-word answer" },
    { personality: "clinical", lines: ["Challenge logged.", "Compliance index: low."], end: false, why: "they tested it" },
    { personality: "clinical", lines: ["Session complete."], end: true, why: "closing" },
  ];
  window.__prompts = [];
  const sample = async () => ({ text: "" });
  sample.json = async (prompt, opts) => {
    window.__prompts.push({ prompt, opts });
    return script[Math.min(window.__prompts.length - 1, script.length - 1)];
  };
  window.claude = { use: async (name) => (name === "sample" ? sample : null) };
}

const fail = (msg) => {
  throw new Error(msg);
};

async function run(browser, base, withClaude) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("crash", () => console.log("page crashed"));
  if (process.env.DEBUG) page.on("console", (m) => console.log("console:", m.text()));
  await page.addInitScript(stubSpeech);
  if (withClaude) await page.addInitScript(stubClaude);
  await page.goto(base + "/talk.html?voices=plain");

  const mask = () => page.evaluate(() => window.Oracle.talk.state.mask);
  const waitIdle = () =>
    page
      .waitForFunction(() => !window.Oracle.talk.state.busy && !window.Oracle.talk.state.talking, null, { timeout: 15000, polling: 100 })
      .catch(async () => fail("stuck: " + (await page.evaluate(() => JSON.stringify({ ...window.Oracle.talk.state, events: undefined, spoken: window.__spoken, note: document.getElementById("note").textContent })))));
  const say = async (text) => {
    await page.fill("#typed-text", text);
    await page.click("#typed button");
    await waitIdle();
  };

  await page.click('.picks button[data-mask="sugar"]');
  await waitIdle();
  if ((await mask()) !== "sugar") fail("did not open as Sugar");
  if (!(await page.isVisible("#typed-text"))) fail("no way to answer without a microphone");
  await page.screenshot({ path: path.join(SHOTS, `${withClaude ? "claude" : "offline"}-1-open.png`) });

  await say("idk");
  if ((await mask()) !== "weary") fail("a short answer did not bring Weary");
  await say("why should I tell a television anything?");
  if ((await mask()) !== "clinical") fail("a challenge did not bring Clinical");
  if (!(await page.textContent("#why")).includes("Clinical took over")) fail("the switch was not explained");
  await page.screenshot({ path: path.join(SHOTS, `${withClaude ? "claude" : "offline"}-2-clinical.png`) });

  const spoken = await page.evaluate(() => window.__spoken);
  const voiceOf = (m) => spoken.find((s) => s.text && m.test(s.text));
  if (withClaude) {
    const names = [voiceOf(/sweetie/), voiceOf(/Mm/), voiceOf(/Challenge/)].map((s) => s && s.voice);
    if (names.some((n) => !n) || new Set(names).size !== 3) fail("masks did not get three different voices: " + names);

    const prompts = await page.evaluate(() => window.__prompts);
    const last = prompts[prompts.length - 1];
    if (!last.prompt.includes("You are the Oracle")) fail("the Oracle's system prompt was not sent");
    if (!last.prompt.includes("VISITOR (took") || !last.prompt.includes("idk")) fail("the conversation so far was not sent");
    if (!last.prompt.includes("turn: 2 of 8")) fail("the room note was not sent");
    if (last.opts.cache !== false) fail("replies must not be cached");

    await say("fine, whatever");
    const over = await page.evaluate(() => window.Oracle.talk.state.over);
    if (!over) fail("the Oracle did not end the conversation");
    if ((await page.textContent("#stop")) !== "Begin again") fail("no way to begin again");
  }
  if (errors.length) fail("page errors: " + errors.join("; "));
  await page.close();
}

/* The room voices: meSpeak through reverb and echo, a different voice per mask.
 * Skipped when web/vendor/mespeak is missing (python tools/fetch_voices.py). */
async function roomVoices(base) {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => (window.SpeechRecognition = window.webkitSpeechRecognition = undefined));
  await page.goto(base + "/talk.html");
  await page.waitForFunction(() => window.Oracle.talk.room.ready, null, { timeout: 20000 });
  if (!(await page.evaluate(() => window.Oracle.talk.useRoom))) fail("room voices are not on by default");
  const lengths = await page.evaluate(async () => {
    const room = window.Oracle.talk.room;
    const out = {};
    for (const mask of ["sugar", "weary", "clinical"]) out[mask] = (await room.render("I have been here a very long time.", mask)).duration;
    return out;
  });
  console.log("     room voice lengths (s):", JSON.stringify(lengths, (k, v) => (typeof v === "number" ? +v.toFixed(2) : v)));
  if (!(lengths.weary > lengths.sugar && lengths.weary > lengths.clinical)) fail("Weary should speak slowest");
  const spoke = await page.evaluate(async () => {
    const room = window.Oracle.talk.room;
    room.unlock();
    const t0 = performance.now();
    await room.speak("Subject detected.", "clinical");
    return { ms: performance.now() - t0, state: room.ctx.state, rooms: Object.keys(room.rooms) };
  });
  if (spoke.state !== "running" || !spoke.rooms.includes("clinical") || spoke.ms < 300) fail("room voice did not play: " + JSON.stringify(spoke));
  if (errors.length) fail("page errors: " + errors.join("; "));
  await browser.close();
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let ok = true;
  for (const withClaude of [true, false]) {
    const label = withClaude ? "with Claude (stubbed)" : "offline stand-in";
    try {
      await run(browser, base, withClaude);
      console.log("ok  ", label);
    } catch (e) {
      ok = false;
      console.log("FAIL", label, "-", e.message);
    }
  }
  await browser.close();
  if (fs.existsSync(path.join(WEB, "vendor", "mespeak", "VERSION"))) {
    try {
      await roomVoices(base);
      console.log("ok   room voices (reverb and echo)");
    } catch (e) {
      ok = false;
      console.log("FAIL room voices -", e.message);
    }
  } else {
    console.log("skip room voices: run python tools/fetch_voices.py");
  }
  server.close();
  console.log("screenshots:", SHOTS);
  process.exit(ok ? 0 : 1);
})();
