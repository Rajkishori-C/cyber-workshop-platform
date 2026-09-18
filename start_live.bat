@echo off
TITLE Cyber Workshop Arena - Live Host
COLOR 0B
cd /d "%~dp0"

echo ======================================================================
echo          CYBER WORKSHOP ARENA - ONE-CLICK LIVE LAUNCHER
echo ======================================================================
echo.
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in your PATH!
    pause
    exit /b 1
)

python start_live.py
pause
