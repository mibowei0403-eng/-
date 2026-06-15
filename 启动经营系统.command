#!/bin/zsh
set -e

cd "$(dirname "$0")"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x "/Users/mibowei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  NODE_BIN="/Users/mibowei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  osascript -e 'display dialog "未检测到 Node.js，请先安装 Node.js 后再启动经营系统。" buttons {"知道了"} default button 1'
  exit 1
fi

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/business-dashboard.html"

open "$URL"
echo "经营系统启动中..."
echo "打开地址：$URL"
echo "关闭这个窗口即可停止本地系统。"
echo

PORT="$PORT" "$NODE_BIN" business-dashboard-server.js
