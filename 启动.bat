@echo off
chcp 65001 >nul
title DiskLens 磁盘空间可视化清理
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   未检测到 Node.js，请先安装 Node.js 18 或更高版本： https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo.
echo   DiskLens 正在启动，浏览器会自动打开。
echo   关闭本窗口或按 Ctrl+C 即可停止服务。
echo.
node server.js --open
pause
