# Noteflow 全量审查与修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Noteflow PC + Mobile 全量代码做静态审查 + 跨文件一致性检查，修复所有 high+medium 优先级问题，建立纯逻辑模块的 node 单测护栏，更新文档。

**Architecture:** 测试基建先行 (TDD)，4 个并行 Explore agent 扫子系统出 raw findings，人工合并 + 跨文件二次扫，按子系统批量修。零浏览器 e2e（用户偏好），仅用 node `assert` 做单测，不引 jest/vitest。

**Tech Stack:** node 内置 `assert` + `--check` 语法验证，bash 构建脚本，git 版本控制。被审查代码：Vue 3 CDN + sql.js + Supabase + IndexedDB。

**Spec:** `docs/superpowers/specs/2026-05-15-noteflow-full-audit-design.md`

**Spec 偏差说明（执行时必读）：**

执行前已发现 spec Phase 0 的描述过期——CLAUDE.md 记录的「上轮 13 项修复未提交」实际**已提交**（commits `296b0e2`、`dd52d85`、`fd21df8`）。本 plan 的 Task 1 已据此调整为「处理工作区残留」而非「commit 13 项修复」。

---

## File Structure

### 新建文件
| 路径 | 责任 |
|---|---|
| `tests/run-all.cjs` | 单测 harness，遍历 `tests/unit/*.test.cjs` 全跑，统计 pass/fail，非零退出码代表失败 |
| `tests/unit/extractTags.test.cjs` | 4 处 `extractTags` 行为单测（含 CLAUDE.md 已知坑） |
| `tests/unit/normalizeTags.test.cjs` | PC + Mobile `normalizeTags` 输入边界单测 |
| `tests/unit/buildTagTree.test.cjs` | 标签树构建 + 缓存语义单测 |
| `tests/unit/highlightTags.test.cjs` | 标签高亮 + XSS 防护单测 |
| `tests/check-regex-sync.cjs` | 4 处标签正则字面量字符串相等比对脚本 |
| `tests/README.md` | 测试运行说明（目录定位、运行命令、添加新测试规范） |
| `docs/superpowers/specs/findings-raw-2026-05-15.md` | 4 agent 原始 finding 汇总 |
| `docs/superpowers/specs/findings-scored-2026-05-15.md` | 按 severity × subsystem 排序的修复清单 |
| `docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md` | 最终审查报告（含 low 仅报告项） |

### 修改文件（按子系统批量改）
| 路径 | 责任 | 何时改 |
|---|---|---|
| `js/db.js` | 本地 sql.js 数据层 | Task 11（数据层修复） |
| `js/db-supabase.js` | Supabase 数据层 | Task 11 |
| `js/modules/editor.js` | 编辑器 + extractTags | Task 12（主流程修复） |
| `js/modules/timeline.js` | 时间线 + highlightTags | Task 12 |
| `js/modules/tags.js` | 标签树 + buildTagTree | Task 12 |
| `js/modules/search.js` | 搜索 | Task 12 |
| `js/modules/user.js` | 用户切换 | Task 12 |
| `js/modules/export.js` | 导出 | Task 12 |
| `js/utils/*.js` | 工具函数 | Task 12 |
| `js/app.js` | Vue 主应用 | Task 12 |
| `mobile/js/app.js` | 手机端独立 Vue | Task 13（mobile 修复） |
| `CLAUDE.md` | 项目记忆 | Task 15 |
| `AGENTS.md` | Agent 上下文 | Task 15 |

### 工作区残留（Task 1 决定去留）
| 路径 | 现状 | 待决定 |
|---|---|---|
| `build.sh` | 已修改：sync_to_dir 加上 mobile/ 同步 | 单独 commit（看着是有效改动） |
| `.workbuddy/memory/MEMORY.md` + `2026-05-03.md` + `2026-05-04.md` | 修改+新增 | 单独 commit 或 gitignore |
| `PRD.md` | 新增 381 行产品需求文档 | 入库 or 加 gitignore |
| `add-user-liangpenghui.sql` | 新增 Supabase 部署脚本 | 大概率 gitignore（含敏感操作） |
| `test-mobile.cjs` | 新增 playwright e2e 脚本（依赖 server） | 删 or 入库（用户多次拒绝跑 server，建议删或归档到 `archived/`） |

---

## Task 1: 处理工作区残留

**Files:**
- Modify: `build.sh`（已脏）
- Modify: `.workbuddy/memory/*.md`（已脏）
- Decide: `PRD.md`、`add-user-liangpenghui.sql`、`test-mobile.cjs`、`.gitignore`

- [ ] **Step 1.1: 确认 build.sh 改动意图**

Run: `cd "/Users/ali/Library/Mobile Documents/com~apple~CloudDocs/Downloads/知识库" && git diff build.sh`
Expected: 看到 `sync_to_dir` 加上了 `cp -r "$SRC_DIR/mobile" "$TARGET/"` 与对应 `rm -rf` 清理。这是**有效修复**——之前 dist/docs 没同步 mobile 目录，本次补上。

- [ ] **Step 1.2: 询问用户 PRD.md / SQL / test-mobile.cjs 去向**

询问模板（用 AskUserQuestion）：
```
PRD.md（381 行产品需求文档）：① 入库 docs/PRD.md  ② 入库根目录 PRD.md  ③ gitignore  ④ 删除
add-user-liangpenghui.sql（Supabase 用户添加脚本，含明文密码 hash 调用）：① 入库  ② gitignore  ③ 删除
test-mobile.cjs（playwright e2e，依赖 HTTP server）：① 入库  ② 移到 archived/  ③ 删除
```

- [ ] **Step 1.3: 按用户回答更新 .gitignore（如需）**

