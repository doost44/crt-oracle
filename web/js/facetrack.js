/* A small face tracker for the physical actions: opens the webcam, runs
 * MediaPipe's FaceLandmarker on each frame and hands the results on.
 *
 *   const tracker = new Oracle.FaceTrack({ video, onFrame });
 *   await tracker.start();   // asks for the camera; throws if refused or no model
 *   tracker.latest           // { result, features, at } for the newest frame
 *   tracker.stop();          // camera light off
 *
 * The always-on webcam pipeline can replace this: anything that calls
 * Oracle.Actions.measure() on a FaceLandmarker result can drive the checks.
 *
 * Frames only ever live in the <video> element and in MediaPipe's memory for the
 * one detection. Nothing is drawn to a canvas, recorded, saved or sent anywhere.
 * The camera needs a page served from localhost or https (not a double-clicked file).
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // Pinned so a new release can't change behaviour under the exhibit.
  const MP_VERSION = "0.10.35";
  const SOURCES = [
    // Local copy first (python tools/fetch_vendor.py), so the install works offline.
    { bundle: "vendor/mediapipe/vision_bundle.mjs", wasm: "vendor/mediapipe/wasm", model: "vendor/mediapipe/face_landmarker.task" },
    {
      bundle: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`,
      wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
      model: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
  ];

  // Virtual cameras that sit between the webcam and the browser; prefer the real one.
  const AVOID = /nvidia broadcast|obs virtual|virtual|snap camera|xsplit|mmhmm|camo/i;

  async function pickCamera(preferred) {
    // Labels are empty until the page has camera permission, so ask once first.
    let probe = null;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some((d) => d.kind === "videoinput" && d.label)) {
        probe = await navigator.mediaDevices.getUserMedia({ video: true });
        devices = await navigator.mediaDevices.enumerateDevices();
      }
      const cams = devices.filter((d) => d.kind === "videoinput");
      const want = preferred ? cams.find((d) => d.label.toLowerCase().includes(preferred.toLowerCase())) : null;
      const real = cams.find((d) => !AVOID.test(d.label));
      const cam = want || real || cams[0];
      return cam ? { id: cam.deviceId, label: cam.label } : null;
    } finally {
      if (probe) probe.getTracks().forEach((t) => t.stop());
    }
  }

  let landmarkerPromise = null;

  async function loadLandmarker() {
    if (landmarkerPromise) return landmarkerPromise;
    landmarkerPromise = (async () => {
      let lastErr = null;
      for (const src of SOURCES) {
        try {
          const base = new URL(src.bundle, document.baseURI).href;
          const vision = await import(base);
          const fileset = await vision.FilesetResolver.forVisionTasks(new URL(src.wasm, document.baseURI).href);
          const opts = {
            baseOptions: { modelAssetPath: new URL(src.model, document.baseURI).href, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          };
          try {
            return await vision.FaceLandmarker.createFromOptions(fileset, opts);
          } catch (err) {
            opts.baseOptions.delegate = "CPU"; // no WebGL2 GPU
            return await vision.FaceLandmarker.createFromOptions(fileset, opts);
          }
        } catch (err) {
          lastErr = err;
        }
      }
      landmarkerPromise = null;
      throw new Error("could not load the face model: " + (lastErr && lastErr.message));
    })();
    return landmarkerPromise;
  }

  class FaceTrack {
    constructor(opts) {
      opts = opts || {};
      this.video = opts.video || document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.onFrame = opts.onFrame || null;
      this.camera = opts.camera || null; // part of the camera's name, to pick a specific one
      this.fps = opts.fps || 20; // detection rate; the video itself plays at full speed
      this.latest = { result: null, features: null, at: 0 };
      this.cameraLabel = null;
      this.running = false;
      this._stream = null;
      this._raf = null;
      this._lastVideoTime = -1;
      this._lastRun = 0;
    }

    async start() {
      if (this.running) return;
      const landmarker = await loadLandmarker();
      const cam = await pickCamera(this.camera);
      if (!cam) throw new Error("no camera found");
      this.cameraLabel = cam.label;
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: cam.id }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.video.srcObject = this._stream;
      await this.video.play();
      this.landmarker = landmarker;
      this.running = true;
      const tick = (now) => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(tick);
        if (now - this._lastRun < 1000 / this.fps) return;
        const v = this.video;
        if (v.readyState < 2 || v.currentTime === this._lastVideoTime) return;
        this._lastRun = now;
        this._lastVideoTime = v.currentTime;
        let result;
        try {
          result = this.landmarker.detectForVideo(v, now);
        } catch (err) {
          console.warn("face tracking frame failed", err);
          return;
        }
        this.feed(result, now);
      };
      this._raf = requestAnimationFrame(tick);
    }

    /* Hand in a result from elsewhere (the webcam pipeline, a test) as if tracked here. */
    feed(result, now) {
      now = now != null ? now : performance.now();
      const features = Oracle.Actions.measure(result);
      this.latest = { result, features, at: now };
      if (this.onFrame) this.onFrame(this.latest);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this._raf);
      if (this._stream) this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
      this.video.srcObject = null;
      this.latest = { result: null, features: null, at: 0 };
    }
  }

  /* Wait for one action. Calls onUpdate(state) each frame; resolves with the final
   * state ({ status: "done" | "timeout" | "cancelled", ... }). */
  function watchAction(source, actionId, opts) {
    opts = opts || {};
    const check = new Oracle.Actions.Check(actionId, opts);
    return new Promise((resolve) => {
      let stopped = false;
      const step = () => {
        if (stopped) return;
        if (opts.signal && opts.signal.aborted) {
          stopped = true;
          return resolve({ status: "cancelled", progress: 0 });
        }
        const now = performance.now();
        const fresh = source.latest && now - source.latest.at < 500 ? source.latest.features : null;
        const state = check.update(fresh, now);
        if (opts.onUpdate) opts.onUpdate(state, fresh);
        if (state.status === "done" || state.status === "timeout") {
          stopped = true;
          resolve(state);
        } else {
          setTimeout(step, 50);
        }
      };
      step();
    });
  }

  Oracle.FaceTrack = FaceTrack;
  Oracle.FaceTrack.pickCamera = pickCamera;
  Oracle.FaceTrack.load = loadLandmarker;
  Oracle.FaceTrack.MP_VERSION = MP_VERSION;
  Oracle.watchAction = watchAction;
})();
