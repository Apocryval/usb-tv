@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python studio.py %*
) else (
  py -3 studio.py %*
)
pause
