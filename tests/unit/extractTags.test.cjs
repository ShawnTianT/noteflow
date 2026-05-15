#!/usr/bin/env node
// tests/unit/extractTags.test.cjs
// 单测：标签提取正则。从 js/modules/editor.js 动态读出正则字面量，
// 然后跑 known-good / 边界 / URL fragment 等断言。
// 跨文件正则一致性由 tests/check-regex-sync.cjs（Task 7）单独检查。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// 从源文件文本里抽出 /#(...)/g 正则字面量。返回 pattern source（不含 / 分隔符）。
// 处理转义：内部允许 \X 和非 /\ 字符。
function extractTagRegexSource(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  // 匹配 /#( ... )/g，其中 ... 由 (非 / 非 \) 或 (\X) 组成
  const m = src.match(/\/#\((?:[^/\\]|\\.)+\)\/g/);
  if (!m) {
    throw new Error(`No tag regex found in ${filePath}. Inspect the file and adjust the extractor.`);
  }
  const lit = m[0];
  // 去掉前后的 / 和尾部 g
  return lit.slice(1, lit.lastIndexOf('/'));
}

// 用提取出来的 regex source 提取标签
function extractTags(content, regexSource) {
  const re = new RegExp(regexSource, 'g');
  const tags = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

// editor.js 是 canonical source
const editorPath = path.join(root, 'js/modules/editor.js');
const regexSrc = extractTagRegexSource(editorPath);
console.log(`Tag regex source from editor.js: /${regexSrc}/g`);

let testCount = 0;
const failures = [];

function check(desc, actual, expected) {
  testCount++;
  try {
    assert.deepStrictEqual(actual, expected, desc);
  } catch (e) {
    failures.push({ desc, expected, actual });
    console.error(`✗ ${desc}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// === Known-good cases (must extract) ===
check('中文标签', extractTags('#中文', regexSrc), ['中文']);
check('英文标签', extractTags('#abc', regexSrc), ['abc']);
check('中英数混合', extractTags('#中英mix123', regexSrc), ['中英mix123']);
check('一级标签含连字符 (CLAUDE.md 已知坑 v1.3.2)', extractTags('#复盘-周', regexSrc), ['复盘-周']);
check('含单引号 + 斜杠层级', extractTags("#area's/跑步", regexSrc), ["area's/跑步"]);
check('多层斜杠', extractTags('#a/b/c', regexSrc), ['a/b/c']);

// === Multiple tags ===
check('多标签提取顺序', extractTags('#a #b #c', regexSrc), ['a', 'b', 'c']);
check('重复标签都返回（去重在调用方）', extractTags('#a #a', regexSrc), ['a', 'a']);

// === Boundary cases (must NOT extract) ===
check('空内容', extractTags('', regexSrc), []);
check('# 后空格不算标签', extractTags('# space', regexSrc), []);

// === URL fragment ===
// 现状：正则本身会从 URL 中提取 fragment（'anchor'）。
// CLAUDE.md commit fd21df8 说"URL fragment 不再误识为标签" — 修复必定在调用方过滤层，
// 不在正则本身。这里只记录正则的实际行为，不当 finding。
const urlContent = 'visit https://example.com#anchor';
const urlTags = extractTags(urlContent, regexSrc);
if (urlTags.length === 0) {
  check('URL fragment 不抓 (CLAUDE.md 已知坑 commit fd21df8)', urlTags, []);
} else {
  console.error(`! 注意: 正则本身会从 URL 中提取 fragment（${JSON.stringify(urlTags)}）。`);
  console.error(`  CLAUDE.md 说该 case 已修复 — 修复必定在调用方过滤层。`);
  console.error(`  这不一定是 finding，但 Task 8/9 应核查调用层是否真的过滤了。`);
}

// === Special chars filter ===
// CLAUDE.md 说 "#campaign2" 被 /^[a-zA-Z]+\d+$/ 过滤 — 那是后置过滤，不在正则里。
// 所以 extractTags 本身应该返回 ['campaign2']。
check('英文+数字组合标签（过滤在调用层）', extractTags('#campaign2', regexSrc), ['campaign2']);

// === Summary ===
console.log(`\n${testCount} assertions, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILED ASSERTIONS (登记为 finding，Task 8 会用到) ===');
  for (const f of failures) {
    console.error(`- ${f.desc}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`);
  }
  process.exit(1);
}

console.log('All extractTags assertions passed.');
process.exit(0);
