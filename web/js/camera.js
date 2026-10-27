/* The webcam, picked by name.
 *
 * Windows laptops with an NVIDIA card often have "NVIDIA Broadcast" as the
 * default camera: a virtual camera that blurs or replaces the background, which
 * broke face detection on the exhibit laptop. So the Oracle never takes the
 * default. It asks once for permission (that is the only way a browser reveals
 * camera names), lists the cameras, skips the virtual ones and opens the real one
 * by its device id.
 *
 * Which camera, in order:
 *   1. ?camera=<part of the name> in the address (for example ?camera=USB%20Video)
 *   2. the one last picked with C on the readout screen (saved in this browser)
 *   3. the first camera that is not a virtual one
 * ?camera=off turns the camera off.
 *
 * Frames never leave the browser: nothing here records, stores or sends them.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  // Virtual cameras: effects filters, streaming tools, phone bridges.
  const VIRTUAL = /nvidia broadcast|virtual|\bobs\b|snap camera|xsplit|manycam|droidcam|\bcamo\b|mmhmm|splitcam|e2esoft|chromacam|youcam|vcam|epoccam|iriun/i;
  const STORE_KEY = "oracle.camera";

  function isVirtual(label) {
    return VIRTUAL.test(label || "");
  }

  function readStored() {
    try {
      return window.localStorage.getItem(STORE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function store(label) {
    try {
      window.localStorage.setItem(STORE_KEY, label);
    } catch (e) {
      // private window or storage blocked: the pick lasts until reload
    }
  }

  /* What the address and the saved pick ask for: { off, wanted }. */
  function preference(search) {
    const asked = new URLSearchParams(search || "").get("camera");
    if (asked && asked.toLowerCase() === "off") return { off: true, wanted: "" };
    return { off: false, wanted: asked || readStored() };
  }

  /* Pick a camera from enumerateDevices() output. Pure, so it can be tested. */
  function pick(devices, wanted) {
    const cams = devices.filter((d) => d.kind === "videoinput");
    if (wanted) {
      const w = wanted.toLowerCase();
      const named = cams.find((d) => (d.label || "").toLowerCase().includes(w));
      if (named) return named;
    }
    return cams.find((d) => !isVirtual(d.label)) || null;
  }

  async function listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  const CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };

  /* Open the right camera. Resolves to { stream, label, cameras } or rejects. */
  async function open(opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera support in this browser");
    const wanted = opts.wanted != null ? opts.wanted : preference(location.search).wanted;

    // Without permission the names are blank, so ask once with any camera, then let go of it.
    let cameras = await listCameras();
    if (!cameras.length) throw new Error("no camera found");
    if (cameras.every((d) => !d.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      cameras = await listCameras();
    }

    const chosen = pick(cameras, wanted);
    if (!chosen) throw new Error("only virtual cameras found: " + cameras.map((c) => c.label).join(", "));
    const stream = await navigator.mediaDevices.getUserMedia({
      video: Object.assign({ deviceId: { exact: chosen.deviceId } }, CONSTRAINTS),
    });
    return { stream, label: chosen.label || "camera", cameras };
  }

  /* The camera after `label` in the list (for C on the readout screen). */
  function next(cameras, label) {
    if (!cameras.length) return null;
    const i = cameras.findIndex((c) => c.label === label);
    return cameras[(i + 1) % cameras.length];
  }

  Oracle.camera = { open, pick, next, isVirtual, preference, store, listCameras };
})();
