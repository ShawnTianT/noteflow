# ⚙️ 给 Claude 的系统指令（每次必读）

你每次读到这个文件，必须遵守以下规则：
1. **对话开始时**：主动汇报当前进度和建议下一步
2. **完成一个功能时**：主动提醒更新 CLAUDE.md
3. **对话结束时**：主动更新本文件的"当前进度"部分
4. **遇到重要决策时**：把决策原因记入"重要决策记录"
5. **发现新 Bug 时**：自动加入 Bug 表格

不要等我提醒，主动执行以上规则。

---

# 🧠 Project Memory — Noteflow

## 📌 项目基本信息
- **项目描述**：类 flomo 本地笔记应用，浏览器内运行，数据存 IndexedDB，支持多设备 Supabase 同步
- **技术栈**：Vue 3 CDN + sql.js / Supabase + IndexedDB
- **项目路径**：`/Users/tianlingxiao/Desktop/知识库/`
- **启动命令**：`bash build.sh` 后 `python3 -m http.server 8765`（或 `open dist/index.html`）
- **线上地址**：https://shawntiant.github.io/noteflow/
- **最后更新**：2026-05-08

---

## 🎯 当前目标
> 本阶段要完成的核心任务（每次更新）

- [ ] 更新 AGENTS.md 使版本/标签正则与代码一致（v1.3.2 落后）
- [x] 修复标签连字符解析（`#复盘-周/小确幸` → 一级"复盘-周"二级"小确幸"）
- [x] PC端发布区改为右下角浮动按钮+弹窗
- [x] 修复手机端 JS 404（build.sh sed 错误替换路径）
- [x] 修复手机端登录失败（Supabase JS CDN 文件名错误：supabase.min.js → supabase.js）
- [x] 修复手机端无限刷新（viewport 生效前执行 window.innerWidth 判断）

---

## 📍 当前进度
> 上次工作停在哪里

**上次做到**：v1.3.2 发布，修复了标签连字符 + PC端浮动发布按钮 + 手机端 JS 404
**下一步**：更新 AGENTS.md（文档与实际代码脱节最严重），确认手机端竖版登录是否正常工作
**遗留问题**：AGENTS.md 版本号（1.3.0）、标签正则示例（缺少 `-`）、标签文件列表（export.js/flomoImport.js 无标签正则但被列出）

---

## 📁 项目结构（关键部分）

```
桌面端（PC）：
├── index.html          ← 主入口（含设备检测跳转 mobile/）
├── css/style.css       ← 桌面端样式
├── js/
│   ├── app.js          ← Vue 主应用（Supabase 版）
│   ├── db-supabase.js ← 线上云端 DB（多设备同步）
│   └── modules/
│       ├── editor.js   ← 发布输入、标签提取（extractTags）
│       ├── timeline.js ← 时间线渲染、标签高亮（highlightTags）
│       ├── tags.js     ← 标签树、置顶、筛选
│       ├── search.js   ← 全文搜索
│       └── ...
手机端（竖版）：
├── mobile/
│   ├── index.html      ← 手机端入口（引用 ../js/ 共享数据层）
│   ├── css/mobile.css ← 手机端样式
│   └── js/app.js      ← 手机端 Vue App（自己的 extractTags/highlightTags）
发布：
├── dist/              ← 本地预览（不要直接改）
└── docs/              ← GitHub Pages（不要直接改）
```

---

## 🔧 关键技术点

### 标签正则（含连字符支持，v1.3.2 更新）
```js
// 支持中英文、单引号、连字符 `-`、斜杠层级 `/`
const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
```
**有这个正则的 4 个文件（修改时必须同步）**：
1. `js/modules/editor.js` — `extractTags()`
2. `js/modules/timeline.js` — `highlightTags()`
3. `js/db-supabase.js` — `extractTagsFromContent()`
4. `mobile/js/app.js` — `extractTags()` + `highlightTags()`

### 双数据库
- `db.js` — sql.js 本地版（本地开发）
- `db-supabase.js` — 线上云端版（GitHub Pages / 登录后）

### 发布流程
```bash
# 1. 修改源文件
# 2. 更新 VERSION 文件
# 3. 构建
bash build.sh
# 4. 推送线上
bash build.sh push "提交信息"
```

### 设备跳转
- PC 窄屏（<768px）→ 跳 `/mobile/`
- 手机横屏（≥768px）→ 跳回 `/`
- 判断延迟到 viewport 生效后执行（`setTimeout(0)`）

### 线上 vs 本地 JS 路径差异
- 桌面端：`js/db-supabase.js`（同级引用）
- 手机端：`mobile/index.html` 引用 `../js/db-supabase.js`（上级目录）
- `build.sh` 不再 sed 替换手机端路径（v1.3.2 修复）

---

## 🐞 Bug 表格

| Bug | 原因 | 状态 |
|---|---|---|
| 手机端登录失败 | Supabase JS CDN 文件名错误（supabase.min.js → supabase.js） | ✅ 已修复 v1.3.2 |
| 手机端无限刷新 | `<head>` 中跳转脚本在 viewport 生效前执行 | ✅ 已修复 v1.3.2 |
| 手机端 JS 404 | build.sh sed 把 `../js/` 错误替换为 `./js/` | ✅ 已修复 v1.3.2 |
| `#复盘-周/小确幸` 被截断 | 标签正则 `\w` 不含连字符 `-` | ✅ 已修复 v1.3.2 |
| AGENTS.md 与实际代码脱节 | 版本号/标签正则/文件列表未同步 | 🔴 未修复 |

---

## 📝 重要决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-05-04 | 删除 build.sh 中 `../js/` → `./js/` 的 sed 替换 | 手机端共享 JS 在上级目录 `../js/`，改为 `./js/` 会 404 |
| 2026-05-04 | PC 端发布区从固定输入改为浮动按钮+弹窗 | 用户希望信息流展示区域更大 |
| 2026-05-04 | 标签正则加连字符 `-` 支持 | 一级标签含连字符（如"复盘-周"）被截断 |
| 2026-05-03 | 手机端独立目录 + 共享数据层策略 | 避免手机端与桌面端 localStorage 冲突，通过自动跳转规避同源策略限制 |

---

*最后更新：2026-05-08*