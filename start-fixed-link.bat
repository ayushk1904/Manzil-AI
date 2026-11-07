@echo off
rem Double-click this to start Manzil AI on your fixed ngrok address, set as NGROK_DOMAIN in .env.
rem Anyone with the link can use the app. Close both windows to take it offline.
cd /d "%~dp0"

set "NGROK_DOMAIN="
if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="NGROK_DOMAIN" set "NGROK_DOMAIN=%%B"
  )
)
if not defined NGROK_DOMAIN (
  echo NGROK_DOMAIN is missing from your .env file.
  echo Add a line like this, with the free domain from https://dashboard.ngrok.com/domains :
  echo   NGROK_DOMAIN=your-name.ngrok-free.app
  pause
  exit /b 1
)

rem Windows only finds ngrok in windows opened after it was installed, so look in winget's folder too.
set "NGROK=ngrok"
where ngrok >nul 2>nul
if errorlevel 1 set "NGROK=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
if not "%NGROK%"=="ngrok" if not exist "%NGROK%" (
  echo ngrok isn't installed. Install it with:  winget install ngrok.ngrok
  echo Then connect your account once with:     ngrok config add-authtoken YOUR_TOKEN
  pause
  exit /b 1
)

set "PY=python"
if exist "%USERPROFILE%\.venv\Scripts\python.exe" set "PY=%USERPROFILE%\.venv\Scripts\python.exe"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
start "Manzil AI" "%PY%" main.py --no-browser

echo.
echo Manzil AI will be live at:  https://%NGROK_DOMAIN%
echo It can take about a minute after this window opens, while the app loads.
echo.
rem --domain works in old and new ngrok versions. Newer ones also accept --url.
"%NGROK%" http --domain=%NGROK_DOMAIN% 8000
if errorlevel 1 pause
