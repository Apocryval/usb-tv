@echo off
cd /d "%~dp0"
if exist "..\.local\venv\Scripts\python.exe" (
  "..\.local\venv\Scripts\python.exe" start_local_ai.py
  if errorlevel 1 (
    pause
    exit /b 1
  )
  "..\.local\venv\Scripts\python.exe" studio.py %*
  pause
  exit /b
)
where py >nul 2>nul
if errorlevel 1 (
  python start_local_ai.py
  if errorlevel 1 exit /b 1
  python studio.py %*
) else (
  py -3 start_local_ai.py
  if errorlevel 1 exit /b 1
  py -3 studio.py %*
)
pause
