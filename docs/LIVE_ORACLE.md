# The live Oracle (roadmap phase 6, draft)

The scripted five questions are replaced by an open conversation. Claude plays
the Oracle: it starts in the mask of the symbol the visitor picked, steers
toward the seed themes, switches between Sugar, Weary and Clinical depending on
how the visitor answers, and ends by printing a reading of the whole
conversation. A hidden operator panel shows the conversation live, with the
Oracle's private notes. Every conversation is logged.

**No API key yet? Everything runs in mock mode.** The mock plays the Oracle
from canned lines and a few rules (short answers bring out Weary, defensive ones
Clinical, open ones Sugar), so the whole flow can be built and tested for free.
Its writing is deliberately plain; Claude does the real thing.

## Run it

From the repo root on the laptop (PowerShell):

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[dev,live]"
.\.venv\Scripts\python.exe -m oracle.server --mock
```

Open http://localhost:8000 for the Oracle and http://localhost:8000/operator.html
for the operator panel (a second window, or the second monitor). Ctrl+C stops
the server.

`py -m http.server 8000 -d web` and GitHub Pages still work, and still play the
scripted story: the live conversation only switches on when the page is served
by `python -m oracle.server`.

## Switching to Claude (needs an API key)

1. Create a key at https://console.anthropic.com (Settings > API keys). Under
   Limits, set a monthly spend limit first.
2. Give it to the server through the environment, never in a file in the repo:

   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."
   .\.venv\Scripts\python.exe -m oracle.server
   ```

   With a key set, the server uses Claude (`--claude` insists on it, `--mock`
   ignores it). The first line it prints says which brain is running, and the
   operator panel shows it too.

The key stays in the server process. The page in the browser only talks to the
server on the same laptop; nothing in `web/` ever sees the key.

If Claude can't answer (no network, an API error, a declined request), the mock
answers that one turn instead, the visitor sees no error, and the operator panel
shows what went wrong in red.

**Cost.** Each reply sends the conversation so far plus a ~2,500-token system
prompt to `claude-opus-5-5` at low effort. A guess, before real runs: a few
cents to about ten cents per visitor. The operator panel shows the tokens for
every reply, so the first evening of real visitors will give the true number.
`config.yaml` (`live:`) holds the model, effort, turn limit and token cap.

## The operator panel

`/operator.html` lists every conversation since the server started and follows
the newest one. For each Oracle line it shows which mask spoke, which seed it is
steering toward, and a private note in which the Oracle says what it noticed and
why it switched. It is watch only: nothing on it can steer the Oracle.

To watch from a phone on the same Wi-Fi, start the server with
`--host 0.0.0.0`. It then prints the panel's address with a key
(`operator.html?key=...`); the panel refuses anyone without it. Set
`ORACLE_OPERATOR_KEY` to choose the key yourself.

## Logs

Each conversation is written as it happens to `out/sessions/<time>-<id>.jsonl`:
every line the Oracle said (with its mask, note and seed), every answer with how
long the visitor took, every switch and error, and the receipt. These are the
raw material for tuning the personalities. `--no-log` turns logging off.

The logs hold what visitors typed. Nothing from the camera is stored, and the
Oracle is told never to ask for names or other identifying details, but a small
sign at the installation saying conversations are recorded would be honest.

## Changing what the Oracle says

The prompts are plain text in `content/oracle/`, so they can be edited without
touching code. Restart the server after editing.

| File | What it is |
| --- | --- |
| `oracle.md` | The shared brief: who the Oracle is, what makes it creepy, switching, the rules that never bend, reply format |
| `sugar.md`, `weary.md`, `clinical.md` | Each mask: voice, rhythm, what it wants from the visitor, when it takes over, example lines |
| `seeds.yaml` | The themes the conversation steers toward (placeholders until the real questions arrive) |
| `receipt.md` | How the receipt's reading is written |

The rehearsals (roadmap phase 5) will rewrite most of this. The open questions
are marked "first guess" in each mask file.

## How it fits together

```
browser (web/)                          python -m oracle.server            Anthropic
  boot, hallway, face                     serves web/, holds the key
  symbol choice (story.yaml)    POST /api/session  ─────────────────────>  Claude
  the conversation              POST /api/turn     <── reply: mask, lines
  receipt                       POST /api/receipt
operator.html                   GET  /api/operator/...  (watch only)
```

- `oracle/server.py`: the server (standard library only, plus `anthropic` in
  Claude mode).
- `oracle/conversation/`: the prompts, the two brains (Claude and the mock), one
  conversation with its log, and the receipt layout.
- `web/js/live.js`: the conversation on the page. `web/data/live.js` is a stub
  that the server replaces to switch it on.
- Each reply is structured (mask, lines, end, note, seed), so the page always
  knows which face and colour to show. `document.body.dataset.personality` is
  set on every switch, ready for the per-personality colour shift.
- Each turn also carries a note from the room (turn number, how long the visitor
  took, and a `camera` field). The camera field is empty until the always-on
  webcam (roadmap phase 2) fills it, for example with "face close, looking away".

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_conversation.py tests/test_server.py
node web/tests/live_e2e.js
```

The Python tests cover the mock, the server and the Claude brain against a fake
client (request shape, history, fallbacks on errors). `live_e2e.js` starts the
server in mock mode and plays a whole conversation in headless Chromium while
the operator panel watches. None of them call the real API.
