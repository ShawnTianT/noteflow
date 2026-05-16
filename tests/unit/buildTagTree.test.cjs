#!/usr/bin/env node
// tests/unit/buildTagTree.test.cjs
// 单测：buildTagTree（位于 js/modules/tags.js 内的 IIFE 模块 TagsModule 中）
//
// 函数特性（实测，与 CLAUDE.md "P3 缓存" 描述一致）：
//   - 输入：tags 数组，元素为 { name: string, count: number } 对象（不是裸字符串）
//   - 输出：root 节点数组，每个节点 { name, count, children: [] }
//   - 仅按"第一个 /"分组：parent = name.slice(0, indexOf('/'))，child = 原 tag 对象（保留全名）
//   - 因此 'a/b/c' 不会被拆成 a → b → c 三层；root='a'，child={name:'a/b/c'} 直接挂在 root.children 上。
//     这是 finding：函数命名为 "Tree" 但实际只支持 2 级，3+ 级会塌缩成 root + 完整路径 child。
//   - count 累加：同名 root 多次出现 / 同 root 下多个 child 时，root.count = Σ child.count
//   - P3 缓存：闭包级 _treeCache 按 (tags 引用 + length) 缓存上一次结果
//
// 由于 buildTagTree 是 IIFE 内部函数，且依赖闭包变量 _treeCache，
// 这里抠出函数声明后用 new Function 包一层，并在包装层声明同名 _treeCache，
// 让函数能闭包到自己的缓存对象上（每次 loadFn 得到独立缓存实例）。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// 与 normalizeTags.test.cjs 相同的大括号配对抠函数法
function loadBuildTagTree(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const headRe = /function\s+buildTagTree\s*\(/;
  const headMatch = src.match(headRe);
  if (!headMatch) throw new Error(`buildTagTree declaration not found in ${filePath}`);
  const start = headMatch.index;
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) throw new Error('No body opening brace');
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error('Unbalanced braces');
  const fnSrc = src.slice(start, end);
  // 包装：在外层声明 _treeCache，让函数闭包能引用到（NF-6 后用 sig 字段）。
  return new Function(`
    let _treeCache = { tagsRef: null, sig: null, tree: null };
    ${fnSrc}
    return buildTagTree;
  `)();
}

let buildTagTree;
try {
  buildTagTree = loadBuildTagTree(path.join(root, 'js/modules/tags.js'));
} catch (e) {
  console.error('Failed to load buildTagTree from source:', e.message);
  process.exit(2);
}

let testCount = 0;
const failures = [];

function check(desc, condition, details) {
  testCount++;
  if (!condition) {
    failures.push({ desc, details });
    console.error(`x ${desc}: ${details || ''}`);
  }
}

// 辅助：构造 tag 对象数组
const T = (...specs) => specs.map(s => {
  if (typeof s === 'string') return { name: s, count: 1 };
  return s;
});

// === 1. 单层标签 ===
{
  const tree = buildTagTree(T('a', 'b', 'c'));
  check('单层: 3 个 root 节点', Array.isArray(tree) && tree.length === 3,
    `got ${JSON.stringify(tree)}`);
  if (tree.length === 3) {
    const names = tree.map(n => n.name).sort();
    check('单层: 节点名 = a,b,c', JSON.stringify(names) === '["a","b","c"]',
      `got ${JSON.stringify(names)}`);
    check('单层: 每个节点 children 为空数组',
      tree.every(n => Array.isArray(n.children) && n.children.length === 0),
      `got ${JSON.stringify(tree)}`);
    check('单层: 每个节点 count = 1',
      tree.every(n => n.count === 1),
      `got ${JSON.stringify(tree)}`);
  }
}

// === 2. 多级（同 parent 多 child） ===
{
  const tree = buildTagTree(T('parent/child1', 'parent/child2'));
  check('多级: 同 parent 合并为 1 root', Array.isArray(tree) && tree.length === 1,
    `got ${JSON.stringify(tree)}`);
  if (tree.length === 1) {
    check('多级: root.name = "parent"', tree[0].name === 'parent',
      `got ${JSON.stringify(tree[0].name)}`);
    check('多级: root 有 2 个 children',
      Array.isArray(tree[0].children) && tree[0].children.length === 2,
      `got ${JSON.stringify(tree[0])}`);
    check('多级: root.count = 2 (child count 累加)', tree[0].count === 2,
      `got count=${tree[0].count}`);
    check('多级: child 名保留全路径',
      tree[0].children.every(c => c.name === 'parent/child1' || c.name === 'parent/child2'),
      `got ${JSON.stringify(tree[0].children.map(c => c.name))}`);
  }
}

