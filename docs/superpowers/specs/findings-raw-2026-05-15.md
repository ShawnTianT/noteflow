# Noteflow 全量审查 — Raw Findings (2026-05-15)

> 4 个 Explore agent 并行扫描原始输出 + 单测发现，未做去重和打分。Task 9 跨文件二次扫追加，Task 10 后产出 findings-scored。

**总数**：64 项（11 high / 27 medium / 26 low），加上 5 项单测发现的 F-* finding。

| 子系统 | High | Medium | Low | 合计 |
|---|---|---|---|---|
| Sync/DB (SDB) | 2 | 7 | 6 | 15 |
| 笔记主流程 (NF) | 2 | 5 | 5 | 12 |
| 用户/导出/工具 (UEU) | 5 | 7 | 5 | 17 |
| Mobile (MOB) | 2 | 8 | 10 | 20 |
| 单测 (F-) | 0 | 1 | 4 | 5 |

---

## 单测阶段发现的 finding（Tasks 3-7）

### Finding #F-ET-1
- 文件: `js/modules/editor.js:173`、`js/modules/timeline.js:192`、`js/db-supabase.js:130`、`mobile/js/app.js:405,576,596`
- 严重度: low (info)
- 类型: smell
- 描述: 标签正则 `/#([\w一-龥'-]+(?:\/[\w一-龥'-]+)*)/g` 本身会从 URL `#anchor` 抓取，URL 过滤必须在调用层做（已确认 timeline.js / mobile/js/app.js 用 `\x00URL{N}\x00` placeholder 过滤）。
- 建议修复: 文档化「正则不过滤 URL，调用层负责」约定到 CLAUDE.md。Task 9 二次扫确认所有调用方都做了 URL 剥离 → 见 #MOB-1（mobile updatePublishTags 漏剥）。

### Finding #F-NT-1
- 文件: `mobile/js/app.js`（全文搜「normalizeTags」无结果）
- 严重度: low
- 类型: inconsistency
- 描述: CLAUDE.md「关键技术点 → 双数据库」声称「两侧均提供 normalizeTags」。实际 `mobile/js/app.js` 没有自己的 `normalizeTags`，通过 `../js/db-supabase.js` 共享。文档过期。
- 建议修复: Task 15 改 CLAUDE.md。

### Finding #F-NT-2
- 文件: `js/db-supabase.js:145-148` vs `js/db.js`
- 严重度: medium
- 类型: inconsistency
- 描述: `db-supabase.normalizeTags` 在字符串分支多了 `JSON.parse` 回退，`db.js` 没有。input `'["a","b"]'` 在两端会得到不同结果（supa 解析为 `['a','b']`，db.js 按逗号分裂为 `['["a"', '"b"]']`）。如果 db.js 在导入流吃到 db-supabase 旧导出的 JSON 字符串会写入坏数据。
- 建议修复: db.js 引入相同的 JSON.parse 回退（与 SDB-10 重复）。

### Finding #F-BTT-1
- 文件: `js/modules/tags.js:122-130`
- 严重度: low
- 类型: smell / 名实不符
- 描述: `buildTagTree` 仅做 first-slash split，3+ 层标签 `a/b/c` 会塌缩为 `{name: 'a', children: [{name: 'a/b/c'}]}`，且子节点没有自己的 `.children`。UI 端 `renderTagNode` 也只渲染两层，所以视觉无 bug，但接口语义不一致。
- 建议修复: 改名 `buildTwoLevelTagTree` 或递归实现真树形结构（需 UI 同步改）。

### Finding #F-BTT-2
- 文件: `js/modules/tags.js`
- 严重度: low
- 类型: smell / 可测试性
- 描述: `buildTagTree` 在 `TagsModule = (function(){...})()` IIFE 内部 + 闭包级 `_treeCache`，外部不可独立 require。本轮单测用 brace-pairing + cache stub 绕过。
- 建议修复: 拆 tags.js 为可独立 require 的模块（ES module 导出），便于深度测试。

---

## 子系统: Sync/DB (SDB)

### Finding #SDB-1 🚨
- 文件: `js/db-supabase.js:389`
- 严重度: **high**
- 类型: bug
- 描述: `syncFromCloud` 末尾 `dispatchEvent` 引用未声明标识符 `tags`（应为 `rebuiltTags`），抛 `ReferenceError` 被 try/catch 静默吞掉，导致 `noteflow:sync-complete` 事件**永远不派发**。CLAUDE.md commit `dd52d85`「sync 完成后自动刷新 UI」修复实质已被破坏。
- 建议修复: 改为 `tagCount: rebuiltTags.length`。
- 复现路径: 任意登录态调用 `syncFromCloud` → 控制台必现 "tags is not defined" 警告。

