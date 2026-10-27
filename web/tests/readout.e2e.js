#!/usr/bin/env node
/* Browser test of the always-on camera and the readout screen.
 *
 *   python tools/fetch_vision.py          (once: the face tracker files)
 *   node web/tests/readout.e2e.js [face.jpg]
 *
 * Chromium gets a fake camera that shows a still picture (the image given, or a
 * plain test card when none is). The test opens the Oracle's screen and the
 * readout screen side by side and checks that:
 *   - the camera opens on both, and the Oracle's screen shows its REC mark;
 *   - with a face picture, the tracker finds the face and the readout draws it
 *     from the Oracle's screen's results ("linked");
 *   - with the Oracle's screen closed, the readout tracks the face by itself;
 *   - nothing logs an error.
 * Screenshots go to $E2E_SCREENSHOTS (default: a new temp folder).
 * Needs Playwright with Chromium, like web/tests/e2e.js.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
const FACE = process.argv[2] ? path.resolve(process.argv[2]) : null;
const STEP_TIMEOUT = 30000;
const FRAME_W = 640;
const FRAME_H = 480;

const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-readout-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
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

/* Draw the face picture (or a test card) at camera size in a throwaway browser page. */
async function makeFakeCamera(browser) {
  const page = await browser.newPage();
  const dataUrl = FACE ? `data:image/${path.extname(FACE).slice(1)};base64,${fs.readFileSync(FACE).toString("base64")}` : null;
  const pixels = await page.evaluate(
    async ({ dataUrl, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#555";
      g.fillRect(0, 0, w, h);
      if (dataUrl) {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const s = Math.min(w / img.width, h / img.height);
        g.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      } else {
        for (let i = 0; i < 8; i++) {
          g.fillStyle = `hsl(${i * 45},60%,50%)`;
          g.fillRect((i * w) / 8, 0, w / 8, h);
        }
      }
      return Array.from(g.getImageData(0, 0, w, h).data);
    },
    { dataUrl, w: FRAME_W, h: FRAME_H }
  );
  await page.close();
  const file = path.join(SHOT_DIR, "fake-camera.y4m");
  fs.writeFileSync(file, toY4m(pixels, FRAME_W, FRAME_H));
  return file;
}

async function main() {
  if (!fs.existsSync(path.join(WEB, "vendor", "mediapipe", "VERSION"))) {
    console.error("FAIL: web/vendor/mediapipe is missing. Run: python tools/fetch_vision.py");
    process.exit(1);
  }
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  const shots = [];
  let browser;
  const step = (name) => console.log(`- ${name}`);

  try {
    const plain = await chromium.launch();
    const y4m = await makeFakeCamera(plain);
    await plain.close();

    browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
    });
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await context.grantPermissions(["camera"]);
    const watch = (page, name) => {
      page.setDefaultTimeout(STEP_TIMEOUT);
      page.on("console", (msg) => {
        // MediaPipe's wasm prints its start-up notes through console.error.
        if (msg.type() === "error" && !/^(INFO|W\d{4}|I\d{4}):?\s/.test(msg.text())) errors.push(`${name} console: ${msg.text()}`);
      });
      page.on("pageerror", (err) => errors.push(`${name} pageerror: ${err.stack || err.message}`));
      page.on("response", (res) => {
        if (res.status() >= 400) errors.push(`${name} HTTP ${res.status()}: ${res.url()}`);
      });
      return page;
    };
    const shot = async (page, name) => {
      const file = path.join(SHOT_DIR, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    };

    step("open the Oracle's screen: the camera turns on by itself");
    const main = watch(await context.newPage(), "main");
    await main.goto(base);
    await main.waitForFunction(() => window.Oracle.presence.status === "live");
    const label = await main.evaluate(() => window.Oracle.presence.cameraLabel);
    console.log(`  camera: ${label}`);

    step("open the readout screen");
    const readout = watch(await context.newPage(), "readout");
    await readout.goto(base + "readout.html");
    await readout.waitForFunction(() => window.Oracle.presence.status === "live");

    if (FACE) {
      step("the Oracle's screen finds the face");
      await main.waitForFunction(() => !!window.Oracle.presence.current, null, { timeout: 60000 });
      const face = await main.evaluate(() => {
        const f = window.Oracle.presence.current;
        return { size: f.size, turn: f.turn, nod: f.nod, mood: window.Oracle.faceReading.mood(f) };
      });
      console.log(`  face: size ${face.size.toFixed(2)}, turn ${face.turn.toFixed(2)}, nod ${face.nod.toFixed(2)}, mood ${face.mood}`);
      await main.waitForFunction(() => document.getElementById("watching").classList.contains("watching-on"));
      await shot(main, "main-rec");

      step("the readout draws the Oracle's results, and locks on");
      await readout.waitForFunction(() => window.Oracle.presence.tracking === "remote" && !!window.Oracle.presence.current);
      await readout.waitForTimeout(4500); // through the acquire sequence to the lock
      await shot(readout, "readout-linked");

      step("close the Oracle's screen: the readout tracks by itself");
      await main.close();
      await readout.waitForFunction(() => window.Oracle.presence.tracking === "local" && !!window.Oracle.presence.current, null, {
        timeout: 60000,
      });
      await readout.waitForTimeout(1000);
      await shot(readout, "readout-alone");
    } else {
      step("no face picture given: the readout shows NO SUBJECT");
      await readout.waitForTimeout(3000);
      const current = await readout.evaluate(() => window.Oracle.presence.current);
      if (current) throw new Error("found a face in the test card");
      await shot(readout, "readout-no-subject");
    }
  } catch (err) {
    errors.push(`step failed: ${err.message}`);
  } finally {
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
  console.log("\nPASS: camera, tracker and readout, no errors");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
