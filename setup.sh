#!/usr/bin/env bash
set -euo pipefail

# LingganClaw 一键配置脚本
# 用法: bash setup.sh

echo ""
echo "  🦐 LingganClaw 灵虾 — 初始化配置"
echo "  ─────────────────────────────────"
echo ""

ENV_FILE=".env"

if [[ -f "$ENV_FILE" ]]; then
  echo "⚠️  检测到已有 .env 文件。"
  read -rp "覆盖？(y/N) " overwrite
  if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
    echo "跳过配置，使用已有 .env"
    exit 0
  fi
fi

# 生成随机密钥
gen_secret() { openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64; }

echo "📝 请输入以下配置（直接回车使用默认值）："
echo ""

read -rp "  应用端口 [5180]: " PORT
PORT=${PORT:-5180}

read -rp "  MySQL 密码 [linggan123]: " MYSQL_PWD
MYSQL_PWD=${MYSQL_PWD:-linggan123}

read -rp "  你的域名（留空则用 localhost）: " DOMAIN
DOMAIN=${DOMAIN:-}

JWT_SECRET=$(gen_secret)

if [[ -n "$DOMAIN" ]]; then
  FRONTEND_URL="https://$DOMAIN"
  CORS_ORIGIN="https://$DOMAIN,https://www.$DOMAIN"
  COOKIE_DOMAIN=".$DOMAIN"
  DEMO_DOMAIN="demo.$DOMAIN"
else
  FRONTEND_URL="http://localhost:$PORT"
  CORS_ORIGIN="http://localhost:$PORT"
  COOKIE_DOMAIN=""
  DEMO_DOMAIN=""
fi

read -rp "  OpenClaw Gateway Token（留空则自动生成）: " GW_TOKEN
if [[ -z "$GW_TOKEN" ]]; then
  GW_TOKEN=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)
fi

cat > "$ENV_FILE" << ENVEOF
# ── LingganClaw 配置（由 setup.sh 生成）──
PORT=$PORT
NODE_ENV=production

# 域名
FRONTEND_URL=$FRONTEND_URL
CORS_ORIGIN=$CORS_ORIGIN
COOKIE_DOMAIN=$COOKIE_DOMAIN

# 数据库（Docker Compose 模式下自动连接容器内 MySQL）
DATABASE_URL=mysql://root:$MYSQL_PWD@db:3306/linggan
MYSQL_ROOT_PASSWORD=$MYSQL_PWD

# 认证
JWT_SECRET=$JWT_SECRET

# OpenClaw
CLAW_PROVISION_MODE=local-script
CLAW_CHAT_MODE=local-openclaw
CLAW_OPENCLAW_HOME=/root
CLAW_REMOTE_OPENCLAW_HOME=/root
CLAW_GATEWAY_PORT=18789
CLAW_GATEWAY_TOKEN=$GW_TOKEN

# 灵虾子域名
LINGGAN_CLAW_BASE_DOMAIN=$DEMO_DOMAIN
LINGGAN_CLAW_ENTRY_SCHEME=https
DEMO_ROUTE_DOMAIN=$DEMO_DOMAIN

# 沙箱
SANDBOX_IMAGE=python:3.11-slim
SANDBOX_MEMORY=256m
SANDBOX_CPUS=0.5
SANDBOX_PIDS_LIMIT=50
SANDBOX_TMPFS_SIZE=50m
SANDBOX_EXEC_TIMEOUT_MS=10000
SANDBOX_MAX_OUTPUT_BYTES=65536
SANDBOX_MAX_GLOBAL=5
SANDBOX_MAX_PER_USER=2
ENVEOF

echo ""
echo "✅ 配置已写入 .env"
echo ""
echo "📋 下一步："
echo ""
echo "  方式一：Docker Compose 一键启动（推荐）"
echo "    docker compose up -d"
echo ""
echo "  方式二：手动启动（需自备 MySQL）"
echo "    # 修改 .env 中的 DATABASE_URL 指向你的 MySQL"
echo "    pnpm install"
echo "    pnpm db:push"
echo "    pnpm build"
echo "    pnpm start"
echo ""
echo "  服务地址: $FRONTEND_URL"
echo "  Gateway Token: $GW_TOKEN"
echo ""
