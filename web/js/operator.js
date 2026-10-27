/* The operator panel: polls oracle/server.py and shows each conversation live,
 * with the Oracle's private notes (why it switched, which seed it is after).
 * Watch only. Open /operator.html (add ?key=... when the server printed one). */
(function () {
  "use strict";
  const POLL_MS = 1000;
  const key = new URLSearchParams(location.search).get("key") || "";
  const q = (extra) => "?" + new URLSearchParams({ ...(key ? { key } : {}), ...(extra || {}) });

  const $ = (id) => document.getElementById(id);
  const list = $("op-list");
  const log = $("op-log");
  const head = $("op-head");
  const status = $("op-status");
  const follow = $("op-follow");

  let current = null; // id of the conversation shown
  let seen = 0; // events of it already drawn

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function get(path, extra) {
    const res = await fetch(`api/operator/${path}${q(extra)}`, { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  function time(iso) {
    return (iso || "").slice(11, 19);
  }

  function show(id) {
    if (id === current) return;
    current = id;
    seen = 0;
    log.innerHTML = "";
    head.textContent = "";
    for (const li of list.children) li.classList.toggle("on", li.dataset.id === id);
  }

  function draw(event) {
    const li = el("li", event.type);
    li.appendChild(el("span", "t", time(event.t)));
    if (event.type === "start") {
      li.append(`visitor walked up · chose the ${event.symbol} · ${event.personality} · brain: ${event.brain}`);
    } else if (event.type === "oracle") {
      li.classList.add(event.personality);
      li.appendChild(el("span", "who", event.personality.toUpperCase()));
      li.appendChild(el("span", "said", event.lines.join("  /  ")));
      const bits = [];
      if (event.observation) bits.push(event.observation);
      if (event.seed && event.seed !== "none") bits.push(`seed: ${event.seed}`);
      if (event.source !== "claude") bits.push(`[${event.source}]`);
      if (event.usage && event.usage.output) bits.push(`${event.usage.input}+${event.usage.output} tok, ${event.usage.cache_read} cached`);
      if (event.end) bits.push("ENDS");
      if (bits.length) li.appendChild(el("div", "note", bits.join(" · ")));
    } else if (event.type === "visitor") {
      li.appendChild(el("span", "who", "VISITOR"));
      li.appendChild(el("span", "said", event.text));
      const bits = [];
      if (event.seconds != null) bits.push(`${event.seconds.toFixed(1)}s`);
      if (event.camera) bits.push(`camera: ${event.camera}`);
      if (bits.length) li.appendChild(el("div", "note", bits.join(" · ")));
    } else if (event.type === "switch") {
      li.className = "switch";
      li.textContent = `── ${event.frm} → ${event.to} ──`;
    } else if (event.type === "error") {
      li.append(`error (${event.where}): ${event.message} · the mock answered instead`);
    } else if (event.type === "receipt") {
      li.append(`receipt printed${event.source !== "claude" ? ` [${event.source}]` : ""}`);
      li.appendChild(el("br"));
      li.appendChild(el("pre", null, event.text));
    }
    log.appendChild(li);
  }

  async function tick() {
    try {
      const { brain, sessions } = await get("sessions");
      $("op-brain").textContent = `brain: ${brain}`;
      list.innerHTML = "";
      for (const s of sessions) {
        const li = el("li");
        li.dataset.id = s.id;
        li.appendChild(el("div", null, `${time(s.started)} · ${s.symbol}`));
        li.appendChild(el("div", "meta", `${s.personality} · turn ${s.turns}/${s.max_turns}${s.ended ? " · done" : ""}`));
        li.addEventListener("click", () => {
          follow.checked = false;
          show(s.id);
        });
        li.classList.toggle("on", s.id === current);
        list.appendChild(li);
      }
      if (sessions.length && (follow.checked || !current)) show(sessions[0].id);
      if (current) {
        const conv = await get(`sessions/${current}`, { since: seen });
        const atBottom = log.parentElement.scrollHeight - log.parentElement.scrollTop - log.parentElement.clientHeight < 40;
        head.innerHTML = "";
        head.append("conversation ", el("b", null, conv.id), ` · now ${conv.personality} · turn ${conv.turns}/${conv.max_turns}${conv.ended ? " · ended" : ""}`);
        for (const event of conv.events) draw(event);
        seen += conv.events.length;
        if (atBottom) log.parentElement.scrollTop = log.parentElement.scrollHeight;
      } else {
        head.textContent = "Waiting for a visitor.";
      }
      status.textContent = "live";
      status.classList.remove("bad");
    } catch (err) {
      status.textContent = String(err.message || err);
      status.classList.add("bad");
    }
    setTimeout(tick, POLL_MS);
  }

  tick();
})();
