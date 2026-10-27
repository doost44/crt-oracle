#!/usr/bin/env node
/* End-to-end test of the live Oracle in mock mode: python -m oracle.server --mock,
 * one whole conversation in headless Chromium, and the operator panel watching it.
 *
 *   node web/tests/live_e2e.js
 *
 * Needs Python with the repo's dependencies (pip install -e ".[dev]") and
 * Playwright with Chromium. Screenshots go to $E2E_SCREENSHOTS (default: a temp
 * folder). Exits 1 on any failed step, console error or page error.
 */
"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const STEP_TIMEOUT = 30000;
const TOTAL_TIMEOUT = 240000;
// Picked to make the mock change masks: short and flat, then defensive, then open.
const ANSWERS = [
  "my garden, I suppose",
  "idk",
  "nothing",
  "why do you want to know that",
  "who are you anyway",
  "honestly I miss my dad and I never told anyone that",
  "fine",
  "ok bye",
];

const SHOT_DIR = process.env.E2E_SCREENSHOTS
  ? path.resolve(process.env.E2E_SCREENSHOTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), "crt-oracle-live-e2e-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startOracle(port) {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const proc = spawn(python, ["-m", "oracle.server", "--mock", "--no-log", "--port", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode != null) throw new Error(`the server stopped:\n${output}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return proc;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`the server did not start:\n${output}`);
}

const step = (name) => console.log(`- ${name}`);

async function main() {
  const port = await freePort();
  const server = await startOracle(port);
  const base = `http://127.0.0.1:${port}/`;
  const errors = [];
  const shots = [];
  let browser;
  const killer = setTimeout(() => {
    console.error(`FAIL: the run took longer than ${TOTAL_TIMEOUT / 1000} s`);
    server.kill();
    process.exit(1);
  }, TOTAL_TIMEOUT);

  try {
    browser = await chromium.launch();
    const watch = (page, label) => {
      page.setDefaultTimeout(STEP_TIMEOUT);
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") errors.push(`${label} console: ${msg.text()}`);
      });
      page.on("pageerror", (err) => errors.push(`${label} pageerror: ${err.stack || err.message}`));
      page.on("response", (res) => {
        if (res.status() >= 400) errors.push(`${label} HTTP ${res.status()}: ${res.url()}`);
      });
    };
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const operator = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    watch(page, "oracle");
    watch(operator, "operator");
    const shot = async (p, name) => {
      const file = path.join(SHOT_DIR, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
      await p.screenshot({ path: file });
      shots.push(file);
    };

    step("open the operator panel");
    await operator.goto(base + "operator.html");
    await operator.waitForFunction(() => document.getElementById("op-status").textContent === "live");

    step(`open ${base}`);
    await page.goto(base);
    if (!(await page.evaluate(() => window.ORACLE_LIVE && window.ORACLE_LIVE.brain === "mock")))
      throw new Error("the page did not pick up the live config from the server");
    await page.waitForFunction(() => window.Oracle && window.Oracle.app && window.Oracle.app.state.scene === "boot");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.Oracle.app.state.scene === "hallway");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.Oracle.app.state.scene === "face");

    step("choose 1 (the sun)");
    await page.waitForSelector("#terminal .term-option.term-live");
    await page.keyboard.press("1");
    await page.waitForFunction(() => document.body.dataset.personality === "sugar");

    const INPUT = "#terminal .term-input input";
    const seen = new Set(["sugar"]);
    let answered = 0;
    for (const answer of ANSWERS) {
      const input = await page.waitForSelector(`${INPUT}, #receipt:not([hidden])`, { state: "attached" });
      if (await page.evaluate(() => !document.getElementById("receipt").hidden)) break;
      step(`answer ${answered + 1}: "${answer}"`);
      await input.focus();
      await page.keyboard.type(answer, { delay: 10 });
      await page.keyboard.press("Enter");
      await page.waitForSelector(INPUT, { state: "detached" });
      answered += 1;
      // Wait for the reply to be typed out before reading the mask.
      await page.waitForFunction(() => !document.querySelector("#terminal .term-thinking"));
      seen.add(await page.evaluate(() => document.body.dataset.personality));
      if (answered === 4) await shot(page, "conversation");
    }
    if (seen.size < 2) throw new Error(`the Oracle never changed masks (saw ${[...seen].join(", ")})`);
    console.log(`  masks seen: ${[...seen].join(" > ")}`);

    step("receipt");
    await page.waitForSelector("#receipt", { state: "visible" });
    await page.waitForFunction(() => document.getElementById("receipt").innerText.includes("WHAT YOU SAID"));
    await page.waitForTimeout(2500);
    await shot(page, "receipt");
    const receipt = await page.evaluate(() => document.getElementById("receipt").innerText);
    if (!/VOICES:/.test(receipt)) throw new Error(`the receipt has no VOICES line:\n${receipt}`);
    if (/\{\w+\}/.test(receipt)) throw new Error(`the receipt has an unfilled {slot}:\n${receipt}`);

    step("operator panel shows the whole conversation");
    await operator.waitForFunction(() => document.querySelectorAll("#op-log li.receipt").length === 1);
    const counts = await operator.evaluate(() => ({
      visitor: document.querySelectorAll("#op-log li.visitor").length,
      oracle: document.querySelectorAll("#op-log li.oracle").length,
      switches: document.querySelectorAll("#op-log li.switch").length,
      notes: document.querySelectorAll("#op-log .note").length,
    }));
    if (counts.visitor !== answered) throw new Error(`operator shows ${counts.visitor} visitor lines, expected ${answered}`);
    if (counts.oracle !== answered + 1) throw new Error(`operator shows ${counts.oracle} oracle lines, expected ${answered + 1}`);
    if (counts.switches < 1) throw new Error("operator shows no mask switch");
    console.log(`  operator: ${JSON.stringify(counts)}`);
    await shot(operator, "operator");

    step("the visitor's page never gets the operator notes");
    const leaked = await page.evaluate(async () => {
      const r = await fetch("api/session", { method: "POST", body: JSON.stringify({ symbol: "tree" }) });
      return Object.keys(await r.json());
    });
    if (leaked.includes("observation") || leaked.includes("seed")) throw new Error(`public reply has ${leaked}`);

    step("AGAIN: back to boot");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.Oracle.app.state.scene === "boot");
    if (await page.evaluate(() => document.body.dataset.personality))
      throw new Error("the personality is still set after AGAIN");
  } catch (err) {
    errors.push(`step failed: ${err.message}`);
  } finally {
    clearTimeout(killer);
    if (browser) await browser.close();
    server.kill();
  }

  console.log("\nScreenshots:");
  for (const f of shots) console.log(`  ${f}`);
  if (errors.length) {
    console.error(`\nFAIL (${errors.length}):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log("\nPASS: one live conversation in mock mode, watched from the operator panel");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
