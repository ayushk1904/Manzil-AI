@echo off
rem Double-click this to start Manzil AI. It opens your browser by itself.
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" main.py
) else if exist "%USERPROFILE%\.venv\Scripts\python.exe" (
  "%USERPROFILE%\.venv\Scripts\python.exe" main.py
) else (
  python main.py
)
if errorlevel 1 pause
