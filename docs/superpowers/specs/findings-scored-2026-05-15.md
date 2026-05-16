# Noteflow 全量审查 — Scored Findings & 修复清单 (2026-05-15)

> 修复策略（已与用户对齐）：**High + Medium 全修**，Low 仅报告。3-4 个 PR 拆分，不 push（用户最终决定）。
> 详细 finding 见 [findings-raw-2026-05-15.md](./findings-raw-2026-05-15.md)。

## 总体策略

```
PR1: 数据层 (db.js + db-supabase.js + DB 接口对齐)         → Task 11
  ├── high: SDB-1, SDB-2
  └── medium: SDB-3, SDB-4, SDB-5, SDB-6, SDB-7, SDB-8, SDB-9, F-NT-2

PR2: 笔记主流程 (editor + timeline + tags + search)         → Task 12
  ├── high: NF-1, NF-2
  └── medium: NF-3, NF-4, NF-5, NF-6, NF-7

PR3: 用户/导出/工具                                          → Task 12 续 / Task 11 兜底
  ├── high: UEU-1, UEU-2, UEU-3, UEU-4, UEU-5
  └── medium: UEU-6, UEU-7, UEU-8, UEU-9, UEU-10, UEU-11, UEU-12, UEU-13

PR4: Mobile                                                  → Task 13
  ├── high: MOB-1, MOB-2
  └── medium: MOB-3, MOB-4, MOB-5, MOB-6, MOB-7, MOB-8, MOB-9, MOB-10
```

---

## PR1：数据层（Task 11）

### High（必修）

#### #SDB-1 [数据安全 / 同步]
- **修复**：`js/db-supabase.js:389` `tags` → `rebuiltTags`（参考 line 384 上下文）
- **测试**：拉起前后 `console.warn` 日志对比；事件监听器是否触发
- **预估**：5 min（1 行字面 typo 修复）

#### #SDB-2 [数据一致性]
- **修复**：`addNotesBatch` 在批量循环中累计 `tagCountMap`，事务结束后合并 `idbPut('tags', ...)` 写入；同时入 `sync_queue` 的 `updateTag` 动作
- **联动**：参考 `addNote` line 591-616 的事务模式
- **测试**：写一个集成测（手动 / 浏览器手测）：批量导入 5 条含 `#a #b #a` → 验证 `tags` store 中 a.count=2, b.count=1
- **预估**：30 min

### Medium（修）

#### #SDB-3 [跨用户隔离]
- **修复**：`getNoteById` / `updateNote` / `deleteNote` 获取 note 后 `if (note.user_id !== getCurrentUserId()) return null/throw`
- **测试**：单测难（需多用户 IDB），改加 console.warn 防御性日志，由 NF-7 / UEU-4 等更上层的状态清理兜底

#### #SDB-4 [接口签名一致性]
- **修复策略**（不能一夜对齐，否则牵连所有调用方）：
  - 短期：在 db.js 把同步 `getNotes` / `addNote` / `addNotesBatch` 包成 `Promise.resolve(syncResult)` 让接口形式统一 async
  - 字段命名：在 db-supabase.js 入口包一层 camelCase → snake_case 适配（向后兼容）
  - 长期：CLAUDE.md「已知坑」追加「双 DB 接口签名差异」+「调用方一律 await」约定
- **预估**：1 h

#### #SDB-5 [错误处理]
- **修复**：
  - `addNote` 改 async + `await saveDb()`
  - `saveDb` 失败 throw（或返 `{ok:false, error}`）让上层 toast
  - 用 `dirtyVersion` 替代 `dirty boolean`：每次 markDirty `++ver`，saveDb 前抓 snapshot ver，写入成功后 `if (ver === lastDirty) dirty=false`
- **预估**：45 min

#### #SDB-6 [SQLite 原子性]
- **修复**：在 db.js 封装 `withTransaction(fn)`：
  ```js
  function withTransaction(fn) {
    db.run('BEGIN');
    try { const r = fn(); db.run('COMMIT'); return r; }
    catch (e) { db.run('ROLLBACK'); throw e; }
  }
  ```
