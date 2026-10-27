/* The flow of one visit: boot screen, hallway, the Oracle's face, the conversation, the receipt.
 *
 * Scenes draw on the character grid every frame. The conversation happens in
 * the terminal (a DOM panel at the bottom), on top of the face scene.
 */
(function () {
  "use strict";
  const Oracle = window.Oracle;
  const FPS = 30;
  const REVEAL_SECONDS = 2.5;

  const grid = new Oracle.Grid(document.getElementById("screen"));
  const terminalEl = document.getElementById("terminal");
  const receiptEl = document.getElementById("receipt");

  const state = {
    scene: "boot", // boot | hallway | face
    sceneStart: performance.now(),
    personality: null,
    talking: false,
    faceStart: 0,
  };

  const sound = Oracle.sound;

  function go(scene) {
    state.scene = scene;
    state.sceneStart = performance.now();
    if (sound) sound.scene(scene, { duration: Oracle.scenes.hallway.duration });
  }

  function seconds(since) {
    return (performance.now() - since) / 1000;
  }

  // --- drawing ---------------------------------------------------------------

  function faceRegion() {
    // The face floats in the top part of the screen; the terminal owns the bottom 40%.
    return { x: 0, y: 0, w: grid.cols, h: Math.floor(grid.rows * 0.64) };
  }

  function draw() {
    grid.clear();
    const t = seconds(state.sceneStart);
    if (state.scene === "boot") {
      Oracle.scenes.boot.frame(grid, t);
    } else if (state.scene === "hallway") {
      const hallway = Oracle.scenes.hallway;
      hallway.frame(grid, Math.min(t, hallway.duration));
      if (t >= hallway.duration) startFace();
    } else if (state.scene === "face") {
      Oracle.scenes.face.frame(grid, t, {
        region: faceRegion(),
        reveal: Math.min(1, t / REVEAL_SECONDS),
        personality: state.personality,
        mood: state.talking ? "talking" : "idle",
      });
    }
    grid.render();
  }

  let lastFrame = 0;
  function loop(now) {
    if (now - lastFrame >= 1000 / FPS) {
      lastFrame = now;
      try {
        draw();
      } catch (err) {
        console.error(err);
      }
    }
    requestAnimationFrame(loop);
  }

  // --- the visit ---------------------------------------------------------------

  let terminal = null;

  function startHallway() {
    terminalEl.innerHTML = "";
    go("hallway");
  }

  async function startFace() {
    if (state.scene === "face") return;
    go("face");
    terminal = new Oracle.Terminal(terminalEl, {
      onTyping: (on) => (state.talking = on),
      onChar: () => sound && sound.tick(),
    });
    const seed = Math.floor(Math.random() * 2 ** 31);
    const result = await Oracle.runStory(window.ORACLE_CONTENT, terminal, {
      random: Oracle.rng(seed),
      onPersonality: (id) => (state.personality = id),
    });
    if (sound) sound.print(1.5, 16); // in step with the receipt's feed animation
    Oracle.showReceipt(receiptEl, result.receipt, {
      personality: state.personality,
      onAgain: reset,
    });
  }

  function reset() {
    if (receiptEl._oracleReceiptCleanup) receiptEl._oracleReceiptCleanup();
    receiptEl.hidden = true;
    receiptEl.innerHTML = "";
    terminalEl.innerHTML = "";
    state.personality = null;
    state.talking = false;
    if (terminal) terminal.destroy();
    terminal = null;
    go("boot");
  }

  // Enter (or a tap, on a touch screen) starts the visit and skips the hallway.
  function advance() {
    if (state.scene === "boot") startHallway();
    else if (state.scene === "hallway") startFace();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (state.scene === "boot" || state.scene === "hallway")) {
      e.preventDefault();
      advance();
    }
  });
  document.getElementById("screen").addEventListener("click", advance);

  // Exposed for tests and for poking at it from the browser console.
  Oracle.app = { state, go, reset, grid };
  if (sound) sound.scene("boot");
  requestAnimationFrame(loop);
})();
