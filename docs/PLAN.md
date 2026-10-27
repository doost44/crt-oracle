# CRT Oracle: project plan

Plain-text copy of the plan doc, for the project thread. Last updated 2026-10-26.

## Concept
A gallery installation where a camcorder is the Oracle's eye, an early-2000s CRT is its face, and a receipt printer delivers its verdict. Visitors choose a symbol (sun, rock, tree), answer questions, and are quietly misled by a passive-aggressive character that is never quite responsive.

## Visitor flow
1. Welcome screen. The Oracle greets the visitor.
2. Visitor picks a symbol: sun, rock or tree. This sets the personality.
3. The Oracle asks questions on that branch. Answers are typed now, spoken later.
4. Along the way: sometimes the Oracle mishears, a face box appears, and it interrupts.
5. A keyboard-only moment (press Enter to wake the Oracle).
6. The verdict appears on the CRT and prints on a receipt.

## Aesthetic
All ASCII, monospaced, one phosphor colour on black, slow typewriter text, occasional glitches, laid out for an 80 by 24 grid on a 4:3 CRT. The live camera can appear as ASCII with a face box over it (open question).

## Personalities (proposed pairing)
| Personality | Symbol | Tone | Sample line |
| --- | --- | --- | --- |
| Sugar | Sun | Cheerful, quietly cruel | "Oh, what a brave answer! Most people don't say that out loud." |
| Weary | Rock | Flat, tired, unimpressed | "Mm. Sure. I'd write that down, but I'll forget it anyway." |
| Clinical | Tree | Cold, observational | "Response logged. Hesitation: 4.2 seconds. Noted." |

## Camera and face tracking
OpenCV finds faces and draws a box; the Oracle interrupts after a face has been in view a while, never too often, never during the verdict. Emotion is a prop: unreliable on purpose. Frames are not saved.

## Input
Typing first, speech later, keyboard moments throughout. The Oracle can blame mishearing on the visitor.

## Hardware (status 2026-10-26)
- Panasonic HDC-SD5: works. Live composite picture reached an HP monitor with the camcorder's own LCD off (its LCD cable is broken and not needed).
- A/V cable: 3.5mm 4-pole to RCA; yellow carries video. Works.
- USB capture adapter: on order.
- CRT: VGA input; needs a VGA output from the laptop; check accepted resolution.
- Receipt printer: not chosen.

## Web version (added 2026-10-26)
The game moves to a static site on GitHub Pages: PRESS ENTER, then an ASCII hallway (references 01 and 02), then the painted face as a floating, rotating ASCII Oracle (reference 04, depth layers in assets/oracle-face/), then the conversation. Style follows reference 03: blue background, white characters, terminal text. Replies come from Claude through a proxy that holds the API key; a scripted fallback keeps it working without the AI. Webcam face detection runs in the browser. See WEB_BUILD_PROMPT.md.

## Roadmap
1. Foundation (this repo). Done.
2. Hardware bring-up: capture adapter on the laptop, laptop to CRT.
3. Full-screen CRT display with phosphor look.
4. Real content: questions, ASCII art from your images, final personality scripts.
5. Face box and interruptions on the live camera.
6. Real receipt printer.
7. Speech input.
8. Gallery hardening: attract screen, reset, auto restart, rehearsal.

## Open questions
- Confirm the sun/rock/tree to Sugar/Weary/Clinical pairing.
- Your questions and branching (paper prototype to come).
- Should visitors see the camera feed on the CRT, or only the face box?
- Which receipt printer, and what should the receipt show?
- Laptop operating system?
- How long should one visit take, and what does the idle screen show?

## Suggested split for sub-agents
- Story and content: `content/` and `story.yaml` format.
- CRT display: a real-time full-screen renderer replacing `ConsoleDisplay`.
- Camera and face: live OpenCV loop feeding the interrupter, face box overlay.
- Speech: a `SpeechInput` with `read_line()`.
- Printer: real receipt printer backend and layout.
