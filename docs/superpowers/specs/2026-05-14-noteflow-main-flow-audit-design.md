# Noteflow 主流程 Bug + 性能修复 Design

**日期**：2026-05-14
**起因**：用户要求全面检查主流程 bug 并优化性能。已修过 3 个 PC 主流程致命 bug（首登 FAB 失效 / 本地模式 FAB 失效 / Editor.init 不幂等）。本文档涵盖剩余 14 项候选问题的处置。

## Scope

经过静态分析，原本 14 项候选最终保留 11 项实际有价值的修复，分 3 阶段执行。下表标注最终决策。

### Phase 1 — 数据安全（6 项，全做）

| ID | 问题 | 根因 | 方案 |
|---|---|---|---|
| A | syncFromCloud 中间态空白 | `idbClear` 与逐条 put 不在同事务内 | 单事务批量 clear+put |
| B | idbClear 跨用户清数据 | `idbClear('notes')` 清整张表 | 改为按 user_id 索引 cursor 删除 |
| C | localMode 不持久 | 没存 localStorage | `enterLocalMode` 写 flag，DB.init 还原 |
| D | 本地 ID 可能冲突 | `Date.now()+random*10000` 可撞 | 全局 counter `Date.now()*1000+(++counter)` |
| E | 标签计数读改写竞争 | 无事务 | `updateTagCount` 包进 `readwrite` 事务 |
| F | signOut 不清缓存 | 老用户数据残留 IDB | 退出时 cursor 删当前用户 notes/tags + clear sync_queue |

### Phase 2 — 性能高收益（4 项）

| ID | 问题 | 方案 |
|---|---|---|
| P1 | syncFromCloud 串行 1687 次 await | 单事务批量 put（与 A 合并） |
| P3 | buildTagTree 每次 refresh 重建 | 按 tags 数组身份缓存 |
| P5 | extractTagsFromContent 在 filter 热路径反复跑 | 一次性在 syncFromCloud 归一化时算好，写入 normalized.tags |
| P8 | 多标签 addNote 多次 idbGetAllByIndex | 一次读 + 单事务批量 put |

### Phase 3 — 低优先优化（1 项）

| ID | 问题 | 方案 |
|---|---|---|
| P6 | Mobile 标签搜索每次输入都重算 computed | tagSearchKey 加 200ms debounce |

### 跳过项（用户已知，原因附后）

- **P2 Timeline 全量重绘** — 50 条卡片 innerHTML 实测 5-10ms，非瓶颈；真正解法是虚拟滚动，工作量超本次。改用 `replaceChildren` 提供边际收益不值修。
- **G getRandomNotes 全表 shuffle** — 1687 条 shuffle ~5ms；优化为 cursor.advance 跳读 IDB 反而因 async 开销变慢。**N=10/M=1687 规模下不优化**。
- **P4 getNotes 全扫** — 1687 条全扫 + 过滤实测 ~10ms；改 cursor + early-bail 仍需走完才能算 total，无明显收益。
- **P7 Mobile v-for 无虚拟化** — 当前每页 30 条，分页加载，1000+ 节点滚动卡顿确实存在，但虚拟滚动是大改动，超本次范围。

## 实施顺序

```
Phase 1 (数据安全) → build & syntax check → commit
Phase 2 (高收益 perf) → build & syntax check → commit
Phase 3 (低优先) → build & syntax check → commit
```

每个 Phase 独立 commit，可单独 revert。用户可在任一阶段中止或回滚。

## 验证

- 每阶段：`node --check` 改过的所有 .js 文件 + `bash build.sh` 同步 dist/docs
- 全部完成后：用户浏览器手动跑主流程（清 localStorage → 登录 → 发布 → 切标签 → 搜索 → 退出 → 重登）
- 没有自动化 e2e

## 回滚

每阶段单独 commit。出问题：`git revert <sha>` 单独回退。

## 不在范围内

- AGENTS.md 同步（独立任务）
- 未提交文件去留（PRD.md / add-user-liangpenghui.sql / test-mobile.cjs）
- 数据迁移到不同后端
- 安全审计（XSS/CSP/RLS）
