#!/usr/bin/env node
/* End-to-end test of the web version: plays one whole visit in headless Chromium.
 *
 *   node web/tests/e2e.js
 *
 * Starts its own static server for web/ on a free port, so nothing else needs to
 * run. Screenshots go to $E2E_SCREENSHOTS (default: a new temp folder); their paths
 * are printed. Exits 1 on any failed step, console error or page error.
 * Needs Playwright with Chromium (npm install playwright; npx playwright install chromium).
 */
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const WEB = path.resolve(__dirname, "..");
const STEP_TIMEOUT = 30000; // ms for any single wait
const TOTAL_TIMEOUT = 180000; // ms for the whole run
const ANSWERS = ["my tomato plants", "the rent", "a long nap"];

const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-e2e-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const file = path.normalize(path.join(WEB, urlPath));
    if (!file.startsWith(WEB + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        // The browser asks for a favicon on its own; don't count that as a page error.
        res.writeHead(urlPath === "/favicon.ico" ? 204 : 404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* Read window.ORACLE_CONTENT from web/data/content.js without a browser. */
function loadContent() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(WEB, "data", "content.js"), "utf8"), sandbox);
  return sandbox.window.ORACLE_CONTENT;
}

/* The personality that option 1 of the first choice node picks. */
function firstChoicePersonality(content) {
  const nodes = content.story.nodes;
  const choice = Object.values(nodes).find((n) => n.type === "choice" && n.options.some((o) => o.personality));
  if (!choice) throw new Error("no choice node with a personality in content.js");
  return content.personalities[choice.options[0].personality];
}

const norm = (s) => String(s).replace(/\s+/g, " ").trim();

function step(name) {
  console.log(`- ${name}`);
}

async function main() {
  const content = loadContent();
  const personality = firstChoicePersonality(content);
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
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    page.setDefaultTimeout(STEP_TIMEOUT);
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.stack || err.message}`));
    page.on("requestfailed", (req) => errors.push(`request failed: ${req.url()} ${req.failure()?.errorText}`));
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`);
    });

    const shot = async (name) => {
      const file = path.join(SHOT_DIR, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    };
    const scene = () => page.evaluate(() => window.Oracle && window.Oracle.app && window.Oracle.app.state.scene);
    const waitScene = (name) =>
      page.waitForFunction((s) => window.Oracle && window.Oracle.app && window.Oracle.app.state.scene === s, name);
    const terminalText = () => page.evaluate(() => document.getElementById("terminal").innerText);

    // The answer line: terminal.js puts a hidden <input> inside a .term-input line
    // and replaces the line with an echo when Enter is pressed.
    const INPUT = "#terminal .term-input input";
    const waitInput = () => page.waitForSelector(INPUT, { state: "attached" });
    const waitInputGone = () => page.waitForSelector(INPUT, { state: "detached" });

    step(`open ${base}`);
    await page.goto(base);
    await waitScene("boot");
    await page.waitForTimeout(600); // let the prompt blink on
    await shot("boot");

    step("Enter: hallway");
    await page.keyboard.press("Enter");
    await waitScene("hallway");
    await page.waitForTimeout(3000);
    await shot("hallway");

    step("Enter: skip to the Oracle");
    await page.keyboard.press("Enter");
    await waitScene("face");
    await page.waitForFunction(() => document.getElementById("terminal").innerText.trim().length > 0);

    step("choose 1");
    const nodes = content.story.nodes;
    await page.waitForSelector("#terminal .term-option.term-live");
    await page.keyboard.press("1");
    await page.waitForFunction((id) => window.Oracle.app.state.personality === id, personality.id);

    for (let i = 0; i < ANSWERS.length; i++) {
      step(`answer question ${i + 1}: "${ANSWERS[i]}"`);
      const input = await waitInput();
      await input.focus();
      await page.keyboard.type(ANSWERS[i], { delay: 15 });
      if (i === 1) await shot("face-talking");
      await page.keyboard.press("Enter");
      await waitInputGone();
    }

    const mash = Object.values(nodes).find((n) => n.type === "mash");
    const presses = (mash && mash.count) || 3;
    step(`press Enter ${presses} times`);
    await page.waitForSelector("#terminal .term-mash");
    for (let i = 0; i < presses; i++) {
      await page.waitForTimeout(250);
      await page.keyboard.press("Enter");
    }
    await page.waitForSelector("#terminal .term-mash.term-done");

    step("receipt");
    await page.waitForSelector("#receipt", { state: "visible" });
    await page.waitForFunction(() => document.getElementById("receipt").innerText.trim().length > 0);
    // Let the ticket finish printing (finite CSS animations; blinking cursors loop forever).
    await page.evaluate(() => {
      const anims = document
        .getElementById("receipt")
        .getAnimations({ subtree: true })
        .filter((a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity);
      return Promise.race([Promise.all(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 10000))]);
    });
    await page.waitForTimeout(300);
    await shot("receipt");
    // The ticket must really be on screen, in front of the face (not unstyled below the fold).
    const onScreen = await page.evaluate(() => {
      const ticket = document.querySelector("#receipt .ticket") || document.getElementById("receipt");
      const r = ticket.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 40), 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      const inView = r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
      return { inView, onTop: !!hit && document.getElementById("receipt").contains(hit), top: Math.round(r.top) };
    });
    if (!onScreen.inView || !onScreen.onTop)
      throw new Error(`the receipt is not visible on screen (top ${onScreen.top}px, on top: ${onScreen.onTop}); is its CSS loaded?`);

    const receipt = norm(await page.evaluate(() => document.getElementById("receipt").innerText));
    const problems = [];
    if (!receipt.toUpperCase().includes(norm(personality.receipt.title).toUpperCase()))
      problems.push(`receipt has no title "${personality.receipt.title}"`);
    if (/PLACEHOLDER/i.test(receipt)) problems.push("receipt contains PLACEHOLDER");
    if (/\{\w+\}/.test(receipt)) problems.push(`receipt has an unfilled {slot}: ${receipt.match(/\{\w+\}/)[0]}`);
    const verdicts = personality.receipt.lines.map((line) => norm(line.split("{")[0])).filter(Boolean);
    const found = verdicts.filter((v) => receipt.toUpperCase().includes(v.toUpperCase()));
    if (found.length === 0) problems.push("receipt shows none of the personality's verdict lines");
    if (problems.length) throw new Error(`${problems.join("; ")}\n  receipt text: ${receipt}`);
    console.log(`  receipt ok: "${personality.receipt.title}", ${found.length}/${verdicts.length} verdict lines`);

    step("AGAIN (Enter): back to boot");
    if (!(await page.locator("#receipt button", { hasText: /again/i }).count()))
      throw new Error("the receipt has no AGAIN button");
    await page.waitForTimeout(1500); // the receipt ignores Enter for its first moment
    await page.keyboard.press("Enter");
    await waitScene("boot");
    await page.waitForFunction(() => document.getElementById("receipt").hidden);
    if (norm(await terminalText())) throw new Error("the terminal still shows text after AGAIN");
    await page.waitForTimeout(300);
    await shot("boot-again");
    if ((await scene()) !== "boot") throw new Error("not on the boot screen after AGAIN");
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
  console.log("\nPASS: one whole visit, no console or page errors");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