// === 3. 空输入 ===
{
  const tree = buildTagTree([]);
  check('空数组 → 空树', Array.isArray(tree) && tree.length === 0,
    `got ${JSON.stringify(tree)}`);
}

// === 4. 重复根标签合并 ===
// 输入两个 name 相同的 tag 对象（无 /），count 应该累加到同一个 root
{
  const tree = buildTagTree([
    { name: 'a', count: 3 },
    { name: 'a', count: 5 },
  ]);
  check('重复 root: 合并为 1 个节点', tree.length === 1,
    `got ${JSON.stringify(tree)}`);
  if (tree.length === 1) {
    check('重复 root: count 累加 (3+5=8)', tree[0].count === 8,
      `got count=${tree[0].count}`);
    check('重复 root: children 仍为空（无 /）',
      Array.isArray(tree[0].children) && tree[0].children.length === 0,
      `got ${JSON.stringify(tree[0].children)}`);
  }
}

// === 5. 3+ 级深度 ===
// 实测：buildTagTree 只取第一个 / 切 parent，子节点保留全名。
// 'a/b/c' / 'a/b/d' 不会形成 a → b → {c,d} 真三层树，而是 root='a'，children=[{name:'a/b/c'},{name:'a/b/d'}]
// 这是 finding（函数命名 "Tree" 与实际只支持 2 级不一致），见文件头注释。
{
  const tree = buildTagTree(T('a/b/c', 'a/b/d'));
  check('3 级输入: 1 个 root', tree.length === 1,
    `got ${JSON.stringify(tree)}`);
  if (tree.length === 1) {
    check('3 级输入: root.name = "a"（取第一个 / 之前）', tree[0].name === 'a',
      `got ${JSON.stringify(tree[0].name)}`);
    check('3 级输入: root 直接挂 2 个 children（无中间层 b）',
      tree[0].children.length === 2,
      `got ${JSON.stringify(tree[0].children)}`);
    check('3 级输入: child.name 保留全路径 a/b/c, a/b/d',
      tree[0].children.every(c => c.name === 'a/b/c' || c.name === 'a/b/d'),
      `got ${JSON.stringify(tree[0].children.map(c => c.name))}`);
    // 显式记录：child 没有自己的 children 字段（保留的是原 tag 对象）
    check('3 级输入 [finding]: child 无 .children 字段（不是真三层树）',
      tree[0].children.every(c => c.children === undefined),
      `got ${JSON.stringify(tree[0].children)}`);
  }
}

// === 6. 混合深度 ===
// 输入：'a'（1 级）, 'a/b'（2 级）, 'c/d/e'（3 级）
// 期望：2 个 root（'a' 与 'c'）；'a' 有 1 个 child 'a/b'；'c' 有 1 个 child 'c/d/e'
{
  const tree = buildTagTree(T('a', 'a/b', 'c/d/e'));
  check('混合深度: 2 个 root (a, c)', tree.length === 2,
    `got ${JSON.stringify(tree.map(n => n.name))}`);
  if (tree.length === 2) {
    const a = tree.find(n => n.name === 'a');
    const c = tree.find(n => n.name === 'c');
    check('混合深度: root "a" 存在', !!a, `got ${JSON.stringify(tree.map(n => n.name))}`);
    check('混合深度: root "c" 存在', !!c, `got ${JSON.stringify(tree.map(n => n.name))}`);
    if (a) {
      // 'a' 自己 count=1 + child 'a/b' count=1，所以 a.count = 2
      check('混合深度: root "a".count = 2 (自身1 + child1)', a.count === 2,
        `got count=${a.count}`);
      check('混合深度: root "a" 有 1 child a/b',
        a.children.length === 1 && a.children[0].name === 'a/b',
        `got ${JSON.stringify(a.children)}`);
    }
    if (c) {
      check('混合深度: root "c".count = 1 (仅 child)', c.count === 1,
        `got count=${c.count}`);
      check('混合深度: root "c" 有 1 child c/d/e',
        c.children.length === 1 && c.children[0].name === 'c/d/e',
        `got ${JSON.stringify(c.children)}`);
    }
  }
}

