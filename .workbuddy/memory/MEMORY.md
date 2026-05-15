# MEMORY.md - Noteflow 项目长期记忆

## 项目信息
- **项目名**: Noteflow（本地类flomo笔记库）
- **路径**: `/Users/tianlingxiao/Desktop/知识库/`
- **技术栈**: Vue 3 CDN + sql.js + IndexedDB持久化
- **启动方式**: 本地HTTP服务器 `localhost:8765`（从 `dist/` 目录提供页面）或双击 `dist/index.html`（需在线加载CDN）
- **线上地址**: https://shawntiant.github.io/noteflow/ （GitHub Pages，从 `docs/` 目录）
- **Agent说明文件**: `AGENTS.md`（根目录，给AI agent看的上下文，修改项目前必读）

## 关键文件说明
- `AGENTS.md` — Agent上下文，含目录规则、关键技术点、常见坑（2026-05-03新增）
- `build.sh` — 发布脚本，源码→dist/+docs/，支持 `bash build.sh push "提交信息"` 自动推GitHub
- `VERSION` — 版本号，当前 1.3.2
- `dist/` — 本地发布目录，**禁止直接编辑**，只能改源文件后 build
- `docs/` — GitHub Pages发布目录，与 dist/ 内容同步
- `PRD.md` — 产品需求文档（2026-05-03创建，覆盖10个章节）

## 关键架构决策
1. **sql.js** 浏览器内SQLite，数据库二进制通过 IndexedDB 持久化（无容量限制）
2. **db.exec()** 不支持参数绑定，必须用 `db.prepare()+bind()+step()+getAsObject()` 模式
3. **图片混合存储**: 小图(<100KB) base64存`image_data`，大图存本地`data/images/`路径存`image_paths`
4. **Vue 3 CDN版**: 无构建工具，`Vue.createApp(options).mount('#app')`
5. **手动渲染**: notes和tags容器是普通DOM，Vue响应式更新后需手动调用 `Timeline.renderNotes()` / `TagsModule.renderTags()`
6. **预填充数据库**: 首次加载自动fetch `data/noteflow_user1.db`，支持旧localStorage数据兼容迁移
7. **脏标记机制**: `markDirty()` 标记变更，30秒自动保存 + 手动saveDb()，避免无意义写入
8. **批量导入**: `addNotesBatch(notes, {skipSave: true})` 批量写入后统一保存
9. **tags接口统一**: 两个DB文件接口层统一为数组格式。db.js内部SQLite仍存逗号字符串，但addNote/updateNote接受数组，getNotes/getNoteById返回数组。db-supabase.js原生数组。两者均提供normalizeTags()兼容处理。
10. **getNoteById统一异步**: db.js和db-supabase.js的getNoteById/updateNote/deleteNote均为async，调用方用await

## 数据库表
- `users` (id, name, avatar, created_at)
- `notes` (id, user_id, content, tags, image_paths, image_data, type, is_done, created_at, updated_at)
- `tags` (id, user_id, name, count) — UNIQUE(user_id, name)

## 预填充数据
- `data/noteflow_user1.db`: 凌霄的1687条flomo笔记+134个标签，用户一数据
- Python脚本解析 flomo HTML → SQLite .db 文件

## MVP功能清单(P0) — 全部完成
1. 极简输入（Enter发送，Shift+Enter换行）
2. #标签语法（空格分隔，支持多级含单引号如 area's/跑步、连字符如 复盘-周/小确幸）
3. 时间线卡片流
4. 标签筛选（树形层级展示，一级可展开/折叠）
5. 全文搜索
6. 编辑/删除
7. 图片上传（📷/拖拽/Ctrl+V）
8. 图片展示（缩略图+点击放大）
9. 双用户切换
10. 数据导出（.db/.json/flomo zip）
11. flomo导入（文件选择器+批量去重）
12. 每日笔记回顾（随机10条）

## 关键实现细节
- **标签层级**: 标签以 `/` 分隔层级，`buildTagTree()` 构建树形结构，一级标签汇总子标签计数
- **标签点击**: 用 `data-tag` 属性 + 事件委托替代 onclick 内联，避免单引号转义问题
- **标签正则**: `#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)` 支持中英文、单引号、连字符、斜杠（v1.3.2 加 `-` 支持）
- **标签过滤**: `#campaign2` 等纯英文+数字尾缀不判定为标签（`/^[a-zA-Z]+\d+$/` 过滤），含中文的保留
- **标签置顶**: 置顶标签存在 localStorage（`noteflow_pinned_tags_{userId}`），点击📌或右键切换，置顶区排最前加分隔线
- **层级筛选**: 点击一级标签时 `getNotes` 额外匹配 `tag/%` 前缀，点击二级精确匹配
- **随机回顾**: `DB.getRandomNotes(n)` 使用 SQLite `RANDOM()` 函数
- **版本发布**: `bash build.sh` 同步 dist/+docs/，`bash build.sh push "提交信息"` 同步并推GitHub
- **版本文件**: `VERSION` 跟踪版本号，当前 1.3.2

## GitHub 部署
- **仓库**: https://github.com/ShawnTianT/noteflow
- **GitHub 用户**: ShawnTianT，邮箱 18134158895@163.com
- **Pages 地址**: https://shawntiant.github.io/noteflow/
- **Pages 来源**: main 分支 /docs 目录
- **注意**: 公司网络连 GitHub 不稳定（443端口被拦），git push 可能需要代理或回家网络

## Supabase 同步
- **项目URL**: rsqamgjvreurggjoxphq.supabase.co
- **supabase-schema.sql**: 自定义 `users` 表 + `verify_password` RPC（pgcrypto 加密）
- **默认账号**: 18134158895 / 123456
- **db-supabase.js**: `getCurrentUserId()` 返回 BIGINT 或 null，uid 为 null 时查全部本地缓存
- **迁移完成**: 1687 条笔记 + 134 个标签已导入 Supabase（user_id=1）

## 手机端（mobile/）
- **目录**: `mobile/`，独立于桌面端，含自己的 index.html + css/ + js/
- **隔离策略**: mobile/ 内的 agent 只能写 mobile/ 目录，共享数据层（js/db.js、js/db-supabase.js、js/utils/）只读
- **mobile/AGENTS.md**: 给其他 agent 的完整上下文，含 API 文档、红线规则、UI 需求
- **build.sh**: 已支持 mobile/ 打包，共享 JS 文件保持 `../js/` 引用（不再 sed 替换，v1.3.2 修复）
- **访问路径**: 本地 `http://localhost:8765/mobile/`，线上 `https://shawntiant.github.io/noteflow/mobile/`
- **当前状态**: 手机端 UI 已完成，支持竖版/横版自动适配，Supabase 登录已通

## 用户偏好
- 凌霄零编程基础，所有操作需一步到位
- 已有flomo导出数据在 `/Users/tianlingxiao/Downloads/flomo@shawn每日蜕变-20260404`
- 配色偏好：浅色清新
- 项目名确定为 Noteflow
