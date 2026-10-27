/* The live Oracle: an open conversation through oracle/server.py, in place of the
 * scripted story. Only used when the page is served by `python -m oracle.server`
 * (window.ORACLE_LIVE is set); on GitHub Pages the scripted story plays instead.
 *
 *   const { receipt } = await Oracle.runLive(content, terminal, { live, onPersonality, camera });
 *
 * The welcome and the symbol choice still come from content/story.yaml. After
 * that, every line comes from the server: Claude, or the offline mock.
 */
(function () {
  "use strict";
  const Oracle = (window.Oracle = window.Oracle || {});

  const LOST = "THE SIGNAL IS GONE. IT WAS NOT YOUR FAULT. PROBABLY.";
  const PRINTING = "YOUR RECEIPT IS PRINTING. DO NOT READ IT IN FRONT OF ME.";
  const LOST_RECEIPT = [
    "================================",
    "      THE ORACLE LOST THE",
    "            SIGNAL",
    "================================",
    "Whatever you said, it heard.",
    "It just can't print it.",
    "================================",
    "",
  ].join("\n");

  async function post(live, path, body) {
    const res = await fetch(`${live.api}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* Show the dots while waiting for the server; never shorter than `minMs`, so a
   * fast mock reply still reads as the Oracle thinking. */
  async function withThinking(terminal, promise, minMs) {
    const stop = terminal.thinking();
    try {
      const [value] = await Promise.all([promise, new Promise((r) => setTimeout(r, minMs))]);
      return value;
    } finally {
      stop();
    }
  }

  async function runLive(content, terminal, opts) {
    opts = opts || {};
    const live = opts.live || window.ORACLE_LIVE;
    const onPersonality = opts.onPersonality || function () {};
    const camera = opts.camera || function () { return null; };
    const nodes = content.story.nodes;
    const art = content.art || {};
    const think = opts.thinkMs != null ? opts.thinkMs : 700;

    // The welcome and the symbol, as in the scripted story.
    const welcome = nodes[content.story.start];
    if (welcome && welcome.type === "say") await terminal.say(typeof welcome.text === "string" ? welcome.text : welcome.text.default);
    const pick = nodes.pick_symbol;
    await terminal.say(typeof pick.text === "string" ? pick.text : pick.text.default);
    const labels = pick.options.map((o) => o.label);
    terminal.menu(labels);
    const option = pick.options[await terminal.choose(labels)];
    if (option.art && art[option.art]) await terminal.art(art[option.art]);
    onPersonality(option.personality);

    const voice = (content.personalities || {})[option.personality];
    const symbol = (voice && voice.symbol) || option.art;
    let id = null;
    const speak = async (reply) => {
      if (reply.personality) onPersonality(reply.personality);
      for (const line of reply.lines || []) await terminal.say(line);
    };
    try {
      let reply = await withThinking(terminal, post(live, "session", { symbol }), think);
      id = reply.id;
      await speak(reply);
      while (!reply.end) {
        const asked = performance.now();
        const text = await terminal.readLine(">", { max: live.maxInput || 240 });
        const seconds = (performance.now() - asked) / 1000;
        reply = await withThinking(terminal, post(live, "turn", { id, text, seconds, camera: camera() }), think);
        await speak(reply);
      }
      await terminal.say(PRINTING);
      const { receipt, personality } = await withThinking(terminal, post(live, "receipt", { id }), think);
      return { receipt, personality, id };
    } catch (err) {
      console.warn("live Oracle:", err);
      await terminal.say(LOST);
      return { receipt: LOST_RECEIPT, personality: null, id };
    }
  }

  Oracle.runLive = runLive;
})();
