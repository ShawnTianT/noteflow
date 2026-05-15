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

// Match the tag regex literal: /#(...)/g where the group can contain escaped chars,
// brackets, parens, slashes (escaped), unicode etc.
// Pattern: /#\(...\)/g — we look for `/#` followed by content up to `/g` boundary.
// Anchor on `/#` and end on `/g` to avoid matching unrelated regexes.
function findTagRegexes(src) {
  const matches = [];
  // Look for /#(...)\/g style — non-greedy, capture full literal
  // Use a manual scan: find each "/#(", then walk forward tracking brace/paren depth in regex syntax.
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('/#(', i);
    if (start === -1) break;
    // Find the closing /g — search for the next "/g" that ends a regex literal
    // (not inside a comment or string — keep this simple, source is well-formed)
    let j = start + 3;  // past `/#(`
    while (j < src.length) {
      // Skip escaped chars
      if (src[j] === '\\') { j += 2; continue; }
      // Find /g at end
      if (src[j] === '/') {
        // Check next char is `g` (followed by non-identifier)
        if (src[j + 1] === 'g' && !/[a-zA-Z0-9_]/.test(src[j + 2] || ' ')) {
          matches.push(src.slice(start, j + 2));
          j += 2;
          break;
        }
      }
      j++;
    }
    i = j;
  }
  return matches;
}

const results = TARGETS.map(({ file, label }) => {
  const fullPath = path.join(root, file);
  const src = fs.readFileSync(fullPath, 'utf8');
  const regexes = [...new Set(findTagRegexes(src))];
  return { file, label, regexes };
});

console.log('Found tag regex literals per file:');
for (const r of results) {
  console.log(`  ${r.label} (${r.file}):`);
  if (r.regexes.length === 0) {
    console.log(`    (none — possible problem)`);
  } else {
    for (const re of r.regexes) console.log(`    ${re}`);
  }
}

// Aggregate all distinct regex literals across files
const allRegexes = new Set();
for (const r of results) {
  if (r.regexes.length === 0) continue;
  for (const re of r.regexes) allRegexes.add(re);
}

if (allRegexes.size === 0) {
  console.error('\n✗ 没找到任何标签正则字面量。');
  console.error('  可能原因：(1) 源码结构变了，本脚本的扫描器需要调整；(2) 标签正则被搬到别处。');
  process.exit(1);
}

if (allRegexes.size > 1) {
  console.error('\n✗ 4 处正则不一致。CLAUDE.md 已知坑 #5——必须同步。');
  console.error('  发现的不同变体：');
  for (const re of allRegexes) console.error(`    ${re}`);
  process.exit(1);
}

console.log(`\n✓ 4 处正则一致：${[...allRegexes][0]}`);
process.exit(0);