### Finding #SDB-2 🚨
- 文件: `js/db-supabase.js:644-683`
- 严重度: **high**
- 类型: bug
- 描述: `addNotesBatch` 仅写 notes 和 sync_queue，**完全没更新 tags store 计数**。批量导入后 `getTags()` 计数偏低/缺失，云端 tags 与 notes 表不一致。单条 addNote 在事务内维护 tags（line 591-616），批量是漏写。
- 建议修复: 批量循环累计 tagCountMap，事务结束后合并 put；或 batch 后调 `rebuildTagCounts(uid)` 兜底。
- 复现路径: 登录态导入含 `#tag` 笔记 → 标签栏计数不增加。

### Finding #SDB-3
- 文件: `js/db-supabase.js:560-562`、`685-687`、`720-721`
- 严重度: medium
- 类型: security / cross-user 数据泄漏
- 描述: `getNoteById` / `updateNote` / `deleteNote` 仅用主键查找，**不校验 user_id**。signOut 修复 #B 只清当前用户，但前一次会话残留数据 + 当前用户传入对方 id 时，会读/写/删对方缓存。
- 建议修复: 三函数获取 note 后比较 user_id，或用 idbGetAllByIndex by user_id 查找。

### Finding #SDB-4
- 文件: `js/db.js:420-422,322-380,260-284,291-316` vs `js/db-supabase.js:502-558,560-562,564-642,644-683`
- 严重度: medium
- 类型: inconsistency
- 描述: 两个 DB 实现的接口签名差异多处（async-ness / 返回值类型 / 字段命名 driver 大小写 / 默认 page）：
  1. `getNotes`: db.js 同步 / db-supabase async
  2. `addNote`: db.js 返回 lastInsertRowId / supa 返回完整 note 对象
  3. `addNotesBatch`: db.js 返回 imported 数 / supa 返回数组
  4. 字段：db.js 用 `imagePaths/imageData/isDone`（驼峰）/ supa 用 `image_paths/image_data/is_done`（蛇形）
  5. 默认 pageCurrent: db.js=0 / supa=1
- 建议修复: 统一 async + snake_case + 返回完整对象，写入 CLAUDE.md。

### Finding #SDB-5
- 文件: `js/db.js:260-284,442-464,469-480`
- 严重度: medium
- 类型: bug / smell
- 描述: addNote/updateNote/deleteNote 末尾 `saveDb()` 未 await，`saveDb` 失败仅 console.error 返回 false，UI 无感知 → quota 满时用户看到「已保存」但实际丢失；同时 dirty=false 覆盖会与 `markDirty` 形成竞争。
- 建议修复: addNote 改 async + await saveDb；saveDb 失败抛错；用 dirtyVersion 替代 dirty boolean。

### Finding #SDB-6
- 文件: `js/db.js:442-464,469-480,487-513`
- 严重度: medium
- 类型: bug / 原子性
- 描述: db.js 的 updateNote / deleteNote / updateTagCount 没用 SQLite BEGIN/COMMIT 包裹。中间步骤抛错或 saveDb export 拍快照时间窗口内会留半旧半新状态。
- 建议修复: 入口 `db.run('BEGIN')` + try/catch ROLLBACK；或封装 `withTransaction(fn)`。

### Finding #SDB-7
- 文件: `js/db-supabase.js:685-718,720-742`
- 严重度: medium
- 类型: bug / race
- 描述: `updateNote` 对每个旧/新标签独立 await `updateTagCount`，每次独立 IDB 事务。并发 add/update/delete 触及同一标签会冲突。addNote（591-616）正确做法（合并到单事务），update/delete 没遵循。
- 建议修复: 仿 addNote 把 notes/tags/sync_queue 合并到单 `idbDb.transaction([...], 'readwrite')`。

### Finding #SDB-8
- 文件: `js/db-supabase.js:316-396`
- 严重度: medium
- 类型: bug / race
- 描述: `syncFromCloud` 用 `syncInProgress` 互斥 `syncToCloud`，但**不阻塞用户写路径**。同步期间用户 addNote 可能被随后的 cursor.delete 删掉。
- 建议修复: addNote/updateNote/deleteNote 在 syncInProgress=true 时 await 等待；或 syncFromCloud 只删 `_local !== true` 远端 id，保留本地未同步条目。

### Finding #SDB-9
- 文件: `js/db-supabase.js:316-396,398-482`
- 严重度: medium
- 类型: smell / error swallowing
- 描述: `syncFromCloud` 整个 catch 仅 `console.warn`，UI 无失败信号；`syncToCloud` 没有外层 catch，update/delete 失败分支静默不打 error.message。
- 建议修复: 抛错给上层；UI 用 getSyncStatus() 暴露 'error'；失败分支 `console.warn(error.message)`。

### Finding #SDB-10
- 文件: `js/db.js:227-233` vs `js/db-supabase.js:141-152`
- 严重度: low
- 类型: inconsistency
- 描述: 已知 F-NT-2，db.js 缺 JSON.parse 分支。如吃到 supa 旧导出 JSON 字符串会写入坏数据。
- 建议修复: db.js 引入对齐的 JSON.parse 试探。

