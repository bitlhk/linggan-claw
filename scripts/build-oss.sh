#!/usr/bin/env bash
set -euo pipefail

# build-oss.sh — 从主版本生成开源发布版
# 用法: bash scripts/build-oss.sh [输出目录]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="${1:-/root/linggan-platform-oss}"

echo "📦 源目录: $SRC_DIR"
echo "📤 输出到: $OUT_DIR"

if [[ -d "$OUT_DIR" ]]; then
  echo "⚠️  输出目录已存在，先清空..."
  rm -rf "$OUT_DIR"
fi

mkdir -p "$OUT_DIR"

# ── 1. 复制代码（排除敏感和临时文件）──
rsync -a --exclude-from=- "$SRC_DIR/" "$OUT_DIR/" << 'EXCLUDES'
.git
.env
.env.*
!.env.example
node_modules
dist
backups
data
logs
*.bak
*.bak-*
*.bak.*
*.before-*
.tmp_*
*.cjs
nohup.out
.DS_Store
scripts/sync-github.sh
scripts/sync-skills.sh
EXCLUDES

# ── 2. 确保 .env.example 存在 ──
if [[ ! -f "$OUT_DIR/.env.example" ]]; then
  cp "$SRC_DIR/.env.example" "$OUT_DIR/.env.example" 2>/dev/null || true
fi

# ── 3. 写入 LICENSE (MIT) ──
if [[ ! -f "$OUT_DIR/LICENSE" ]]; then
cat > "$OUT_DIR/LICENSE" << 'LICENSE'
MIT License

Copyright (c) 2026 LingganClaw Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
LICENSE
fi

# ── 4. 初始化干净的 git 仓库 ──
cd "$OUT_DIR"
git init
git add -A
git commit -m "feat: initial open-source release of LingganClaw platform"

echo ""
echo "✅ 开源版已生成: $OUT_DIR"
echo "   文件数: $(find . -type f | wc -l)"
echo "   大小:   $(du -sh . | cut -f1)"
echo ""
echo "下一步："
echo "  cd $OUT_DIR"
echo "  cp .env.example .env  # 编辑配置"
echo "  pnpm install"
echo "  pnpm db:push"
echo "  pnpm start"
