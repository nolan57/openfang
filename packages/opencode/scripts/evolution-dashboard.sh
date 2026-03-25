#!/bin/bash

# OpenCode Evolution Dashboard Launcher
# 快速启动自进化可视化 Dashboard

set -e

echo "🚀 OpenCode Evolution Dashboard"
echo "================================"
echo ""

# 检查服务器是否已在运行
if curl -s http://localhost:4096/api/evolution/stats > /dev/null 2>&1; then
    echo "✅ 服务器已在运行"
else
    echo "⚙️  启动服务器..."
    cd "$(dirname "$0")/.."
    bun run src/index.ts serve &
    SERVER_PID=$!
    sleep 3
    echo "✅ 服务器已启动 (PID: $SERVER_PID)"
fi

echo ""
echo "📊 Dashboard 访问地址:"
echo "   http://localhost:4096/api/evolution/static/evolution-dashboard.html"
echo ""
echo "📡 API 端点:"
echo "   http://localhost:4096/api/evolution/stats"
echo "   http://localhost:4096/api/evolution/runs"
echo "   http://localhost:4096/api/evolution/notes"
echo ""
echo "💡 提示:"
echo "   - 使用 Ctrl+C 停止服务器"
echo "   - 运行 '/evolve' 命令生成新的进化数据"
echo ""

# 在浏览器中打开 Dashboard
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:4096/api/evolution/static/evolution-dashboard.html"
elif command -v open &> /dev/null; then
    open "http://localhost:4096/api/evolution/static/evolution-dashboard.html"
else
    echo "🌐 请在浏览器中打开上述地址"
fi

# 等待用户退出
wait
