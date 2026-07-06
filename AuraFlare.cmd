@echo off
title AuraFlare
cd /d "%~dp0"
echo ============================================
echo   AuraFlare launcher
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install Node.js 20+ from https://nodejs.org then run this again.
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo [1/3] Installing dependencies ^(first run, this takes a few minutes^)...
  call npm install || goto :err
) else (
  echo [1/3] Dependencies present.
)

echo [2/3] Building app + server bundle...
call npm run build:standalone || goto :err

echo [3/3] Starting AuraFlare at http://localhost:3000
start "" http://localhost:3000
node dist\auraflare.cjs
goto :eof

:err
echo.
echo [ERROR] A step failed - see the messages above.
echo If it was the build, try deleting the node_modules folder and running this again.
pause
exit /b 1
