@echo off
rem Double-click to close the CRT Oracle kiosk windows and its local server.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-kiosk.ps1" -Stop
