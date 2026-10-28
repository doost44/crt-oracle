/* The full screen button on the spoken Oracle's pages (talk*.html): every button with
 * data-fullscreen puts the whole page in full screen, or takes it out again. The F
 * key does the same, except while typing an answer; Escape always leaves.
 *
 * Where the browser won't allow it (inside a frame that doesn't permit it), the button
 * says which key gives the browser's own full screen instead. Where there is no full
 * screen at all (an iPhone), the buttons are hidden.
 */
(function () {
  "use strict";
  const root = document.documentElement;
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  const ON = "Full screen";
  const OFF = "Exit full screen";
  const KEY = /Mac|iP(ad|hone)/.test(navigator.platform) ? "Ctrl+Cmd+F" : "F11";
  let hintUntil = 0;

  const buttons = () => document.querySelectorAll("[data-fullscreen]");
  const current = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function label() {
    if (performance.now() < hintUntil) return;
    const on = !!current();
    for (const b of buttons()) {
      b.textContent = on ? OFF : ON;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  // Not allowed here: say so on the button for a few seconds, then put the label back.
  function hint() {
    hintUntil = performance.now() + 4000;
    for (const b of buttons()) b.textContent = `Blocked here: press ${KEY}`;
    setTimeout(() => {
      hintUntil = 0;
      label();
    }, 4000);
  }

  function toggle() {
    if (current()) {
      const leave = document.exitFullscreen || document.webkitExitFullscreen;
      const done = leave && leave.call(document);
      if (done && done.catch) done.catch(() => {});
      return;
    }
    if (document.fullscreenEnabled === false && !document.webkitFullscreenEnabled) return hint();
    try {
      const done = enter.call(root);
      if (done && done.catch) done.catch(hint);
    } catch (e) {
      hint();
    }
  }

  function setup() {
    for (const b of buttons()) {
      if (!enter) {
        b.hidden = true;
        continue;
      }
      b.addEventListener("click", toggle);
    }
    label();
  }

  if (enter) {
    document.addEventListener("fullscreenchange", label);
    document.addEventListener("webkitfullscreenchange", label);
    document.addEventListener("keydown", (e) => {
      if ((e.key !== "f" && e.key !== "F") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      toggle();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
