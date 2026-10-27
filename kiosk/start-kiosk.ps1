<#
.SYNOPSIS
  Starts the CRT Oracle for the exhibit: a local web server, the Oracle fullscreen
  on the main display (the CRT), and the readout page fullscreen on the second display.

.DESCRIPTION
  Double-click start-kiosk.bat, or run in PowerShell:

    .\kiosk\start-kiosk.ps1                  # start (or restart) everything
    .\kiosk\start-kiosk.ps1 -Stop            # close the kiosk windows and the server
    .\kiosk\start-kiosk.ps1 -ListScreens     # show the displays Windows reports
    .\kiosk\start-kiosk.ps1 -InstallStartup  # start it on its own after you log in

  The Oracle goes on the display Windows calls the main display: in
  Settings > System > Display, pick the CRT and tick "Make this my main display".
  Keep Scale at 100% on both displays so the windows land where they should.

  Alt+F4 closes a kiosk window. Ctrl+Shift+R reloads it (back to the boot screen).
#>
[CmdletBinding()]
param(
  [int]$Port = 8000,
  [double]$Volume = 0.7,
  [int]$IdleSeconds = 90,
  # The page for the second display, relative to web\. Skipped until it exists.
  [string]$Readout = "readout.html",
  # Screen numbers as -ListScreens prints them. -1 = the main display / the first other one.
  [int]$OracleScreen = -1,
  [int]$ReadoutScreen = -1,
  [switch]$NoReadout,
  [switch]$Stop,
  [switch]$ListScreens,
  [switch]$InstallStartup
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Web = Join-Path $Root "web"
$ProfileRoot = Join-Path $env:LOCALAPPDATA "CrtOracle"
$OracleProfile = Join-Path $ProfileRoot "oracle-window"
$ReadoutProfile = Join-Path $ProfileRoot "readout-window"

function Say($text) { Write-Host "[crt-oracle] $text" }

# --- screens ------------------------------------------------------------------------

Add-Type -AssemblyName System.Windows.Forms
# Real pixel positions, not the ones Windows scales for old programs.
if (-not ("CrtOracle.Dpi" -as [type])) {
  Add-Type -Namespace CrtOracle -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
}
[void][CrtOracle.Dpi]::SetProcessDPIAware()
$Screens = @([System.Windows.Forms.Screen]::AllScreens)

if ($ListScreens) {
  for ($i = 0; $i -lt $Screens.Count; $i++) {
    $s = $Screens[$i]
    $b = $s.Bounds
    $main = if ($s.Primary) { "  (main display)" } else { "" }
    Say ("screen {0}: {1}x{2} at {3},{4}  {5}{6}" -f $i, $b.Width, $b.Height, $b.X, $b.Y, $s.DeviceName, $main)
  }
  return
}

function Pick-Screen([int]$index, [bool]$primary) {
  if ($index -ge 0) {
    if ($index -ge $Screens.Count) { throw "There is no screen $index. Run with -ListScreens to see them." }
    return $Screens[$index]
  }
  $match = @($Screens | Where-Object { $_.Primary -eq $primary })
  if ($match.Count -gt 0) { return $match[0] }
  return $null
}

# --- start with Windows ---------------------------------------------------------------

if ($InstallStartup) {
  $startup = [Environment]::GetFolderPath("Startup")
  $link = Join-Path $startup "CRT Oracle.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = Join-Path $PSScriptRoot "start-kiosk.bat"
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7 # minimised
  $shortcut.Save()
  Say "The Oracle now starts after you log in. To undo, delete: $link"
  return
}

# --- stop what is already running -------------------------------------------------------

function Stop-Kiosk {
  $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe' OR Name='python.exe' OR Name='py.exe' OR Name='pythonw.exe'"
  foreach ($p in $procs) {
    $cmd = [string]$p.CommandLine
    if ($cmd.Contains($ProfileRoot) -or ($cmd -match "http\.server" -and $cmd.Contains($Web))) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

Stop-Kiosk
Start-Sleep -Milliseconds 500
if ($Stop) {
  Say "Stopped."
  return
}

# --- the local web server ----------------------------------------------------------------

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect("127.0.0.1", $port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (Test-Port $Port) {
  throw "Something else is already using port $Port. Close it, or run with -Port 8001."
}

$python = $null
foreach ($name in @("py", "python")) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { $python = $cmd.Source; break }
}
if (-not $python) { throw "Python not found. Install it from python.org (tick 'Add python.exe to PATH')." }

Say "Starting the local server on http://localhost:$Port"
Start-Process -FilePath $python -WindowStyle Hidden -ArgumentList @(
  "-m", "http.server", "$Port", "--bind", "127.0.0.1", "--directory", "`"$Web`""
)
for ($i = 0; $i -lt 50 -and -not (Test-Port $Port); $i++) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Port $Port)) { throw "The local server did not start on port $Port." }

# --- the browser -------------------------------------------------------------------------

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { throw "Neither Chrome nor Edge was found." }

function Start-KioskWindow([string]$url, [string]$profileDir, $screen) {
  $b = $screen.Bounds
  $flags = @(
    "--user-data-dir=`"$profileDir`"",
    "--window-position=$($b.X),$($b.Y)",
    "--window-size=$($b.Width),$($b.Height)",
    "--kiosk",
    "--edge-kiosk-type=fullscreen",               # Edge only; Chrome ignores it
    "--autoplay-policy=no-user-gesture-required", # the hum starts without a key press
    "--use-fake-ui-for-media-stream",             # allow the webcam without asking
    "--kiosk-printing",                           # receipts go straight to the default printer
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--noerrdialogs",
    "--disable-pinch",
    "--overscroll-history-navigation=0",
    "--disable-features=Translate,TranslateUI",
    $url
  )
  Start-Process -FilePath $browser -ArgumentList $flags
}

$oracleScreen = Pick-Screen $OracleScreen $true
if (-not $oracleScreen) { $oracleScreen = $Screens[0] }
$vol = $Volume.ToString([Globalization.CultureInfo]::InvariantCulture)
$oracleUrl = "http://localhost:$Port/?kiosk=1&volume=$vol&idle=$IdleSeconds"
Say "Oracle on $($oracleScreen.DeviceName): $oracleUrl"
Start-KioskWindow $oracleUrl $OracleProfile $oracleScreen

if (-not $NoReadout) {
  $readoutScreen = Pick-Screen $ReadoutScreen $false
  if ($readoutScreen -and $readoutScreen.DeviceName -eq $oracleScreen.DeviceName) { $readoutScreen = $null }
  if (-not (Test-Path (Join-Path $Web $Readout))) {
    Say "No readout page yet (web\$Readout); the second display stays as it is."
  } elseif (-not $readoutScreen) {
    Say "Only one display found; skipping the readout window."
  } else {
    $readoutUrl = "http://localhost:$Port/$Readout`?kiosk=1"
    Say "Readout on $($readoutScreen.DeviceName): $readoutUrl"
    Start-Sleep -Seconds 1 # let the Oracle window settle first
    Start-KioskWindow $readoutUrl $ReadoutProfile $readoutScreen
  }
}

Say "Running. Alt+F4 closes a window; .\kiosk\start-kiosk.ps1 -Stop closes everything."
