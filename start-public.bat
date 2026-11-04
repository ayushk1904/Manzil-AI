@echo off
rem Double-click this to start Manzil AI with a temporary public link. Anyone with the link can use it.
rem Close both windows to take it offline. The link changes every time.
cd /d "%~dp0"
set "PY=python"
if exist "%USERPROFILE%\.venv\Scripts\python.exe" set "PY=%USERPROFILE%\.venv\Scripts\python.exe"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
set "TUNNEL=cloudflared"
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "TUNNEL=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
start "Manzil AI" "%PY%" main.py --no-browser
echo.
echo Your public link is the https://....trycloudflare.com address printed below.
echo.
"%TUNNEL%" tunnel --url http://127.0.0.1:8000
if errorlevel 1 pause
