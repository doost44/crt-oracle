# Exhibit kiosk (Windows)

One double-click starts the Oracle for the show: a local web server for `web/`,
the Oracle fullscreen on the CRT, and the readout page fullscreen on the second
monitor. Everything runs offline.

## Before the first run (once)

1. Python and Chrome (or Edge) installed. See `docs/WINDOWS_SETUP.md`.
2. **Settings > System > Display**
   - Click the CRT, tick **Make this my main display**. The Oracle opens on the main display.
   - Resolution 1024x768 (or 800x600) on the CRT.
   - **Extend these displays**, not Duplicate.
   - **Scale 100%** on both displays, so the windows land in the right place.
3. **Settings > System > Power**: screen and sleep **Never** when plugged in.
4. **Settings > System > Notifications**: **Do not disturb** on.
5. **Settings > Windows Update**: pause updates for the week of the show.
6. Receipt printer (optional): install its driver, set the paper to 58 mm, and make it
   the **default printer**. The kiosk prints receipts to it without a dialog.

## Run it

Double-click `kiosk\start-kiosk.bat`. To close everything, double-click
`kiosk\stop-kiosk.bat` (or press Alt+F4 in each window).

From PowerShell, the same script takes options:

```powershell
.\kiosk\start-kiosk.ps1                       # start, or restart if already running
.\kiosk\start-kiosk.ps1 -Volume 0.5           # quieter (0 to 1)
.\kiosk\start-kiosk.ps1 -IdleSeconds 60       # back to the boot screen after 60 s with no input
.\kiosk\start-kiosk.ps1 -ListScreens          # the displays Windows reports, numbered
.\kiosk\start-kiosk.ps1 -OracleScreen 1 -ReadoutScreen 0   # pick displays by number
.\kiosk\start-kiosk.ps1 -NoReadout            # only the Oracle
.\kiosk\start-kiosk.ps1 -Stop                 # close everything
.\kiosk\start-kiosk.ps1 -InstallStartup       # start after every log-in (power cut recovery)
```

The readout window opens only once `web/readout.html` exists (roadmap phase 2).

## In kiosk mode

| Key | What it does |
| --- | --- |
| Alt+F4 | Close the window |
| Ctrl+Shift+R | Reload: back to the boot screen |
| Ctrl+M | Mute or unmute the sound |

The page is opened with `?kiosk=1`, which hides the mouse cursor, turns off
right-click and text selection, and sends the Oracle back to the boot screen
when a visitor walks away mid-visit (90 seconds with no key press, `?idle=` to change).

The browser is started with flags that allow sound without a click
(`--autoplay-policy=no-user-gesture-required`), allow the webcam without a
prompt (`--use-fake-ui-for-media-stream`) and print without a dialog
(`--kiosk-printing`). Each window uses its own browser profile under
`%LOCALAPPDATA%\CrtOracle`, so your normal Chrome is untouched.

## If something goes wrong

- **The Oracle opens on the wrong screen:** make the CRT the main display, or use
  `-ListScreens` and `-OracleScreen`.
- **"Something else is already using port 8000":** run `stop-kiosk.bat`, or start
  with `-Port 8001`.
- **No sound:** check the Windows volume and output device; Ctrl+M may have muted it.
- **The script won't run:** use the `.bat` file; it bypasses PowerShell's script policy
  for this one script.
