@echo off
setlocal
if "%~1"=="--worker" goto worker
rem Run a temporary copy so the update can replace this launcher safely.
set "UPDATE_WORKER=%TEMP%\USBtv-update-%RANDOM%-%RANDOM%.bat"
copy /y "%~f0" "%UPDATE_WORKER%" >nul
if errorlevel 1 exit /b 1
start "USB.tv updater" cmd /c ""%UPDATE_WORKER%" --worker "%~dp0." "%~1""
exit /b
:worker
set "UPDATE_ROOT=%~2"
cd /d "%UPDATE_ROOT%"
echo Close USB.tv on this computer before updating.
set "UPDATE_ARCHIVE=%~3"
if not defined UPDATE_ARCHIVE set /p "UPDATE_ARCHIVE=Paste the full path to USBtv-all-platforms.zip, then press Enter: "
set "UPDATE_ARCHIVE=%UPDATE_ARCHIVE:"=%"
if not exist "%UPDATE_ARCHIVE%" (
  echo Update ZIP not found. Use its full path.
  pause
  exit /b 1
)
set "UPDATE_APP=%TEMP%\USBtv-update-%RANDOM%-%RANDOM%.exe"
if exist "Apps\windows-x64\USBtv.exe" (
  rem Windows locks running executables, so update from a temporary copy.
  copy /y "Apps\windows-x64\USBtv.exe" "%UPDATE_APP%" >nul
  if errorlevel 1 exit /b 1
  "%UPDATE_APP%" --library-root "%UPDATE_ROOT%" --update-from "%UPDATE_ARCHIVE%"
) else (
  py -3 server.py --library-root "%UPDATE_ROOT%" --update-from "%UPDATE_ARCHIVE%"
)
set "UPDATE_RESULT=%ERRORLEVEL%"
if exist "%UPDATE_APP%" del "%UPDATE_APP%"
pause
rem This is the disposable worker, not the USB launcher.
del "%~f0" & exit /b %UPDATE_RESULT%
