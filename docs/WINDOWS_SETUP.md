# Setting up CRT Oracle on Windows

These steps get the starter running on the laptop with no hardware attached. Run the commands in PowerShell. Windows Terminal is best, because it shows the green text colours.

## 1. Install the tools

1. Install Python 3.10 or newer from [python.org/downloads](https://www.python.org/downloads/). In the installer, tick **Add python.exe to PATH**.
2. Install Git from [git-scm.com/download/win](https://git-scm.com/download/win). The default options are fine.
3. Open a new PowerShell window and check both:

   ```powershell
   python --version
   git --version
   ```

## 2. Get the code

```powershell
cd $HOME\Documents
git clone https://github.com/<your-username>/crt-oracle.git
cd crt-oracle
```

## 3. Install and test

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
python -m pytest
```

You should see `26 passed`. If PowerShell refuses to run `Activate.ps1`, run this once and try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 4. Run it

```powershell
python -m oracle --demo   # scripted visit, writes a receipt into out\
python -m oracle          # play it yourself
```

Each time you open a new PowerShell window, `cd` into the folder and run `.\.venv\Scripts\Activate.ps1` first.

## 5. When the capture adapter arrives

```powershell
pip install -e ".[camera]"
python tools\list_cameras.py
```

The laptop's built-in webcam is usually camera 0, so the adapter is often camera 1. Set that number as `camera.device_index` in `config.yaml`, and set `camera.backend: opencv`. Keep the camcorder switched on with its yellow RCA plug in the adapter.

## 6. Connecting the CRT

The CRT takes VGA only. Use the laptop's VGA port if it has one, otherwise an **active** HDMI-to-VGA adapter (a plain cable won't work). In Windows, open **Settings > System > Display**, pick the CRT, and choose a 4:3 resolution such as 1024x768 or 800x600. If the screen goes black, Windows reverts after 15 seconds; try a lower resolution.
