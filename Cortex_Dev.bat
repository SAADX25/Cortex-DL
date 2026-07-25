@echo off
setlocal enabledelayedexpansion
title Cortex DL - Development

:: 1. Check relative path if bat file is in project root
if exist "%~dp0app\package.json" (
    cd /d "%~dp0app"
    goto :start_app
)

:: 2. Check relative path if bat file is in parent workspace folder
if exist "%~dp0Cortex DL\app\package.json" (
    cd /d "%~dp0Cortex DL\app"
    goto :start_app
)

:: 3. Fallback to fixed absolute path on system
if exist "G:\Cortex DL\Cortex DL\app\package.json" (
    cd /d "G:\Cortex DL\Cortex DL\app"
    goto :start_app
)

if exist "G:\Cortex DL\app\package.json" (
    cd /d "G:\Cortex DL\app"
    goto :start_app
)

echo.
echo =========================================================
echo  [ERROR] Could not locate Cortex DL app directory!
echo  Searched in:
echo   - %~dp0app
echo   - %~dp0Cortex DL\app
echo   - G:\Cortex DL\Cortex DL\app
echo =========================================================
echo.
pause
exit /b 1

:start_app
echo [Cortex DL] Found App Directory: %CD%
where node >nul 2>&1
if errorlevel 1 (
    echo [Cortex DL] Node.js is missing or not in PATH!
    pause
    exit /b 1
)

echo [Cortex DL] Starting development mode...
echo.
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" goto :end
echo.
echo [Cortex DL] Development server stopped with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

:end
endlocal
