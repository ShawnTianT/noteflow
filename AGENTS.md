# Noteflow - Agent Context

> 给 AI Agent 看的说明文件。修改项目前请先读这个。CLAUDE.md 是更详细的工程版本，本文聚焦"做什么不能做什么"。

---

## 项目概述

本地类 flomo 笔记应用。浏览器内运行，数据存在 IndexedDB + Supabase 多设备同步。

- **技术栈**: Vue 3 CDN（无构建）+ sql.js / Supabase + IndexedDB + JSZip
- **项目路径**: `/Users/ali/Library/Mobile Documents/com~apple~CloudDocs/Downloads/知识库/`
- **启动方式**:
  - 本地：`python3 -m http.server 8765` → `http://localhost:8765/dist/`
  - 直接打开：`open dist/index.html`（CDN 在线加载）
  - 线上：https://shawntiant.github.io/noteflow/（GitHub Pages，从 `docs/` 提供）
- **当前版本**: 1.3.2（见 `VERSION` 文件）

### 双数据库模式

| 文件 | 用途 | 加载条件 |
|---|---|---|
| `js/db.js` | sql.js 本地版，IndexedDB 持久化二进制 | 本地开发、无网络 |
| `js/db-supabase.js` | Supabase 云端版，多设备同步 | 线上 GitHub Pages、登录后 |

接口已统一（2026-05-16 SDB-4 修复后）：
- `addNote / updateNote` 接受**数组** tags
- `getNotes / getNoteById` 返回**数组** tags
- `getNoteById / updateNote / deleteNote` 全部 `async`
- 两侧均提供 `normalizeTags()` 兼容旧字符串 / JSON 串 / 数组

---

## 目录结构

```
桌面端（PC）：
├── index.html                ← 主入口，含窄屏跳转 mobile/ 脚本
├── css/style.css             ← 桌面端样式
├── VERSION                   ← 当前 1.3.2
├── js/
│   ├── app.js                ← Vue 主应用（Supabase 版）
│   ├── db-supabase.js        ← 云端 DB（多设备同步，核心 ~800 行）
│   ├── db.js                 ← 本地 sql.js DB
│   ├── modules/
│   │   ├── editor.js         ← 发布输入、标签提取（extractTags）
│   │   ├── timeline.js       ← 时间线渲染、标签高亮（highlightTags）
│   │   ├── tags.js           ← 标签树、置顶、筛选
│   │   ├── search.js         ← 全文搜索
│   │   ├── user.js           ← 用户切换
│   │   └── export.js         ← 导出 JSON / flomo zip / 导入 JSON
│   └── utils/
│       ├── imageHelper.js    ← 图片压缩 / 上传
│       ├── zipHelper.js      ← JSZip 封装
│       └── flomoImport.js    ← flomo HTML 导入
├── data/
│   ├── noteflow_user1.db     ← 预填充数据（1687 条 + 134 标签）
│   └── images/               ← 大图本地存储

手机端（竖版）：
├── mobile/
│   ├── index.html            ← 入口，引用 ../js/ 共享数据层
│   ├── AGENTS.md             ← 给手机端 agent 的上下文（红线规则）
│   ├── css/mobile.css
│   └── js/app.js             ← 手机端 Vue（自带 extractTags / highlightTags）

发布产物（不要直接改）：
├── dist/                     ← 本地预览，build.sh 生成
└── docs/                     ← GitHub Pages，build.sh 同步

测试：
├── tests/
│   ├── run-all.cjs           ← 单测 harness（零依赖 node assert）
│   ├── check-regex-sync.cjs  ← 4 处标签正则一致性检查
│   └── unit/*.test.cjs       ← extractTags / normalizeTags / buildTagTree / highlightTags

后端 / 文档：
├── CLAUDE.md                 ← 更详细的工程上下文（**优先看这个**）
├── PRD.md                    ← 产品需求文档
├── supabase-schema.sql       ← users 表 + verify_password RPC
└── docs/superpowers/specs/   ← 设计文档 / 审查报告
```

### ⚠️ 最重要的规则

**`dist/` 和 `docs/` 里的文件禁止直接编辑！** 所有修改在根目录的源文件里做，然后运行：

```bash
bash build.sh
```

`build.sh` 把源文件复制到 `dist/`（本地）和 `docs/`（线上）。直接改这两个目录里的文件，下次 `build.sh` 会被覆盖。

推送 GitHub Pages：

```bash
bash build.sh push "提交信息"   # 不带消息默认用 "v$VERSION"
```

---

## 关键技术点

### 标签正则（v1.3.2，含连字符 + URL 剥离）

```js
// 支持中英文、单引号 '、连字符 -、斜杠层级 /
const regex = /#([\w一-龥'-]+(?:\/[\w一-龥'-]+)*)/g;

// 调用前先剥 URL，避免 https://x.com/#frag 被识为标签
text = (text || '').replace(/https?:\/\/\S+/g, ' ');

// 过滤纯英文+数字尾缀（如 campaign2、test3）
if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
```

**正则散落 4 处文件，改一处必须同步其他 3 处**：
1. `js/modules/editor.js` — `extractTags()`
2. `js/modules/timeline.js` — `highlightTags()`
3. `js/db-supabase.js` — `extractTagsFromContent()`
4. `mobile/js/app.js` — `extractTags()` + `highlightTags()`

> ⚠️ `js/modules/export.js` 和 `js/utils/flomoImport.js` 内有简化版正则但**不在一致性脚本范围**（前者只在 HTML 导出层用，后者已用 cleanContent 预处理）。改这两处时手动核对。

改完跑：

```bash
node tests/check-regex-sync.cjs   # 4 处字面量一致即 pass
node tests/run-all.cjs            # 4 套单测 95 assertions
```

