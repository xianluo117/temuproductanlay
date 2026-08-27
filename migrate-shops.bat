@echo off
setlocal
cd /d "%~dp0"

echo Initializing database schema...
call npm run build -w @temu-analytics/shared
if errorlevel 1 goto :failed
call npm run build -w @temu-analytics/server
if errorlevel 1 goto :failed
call node apps\server\dist\database\migrate-shops.js
if errorlevel 1 goto :failed

echo.
echo Database schema initialization completed successfully.
pause
exit /b 0

:failed
echo.
echo Database schema initialization failed. Review the error above.
pause
exit /b 1
