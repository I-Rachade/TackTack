@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TackTack

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte die LTS-Version von https://nodejs.org installieren und diese Datei erneut starten.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist .env copy .env.example .env >nul

if not exist node_modules (
  echo Installiere TackTack, das dauert beim ersten Mal ein bis zwei Minuten...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Installation fehlgeschlagen, siehe Meldung oben.
    pause
    exit /b 1
  )
)

echo.
echo TackTack laeuft auf http://localhost:3000
echo Zum Beenden dieses Fenster schliessen.
echo.
start "" http://localhost:3000
node --env-file-if-exists=.env src/index.js
pause