### Finding #SDB-11
- 文件: `js/db-supabase.js:27-30`
- 严重度: low
- 类型: smell / race
- 描述: `makeLocalId` 模块级 `_idCounter`，多 tab 共享同一 IDB 但各自计数器，同 ms 并发仍可能撞 id。
- 建议修复: counter 持久化到 IDB；或加 crypto.getRandomValues 唯一 prefix。

### Finding #SDB-12
- 文件: `js/db.js:487-513`
- 严重度: low
- 类型: smell
- 描述: `updateTagCount` 改 tags 表后未 markDirty。当前调用方都会 markDirty，但未来 GC 任务直接调 updateTagCount 时变更不持久化。
- 建议修复: updateTagCount 末尾 markDirty。

### Finding #SDB-13
- 文件: `js/db.js:91-106,611-614`
- 严重度: low
- 类型: smell
- 描述: localStorage 迁移失败仅 console.warn 后走「创建空 db」分支；`switchUserDb` 同模式 catch 后 `new SQL.Database()`。IDB 加载失败 + 数据损坏会导致用户旧数据被静默丢弃。
- 建议修复: 失败时抛错让 UI 提示「加载失败，请勿写入」。

### Finding #SDB-14
- 文件: `js/db-supabase.js:565-642`
- 严重度: low
- 类型: smell / 一致性
- 描述: 本地模式下 addNote 仍写 `user_id: uid`，uid=null。getNotes / getTags 走 idbGetAll 全量返回，会混杂上一次登录用户残留 + 本地模式自己写的笔记。
- 建议修复: 本地模式给固定占位 user_id（如 0/'local'），用 idbGetAllByIndex 取数；或 enterLocalMode 必须先执行 signOut 清缓存。

### Finding #SDB-15
- 文件: `js/db-supabase.js:401-481`
- 严重度: low
- 类型: smell / perf
- 描述: `syncToCloud` 串行 await 每条队列项，长队列（如批量导入数百条后）数十秒阻塞 syncInProgress=true，期间新 addNote 触发的 syncToCloud 直接跳过。配合 SDB-8 放大丢失风险。
- 建议修复: 分批 Promise.all（视 Supabase 速率）；拆 syncFromCloud / syncToCloud 各自互斥锁。

---

## 子系统: 笔记主流程 (NF)

### Finding #NF-1 🚨
- 文件: `js/modules/editor.js:41-44`
- 严重度: **high**
- 类型: bug
- 描述: textarea keydown 处理器对 Enter 不判 IME composition，中文输入法回车确认候选词时被吞掉并触发 sendNote，草稿被错误提交。
- 建议修复: `if (e.isComposing || e.keyCode === 229) return;` 在 `e.key === 'Enter' && !e.shiftKey` 之前。
- 复现路径: 输入 `今天#`，IME 候选「跑步」按 Enter 选词 → 笔记直接提交。

### Finding #NF-2 🚨
- 文件: `js/modules/timeline.js:214-222,248-252`
- 严重度: **high**
- 类型: bug
- 描述: `groupByDate` 用 `note.created_at.slice(0,10)`、`formatTime` 用正则截 ISO，UTC 字符串导致中国用户凌晨 0:00-7:59 笔记错位到「昨天」并显示 UTC 时间。
- 建议修复: 用 `new Date(...)` + `toLocaleDateString('zh-CN')` / `toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})`。
- 复现路径: 北京 2026-05-16 00:30 创建笔记 → DB created_at=2026-05-15T16:30:00Z → 分组键 2026-05-15、显示 16:30。

### Finding #NF-3
- 文件: `js/modules/editor.js:121-165`
- 严重度: medium
- 类型: bug
- 描述: `sendNote` async 期间无锁。连按 Enter 或 IME 误触并发触发多次 DB.addNote 导致重复笔记。
- 建议修复: 模块级 `isSending` 标志，进入立即 true、finally false；或 `textarea.disabled = true`。

### Finding #NF-4
- 文件: `js/modules/search.js:14-25`
- 严重度: medium
- 类型: smell
- 描述: `init(vm)` 把 vm 通过闭包捕获到 listener。第二次 `init(newVm)` 因元素守卫直接 return，listener 仍引用旧 vm。Editor 用 module-level vmRef 解决了，搜索没对齐。
- 建议修复: 改 module-level `vmRef`，listener 用 `vmRef.setSearch(...)`。

### Finding #NF-5
- 文件: `js/modules/editor.js:90-98`
- 严重度: medium
- 类型: smell
- 描述: 全局 paste listener 不检查焦点 / publish-modal 是否打开就 `e.preventDefault()` 把图片塞 pendingImages。用户在时间线浏览时 Cmd+V 粘贴图片会被静默拦截。
- 建议修复: listener 顶部判断 `publishModal.classList.contains('active') || document.activeElement?.id === 'note-input'`。

