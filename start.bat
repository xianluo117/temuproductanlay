@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
echo [2/3] Building application...
call npm run build
if errorlevel 1 goto :error
echo [3/3] Starting Temu Analytics...
start "" /b node tools\open-browser-when-ready.mjs
:run
call npm start
if "%errorlevel%"=="75" (
  echo Backup restored. Restarting service...
  timeout /t 2 /nobreak >nul
  goto :run
)
if errorlevel 1 goto :error
goto :eof
:error
echo.
echo Startup failed. Review the error above.
pause
exit /b 1
