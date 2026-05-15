# Noteflow 全量代码审查与修复 — 设计文档

- **日期**: 2026-05-15
- **范围**: PC 端 (`js/`) + Mobile 端 (`mobile/js/`) 全量静态审查、跨文件一致性核对、纯逻辑模块单测引入、按子系统批量修复
- **当前版本**: 1.3.2
- **触发原因**:
  - 上轮 13 项主流程 / 数据安全 / 性能修复未跑 e2e、未提交、工作区脏
  - CLAUDE.md 多次记录跨文件不一致（标签正则 4 处）造成历史 bug
  - 项目零自动化测试基建，没有回归护栏
- **不在范围**:
  - HTTP server 启动 / Playwright e2e（用户多次拒绝）
  - 与本轮无关的重构（YAGNI）
  - dist/ 和 docs/ 目录下产物（由 build.sh 生成）
  - PRD.md / add-user-liangpenghui.sql / test-mobile.cjs 等未明确归属的工作区文件

## 验收标准

- 上轮 13 项修复以清晰分组提交到 main（不 push）
- 4 个子系统的 high + medium finding 全部修复并通过验证
- 纯逻辑模块（`extractTags` / `normalizeTags` / `buildTagTree` / `highlightTags`）有 node 单测覆盖
- 标签正则 4 处一致性可由脚本自动检查
- 审查报告 + CLAUDE.md + AGENTS.md 同步更新到 2026-05-15
- 所有改动按子系统分 commit，不 push（用户最终决定）

---

## 整体流程

```
Phase 0  提交上轮 13 项修复（3 commits）
  ↓
Phase 1  4 个 Explore agent 并行扫描 → raw findings × 4
  ↓
Phase 2  合并、去重、跨文件一致性二次扫
  ↓
Phase 3  打分（severity × subsystem）→ 修复清单
  ↓
Phase 4  按子系统批量修（每子系统 1 commit）
  ↓
Phase 5  纯逻辑模块加 node 单测
  ↓
Phase 6  Verification（语法 + 单测 + build）
  ↓
Phase 7  文档同步 + 全部 commit（不 push）
```

---

## Phase 0 — 提交存量

按 CLAUDE.md「下一步 #2」记录的 3 commit 策略落地未提交的上轮修复：

1. **commit 1 — 数据安全 6 项 (A/B/C/D/E/F)**
   主要文件：`js/db-supabase.js`、`js/app.js`
   覆盖：syncFromCloud 中间态空白、idbClear 跨用户清、本地模式持久化、本地 ID 撞、标签计数读改写竞争、signOut 不清缓存

2. **commit 2 — PC 主流程 3 项 + init 幂等**
   主要文件：`js/app.js`、`js/modules/editor.js`、`js/modules/search.js`
   覆盖：首登 FAB / 本地模式 FAB / Editor.init / SearchModule.init 幂等

3. **commit 3 — 性能 4 项 + Mobile P6**
   主要文件：`js/modules/tags.js`、`js/db-supabase.js`、`mobile/js/app.js`
   覆盖：buildTagTree 缓存、P5、P8、Mobile tagSearchKey debounce

**单独处理**：
- `build.sh`、`.workbuddy/memory/` 单独 commit 4（基建）
- `PRD.md`、`add-user-liangpenghui.sql`、`test-mobile.cjs` 暂不动（不确定归属，审查阶段询问用户决定）
- `dist/` 和 `docs/` 同步包含在每个 commit（build.sh 生成）

---

## Phase 1 — 并行扫描

开 4 个 `Explore` 类型的 subagent，并行读各自子系统范围：

