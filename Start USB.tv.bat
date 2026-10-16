@echo off
cd /d "%~dp0"
if exist "Apps\windows-x64\USBtv.exe" (
  "Apps\windows-x64\USBtv.exe" --library-root "%~dp0." %*
) else (
  py -3 server.py --library-root "%~dp0." %*
  if errorlevel 1 (
    echo USB.tv is not built for this computer yet. Run build.py on 64-bit Windows to create its bundled app.
    pause
  )
)
