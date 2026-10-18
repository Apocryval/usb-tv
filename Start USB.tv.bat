@echo off
cd /d "%~dp0"
if exist "Apps\windows-x64\USBtv.exe" (
  "Apps\windows-x64\USBtv.exe" --library-root "%~dp0." %*
  if errorlevel 1 (
    echo USB.tv could not start. Read the error above; Windows may have blocked this build.
    pause
    exit /b 1
  )
) else (
  py -3 src\server.py --library-root "%~dp0." %*
  if errorlevel 1 (
    echo USB.tv is not built for this computer yet. Run scripts\build.py on 64-bit Windows to create its bundled app.
    pause
  )
)
