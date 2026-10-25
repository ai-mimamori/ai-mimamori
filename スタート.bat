@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js が、このPCに入っていません。
  echo 最初の1回だけ https://nodejs.org の LTS を入れてください。
  echo 入ったあと、このファイルをもう一度開きます。
  echo.
  pause
  exit /b 1
)

echo.
echo AIみまもりを、このPCの中だけで起動します。
echo 社内LANにもインターネットにも出ません。
echo 止めるときは、この黒い窓を閉じてください。
echo.

start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:3780"
node server.js
echo.
pause
