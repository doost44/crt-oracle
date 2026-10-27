/* The drawing look's background (talk-plan.html, readout-plan.html): technical
 * drawings in coloured ink, stacked floor on floor like an exploded axonometric,
 * turning slowly on the white screen. As the machine decays (signal.js) the floors
 * pull apart, more of them come in, they slip out of register, red frames rise off
 * the top, and someone's handwritten notes pile up on the glass.
 *
 *   Oracle.plans.draw(ctx, now, decay);                 // multiplied over the canvas
 *   Oracle.plans.draw(ctx, now, decay, { alpha: 0.5 }); // fainter (the camera screen)
 *
 * Everything is made up here when the page loads: no drawing is copied from anywhere.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const S = 1024; // each floor is drawn once at this size, then turned and squashed
  const FLOORS = 7;
  // The inks, one or two per floor.
  const INKS = [
    ["#ff2fb4", "#ff9ad5"],
    ["#1fc84a", "#b8f06a"],
    ["#1f2bd6", "#5bc8ff"],
    ["#f2d400", "#ff9a3c"],
    ["#00b4e6", "#ff2fb4"],
    ["#ff3a2a", "#ffd400"],
    ["#8a3cff", "#1fc84a"],
  ];
  const LABELS = ["A:+4.25", "LDV-22", "DN65", "Ø100", "EU Ø100", "RDC", "R+1", "PLB", "CF 12", "VMC", "EF 0.35", "B-07", "+2.40", "ZONE 3", "OBS-1", "VOID", "EYE LVL", "SUBJ.", "N/A", "Ø40", "-1.06"];
  const NOTES = ["conflict!", "to review", "does not work", "who approved this?", "check again", "not to scale", "it is watching", "missing", "see note 4", "remove?", "wrong level", "ask the oracle"];
  const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive';
  const MONO = 'Consolas, "Lucida Console", "Courier New", monospace';

  function random(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  // --- one floor, seen from above --------------------------------------------------

  function floor(r, inks, level) {
    const c = canvas(S, S);
    const g = c.getContext("2d");
    const [ink, wash] = inks;
    const snap = (v) => Math.round(v / 16) * 16;
    // Each floor up is a little smaller, and none is quite square.
    const m = 40 + level * 28 + r() * 40;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const k = 0.85 + r() * 0.15;
      pts.push([S / 2 + Math.cos(a) * (S / 2 - m) * k * 1.3, S / 2 + Math.sin(a) * (S / 2 - m) * k * 1.3]);
    }
    const clamp = (v) => Math.max(m, Math.min(S - m, v));
    const outline = () => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(clamp(x), clamp(y)) : g.moveTo(clamp(x), clamp(y))));
      g.closePath();
    };
    outline();
    g.globalAlpha = 0.1 + r() * 0.12;
    g.fillStyle = wash;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = ink;
    g.lineWidth = 3;
    g.stroke();
    g.save();
    outline();
    g.clip();

    // The structural grid: long dash-dot axes.
    g.lineWidth = 1;
    g.setLineDash([22, 6, 3, 6]);
    const step = 90 + r() * 70;
    for (let x = m + r() * step; x < S; x += step) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, S);
      g.stroke();
    }
    for (let y = m + r() * step; y < S; y += step) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
    g.setLineDash([]);

    // Rooms: double walls, some washed, some hatched, a door swing here and there.
    const rooms = 10 + Math.floor(r() * 12);
    for (let i = 0; i < rooms; i++) {
      const x = snap(m + r() * (S - 2 * m - 120));
      const y = snap(m + r() * (S - 2 * m - 120));
      const w = snap(48 + r() * 200);
      const h = snap(48 + r() * 160);
      g.lineWidth = 1.6;
      g.strokeStyle = ink;
      g.strokeRect(x, y, w, h);
      if (r() < 0.6) g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      if (r() < 0.25) {
        g.globalAlpha = 0.28;
        g.fillStyle = r() < 0.5 ? wash : ink;
        g.fillRect(x + 5, y + 5, w - 10, h - 10);
        g.globalAlpha = 1;
      } else if (r() < 0.2) {
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.lineWidth = 0.8;
        for (let k = -h; k < w; k += 9) {
          g.beginPath();
          g.moveTo(x + k, y + h);
          g.lineTo(x + k + h, y);
          g.stroke();
        }
        g.restore();
      }
      if (r() < 0.35) {
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y + h);
        g.arc(x, y + h, 28, -Math.PI / 2, 0);
        g.stroke();
      }
    }

    // Pipes and ducts: fat translucent runs with right-angle bends and a thin centre line.
    const runs = 2 + Math.floor(r() * 4);
    for (let i = 0; i < runs; i++) {
      let x = snap(r() * S);
      let y = snap(r() * S);
      const path = [[x, y]];
      for (let k = 0; k < 4 + r() * 4; k++) {
        if (k % 2) x = snap(Math.max(0, Math.min(S, x + (r() - 0.5) * 600)));
        else y = snap(Math.max(0, Math.min(S, y + (r() - 0.5) * 600)));
        path.push([x, y]);
      }
      const draw = () => {
        g.beginPath();
        path.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py)));
      };
      g.globalAlpha = 0.4;
      g.strokeStyle = r() < 0.5 ? wash : ink;
      g.lineWidth = 10 + r() * 22;
      g.lineJoin = "miter";
      draw();
      g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = ink;
      g.lineWidth = 1;
      draw();
      g.stroke();
      // Risers along the run: little filled circles.
      g.fillStyle = ink;
      for (const [px, py] of path) {
        if (r() < 0.6) {
          g.beginPath();
          g.arc(px, py, 4 + r() * 6, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // Labels.
    g.fillStyle = ink;
    g.font = `13px ${MONO}`;
    for (let i = 0; i < 26; i++) {
      g.fillText(LABELS[Math.floor(r() * LABELS.length)], m + r() * (S - 2 * m), m + r() * (S - 2 * m));
    }
    g.restore();

    // Grid bubbles round the edge: circled axis names.
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 1.5;
    g.font = `bold 15px ${MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < 6; i++) {
      const x = m + ((i + 0.5) / 6) * (S - 2 * m);
      g.beginPath();
      g.arc(x, m * 0.55, 13, 0, Math.PI * 2);
      g.stroke();
      g.fillText(String.fromCharCode(65 + i + level), x, m * 0.55 + 1);
    }
    return c;
  }

  // --- handwritten notes: a cloud round a few words, and an arrow out of it ---------

  function note(r, text) {
    const c = canvas(420, 220);
    const g = c.getContext("2d");
    g.strokeStyle = "#151515";
    g.fillStyle = "#151515";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    const cx = 190;
    const cy = 100;
    const rx = 120 + r() * 30;
    const ry = 52 + r() * 16;
    // The cloud: bumps round an ellipse.
    const n = 14 + Math.floor(r() * 5);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      if (!i) g.moveTo(x, y);
      else {
        const am = ((i - 0.5) / n) * Math.PI * 2;
        g.quadraticCurveTo(cx + Math.cos(am) * rx * 1.22, cy + Math.sin(am) * ry * 1.3, x, y);
      }
    }
    g.stroke();
    g.font = `26px ${HAND}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.save();
    g.translate(cx, cy);
    g.rotate((r() - 0.5) * 0.15);
    g.fillText(text, 0, 0);
    g.restore();
    // The leader: out of the cloud and off to one side, with an arrowhead.
    const ax = cx + rx * 0.9;
    const ay = cy + ry * 0.6;
    const bx = 400;
    const by = 200 - r() * 40;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(bx - 20, ay + 10, bx, by);
    g.stroke();
    const ang = Math.atan2(by - ay - 10, bx - (bx - 20));
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx - Math.cos(ang - 0.4) * 14, by - Math.sin(ang - 0.4) * 14);
    g.moveTo(bx, by);
    g.lineTo(bx - Math.cos(ang + 0.4) * 14, by - Math.sin(ang + 0.4) * 14);
    g.stroke();
    // Sometimes a warning triangle beside it.
    if (r() < 0.5) {
      const tx = 40;
      const ty = 30;
      g.beginPath();
      g.moveTo(tx, ty - 18);
      g.lineTo(tx + 18, ty + 14);
      g.lineTo(tx - 18, ty + 14);
      g.closePath();
      g.stroke();
      g.font = `bold 20px ${HAND}`;
      g.fillText("!", tx, ty + 2);
    }
    return c;
  }

  // --- the stack ---------------------------------------------------------------------

  let made = null;
  function make() {
    const r = random((Math.random() * 4294967295) >>> 0);
    const floors = [];
    for (let i = 0; i < FLOORS; i++) floors.push({ img: floor(r, INKS[i % INKS.length], i), du: r() - 0.5, dv: r() - 0.5, spin: r() - 0.5 });
    // Pipes and columns that run up through the floors.
    const risers = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.floor(r() * FLOORS);
      risers.push({ u: 120 + r() * (S - 240), v: 120 + r() * (S - 240), from: a, to: Math.min(FLOORS - 1, a + 1 + Math.floor(r() * 4)), colour: r() < 0.6 ? "#ff2a2a" : r() < 0.5 ? "#151515" : "#ff2fb4" });
    }
    // Red frames standing up off the top floor.
    const frames = [];
    for (let i = 0; i < 4; i++) frames.push({ u: 150 + r() * (S - 450), v: 150 + r() * (S - 450), w: 80 + r() * 200, h: 60 + r() * 160, tall: 0.4 + r() * 0.8 });
    // Notes, placed on the screen (not on a floor), arriving one by one as it decays.
    const notes = [];
    for (let i = 0; i < 9; i++) notes.push({ img: note(r, NOTES[i % NOTES.length]), x: 0.04 + r() * 0.74, y: 0.04 + r() * 0.78, at: 0.12 + i * 0.09, tilt: (r() - 0.5) * 0.3 });
    made = { floors, risers, frames, notes, stack: canvas(1, 1) };
    made.g = made.stack.getContext("2d");
  }

  /* Multiply the turning stack of drawings over the canvas behind ctx. */
  function draw(ctx, now, decay, opts) {
    opts = opts || {};
    if (!made) make();
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    if (!W || !H) return;
    const d = Math.max(0, Math.min(1, decay || 0));
    const st = made.stack;
    if (st.width !== W || st.height !== H) {
      st.width = W;
      st.height = H;
    }
    const g = made.g;
    const unit = H / 1080;
    const t = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);

    // How many floors, how far apart, how far out of register.
    const shown = Math.min(FLOORS, 3 + d * (FLOORS - 3));
    const count = Math.ceil(shown);
    const gap = (0.035 + d * 0.085) * H;
    const k = Math.min(W * 0.95, H * 1.7) / (S * 1.414);
    const theta = Math.PI / 4 + t * 0.03;
    const cx = W / 2;
    const cy = H * 0.5 + (gap * (count - 1)) / 2;
    const iso = (th) => {
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      return { a: k * cos, b: 0.5 * k * sin, c: -k * sin, d: 0.5 * k * cos };
    };
    const base = iso(theta);
    const project = (u, v, z) => {
      const x = u - S / 2;
      const y = v - S / 2;
      return [cx + base.a * x + base.c * y, cy + base.b * x + base.d * y - z];
    };

    g.globalCompositeOperation = "multiply";
    for (let i = 0; i < count; i++) {
      const f = made.floors[i];
      const z = i * gap;
      // Out of register as it decays: each floor slides and turns a little on its own.
      const slip = d * d * 90;
      const du = f.du * slip + Math.sin(t * 0.4 + i) * slip * 0.3;
      const dv = f.dv * slip + Math.cos(t * 0.33 + i * 2) * slip * 0.3;
      const m = iso(theta + f.spin * d * 0.25);
      const x0 = -S / 2 + du;
      const y0 = -S / 2 + dv;
      g.setTransform(m.a, m.b, m.c, m.d, cx + m.a * x0 + m.c * y0, cy - z + m.b * x0 + m.d * y0);
      g.globalAlpha = Math.min(1, shown - i) * 0.9; // the newest floor fades in
      g.drawImage(f.img, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    // Risers between floors, and frames standing off the top.
    g.globalAlpha = 0.85;
    g.lineWidth = Math.max(1, 1.4 * unit);
    for (const rz of made.risers) {
      if (rz.to >= count) continue;
      const [x1, y1] = project(rz.u, rz.v, rz.from * gap);
      const [, y2] = project(rz.u, rz.v, rz.to * gap);
      g.strokeStyle = rz.colour;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x1, y2);
      g.stroke();
    }
    const top = (count - 1) * gap;
    g.strokeStyle = "#ff2a2a";
    for (const fr of made.frames) {
      const lift = top + fr.tall * (0.08 + d * 0.3) * H;
      const corners = [[fr.u, fr.v], [fr.u + fr.w, fr.v], [fr.u + fr.w, fr.v + fr.h], [fr.u, fr.v + fr.h]];
      for (const z of [top, lift]) {
        g.beginPath();
        corners.forEach(([u, v], i) => {
          const [x, y] = project(u, v, z);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.closePath();
        g.stroke();
      }
      g.beginPath();
      for (const [u, v] of corners) {
        const [x, y1] = project(u, v, top);
        const [, y2] = project(u, v, lift);
        g.moveTo(x, y1);
        g.lineTo(x, y2);
      }
      g.stroke();
    }

    // The notes, flat on the glass.
    for (const n of made.notes) {
      const a = Math.min(1, (d - n.at) * 8);
      if (a <= 0) continue;
      g.globalAlpha = a * 0.9;
      const s = unit * 0.9;
      g.setTransform(s * Math.cos(n.tilt), s * Math.sin(n.tilt), -s * Math.sin(n.tilt), s * Math.cos(n.tilt), n.x * W, n.y * H);
      g.drawImage(n.img, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = opts.composite || "multiply";
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.drawImage(st, 0, 0);
    ctx.restore();
  }

  Oracle.plans = { draw };
})();
