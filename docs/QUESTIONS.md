# Questions (placeholders)

All nine questions in `content/story.yaml` are **placeholders** until the real ones arrive. Each one starts with `[PLACEHOLDER Qn branch]`, so it shows up in the YAML and on screen.

Flow on every branch: `welcome` -> `pick_symbol` -> `<branch>_intro` -> `<branch>_q1` -> `<branch>_q2` -> `<branch>_q3` -> `wake` (press Enter 3 times) -> `verdict`.

| Node | Branch (personality) | Answer key | Placeholder text |
| --- | --- | --- | --- |
| `sun_q1` | sun (Sugar) | `proud` | [PLACEHOLDER Q1 sun] Something you're proud of? |
| `sun_q2` | sun (Sugar) | `worry` | [PLACEHOLDER Q2 sun] Something you worry about? |
| `sun_q3` | sun (Sugar) | `wish` | [PLACEHOLDER Q3 sun] Something you want? |
| `rock_q1` | rock (Weary) | `proud` | [PLACEHOLDER Q1 rock] Something you're proud of? |
| `rock_q2` | rock (Weary) | `worry` | [PLACEHOLDER Q2 rock] Something you worry about? |
| `rock_q3` | rock (Weary) | `wish` | [PLACEHOLDER Q3 rock] Something you want? |
| `tree_q1` | tree (Clinical) | `proud` | [PLACEHOLDER Q1 tree] Something you're proud of? |
| `tree_q2` | tree (Clinical) | `worry` | [PLACEHOLDER Q2 tree] Something you worry about? |
| `tree_q3` | tree (Clinical) | `wish` | [PLACEHOLDER Q3 tree] Something you want? |

Only the questions are placeholders. The welcome, intro, wake and verdict lines are the Oracle's real voice.

## Swapping in the real questions

1. In `content/story.yaml`, search for `PLACEHOLDER` and replace each `text:` with your question. Remove the `[PLACEHOLDER ...]` tag.
2. Keep each `key:` as it is. The answer is saved under that key, and the verdict lines in `content/personalities/*.yaml` insert it as `{proud}`, `{worry}` or `{wish}`.
3. The receipt and verdict show each answer **as the Oracle "heard" it**, which may be a deliberate mishearing. The visitor's real answer is kept separately.
4. If you rename a key, add a question or remove one, update the verdict lines in all three personality files to match. A missing key prints as "nothing" instead of crashing.
5. If you change the number of questions, also update the scripted input in `oracle/main.py` (`DEMO_INPUT`) and `tests/test_runner.py`. Each needs one line per question.
6. Delete `test_every_question_is_a_placeholder` in `tests/test_story.py`. It fails on purpose once the placeholders are gone. Then run `python -m pytest`.
