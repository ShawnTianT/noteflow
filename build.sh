#!/bin/bash
# Noteflow 发布脚本
# 将源文件复制到 dist/ + docs/，可选推送到 GitHub
# 使用方法：
#   bash build.sh          → 只更新 dist/ + docs/
#   bash build.sh push     → 更新 + 自动 git push
#   bash build.sh push "修复标签bug"  → 更新 + push 并指定提交信息

DIST_DIR="dist"
DOCS_DIR="docs"
SRC_DIR="."

# 读取参数
PUSH_MODE=false
COMMIT_MSG=""

for arg in "$@"; do
  case $arg in
    push) PUSH_MODE=true ;;
    *) COMMIT_MSG="$arg" ;;
  esac
done

echo "📦 正在发布 Noteflow..."

# 读取版本号
VERSION=$(cat VERSION 2>/dev/null | tr -d '\n' || echo "unknown")
echo "   版本: $VERSION"

# 同步函数：将源文件复制到目标目录
sync_to_dir() {
  local TARGET="$1"
  rm -rf "$TARGET/css" "$TARGET/js" "$TARGET/libs" "$TARGET/utils" "$TARGET/data" "$TARGET/mobile" "$TARGET/index.html" "$TARGET/VERSION" 2>/dev/null
  cp -r "$SRC_DIR/css" "$TARGET/"
  cp -r "$SRC_DIR/js" "$TARGET/"
  cp -r "$SRC_DIR/data" "$TARGET/"
  cp -r "$SRC_DIR/libs" "$TARGET/" 2>/dev/null
  cp -r "$SRC_DIR/utils" "$TARGET/" 2>/dev/null
  cp "$SRC_DIR/index.html" "$TARGET/"
  cp "$SRC_DIR/VERSION" "$TARGET/"
  mkdir -p "$TARGET/data/images"

  # 手机端：复制 mobile/ 目录
  cp -r "$SRC_DIR/mobile" "$TARGET/"

  # 注意：mobile/index.html 中共享 JS 文件（db-supabase.js 等）保持 ../js/ 路径
  # 指向父目录的 js/，不改为 ./js/（mobile/js/ 下只有 app.js）
  # 修正 mobile/index.html 中 app.js 的引用（源码是 js/app.js，构建后应为 js/app.js，已正确）
  :
}

# 1. 同步到 dist/（本地服务器用）
sync_to_dir "$DIST_DIR"
echo "   ✅ dist/ 已更新"

# 2. 同步到 docs/（GitHub Pages 用）
sync_to_dir "$DOCS_DIR"
echo "   ✅ docs/ 已更新"

echo "✅ 发布完成！版本 $VERSION"

# 3. 如果带 push 参数，自动提交并推送到 GitHub
if [ "$PUSH_MODE" = true ]; then
  echo ""
  echo "🚀 正在推送到 GitHub..."

  cd "$(dirname "$0")"

  # 默认提交信息
  if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="v$VERSION"
  fi

  git add "$DIST_DIR/" "$DOCS_DIR/" index.html css/ js/ utils/ mobile/ VERSION AGENTS.md
  git commit -m "$COMMIT_MSG"
  git push origin main

  echo "✅ 已推送到 GitHub！线上版本将自动更新"
  echo "   🌐 https://shawntiant.github.io/noteflow/"
fi
