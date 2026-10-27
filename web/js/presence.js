/* The Oracle's eyes: an always-on camera and face tracker, shared between screens.
 *
 *   Oracle.presence.start({ role: "main" })      // on the Oracle's screen
 *   Oracle.presence.subscribe((face) => ...)     // face: see face-reading.js, or null
 *   Oracle.presence.current                      // the latest face, or null
 *   Oracle.presence.onResult((result, now) => ...) // each raw FaceLandmarker result
 *
 * The main screen runs the tracker and shares each result with the readout
 * screen over a BroadcastChannel (both pages must be open in the same browser).
 * The readout shows its own copy of the camera picture and draws on top of the
 * shared results. If the main screen isn't open, the readout tracks by itself.
 *
 * Only measurements cross between pages, never pictures. Nothing is stored.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  const reading = () => Oracle.faceReading;

  const CHANNEL = "crt-oracle";
  const TRACK_FPS = 20;
  const LOST_AFTER = 400; // ms without a detection before the face counts as gone
  const REMOTE_FRESH = 1500; // ms: the main screen's results are this recent, so don't track here

  const bus = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  const busListeners = new Set();
  if (bus) bus.onmessage = (e) => busListeners.forEach((fn) => fn(e.data));

  const presence = {
    status: "off", // off | starting | live | error
    error: "",
    role: "main",
    cameraLabel: "",
    cameras: [],
    video: null, // the playing camera picture (not in the page)
    current: null,
    since: 0, // when the current face appeared (performance.now ms)
    tracking: "none", // none | local | remote: who produced `current`
    lastRemote: 0,

    post(msg) {
      if (bus) bus.postMessage(Object.assign({ from: presence.role }, msg));
    },
    listen(fn) {
      busListeners.add(fn);
      return () => busListeners.delete(fn);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    /* The raw tracker results, for the physical actions (senses.js), so they
     * share this camera instead of opening a second one. */
    onResult(fn) {
      resultListeners.add(fn);
      return () => resultListeners.delete(fn);
    },
    start,
    switchCamera,
  };

  const subscribers = new Set();
  const resultListeners = new Set();
  let landmarker = null;
  let stream = null;
  let lastSeen = 0;
  let lastTick = 0;
  let lastVideoTime = -1;

  function setFace(face, now) {
    if (face) {
      if (!presence.current) presence.since = now;
      lastSeen = now;
      presence.current = face;
    } else if (presence.current && now - lastSeen > LOST_AFTER) {
      presence.current = null;
    } else if (presence.current) {
      return; // a dropped frame or two: keep the last face for a moment
    }
    subscribers.forEach((fn) => {
      try {
        fn(presence.current);
      } catch (err) {
        console.warn(err);
      }
    });
  }

  function onBus(msg) {
    if (!msg) return;
    if (msg.type === "face" && msg.from === "main" && presence.role !== "main") {
      presence.lastRemote = performance.now();
      presence.tracking = "remote";
      setFace(msg.face, performance.now());
    } else if (msg.type === "camera" && msg.label && msg.label !== presence.cameraLabel) {
      switchCamera(msg.label, { echo: false });
    }
  }

  async function openCamera(wanted) {
    const cam = await Oracle.camera.open(wanted != null ? { wanted } : {});
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = cam.stream;
    presence.cameraLabel = cam.label;
    presence.cameras = cam.cameras;
    const video = presence.video || document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    presence.video = video;
    lastVideoTime = -1;
  }

  /* Opens the camera and starts tracking. Never throws: problems end up in
   * presence.status / presence.error, and the Oracle carries on without eyes. */
  async function start(opts) {
    opts = opts || {};
    presence.role = opts.role || "main";
    const pref = Oracle.camera.preference(location.search);
    if (pref.off) {
      presence.status = "off";
      return presence;
    }
    presence.status = "starting";
    presence.listen(onBus);
    try {
      await openCamera();
      presence.status = "live";
      presence.post({ type: "camera-live", label: presence.cameraLabel });
    } catch (err) {
      presence.status = "error";
      presence.error = String((err && err.message) || err);
      console.warn("Oracle camera:", presence.error);
      return presence;
    }
    try {
      landmarker = (await Oracle.vision.load()).landmarker;
    } catch (err) {
      presence.error = "face tracker did not load: " + ((err && err.message) || err);
      console.warn("Oracle:", presence.error);
    }
    requestAnimationFrame(tick);
    return presence;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastTick < 1000 / TRACK_FPS) return;
    lastTick = now;
    const video = presence.video;
    // The readout leaves the tracking to the main screen while it hears from it.
    if (presence.role !== "main" && now - presence.lastRemote < REMOTE_FRESH) return;
    if (!landmarker || !video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    let face = null;
    try {
      const result = landmarker.detectForVideo(video, now);
      resultListeners.forEach((fn) => fn(result, now));
      const lm = result.faceLandmarks && result.faceLandmarks[0];
      const shapes = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
      face = reading().describe(lm, shapes, video.videoWidth / (video.videoHeight || 1), now);
    } catch (err) {
      console.warn("Oracle tracker:", err);
      return;
    }
    presence.tracking = "local";
    setFace(face, now);
    if (presence.role === "main") presence.post({ type: "face", face: presence.current });
  }

  /* Change camera (C on the readout). Remembered in this browser, and the other screen follows. */
  async function switchCamera(label, opts) {
    opts = opts || {};
    Oracle.camera.store(label);
    try {
      await openCamera(label);
      presence.status = "live";
      if (opts.echo !== false) presence.post({ type: "camera", label: presence.cameraLabel });
    } catch (err) {
      presence.error = String((err && err.message) || err);
      console.warn("Oracle camera:", presence.error);
    }
  }

  Oracle.presence = presence;
})();
