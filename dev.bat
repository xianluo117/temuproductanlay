@echo off
setlocal
cd /d "%~dp0"
echo Starting development servers...
call npm run dev
