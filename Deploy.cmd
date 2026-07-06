@echo off
title AuraFlare - Deploy to Cloudflare
cd /d "%~dp0"
echo ================================================
echo   Deploying AuraFlare to aura.massivenumber.com
echo ================================================
echo.
echo [1/2] Ensuring dependencies (installs wrangler if needed)...
call npm install || goto :err
echo.
echo [2/2] Building web app + deploying Worker...
echo   If this is your first deploy, a browser window will open to
echo   authorize Wrangler with Cloudflare - click Allow, then it continues.
echo.
call npm run deploy:cf || goto :err
echo.
echo ================================================
echo   Done. Your site should be live at:
echo   https://aura.massivenumber.com
echo ================================================
pause
goto :eof
:err
echo.
echo [ERROR] A step failed - see the messages above.
echo If it says you are not logged in, run:  npx wrangler login
pause
