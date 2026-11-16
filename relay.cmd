@echo off
setlocal
set "relay_result=1"
if not defined RELAY_NODE set "RELAY_NODE=%~dp0tools\node\node.exe"
if not exist "%RELAY_NODE%" (
  echo Set RELAY_NODE to the full path of your portable Node 26 node.exe.
  goto done
)
pushd "%~dp0"
if errorlevel 1 goto done
"%RELAY_NODE%" --import tsx "%~dp0scripts\dev\relay.ts" %*
set "relay_result=%ERRORLEVEL%"
popd
:done
if not "%relay_result%"=="0" pause
exit /b %relay_result%