### Finding #NF-6
- 文件: `js/modules/tags.js:114-149`
- 严重度: medium
- 类型: bug
- 描述: `_treeCache` key 仅 (tagsRef, tagsLen)。in-place 修改 `tag.count` 时命中缓存返回旧 tree，UI 看似 count 不刷新；children 排序也只在 build 时一次。
- 建议修复: cache key 加内容签名（如 `tags.map(t=>t.name+':'+t.count).join('|')` 的 hash）；或文档约定禁止 in-place 修改。

### Finding #NF-7
- 文件: `js/modules/tags.js:20-36`
- 严重度: medium
- 类型: bug
- 描述: `getPinnedTags`/`savePinnedTags` 用 `DB.getCurrentUserId()` 拼 key。函数返回 null/undefined 时所有未登录共享 `noteflow_pinned_tags_undefined`，账号切换会混淆置顶；`localStorage.setItem` 无 try/catch（私密浏览或满配额会抛）。
- 建议修复: getCurrentUserId() 假值时跳过；savePinnedTags 包 try/catch 失败 toast。

### Finding #NF-8
- 文件: `js/modules/timeline.js:184-200`
- 严重度: low
- 类型: bug
- 描述: `highlightTags` 用 `\x00URL\d+\x00` placeholder。用户文本若混入 `\x00URL0\x00` 会被替换破坏完整性。
- 建议修复: 改用 PUA 区 sentinel `NF_URL_<idx>`；或先剥 \x00 再做 placeholder。

### Finding #NF-9
- 文件: `js/modules/timeline.js:124-132`
- 严重度: low
- 类型: security
- 描述: `<img src="${img.src}" ...>` 与 `data-img-src="${encodeURIComponent(img.src)}"` 中 img.src 直接拼到 innerHTML。data-img-src 安全；裸 src 未对 `"` 转义。若 image_paths 来自他人共享/绕过 RLS 含恶意构造路径可注入。
- 建议修复: 走属性转义（与 tags.js escapeAttr 对齐）；或用 DOM API 渲染。同时 `onclick="Timeline.startEdit(${note.id})"` 强制 id 类型校验。

### Finding #NF-10
- 文件: `js/modules/tags.js:10,194-223`
- 严重度: low
- 类型: smell
- 描述: 模块级 `expandedTags = new Set()` 永不清理。账号切换时上一用户展开偏好被新用户继承。
- 建议修复: 暴露 `reset()` 在 signIn/signOut 调用；或按 userId 分桶 localStorage 持久化。

### Finding #NF-11
- 文件: `js/modules/timeline.js:43-48,86-103`
- 严重度: low
- 类型: smell
- 描述: `container.onclick = handleContainerClick` 每次 renderNotes 都重置；`appendNotes` 不重置；scrollListener 闭包持续持有 contentArea，无页面级卸载入口。
- 建议修复: onclick 委托上提到 init 一次绑定；提供 `Timeline.destroy()` 在登出时移除滚动监听。

### Finding #NF-12
- 文件: `js/modules/search.js:7-46`
- 严重度: low
- 类型: smell
- 描述: 模块级 `debounceTimer` 跨 init 共享；`clearSearch` 只清 input value，不通知 vm.setSearch('')，接口语义不一致。
- 建议修复: timer 放 init closure 内；clearSearch 接受 vm 或调用 vmRef.setSearch('')，与 NF-4 一并修。

---

## 子系统: 用户/导出/工具 (UEU)

### Finding #UEU-1 🚨
- 文件: `js/utils/imageHelper.js:157-164`
- 严重度: **high**
- 类型: bug
- 描述: 小图分支 `saveToLocal(...).then(...)` fire-and-forget，processUpload 已 return imagePaths，本地保存即便成功也无法把路径写入返回值。小图永远不会出现 image_paths 字段。
- 建议修复: await saveToLocal 后再 push；或去掉小图本地保存路径（只走 base64）。

### Finding #UEU-2 🚨
- 文件: `js/modules/export.js:51-70`
- 严重度: **high**
- 类型: bug / inconsistency
- 描述: `exportFlomo` 收集图片只处理 `img.type === 'base64'`，跳过 image_paths 大图，但 generateFlomoHTML 把 img.src（可能是相对路径）写入 `<img src=...>`，导出 zip 中 HTML 引用图片在压缩包内不存在。
- 建议修复: type='file' 时从 File System Access API 或 IDB blob 读原文件入 zip；读不到则省略 img 而不是死链。

### Finding #UEU-3 🚨
- 文件: `js/utils/flomoImport.js:33-39,96-128`
- 严重度: **high**
- 类型: bug
- 描述: 解析时 images 字段被填充，但 importToDB 的 addNotesBatch payload 完全没 image 字段；选择器 `.files img` 与 flomo 实际类名（`.file`）不一定一致，多数情况 imgElements 为空。flomo 导入后图片信息全丢，无任何提示。
- 建议修复: 把 images 数组随笔记写入 image_paths（或单独字段）；解析阶段同时尝试 `.files img / .file img / img[src]`；扩展为 zip 解析。