// === 7. 排序：root 按 count 降序 ===
{
  const tree = buildTagTree([
    { name: 'low', count: 1 },
    { name: 'high', count: 10 },
    { name: 'mid', count: 5 },
  ]);
  check('排序: root 按 count 降序', tree.length === 3 && tree[0].name === 'high' && tree[1].name === 'mid' && tree[2].name === 'low',
    `got ${JSON.stringify(tree.map(n => n.name + '=' + n.count))}`);
}

// === 8. 排序：children 按 count 降序 ===
{
  const tree = buildTagTree([
    { name: 'p/x', count: 1 },
    { name: 'p/y', count: 9 },
    { name: 'p/z', count: 5 },
  ]);
  check('排序: children 按 count 降序',
    tree.length === 1 &&
    tree[0].children[0].name === 'p/y' &&
    tree[0].children[1].name === 'p/z' &&
    tree[0].children[2].name === 'p/x',
    `got ${JSON.stringify(tree[0] && tree[0].children.map(c => c.name + '=' + c.count))}`);
}

// === 9. 缓存：同一个数组引用第二次调用应返回同一对象（=== 引用相等） ===
{
  const tags = T('a', 'b/c');
  const t1 = buildTagTree(tags);
  const t2 = buildTagTree(tags);
  check('P3 缓存: 同引用 + 同 length → 返回同一对象引用', t1 === t2,
    `t1===t2: ${t1 === t2}`);
}

// === 10. 缓存失效：换一个数组引用应当重建 ===
{
  const a = T('x', 'y');
  const b = T('x', 'y');
  const t1 = buildTagTree(a);
  const t2 = buildTagTree(b);
  check('P3 缓存: 换引用 → 缓存失效，返回新对象', t1 !== t2,
    `t1===t2: ${t1 === t2}（应不等）`);
}

// === 11. 缓存失效：同引用但 length 变化（push 后） ===
{
  const tags = T('a');
  const t1 = buildTagTree(tags);
  tags.push({ name: 'b', count: 1 });
  const t2 = buildTagTree(tags);
  check('P3 缓存: 同引用但 length 变化 → 缓存失效',
    t1 !== t2 && t2.length === 2,
    `t1===t2: ${t1 === t2}, t2.length=${t2.length}`);
}

// === 11b. NF-6 回归: 同引用 + 同 length，但原地改 count → 缓存必须失效 ===
// 原实现只比 tagsRef + length，count 变化不会触发重建（add 已存在 tag 时 root.count 与 children.count 与实际不一致）。
// 修复后用 name:count 内容签名比对。
{
  const tags = [
    { name: 'p/x', count: 1 },
    { name: 'p/y', count: 1 },
  ];
  const t1 = buildTagTree(tags);
  tags[0].count = 9; // 同引用、同 length，但内容变了
  const t2 = buildTagTree(tags);
  check('NF-6: 同引用同长度但 count 变化 → 缓存失效（返回新对象）',
    t1 !== t2,
    `t1===t2: ${t1 === t2}（应不等）`);
  // 新树的 root.count 应反映新 count（1 + 9 = 10）
  if (t2.length === 1) {
    check('NF-6: 重建后 root.count 反映新 count (1+9=10)',
      t2[0].count === 10,
      `got count=${t2[0].count}`);
  }
}

// === 12. 边界：tag 名以 / 开头（slashIdx === 0 走 else 分支） ===
// 实测：indexOf('/') > 0 才进多级分支；slashIdx === 0 ('/foo') 走单级分支，整个名字作为 root.name
{
  const tree = buildTagTree(T('/leadingslash'));
  check('边界: 以 / 开头当作单级标签处理',
    tree.length === 1 && tree[0].name === '/leadingslash' && tree[0].children.length === 0,
    `got ${JSON.stringify(tree)}`);
}

console.log(`\n${testCount} assertions, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILED ASSERTIONS ===');
  for (const f of failures) console.error(`- ${f.desc}: ${f.details}`);
  process.exit(1);
}
console.log('All buildTagTree assertions passed.');
console.log('NOTE: 函数命名 "Tree" 但仅支持 2 级（按第一个 / 切 parent），3+ 级会塌缩成 root+全路径 child。Finding 留给 Task 8/10。');
process.exit(0);
