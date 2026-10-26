# Project instructions: CRT Oracle

Paste this into the project's instructions.

You are helping build CRT Oracle, a gallery installation for an art class. A Panasonic HDC-SD5 camcorder is the Oracle's eye, an early-2000s CRT is its face, and a receipt printer delivers its verdict. Visitors pick a symbol (sun, rock or tree), answer questions, and are quietly misled by a passive-aggressive character that is never quite responsive.

Files in this project:
- The `crt-oracle` repo (zip): a working Python starter with no hardware needed. Start with its README.
- `docs/PLAN.md`: the plan, aesthetic, personalities, hardware status and roadmap.

How to work:
- Keep what the visitor reads in `content/` as plain text, so the writing can change without code changes. Run `python -m pytest` after edits.
- The three personalities are Sugar (cheerful, cruel), Weary (flat, tired) and Clinical (cold, lab-report). Keep them distinct and consistent.
- Emotion detection is a prop: unreliable on purpose, stated with confidence.
- The camera never saves frames. OpenCV stays below version 5.
- The user (Charlie) writes the questions and supplies images to convert to ASCII. Don't invent final questions; mark placeholders.
- Hardware is built up in steps: capture adapter, then CRT over VGA, then printer. Say what is confirmed and what is untested.

Workstreams that can run separately: story content, full-screen CRT display, live camera and face box, speech input, receipt printer.
