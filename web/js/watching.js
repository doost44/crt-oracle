/* On the Oracle's own screen: switch the eyes on, show that they are on, and
 * tell the readout screen what the Oracle is doing.
 *
 * A camcorder-style "REC" in the corner lights up while a face is in view.
 * F9 opens the readout screen in a new window (on the second monitor when the
 * browser lets it know about one).
 */
(function () {
  "use strict";
  const Oracle = window.Oracle;
  const presence = Oracle.presence;
  const el = document.getElementById("watching");

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function clock(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  function show() {
    if (!el) return;
    const live = presence.status === "live";
    const face = presence.current;
    el.hidden = !live;
    el.classList.toggle("watching-on", !!face);
    el.textContent = face ? `● REC ${clock(performance.now() - presence.since)}` : "○ STBY";
  }

  // What the readout needs from this screen: the scene and who is talking.
  let lastState = "";
  function publishState() {
    const app = Oracle.app;
    if (!app) return;
    const s = { type: "oracle", scene: app.state.scene, personality: app.state.personality, talking: !!app.state.talking };
    const key = JSON.stringify(s);
    if (key !== lastState) {
      lastState = key;
      presence.post(s);
    }
  }
  // A readout that opens later asks for the state.
  presence.listen((msg) => {
    if (msg && msg.type === "hello") {
      lastState = "";
      publishState();
    }
  });

  async function openReadout() {
    let features = "popup,width=1024,height=768";
    try {
      if ("getScreenDetails" in window) {
        const details = await window.getScreenDetails();
        const other = details.screens.find((s) => s !== details.currentScreen);
        if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
      }
    } catch (e) {
      // no permission to see the screens: open it here and drag it across
    }
    window.open((window.ORACLE_READOUT || "readout.html") + location.search, "oracle-readout", features);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "F9") {
      e.preventDefault();
      openReadout();
    }
  });

  setInterval(() => {
    show();
    publishState();
  }, 250);
  presence.start({ role: "main" });
})();
