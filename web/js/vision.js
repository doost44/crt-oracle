/* Loads the face tracker: MediaPipe Face Landmarker, 478 points and expression scores.
 *
 * It runs entirely in the browser. The files come from web/vendor/mediapipe/
 * (python tools/fetch_vision.py puts them there) or, if that folder is missing,
 * from a CDN. Loaded only once a camera is open, so a visit without a camera
 * never downloads it.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const VISION_VERSION = "0.10.21"; // keep in step with VERSION in tools/fetch_vision.py
  const LOCAL = "vendor/mediapipe/";
  const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/`;
  const CDN_MODEL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  const url = (p) => new URL(p, document.baseURI).href;

  async function hasLocal() {
    if (location.protocol === "file:") return false; // modules and wasm can't load from file://
    try {
      const res = await fetch(url(LOCAL + "VERSION"), { cache: "no-store" });
      return res.ok && (await res.text()).trim() === VISION_VERSION;
    } catch (e) {
      return false;
    }
  }

  let loading = null;

  /* Resolves to a FaceLandmarker in VIDEO mode. */
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const local = await hasLocal();
      const base = local ? url(LOCAL) : CDN;
      const vision = await import(base + "vision_bundle.mjs");
      const fileset = await vision.FilesetResolver.forVisionTasks(base + "wasm");
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: local ? url(LOCAL + "face_landmarker.task") : CDN_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      let landmarker;
      try {
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options("GPU"));
      } catch (e) {
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options("CPU"));
      }
      return { landmarker, source: local ? "local" : "cdn" };
    })();
    loading.catch(() => (loading = null));
    return loading;
  }

  Oracle.vision = { load, VISION_VERSION };
})();
