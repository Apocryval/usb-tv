@echo off
setlocal
if exist "%~dp0.local\venv\Scripts\python.exe" (
  "%~dp0.local\venv\Scripts\python.exe" -B "%~dp0scripts\sync_videos.py" %*
) else (
  py -3 -B "%~dp0scripts\sync_videos.py" %*
)
if errorlevel 1 (
  echo.
  echo Tape Exchange stopped. Read the error above. Python 3.10 or later is required.
)
pause
