@echo off
chcp 65001 >nul
title WASHER GAMES - City Bot
cd /d "%~dp0"

if not exist ".env" (
  echo.
  echo [ERRO] O arquivo .env nao existe.
  echo Copie .env.example, renomeie para .env e configure.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando WASHER GAMES Bot...
echo.
node src/index.js
pause
