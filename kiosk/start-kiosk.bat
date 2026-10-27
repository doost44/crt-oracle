@echo off
rem Double-click to start the CRT Oracle exhibit. See kiosk\README.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-kiosk.ps1" %*
