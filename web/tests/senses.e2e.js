#!/usr/bin/env node
/* Browser test for voice answers and physical actions: plays one visit in headless
 * Chromium with ?voice=1&actions=hold_still, answering by "voice".
 *
 *   node web/tests/senses.e2e.js
 *
 * The microphone is replaced by a stand-in SpeechRecognition that "hears" scripted
 * answers, so the real voice.js code runs. The face tracker is replaced by one that
 * feeds a still synthetic face, unless FACE_VIDEO points at a .y4m or .mjpeg file
 * of a real face: then Chromium plays it as the webcam and the real MediaPipe model
 * runs (needs web/vendor/, from python tools/fetch_vendor.py, or internet).
 * Screenshots go to $E2E_SCREENSHOTS (default: a new temp folder).
 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
const FACE_VIDEO = process.env.FACE_VIDEO ? path.resolve(process.env.FACE_VIDEO) : null;
const STEP_TIMEOUT = 30000;
const TOTAL_TIMEOUT = 240000;
const SPOKEN = ["the rock", "my tomato plants", "the rent", "a long nap"];

const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-senses-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const file = path.normalize(path.join(WEB, urlPath));
    if (!file.startsWith(WEB + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (err, body) => {
      if (err) return res.writeHead(urlPath === "/favicon.ico" ? 204 : 404).end();
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function loadContent() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(WEB, "data", "content.js"), "utf8"), sandbox);
  return sandbox.window.ORACLE_CONTENT;
}

/* Runs in the page before its scripts: a SpeechRecognition that hears window.__spoken
 * one answer per start(), first as words coming in, then as a final result. */
