@echo off
TITLE Offline CTF Server - Workshop Arena
COLOR 0A
cd /d "%~dp0"

echo ===================================================
echo   OFFLINE CTF SERVER LAUNCHER - WORKSHOP PLATFORM
echo ===================================================
echo Checking Python installation...

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not found in your system PATH!
    echo Please install Python 3.10+ and check "Add Python to PATH".
    pause
    exit /b 1
)

echo Starting Server...
python server.py
if errorlevel 1 (
    echo [!] Server exited with an error.
    pause
)
