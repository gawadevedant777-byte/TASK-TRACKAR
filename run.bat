@echo off
setlocal
title TaskFlow - Task Tracker ^& Daily Diary

echo ========================================================
echo    Starting TaskFlow - Task Tracker ^& Daily Diary
echo ========================================================
echo.

:: 1. Terminate any previous server instances to avoid port conflicts
taskkill /F /IM server.exe >nul 2>&1

:: 2. Ensure data directory
if not exist "%~dp0backend\data" mkdir "%~dp0backend\data"

:: 3. Check if server.exe exists, compile if missing
cd /d "%~dp0backend"
if not exist "server.exe" (
    echo [INFO] server.exe not found. Compiling with g++...
    g++ -std=c++14 -O2 -I"include" -I"src" "src\main.cpp" -o "server.exe" -lws2_32 -static-libgcc -static-libstdc++
    if errorlevel 1 (
        echo [ERROR] Compilation failed! Please verify MinGW g++ is installed and on PATH.
        pause
        exit /b 1
    )
    echo [OK] Compiled successfully.
)

:: 4. Open the browser
echo [INFO] Opening TaskFlow in your default web browser...
start http://localhost:8080

:: 5. Launch the server
echo [INFO] TaskFlow backend listening on port 8080...
echo [INFO] Press Ctrl+C to stop the server.
echo.
server.exe

pause
