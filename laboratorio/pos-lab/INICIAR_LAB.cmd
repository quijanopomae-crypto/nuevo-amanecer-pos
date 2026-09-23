@echo off
setlocal
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instale Node.js LTS.
  pause
  exit /b 1
)
node laboratorio\pos-lab\server.mjs --open
if errorlevel 1 pause
