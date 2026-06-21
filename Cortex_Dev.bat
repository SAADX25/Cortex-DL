@echo off
setlocal
title Cortex DL - Development

cd /d "%~dp0app"
if errorlevel 1 goto :bad_app_dir

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_npm

if not exist "package.json" goto :missing_package

if not exist "node_modules\.package-lock.json" (
  echo [Cortex DL] Installing dependencies...
  call npm ci
  if errorlevel 1 goto :install_failed
)

echo [Cortex DL] Starting development mode...
echo.
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" goto :end
echo.
echo [Cortex DL] Development server stopped with error code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

:bad_app_dir
echo [Cortex DL] Could not open the app directory.
goto :fail

:missing_node
echo [Cortex DL] Node.js is not installed or is not available in PATH.
goto :fail

:missing_npm
echo [Cortex DL] npm is not installed or is not available in PATH.
goto :fail

:missing_package
echo [Cortex DL] app\package.json is missing.
goto :fail

:install_failed
echo [Cortex DL] Dependency installation failed.
goto :fail

:fail
pause
exit /b 1

:end
endlocal