- 改造 `updateNote` / `deleteNote` / `updateTagCount` 用之
- **预估**：45 min

#### #SDB-7 [IDB 事务原子性]
- **修复**：仿 `addNote` 把 `updateNote` / `deleteNote` 的 notes/tags/sync_queue 合并到单 `idbDb.transaction([...], 'readwrite')`；标签 delta 在事务内一次算完
- **预估**：1 h

#### #SDB-8 [同步竞态]
- **修复**：addNote/updateNote/deleteNote 入口 `if (syncInProgress) await pendingSyncPromise;` 等待；或 syncFromCloud 只删 `_local !== true` 远端 id
- **预估**：30 min

#### #SDB-9 [错误吞]
- **修复**：syncFromCloud / syncToCloud 失败时通过 `Editor.showToast('同步失败：' + err.message)` 让用户知晓；update/delete 失败分支 `console.warn(error.message)`；getSyncStatus 暴露 'error' 状态
- **预估**：20 min

#### #F-NT-2 [normalizeTags 差异]
- **修复**：db.js `normalizeTags` 字符串分支引入 JSON.parse 试探（与 db-supabase.js 对齐）
- **测试**：跑 `tests/unit/normalizeTags.test.cjs` + 新增 `'["a","b"]'` 用例
- **预估**：10 min

---

## PR2：笔记主流程（Task 12）

### High（必修）

#### #NF-1 [IME 输入]
- **修复**：`js/modules/editor.js:41-44` 在 `if (e.key === 'Enter' && !e.shiftKey)` 之前加 `if (e.isComposing || e.keyCode === 229) return;`
- **测试**：手动浏览器测（中文输入 Enter）；Mobile 同样问题需 Task 13 联动检查（`mobile/js/app.js` 的 publishInput 可能没绑 keydown handler，需核实）
- **预估**：10 min

#### #NF-2 [时区]
- **修复**：`js/modules/timeline.js:214-222,248-252`
  - `groupByDate` 用 `new Date(note.created_at).toLocaleDateString('zh-CN')` 取分组 key
  - `formatTime` 用 `toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})`
  - `formatDateLabel` 的 today/yesterday 切本地
- **测试**：单测可写（注入 `Date` 模拟 UTC vs 本地）
- **预估**：30 min

### Medium（修）

#### #NF-3 [发布并发]
- **修复**：editor.js 模块级 `let isSending = false;`，sendNote 入口 `if (isSending) return; isSending = true;`，finally `isSending = false`
- 配合：fab 按钮 click handler + textarea keydown 入口同步检查
- **预估**：20 min

#### #NF-4 [search vmRef]
- **修复**：search.js 改 module-level `let vmRef = null; function init(vm) { vmRef = vm; ... }`，listener 内部用 `vmRef.setSearch(...)`
- **预估**：15 min

#### #NF-5 [paste 误拦]
- **修复**：editor.js global paste listener 顶部加 `const publishModal = document.getElementById('publish-modal'); if (!publishModal?.classList.contains('active') && document.activeElement?.id !== 'note-input') return;`
- **预估**：10 min

#### #NF-6 [tag cache 失效]
- **修复**：cache key 加内容签名 `tags.map(t => t.name+':'+t.count).join('|')` 的 hash（用简单 string 比较代替 hash 也够）
- **预估**：30 min

#### #NF-7 [pinned tags key]
- **修复**：getPinnedTags / savePinnedTags 在 getCurrentUserId 假值时跳过；savePinnedTags 包 try/catch
- 联动：MOB-5 用同款修复（提取共享 utils）
- **预估**：20 min（含 MOB-5 联动）

---

## PR3：用户/导出/工具（与 PR2 并入 Task 12，或单独 commit）

### High（必修）

#### #UEU-1 [imageHelper fire-and-forget]
- **修复**：`js/utils/imageHelper.js:157-164` await saveToLocal 后再 push；或决定小图只走 base64 不走本地（更简单）
- **建议**：选「小图只 base64」方案，少一条分支
- **预估**：15 min

