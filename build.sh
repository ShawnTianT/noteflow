#!/bin/bash
# Noteflow 发布脚本
# 将源文件复制到 dist/ 目录，供 HTTP 服务器提供页面
# 使用方法：bash build.sh

DIST_DIR="dist"
SRC_DIR="."

echo "📦 正在发布 Noteflow..."

# 读取版本号
VERSION=$(cat VERSION 2>/dev/null | tr -d '\n' || echo "unknown")
echo "   版本: $VERSION"

# 清空 dist（保留 images 目录）
rm -rf "$DIST_DIR/css" "$DIST_DIR/js" "$DIST_DIR/libs" "$DIST_DIR/utils" "$DIST_DIR/data" "$DIST_DIR/index.html" "$DIST_DIR/VERSION" 2>/dev/null

# 复制所有文件到 dist
cp -r "$SRC_DIR/css" "$DIST_DIR/"
cp -r "$SRC_DIR/js" "$DIST_DIR/"
cp -r "$SRC_DIR/data" "$DIST_DIR/"
cp -r "$SRC_DIR/libs" "$DIST_DIR/" 2>/dev/null
cp -r "$SRC_DIR/utils" "$DIST_DIR/" 2>/dev/null
cp "$SRC_DIR/index.html" "$DIST_DIR/"
cp "$SRC_DIR/VERSION" "$DIST_DIR/"

# 确保图片目录存在
mkdir -p "$DIST_DIR/data/images"

echo "✅ 发布完成！版本 $VERSION 已部署到 dist/"
