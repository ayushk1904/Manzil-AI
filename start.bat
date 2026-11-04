@echo off
rem Double-click this to start CareerPilot. It opens your browser by itself.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" step9_web_ui.py
) else if exist "%USERPROFILE%\.venv\Scripts\python.exe" (
  "%USERPROFILE%\.venv\Scripts\python.exe" step9_web_ui.py
) else (
  python step9_web_ui.py
)
if errorlevel 1 pause
