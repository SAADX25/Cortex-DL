@echo off
setlocal DisableDelayedExpansion
title Cortex DL - Development

for %%D in ("%~dp0app" "%~dp0Cortex DL\app" "G:\Cortex DL\app" "G:\Cortex DL\Cortex DL\app") do (
    if exist "%%~D\package.json" (
        set "APP_DIR=%%~fD"
        goto :start_app
    )
)
echo [Cortex DL] Could not locate app\package.json.
pause
exit /b 1

:start_app
pushd "%APP_DIR%"
if errorlevel 1 exit /b 1
echo [Cortex DL] App Directory: %CD%
where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_node
if not exist "node_modules\vite\bin\vite.js" (
    echo [Cortex DL] Dependencies are missing. Run npm ci in this directory first.
    popd
    pause
    exit /b 1
)
echo [Cortex DL] Starting development mode...
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" (
    echo [Cortex DL] Development stopped with code %EXIT_CODE%.
    pause
)
endlocal & exit /b %EXIT_CODE%

:missing_node
echo [Cortex DL] Node.js or npm is missing from PATH.
popd
pause
exit /b 1
