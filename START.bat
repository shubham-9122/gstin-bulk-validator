@echo off
title GSTIN Bulk Validator
color 0A
cd /d "C:\GSTINValidator"

echo.
echo  ============================================================
echo    GSTIN Bulk Validator - GST Portal Automation
echo  ============================================================
echo.

:: Kill any existing node on port 3000
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Open browser after 4 seconds (in background)
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"

echo  Server starting - browser will open automatically...
echo  DO NOT close this window while using the tool.
echo  Press Ctrl+C to stop.
echo.

:: Run node directly in THIS window (blocking)
"C:\Program Files\nodejs\node.exe" "C:\GSTINValidator\server.js"

echo.
echo  Server stopped.
pause