### Supabase 配置

- 项目 URL：`rsqamgjvreurggjoxphq.supabase.co`
- 默认账号：`18134158895` / `123456`
- 自定义 `users` 表 + `verify_password` RPC（pgcrypto 加密）
- `getCurrentUserId()` 返回 BIGINT 或 null
- 已迁移：1687 条笔记 + 134 标签（user_id=1）

### 设备跳转

- PC 窄屏（`<768px`）→ 跳 `/mobile/`
- 手机横屏（`≥768px`）→ 跳回 `/`
- 跳转脚本必须**延迟到 viewport 生效后**执行（`setTimeout(fn, 0)`），否则无限刷新
- 见 `index.html:9-17`

### 线上 vs 本地 JS 路径差异

- 桌面端：`js/db-supabase.js`（同级）
- 手机端：`mobile/index.html` 引用 `../js/db-supabase.js`（上级）
- `build.sh` **不再** sed 替换手机端路径（v1.3.2 修复）

### 脏标记 + 自动保存

- `markDirty()` 标记变更（2026-05-16 SDB-5 后改用 `dirtyVersion` 计数器）
- 30 秒自动 `saveDb()` + 手动调用
- 批量导入：`addNotesBatch(notes, {skipSave:true})` 后统一保存

### 手动渲染（PC 端重要）

Vue 响应式只管 Vue 模板内的 DOM。`#notes-container` 和 `#tags-list` 是普通 DOM，更新数据后必须手动调用：

- `Timeline.renderNotes()`
- `TagsModule.renderTags()`

**doSignOut 必须显式清状态 + 手动渲染空数组**（否则换账号串数据）：

```js
this.notes = []; this.tags = []; this.noteCount = 0;
this.currentTag = ''; this.searchKey = '';
Timeline.renderNotes([]);
TagsModule.renderTags([], '');
```

Mobile 用 `resetUserState()` 方法集中复位。

### init 必须幂等（PC 端，2026-05-14 致命 bug 修复）

`Editor.init` / `SearchModule.init` 在 sign-in → out → in 时会反复调用，document 上的 paste/keydown 不能重复绑定。
模式：element 用 `_editorBound` 标记，document listener 用模块级 `globalListenersAttached` 全局开关。

---

## 数据库表结构

### SQLite（本地 db.js）

```sql
-- 用户表
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, avatar TEXT, created_at DATETIME);

-- 笔记表
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  content TEXT,
  tags TEXT,              -- ⚠️ 内部逗号分隔字符串，对外接口已统一为数组
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

### Supabase（线上 db-supabase.js）

类似 SQLite，但 `tags` 字段是 JSON 数组格式。三个工具函数处理格式差异：

- `normalizeTags(tags)` — string / array / JSON 串 / null 统一转数组
- `normalizeToArray(val)` — 通用值归一化
- `extractTagsFromContent(content)` — tags 为空时从 content 提取 #标签 后备

---

## 常见坑（修改前必读）

1. **不要改 `dist/` 和 `docs/` 里的文件** — 改完会被 `build.sh` 覆盖
2. **`db.exec()` 不支持参数绑定** — 必须用 `prepare + bind + step + getAsObject`，结束 `stmt.free()`
3. **图片混合存储** — 小图（<100KB）走 `image_data` (base64)，大图走 `image_paths` (本地相对路径)
4. **公司网络 GitHub 不稳** — 443 端口可能被拦，`git push` 需代理或回家
5. **改了标签正则要改 4 处 + 跑 `check-regex-sync.cjs`** — 详见上文
6. **改完代码必跑 `node tests/run-all.cjs`** — 95 assertions 含回归保护
7. **PC 端 `Editor.init` / `SearchModule.init` 必须在 Vue 渲染主界面后才调** — `await this.$nextTick()` 之后再调，否则 `getElementById` 全 null
8. **PC 端 init 必须幂等** — 用 `_editorBound` / `globalListenersAttached` 守门
9. **doSignOut 必须显式清 Vue 状态 + 手动 renderNotes([])/renderTags([])** — 否则换账号串数据
10. **标签点击用事件委托 + `data-tag`** — 标签含单引号（如 `area's/跑步`）时内联 `onclick` 会被引号断开

---

## 2026-05-16 全量审查后变化（重要）

50+ finding 已修完 high + medium，按子系统分 4 commit：
- 数据层（SDB-1~9 + F-NT-2）：原子事务、跨用户隔离、接口对齐、错误传播
- 主流程（NF-1~7）：IME / 时区 / 并发 / 缓存签名 / pinned key
- 导出/工具（UEU-1~13）：fire-and-forget / 死链 / OOM / XSS / 状态清理 / importJSON
- Mobile（MOB-1/2/4~10）：URL 剥离 / debounce / 互斥 / reviewMode / refresh 序列号

详见 [审查报告](docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md)。

---

## 用户偏好（凌霄）

- 零编程基础，所有操作要一步到位
- 配色偏好：浅色清新
- flomo 历史数据在 `/Users/tianlingxiao/Downloads/flomo@shawn每日蜕变-20260404`
- 项目名：Noteflow
- 语言：简体中文

---

## GitHub Pages 部署

- **仓库**: https://github.com/ShawnTianT/noteflow
- **Pages 来源**: main 分支 `/docs` 目录
- **发布命令**: `bash build.sh push "提交信息"`

---

## 版本发布流程

1. 修改根目录的源文件
2. 更新 `VERSION` 文件
3. `bash build.sh`（同步到 dist/ + docs/）
4. 本地验证：`localhost:8765`，强刷
5. 推线上：`bash build.sh push "提交信息"`

---

*最后更新：2026-05-16（v1.3.2 + 全量审查）*
