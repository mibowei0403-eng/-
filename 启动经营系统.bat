@echo off
cd /d "%~dp0"
title Rental Business System

echo Starting rental business system...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest 'http://127.0.0.1:4173/business-dashboard.html' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Server is already running.
  echo Opening dashboard...
  start "" "http://127.0.0.1:4173/business-dashboard.html"
  echo.
  echo You can close this window.
  pause
  exit /b 0
)

start "Rental Business System Server" /min node business-dashboard-server.js

echo Waiting for server...
set "READY=0"
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest 'http://127.0.0.1:4173/business-dashboard.html' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "READY=1"
    goto :open
  )
  timeout /t 1 >nul
)

:open
if "%READY%"=="1" (
  echo Server started successfully.
  echo Opening dashboard...
  start "" "http://127.0.0.1:4173/business-dashboard.html"
) else (
  echo Server did not respond after 30 seconds.
  echo Please keep this window open and tell Codex what it shows.
)

echo.
pause
