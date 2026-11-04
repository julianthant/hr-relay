@echo off
setlocal
if not defined RELAY_NODE set "RELAY_NODE=%~dp0tools\node\node.exe"
if not exist "%RELAY_NODE%" (
  echo Set RELAY_NODE to the full path of your portable Node 26 node.exe.
  exit /b 1
)
pushd "%~dp0"
"%RELAY_NODE%" --import tsx "%~dp0scripts\dev\relay.ts" %*
set "relay_result=%ERRORLEVEL%"
popd
exit /b %relay_result%
