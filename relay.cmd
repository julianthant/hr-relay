@echo off
setlocal
set "relay_result=1"
set "RELAY_NODE=%~dp0tools\node\node.exe"
if not exist "%RELAY_NODE%" (
  echo Bundled Node is missing. Re-extract the original Relay zip.
  echo Source checkout: node --import tsx scripts/dev/relay.ts
  goto done
)
pushd "%~dp0"
if errorlevel 1 goto done
"%RELAY_NODE%" --import tsx "%~dp0scripts\packaging\relay-bundle.ts" %*
set "relay_result=%ERRORLEVEL%"
popd
:done
if not "%relay_result%"=="0" pause
exit /b %relay_result%
