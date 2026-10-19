@echo off
cd /d "%~dp0"
echo USB.tv development mode - running the current Python source.
echo This launcher is for the development folder; the portable USB uses Start USB.tv.bat.
echo.
if exist ".local\venv\Scripts\python.exe" (
  ".local\venv\Scripts\python.exe" -B "src\server.py" --library-root "%~dp0." %*
) else (
  py -3 -B "src\server.py" --library-root "%~dp0." %*
)
if errorlevel 1 (
  echo.
  echo USB.tv development mode could not start. Read the error above.
  echo This mode needs Python 3; it does not use the bundled USBtv.exe.
  pause
  exit /b 1
)
