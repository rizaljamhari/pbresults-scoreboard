@echo off
setlocal
rem Starts the root launcher on any bundled node.exe; the launcher runs the active version on its own runtime.
set "ROOT_DIR=%~dp0"
set "NODE_EXE="
for /d %%V in ("%ROOT_DIR%app" "%ROOT_DIR%versions\*") do if exist "%%~V\node\node.exe" set "NODE_EXE=%%~V\node\node.exe"
if not defined NODE_EXE (
  echo The scoreboard runtime was not found. Extract the portable package again.
  pause
  exit /b 1
)
"%NODE_EXE%" "%ROOT_DIR%pbresults-launcher.mjs" %*
