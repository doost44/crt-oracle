#!/usr/bin/env node
/* Browser test for exhibit mode and sound: node web/tests/kiosk.test.js
 *
 * Opens web/index.html?kiosk=1&idle=10 in headless Chromium with the same
 * autoplay flag the kiosk launcher uses, then checks that the sound engine
 * runs and makes sounds, the cursor is hidden, and a visitor who walks away
 * mid-visit is sent back to the boot screen.
 * Needs Playwright with Chromium, like e2e.js.
 */
"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const PAGE = pathToFileURL(path.resolve(__dirname, "..", "index.html")).href + "?kiosk=1&idle=10";

async function main() {
  const errors = [];
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    page.setDefaultTimeout(30000);
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    // Count the sounds the page asks for.
    await page.addInitScript(() => {
      window.__sounds = { tick: 0, key: 0, print: 0 };
      const wrap = () => {
        const s = window.Oracle && window.Oracle.sound;
        if (!s || s.__wrapped) return;
        for (const name of ["tick", "key", "print"]) {
          const fn = s[name];
          s[name] = (...args) => {
            window.__sounds[name] += 1;
            return fn(...args);
          };
        }
        s.__wrapped = true;
      };
      document.addEventListener("DOMContentLoaded", wrap);
    });

    console.log(`- open ${PAGE}`);
    await page.goto(PAGE);
    await page.waitForFunction(() => window.Oracle && window.Oracle.app && window.Oracle.app.state.scene === "boot");

    const kiosk = await page.evaluate(() => ({
      on: window.Oracle.kiosk.on,
      cls: document.documentElement.classList.contains("kiosk"),
      cursor: getComputedStyle(document.getElementById("screen")).cursor,
    }));
    if (!kiosk.on || !kiosk.cls || kiosk.cursor !== "none") errors.push(`kiosk mode not on: ${JSON.stringify(kiosk)}`);

    console.log("- sound starts without a click (autoplay flag)");
    await page.waitForFunction(() => window.Oracle.sound.state === "running", null, { timeout: 5000 }).catch(() => {
      errors.push("the AudioContext is not running");
    });

    console.log("- Enter, Enter: hallway, then the Oracle talks");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.Oracle.app.state.scene === "hallway");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.Oracle.app.state.scene === "face");
    await page.waitForFunction(() => window.__sounds.tick > 5);

    console.log("- Ctrl+M mutes and unmutes");
    await page.keyboard.press("Control+m");
    if (!(await page.evaluate(() => window.Oracle.sound.muted))) errors.push("Ctrl+M did not mute");
    await page.keyboard.press("Control+m");
    if (await page.evaluate(() => window.Oracle.sound.muted)) errors.push("Ctrl+M did not unmute");

    console.log("- walk away: back to boot after 10 s idle");
    const t0 = Date.now();
    await page.waitForFunction(() => window.Oracle.app.state.scene === "boot", null, { timeout: 20000 });
    const waited = (Date.now() - t0) / 1000;
    if (waited < 5) errors.push(`reset too early, after ${waited.toFixed(1)} s`);

    const sounds = await page.evaluate(() => window.__sounds);
    if (sounds.key < 2) errors.push(`expected key clicks, got ${sounds.key}`);
    console.log(`  sounds: ${JSON.stringify(sounds)}, reset after ${waited.toFixed(1)} s idle`);
  } catch (err) {
    errors.push(`step failed: ${err.message}`);
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error(`\nFAIL (${errors.length}):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log("\nPASS: kiosk mode and sound");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