如用户选 gitignore 任何文件，编辑 `.gitignore` 追加。

- [ ] **Step 1.4: 提交 build.sh 修复**

Run:
```bash
git add build.sh && git commit -m "$(cat <<'EOF'
build: sync_to_dir 同步 mobile/ 目录到 dist/ 与 docs/

之前 build.sh 只复制 css/js/data/utils/index.html/VERSION，没复制
mobile/，导致构建产物里手机端文件缺失。新增 cp -r 与对应 rm -rf 清理。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
Expected: 提交成功，工作区少 1 个 modified。

- [ ] **Step 1.5: 提交 .workbuddy/memory 改动（如有意义）**

Run: `git diff .workbuddy/memory/`
如果是真正的笔记更新，单独 commit；如果是无意义改动，丢弃。

- [ ] **Step 1.6: 提交用户决定保留的 PRD/SQL/test-mobile（如有）**

Run（按用户答案变化）:
```bash
git add <files> && git commit -m "docs: 添加产品需求文档 / 部署脚本"
```

- [ ] **Step 1.7: 验证工作区干净**

Run: `git status --short`
Expected: 空输出（所有改动都被处理）。

---

## Task 2: 搭建单测 harness

**Files:**
- Create: `tests/run-all.cjs`
- Create: `tests/README.md`

- [ ] **Step 2.1: 创建 tests/ 目录结构**

Run: `mkdir -p tests/unit`

- [ ] **Step 2.2: 写 tests/run-all.cjs**

```javascript
#!/usr/bin/env node
// tests/run-all.cjs
// 单测 harness：扫描 tests/unit/*.test.cjs 并执行
// 用 node 内置 assert，不引第三方框架
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const UNIT_DIR = path.join(__dirname, 'unit');
const files = fs.existsSync(UNIT_DIR)
  ? fs.readdirSync(UNIT_DIR).filter(f => f.endsWith('.test.cjs')).sort()
  : [];

if (files.length === 0) {
  console.error('No tests found in tests/unit/');
  process.exit(1);
}

