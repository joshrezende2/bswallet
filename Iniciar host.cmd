@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "APP_URL=http://127.0.0.1:5173/"
set "LAN_URL=http://10.10.10.192:5173/"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js e npm nao foram encontrados neste computador.
  echo Instale Node.js 22.12 ou mais recente e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet) { exit 0 }; exit 1"
if not errorlevel 1 goto abrir_app

if not exist "node_modules\.bin\vite.cmd" (
  echo Instalando dependencias pela primeira vez...
  call npm.cmd install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo Nao foi possivel instalar as dependencias do BS Wallet.
    echo.
    pause
    exit /b 1
  )
)

echo Iniciando o host local do BS Wallet...
echo Para outro dispositivo nesta rede, use: %LAN_URL%
start "BS Wallet - host local" /D "%~dp0" cmd /k "npm.cmd run dev"

powershell -NoProfile -Command "$limit=(Get-Date).AddSeconds(30); while ((Get-Date) -lt $limit) { if (Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo.
  echo O host nao ficou disponivel em 30 segundos.
  echo Consulte a janela "BS Wallet - host local" para ver o erro.
  echo.
  pause
  exit /b 1
)

:abrir_app
start "" "%APP_URL%"
exit /b 0
