# Noteflow Mobile — Agent 上下文

> 你正在为 Noteflow 编写手机端竖版页面。请先读完这个文件再开始。

---

## 项目背景

Noteflow 是一个类 flomo 的笔记应用，已有完整的桌面端（PC 横版）。你的任务是创建手机端竖版页面，复用现有的数据层，只写 UI 部分。

---

## 目录结构

```
mobile/                  ← 你的工作区（只在这个目录里写文件）
├── index.html           ← 手机端入口页面（已创建骨架）
├── css/
│   └── mobile.css       ← 手机端样式（已创建骨架）
├── js/
│   └── app.js           ← 手机端 Vue App 逻辑（已创建骨架）
└── AGENTS.md            ← 你正在读的这个文件

项目根目录（不要修改！）:
├── js/db.js             ← sql.js 本地数据库（共享，只读）
├── js/db-supabase.js    ← Supabase 云端数据库（共享，只读）
├── js/utils/            ← 工具函数（共享，只读）
│   ├── imageHelper.js
│   ├── zipHelper.js
│   └── flomoImport.js
└── ...
```

---

## ⚠️ 红线规则（违反 = 出事）

1. **只能在 `mobile/` 目录内写文件**。不要修改 `mobile/` 以外的任何文件。
2. **共享数据层只读**。`../js/db.js`、`../js/db-supabase.js`、`../js/utils/` 可以调用，不要修改。
3. **不要引入新的构建工具**。项目是 Vue 3 CDN 版，没有 webpack/vite/npm。
4. **CDN 依赖保持一致**。Vue 3 和 Supabase JS 已在 index.html 里引入，不要重复引入或换版本。

---

## 技术栈

- **Vue 3 CDN**：`Vue.createApp(options).mount('#app')`，无构建工具
- **数据层**：通过 `../js/db-supabase.js` 引用，已由 index.html 的 `<script>` 标签加载
- **样式**：纯 CSS，写在 `css/mobile.css`
- **语言**：简体中文 UI

---

## 可用的数据层 API

以下函数由共享模块提供，你可以直接调用（全局变量）：

### 数据库操作（db-supabase.js 导出为全局 DB 对象）

```js
// 笔记 CRUD
DB.addNote(note)                    // 添加笔记，note = {content, tags, image_paths, image_data, type}
DB.getNotes({tag, search, limit, offset}) // 获取笔记列表，返回数组
DB.getNoteById(id)                  // 获取单条笔记
DB.updateNote(id, updates)          // 更新笔记
DB.deleteNote(id)                   // 删除笔记
DB.addNotesBatch(notes, options)    // 批量添加

// 标签
DB.getAllTags()                     // 获取所有标签，返回数组 [{name, count}]
DB.getRandomNotes(n)                // 随机获取 n 条笔记

// 用户
DB.getCurrentUser()                 // 获取当前用户
DB.getAllUsers()                    // 获取所有用户

// 数据库
DB.initDB()                         // 初始化数据库（页面加载时调用）
DB.saveDB()                         // 手动保存到 IndexedDB

// Supabase 同步
DB.isLoggedIn()                     // 是否已登录 Supabase
DB.signIn(username, password)       // 登录
DB.signOut()                        // 登出
DB.syncToCloud()                    // 同步到云端
DB.syncFromCloud()                  // 从云端同步
```

### 工具函数

```js
// imageHelper.js
ImageHelper.compress(file, maxWidth, quality) // 压缩图片
ImageHelper.readAsDataURL(file)               // 读取为 base64

// flomoImport.js
FlomoImport.parse(html)                       // 解析 flomo 导出 HTML
```

### 笔记数据结构

```js
{
  id: Number,              // 笔记 ID
  user_id: Number,         // 用户 ID
  content: String,         // 笔记内容（含 #标签 文本）
  tags: String|Array,      // 标签（逗号分隔字符串 或 JSON 数组）
  image_paths: String,     // JSON 数组，大图路径
  image_data: String,      // JSON 数组，小图 base64
  type: String,            // 'text'
  is_done: Number,         // 0 或 1
  created_at: String,      // ISO 日期
  updated_at: String       // ISO 日期
}
```

### 标签数据结构

```js
{
  name: String,   // 标签名，如 "投资/策略"（含层级）
  count: Number   // 该标签下笔记数
}
```

---

## 手机端 UI 需求

### 核心功能（必须实现）

1. **极简输入**：底部固定输入栏，Enter 发送，Shift+Enter 换行
2. **#标签语法**：输入时自动识别 #标签，空格分隔
3. **笔记卡片流**：中间可滚动区域，按时间倒序
4. **标签筛选**：顶部标签栏，支持点击筛选
5. **全文搜索**：搜索框
6. **编辑/删除**：长按或滑动卡片弹出操作
7. **图片上传**：📷 按钮或 Ctrl+V 粘贴
8. **图片展示**：缩略图 + 点击放大

### 布局建议

```
┌─────────────────────┐
│  搜索框  │  标签筛选  │  ← 顶部固定
├─────────────────────┤
│                     │
│   笔记卡片 1        │
│   笔记卡片 2        │  ← 中间可滚动
│   笔记卡片 3        │
│   ...               │
│                     │
├─────────────────────┤
│ [📷] 输入框... [发送]│  ← 底部固定
└─────────────────────┘
```

### 设计规范

- **配色**：浅色清新风格，与桌面端一致
- **CSS 变量**：`mobile.css` 已定义 `--primary`, `--text`, `--bg` 等变量
- **安全区域**：底部用 `env(safe-area-inset-bottom)` 适配 iPhone 刘海屏
- **触摸友好**：按钮最小点击区域 44px，避免误触

---

## 标签相关

- 标签支持层级：`投资/策略`、`area's/跑步`
- 点击一级标签时，应同时匹配 `tag/%` 前缀的子标签
- 标签提取正则：`/#([\w\u4e00-\u9fa5']+(?:\/[\w\u4e00-\u9fa5']+)*)/g`
- 纯英文+数字尾缀不判定为标签（如 `campaign2`），需过滤：`/^[a-zA-Z]+\d+$/`

---

## 关于 db.js vs db-supabase.js

- 手机端 `index.html` 只引入了 `db-supabase.js`
- 如果需要离线模式支持，可以在 `index.html` 中也引入 `db.js`，并根据环境切换（参照桌面端 `index.html` 的做法）
- 当前骨架只引入 db-supabase.js，保持简单

---

## 开发调试

1. 本地预览：启动 HTTP 服务器后访问 `http://localhost:8765/mobile/`
2. 强刷：`Cmd+Shift+R`
3. 移动端调试：Chrome DevTools → 切换设备模拟（iPhone 14 Pro 推荐）
4. 真机调试：同一局域网下访问 `http://你的IP:8765/mobile/`

---

## 完成后

1. 确保所有文件都在 `mobile/` 目录内
2. 确保没有修改 `mobile/` 以外的文件
3. 测试：在浏览器中打开 `mobile/index.html`，确认不报错
4. 通知凌霄检查

---

*最后更新：2026-05-03*
