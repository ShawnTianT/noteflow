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
- **项目描述**：类 flomo 笔记应用，浏览器内运行，sql.js + IndexedDB 本地持久化，Supabase 多设备同步
- **技术栈**：Vue 3 CDN（无构建）+ sql.js / Supabase + IndexedDB + JSZip
- **项目路径**：`/Users/ali/Library/Mobile Documents/com~apple~CloudDocs/Downloads/知识库/`
- **当前版本**：1.3.2（见 `VERSION`）
- **启动命令**：
  - 构建产物：`bash build.sh`
  - 本地预览：`python3 -m http.server 8765`（项目根目录），访问 `http://localhost:8765/dist/`
  - 直接打开：`open dist/index.html`（CDN 在线加载即可）
- **线上地址**：https://shawntiant.github.io/noteflow/
- **GitHub 仓库**：https://github.com/ShawnTianT/noteflow（Pages 来源：main 分支 `/docs`）
- **最后更新**：2026-05-16

---

## 🎯 当前目标
> 本阶段要完成的核心任务

- [x] **🔥 全量审查 Phase 4-7**：50+ finding 修完 high+medium，按子系统 4 commit（2026-05-16）
- [x] **🧪 单测 harness + 4 套测试**：95 assertions + 正则一致性脚本（2026-05-16）
- [x] **📑 审查报告 + CLAUDE.md + AGENTS.md 同步**（2026-05-16）
- [ ] 浏览器实测（清 localStorage → 完整主流程）
- [ ] push origin/main（用户决定时机；当前 25 commits ahead）

---

## 📍 当前进度
> 上次工作停在哪里

**做到**：2026-05-15 全量审查走完 7 个 phase。
- Phase 1-3：4 agent 并行扫描 → 合并 → 跨文件二次扫 → 打分（50+ finding）
- Phase 4：按子系统 4 commit
  - `50a9c79/e52cf95/d26a6a3/fc78f3d` SDB-1~9 + F-NT-2（数据层）
  - `8deb38f` NF-1~7 + MOB-5（主流程）
  - `124fca5` UEU-1~13 + MOB-7（导出/导入/图片）
  - `951a94a` MOB-1/2/4/6/8/9/10（Mobile）
- Phase 5：4 套单测（95 assertions）+ regex-sync 脚本
- Phase 6：syntax + tests + regex + build 全过
- Phase 7：本次更新 + [审查报告](docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md)

**改动文件（本轮汇总）**：
- 数据层：`js/db.js` / `js/db-supabase.js`
- 主流程：`js/modules/editor.js` / `timeline.js` / `tags.js` / `search.js`
- 导出工具：`js/utils/imageHelper.js` / `flomoImport.js` / `zipHelper.js` / `js/modules/export.js`
- UI：`js/app.js` / `index.html`（导入下拉）
- Mobile：`mobile/js/app.js` / `mobile/index.html`（回顾返回条）
- 测试：`tests/run-all.cjs` / `tests/check-regex-sync.cjs` / `tests/unit/*.test.cjs`
- 文档：`docs/superpowers/specs/2026-05-15-*.md`
- dist/ + docs/ 已同步

**下一步**：
1. **浏览器实测**（用户主导）：清 localStorage → 登录 → 发布带标签/图 → 切标签 → 搜索 → 编辑 → 删除 → 退出登录 → 重登 → 暂不登录测本地模式 → 刷新页面验证 localMode 持久化 → 测 mobile（窄屏跳转 + 回顾返回）
2. **push origin/main**（用户决定时机；25 commits ahead）
3. Low findings 收尾（详见 audit-report 第 4 节）

**遗留问题**：
- 未跑浏览器 e2e（仅 node 层 syntax + 单测覆盖）
- AGENTS.md 仍可能落后（本轮已对齐 v1.3.2，但代码量大）

---

## 📁 项目结构

