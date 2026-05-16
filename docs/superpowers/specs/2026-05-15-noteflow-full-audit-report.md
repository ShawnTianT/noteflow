# Noteflow 全量审查 — 完成报告 (2026-05-15 → 2026-05-16)

> 修复范围：High + Medium 全修，Low 仅报告。共 4 个 PR/commit（数据层 / 主流程 / 导出 / Mobile），不 push。
> Spec：[设计](./2026-05-15-noteflow-full-audit-design.md) · [Finding 原始](./findings-raw-2026-05-15.md) · [Finding 打分](./findings-scored-2026-05-15.md)

## 1. 概览

| 维度 | 数 |
|---|---|
| 扫描子系统 | 4（数据层 / 主流程 / 用户·导出 / Mobile） |
| 总 finding | 50+（含 Low 仅报告） |
| High 修 | 9（SDB-1/2, NF-1/2, UEU-1/2/3/4/5 + MOB-1/2） |
| Medium 修 | 23+ |
| Low 仅报告 | 20+ |
| 单测引入 | 4 套 + 1 一致性脚本（共 95 assertions） |

## 2. Finding × Commit 对照

### PR1 数据层 (`js/db-supabase.js` + `js/db.js`)

| Finding | 修复策略 | Commit |
|---|---|---|
| **SDB-1** syncFromCloud `tags` typo | rebuiltTags | `50a9c79` |
| **F-NT-2** normalizeTags 差异 | db.js JSON.parse 试探对齐 db-supabase.js | `50a9c79` |
| **SDB-2** addNotesBatch tag count 未累计 | 批量循环累计 tagCountMap，事务结束合并入 IDB | `e2cf95c→e52cf95` |
| **SDB-5** addNote 不 async / saveDb 失败吞 | addNote 改 async；saveDb 抛错；dirtyVersion 替代 boolean | `e52cf95` |
| **SDB-6** SQLite 原子性 | withTransaction(fn) 封装 + 改造 updateNote/deleteNote/updateTagCount | `e52cf95` |
| **SDB-7** IDB 事务原子性 | updateNote/deleteNote notes+tags+sync_queue 合并单事务 | `e52cf95` |
| **SDB-3** 跨用户隔离 | getNoteById/updateNote/deleteNote 校验 user_id | `d26a6a3` |
| **SDB-8** 同步竞态 | addNote/updateNote/deleteNote 入口等待 pendingSyncPromise | `d26a6a3` |
| **SDB-9** 错误吞 | syncFromCloud/syncToCloud 失败 showToast；getSyncStatus 暴露 error | `d26a6a3` |
| **SDB-4** 双 DB 接口签名 | db.js 同步接口包 Promise.resolve；camelCase↔snake_case 适配 | `fc78f3d` |

### PR2 主流程 (`js/modules/*.js` + `mobile/js/app.js` 部分)

| Finding | 修复策略 | Commit |
|---|---|---|
| **NF-1** IME Enter 误发布 | `isComposing` / `keyCode === 229` 守门 | `8deb38f` |
| **NF-2** 时区 UTC | groupByDate/formatTime/formatDateLabel 走本地时区 | `8deb38f` |
| **NF-3** 发布并发 | 模块级 `isSending` + finally 复位 | `8deb38f` |
| **NF-4** search vmRef 闭包 | 模块级 vmRef + listener 内读 vmRef | `8deb38f` |
| **NF-5** paste 误拦 | publish-modal active / activeElement #note-input 守门 | `8deb38f` |
| **NF-6** tag cache 失效 | (ref+length) → (ref+name:count 签名)，附回归用例 | `8deb38f` |
| **NF-7** pinned tags key | getCurrentUserId 为假值时跳过；savePinnedTags try/catch | `8deb38f` |
| **MOB-5** mobile pinned tags 同款 | 联动 NF-7 | `8deb38f` |

