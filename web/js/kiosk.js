/* Exhibit mode, on with ?kiosk=1 (the launcher in kiosk/ adds it).
 *
 * - hides the mouse cursor and turns off right-click and text selection
 * - a visitor who walks away mid-visit: after ?idle= seconds (default 90) with no
 *   key press or touch, the Oracle goes back to the boot screen for the next one
 *
 * Needs main.js loaded first (Oracle.app).
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  const params = new URLSearchParams(location.search);
  const on = params.get("kiosk") === "1";
  const idleSeconds = Math.max(10, parseFloat(params.get("idle")) || 90);

  let lastInput = performance.now();
  const touch = () => (lastInput = performance.now());

  function check() {
    const app = Oracle.app;
    if (!app || app.state.scene === "boot") return touch();
    if (performance.now() - lastInput >= idleSeconds * 1000) {
      touch();
      app.reset();
    }
  }

  if (on) {
    document.documentElement.classList.add("kiosk");
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    ["keydown", "pointerdown", "wheel"].forEach((t) => document.addEventListener(t, touch, true));
    setInterval(check, 1000);
  }

  Oracle.kiosk = { on, idleSeconds };
})();