```
桌面端（PC）：
├── index.html                ← 主入口，含窄屏跳转 mobile/ 脚本
├── css/style.css             ← 桌面端样式（1176 行）
├── VERSION                   ← 当前 1.3.2
├── js/
│   ├── app.js                ← Vue 主应用（Supabase 版，307 行）
│   ├── db-supabase.js        ← 云端 DB（多设备同步，787 行）
│   ├── db.js                 ← 本地 sql.js DB（676 行，本地开发用）
│   ├── modules/
│   │   ├── editor.js         ← 发布输入、标签提取（extractTags）
│   │   ├── timeline.js       ← 时间线渲染、标签高亮（highlightTags）
│   │   ├── tags.js           ← 标签树、置顶、筛选
│   │   ├── search.js         ← 全文搜索
│   │   ├── user.js           ← 用户切换
│   │   └── export.js         ← 导出 JSON / flomo zip
│   └── utils/
│       ├── imageHelper.js    ← 图片压缩 / 上传
│       ├── zipHelper.js      ← JSZip 封装
│       └── flomoImport.js    ← flomo HTML 导入
├── data/
│   ├── noteflow_user1.db     ← 预填充数据（1687条+134标签）
│   └── images/               ← 大图本地存储

手机端（竖版）：
├── mobile/
│   ├── index.html            ← 入口，引用 ../js/ 共享数据层
│   ├── AGENTS.md             ← 给手机端 agent 的上下文（红线规则）
│   ├── css/mobile.css
│   └── js/app.js             ← 手机端 Vue（含自己的 extractTags/highlightTags）

发布产物（不要直接改）：
├── dist/                     ← 本地预览，build.sh 生成
└── docs/                     ← GitHub Pages，build.sh 同步

后端 / 文档：
├── AGENTS.md                 ← 给 AI agent 的全局上下文（落后于代码！）
├── PRD.md                    ← 产品需求文档（10 章节，2026-05-03 创建）
├── supabase-schema.sql       ← users 表 + verify_password RPC
├── sqlpub-proxy-server.js    ← SQLPub 代理（备用方案）
├── start-server.sh / com.noteflow.server.plist  ← LaunchAgent
└── .workbuddy/memory/        ← 长期记忆笔记
```

---

## 🔧 关键技术点

### 标签正则（v1.3.2，含连字符）
```js
// 支持中英文、单引号 '、连字符 -、斜杠层级 /
const regex = /#([\w一-龥'-]+(?:\/[\w一-龥'-]+)*)/g;
```
**有这个正则的 4 个文件（修改时必须同步）**：
1. `js/modules/editor.js` — `extractTags()`
2. `js/modules/timeline.js` — `highlightTags()`
3. `js/db-supabase.js` — `extractTagsFromContent()`
4. `mobile/js/app.js` — `extractTags()` + `highlightTags()`

> ⚠️ AGENTS.md 误把 `export.js` / `flomoImport.js` 列为含正则文件 — 实际不含。

### 双数据库
- `js/db.js` — sql.js 本地版，IndexedDB 持久化二进制（本地开发）
- `js/db-supabase.js` — Supabase 云端版（GitHub Pages / 登录后默认）

接口已统一：
- `addNote / updateNote` 接受**数组** tags
- `getNotes / getNoteById` 返回**数组** tags
- 两侧均提供 `normalizeTags()` 兼容旧字符串格式
- `getNoteById / updateNote / deleteNote` 全部 `async`

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
- `build.sh` **不再** sed 替换手机端路径（v1.3.2 修复，详见决策记录 2026-05-04）

### 发布流程
```bash
# 1. 修改源文件
# 2. 更新 VERSION 文件
# 3. 构建到 dist/ + docs/
bash build.sh
# 4. 同步并推送 GitHub Pages
bash build.sh push "提交信息"   # 不带消息默认用 "v$VERSION"
```
`build.sh push` 会 `git add` 这些路径：`dist/ docs/ index.html css/ js/ utils/ mobile/ VERSION AGENTS.md`。

### 脏标记 + 自动保存
- `markDirty()` 标记变更
- 30 秒自动 `saveDb()` + 手动调用，避免无意义写入
- 批量导入：`addNotesBatch(notes, {skipSave:true})` 后统一保存