### Finding #UEU-4 🚨
- 文件: `js/app.js:159-167`
- 严重度: **high**
- 类型: bug / security (cross-user)
- 描述: doSignOut 只清账号字段，没清空 Vue 响应式状态 (notes/tags/noteCount/hasMoreNotes/currentTag/searchKey)，没调 Timeline.renderNotes([])。退出后回到登录界面瞬间或新用户登录失败时旧 DOM 仍可见 → 跨用户数据泄露。
- 建议修复: signOut 显式 `notes=[]; tags=[]; noteCount=0; Timeline.renderNotes([]); TagsModule.renderTags([], '');`；销毁 ObjectURL。
- 复现: A 登录浏览 → 退出 → DOM 仍能看到 A 的笔记。

### Finding #UEU-5 🚨
- 文件: `js/utils/flomoImport.js:101-108`
- 严重度: **high**
- 类型: perf
- 描述: 去重 `DB.getNotes({ pageSize: 999999 })` 全部笔记拉到内存做 Set；几万条笔记单次导入触发巨量读取/反序列化/IDB 游标遍历，内存峰值 = 全部历史 + 待导入。
- 建议修复: DB 层做唯一索引或 SQL；或只查待导入 created_at 范围内旧笔记。

### Finding #UEU-6
- 文件: `js/utils/flomoImport.js:111-115`
- 严重度: medium
- 类型: bug
- 描述: 去重 key = `created_at.slice(0,10) + '|' + content.slice(0,50)`。同一天前 50 字相同（如模板化日报）会被误判重复丢弃，无告警。
- 建议修复: 用更强指纹（哈希全文 + 完整 created_at）；或 UI 提示具体被跳条目。

### Finding #UEU-7
- 文件: `js/utils/flomoImport.js:135-156`
- 严重度: medium
- 类型: bug / perf
- 描述: `await file.text()` 全量载入字符串 + DOMParser 又生成 DOM，几十 MB 文件双倍内存；无 try/catch 包文件读取（除取消选择器无 onerror/onabort）；Safari 超大 string 可能 RangeError。
- 建议修复: 检查 file.size 上限并提示；流式读取或解析后释放原字符串；onerror/onabort 也 reject。

### Finding #UEU-8
- 文件: `js/utils/imageHelper.js:17-62`
- 严重度: medium
- 类型: bug
- 描述: `canvas.toBlob` 回调没判空，浏览器在 canvas tainted/超大尺寸/编码失败时传 null，blob.size 抛 TypeError 让 Promise 永不 settle 也无 reject；img.onerror 只传 Event；无超时保护，畸形图片让上传卡死。
- 建议修复: `if (!blob) return reject(new Error(...))`；img.onerror 包 Error；Promise.race 加超时；调用前查 file.size 与维度（iOS Safari 4096px 上限）。

### Finding #UEU-9
- 文件: `js/utils/imageHelper.js:114-137`
- 严重度: medium
- 类型: bug / smell
- 描述: 每张图片都重新 showDirectoryPicker()，多图上传弹多次目录对话框，且每次返回独立 handle；同时 AbortError 与真实 IO 错误都 swallow 成 return false。
- 建议修复: 缓存目录 handle（首次询问后保留到本会话）；区分 AbortError 直接抛、其它错返 false 加 toast。

### Finding #UEU-10
- 文件: `js/modules/export.js:11-31`
- 严重度: medium
- 类型: perf / inconsistency
- 描述: `exportJSON` `JSON.stringify(..., null, 2)` 整库（含 base64）格式化为字符串再 Blob，几千条带图笔记内存翻倍；无 importJSON 入口，违反「re-importing 自家导出 yield identical state」。
- 建议修复: 取消 pretty-print，或分批 stringify；新增 importJSON。

### Finding #UEU-11
- 文件: `js/modules/export.js:113-119`
- 严重度: medium
- 类型: security
- 描述: 生成 flomo HTML 时对 note.content 调 escapeHtml，但 `<img src="${img.src}" alt="图片">` 直接插值 img.src，未做属性级转义。若 image_paths 混入恶意路径（含 `"><script>`）打开导出 HTML 会执行脚本。
- 建议修复: img.src 同样 escapeHtml 或专用属性转义；或限制白名单（仅 data:image/...; file/...）。

### Finding #UEU-12
- 文件: `js/app.js:292-305`
- 严重度: medium
- 类型: bug
- 描述: exportJSON / exportFlomo / importFlomo 都没 await，模块内 reject 变 unhandled rejection；exportJSON 模块函数无 try/catch，DB 故障时 toast 不出。
- 建议修复: app 方法 `try { await ExportModule.xxx() } catch (e) { showToast(...) }`；exportJSON 内包 try/catch。

