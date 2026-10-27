/* The flow of one visit: boot screen, hallway, the Oracle's face, the conversation, the receipt.
 *
 * Scenes draw on the character grid every frame. The conversation happens in
 * the terminal (a DOM panel at the bottom), on top of the face scene. The
 * painted sun face greets the visitor; once a personality takes over, its own
 * face (personas.js) takes the centre and the whole screen re-tints (theme.js).
 */
(function () {
  "use strict";
  const Oracle = window.Oracle;
  const FPS = 30;
  const REVEAL_SECONDS = 2.5;
  const PERSONA_REVEAL_SECONDS = 1.6;
  const SWITCH_GLITCH_SECONDS = 0.7;
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  const grid = new Oracle.Grid(document.getElementById("screen"));
  const terminalEl = document.getElementById("terminal");
  const receiptEl = document.getElementById("receipt");
  const recEl = document.getElementById("vhs-rec");
  const dateEl = document.getElementById("vhs-date");

  const state = {
    scene: "boot", // boot | hallway | face
    sceneStart: performance.now(),
    personality: null,
    talking: false,
    faceStart: 0,
    personaStart: 0, // when the current personality took over
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

  /* Hand the centre of the screen (and its colour) to a personality, or back. */
  function setPersonality(id) {
    if (id && !(Oracle.PERSONAS && Oracle.PERSONAS[id])) return;
    if (id === state.personality) return;
    state.personality = id || null;
    state.personaStart = performance.now();
    Oracle.theme.set(state.personality);
  }

  // --- the camcorder readout -----------------------------------------------------

  let lastStamp = "";
  function updateOsd() {
    const on = state.scene !== "boot";
    recEl.hidden = !on;
    dateEl.hidden = !on;
    if (!on) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const stamp = `${MONTHS[d.getMonth()]} ${p(d.getDate())} ${d.getFullYear()}\n${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    if (stamp !== lastStamp) dateEl.textContent = lastStamp = stamp;
  }

  // --- drawing ---------------------------------------------------------------

  /* Where the figure should look, x right and y up in -1..1: at the participant's
   * face when the camera sees one, else at the mouse while it moves (handy when
   * trying it on a laptop), else null and it looks around the room by itself. */
  let mouse = null;
  window.addEventListener("mousemove", (e) => {
    mouse = {
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: 1 - (e.clientY / window.innerHeight) * 2,
      at: performance.now(),
    };
  });
  function figureLook() {
    const face = Oracle.presence && Oracle.presence.current;
    if (face && face.center) {
      // The camera picture isn't mirrored: someone stepping to their right moves
      // to the picture's left, and the figure turns to the screen's right to follow.
      return { x: (1 - face.center.x * 2) * 1.4, y: (1 - face.center.y * 2) * 1.4 };
    }
    if (mouse && performance.now() - mouse.at < 4000) return mouse;
    return null;
  }

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
      const mood = state.talking ? "talking" : "idle";
      const persona = state.personality && Oracle.scenes.persona;
      if (persona) {
        const pt = seconds(state.personaStart);
        // The 3D figure (figures.js) when the browser has WebGL, else the flat face.
        const figure = Oracle.scenes.figure && Oracle.scenes.figure.available ? Oracle.scenes.figure : null;
        (figure || persona).frame(grid, t, {
          // The figure gets a little more height, reaching just into the top of the
          // terminal's space (the text sits at the bottom), so it's as big as in the demo.
          region: figure ? { x: 0, y: 0, w: grid.cols, h: Math.floor(grid.rows * 0.72) } : faceRegion(),
          reveal: Math.min(1, pt / PERSONA_REVEAL_SECONDS),
          personality: state.personality,
          mood,
          look: figureLook(),
        });
        // the old face tears away as the new one comes in
        if (pt < SWITCH_GLITCH_SECONDS) Oracle.glitch(grid, 0.5 * (1 - pt / SWITCH_GLITCH_SECONDS), Oracle.rng(Math.floor(pt * 30) + 7));
      } else {
        Oracle.scenes.face.frame(grid, t, {
          region: faceRegion(),
          reveal: Math.min(1, t / REVEAL_SECONDS),
          personality: null,
          mood,
        });
      }
      // The tape is never quite clean: a little static at the edges, a little wobble.
      const random = Oracle.rng(Math.floor(t * 30) * 2654435761 + 1);
      Oracle.edgeNoise(grid, 0.09, t, random);
      Oracle.vhs(grid, t, Oracle.theme.switching ? 1.2 : 0.18, random);
    }
    grid.render();
  }

  let lastFrame = 0;
  function loop(now) {
    if (now - lastFrame >= 1000 / FPS) {
      lastFrame = now;
      try {
        Oracle.theme.update(now);
        updateOsd();
        draw();
      } catch (err) {
        console.error(err);
      }
    }
    requestAnimationFrame(loop);
  }

  // --- the visit ---------------------------------------------------------------

  let terminal = null;
  // Voice answers and physical actions, when switched on in the address bar (see senses.js).
  const senses = Oracle.senses ? Oracle.senses.fromURL(location.search) : null;

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
    if (senses) senses.wrap(terminal, () => state.personality);
    const onPersonality = (id) => {
      setPersonality(id);
      // For the per-personality colour shift: CSS can key off body[data-personality].
      document.body.dataset.personality = id || "";
    };
    let result;
    if (window.ORACLE_LIVE) {
      // Served by python -m oracle.server: the open conversation (Claude or the mock).
      result = await Oracle.runLive(window.ORACLE_CONTENT, terminal, { live: window.ORACLE_LIVE, onPersonality });
    } else {
      const seed = Math.floor(Math.random() * 2 ** 31);
      result = await Oracle.runStory(window.ORACLE_CONTENT, terminal, {
        random: Oracle.rng(seed),
        onPersonality,
        beforeNode: senses ? (session, term) => senses.beforeNode(session, term, state.personality) : null,
      });
    }
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
    setPersonality(null);
    state.talking = false;
    delete document.body.dataset.personality;
    if (terminal) terminal.destroy();
    if (senses) senses.stop();
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

  // Operator preview: Alt+1, Alt+2, Alt+3 hand the screen to Sugar, Weary or
  // Clinical (Alt+0 gives it back to the sun face), to check the look of each.
  const PREVIEW = { Digit0: null, Digit1: "sugar", Digit2: "weary", Digit3: "clinical" };
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !(e.code in PREVIEW)) return;
    e.preventDefault();
    if (state.scene !== "face") startFace();
    setPersonality(PREVIEW[e.code]);
  });

  // Exposed for tests and for poking at it from the browser console.
  Oracle.app = { state, go, reset, grid, setPersonality, senses };
  if (sound) sound.scene("boot");
  requestAnimationFrame(loop);
})();