### 手动渲染（重要）
Vue 响应式只管 Vue 模板内的 DOM。`#notes-container` 和 `#tags-list` 是普通 DOM，更新数据后必须手动调用：
- `Timeline.renderNotes()`
- `TagsModule.renderTags()`

---

## 🐞 Bug 表格

### 主流程致命 bug（已全部修复，2026-05-14/15）

| Bug | 原因 | 状态 |
|---|---|---|
| **PC 首次登录后 FAB ➕ 不工作 / 搜索无响应** | `doSignIn()` 缺 `Editor.init` + `SearchModule.init` 调用 | ✅ |
| **PC 点"暂不登录"后 FAB 不工作** | `enterLocalMode()` 同步调用 `Editor.init`，DOM 未渲染时 `getElementById` 返回 null | ✅ |
| **重复登录会累积 paste/keydown listener** | `Editor.init` 不幂等 | ✅ |
| **A: syncFromCloud 中间态空白** | `idbClear`+逐条 put 不在同事务，refreshNotes 并发会读到空 | ✅ |
| **B: idbClear 跨用户清** | `idbClear('notes')` 清整张表，多账号会丢数据 | ✅ |
| **C: 本地模式不持久** | 进入本地模式后刷新页面会回到登录页 | ✅ |
| **D: 本地 ID 可能撞** | `Date.now()+Math.random()*10000` 同 ms 多次 add 可能重复 | ✅ |
| **E: 标签计数读改写竞争** | 无事务保护，并发 update 会丢更新 | ✅ |
| **F: signOut 不清缓存** | 退出后老用户笔记残留 IDB，换账号会串数据 | ✅ |

### 全量审查 high/medium（2026-05-16 已全修，4 PR）

| Finding 组 | 子系统 | Commit | 备注 |
|---|---|---|---|
| **SDB-1~9 + F-NT-2** | 数据层 | `50a9c79/e52cf95/d26a6a3/fc78f3d` | 同步 typo / 原子事务 / 跨用户隔离 / 接口对齐 |
| **NF-1~7 + MOB-5** | 主流程 | `8deb38f` | IME / 时区 / 并发 / 缓存签名 / pinned key |
| **UEU-1~13 + MOB-7** | 导出/导入/图片 | `124fca5` | fire-and-forget / 死链 / OOM / XSS / 状态清理 |
| **MOB-1/2/4/6/8/9/10** | Mobile | `951a94a` | URL 剥离 / debounce / 状态清 / 互斥 / reviewMode / seq |

完整对照表见 [审查报告](docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md) 第 2 节。Low 仅报告见第 4 节。

### 老 bug（v1.3.2 已修）

| Bug | 原因 | 状态 |
|---|---|---|
| 手机端登录失败 | Supabase JS CDN 文件名错误 | ✅ v1.3.2 |
| 手机端无限刷新 | `<head>` 跳转脚本 viewport 前执行 | ✅ v1.3.2 |
| 手机端 JS 404 | `build.sh` sed 错误替换 | ✅ v1.3.2 |
| `#复盘-周/小确幸` 被截断 | 正则 `\w` 不含 `-` | ✅ v1.3.2 |
| `#campaign2` 误判 | `/^[a-zA-Z]+\d+$/` 过滤 | ✅ |
| AGENTS.md 脱节 | 版本号/正则示例/文件列表均落后 | 🟢 2026-05-16 同步 |

---

## 📝 重要决策记录

