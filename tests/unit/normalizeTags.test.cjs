#!/usr/bin/env node
// tests/unit/normalizeTags.test.cjs
// 单测：normalizeTags 跨实现一致性。
// CLAUDE.md 声称 normalizeTags 在 3 处实现：js/db.js、js/db-supabase.js、mobile/js/app.js。
// 实测：mobile/js/app.js 没有 normalizeTags（它共用 ../js/ 数据层），CLAUDE.md 此处描述错误。
// 因此本测试只覆盖现存 2 个实现（db.js + db-supabase.js）。
// 该结构性偏差登记为 finding，待 Task 8/15 修 CLAUDE.md。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// 用括号配对从源码里抠出整个函数声明，避免 lazy regex 漏内层 } 的边界 case。
function loadFn(filePath, fnName) {
  const src = fs.readFileSync(filePath, 'utf8');
  const headRe = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const headMatch = src.match(headRe);
  if (!headMatch) {
    throw new Error(`${fnName} declaration not found in ${filePath}`);
  }
  const start = headMatch.index;
  // 从函数名往后找第一个 { 然后做大括号配对
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) throw new Error(`No body opening brace for ${fnName} in ${filePath}`);
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
  if (end === -1) throw new Error(`Unbalanced braces in ${fnName} body of ${filePath}`);
  const fnSrc = src.slice(start, end);
  return new Function(`${fnSrc} return ${fnName};`)();
}

const dbNormalize = loadFn(path.join(root, 'js/db.js'), 'normalizeTags');
const supaNormalize = loadFn(path.join(root, 'js/db-supabase.js'), 'normalizeTags');

// mobile/js/app.js 没有 normalizeTags（CLAUDE.md 错），跳过。Finding 记录见文件头注释。
const impls = [
  ['db', dbNormalize],
  ['supa', supaNormalize],
];

const cases = [
  { input: ['a', 'b'], expect: ['a', 'b'], desc: 'array passthrough' },
  { input: 'a,b,c', expect: ['a', 'b', 'c'], desc: 'comma string -> array' },
  { input: 'a, b , c ', expect: ['a', 'b', 'c'], desc: 'comma string with whitespace' },
  { input: '', expect: [], desc: 'empty string -> []' },
  { input: null, expect: [], desc: 'null -> []' },
  { input: undefined, expect: [], desc: 'undefined -> []' },
  { input: 'single', expect: ['single'], desc: 'single tag string' },
  { input: [], expect: [], desc: 'empty array' },
  { input: '["a","b","c"]', expect: ['a', 'b', 'c'], desc: 'JSON 字符串 → array (db.js 与 db-supabase 对齐)' },
];

let testCount = 0;
const failures = [];

for (const { input, expect, desc } of cases) {
  for (const [name, fn] of impls) {
    testCount++;
    let got;
    try {
      got = fn(input);
    } catch (e) {
      failures.push({ impl: name, desc, input, expect, got: `THROW: ${e.message}` });
      console.error(`x [${name}] ${desc}: input=${JSON.stringify(input)}, threw=${e.message}`);
      continue;
    }
    try {
      assert.deepStrictEqual(got, expect);
    } catch (e) {
      failures.push({ impl: name, desc, input, expect, got });
      console.error(`x [${name}] ${desc}: input=${JSON.stringify(input)}, got=${JSON.stringify(got)}, want=${JSON.stringify(expect)}`);
    }
  }
}

console.log(`\n${testCount} assertions, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILED ASSERTIONS (登记为 finding，Task 8/11 会用到) ===');
  for (const f of failures) {
    console.error(`- [${f.impl}] ${f.desc}: input=${JSON.stringify(f.input)}, expected=${JSON.stringify(f.expect)}, got=${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}

console.log(`All normalizeTags assertions passed (2 impls x ${cases.length} cases = ${testCount} checks).`);
console.log('NOTE: mobile/js/app.js has no normalizeTags — CLAUDE.md description is stale (finding for Task 8/15).');
process.exit(0);
