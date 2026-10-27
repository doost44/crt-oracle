# Prompt: build the web version

Paste this into the project thread. Charlie is on Windows (PowerShell).

---

Turn CRT Oracle into a browser game that runs live on GitHub Pages. Keep the Python repo as the working prototype and reference. Build the web version as a static site that I can deploy from PowerShell on Windows.

Reference images are in docs/references/ (see the README there): 01 tiled room (the hallway look), 02 Woods on Fire (glitchy, fragmented architecture), 03 ASCII poster (the ASCII style, blue with white characters), 04 painted face (the Oracle). The face's depth layers are in assets/oracle-face/: color, height, mask and sculpt maps, plus the original 3D relief page.

The feel: an old cartridge or terminal game that is really made by us. Monospaced, blocky, with a screen glow. Propose a palette from the references (the blue-and-white poster is the strongest). Layout must work on a 4:3 CRT and on a normal laptop, scaling to the window.

The flow:
1. Boot screen with only a blinking prompt: PRESS ENTER TO START.
2. Enter loads a virtual ASCII hallway or landscape: a first-person drift through a checkerboard-and-tile corridor in perspective, rendered entirely in characters, drifting and glitching.
3. The visitor arrives at the Oracle, a floating ASCII sun/face built from the painted face, lit and slowly rotating using the height and sculpt maps, with the mask as its outline.
4. The visitor chooses a symbol (sun, rock or tree), which sets one of the three personalities (Sugar, Weary, Clinical).
5. The visitor talks to the Oracle.
6. The Oracle gives a verdict, and a receipt appears.

The Oracle (live AI):
- Replies come from Claude, playing the chosen personality in character: passive-aggressive, a little deceptive, never quite responsive, short replies.
- Write a system prompt per personality from the existing personality files. Cap each visit (for example 6 exchanges) and each reply's length so cost stays small.
- Include a scripted fallback, built from the existing YAML content, so the piece still works if the API is down or a visitor hits a limit.
- Never put an API key in client code. Use a small serverless proxy (such as a Cloudflare Worker) that holds the key, with rate limits, a token cap and an origin check. Explain the setup step by step. A "paste your own key" option, kept only in the browser session, is fine for rehearsals.

Webcam:
- Use the browser camera (getUserMedia). Detect faces in the browser, draw an ASCII face box, and interrupt the visitor using the existing rules (face in view for a while, minimum gap, never during the verdict). Emotion stays an unreliable guess.
- No frames are stored or sent anywhere. Ask for camera permission clearly, and make the camera optional so the game works without it.

Receipt: show it on screen as a ticket, and let the visitor print it with the browser print dialog using a narrow receipt layout, or save it. Thermal printer support comes later.

How to work:
- Build in stages, and make each one runnable before the next: (1) boot screen and Enter, (2) ASCII hallway, (3) sun/face reveal, (4) scripted dialogue and receipt, (5) live Claude replies through the proxy, (6) webcam and interruptions, (7) polish.
- Use plain HTML, CSS and JavaScript with no build step if you can. Pin any CDN library versions.
- Convert the story and personalities to JSON the web app reads, and keep the writing editable by me.
- Tell me the exact PowerShell commands to run it locally and to publish it to GitHub Pages.
- Check your work: run what you can, and list anything you couldn't test, like my webcam and the proxy.