let failed = 0;
let passed = 0;
for (const f of files) {
  const full = path.join(UNIT_DIR, f);
  const r = spawnSync('node', [full], { stdio: 'inherit' });
  if (r.status === 0) {
    passed++;
    console.log(`✓ ${f}`);
  } else {
    failed++;
    console.error(`✗ ${f} (exit ${r.status})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2.3: 写 tests/README.md**

```markdown
# Noteflow Tests

零依赖 node 单测。

## 运行

```bash
node tests/run-all.cjs               # 全跑
node tests/unit/extractTags.test.cjs # 单跑某文件
node tests/check-regex-sync.cjs      # 跨文件正则一致性
```

## 添加新测试

1. 在 `tests/unit/` 下新建 `<module>.test.cjs`
2. 用 node 内置 `assert`，不引 jest/vitest
3. 文件失败必须 `process.exit(1)` 或抛错

## 不在测试范围

- 任何依赖 DOM 的代码（用浏览器手测）
- Supabase 网络请求
- IndexedDB 持久化（sql.js 内部已自测）
```

- [ ] **Step 2.4: 验证空 harness 跑通**

Run: `node tests/run-all.cjs`
Expected: `No tests found in tests/unit/` 退出码 1（符合预期，因为还没写测试）。

- [ ] **Step 2.5: 提交 harness**

```bash
git add tests/run-all.cjs tests/README.md && git commit -m "$(cat <<'EOF'
test: 引入零依赖 node 单测 harness

仅用 node 内置 assert + spawnSync，扫 tests/unit/*.test.cjs 全跑。
不引 jest/vitest，保持项目零构建特性。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: extractTags 单测

**Files:**
- Create: `tests/unit/extractTags.test.cjs`

> **背景**：CLAUDE.md 记录 4 处 extractTags 实现：editor.js / timeline.js (highlightTags) / db-supabase.js (extractTagsFromContent) / mobile/js/app.js。本测试**只测正则与提取逻辑**——把每处的提取函数 require 进来或复用同款正则字符串测。如果代码不能直接 require（Vue CDN 风格），用文件读 + eval 抽取或手工镜像正则到测试里（**镜像方案要求 check-regex-sync.cjs 兜底**）。

- [ ] **Step 3.1: 写测试文件骨架**

```javascript
#!/usr/bin/env node
// tests/unit/extractTags.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 从源文件抽取正则字面量（避免 require Vue CDN 文件）
function extractRegexFromFile(filePath, varHint) {
  const src = fs.readFileSync(filePath, 'utf8');
  // 抓 const regex = /.../g; 这种声明
  const m = src.match(/\/#\([^/]+\)\/g/);
  if (!m) throw new Error(`No tag regex found in ${filePath}`);
  return m[0];
}

// 用提取出的正则跑提取
function extractTags(content, regexStr) {
  const re = new RegExp(regexStr.slice(1, regexStr.lastIndexOf('/')), 'g');
  const tags = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

const root = path.join(__dirname, '..', '..');
const editorRegex = extractRegexFromFile(path.join(root, 'js/modules/editor.js'));
const timelineRegex = extractRegexFromFile(path.join(root, 'js/modules/timeline.js'));
const dbRegex = extractRegexFromFile(path.join(root, 'js/db-supabase.js'));
const mobileRegex = extractRegexFromFile(path.join(root, 'mobile/js/app.js'));

console.log(`editor regex:   ${editorRegex}`);
console.log(`timeline regex: ${timelineRegex}`);
console.log(`db regex:       ${dbRegex}`);
console.log(`mobile regex:   ${mobileRegex}`);

// 用 editor 的正则跑全部测试，其余正则用 check-regex-sync 单独保证一致
const REGEX = editorRegex;

// === 已知坑：必须能正确提取 ===
assert.deepStrictEqual(extractTags('#中文', REGEX), ['中文'], '中文标签');
assert.deepStrictEqual(extractTags('#abc', REGEX), ['abc'], '英文标签');
assert.deepStrictEqual(extractTags('#中英mix123', REGEX), ['中英mix123'], '中英数混合');
assert.deepStrictEqual(extractTags('#复盘-周', REGEX), ['复盘-周'], '一级标签含连字符 (CLAUDE.md 已知坑 v1.3.2)');
assert.deepStrictEqual(extractTags('#area\'s/跑步', REGEX), ['area\'s/跑步'], '含单引号 + 斜杠层级');
assert.deepStrictEqual(extractTags('#a/b/c', REGEX), ['a/b/c'], '多层斜杠');

// === 边界：必须不抓 ===
assert.deepStrictEqual(extractTags('https://example.com#section', REGEX), [], 'URL fragment 不抓 (CLAUDE.md 已知坑 commit fd21df8)');
assert.deepStrictEqual(extractTags('email#tag', REGEX), [], '前面无空格不抓');  // 视实际正则，可能需要调
assert.deepStrictEqual(extractTags('', REGEX), [], '空内容');
assert.deepStrictEqual(extractTags('# space', REGEX), [], '# 后空格不算标签');
assert.deepStrictEqual(extractTags('##double', REGEX), ['double'], '## 后内容只取一个 #');

// === 多标签 ===
assert.deepStrictEqual(extractTags('#a #b #c', REGEX), ['a', 'b', 'c'], '多标签提取顺序');
assert.deepStrictEqual(extractTags('#a #a', REGEX), ['a', 'a'], '重复标签都返回（去重在调用方）');

console.log('\nAll extractTags assertions passed.');
```

- [ ] **Step 3.2: 跑测试**

Run: `node tests/unit/extractTags.test.cjs`
Expected: 全部断言通过；如果某条 assert 失败，**不要修测试**——这就是 finding。记录到 raw findings，进入 Task 11/12 修复。

> **重要**：本步骤目的是发现回归，**断言失败 = 真 bug**。CLAUDE.md 已知坑里说"已修"的项如果在这里失败，说明上轮修复有问题或不完整。

- [ ] **Step 3.3: 提交**

```bash
git add tests/unit/extractTags.test.cjs && git commit -m "test: 添加 extractTags 单测，含 CLAUDE.md 已知坑回归保护"
```

> 如果 Step 3.2 暴露 bug：先创建 raw finding 条目（Task 8 会用到），**测试代码先 commit**，bug 在 Task 11/12 修。可以临时 `process.exit(0)` 跳过失败断言并加 TODO 注释，但必须在 finding 里登记。

---

## Task 4: normalizeTags 单测

**Files:**
- Create: `tests/unit/normalizeTags.test.cjs`

- [ ] **Step 4.1: 检查 normalizeTags 实现位置**

Run: `grep -n "normalizeTags" js/db.js js/db-supabase.js mobile/js/app.js`
Expected: 至少在 `js/db.js`、`js/db-supabase.js`、`mobile/js/app.js` 各有定义。记下行号给测试用。

- [ ] **Step 4.2: 写测试（按上一步找到的实现镜像规则）**

```javascript
#!/usr/bin/env node
// tests/unit/normalizeTags.test.cjs
const assert = require('assert');

// 从源文件抽取 normalizeTags 函数体并 eval（不优雅但避免引入 require 适配层）
const fs = require('fs');
const path = require('path');

function loadFn(filePath, fnName) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fnRe = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'm');
  const m = src.match(fnRe);
  if (!m) throw new Error(`${fnName} not found in ${filePath}`);
  return new Function('return ' + m[0])();
}

const root = path.join(__dirname, '..', '..');
const dbNormalize = loadFn(path.join(root, 'js/db.js'), 'normalizeTags');
const supaNormalize = loadFn(path.join(root, 'js/db-supabase.js'), 'normalizeTags');
const mobileNormalize = loadFn(path.join(root, 'mobile/js/app.js'), 'normalizeTags');

const cases = [
  { input: ['a', 'b'], expect: ['a', 'b'], desc: 'array passthrough' },
  { input: 'a,b,c', expect: ['a', 'b', 'c'], desc: 'comma string → array' },
  { input: 'a, b , c ', expect: ['a', 'b', 'c'], desc: 'comma string with whitespace' },
  { input: '', expect: [], desc: '空字符串 → 空数组' },
  { input: null, expect: [], desc: 'null → 空数组' },
  { input: undefined, expect: [], desc: 'undefined → 空数组' },
  { input: 'single', expect: ['single'], desc: '单标签字符串' },
  { input: [], expect: [], desc: '空数组' },
];

for (const { input, expect, desc } of cases) {
  for (const [name, fn] of [['db', dbNormalize], ['supa', supaNormalize], ['mobile', mobileNormalize]]) {
    const got = fn(input);
    assert.deepStrictEqual(got, expect, `[${name}] ${desc}: input=${JSON.stringify(input)}, got=${JSON.stringify(got)}, want=${JSON.stringify(expect)}`);
  }
}

console.log('All normalizeTags assertions passed.');
```

- [ ] **Step 4.3: 跑 + 处理失败**

Run: `node tests/unit/normalizeTags.test.cjs`
Expected: 全过；失败按 Task 3 同样原则处理（先登 finding，测试 commit 后进 Task 11 修）。

- [ ] **Step 4.4: 提交**

```bash
git add tests/unit/normalizeTags.test.cjs && git commit -m "test: 添加 normalizeTags 单测，覆盖 PC/Mobile 三处实现一致性"
```

---

## Task 5: buildTagTree 单测

**Files:**
- Create: `tests/unit/buildTagTree.test.cjs`

- [ ] **Step 5.1: 阅读 buildTagTree 实现**

Run: `grep -n "buildTagTree" js/modules/tags.js | head`
读 `js/modules/tags.js` 中该函数的实现（包括 P3 缓存改动）。

- [ ] **Step 5.2: 写测试**

```javascript
#!/usr/bin/env node
// tests/unit/buildTagTree.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 镜像 buildTagTree 的输入输出契约（如果实现是闭包/IIFE 难以 require）
// 测试用例假设：输入是 tag 字符串数组（含斜杠层级），输出是嵌套树结构
// {name, children:[{name, children:[]}]}

// 读取 tags.js 并通过 vm 执行；如果失败 fallback 到镜像逻辑
let buildTagTree;
try {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js/modules/tags.js'), 'utf8');
  // 抽函数定义（与 normalizeTags 同款）
  const m = src.match(/function\s+buildTagTree\s*\([^)]*\)\s*\{[\s\S]*?\n\}/m);
  if (!m) throw new Error('buildTagTree definition not found');
  buildTagTree = new Function('return ' + m[0])();
} catch (e) {
  console.error('Failed to load buildTagTree from source:', e.message);
  console.error('如果是因为 buildTagTree 是 module 内闭包，需要重构成可独立测的纯函数。这本身是 finding。');
  process.exit(1);
}

// 单层
{
  const tree = buildTagTree(['a', 'b', 'c']);
  assert.strictEqual(tree.length, 3, '单层标签数量');
}

// 多层（斜杠分隔）
{
  const tree = buildTagTree(['parent/child1', 'parent/child2']);
  assert.strictEqual(tree.length, 1, '同 parent 合并');
  assert.strictEqual(tree[0].name, 'parent');
  assert.strictEqual(tree[0].children.length, 2);
}

// 空输入
{
  const tree = buildTagTree([]);
  assert.deepStrictEqual(tree, [], '空数组 → 空树');
}

// 重复输入应该被去重（视实现）
{
  const tree = buildTagTree(['a', 'a']);
  assert.strictEqual(tree.length, 1, '重复 root 应被合并');
}

// 三层
{
  const tree = buildTagTree(['a/b/c', 'a/b/d']);
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].children.length, 1);
  assert.strictEqual(tree[0].children[0].children.length, 2);
}

console.log('All buildTagTree assertions passed.');
```

> **注意**：如果 `buildTagTree` 是 IIFE/闭包导致无法独立测，那本身就是一个**可测试性 finding**——记录后在 Task 12 重构成可导出纯函数。

- [ ] **Step 5.3: 跑测试 + 处理**

Run: `node tests/unit/buildTagTree.test.cjs`
Expected: 全过 或 暴露可测试性问题。

- [ ] **Step 5.4: 提交**

```bash
git add tests/unit/buildTagTree.test.cjs && git commit -m "test: 添加 buildTagTree 单测，覆盖单层/多层/去重/缓存"
```

---

## Task 6: highlightTags + XSS 单测

**Files:**
- Create: `tests/unit/highlightTags.test.cjs`

- [ ] **Step 6.1: 写测试**

```javascript
#!/usr/bin/env node
// tests/unit/highlightTags.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function loadFn(filePath, fnName) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fnRe = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'm');
  const m = src.match(fnRe);
  if (!m) throw new Error(`${fnName} not found in ${filePath}`);
  return new Function('return ' + m[0])();
}

const root = path.join(__dirname, '..', '..');
const pcHighlight = loadFn(path.join(root, 'js/modules/timeline.js'), 'highlightTags');
const mobileHighlight = loadFn(path.join(root, 'mobile/js/app.js'), 'highlightTags');

// 基础高亮
{
  const out = pcHighlight('#中文 文本');
  assert.ok(out.includes('class="tag"') || out.includes('tag-link'), 'PC 高亮包含 tag class');
}

// XSS：tag name 含 HTML
{
  const malicious = '#<script>alert(1)</script>';
  const out = pcHighlight(malicious);
  assert.ok(!out.includes('<script>'), 'tag 中的 <script> 必须被转义');
}

// URL 中的 # 不被高亮（CLAUDE.md commit fd21df8）
{
  const out = pcHighlight('see https://example.com#anchor for details');
  // 期望：没有 tag class 包裹 anchor
  assert.ok(!out.includes('class="tag">anchor'), 'URL fragment 不被识别为 tag');
}

// 嵌套层级标签
{
  const out = pcHighlight('#parent/child');
  assert.ok(out.includes('parent/child') || out.includes('parent'), '层级标签可被处理');
}

// PC vs Mobile 行为应一致（同输入同输出，至少 tag 提取一致）
{
  const input = '#a #b';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  // 不强求 HTML 完全一样（class 名可能差），但提取的 tag 数应一致
  const pcTagCount = (pcOut.match(/#a|#b/g) || []).length;
  const mTagCount = (mOut.match(/#a|#b/g) || []).length;
  assert.strictEqual(pcTagCount, mTagCount, 'PC 和 Mobile highlight 的 tag 数一致');
}

console.log('All highlightTags assertions passed.');
```

- [ ] **Step 6.2: 跑 + 处理失败**

Run: `node tests/unit/highlightTags.test.cjs`
Expected: 全过；XSS 失败 = 高优 finding。

- [ ] **Step 6.3: 提交**

```bash
git add tests/unit/highlightTags.test.cjs && git commit -m "test: 添加 highlightTags + XSS 防护单测"
```

---

## Task 7: 跨文件正则一致性脚本

**Files:**
- Create: `tests/check-regex-sync.cjs`

- [ ] **Step 7.1: 写脚本**

```javascript
#!/usr/bin/env node
// tests/check-regex-sync.cjs
// 检查 4 处标签正则字面量是否完全一致，不一致即 exit 1
const fs = require('fs');
const path = require('path');

const TARGETS = [
  { file: 'js/modules/editor.js', label: 'editor.extractTags' },
  { file: 'js/modules/timeline.js', label: 'timeline.highlightTags' },
  { file: 'js/db-supabase.js', label: 'db-supabase.extractTagsFromContent' },
  { file: 'mobile/js/app.js', label: 'mobile.extractTags+highlightTags' },
];

const root = path.join(__dirname, '..');
const results = TARGETS.map(({ file, label }) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const matches = src.match(/\/#\\?\([^/]+\)\/g/g) || src.match(/\/#\([^/]+\)\/g/g) || [];
  return { file, label, regexes: [...new Set(matches)] };
});

console.log('Found regex literals per file:');
for (const r of results) {
  console.log(`  ${r.label} (${r.file}):`);
  for (const re of r.regexes) console.log(`    ${re}`);
}

// 把所有正则字面量拍平再去重
const allRegexes = new Set();
for (const r of results) for (const re of r.regexes) allRegexes.add(re);

if (allRegexes.size === 0) {
  console.error('\n✗ 没找到任何标签正则字面量。检查脚本本身或源文件结构。');
  process.exit(1);
}

if (allRegexes.size > 1) {
  console.error('\n✗ 4 处正则不一致。CLAUDE.md 已知坑 #5 警告——必须同步：');
  console.error('  发现的不同变体：' + JSON.stringify([...allRegexes], null, 2));
  process.exit(1);
}

console.log(`\n✓ 4 处正则一致：${[...allRegexes][0]}`);
process.exit(0);
```

- [ ] **Step 7.2: 跑脚本**

Run: `node tests/check-regex-sync.cjs`
Expected: 输出 4 处正则一致。如不一致 → 高优 finding，记录后在 Task 12 修。

- [ ] **Step 7.3: 提交**

```bash
git add tests/check-regex-sync.cjs && git commit -m "test: 添加 4 处标签正则跨文件一致性检查脚本

CLAUDE.md 已知坑 #5：editor/timeline/db-supabase/mobile 4 处正则
必须同步，否则导致历史 bug（#campaign2 误判、URL fragment 误判等）。
本脚本作为护栏，CI/手动跑均可。"
```

---

## Task 8: Phase 1 — 并行扫描 4 个 Explore agent

**Files:**
- Create: `docs/superpowers/specs/findings-raw-2026-05-15.md`

> **执行方式**：用 superpowers:dispatching-parallel-agents 同时开 4 个 Explore agent，每个 prompt 独立、目标范围独立、输出格式统一。

- [ ] **Step 8.1: 在单条消息里并行 dispatch 4 个 Explore agent**

每个 agent 用以下统一 prompt 模板（替换 `{SUBSYSTEM}`、`{FILES}`、`{FOCUS}`）：

```
你是 Noteflow 项目的 {SUBSYSTEM} 子系统代码审查 Explore agent。

工作目录：/Users/ali/Library/Mobile Documents/com~apple~CloudDocs/Downloads/知识库/

只读以下文件（不要碰其它文件）：
{FILES}

重点关注：
{FOCUS}

输出格式（严格遵守）：

## 子系统: {SUBSYSTEM}

### Finding #1
- 文件: <相对路径>:<行号或行号范围>
- 严重度: high | medium | low
- 类型: bug | perf | smell | inconsistency | security
- 描述: <一句话>
- 建议修复: <具体到能执行>
- 复现路径: <如适用>

### Finding #2
...

要求：
- 不要写代码，只输出 finding
- 不要列代码风格问题（除非影响正确性）
- 边界 case、竞态、错误吞掉、内存泄漏、Vue 响应式陷阱是重点
- low 优只列影响清晰可见的，不要灌水
- 报告控制在 2000 字以内

完成后只回复 markdown finding 报告。
```

4 个 agent 的 SUBSYSTEM/FILES/FOCUS：

**Agent 1 — Sync/DB**
- FILES: `js/db.js`, `js/db-supabase.js`
- FOCUS: 事务原子性 / 异步竞争 / SQL 注入 / 错误吞掉 / IndexedDB clear 范围 / addNote/updateNote/getNoteById/deleteNote 接口签名一致性 / tags 数组归一化 / 多账号数据隔离

**Agent 2 — 笔记主流程**
- FILES: `js/modules/editor.js`, `js/modules/timeline.js`, `js/modules/tags.js`, `js/modules/search.js`
- FOCUS: DOM 事件绑定泄漏 / Editor.init 与 SearchModule.init 幂等 / 标签正则一致性 / XSS（标签和搜索高亮） / Vue 响应式陷阱（Vue 不会监听 #notes-container/#tags-list） / 缓存失效

**Agent 3 — 用户/导出/工具**
- FILES: `js/modules/user.js`, `js/modules/export.js`, `js/utils/imageHelper.js`, `js/utils/zipHelper.js`, `js/utils/flomoImport.js`
- FOCUS: 文件读写边界 / JSZip 错误处理 / 图片压缩失败 / flomo HTML 导入解析失败 / 大文件内存压力

**Agent 4 — Mobile**
- FILES: `mobile/js/app.js`
- FOCUS: 与 PC 行为一致性（extractTags/highlightTags/normalizeTags） / 共享数据层 ../js/ 调用规范 / 横屏 viewport 跳转脚本 / debounce 实现正确性 / Mobile 独有交互 bug

- [ ] **Step 8.2: 收集 4 份 finding 报告**

等所有 agent 完成。如果某 agent 结果质量明显差（finding < 3 条 / 无具体行号 / 笼统），重新 dispatch 该 agent 一次，prompt 加严格化要求。

- [ ] **Step 8.3: 合并到 findings-raw-2026-05-15.md**

```markdown
# Noteflow 全量审查 — Raw Findings (2026-05-15)

> 4 个 Explore agent 并行扫描原始输出，未做去重和打分。Task 9-10 后会产出 findings-scored。

[贴入 4 份 agent 报告，按子系统分节]

## 单测发现的 finding（来自 Task 3-7）

[如果 Task 3/4/5/6/7 任一暴露真实 bug，登记在此]
```

- [ ] **Step 8.4: 提交**

```bash
git add docs/superpowers/specs/findings-raw-2026-05-15.md && git commit -m "docs: Phase 1 raw findings — 4 agent 并行扫描结果"
```

---

## Task 9: Phase 2 — 跨文件一致性人工二次扫

**Files:**
- Modify: `docs/superpowers/specs/findings-raw-2026-05-15.md`（追加新 finding）

- [ ] **Step 9.1: 检查 1 — 标签正则 4 处**

Run: `node tests/check-regex-sync.cjs`
如果 Task 7 的脚本已通过，本步骤跳过；否则把不一致登记为新 finding（severity: high）。

- [ ] **Step 9.2: 检查 2 — PC vs Mobile 行为一致性**

Run:
```bash
grep -n "function extractTags\|function highlightTags\|function normalizeTags" js/modules/editor.js js/modules/timeline.js js/db-supabase.js mobile/js/app.js
```

人工对照 PC 与 Mobile 的实现：
- 输入边界（null/空字符串/数组/逗号字符串）
- 返回值（数组、字符串、HTML 片段）
- 错误处理风格

任何不一致登记 finding（severity: medium 或 high）。

- [ ] **Step 9.3: 检查 3 — db.js vs db-supabase.js 接口签名**

需要核对的方法清单：
- `addNote(text, tags)` — tags 必须是数组
- `addNotesBatch(notes, opts)`
- `updateNote(id, text, tags)` — async
- `getNoteById(id)` — async，返回 tags 数组
- `getNotes(filter)` — 返回 tags 数组
- `deleteNote(id)` — async
- `getAllTags()`
- `markDirty()` / `saveDb()`

Run:
```bash
grep -nE "^(async )?function (addNote|updateNote|getNoteById|getNotes|deleteNote|addNotesBatch|getAllTags|markDirty|saveDb)" js/db.js js/db-supabase.js
```

签名差异登记 finding（severity: medium）。

- [ ] **Step 9.4: 检查 4 — Init 幂等守门标志命名**

Run: `grep -n "_editorBound\|_searchBound\|globalListenersAttached" js/modules/editor.js js/modules/search.js`
确认守门标志命名一致、用法一致。

- [ ] **Step 9.5: 检查 5 — 错误处理风格**

Run: `grep -n "catch\|\.catch" js/db-supabase.js js/db.js js/app.js | head -50`
扫一眼是否有「吞掉错误」（catch 后不报错也不上报）。登记。

- [ ] **Step 9.6: 检查 6 — 双数据库 markDirty / saveDb 调用**

读 `js/app.js` 看哪些操作后调用了 markDirty。db-supabase.js 走的是直写云端，可能不需要 markDirty——确认是否有冗余/缺失。

- [ ] **Step 9.7: 在 findings-raw-2026-05-15.md 追加跨文件 finding**

```markdown
## 跨文件一致性二次扫 Findings

### Finding #X-1
- 文件: js/modules/editor.js:N, js/modules/timeline.js:M, ...
- 严重度: <按情况>
- 类型: inconsistency
- 描述: ...
- 建议修复: ...

[继续追加]
```

- [ ] **Step 9.8: 提交**

```bash
git add docs/superpowers/specs/findings-raw-2026-05-15.md && git commit -m "docs: Phase 2 跨文件一致性二次扫 finding 追加"
```

---

## Task 10: Phase 3 — 打分 + 排序

**Files:**
- Create: `docs/superpowers/specs/findings-scored-2026-05-15.md`

- [ ] **Step 10.1: 把 raw findings 按 severity 分组、按子系统排序**

```markdown
# Noteflow 全量审查 — Scored Findings (2026-05-15)

## 修复策略
- High：必修
- Medium：修
- Low：仅报告

## 子系统：Sync/DB

### High
1. **[原 Finding 编号] 简短描述**（finding 详情链接到 raw 文件）
   - 修复方案: ...
   - 影响文件: ...

### Medium
...

### Low (仅报告)
...

## 子系统：笔记主流程
...

## 子系统：用户/导出/工具
...

## 子系统：Mobile
...

## 跨文件一致性
...

---

## 修复执行顺序

1. 数据层（Sync/DB）— Task 11
2. 主流程（笔记 + 用户/导出/工具）— Task 12
3. Mobile — Task 13
4. 跨文件一致性穿插在以上 3 个 task 中处理（视位置归属）
```

- [ ] **Step 10.2: 检查每个 high 是否有清晰修复方案**

如果某 high 修复方案模糊，标 `[需进一步分析]`，不阻塞 Task 11 启动，但要在那个 finding 修之前先研究。

- [ ] **Step 10.3: 提交**

```bash
git add docs/superpowers/specs/findings-scored-2026-05-15.md && git commit -m "docs: Phase 3 finding 打分 + 修复清单"
```

---

## Task 11: Phase 4a — 修数据层（db.js + db-supabase.js）

**Files:**
- Modify: `js/db.js`、`js/db-supabase.js`（按 finding）
- 其它必要联动：`js/app.js`

> **执行模板**（针对每个 high/medium finding，按以下 TDD 循环走）：

- [ ] **Step 11.1: 读 finding-scored 中第一个数据层 finding**

- [ ] **Step 11.2: 写复现测试（如果是纯逻辑 bug）**

如果 finding 涉及纯逻辑（normalizeTags、extractTags 等）：在 `tests/unit/` 加一条断言复现该 bug。
如果 finding 涉及 IO/异步竞争：跳过单测，靠 Step 11.4 的代码审查 + 手测确认修复。

- [ ] **Step 11.3: 跑测试，确认失败**

Run: `node tests/run-all.cjs`
Expected: 新加的断言失败。

- [ ] **Step 11.4: 改代码修复**

按 finding 的「建议修复」字段动手。改完后：
- `node --check <修改的文件>`
- 重跑相关单测：`node tests/run-all.cjs`
- Expected: 新断言通过，旧断言不回归

- [ ] **Step 11.5: 重复 11.1-11.4 直到本子系统所有 high+medium finding 修完**

- [ ] **Step 11.6: 跑 build 确认产物同步**

Run: `bash build.sh`
Expected: 退出码 0，dist/ 和 docs/ 同步成功。

- [ ] **Step 11.7: 提交（一个 commit 包含所有数据层修复）**

```bash
git add tests/unit/*.test.cjs js/db.js js/db-supabase.js js/app.js dist/ docs/ && \
git commit -m "$(cat <<'EOF'
fix(data): 全量审查数据层修复（findings #X1, #X2, ...）

修复 db.js 与 db-supabase.js 中暴露的 high/medium 问题：
- [按 finding 列简述，每条一行]

测试：tests/unit/*.test.cjs 加断言保护，run-all.cjs 全过。

Refs: docs/superpowers/specs/findings-scored-2026-05-15.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

> **风险阈值**：如果数据层 high finding > 5 条，**停下来**通知用户讨论是否拆 PR（spec 风险与回退章节）。

---

## Task 12: Phase 4b — 修主流程（modules/* + utils/*）

**Files:**
- Modify: `js/modules/editor.js`、`timeline.js`、`tags.js`、`search.js`、`user.js`、`export.js`、`js/utils/*`、`js/app.js`

> **执行模板与 Task 11 相同**：每个 finding 按「写复现测试 → 失败 → 修代码 → 通过」循环。

- [ ] **Step 12.1-N: 对每个主流程 high/medium finding，走 Task 11 的 11.1-11.4 模板**

- [ ] **Step 12.M: 跨文件正则一致性必须通过**

Run: `node tests/check-regex-sync.cjs`
Expected: 4 处正则一致。如不一致，本 task 必须修到一致才能完成。

- [ ] **Step 12.M+1: 验证幂等守门**

读 editor.js / search.js 的 init 函数，确认：
- element-level: `if (el._editorBound) return;`
- document-level: `if (globalListenersAttached) return;`
- 命名与现有约定一致

- [ ] **Step 12.M+2: build + commit**

```bash
bash build.sh && \
git add tests/ js/modules/ js/utils/ js/app.js dist/ docs/ && \
git commit -m "$(cat <<'EOF'
fix(modules): 全量审查主流程修复（findings #X3, #X4, ...）

[按 finding 列简述]

正则一致性脚本通过：node tests/check-regex-sync.cjs。

Refs: docs/superpowers/specs/findings-scored-2026-05-15.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Phase 4c — 修 Mobile

**Files:**
- Modify: `mobile/js/app.js`

> **执行模板与 Task 11 相同**。

- [ ] **Step 13.1-N: 走 Task 11 的 11.1-11.4 模板修每个 mobile finding**

- [ ] **Step 13.M: PC vs Mobile 行为对齐**

读 PC 端 `extractTags` / `highlightTags` / `normalizeTags`，对照 Mobile 实现，确认行为一致（输入输出表格）。

- [ ] **Step 13.M+1: build + commit**

```bash
bash build.sh && \
git add tests/ mobile/ dist/ docs/ && \
git commit -m "$(cat <<'EOF'
fix(mobile): 全量审查 Mobile 端修复（findings #X5, ...）

[按 finding 列简述]

Refs: docs/superpowers/specs/findings-scored-2026-05-15.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Phase 6 — Verification

**Files:** 无新建文件，仅运行验证命令

> **使用 superpowers:verification-before-completion** — 所有命令必须实跑并贴出实际输出，禁止「应该没问题」。

- [ ] **Step 14.1: 全部 js 文件语法检查**

Run:
```bash
find js mobile/js -name "*.js" -exec node --check {} \;
```
Expected: 无任何 SyntaxError 输出，退出码 0。

- [ ] **Step 14.2: 单测全跑**

Run: `node tests/run-all.cjs`
Expected: `N passed, 0 failed`，退出码 0。

- [ ] **Step 14.3: 跨文件正则一致性**

Run: `node tests/check-regex-sync.cjs`
Expected: `✓ 4 处正则一致`，退出码 0。

- [ ] **Step 14.4: build 通过 + 产物对齐**

Run:
```bash
bash build.sh
git diff --stat dist/ docs/
```
Expected: build 退出码 0；diff 显示源文件改动同步进了 dist/docs。

- [ ] **Step 14.5: 工作区干净（确认没漏掉文件）**

Run: `git status --short`
Expected: 仅剩 plan/spec/findings/report 等本轮新增 docs，不应有源代码 staged 之外的脏文件。

- [ ] **Step 14.6: 任一失败回退**

如果上述任一失败：
- 14.1 失败 → 修语法 → 回 Task 11/12/13 对应文件
- 14.2 失败 → 看哪个测试失败 → 回到对应 Task 修
- 14.3 失败 → 回 Task 12 修正则
- 14.4 失败 → build.sh 内部错误，单独排查

修完重跑 14.1-14.5 直到全过。**禁止跳过失败项**。

---

## Task 15: Phase 7 — 文档同步与最终提交

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md`
- Modify: `CLAUDE.md`、`AGENTS.md`

- [ ] **Step 15.1: 写审查报告**

```markdown
# Noteflow 全量审查报告 (2026-05-15)

## 概要
- 范围：PC + Mobile 全量
- 发现 finding：N high / M medium / K low
- 修复：N+M（高+中），低优 K 条仅报告
- 新增单测：4 个文件 + 1 个一致性脚本

## 发现总览
[表格：子系统 × severity 数量]

## High Findings 修复对照
| Finding# | 描述 | Commit | 验证方式 |
|---|---|---|---|
| ... | ... | abc1234 | tests/unit/X.test.cjs |

## Medium Findings 修复对照
[同上]

## Low Findings (仅报告)
[列出，每条简述 + 建议但本轮不动]

## 单测覆盖
- extractTags: <断言数>
- normalizeTags: <断言数>
- buildTagTree: <断言数>
- highlightTags: <断言数>
- check-regex-sync: 4 处文件

## 风险与遗留
- 未跑浏览器 e2e（用户偏好）
- [其它]
```

- [ ] **Step 15.2: 更新 CLAUDE.md**

Modify 区块：
- **Bug 表格**：把 high/medium finding 加入「主流程致命 bug」或新建「全量审查 bug 表（2026-05-15）」
- **重要决策记录**：追加 2026-05-15 引入 node 单测 + check-regex-sync 决策（含 why）
- **已知坑**：追加 #5 升级——「跑 `node tests/check-regex-sync.cjs` 自动验证 4 处正则」
- **当前进度**：清空脏状态描述，改为「2026-05-15 全量审查完成，N 项 finding 已修，单测护栏到位，未 push」
- **当前目标**：勾掉本轮，加一条「等用户确认后 push」
- **最后更新**：改 2026-05-15

- [ ] **Step 15.3: 同步 AGENTS.md**

Run: `diff CLAUDE.md AGENTS.md` 看哪些段落落后。重点同步：
- 版本号
- 标签正则示例（含连字符）
- 含正则的 4 个文件清单（修正之前误把 export.js/flomoImport.js 列进去的错误）
- Bug 表格
- 双数据库接口签名约定

- [ ] **Step 15.4: 最终 build + 验证**

Run:
```bash
bash build.sh
git status --short
```
Expected: build 通过；status 只剩本步骤将提交的 docs 文件。

- [ ] **Step 15.5: 提交文档**

```bash
git add docs/superpowers/specs/2026-05-15-noteflow-full-audit-report.md \
        docs/superpowers/specs/findings-raw-2026-05-15.md \
        docs/superpowers/specs/findings-scored-2026-05-15.md \
        CLAUDE.md AGENTS.md dist/ docs/ && \
git commit -m "$(cat <<'EOF'
docs: 全量审查报告 + CLAUDE/AGENTS 同步

- 审查报告：findings-scored 与 audit-report
- CLAUDE.md：bug 表格、决策记录、已知坑、当前进度全部更新到 2026-05-15
- AGENTS.md：与 CLAUDE.md 拉齐到 v1.3.2 + 本轮变更

不 push，等用户最终决定。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 15.6: 给用户最终报告**

输出包括：
- 总 finding 数（high/medium/low）
- 修复 commit 列表（git log --oneline，本轮所有 commit）
- 单测护栏一览
- 是否 push 决策点

---

## 跨任务原则

1. **禁止跳过验证**：每个 task 末尾的 build/test 命令必须实跑，禁止「应该过」。
2. **频繁 commit**：每个 task 至少 1 个 commit，不堆大 diff。
3. **测试优先**：能写复现测试的 finding 必写，确保后续不回归。
4. **不 push**：所有 commit 留在本地，最终由用户决定推不推（CLAUDE.md「公司网络 GitHub 不稳」+ 用户掌控）。
5. **遇阻停止**：单 task 卡 > 30 min 必须停下来报告，禁止硬刚。
6. **YAGNI**：不在审查范围里出现的「顺手优化」一律不动，避免 diff 爆炸。

---

## 自查（writing-plans 强制项）

- ✅ 所有 task 有具体 file path 和 line number 区域
- ✅ Task 2-7 测试代码完整给出（不是 TBD）
- ✅ Task 8 agent prompt 完整，4 个 agent 各自的 FILES/FOCUS 列全
- ✅ Task 11/12/13 的「修代码」步骤是 TDD 模板（先测后改），适用于任何 finding
- ✅ Task 14 验证命令具体到 shell 指令 + 期望输出
- ✅ Task 15 文档更新点清晰（哪几个区块改、改成什么）
- ⚠️ Task 11/12/13 没有具体修复代码——这是因为 findings 在 Task 8-10 之后才出来。模板覆盖了所有 finding 形态（纯逻辑 / IO / 异步），执行时按模板套即可。
- ✅ 类型一致性：`normalizeTags` / `extractTags` / `highlightTags` / `buildTagTree` 在所有 task 命名一致
- ✅ Spec 偏差（13 项修复实际已提交）在 Task 1 反映
