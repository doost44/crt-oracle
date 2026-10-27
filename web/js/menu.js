/* The start screen's menu on the console looks (talk-console.html, talk-text.html):
 * like a VCR's on-screen menu, one highlighted line, moved with the arrow keys or
 * the pointer. Enter (or the right arrow) picks it.
 *
 * The menu is the buttons in .start .menu; the highlighted one has the class "sel".
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  function items() {
    return Array.from(document.querySelectorAll(".start:not([hidden]) .menu button")).filter((b) => b.offsetParent);
  }
  function select(b) {
    for (const o of document.querySelectorAll(".menu button")) o.classList.toggle("sel", o === b);
  }

  document.addEventListener("keydown", (e) => {
    const list = items();
    if (!list.length) return;
    const at = list.findIndex((b) => b.classList.contains("sel"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = list[(Math.max(0, at) + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
      select(next);
      next.focus({ preventScroll: true });
      if (Oracle.signal) Oracle.signal.kick({ strength: 0.25, ms: 160 });
    } else if (e.key === "ArrowRight" && at >= 0) {
      e.preventDefault();
      list[at].click();
    }
  });
  document.addEventListener("pointerover", (e) => {
    const b = e.target.closest && e.target.closest(".menu button");
    if (b) select(b);
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.closest && e.target.closest(".menu button")) select(e.target);
  });
  function first() {
    const b = items()[0];
    if (b) select(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", first);
  else first();
})();
