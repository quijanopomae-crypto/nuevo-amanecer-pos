@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instale Node.js LTS desde nodejs.org.
  pause
  exit /b 1
)
node tools\pos-local\server.mjs --open
if errorlevel 1 pause
