/* The three personalities as 3D figures drawn in ASCII.
 *
 *   SUGAR     the sun   warm amber   a sphere with a smile that is a little too wide
 *   WEARY     the rock  CRT green    a chipped boulder with heavy lids and a frown
 *   CLINICAL  the tree  blue-white   a faceted crown with ring eyes that follow you
 *
 * Every model is built in code from three.js primitives (no files to load). The
 * faces are strokes drawn on the surface: a path of 2D points is projected onto
 * the model from the front and swept into a tube, so the features hug the shape.
 * Features are pure black, which the ASCII pass leaves blank: the eyes and mouths
 * are cut out of the glyphs, like holes in a mask.
 *
 * Each figure sways on its own and leans toward the participant. The look input
 * is the participant's face position in -1..1 (x right, y up): the game feeds it
 * from the webcam, the demo from the mouse. With nobody there (setLook(null)) the
 * figure looks around the room on its own, so it never sits still and flat.
 *
 * Contract, the same as Oracle.scenes.face so main.js can swap it in:
 *   Oracle.scenes.figure.frame(grid, t, opts)
 *     opts.region       {x, y, w, h} cells it may draw in
 *     opts.personality  "sugar" | "weary" | "clinical" (null keeps the last one)
 *     opts.mood         "talking" | "idle"
 *     opts.look         {x, y} in -1..1, or null to look around on its own
 *     opts.reveal       0..1, builds in from scattered characters
 *
 * Or directly: const figures = new Oracle.Figures(); figures.render(cols, rows, t, opts)
 * returns { cols, rows, chars, colors } for any other surface (the demo uses a <pre>).
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});
  Oracle.scenes = Oracle.scenes || {};
  const A = Oracle.ascii3d;

  const PI = Math.PI;
  const SWITCH_SECONDS = 0.9; // personality change: glitch dissolve
  const LOOK_EASE = 2.5; // how fast the lean follows the participant (1/s)

  /* Glyph colours per personality: dense glyphs get `bright`, middling `mid`,
   * light `dim`. `bg` is a matching screen tint, for whoever owns the background. */
  const PERSONALITIES = {
    sugar: {
      name: "SUGAR",
      figure: "sun",
      colors: { bright: "#ffe6a8", mid: "#ffb347", dim: "#c8691f", bg: "#170b02" },
    },
    weary: {
      name: "WEARY",
      figure: "rock",
      colors: { bright: "#d8ffc8", mid: "#76ee74", dim: "#2c9444", bg: "#03120a" },
    },
    clinical: {
      name: "CLINICAL",
      figure: "tree",
      colors: { bright: "#ffffff", mid: "#cfe2ff", dim: "#7c9bc8", bg: "#060c18" },
    },
  };

  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smoothstep(a, b, v) {
    const x = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  // --- modelling helpers ---------------------------------------------------------

  function makeKit(THREE) {
    const ink = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const raycaster = new THREE.Raycaster();
    const DOWN_Z = new THREE.Vector3(0, 0, -1);

    function body(opts) {
      return new THREE.MeshStandardMaterial(
        Object.assign({ color: 0xffffff, roughness: 0.85, metalness: 0 }, opts)
      );
    }

    /* Where a ray from the front at (x, y) hits target: { point, normal } in world space. */
    function hit(target, x, y) {
      target.updateMatrixWorld(true);
      raycaster.set(new THREE.Vector3(x, y, 50), DOWN_Z);
      const hits = raycaster.intersectObject(target, true);
      if (!hits.length) return null;
      const h = hits[0];
      const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      return { point: h.point.clone(), normal };
    }

    /* A tube along 2D points pressed onto target's front surface, with round caps. */
    function stroke(target, pts2d, radius, material, lift) {
      lift = lift == null ? radius * 0.4 : lift;
      const pts = [];
      for (const [x, y] of pts2d) {
        const h = hit(target, x, y);
        if (h) pts.push(h.point.addScaledVector(h.normal, lift));
      }
      const group = new THREE.Group();
      if (pts.length < 2) return group;
      const curve = new THREE.CatmullRomCurve3(pts);
      const mat = material || ink;
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 4, radius, 8, false), mat));
      for (const end of [pts[0], pts[pts.length - 1]]) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat);
        cap.position.copy(end);
        group.add(cap);
      }
      return group;
    }

    /* Points on an elliptical arc, angles in radians (0 = right, PI/2 = up). */
    function arc(cx, cy, rx, ry, a0, a1, n) {
      const out = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      return out;
    }

    /* Wrap object in a group whose origin is at (x, y, z), so it can be scaled
     * (a mouth opening, a blink) around that point. */
    function pivot(object, x, y, z) {
      const p = new THREE.Group();
      p.position.set(x, y, z || 0);
      object.position.set(-x, -y, -(z || 0));
      p.add(object);
      return p;
    }

    return { THREE, ink, body, hit, stroke, arc, pivot };
  }

  /* Small deterministic value noise for the rock. */
  function noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const s = (v) => v * v * (3 - 2 * v);
    const u = s(xf);
    const v = s(yf);
    const w = s(zf);
    const h = (a, b, c) => hash2(a * 73856093 + c * 19349663, b * 83492791 - c * 2654435761);
    const lerp = (a, b, k) => a + (b - a) * k;
    const x00 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
    const x10 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
    const x01 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
    const x11 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
  }

  // --- SUGAR: the sun --------------------------------------------------------------

  function buildSun(K) {
    const { THREE } = K;
    const g = new THREE.Group();
    const skin = K.body({ roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skin);
    g.add(head);

    // Happy closed eyes, upturned arcs. The smile is a little too wide.
    g.add(K.stroke(head, K.arc(-0.36, 0.2, 0.17, 0.15, 0.05 * PI, 0.95 * PI, 12), 0.09));
    g.add(K.stroke(head, K.arc(0.36, 0.2, 0.17, 0.15, 0.05 * PI, 0.95 * PI, 12), 0.09));
    const smile = K.stroke(head, K.arc(0, -0.02, 0.56, 0.42, 1.1 * PI, 1.9 * PI, 24), 0.095);
    const mouth = K.pivot(smile, 0, -0.42, 0.9);
    g.add(mouth);

    // Round cheeks that push out of the face and catch the light.
    for (const s of [-1, 1]) {
      const h = K.hit(head, s * 0.6, -0.14);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin);
      cheek.scale.set(1, 0.72, 0.45);
      cheek.position.copy(h.point);
      cheek.lookAt(h.point.clone().add(h.normal));
      g.add(cheek);
    }

    // Rays: cones around the rim, alternating long and short.
    const rays = new THREE.Group();
    const rayList = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * PI + PI / N;
      const len = i % 2 ? 0.42 : 0.62;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, len, 16), skin);
      const holder = new THREE.Group();
      holder.rotation.z = a - PI / 2;
      cone.position.y = 1.08 + len / 2;
      holder.add(cone);
      rays.add(holder);
      rayList.push({ cone, len, phase: i * 0.7 });
    }
    rays.position.z = -0.15;
    g.add(rays);

    return {
      group: g,
      update(t, s) {
        rays.rotation.z = t * 0.12;
        for (const r of rayList) {
          const k = 1 + 0.12 * Math.sin(t * 1.6 + r.phase);
          r.cone.scale.set(1, k, 1);
          r.cone.position.y = 1.08 + (r.len * k) / 2;
        }
        const open = s.talk * (0.5 + 0.5 * Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 3.1));
        mouth.scale.set(1 + open * 0.08, 1 + open * 0.9, 1);
      },
    };
  }

  // --- WEARY: the rock -------------------------------------------------------------

  function buildRock(K) {
    const { THREE } = K;
    const g = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(1, 6);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    // A few flat chips knocked off it (normal, distance from centre).
    const chips = [
      [0.2, 0.9, 0.35, 0.78],
      [-0.85, 0.35, 0.3, 1.02],
      [0.9, -0.1, -0.4, 1.0],
      [-0.3, 0.2, -0.9, 0.82],
      [0.55, 0.55, -0.6, 0.86],
      [0, -1, 0, 0.66], // the flat bottom it sits on
    ].map(([x, y, z, d]) => ({ n: new THREE.Vector3(x, y, z).normalize(), d }));
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r =
        1 +
        0.16 * noise3(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4) +
        0.05 * noise3(v.x * 4 + 9, v.y * 4, v.z * 4);
      v.multiplyScalar(r);
      v.set(v.x * 1.32, v.y * 0.9, v.z * 1.0);
      for (const c of chips) {
        const over = v.dot(c.n) - c.d;
        if (over > 0) v.addScaledVector(c.n, -over);
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const stone = K.body({ flatShading: true, roughness: 1 });
    const rock = new THREE.Mesh(geo, stone);
    g.add(rock);

    // Half-closed eyes: a heavy lid line, the bottom of the eye under it, a pupil.
    const eyes = [];
    for (const s of [-1, 1]) {
      const cx = s * 0.42;
      const cy = 0.12;
      const eye = new THREE.Group();
      eye.add(K.stroke(rock, [[cx - 0.2, cy + 0.01], [cx, cy + 0.02], [cx + 0.2, cy + 0.01]], 0.085));
      eye.add(K.stroke(rock, K.arc(cx, cy, 0.19, 0.12, 1.05 * PI, 1.95 * PI, 10), 0.06));
      const h = K.hit(rock, cx, cy - 0.06);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), K.ink);
      pupil.position.copy(h.point).addScaledVector(h.normal, 0.02);
      eye.add(pupil);
      const p = K.pivot(eye, cx, cy, h.point.z);
      g.add(p);
      eyes.push(p);
      // A brow ridge in stone, sagging toward the outside.
      g.add(K.stroke(rock, [[s * 0.72, 0.3], [s * 0.45, 0.37], [s * 0.18, 0.36]], 0.08, stone, 0.03));
    }

    // A shallow frown.
    const frown = K.stroke(rock, K.arc(0, -0.42, 0.28, 0.1, 0.15 * PI, 0.85 * PI, 12), 0.08);
    const mouth = K.pivot(frown, 0, -0.36, 0.9);
    g.add(mouth);

    return {
      group: g,
      update(t, s) {
        // Breathes slowly; every few seconds the lids sink and come back up.
        g.scale.set(1, 1 + 0.018 * Math.sin(t * 0.7), 1);
        const cycle = t % 6.5;
        const blink = cycle > 5.4 ? Math.sin(((cycle - 5.4) / 1.1) * PI) : 0;
        for (const e of eyes) e.scale.set(1, 1 - 0.75 * blink, 1);
        const open = s.talk * (0.5 + 0.5 * Math.sin(t * 9));
        mouth.scale.set(1, 1 + open * 1.4, 1);
      },
    };
  }

  // --- CLINICAL: the tree ------------------------------------------------------------

  function buildTree(K) {
    const { THREE } = K;
    const g = new THREE.Group();
    const facet = K.body({ flatShading: true, roughness: 0.5 });

    const crownY = 0.42;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), facet);
    crown.scale.set(1.05, 0.98, 0.85);
    crown.position.y = crownY;
    g.add(crown);

    // Smaller crystals around the back of the crown, on an orbit that ticks.
    const orbit = new THREE.Group();
    orbit.position.y = crownY;
    const SATS = [
      [-1.0, 0.45, -0.35, 0.36],
      [0.98, 0.5, -0.3, 0.4],
      [-0.55, 0.95, -0.45, 0.32],
      [0.5, 0.98, -0.5, 0.3],
      [-1.05, -0.25, -0.4, 0.28],
      [1.05, -0.2, -0.45, 0.3],
    ];
    for (const [x, y, z, r] of SATS) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), facet);
      m.position.set(x, y, z);
      m.rotation.set(x * 3, y * 5, z * 7);
      orbit.add(m);
    }
    g.add(orbit);

    // Trunk with two branch stubs and three roots.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, 1.25, 7), facet);
    trunk.position.y = -0.95;
    g.add(trunk);
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.55, 6), facet);
      b.position.set(s * 0.25, -0.62, 0.05);
      b.rotation.z = -s * 0.9;
      g.add(b);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 2 * PI + 0.4;
      const root = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 6), facet);
      root.position.set(Math.cos(a) * 0.3, -1.52, Math.sin(a) * 0.3);
      root.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
      g.add(root);
    }

    // The face, on the crown: two exact rings, pupils that follow you, a level line.
    const pupils = [];
    for (const s of [-1, 1]) {
      const cx = s * 0.34;
      const cy = crownY + 0.14;
      g.add(K.stroke(crown, K.arc(cx, cy, 0.2, 0.2, 0, 2 * PI, 28), 0.055));
      const h = K.hit(crown, cx, cy);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), K.ink);
      const base = h.point.clone().addScaledVector(h.normal, 0.03);
      pupil.position.copy(base);
      g.add(pupil);
      pupils.push({ mesh: pupil, base });
    }
    const line = K.stroke(crown, [[-0.22, crownY - 0.26], [0, crownY - 0.26], [0.22, crownY - 0.26]], 0.065);
    const mouth = K.pivot(line, 0, crownY - 0.26, 0.85);
    g.add(mouth);

    return {
      group: g,
      update(t, s) {
        // The orbit moves in exact steps: still, then a quick eased tick.
        const step = Math.floor(t / 2.4);
        const f = smoothstep(0.8, 1, (t / 2.4) % 1);
        orbit.rotation.y = (step + f) * (PI / 12);
        for (const p of pupils) {
          p.mesh.position.set(p.base.x + s.look.x * 0.08, p.base.y + s.look.y * 0.07, p.base.z);
        }
        const open = s.talk * (Math.sin(t * 11) > 0 ? 1 : 0.3);
        mouth.scale.set(1 + open * 0.25, 1 + open * 0.6, 1);
      },
    };
  }

  const BUILDERS = { sun: buildSun, rock: buildRock, tree: buildTree };

  // --- the stage ------------------------------------------------------------------

  class Figures {
    /* opts.cellAspect   cell width / height (default 0.6, the grid's)
     * opts.supersample  pixels per cell side (default 2)
     * opts.personality  starting personality (default "sugar")
   * opts.colorKeys    { bright, mid, dim } to colour glyphs with these names
   *                   (palette keys, so the game's theme.js tints them) instead
   *                   of each personality's own hex colours */
    constructor(opts) {
      opts = opts || {};
      const THREE = window.THREE;
      this.THREE = THREE;
      this.cellAspect = opts.cellAspect || 0.6;
      this.colorKeys = opts.colorKeys || null;
      this.ascii = new A.AsciiRenderer({
        supersample: opts.supersample || 2,
        convert: { exposure: 0.98, gamma: 1.1, black: 0.02, hole: 0.012 },
      });

      const scene = (this.scene = new THREE.Scene());
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      scene.add(new THREE.AmbientLight(0xffffff, 0.12));
      this.key = new THREE.DirectionalLight(0xffffff, 0.7);
      scene.add(this.key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.3);
      rim.position.set(2.5, 1.5, -3);
      scene.add(rim);
      // A low fill from the front, so faces never sink fully into the shadow side.
      const fill = new THREE.DirectionalLight(0xffffff, 0.22);
      fill.position.set(0.5, -1, 4);
      scene.add(fill);

      const K = makeKit(THREE);
      this.figs = {};
      for (const id of Object.keys(PERSONALITIES)) {
        const fig = BUILDERS[PERSONALITIES[id].figure](K);
        fig.group.visible = false;
        scene.add(fig.group);
        const sphere = boundingSphere(THREE, fig.group);
        fig.center = sphere.center;
        fig.radius = sphere.radius;
        this.figs[id] = fig;
      }

      this.current = PERSONALITIES[opts.personality] ? opts.personality : "sugar";
      this.prev = null;
      this.switchAt = null;
      this.pendingSwitch = false;
      this.look = { x: 0, y: 0 };
      this.lookTarget = null;
      this.talk = 0;
      this.lastT = null;
    }

    setPersonality(id) {
      if (!PERSONALITIES[id] || id === this.current) return;
      this.prev = this.current;
      this.current = id;
      this.pendingSwitch = true;
    }

    /* The participant's face position, x right and y up, -1..1. null: nobody
     * there, so it looks around on its own. */
    setLook(look) {
      if (!look) this.lookTarget = null;
      else this.lookTarget = { x: clamp1(look.x), y: clamp1(look.y) };
    }

    colors(id) {
      return this.colorKeys || PERSONALITIES[id || this.current].colors;
    }

    /* Advance time-based state (look easing, talking) to t seconds. */
    tick(t, opts) {
      const dt = this.lastT == null ? 0 : Math.max(0, Math.min(0.25, t - this.lastT));
      this.lastT = t;
      if (opts.personality) this.setPersonality(opts.personality);
      if (opts.look !== undefined) this.setLook(opts.look);
      if (this.pendingSwitch) {
        this.switchAt = t;
        this.pendingSwitch = false;
      }
      const target = this.lookTarget || wander(t);
      const k = 1 - Math.exp(-dt * LOOK_EASE);
      this.look.x += (target.x - this.look.x) * k;
      this.look.y += (target.y - this.look.y) * k;
      const talking = opts.mood === "talking" ? 1 : 0;
      this.talk += (talking - this.talk) * (1 - Math.exp(-dt * 8));
    }

    pose(id, t) {
      const fig = this.figs[id];
      const g = fig.group;
      const L = this.look;
      // Turns slowly on its own; the lean toward the participant rides on top.
      const sway = Math.sin(t * 0.37) * 0.24 + Math.sin(t * 0.13 + 1) * 0.1;
      const engaged = Math.min(1, Math.hypot(L.x, L.y) * 1.5);
      g.rotation.set(
        -L.y * 0.35 + Math.sin(t * 0.29) * 0.05,
        sway * (1 - 0.6 * engaged) + L.x * 0.6,
        -L.x * 0.07
      );
      g.position.set(L.x * 0.08, Math.sin(t * 0.8) * 0.035 + L.y * 0.05, 0);
      fig.update(t, { talk: this.talk, look: L });
    }

    renderOne(id, cols, rows, t) {
      const fig = this.figs[id];
      for (const k of Object.keys(this.figs)) this.figs[k].group.visible = k === id;
      this.pose(id, t);
      // Light swings slowly across the front, so the facets keep catching it.
      this.key.position.set(-2.2 + Math.sin(t * 0.21) * 1.6, 2.4 + Math.cos(t * 0.17) * 0.6, 3);
      A.fitCamera(this.camera, cols, rows, this.cellAspect, fig.center, fig.radius, 1.0);
      this.ascii.setSize(cols, rows);
      return this.ascii.render(this.scene, this.camera);
    }

    /* Render a cols x rows block at time t (seconds). Returns { cols, rows, chars, colors },
     * colors as CSS colour strings (null for blank cells). */
    render(cols, rows, t, opts) {
      opts = opts || {};
      this.tick(t, opts);
      const cur = this.renderOne(this.current, cols, rows, t);
      const n = cols * rows;
      const chars = new Array(n);
      const colors = new Array(n);
      paint(cur, this.colors(this.current), chars, colors);

      // Switching: the new figure tears in over the old one, row by row and cell by cell.
      const p = this.switchAt == null ? 1 : (t - this.switchAt) / SWITCH_SECONDS;
      if (p < 1 && this.prev) {
        const old = this.renderOne(this.prev, cols, rows, t);
        const oc = new Array(n);
        const ocol = new Array(n);
        paint(old, this.colors(this.prev), oc, ocol);
        const frameNo = Math.floor(t * 24);
        const tear = Math.sin(p * PI);
        for (let y = 0; y < rows; y++) {
          const shift = hash2(y, frameNo) < 0.3 * tear ? Math.round((hash2(frameNo, y) - 0.5) * 10 * tear) : 0;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            if (hash2(x, y * 7 + 3) * 0.8 + hash2(y, 11) * 0.2 >= p) {
              const sx = Math.min(cols - 1, Math.max(0, x - shift));
              chars[i] = oc[y * cols + sx];
              colors[i] = ocol[y * cols + sx];
            }
          }
        }
      } else if (p >= 1) {
        this.prev = null;
      }

      // Build-in: scattered characters first, then the whole figure.
      const reveal = opts.reveal == null ? 1 : opts.reveal;
      if (reveal < 1) {
        for (let i = 0; i < n; i++) {
          if (hash2(i % cols, (i / cols) | 0) > reveal) {
            chars[i] = " ";
            colors[i] = null;
          }
        }
      }
      return { cols, rows, chars, colors };
    }

    /* Draw into an Oracle.Grid, inside opts.region (default: the whole grid). */
    frame(grid, t, opts) {
      opts = opts || {};
      const r = opts.region || { x: 0, y: 0, w: grid.cols, h: grid.rows };
      this.cellAspect = grid.cellW && grid.cellH ? grid.cellW / grid.cellH : this.cellAspect;
      const out = this.render(r.w, r.h, t, opts);
      for (let y = 0; y < out.rows; y++) {
        for (let x = 0; x < out.cols; x++) {
          const i = y * out.cols + x;
          if (out.chars[i] !== " ") grid.set(r.x + x, r.y + y, out.chars[i], out.colors[i]);
        }
      }
      return out;
    }
  }

  /* Centre of the bounding box, radius out to the farthest vertex: tighter than the
   * box's own sphere, so each figure fills its block. */
  function boundingSphere(THREE, object) {
    object.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const v = new THREE.Vector3();
    let r2 = 0;
    object.traverse((o) => {
      const pos = o.isMesh && o.geometry.attributes.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        r2 = Math.max(r2, v.distanceToSquared(center));
      }
    });
    return new THREE.Sphere(center, Math.sqrt(r2));
  }

  /* Where it looks with nobody there: slow sweeps across the room, a glance up or
   * down now and then, never quite repeating. */
  function wander(t) {
    return {
      x: 0.55 * Math.sin(t * 0.27) + 0.25 * Math.sin(t * 0.71 + 2),
      y: 0.18 * Math.sin(t * 0.37 + 1) + 0.08 * Math.sin(t * 0.93),
    };
  }

  function clamp1(v) {
    return Math.max(-1, Math.min(1, +v || 0));
  }

  function paint(frame, palette, chars, colors) {
    const top = frame.ramp.length - 1;
    for (let i = 0; i < frame.chars.length; i++) {
      const l = frame.level[i];
      chars[i] = frame.chars[i];
      colors[i] = l === 0 ? null : l >= top - 2 ? palette.bright : l >= top - 5 ? palette.mid : palette.dim;
    }
  }

  Oracle.PERSONALITIES_3D = PERSONALITIES;
  Oracle.Figures = Figures;

  // Drop-in scene with the same contract as Oracle.scenes.face. Built on first use,
  // so pages that never show it don't pay for a WebGL context. Its glyphs use the
  // grid's palette keys, so theme.js tints them with the rest of the screen.
  const GAME_KEYS = { bright: "bright", mid: "fg", dim: "dim" };
  let shared;
  Oracle.scenes.figure = {
    get figures() {
      if (shared === undefined) {
        try {
          shared = new Figures({ colorKeys: GAME_KEYS });
        } catch (err) {
          console.warn("Oracle: no 3D figures, falling back to the flat faces:", err);
          shared = null;
        }
      }
      return shared;
    },
    /* False when there is no WebGL (or no three.js): main.js uses personas.js instead. */
    get available() {
      return !!(window.THREE && this.figures);
    },
    frame(grid, t, opts) {
      return this.figures.frame(grid, t, opts);
    },
  };
})();