#### #UEU-2 [exportFlomo 漏 file 图]
- **修复**：type='file' 时从 path 读取原文件入 zip；读不到则省略 img 而不是死链
- **预估**：45 min

#### #UEU-3 [flomoImport 丢图]
- **修复**：addNotesBatch payload 加 image_paths；尝试 `.files img / .file img / img[src]` 多选择器
- **预估**：1 h

#### #UEU-4 [signOut 不清 Vue 状态]
- **修复**：`js/app.js:doSignOut` 显式 `this.notes = []; this.tags = []; this.noteCount = 0; this.hasMoreNotes = false; this.currentTag = ''; this.searchKey = ''; Timeline.renderNotes([]); TagsModule.renderTags([], '');`
- 联动：MOB-7 用同款修复
- **预估**：20 min（含 MOB-7 联动）

#### #UEU-5 [import 去重 OOM]
- **修复**：去重改用 SQL/IDB 查询 + 按 `created_at` 范围筛而非全量；或先按 created_at 索引拉范围内 notes
- **预估**：1 h

### Medium

#### #UEU-6 [去重 key 太弱]
- 改用 全文哈希 + 完整 created_at；UI toast 提示被跳条目
- **预估**：20 min

#### #UEU-7 [大文件 OOM]
- 检查 file.size 上限提示；onerror/onabort reject
- **预估**：15 min

#### #UEU-8 [canvas.toBlob null]
- `if (!blob) return reject(new Error('toBlob failed'))`；img.onerror reject Error；Promise.race 加 30s 超时
- **预估**：20 min

#### #UEU-9 [showDirectoryPicker 多次]
- 缓存目录 handle 到 sessionStorage 或模块级变量；区分 AbortError
- **预估**：30 min

#### #UEU-10 [exportJSON 内存 + 无 importJSON]
- 取消 pretty-print（直接 `JSON.stringify(data)`）；新增 importJSON 入口
- **预估**：45 min

#### #UEU-11 [img.src XSS in flomo export]
- escapeHtml(img.src) 或属性级转义
- 联动：NF-9 用同款修复
- **预估**：15 min（含 NF-9 联动）

#### #UEU-12 [export/import unhandled rejection]
- app.js 包 try/catch + toast
- **预估**：15 min

#### #UEU-13 [zipHelper 错误处理]
- try/catch 包 generateAsync；revokeObjectURL 加 setTimeout 1000ms；JSZip 缺失走 toast
- **预估**：20 min

---

## PR4：Mobile（Task 13）

### High（必修）

#### #MOB-1 [updatePublishTags 漏剥 URL]
- **修复**：`mobile/js/app.js:403-414` `updatePublishTags` 起手 `text = (text||'').replace(/https?:\/\/\S+/g, ' ');`；或直接复用 `this.extractTags(this.publishInput)`
- 兜底：sendFromPublish 提交前再调 `this.extractTags(text)`
- **预估**：15 min

#### #MOB-2 [debounce 跨方法漏清]
- **修复**：`mobile/js/app.js:358-366` filterByTag / clearSearch 入口加 `clearTimeout(this.searchDebounceTimer); this.searchDebounceTimer = null;`
- **预估**：10 min

### Medium

#### #MOB-3 [Markdown 渲染]
- **决策**：要不要引入 marked + DOMPurify？这是产品决定不是 bug
- **建议**：本轮**跳过**（不在审查范围内的功能扩展），改归类为 low + 文档化决定
- **预估**：0（决策为 defer）

#### #MOB-4 [enterLocalMode 不 await]
- 改 async + `await Promise.all([refreshNotes, refreshTags])` + try/catch toast
- **预估**：15 min

#### #MOB-5 [pinned tags key]
- 联动 NF-7，用共享工具函数
- **预估**：包含在 NF-7 内

#### #MOB-6 [refresh 失败不清状态]
- catch 中刷新场景 notes=[]/noteCount=0/hasMore=false + toast
- **预估**：15 min