function fakeMicrophone(spoken) {
  window.__spoken = spoken.slice();
  window.__heard = [];
  class FakeRecognition {
    start() {
      if (this._live) throw new Error("already started");
      this._live = true;
      const text = window.__spoken.length ? window.__spoken[0] : null;
      if (!text) return; // nobody talking: stay quiet until listen() gives up
      const words = text.split(" ");
      const emit = (t, isFinal) => {
        if (!this._live || !this.onresult) return;
        const result = { 0: { transcript: t, confidence: 0.9 }, length: 1, isFinal };
        this.onresult({ resultIndex: 0, results: [result] });
      };
      this._timers = [
        setTimeout(() => emit(words.slice(0, Math.ceil(words.length / 2)).join(" "), false), 250),
        setTimeout(() => {
          window.__spoken.shift();
          window.__heard.push(text);
          emit(text, true);
        }, 600),
      ];
    }
    stop() {
      this.abort();
    }
    abort() {
      this._live = false;
      (this._timers || []).forEach(clearTimeout);
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
}

/* Runs in the page after its scripts: swap the camera tracker for one that feeds a
 * still, front-facing synthetic face (the shape of a FaceLandmarker result). */
function fakeFace() {
  const P = window.Oracle.Actions.P;
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const at = (i, dx, dy) => (lm[i] = { x: 0.5 + dx * 0.3, y: 0.5 + dy * 0.39, z: 0 });
  at(P.cheekR, -0.5, 0);
  at(P.cheekL, 0.5, 0);
  at(P.forehead, 0, -0.5);
  at(P.chin, 0, 0.5);
  at(P.nose, 0, 0.1);
  for (const [eye, s] of [[P.eyeR, -1], [P.eyeL, 1]]) {
    at(eye.outer, s * 0.32, -0.15);
    at(eye.inner, s * 0.1, -0.15);
    at(eye.top, s * 0.21, -0.19);
    at(eye.bottom, s * 0.21, -0.11);
  }
  const result = { faceLandmarks: [lm] };
  const Real = window.Oracle.FaceTrack;
  class StillFace extends Real {
    async start() {
      this.running = true;
      this.cameraLabel = "still synthetic face";
      this._timer = setInterval(() => this.feed(result), 50);
    }
    stop() {
      clearInterval(this._timer);
      this.running = false;
      this.latest = { result: null, features: null, at: 0 };
    }
  }
  window.Oracle.FaceTrack = StillFace;
}

const step = (name) => console.log(`- ${name}`);

async function main() {
  const content = loadContent();
  const choiceNode = Object.values(content.story.nodes).find((n) => n.type === "choice" && n.options.some((o) => o.personality));
  const rock = choiceNode.options.findIndex((o) => /rock/i.test(o.label));
  const personality = content.personalities[choiceNode.options[rock].personality];
  const asks = Object.values(content.story.nodes).filter((n) => n.type === "ask").length / 3; // per branch
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  const shots = [];
  let browser;
  const killer = setTimeout(() => {
    console.error(`FAIL: the run took longer than ${TOTAL_TIMEOUT / 1000} s`);
    process.exit(1);
  }, TOTAL_TIMEOUT);

  try {
    const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
    if (FACE_VIDEO) args.push(`--use-file-for-fake-video-capture=${FACE_VIDEO}`);
    browser = await chromium.launch({ args });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await context.grantPermissions(["camera", "microphone"]);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    page.on("console", (msg) => {
      // MediaPipe prints its start-up notes ("INFO: Created TensorFlow Lite XNNPACK delegate") as errors.
      if (msg.type() === "error" && !/^INFO:/.test(msg.text())) errors.push(`console: ${msg.text()}`);
      if (msg.type() === "warning" && /physical actions are off/.test(msg.text())) errors.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.stack || err.message}`));
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`);
    });
    await page.addInitScript(fakeMicrophone, SPOKEN);

    const shot = async (name) => {
      const file = path.join(SHOT_DIR, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    };
    const waitScene = (name) => page.waitForFunction((s) => window.Oracle.app && window.Oracle.app.state.scene === s, name);

    const url = `${base}?voice=1&actions=hold_still&every=1`;
    step(`open ${url}${FACE_VIDEO ? ` (webcam: ${path.basename(FACE_VIDEO)})` : " (synthetic face)"}`);
    await page.goto(url);
    await waitScene("boot");
    if (!FACE_VIDEO) await page.evaluate(fakeFace);
    const hasSenses = await page.evaluate(() => !!window.Oracle.app.senses);
    if (!hasSenses) throw new Error("?voice=1 didn't switch the senses on");

    step("Enter, Enter: to the Oracle");
    await page.keyboard.press("Enter");
    await waitScene("hallway");
    await page.keyboard.press("Enter");
    await waitScene("face");

    step(`say "${SPOKEN[0]}" to pick from the menu`);
    await page.waitForFunction((id) => window.Oracle.app.state.personality === id, personality.id, { timeout: 60000 });
    console.log(`  picked ${personality.id}`);

    for (let i = 0; i < asks; i++) {
      step(`action ${i + 1}: hold still`);
      // Old lines drop off the top of the terminal, so find the newest action bar by marking each one.
      const bar = await page.waitForFunction(
        () => {
          const el = Array.from(document.querySelectorAll("#terminal .term-action")).find((n) => !n.dataset.seen);
          if (el) el.dataset.seen = "1";
          return el || null;
        },
        null,
        { timeout: 60000 }
      );
      if (i === 0) {
        await page.waitForTimeout(1200);
        await shot("action-holding");
      }
      await page.waitForFunction((el) => el.classList.contains("term-done"), bar, { timeout: 20000 });
      const text = await bar.evaluate((el) => el.innerText);
      if (!/OK$/.test(text.trim())) throw new Error(`the action wasn't seen as done: "${text}"`);

      step(`answer ${i + 1} by voice: "${SPOKEN[i + 1]}"`);
      await page.waitForSelector("#terminal .term-input.term-listening");
      if (i === 0) {
        await page.waitForFunction(() => {
          const input = document.querySelector("#terminal .term-input input");
          return input && input.value.length > 0;
        });
        await shot("listening");
      }
      await page.waitForFunction((n) => window.__heard.length >= n, i + 2);
      await page.waitForSelector("#terminal .term-input", { state: "detached" });
      const echoed = await page.locator("#terminal .term-you").allInnerTexts();
      if (!echoed.some((t) => t.includes(SPOKEN[i + 1]) || /^>/.test(t)))
        throw new Error(`the spoken answer isn't in the terminal: ${echoed.join(" | ")}`);
    }

    step("press Enter for the mash (still the keyboard)");
    const mash = Object.values(content.story.nodes).find((n) => n.type === "mash");
    await page.waitForSelector("#terminal .term-mash:not(.term-action)");
    for (let i = 0; i < ((mash && mash.count) || 3); i++) {
      await page.waitForTimeout(250);
      await page.keyboard.press("Enter");
    }

    step("receipt");
    await page.waitForSelector("#receipt", { state: "visible", timeout: 60000 });
    const receipt = await page.evaluate(() => document.getElementById("receipt").innerText);
    const answered = SPOKEN.slice(1).filter((a) => receipt.toLowerCase().includes(a.split(" ").pop()));
    console.log(`  ${answered.length}/${SPOKEN.length - 1} spoken answers on the receipt (the Oracle may "mishear" one)`);
    if (answered.length < SPOKEN.length - 2) throw new Error(`spoken answers missing from the receipt:\n${receipt}`);
    await shot("receipt");

    step("AGAIN: the camera is let go");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Enter");
    await waitScene("boot");
    const tracking = await page.evaluate(() => !!window.Oracle.app.senses.tracker);
    if (tracking) throw new Error("the tracker is still running after the visit");

    if (FACE_VIDEO) {
      step("lab page: real landmarks from the webcam video");
      await page.goto(`${base}lab.html`);
      await page.click("#camBtn");
      await page.waitForFunction(() => /camera:/.test(document.getElementById("camStatus").textContent), null, { timeout: 60000 });
      await page.waitForFunction(() => /\d/.test(document.getElementById("meters").children[2].textContent));
      await page.waitForTimeout(1000);
      const meters = await page.evaluate(() => {
        const cells = Array.from(document.getElementById("meters").children).map((c) => c.textContent);
        const out = {};
        for (let i = 0; i < cells.length; i += 3) out[cells[i]] = cells[i + 2];
        return out;
      });
      console.log(`  readings: ${JSON.stringify(meters)}`);
      await shot("lab");
    }
  } catch (err) {
    errors.push(`step failed: ${err.message}`);
  } finally {
    clearTimeout(killer);
    if (browser) await browser.close();
    server.close();
  }

  console.log("\nScreenshots:");
  for (const f of shots) console.log(`  ${f}`);
  if (errors.length) {
    console.error(`\nFAIL (${errors.length}):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log("\nPASS: a visit answered by voice, with physical actions");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
