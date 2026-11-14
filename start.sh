#!/usr/bin/env bash
set -e
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 18 或更高版本： https://nodejs.org"
  exit 1
fi
echo "DiskLens 正在启动，浏览器会自动打开。按 Ctrl+C 停止服务。"
exec node server.js --open