### Finding #UEU-13
- 文件: `js/utils/zipHelper.js:12-40`
- 严重度: medium
- 类型: bug / smell
- 描述: 没有输入校验或错误转换：createAndDownload 不捕 zip.generateAsync 失败；无 streaming，全部内存构造 Uint8Array；downloadBlob 中 `URL.revokeObjectURL` 紧跟 `a.click()`，旧 Edge / iOS Safari 下载未真正发起 URL 已撤销造成空文件；JSZip 缺失用 alert() 与 toast UI 风格不一致。
- 建议修复: try/catch 包 generateAsync；`setTimeout(() => URL.revokeObjectURL(url), 1000)`；走 Editor.showToast。

### Finding #UEU-14
- 文件: `js/utils/flomoImport.js:78-88`
- 严重度: low
- 类型: bug
- 描述: cleanContent 只处理 6 个实体（`&amp; &lt; &gt; &quot; &#39; &nbsp;`），缺 `&apos;` 与所有数字实体（`&#x4e2d;` `&#20013;`）。flomo 含中文非 ASCII 时常用数字实体，结果导入后变字面量乱码。
- 建议修复: 直接用 DOMParser textContent（保留 `<br>→\n`），别用正则替换实体。

### Finding #UEU-15
- 文件: `js/utils/flomoImport.js:120-128`
- 严重度: low
- 类型: bug
- 描述: skipped = memos.length - imported，把「批量插入失败」与「重复跳过」混为一谈。toast「成功 X 条，跳过 Y 条（重复）」误导用户掩盖真实写入失败。
- 建议修复: 分别报 `dedupSkipped = memos.length - newMemos.length` 与 `failed = newMemos.length - imported`。

### Finding #UEU-16
- 文件: `js/modules/user.js:1-32`
- 严重度: low
- 类型: smell / inconsistency
- 描述: 文件标题「user.js」与职责不符，仅渲染用户名，无任何 signOut/IDB 清理逻辑。UEU-4 提到的状态清理也无人负责。
- 建议修复: doSignOut/doSignIn 中「清空 Vue 状态 + 清空 DOM 渲染」收敛到 UserModule。

### Finding #UEU-17
- 文件: `js/modules/export.js:51-58`
- 严重度: low
- 类型: smell
- 描述: 图片在 zip 中按 `note.created_at` 切目录，`imageIndex` 全局自增；用户导入某天导出再二次导出时 imageIndex 重置，文件名冲突。
- 建议修复: 用 `noteId + 序号` 或时间戳作文件名（`img_<created_at>_<idx>.jpg`）保证幂等。

---

## 子系统: Mobile (MOB)

### Finding #MOB-1 🚨
- 文件: `mobile/js/app.js:403-414` vs `573-585`
- 严重度: **high**
- 类型: bug
- 描述: `updatePublishTags`（发布弹窗实时预览）没像 `extractTags` 那样先剥 URL，链接里 `#fragment` 被识别为标签并被 sendFromPublish 直接以 publishTags 提交入库，绕过 URL 保护。
- 建议修复: updatePublishTags 起手 `text = (text||'').replace(/https?:\/\/\S+/g, ' ');`；或复用 `this.extractTags(this.publishInput)`；sendFromPublish 提交前再调 extractTags 兜底。
- 复现: FAB 输入 `看看 https://example.com/page#section 这页` → 预览显 `#section` → 发布 → 笔记被打 `section` 标签。

### Finding #MOB-2 🚨
- 文件: `mobile/js/app.js:358-366,368-379`
- 严重度: **high**
- 类型: bug
- 描述: `onSearchInput` 的 300ms debounce 计时器在 filterByTag / clearSearch 中没清除，挂起回调 ~300ms 后执行 `if (this.currentTag) this.currentTag = ''; this.refreshNotes();` 把刚选标签清掉。
- 建议修复: filterByTag / clearSearch 入口加 `clearTimeout(this.searchDebounceTimer); this.searchDebounceTimer = null;`；或 debounce 改为 watcher。
- 复现: 输入「abc」→ 300ms 内打开抽屉点标签 → 标签筛选生效约 1/3 秒后被自动清空。

### Finding #MOB-3
- 文件: `mobile/index.html:159`
- 严重度: medium
- 类型: inconsistency
- 描述: 卡片正文用 `v-html="highlightTags(escapeHtml(note.content || ''))"`，仅做转义+标签高亮，未做 Markdown 渲染；PC 端通过 marked 渲染，导致同一笔记两端呈现不一致。
- 建议修复: 评估业务是否需要一致 Markdown 体验；若是则引入 marked + DOMPurify 共享渲染函数。

### Finding #MOB-4
- 文件: `mobile/js/app.js:207-217`
- 严重度: medium
- 类型: bug
- 描述: enterLocalMode 不是 async，对 refreshNotes/refreshTags 两个 async 方法 fire-and-forget，错误只内部 console，外层无感知。数据层就绪事件晚到时页面先渲染空再补齐，noteCount/hasMore 误状态。
- 建议修复: 改 async + `await Promise.all([...])` + try/catch toast；与 mounted、doSignIn 模式对齐。