| Agent | 文件范围 | 重点关注 |
|---|---|---|
| 1 - Sync/DB | `js/db.js` (676行) + `js/db-supabase.js` (787行) | 事务 / 竞争 / 异步保护 / 错误吞掉 / SQL 注入 / 接口签名一致性 |
| 2 - 笔记主流程 | `js/modules/{editor,timeline,tags,search}.js` | DOM/事件绑定泄漏、标签正则、XSS、Vue 响应式陷阱、init 幂等 |
| 3 - 用户/导出/工具 | `js/modules/{user,export}.js` + `js/utils/*` | 文件读写边界、JSZip 异常、图片压缩失败处理、flomo 导入兼容 |
| 4 - Mobile | `mobile/js/app.js` | 与 PC 不同步逻辑、共享数据层调用规范、与 PC 行为一致性 |

### 强制输出格式

每个 agent 输出 markdown，每条 finding 必须包含：

```
### Finding #<N>
- 文件: <relative-path>:<line-or-range>
- 严重度: high | medium | low
- 类型: bug | perf | smell | inconsistency | security
- 描述: <一句话>
- 建议修复: <具体到能执行>
- 复现路径: <如适用>
```

Agent 不写代码，只输出 findings。

---

## Phase 2 — 合并 + 跨文件一致性二次扫

### 合并去重
4 个 agent finding 表里大概率有：
- 重复（同一 bug 出现在多文件）
- 遗漏（agent 看不到跨子系统不一致）

我亲自做合并，重复条合并为一条并列出所有受影响位置。

### 跨文件二次扫（Explore agent 难以胜任）
必须人工核对的项：

1. **标签正则 4 处完全一致**（CLAUDE.md 已知坑 #5）
   - `js/modules/editor.js` `extractTags`
   - `js/modules/timeline.js` `highlightTags`
   - `js/db-supabase.js` `extractTagsFromContent`
   - `mobile/js/app.js` `extractTags` + `highlightTags`

2. **PC vs Mobile 行为一致**
   - `extractTags` / `highlightTags` 行为相同
   - `normalizeTags` 输入边界覆盖相同（字符串/数组/null/逗号）

3. **db.js vs db-supabase.js 接口签名一致**
   - `addNote` / `updateNote` / `getNoteById` / `deleteNote` 全部 async
   - tags 参数与返回值一律是数组
   - 错误抛出方式一致（throw vs return null）

4. **Init 幂等守门标志命名一致**
   - `_editorBound` / `_searchBound`（element 级）
   - `globalListenersAttached`（document 级）

5. **错误处理风格**
   - 是否一律 try/catch 还是 Promise.catch
   - 错误日志是否一律走 `console.error` + 用户提示

6. **Markdown 输出**：跨文件不一致进入 finding 表新增条目

---

## Phase 3 — 打分

按已对齐策略「高+中修，低报告」：

| 严重度 | 处理 | 例子 |
|---|---|---|
| **High** | 必修 | 数据丢失、跨账号串数据、主流程不可用、XSS / SQL 注入 |
| **Medium** | 修 | 竞态、性能瓶颈、内存泄漏、跨文件不一致、错误吞掉、UX 卡死 |
| **Low** | 仅报告 | 代码风格、注释缺失、命名、可读性、潜在但未触发的 edge case |

输出文件：

- `docs/superpowers/specs/findings-raw-2026-05-15.md` — 4 agent + 我二次扫的原始汇总
- `docs/superpowers/specs/findings-scored-2026-05-15.md` — 按 severity × subsystem 排好的修复清单

---

## Phase 4 — 按子系统批量修

修复顺序（按数据安全 → 主流程 → 体验）：

1. `js/db-supabase.js` + `js/db.js`（数据层 high+medium） → 1 commit
2. `js/modules/*.js`（主流程 high+medium） → 1 commit
3. `mobile/js/app.js`（mobile high+medium） → 1 commit

每个子系统修完：
- `node --check <file>` 语法过
- 相关单测跑过（Phase 5 完成后开始要求）
- `bash build.sh` 通过
- commit 信息写明 finding 编号与修复策略

> 修复期间如果某子系统 high finding > 5，**停下来跟用户讨论是否拆 PR**，避免 diff 失控。

