#!/usr/bin/env node
/* Browser test of the spoken Oracle with its second monitor: talk.html and
 * readout.html open side by side, a fake camera, and Claude stubbed.
 *
 *   python tools/fetch_vision.py          (once: the face tracker files)
 *   node web/tests/talk_readout.e2e.js face.jpg
 *   LOOK=glitch node web/tests/talk_readout.e2e.js face.jpg   (talk-glitch.html, readout-glitch.html)
 *
 * The fake camera shows the still picture given (a photo with one face in it).
 * Claude is scripted: it opens, answers the visitor with a "hold still" command,
 * then reacts to how that went. The test checks that:
 *   - the readout tells the Oracle its camera is live and a face is in view, so
 *     the Oracle's prompt offers commands;
 *   - the readout shows what the visitor said and the Oracle's note;
 *   - the command appears on the readout, the still face completes it, and the
 *     result goes back into the Oracle's next prompt;
 *   - nothing logs an error.
 * Screenshots go to $E2E_SCREENSHOTS (default: a new temp folder).
 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
// LOOK=glitch runs the same visit on the glitch look's pages.
const LOOK = process.env.LOOK ? "-" + process.env.LOOK : "";
const FACE = process.argv[2] ? path.resolve(process.argv[2]) : null;
const FRAME_W = 640;
const FRAME_H = 480;
const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-talk-readout-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
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

/* RGBA pixels -> one-frame Y4M (I420), which Chromium's fake camera loops. */
function toY4m(rgba, w, h) {
  const y = Buffer.alloc(w * h);
  const u = Buffer.alloc((w / 2) * (h / 2));
  const v = Buffer.alloc((w / 2) * (h / 2));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      const [r, g, b] = [rgba[k], rgba[k + 1], rgba[k + 2]];
      y[j * w + i] = Math.max(0, Math.min(255, 0.257 * r + 0.504 * g + 0.098 * b + 16));
      if (j % 2 === 0 && i % 2 === 0) {
        const c = (j / 2) * (w / 2) + i / 2;
        u[c] = Math.max(0, Math.min(255, -0.148 * r - 0.291 * g + 0.439 * b + 128));
        v[c] = Math.max(0, Math.min(255, 0.439 * r - 0.368 * g - 0.071 * b + 128));
      }
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\nFRAME\n`);
  return Buffer.concat([header, y, u, v]);
}

async function makeFakeCamera() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUrl = `data:image/${path.extname(FACE).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(FACE).toString("base64")}`;
  const pixels = await page.evaluate(
    async ({ dataUrl, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#555";
      g.fillRect(0, 0, w, h);
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const s = Math.min(w / img.width, h / img.height);
      g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      return Array.from(g.getImageData(0, 0, w, h).data);
    },
    { dataUrl, w: FRAME_W, h: FRAME_H }
  );
  await browser.close();
  const file = path.join(SHOT_DIR, "fake-camera.y4m");
  fs.writeFileSync(file, toY4m(pixels, FRAME_W, FRAME_H));
  return file;
}

// In the talk page: instant voices, no speech recognition, and a scripted Claude.
function stubTalkPage() {
  window.SpeechRecognition = window.webkitSpeechRecognition = undefined;
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      getVoices: () => [],
      speak: (u) => setTimeout(() => u.onend && u.onend(), 5),
      cancel() {},
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const script = [
    { personality: "clinical", lines: ["Subject detected.", "State your purpose."], end: false, why: "opening", command: "none" },
    { personality: "clinical", lines: ["Noted. Subject will remain motionless."], end: false, why: "testing compliance", command: "hold_still" },
    { personality: "sugar", lines: ["Oh, you held so still! Like a little statue."], end: false, why: "rewarding obedience", command: "none" },
  ];
  window.__prompts = [];
  const sample = async () => ({ text: "" });
  sample.json = async (prompt) => {
    window.__prompts.push(prompt);
    return script[Math.min(window.__prompts.length - 1, script.length - 1)];
  };
  window.claude = { use: async (name) => (name === "sample" ? sample : null) };
}

async function main() {
  if (!FACE) {
    console.error("usage: node web/tests/talk_readout.e2e.js face.jpg   (a photo with one face)");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(WEB, "vendor", "mediapipe", "VERSION"))) {
    console.error("FAIL: web/vendor/mediapipe is missing. Run: python tools/fetch_vision.py");
    process.exit(1);
  }
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  const step = (name) => console.log(`- ${name}`);
  let browser;
  let ok = true;
  try {
    const y4m = await makeFakeCamera();
    browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.grantPermissions(["camera"]);
    const watch = (page, name) => {
      page.setDefaultTimeout(30000);
      page.on("console", (msg) => {
        if (msg.type() === "error" && !/^(INFO|W\d{4}|I\d{4}):?\s/.test(msg.text())) errors.push(`${name} console: ${msg.text()}`);
      });
      page.on("pageerror", (err) => errors.push(`${name} pageerror: ${err.stack || err.message}`));
      return page;
    };

    step("open the second screen: the camera starts and finds the face");
    const readout = watch(await context.newPage(), "readout");
    await readout.goto(base + `readout${LOOK}.html`);
    await readout.waitForFunction(() => window.Oracle.presence.status === "live");
    await readout.waitForFunction(() => !!window.Oracle.presence.current, null, { timeout: 60000 });

    step("open the spoken Oracle: it hears the readout's camera is live");
    const talk = watch(await context.newPage(), "talk");
    await talk.addInitScript(stubTalkPage);
    await talk.goto(base + `talk${LOOK}.html`);
    await talk.waitForFunction(() => window.Oracle.talk.eye.camera === "live" && window.Oracle.talk.eye.face);

    step("start, and answer: the Oracle gives a command");
    await talk.click('.picks button[data-mask="clinical"]');
    await talk.waitForFunction(() => !window.Oracle.talk.state.busy);
    const opening = await talk.evaluate(() => window.__prompts[0]);
    if (!opening.includes("hold_still")) throw new Error("the prompt did not offer commands with the camera live");
    await talk.fill("#typed-text", "I'm just looking around");
    await talk.click("#typed button");

    step("the readout shows the instruction, what was said and the note");
    await readout.waitForFunction(() => window.Oracle.readout.state.command && window.Oracle.readout.state.command.action === "hold_still");
    const seen = await readout.evaluate(() => ({ heard: window.Oracle.readout.state.heard, log: window.Oracle.readout.state.log.map((e) => e.label) }));
    if (seen.heard !== "I'm just looking around") throw new Error(`readout heard: ${seen.heard}`);
    if (!seen.log.some((l) => l.includes("TESTING COMPLIANCE"))) throw new Error("the Oracle's note is not in the readout's log");
    await readout.waitForTimeout(1500);
    await readout.screenshot({ path: path.join(SHOT_DIR, "1-readout-instruction.png") });

    step("the still face holds still; the result goes back to the Oracle");
    await readout.waitForFunction(() => window.Oracle.readout.state.command && window.Oracle.readout.state.command.result, null, { timeout: 20000 });
    const result = await readout.evaluate(() => window.Oracle.readout.state.command.result);
    console.log(`  command result: ${result}`);
    if (result !== "done") throw new Error("a still picture should complete hold_still");
    await readout.screenshot({ path: path.join(SHOT_DIR, "2-readout-complied.png") });
    await talk.waitForFunction(() => window.__prompts.length >= 3 && !window.Oracle.talk.state.busy, null, { timeout: 20000 });
    const reaction = await talk.evaluate(() => window.__prompts[2]);
    if (!/ROOM: command hold_still: the visitor did it/.test(reaction)) throw new Error("the command's result was not in the next prompt");
    if (!reaction.includes("no command this turn")) throw new Error("the Oracle may command again straight away");
    if ((await talk.evaluate(() => window.Oracle.talk.state.mask)) !== "sugar") throw new Error("the reaction did not switch mask");
    await talk.screenshot({ path: path.join(SHOT_DIR, "3-talk-reaction.png") });
    await readout.waitForTimeout(500);
    await readout.screenshot({ path: path.join(SHOT_DIR, "4-readout-sugar.png") });
  } catch (err) {
    ok = false;
    console.log(`FAIL: ${err.message}`);
  }
  if (errors.length) {
    ok = false;
    console.log("errors:\n  " + errors.join("\n  "));
  }
  if (browser) await browser.close();
  server.close();
  console.log(`screenshots: ${SHOT_DIR}`);
  console.log(ok ? "ok" : "FAILED");
  process.exit(ok ? 0 : 1);
}

main();