#### #MOB-7 [doSignOut 不清状态]
- 抽 `resetUserState()` 集中复位
- 联动：UEU-4 同款思路（PC 和 Mobile 各自一份）
- **预估**：包含在 UEU-4 联动内

#### #MOB-8 [in-flight 互斥缺失]
- sendFromPublish / saveEdit / deleteFromSheet / doDelete 加 publishLoading/editLoading/deleting 标志
- **预估**：30 min

#### #MOB-9 [dailyReview 污染 noteCount]
- 独立 reviewMode 标志；header 加「返回全部」按钮
- **预估**：20 min

#### #MOB-10 [请求并发去重]
- 序列号守卫 `_refreshSeq`
- **预估**：20 min

---

## Low Findings (仅报告，本轮不动)

按子系统列出，每条简述。未来如要修可直接参考。

- **SDB-10**：db.js 缺 JSON.parse → 已升级为 F-NT-2 中优修
- **SDB-11**：makeLocalId 多 tab 撞 id 风险
- **SDB-12**：updateTagCount 未 markDirty
- **SDB-13**：localStorage 迁移失败静默丢数据
- **SDB-14**：本地模式 user_id=null 混杂他人残留 → UEU-4 修复后影响减小，可降级
- **SDB-15**：syncToCloud 串行 perf
- **NF-8**：highlightTags `\x00URL\d+\x00` placeholder 冲突风险
- **NF-9**：img.src 属性 XSS → 已联动 UEU-11 中优修
- **NF-10**：expandedTags 跨账号继承
- **NF-11**：scrollListener 闭包不卸
- **NF-12**：debounceTimer 跨 init 共享 → NF-4 修后顺带处理
- **F-ET-1**：标签正则不过滤 URL（已是设计约定，文档化即可）
- **F-NT-1**：CLAUDE.md 说 mobile 有 normalizeTags（doc bug，Task 15 修）
- **F-BTT-1**：buildTagTree 仅 2 层（视觉无 bug，未来视需求重构）
- **F-BTT-2**：buildTagTree 闭包绑定测试性（已用 stub 绕过）
- **UEU-14**：flomoImport HTML 实体解析不全
- **UEU-15**：flomo import 跳过统计误导
- **UEU-16**：user.js 名实不符 → 若做 UEU-4 重构可顺手处理
- **UEU-17**：flomo export imageIndex 全局自增
- **MOB-11**：横屏切换不重判
- **MOB-12**：listener 不卸（mounted lifecycle）
- **MOB-13**：onScroll 非 passive
- **MOB-14**：长按菜单兼容
- **MOB-15**：saveEdit trim 不一致
- **MOB-16**：每次响应式重跑 highlightTags（perf）
- **MOB-17**：loadMore 失败无 backoff
- **MOB-18**：normalizeToArray 应共享
- **MOB-19**：build 路径约定不固化
- **MOB-20**：tagSearch debounce 清空体感

---

## 修复执行顺序（Task 11-13）

```
Task 11 = PR1（数据层）
  顺序：SDB-1（最快验证） → SDB-2（一致性核心） → SDB-3,5,6,7,8,9,F-NT-2（数据安全/原子性）
        → SDB-4（最大改动留最后，作为 PR1 终章）
  约 5-6 h

Task 12 = PR2（主流程）+ PR3（导出/工具）
  顺序：NF-1,2（用户痛点） → NF-3,4,5,6,7（中优）
        → UEU-1,2,3,4,5（high）→ UEU-6-13（medium）
  约 6-7 h

Task 13 = PR4（Mobile）
  顺序：MOB-1,2（high）→ MOB-4,6,7,8,9,10（medium，跳 MOB-3 + 联动 MOB-5,7）
  约 3-4 h

Task 14 = Verification（必跑：node --check / 单测 / regex-sync / build）
Task 15 = 文档同步（CLAUDE.md / AGENTS.md / audit-report）
```

**总预估**：~15-18 h 工时。考虑到 subagent 并行 + Plan 的高 spec 化，实际墙钟时间应在 4-6 h 之间。
