@echo off
setlocal
cd /d "%~dp0"

echo Starting Manzil backend on http://localhost:3000 ...
start "Manzil Backend" cmd /k "cd /d %~dp0 && npm.cmd start"

echo Waiting for the backend to boot...
timeout /t 4 /nobreak >nul

echo Opening dashboard...
start "" "http://localhost:3000/dashboard.html"