### PR3 用户·导出·工具 (`js/utils/*.js` + `js/modules/export.js` + `js/app.js` + `mobile/js/app.js` 部分)

| Finding | 修复策略 | Commit |
|---|---|---|
| **UEU-1** imageHelper fire-and-forget | 小图删除 saveToLocal 分支，仅走 base64 | `124fca5` |
| **UEU-2** exportFlomo 漏 file 图 | type=file 跳过 + console.warn；HTML 不渲染 → 不死链 | `124fca5` |
| **UEU-3** flomoImport 丢图 | 多 selector 兼容；分流 data:base64→image_data，路径→image_paths | `124fca5` |
| **UEU-4** doSignOut 不清状态 | js/app.js 显式清 Vue 状态 + 强制 renderNotes([])/renderTags([]) | `124fca5` |
| **UEU-5** import 去重 OOM | 流式分页 (500/页)，仅保留 dedup key Set；安全上限 10w | `124fca5` |
| **UEU-6** 去重 key 弱 | (完整 created_at + 完整 content) 替代 (date.slice(0,10) + 50 字符) | `124fca5` |
| **UEU-7** 大文件 OOM | imageHelper 加 20MB 单图上限 | `124fca5` |
| **UEU-8** canvas.toBlob null | null → reject(Error)；onerror 包 Error；Promise.race 30s 超时 | `124fca5` |
| **UEU-9** showDirectoryPicker 多次 | dirHandle 缓存模块级；AbortError/NotAllowed 清缓存 | `124fca5` |
| **UEU-10** exportJSON 内存 + 无 importJSON | 取消 pretty-print；新增 importJSON 入口 + UI 下拉 | `124fca5` |
| **UEU-11** img.src XSS | escapeAttr 转义 img.src 属性 | `124fca5` |
| **UEU-12** export/import unhandled rejection | js/app.js 全部包 try/catch + toast | `124fca5` |
| **UEU-13** zipHelper 错误处理 | JSZip 缺失抛 Error；generateAsync 失败包 Error；revokeObjectURL 延迟 1s | `124fca5` |
| **MOB-7** mobile doSignOut 同款 | 抽 resetUserState，doSignOut/backToLogin 共用 | `124fca5` |

### PR4 Mobile (`mobile/js/app.js` + `mobile/index.html`)

| Finding | 修复策略 | Commit |
|---|---|---|
| **MOB-1** updatePublishTags 漏剥 URL | 复用 extractTags；sendFromPublish 提交前再 extractTags 兜底 | `951a94a` |
| **MOB-2** debounce 跨方法漏清 | filterByTag/clearSearch/dailyReview 入口 clearTimeout + null | `951a94a` |
| **MOB-4** enterLocalMode 不 await | 改 async + Promise.all + try/catch toast | `951a94a` |
| **MOB-6** refresh 失败不清状态 | catch 清 notes=[]/noteCount=0/hasMore=false + toast | `951a94a` |
| **MOB-8** in-flight 互斥 | sendFromPublish/saveEdit/deleteFromSheet/doDelete 加 _xxLoading | `951a94a` |
| **MOB-9** dailyReview 污染 noteCount | reviewMode 标志 + exitReview()；mobile/index.html 加返回全部条 | `951a94a` |
| **MOB-10** refresh 并发去重 | _refreshSeq 序列号守卫；loadMore 锚定 seq | `951a94a` |
| **MOB-3** Markdown 渲染 | **决策 defer**（产品决定不是 bug） | — |

## 3. 单测覆盖（Phase 5 已落地）

零依赖 node 单测 harness (`tests/run-all.cjs`)：

