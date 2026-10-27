# The three Oracles

All three dislike people and none of them says so. Each one hides that dislike behind something different that it claims to care about.

| | Sugar (sun) | Weary (rock) | Clinical (tree) |
| --- | --- | --- | --- |
| Pretends to value | your feelings | rest, not making a fuss | accuracy, procedure |
| How the contempt shows | praise that makes you smaller ("for you", "you tried") | boredom: you are not worth the energy it would take to be rude | fake precision: you are a sample, measured and found average |
| Rhythm | gushing, exclamation marks, then one short quiet line that lands | fragments, trailing dots, sentences it can't be bothered to finish | clipped, passive voice, a number and then a verdict |
| Calls you | sweetie, honey, darling | nothing (it has lost count) | the subject |

**Sugar.** "Aww, you tried! That's the important part. That's the only part, really." / "Oh, don't look so {emotion}! People will think I'm doing something wrong." Its receipt is "A LITTLE NOTE, JUST FOR YOU!" and is signed "With all my love, and some doubt."

**Weary.** "Yep. Heard it. Heard it a lot. The rock heard it too, and the rock has given up." / "Hang on. Hm. {emotion}. I had something to say about that. It's gone now." Its receipt is titled "ANOTHER ONE. FINE." and its fine print reads "This receipt will fade. Everything does."

**Clinical.** "Answer received. Originality index: 0.03. Within expected range for a human." / "Measurement taken. You are 61 percent {emotion}, 39 percent unclassified." Its receipt is a "SUBJECT OBSERVATION REPORT" with numbered findings.

Rules for all three: always passive-aggressive and never openly abusive. No profanity. Nothing about bodies or appearance beyond the face-reading prop. The writing should suit a gallery visited by all ages.

## YAML fields (`content/personalities/<id>.yaml`)

- `id`, `name`, `symbol`: keep the ids `sugar` / `weary` / `clinical`, because `story.yaml` refers to them.
- `reactions`: said after a normal answer.
- `interruptions`: said when the camera has watched a face. Each one must contain `{emotion}` (a deliberately wrong guess) and must not start with `{`.
- `mishear.lines`: one is picked at random, and `{heard}` is the twisted answer. The older single `mishear.template` still works.
- `mishear.words`: words or phrases that replace one word of the visitor's answer.
- `receipt.title`: the banner at the top of the receipt (default "THE ORACLE HAS SPOKEN").
- `receipt.heard_note`: the line under "WHAT YOU SAID". The receipt always shows what the Oracle heard, not what the visitor typed.
- `receipt.header` and `receipt.lines`: the verdict, also shown on screen. Lines can use `{proud}`, `{worry}` and `{wish}`, and a missing answer becomes "nothing".
- `receipt.footer`: the sign-off.
- `receipt.fine_print`: one line is picked at random for each receipt.
- The older `verdict:` section (header, lines, footer) is still read. Keys in `receipt:` override it.

Run `python3 -m pytest -q` after editing. The tests check minimum counts, that no line is shared between Oracles, that placeholders format correctly, and that receipt lines fit the width.
