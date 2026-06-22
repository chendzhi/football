#!/bin/bash
# Football Prediction System — 一键部署脚本
# 服务器: 47.108.158.35 (宝塔Linux面板)
set -e

echo "========================================="
echo " Football Prediction System Deployment"
echo "========================================="

# 1. 安装 Node.js 20 (如果没装)
if ! command -v node &> /dev/null; then
    echo "[1/8] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 2. 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "[2/8] Installing PM2..."
    npm install -g pm2
fi

# 3. 安装 tsx (快速TypeScript运行器)
npm install -g tsx

# 4. 创建目录
echo "[3/8] Creating directories..."
mkdir -p /www/wwwroot/football/logs

# 5. 克隆代码 (如果已存在则更新)
if [ -d "/www/wwwroot/football/.git" ]; then
    echo "[4/8] Updating code..."
    cd /www/wwwroot/football
    git pull origin master
else
    echo "[4/8] Cloning code..."
    cd /www/wwwroot
    git clone https://github.com/chendzhi/football.git
    cd football
fi

# 6. 安装依赖
echo "[5/8] Installing backend dependencies..."
cd /www/wwwroot/football/backend
npm install

echo "[6/8] Installing frontend dependencies..."
cd /www/wwwroot/football/frontend
npm install

# 7. 初始化数据库
echo "[7/8] Setting up database..."
cd /www/wwwroot/football/backend
npx prisma generate
npx prisma db push

# 8. 构建前端 + 启动
echo "[8/8] Building frontend..."
cd /www/wwwroot/football/frontend
npx vite build --outDir dist

echo "Starting services..."
cd /www/wwwroot/football
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

echo ""
echo "========================================="
echo " Deployment Complete!"
echo " Frontend: http://47.108.158.35"
echo " Backend:  http://47.108.158.35:3000"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. 在宝塔面板 → 网站 → 添加站点 → 47.108.158.35"
echo "2. 网站目录指向: /www/wwwroot/football/frontend/dist"
echo "3. 添加反向代理: /api → http://127.0.0.1:3000"
echo "4. 访问前端: http://47.108.158.35"
