#!/usr/bin/env node
/* Browser test of the 3D ASCII figures demo (web/figures.html), in headless Chromium:
 *
 *   node web/tests/figures.e2e.js
 *
 * Checks each personality draws a figure with a face cut into it, in its own
 * colours; that switching tears from one to the other; that the lean follows the
 * look input; and that talking moves the mouth. Screenshots go to
 * $E2E_SCREENSHOTS (default: a new temp folder). Exits 1 on any failure.
 * Needs Playwright with Chromium (npm install playwright; npx playwright install chromium).
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-figures-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

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

/* Render one frame straight from the Figures object in the page and summarise it. */
function sample(page, t, opts) {
  return page.evaluate(
    ({ t, opts }) => {
      const f = window.figuresDemo.figures;
      const out = f.render(120, 50, t, opts);
      let filled = 0, sx = 0, holes = 0, hx = 0;
      const colors = new Set();
      for (let y = 0; y < out.rows; y++) {
        let inside = false;
        for (let x = 0; x < out.cols; x++) {
          const i = y * out.cols + x;
          if (out.chars[i] !== " ") {
            filled++;
            sx += x;
            colors.add(out.colors[i]);
            inside = true;
          } else if (inside && out.chars.slice(i, y * out.cols + out.cols).some((c) => c !== " ")) {
            holes++; // blank cells with figure on both sides: the cut-out face
            hx += x;
          }
        }
      }
      return { filled, cx: sx / Math.max(1, filled), holes, hx: hx / Math.max(1, holes), colors: [...colors], text: out.chars.join("") };
    },
    { t, opts }
  );
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/figures.html`;
  const errors = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${base}?still=1`);
    await page.waitForFunction(() => document.getElementById("art").textContent.trim().length > 500);
    const P = await page.evaluate(() => window.Oracle.PERSONALITIES_3D);

    // Pause the page's own loop so only this test drives the figures.
    await page.evaluate(() => (window.requestAnimationFrame = () => 0));

    let t = 10;
    for (const id of Object.keys(P)) {
      // Switch, then let the tear finish.
      await sample(page, t, { personality: id, look: null });
      const s = await sample(page, (t += 2), { personality: id, look: null });
      assert.ok(s.filled > 120 * 50 * 0.15, `${id}: figure fills the block (${s.filled} cells)`);
      assert.ok(s.holes > 15, `${id}: face cut into the figure (${s.holes} blank cells inside)`);
      const palette = [P[id].colors.bright, P[id].colors.mid, P[id].colors.dim];
      for (const c of s.colors) assert.ok(palette.includes(c), `${id}: colour ${c} is from its palette`);
      console.log(`- ${id}: ${s.filled} cells, ${s.holes} face cells, ${s.colors.length} shades`);

      await page.evaluate((id) => window.figuresDemo.setPersonality(id), id);
      await page.evaluate(
        (t) => {
          const d = window.figuresDemo;
          const out = d.figures.render(150, 56, t, { personality: d.state.personality });
          document.getElementById("art").textContent = out.chars.join("").match(/.{150}/g).join("\n");
        },
        t
      );
      await page.screenshot({ path: path.join(SHOT_DIR, `figure-${id}.png`) });
      t += 2;
    }

    // Mid-switch both palettes are on screen.
    await sample(page, t, { personality: "sugar" });
    const tear = await sample(page, (t += 0.45), { personality: "sugar" });
    const warm = P.sugar.colors, cold = P.clinical.colors;
    assert.ok(tear.colors.some((c) => Object.values(warm).includes(c)), "switch: new colours in");
    assert.ok(tear.colors.some((c) => Object.values(cold).includes(c)), "switch: old colours still there");
    console.log("- switching tears between personalities");
    t += 2;

    // The lean follows the look input: the face turns toward that side.
    const lean = async (x) => {
      for (let k = 0; k < 40; k++) await sample(page, (t += 0.1), { personality: "weary", look: { x, y: 0 } });
      return sample(page, (t += 0.1), { personality: "weary", look: { x, y: 0 } });
    };
    const left = await lean(-1);
    const right = await lean(1);
    assert.notStrictEqual(left.text, right.text, "lean changes the picture");
    assert.ok(right.hx > left.hx + 4, `lean: face moves right (${left.hx.toFixed(1)} -> ${right.hx.toFixed(1)})`);
    console.log(`- lean follows the look input (face centre ${left.hx.toFixed(1)} -> ${right.hx.toFixed(1)})`);

    // Talking moves the mouth: frames change between two close moments.
    const idleA = await sample(page, (t += 1), { personality: "weary", mood: "idle", look: null });
    for (let k = 0; k < 10; k++) await sample(page, (t += 0.05), { personality: "weary", mood: "talking" });
    const talkA = await sample(page, (t += 0.05), { personality: "weary", mood: "talking" });
    const talkB = await sample(page, (t += 0.12), { personality: "weary", mood: "talking" });
    assert.notStrictEqual(talkA.text, talkB.text, "talking animates");
    assert.ok(idleA.filled > 0);
    console.log("- talking animates the mouth");

    assert.deepStrictEqual(errors, [], "no page errors");
    console.log(`PASS. Screenshots in ${SHOT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
