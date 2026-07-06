@echo off
title AuraFlare exe builder
REM ——— Builds AuraFlare.exe via Node Single Executable Application (SEA) ———
REM Requires Node 20+ on Windows. Run from the project root.
cd /d "%~dp0"

echo [1/5] Building web app + standalone server bundle...
call npm run build:standalone || goto :err

echo [2/5] Writing SEA config...
> sea-config.json echo {"main":"dist/auraflare.cjs","output":"dist/sea-prep.blob","disableExperimentalSEAWarning":true}

echo [3/5] Generating SEA blob...
node --experimental-sea-config sea-config.json || goto :err

echo [4/5] Copying Node runtime...
node -e "require('fs').copyFileSync(process.execPath,'AuraFlare.exe')" || goto :err

echo [5/5] Injecting AuraFlare into the executable...
call npx --yes postject AuraFlare.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 || goto :err

echo.
echo   Done! AuraFlare.exe created.
echo   Keep it next to the dist\ folder (and .env.local for AI features).
echo   Note: unsigned exe - Windows SmartScreen may ask once ("More info" - "Run anyway").
echo.
pause
goto :eof
:err
echo Build failed - see output above.
pause