---

## Phase 5 — 纯逻辑模块单测

### 测试位置与运行
- 位置：`tests/unit/<module>.test.cjs`
- 运行：`node tests/run-all.cjs`
- 框架：node 内置 `assert`，不引入 jest / vitest（保持零构建）
- 不跑 DOM 相关代码

### 测试矩阵

| 模块 | 文件位置 | 测试点 |
|---|---|---|
| `extractTags` (PC + Mobile) | editor.js / mobile/js/app.js / db-supabase.js | 中英、连字符、单引号、斜杠层级、`#campaign2` 不抓、URL fragment 不抓、空内容、纯标点 |
| `normalizeTags` (PC + Mobile) | db.js / db-supabase.js / mobile/js/app.js | string / array / null / 逗号串 / 含空格 |
| `buildTagTree` | js/modules/tags.js | 单层、多层、空、置顶顺序、缓存命中、缓存失效 |
| `highlightTags` (PC + Mobile) | timeline.js / mobile/js/app.js | XSS（tag name 含 `<script>`）、转义、嵌套标签、URL 中的 `#` 不被高亮 |

### 跨文件正则一致性脚本
`tests/check-regex-sync.cjs`：

- 提取 4 个文件中的标签正则字面量
- 字符串相等比对
- 不一致直接 exit 1，CI 友好

---

## Phase 6 — Verification

完成所有修复后强制跑（用 `superpowers:verification-before-completion`）：

```bash
# 1. 全部 js 文件语法
find js mobile/js -name "*.js" -exec node --check {} \;

# 2. 单测全跑
node tests/run-all.cjs

# 3. 构建产物对齐
bash build.sh
git diff --stat dist/ docs/   # 确认 build 输出和源文件一致

# 4. 标签正则 4 处一致性
node tests/check-regex-sync.cjs
```

任一失败就回到 Phase 4 修。**禁止用「应该没问题」收尾**。

---

## Phase 7 — 文档同步与提交

1. 写审查报告 `docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md`
   - 全部 finding（含 low 仅报告项）
   - 修复对照表（finding# ↔ commit）
   - 单测覆盖说明

2. 更新 `CLAUDE.md`：
   - 「Bug 表格」追加新发现的 high/medium
   - 「重要决策记录」追加单测引入决策
   - 「已知坑」追加正则一致性脚本说明
   - 「最后更新」改 2026-05-15
   - 「当前进度」回到干净状态

3. 同步 `AGENTS.md` 到 v1.3.2 + 本轮变更（CLAUDE.md TODO 已挂）

4. 全部改动按子系统 commit，**不 push**

---

## 风险与回退

| 风险 | 触发条件 | 回退动作 |
|---|---|---|
| 子系统修复超量 | 单子系统 high finding > 5 | 停下来跟用户商量拆 PR |
| 单测引入回归 | Phase 5 单测暴露已存在 bug | 单测先 skip 标记，回到 Phase 4 修，再开启单测 |
| build.sh 失败 | dist/docs 同步异常 | 检查 build.sh，必要时单独成 commit 修 |
| 任一 phase 卡 > 30 min | 进展停滞 | 停下来报告，跟用户对齐再继续 |
| Agent 输出质量差 | finding 表过于笼统 / 错位 | Phase 2 我亲自重审该子系统，不让低质量 finding 影响评分 |

---

## 完成定义 (DoD)

- [ ] 上轮 13 项修复以 3 commit 提交到 main（不 push）
- [ ] 4 子系统全部 high + medium finding 修复并 commit
- [ ] `tests/unit/` 单测覆盖 4 个纯逻辑模块
- [ ] `tests/check-regex-sync.cjs` 通过
- [ ] `bash build.sh` 通过
- [ ] 审查报告写完
- [ ] CLAUDE.md / AGENTS.md 同步更新
- [ ] 用户最终决定 push 或继续在本地