### Finding #MOB-5
- 文件: `mobile/js/app.js:213,241-252`
- 严重度: medium
- 类型: bug
- 描述: loadPinnedTags 用 `DB.getCurrentUserId()` 拼 localStorage key，本地模式可能返回空 → key 变 `noteflow_pinned_tags_undefined`，与 PC 行为不一致，不同本地用户错位读写。
- 建议修复: `const userId = DB.getCurrentUserId() || (this.localMode ? 'local' : 'anon');`；与 PC 共享同一拼 key 工具函数（与 NF-7 一并修）。

### Finding #MOB-6
- 文件: `mobile/js/app.js:308-326,327-347`
- 严重度: medium
- 类型: smell
- 描述: refreshNotes / loadMore 失败仅 console.error，不重置 notes/noteCount/hasMore，UI 仍是旧条目，被误以为筛选生效。
- 建议修复: catch 中刷新场景 notes=[]/noteCount=0/hasMore=false + 显式 toast；loadMore 加重试按钮 / toast。

### Finding #MOB-7
- 文件: `mobile/js/app.js:219-238`
- 严重度: medium
- 类型: security
- 描述: doSignOut 仅置账号字段为空，notes/tags/pinnedTags/currentTag/searchKey/_dateCache/expandedTags/actionNote/editingNote/tagSearchKey/Debounced/publishImages 仍驻留内存。换账号或刷新前开发者工具能看到上一用户笔记原文与图片 dataUrl；backToLogin 同样。**与 UEU-4 是同一类 bug 在 PC + Mobile 双端**。
- 建议修复: 抽 `resetUserState()` 集中复位；或 `Object.assign(this.$data, this.$options.data())`（保留 loaded）。

### Finding #MOB-8
- 文件: `mobile/js/app.js:416-453,540-553,513-527,555-570`
- 严重度: medium
- 类型: bug
- 描述: sendFromPublish/saveEdit/deleteFromSheet/doDelete 都没有 in-flight 互斥，按钮 disabled 仅看输入是否空。双击 FAB 发布或 confirm 后快速二次点删除会触发两次 DB 调用。
- 建议修复: 引入 publishLoading/editLoading/deleting 标志，方法首句 `if (this.xxxLoading) return; this.xxxLoading = true;`，finally 复位。

### Finding #MOB-9
- 文件: `mobile/js/app.js:273-288`
- 严重度: medium
- 类型: smell
- 描述: dailyReview 把 noteCount 直接赋为 randomNotes.length（≤10），底部「已加载全部 · {{ noteCount }} 条」显示样本数而非真实总数；进入回顾模式无「退出回顾」UI 入口。
- 建议修复: 独立 reviewMode 标志控制底部文案；header 当 reviewMode=true 时显示「返回全部」按钮调 refreshNotes()。

### Finding #MOB-10
- 文件: `mobile/js/app.js:308-347,358-366`
- 严重度: medium
- 类型: bug
- 描述: 无请求并发去重，快速点两个标签让两个 getNotes 同时发起；第二个早返回时第一个返回会用旧 tag 数据覆盖最新视图。loadMore 与 refreshNotes 同时进行也会串档。
- 建议修复: 持有 `this._refreshSeq = 0; const seq = ++this._refreshSeq; ... if (seq !== this._refreshSeq) return;` 简单序列号守卫；refreshNotes 期间 loadingMore=true 屏蔽 loadMore。

### Finding #MOB-11
- 文件: `mobile/index.html:12-20`
- 严重度: low
- 类型: smell
- 描述: 视口跳转脚本只在初次加载用 setTimeout 判一次，竖→横屏切换 innerWidth ≥768 但因为没有 resize/orientationchange 监听，用户停留 /mobile/。
- 建议修复: 视产品取舍：要么文档明确「会话内不再跳转」，要么追加 orientationchange 监听 + 「用户主动操作过页面 ⇒ 不再自动跳」防打扰。

### Finding #MOB-12
- 文件: `mobile/js/app.js:116-151`
- 严重度: low
- 类型: smell
- 描述: mounted 注册匿名 noteflow:sync-complete listener (line 120) 但无 beforeUnmount 清理；setupGlobalEvents 在 document 上挂 paste/keydown 也未清理。同会话不卸载无问题，但单测/热更新累积监听器。
- 建议修复: listener 函数提到 methods 命名引用，beforeUnmount removeEventListener；timer 一并 clearTimeout。

### Finding #MOB-13
- 文件: `mobile/index.html:148`
- 严重度: low
- 类型: perf
- 描述: `<main class="notes-scroll" @scroll="onScroll">` 默认非 passive，处理函数仅读坐标不 preventDefault，浏览器仍要等 JS 决定，长列表滚动可能几毫秒抖动。
- 建议修复: 改 `@scroll.passive`；用 requestAnimationFrame 节流 onScroll。