| 日期 | 决策 | 原因 |
|---|---|---|
| 2026-05-16 | **零依赖 node 单测 harness**（`tests/run-all.cjs` + `tests/unit/*.test.cjs`） | 不引入 jest/vitest 保持零构建；单测仅覆盖纯逻辑模块（extractTags/normalizeTags/buildTagTree/highlightTags），不跑 DOM；用大括号配对 / new Function 抠 IIFE 内部函数 |
| 2026-05-16 | **正则一致性强制脚本**（`tests/check-regex-sync.cjs`） | 标签正则散落 4 处文件极易漂移；脚本字面量提取 + 字符串比对，不一致即 exit 1 |
| 2026-05-16 | **审查 4 PR 拆分**（数据层 / 主流程 / 导出 / Mobile） | 单 PR 把 50+ finding 一勺烩会让 review 失控；按子系统分让回归定位精确 |
| 2026-05-14 | `Editor.init` / `SearchModule.init` 改为**幂等**（element 用 `_editorBound`/`_searchBound` 标记，document listener 用 `globalListenersAttached` 全局开关） | 修 PC 主流程后 sign-in→sign-out→sign-in 会导致 paste/keydown listener 累积，**必须**幂等否则一次粘贴触发多次 |
| 2026-05-14 | `doSignIn` 在 `await $nextTick()` 后再调 init | Vue 异步渲染 v-else 主界面，必须等 DOM 出来才能 `getElementById('fab-publish')` |
| 2026-05-14 | `enterLocalMode` 用 `$nextTick(async fn)` 包整段 refresh + init | 同上，且原代码同步调 init 是确认的 BUG #2 |
| 2026-05-04 | 删除 build.sh 中 `../js/` → `./js/` 的 sed 替换 | 手机端共享 JS 在上级目录，改为 `./js/` 必 404 |
| 2026-05-04 | PC 端发布区改为右下角浮动按钮 + 弹窗 | 用户希望信息流展示区域更大 |
| 2026-05-04 | 标签正则加连字符 `-` 支持 | 一级标签含连字符（如"复盘-周"）被截断 |
| 2026-05-03 | 手机端独立目录 + 共享数据层策略 | 避免与桌面端 localStorage 冲突，通过自动跳转规避同源策略限制 |
| 2026-05-03 | 标签接口统一为数组（db.js 内部仍存逗号字符串） | 调用方不再关心存储格式，便于未来切换后端 |
| 2026-05-03 | 标签点击改用 `data-tag` + 事件委托 | 内联 onclick 遇到单引号（如 `area's/跑步`）会转义出错 |

---

## 🚧 已知坑（写代码前必读）

1. **`db.exec()` 不支持参数绑定** — 必须用 `db.prepare() + bind() + step() + getAsObject()` 模式
2. **图片混合存储** — 小图（<100KB）base64 存 `image_data`；大图存 `data/images/` 路径，路径写入 `image_paths`
3. **公司网络 GitHub 不稳** — 443 端口可能被拦，`git push` 需要代理或回家
4. **dist/ 和 docs/ 不要直接改** — 任何修改都会被下次 `build.sh` 覆盖
5. **改了标签正则要改 4 处** — 见上文"关键技术点"
6. **AGENTS.md 与代码不同步** — 改完代码记得改 AGENTS.md，否则下次 agent 用错信息
7. **PC 端 `Editor.init` / `SearchModule.init` 必须在 Vue 渲染主界面后才调**（v-else 异步），否则 `getElementById` 全 null。Mobile 用 `@click` 模板绑定，无此问题
8. **PC 端 init 必须幂等** — sign-in→out→in 会反复调 init，document 上的 paste/keydown 不能重复绑定（用模块级 `globalListenersAttached` 守门）
9. **改了标签正则要跑 `node tests/check-regex-sync.cjs`** — 4 处必须字面量完全一致，脚本会比对 `js/modules/editor.js` / `timeline.js` / `js/db-supabase.js` / `mobile/js/app.js`
10. **改完代码必跑 `node tests/run-all.cjs`** — 4 套单测 95 assertions，含 NF-6/extractTags/normalizeTags 等回归保护
11. **doSignOut 必须显式清 Vue 状态 + 手动 renderNotes([])/renderTags([])**（UEU-4/MOB-7）— 否则换账号串数据；`resetUserState()` 已抽出（mobile）；PC 直接在 doSignOut 内显式清

---

## 👤 用户偏好（凌霄）

- 零编程基础，所有操作要一步到位（不用让我"打开终端运行 X 命令"组合）
- 配色偏好：浅色清新
- flomo 历史数据在 `/Users/tianlingxiao/Downloads/flomo@shawn每日蜕变-20260404`
- 项目名最终定为 **Noteflow**

---

*最后更新：2026-05-16*
