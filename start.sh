#!/bin/bash
# 一键启动音乐播放器
# 用法: ./start.sh

echo "🎵 正在启动音乐播放器..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装: https://nodejs.org"
    exit 1
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install
    echo ""
fi

# 启动服务
echo "🚀 服务已启动！"
echo "📱 在浏览器中打开: http://localhost:3000"
echo "📱 分享给朋友: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止服务"
echo "=========================="

node server.js
