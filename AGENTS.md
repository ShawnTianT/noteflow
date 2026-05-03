# Noteflow - Agent Context

> 给 AI Agent 看的说明文件。修改项目前请先读这个。

---

## 项目概述

本地类 flomo 笔记应用。浏览器内运行，数据存在 IndexedDB，关浏览器再开数据还在。

- **技术栈**: Vue 3 CDN + sql.js + IndexedDB
- **启动方式**: 本地 HTTP 服务器 `localhost:8765`（从 `dist/` 提供页面）
- **当前版本**: 1.3.0（见 `VERSION` 文件）

---

## 目录结构（重要！）

```
/Users/tianlingxiao/Desktop/知识库/
├── index.html              ← 入口页面（源代码，编辑这里）
├── css/style.css          ← 样式（源代码，编辑这里）
├── js/                    ← 所有 JS 模块（源代码，编辑这里）
│   ├── app.js
│   ├── db.js
│   └── modules/
│       ├── editor.js      ← 输入、标签提取、图片上传
│       ├── export.js      ← 导出（.db / .json / flomo zip）
│       ├── search.js      ← 全文搜索
│       ├── tags.js        ← 标签树、置顶、筛选
│       ├── timeline.js    ← 时间线卡片流渲染
│       └── user.js        ← 用户切换
├── utils/                 ← 工具函数（源代码，编辑这里）
├── libs/                  ← 第三方库（sql.js 等，不要改）
├── data/                  ← 预填充数据库 + 图片
│   ├── noteflow_user1.db ← 用户一的初始数据（1687条笔记）
│   └── images/           ← 图片存储目录
│
├── build.sh               ← 发布脚本（源代码 → dist/）
├── VERSION                ← 版本号
│
└── dist/                  ← ★ 发布目录（HTTP 服务器从这里读）
    ├── index.html         ← 上面源文件的副本（不要直接改！）
    ├── css/
    ├── js/
    ├── utils/
    ├── libs/
    └── data/
```

### ⚠️ 最重要的规则

**`dist/` 里的文件禁止直接编辑！** 所有修改在根目录的源文件里做，然后运行：

```bash
bash build.sh
```

`build.sh` 会把源文件复制到 `dist/`。如果你直接改 `dist/` 里的文件，下次 `build.sh` 会把它覆盖掉。

---

## 关键技术点

### db.js — sql.js 使用规范

sql.js 的 `db.exec()` **不支持参数绑定**，必须用 `prepare + bind + step + getAsObject` 模式：

```js
// ✅ 正确
const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
stmt.bind([noteId]);
while (stmt.step()) {
  const row = stmt.getAsObject();
  // ...
}
stmt.free();

// ❌ 错误（exec 不支持 ? 占位符）
db.exec('SELECT * FROM notes WHERE id = ?', [noteId]);
```

### 标签提取 — extractTags()

位置：`js/modules/editor.js`

```js
// 正则：支持中英文、单引号、斜杠层级
const regex = /#([\w\u4e00-\u9fa5']+(?:\/[\w\u4e00-\u9fa5']+)*)/g;

// 过滤：纯英文+数字尾缀不判定为标签（如 campaign2, test3）
if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
```

**修改标签逻辑时，这四个文件都要同步更新**：
1. `js/modules/editor.js` — `extractTags()`
2. `js/modules/timeline.js` — `highlightTags()`
3. `js/modules/export.js` — 标签相关导出
4. `js/utils/flomoImport.js` — 导入时标签解析

### 标签置顶

- 存储：`localStorage.getItem('noteflow_pinned_tags_' + userId)`
- 切换：点击标签的 📌 图标或右键标签
- 渲染：置顶标签排最前，下方有分隔线

### 图片存储策略

| 图片大小 | 存储方式 | 字段 |
|---|---|---|
| < 100KB | base64 字符串 | `image_data` |
| ≥ 100KB | 存到 `data/images/`，存路径 | `image_paths` |

### Vue 3 CDN 版 — 手动渲染

本项目用 CDN 版 Vue 3（`Vue.createApp(options).mount('#app')`），**没有构建工具**。

notes 容器和 tags 容器是**普通 DOM**，Vue 响应式更新后需要手动调用：
- `Timeline.renderNotes()` — 重新渲染时间线
- `TagsModule.renderTags()` — 重新渲染标签树

如果不手动调用，数据更新了但页面不刷新。

### 标签点击事件 — 用事件委托

标签含单引号时（如 `area's/跑步`），不能用内联 `onclick="fn('area's')"`（引号冲突）。

必须用**事件委托** + `data-tag` 属性：
```js
// ✅ 正确
container.addEventListener('click', (e) => {
  const tag = e.target.closest('[data-tag]')?.dataset.tag;
  if (tag) filterByTag(tag);
});

// ❌ 错误（单引号会断）
element.innerHTML = `<span onclick="filterByTag('area's')">...</span>`;
```

---

## 数据库表结构

```sql
-- 用户表
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, avatar TEXT, created_at DATETIME);

-- 笔记表
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  content TEXT,
  tags TEXT,              -- JSON 数组，如 '["跑步","思考"]'
  image_paths TEXT,       -- JSON 数组，大图路径
  image_data TEXT,        -- JSON 数组，小图 base64
  type TEXT DEFAULT 'text',
  is_done INTEGER DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME
);

-- 标签表（冗余计数，加速展示）
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT,
  count INTEGER DEFAULT 0,
  UNIQUE(user_id, name)
);
```

---

## 常见坑（修改前必读）

### 1. 不要改 `dist/` 里的文件

改完会被 `build.sh` 覆盖。始终改根目录的源文件。

### 2. sql.js prepare 后必须 free()

```js
const stmt = db.prepare('SELECT...');
// ... 使用 stmt ...
stmt.free();  // ← 必须调用，否则内存泄漏
```

### 3. 标签过滤逻辑在多个文件里都有

改了一个文件的正则，记得同步其他三个（见上文"标签提取"部分）。

### 4. 修改后用户看不到变化？

先确认：
1. 改的是源文件（根目录）还是 `dist/`？（应该是根目录）
2. 有没有运行 `bash build.sh`？
3. 浏览器有没有强刷（`Cmd+Shift+R`）？

### 5. 白屏怎么排查

`index.html` 里有全局错误捕获，会把错误信息写到页面上。如果看到白屏，检查：
- HTTP 服务器是否正常运行？
- `dist/` 里的文件是否完整？（重新运行 `bash build.sh`）

---

## 用户偏好

- 凌霄零编程基础，所有操作需一步到位
- 配色偏好：浅色清新
- 项目名：Noteflow
- 语言：简体中文

---

## 版本发布流程

1. 修改根目录的源文件（如 `js/modules/tags.js`）
2. 更新 `VERSION` 文件（如 `1.3.1`）
3. 运行 `bash build.sh`
4. 用户强刷浏览器（`Cmd+Shift+R`）

---

*最后更新：2026-05-03*