| 测试文件 | Assertions | 覆盖 |
|---|---|---|
| `extractTags.test.cjs` | 11 | URL fragment 不抓 / 含连字符 / 嵌套层级 / 单引号 / 中英混排 |
| `normalizeTags.test.cjs` | 18 (2 impls × 9) | string / array / null / 逗号串 / JSON 串 |
| `buildTagTree.test.cjs` | 33 | 单层/多层/3+级/重复合并/排序/缓存命中/缓存失效 (含 NF-6 回归) |
| `highlightTags.test.cjs` | 33 | XSS / 嵌套 / URL 中 # 不抓 / 转义 |
| `check-regex-sync.cjs` | — | 4 处标签正则字面量一致性 |
| **总计** | **95 + sync** | — |

## 4. Low Findings（未修，仅报告）

按子系统列出，未来若要修可直接定位：

- **SDB**：SDB-11 (makeLocalId 多 tab) / SDB-12 (updateTagCount 未 markDirty) / SDB-13 (localStorage 迁移静默丢失) / SDB-14 (本地 user_id=null 混杂) / SDB-15 (syncToCloud 串行 perf)
- **NF**：NF-8 (highlightTags placeholder 冲突) / NF-10 (expandedTags 跨账号继承) / NF-11 (scrollListener 闭包不卸) — NF-12 已顺手在 NF-4 修
- **F**：F-ET-1 (标签正则不过滤 URL — 已是设计约定) / F-NT-1 (CLAUDE.md mobile normalizeTags 表述过期) / F-BTT-1 (buildTagTree 仅 2 层) / F-BTT-2 (闭包测试性)
- **UEU**：UEU-14 (HTML 实体解析不全) / UEU-15 (flomo import 跳过统计误导) / UEU-16 (user.js 名实不符) / UEU-17 (flomo export imageIndex 全局自增)
- **MOB**：MOB-11 (横屏切换不重判) / MOB-12 (listener 不卸) / MOB-13 (onScroll 非 passive) / MOB-14 (长按菜单兼容) / MOB-15 (saveEdit trim 不一致) / MOB-16 (响应式重跑 highlightTags) / MOB-17 (loadMore 失败无 backoff) / MOB-18 (normalizeToArray 应共享) / MOB-19 (build 路径约定不固化) / MOB-20 (tagSearch 清空体感)

## 5. Phase 6 Verification（已通过）

```
find js mobile/js -name "*.js" -exec node --check {} \;   → OK
node tests/run-all.cjs                                    → 4 passed, 0 failed (95 assertions)
node tests/check-regex-sync.cjs                           → 4 处一致
bash build.sh                                             → dist/ + docs/ 已更新
```

## 6. 完成定义 (DoD) 检查

- [x] Phase 0 存量提交（25 commits ahead origin/main, 不 push）
- [x] Phase 1 并行扫描（4 agent 输出，merge → findings-raw）
- [x] Phase 2 跨文件二次扫（F-* 序列：NT/ET/BTT）
- [x] Phase 3 打分（findings-scored，high/medium/low 三档）
- [x] Phase 4 按子系统批量修（4 PR/commit）
- [x] Phase 5 单测（95 assertions 全过）
- [x] Phase 6 Verification（syntax + tests + regex + build 全过）
- [x] Phase 7 文档同步（本报告 + CLAUDE.md + AGENTS.md）
- [x] 全部按子系统 commit，不 push（推送决定权交回用户）

## 7. 后续建议

1. **浏览器实测**：本轮全部修复仅过 node --check + 单测 + build，未跑 e2e。建议清 localStorage 走一遍：登录 → 发布带标签/图 → 切标签 → 搜索 → 编辑 → 删除 → 退出登录 → 重登 → 暂不登录测本地模式 → 刷新页面验证 localMode 持久化。
2. **Low 收尾**：MOB-12 (listener 不卸) 与 NF-11 (scrollListener 闭包) 是真实泄漏，下一轮可优先。
3. **MOB-3 Markdown 渲染** 需要产品决策，引入 marked + DOMPurify 之前先确认是否要扩 mobile 功能边界。
4. **push 时机**：25 commits 等用户决定何时 push。建议先浏览器实测 OK 再 push。