### Finding #MOB-14
- 文件: `mobile/index.html:156-157` & `mobile/js/app.js:497`
- 严重度: low
- 类型: bug
- 描述: 长按菜单仅通过 `@contextmenu.prevent="showCardMenu(note)"` 触发。iOS Safari 可触发，Android Chrome 某些版本不会；同时 contextmenu 与文本选择冲突，导致用户既不能复制选中文字也不一定能呼出菜单。
- 建议修复: 显式 long-press：touchstart 起 500ms 计时，touchmove>10px / touchend / touchcancel 取消；触发后 preventDefault；`@contextmenu.prevent` 仅 fallback。

### Finding #MOB-15
- 文件: `mobile/js/app.js:540-553`
- 严重度: low
- 类型: smell
- 描述: saveEdit 用 `this.editText`（未 trim）做 extractTags，但用 `this.editText.trim()` 写 content；带前导/尾随换行时未来 Markdown 渲染会引入「标签数量与内容不符」。
- 建议修复: 方法开头 `const cleaned = this.editText.trim(); const tags = this.extractTags(cleaned);` 统一使用。

### Finding #MOB-16
- 文件: `mobile/index.html:159`
- 严重度: low
- 类型: perf
- 描述: 列表每张卡片每次响应式更新都重跑 `highlightTags(escapeHtml(note.content || ''))`，30 条 + 任一无关字段（如 syncStatus）变化都触发重渲染；escapeHtml 创建临时 div 也非零成本。
- 建议修复: 拉到数据后预计算 `note._renderedHtml`，模板里 `v-html="note._renderedHtml"`；或 computed 派生。

### Finding #MOB-17
- 文件: `mobile/js/app.js:329-347`
- 严重度: low
- 类型: bug
- 描述: loadMore 失败时 currentPage-- 回滚，但若滚动条仍在底部触发再次 onScroll，会立即再次 loadMore 进入死循环式重试，无 backoff。
- 建议修复: 失败后 `loadMoreCooldownUntil = Date.now() + 3000`，loadMore 入口判断；或 IntersectionObserver + 失败隐藏 sentinel。

### Finding #MOB-18
- 文件: `mobile/js/app.js:649-656`
- 严重度: low
- 类型: inconsistency
- 描述: 自实现 `normalizeToArray`（用于 image_paths/image_data）。共享层应暴露统一工具，避免 PC 切换 image 字段格式时 mobile 滞后。
- 建议修复: 在 db-supabase.js 或 imageHelper.js 暴露 normalizeImageList，mobile 复用。

### Finding #MOB-19
- 文件: `mobile/index.html:330-341`
- 严重度: low
- 类型: smell
- 描述: 共享数据层入口为 `../js/db-supabase.js` 等四个 script。要求 build 同步 mobile/ 与 js/ 到 dist|docs/ 保持同级目录。
- 建议修复: head 加注释固化约定；tests/ 加 path resolution 烟囱测试。

### Finding #MOB-20
- 文件: `mobile/js/app.js:106-114`
- 严重度: low
- 类型: smell
- 描述: tagSearchKey debounce 用 watch + 200ms 计时器（满足 P6），但用户清空输入框时仍要等 200ms 让 filteredGroupedTags 退回全量；tagSearchTimer 也未在 closeTagDrawer 时清理。
- 建议修复: watcher 内 `if (!newVal) { this.tagSearchDebounced = ''; return; }` 即时同步；closeTagDrawer 加 clearTimeout。

---

## 跨子系统模式（Task 9 二次扫将进一步整理）

1. **跨用户数据泄露**：UEU-4 (PC `js/app.js:doSignOut`) + MOB-7 (mobile/js/app.js:doSignOut) + SDB-3 (db-supabase 不校验 user_id) — 同一类 bug 在 3 个层面都存在
2. **img.src 属性级 XSS**：NF-9 (timeline.js innerHTML) + UEU-11 (export.js flomo HTML 生成)
3. **pinned tags key 拼空 userId**：NF-7 (PC tags.js) + MOB-5 (mobile)
4. **debounce 计时器跨方法漏清**：NF-12 (search.js) + MOB-2 (mobile search) + MOB-20 (tagSearch)
5. **fire-and-forget 写操作 / 错误吞**：UEU-1 + UEU-12 + SDB-5 + SDB-9 + MOB-4 + MOB-6
6. **in-flight 互斥缺失**：NF-3 (PC sendNote) + MOB-8 (mobile 4 处) + MOB-10 (refresh 并发)
7. **接口签名 / 字段命名一致性**：SDB-4 (db.js vs db-supabase.js)
8. **错误处理一致性**：UEU-13 (alert vs toast) + SDB-9 + UEU-9 (AbortError 与 IO 错误同等对待)
