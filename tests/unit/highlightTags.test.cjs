#!/usr/bin/env node
// tests/unit/highlightTags.test.cjs
// 单测：highlightTags（PC + Mobile 两处实现）
// 注意：highlightTags 期待输入已经是 escapeHtml 之后的 "html"，
// XSS 防护由调用方的 escapeHtml 负责。本测试验证：
//   1. 基础 tag 包装为 <span class="tag-highlight">#tag</span>
//   2. 函数本身不会因 tag 名而引入新的不安全片段（regex 字符类限制保证）
//   3. URL 内 #fragment 被占位符保护，不被高亮
//   4. 层级标签 (#a/b) 与空输入处理
//   5. PC 与 Mobile 两处实现行为一致
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

// 通用函数加载器：支持 `function name(args) {...}` 和方法简写 `name(args) {...}`
// 通过括号 + 大括号配对手动切片，再用 new Function 构造同名函数。
function loadFn(filePath, fnName) {
  const src = fs.readFileSync(filePath, 'utf8');
  const patterns = [
    // function name(
    new RegExp(`function\\s+${fnName}\\s*\\(`),
    // 方法简写 name(    （行首+缩进，避免误匹配调用点）
    new RegExp(`(?:^|\\n)\\s*${fnName}\\s*\\(`, 'm'),
  ];
  let m = null;
  let startIdx = -1;
  for (const re of patterns) {
    const r = src.match(re);
    if (r) {
      m = r;
      // 把锚点定位到函数名首字符（跳过前置空白/换行）
      const nameOffset = r[0].indexOf(fnName);
      startIdx = r.index + (nameOffset >= 0 ? nameOffset : 0);
      // 如果是 function 形式，回退到 function 关键字
      const before = src.slice(Math.max(0, r.index), startIdx);
      if (/function\s*$/.test(before)) {
        startIdx = r.index + before.search(/function/);
      }
      break;
    }
  }
  if (!m) throw new Error(`${fnName} not found in ${filePath}`);

  // 找参数列表 ( ... )
  const openParen = src.indexOf('(', startIdx);
  if (openParen < 0) throw new Error(`No ( after ${fnName}`);
  let pdepth = 0;
  let closeParen = -1;
  for (let j = openParen; j < src.length; j++) {
    if (src[j] === '(') pdepth++;
    else if (src[j] === ')') {
      pdepth--;
      if (pdepth === 0) { closeParen = j; break; }
    }
  }
  if (closeParen < 0) throw new Error(`Unbalanced ( in ${fnName}`);
  const args = src.slice(openParen + 1, closeParen);

  // 找函数体 { ... }
  const openBrace = src.indexOf('{', closeParen);
  if (openBrace < 0) throw new Error(`No { after args of ${fnName}`);
  let bdepth = 0;
  let closeBrace = -1;
  for (let j = openBrace; j < src.length; j++) {
    if (src[j] === '{') bdepth++;
    else if (src[j] === '}') {
      bdepth--;
      if (bdepth === 0) { closeBrace = j; break; }
    }
  }
  if (closeBrace < 0) throw new Error(`Unbalanced { in ${fnName}`);
  const body = src.slice(openBrace + 1, closeBrace);

  // 构造函数。注：highlightTags 不依赖外部变量，纯字符串 in/out。
  // eslint-disable-next-line no-new-func
  return new Function(args, body);
}

let pcHighlight, mobileHighlight;
try {
  pcHighlight = loadFn(path.join(root, 'js/modules/timeline.js'), 'highlightTags');
} catch (e) {
  console.error('Failed to load highlightTags from timeline.js:', e.message);
  process.exit(2);
}
try {
  mobileHighlight = loadFn(path.join(root, 'mobile/js/app.js'), 'highlightTags');
} catch (e) {
  console.error('Failed to load highlightTags from mobile/js/app.js:', e.message);
  process.exit(2);
}

let testCount = 0;
const failures = [];

function check(desc, condition, details) {
  testCount++;
  if (!condition) {
    failures.push({ desc, details });
    console.error(`✗ ${desc}: ${details || ''}`);
  }
}

// === 1. 基础 tag 包装 ===
{
  const input = '#中文 文本';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: 中文 tag 被包装为 tag-highlight span',
    pcOut.includes('<span class="tag-highlight">#中文</span>'),
    `got: ${pcOut}`);
  check('Mobile: 中文 tag 被包装为 tag-highlight span',
    mOut.includes('<span class="tag-highlight">#中文</span>'),
    `got: ${mOut}`);
}

{
  const input = '#abc';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: 英文 tag 被包装',
    pcOut === '<span class="tag-highlight">#abc</span>',
    `got: ${pcOut}`);
  check('Mobile: 英文 tag 被包装',
    mOut === '<span class="tag-highlight">#abc</span>',
    `got: ${mOut}`);
}

// === 2. XSS 防护 ===
// highlightTags 仅对 regex 字符类内的字符做匹配，字符类是 [\w一-龥'-]，
// 不含 <, >, &, ", '。所以 highlightTags 永远不会把不安全字符塞进 span 包装。
// 调用方需要先 escapeHtml(text) 再传给 highlightTags。
{
  // case A: 含 <script> 的"原始未转义"输入 — highlightTags 不应匹配 #<...>
  const malicious = '#<script>alert(1)</script>';
  const pcOut = pcHighlight(malicious);
  const mOut = mobileHighlight(malicious);
  // regex 不会匹配 #< 这种组合，函数原样返回（也就意味着 <script> 的危险性来自调用方未转义，不是 highlightTags 的锅）
  check('PC XSS: regex 不匹配 #<script>，无 tag 包装',
    !pcOut.includes('<span class="tag-highlight">'),
    `got: ${pcOut}`);
  check('Mobile XSS: regex 不匹配 #<script>，无 tag 包装',
    !mOut.includes('<span class="tag-highlight">'),
    `got: ${mOut}`);

  // 关键断言：tag span 的 content 不含 <script> / </script> 这种活的 HTML 片段
  // （此用例下根本没 span，但这是 XSS 注入路径的基线检查）
  const pcSpanMatch = pcOut.match(/<span class="tag-highlight">([^<]*)<\/span>/g) || [];
  const mSpanMatch = mOut.match(/<span class="tag-highlight">([^<]*)<\/span>/g) || [];
  for (const s of pcSpanMatch) {
    check('PC XSS: span 内容不含 <script>',
      !s.includes('<script') && !s.includes('</script'),
      `span: ${s}`);
  }
  for (const s of mSpanMatch) {
    check('Mobile XSS: span 内容不含 <script>',
      !s.includes('<script') && !s.includes('</script'),
      `span: ${s}`);
  }
}

{
  // case B: 已转义的 HTML 输入（典型实际调用场景）
  // 输入是 escapeHtml('#<script>') 之后的形态：'#&lt;script&gt;...'
  // highlightTags 不应该把 &lt; 解开，也不应该匹配 #&（& 不在字符类里）
  const escaped = '#&lt;script&gt;alert(1)&lt;/script&gt;';
  const pcOut = pcHighlight(escaped);
  const mOut = mobileHighlight(escaped);
  check('PC XSS: 已转义输入不被 unescape',
    pcOut.includes('&lt;') && pcOut.includes('&gt;') && !pcOut.includes('<script>'),
    `got: ${pcOut}`);
  check('Mobile XSS: 已转义输入不被 unescape',
    mOut.includes('&lt;') && mOut.includes('&gt;') && !mOut.includes('<script>'),
    `got: ${mOut}`);
}

// === 3. URL fragment 不被识别为 tag ===
{
  const input = 'see https://example.com#anchor for details';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  // 关键：URL 内的 #anchor 不被包装为 tag
  check('PC: URL 内 #anchor 不被包装为 tag-highlight span',
    !pcOut.includes('<span class="tag-highlight">#anchor</span>'),
    `got: ${pcOut}`);
  check('Mobile: URL 内 #anchor 不被包装为 tag-highlight span',
    !mOut.includes('<span class="tag-highlight">#anchor</span>'),
    `got: ${mOut}`);
  // 同时确认 URL 本身保留
  check('PC: URL 本身保留',
    pcOut.includes('https://example.com#anchor'),
    `got: ${pcOut}`);
  check('Mobile: URL 本身保留',
    mOut.includes('https://example.com#anchor'),
    `got: ${mOut}`);
}

// URL 后面又有合法 tag 的混合场景
{
  const input = 'visit https://example.com#frag and tag #real';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: URL 后的合法 tag 仍被包装',
    pcOut.includes('<span class="tag-highlight">#real</span>') &&
    !pcOut.includes('<span class="tag-highlight">#frag</span>'),
    `got: ${pcOut}`);
  check('Mobile: URL 后的合法 tag 仍被包装',
    mOut.includes('<span class="tag-highlight">#real</span>') &&
    !mOut.includes('<span class="tag-highlight">#frag</span>'),
    `got: ${mOut}`);
}

// === 4. 层级标签 ===
{
  const input = '#parent/child';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: 层级 tag 整体被包装',
    pcOut === '<span class="tag-highlight">#parent/child</span>',
    `got: ${pcOut}`);
  check('Mobile: 层级 tag 整体被包装',
    mOut === '<span class="tag-highlight">#parent/child</span>',
    `got: ${mOut}`);
}

{
  const input = "#area's/跑步";
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: 含单引号 + 中文层级 tag',
    pcOut.includes("<span class=\"tag-highlight\">#area's/跑步</span>"),
    `got: ${pcOut}`);
  check('Mobile: 含单引号 + 中文层级 tag',
    mOut.includes("<span class=\"tag-highlight\">#area's/跑步</span>"),
    `got: ${mOut}`);
}

// === 5. 空输入 / 无 tag 输入 ===
{
  const pcOut = pcHighlight('');
  const mOut = mobileHighlight('');
  check('PC: 空输入返回空字符串', pcOut === '', `got: ${JSON.stringify(pcOut)}`);
  check('Mobile: 空输入返回空字符串', mOut === '', `got: ${JSON.stringify(mOut)}`);
}

{
  const input = 'no tags here, just text';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  check('PC: 无 tag 输入原样返回', pcOut === input, `got: ${pcOut}`);
  check('Mobile: 无 tag 输入原样返回', mOut === input, `got: ${mOut}`);
}

// === 6. 过滤 ^[a-zA-Z]+\d+$ 模式（CLAUDE.md 已知 #campaign2 case）===
{
  const input = '#campaign2';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  // 该模式不应被包装为 span（实现内显式过滤）
  check('PC: #campaign2 被过滤，不包装',
    !pcOut.includes('<span class="tag-highlight">'),
    `got: ${pcOut}`);
  check('Mobile: #campaign2 被过滤，不包装',
    !mOut.includes('<span class="tag-highlight">'),
    `got: ${mOut}`);
}

// === 7. PC vs Mobile 一致性 ===
{
  const cases = [
    '#a #b',
    '#a/b/c',
    '#复盘-周',
    'mix #tag1 text #tag2',
    'visit https://example.com#frag #real',
    '',
    'plain text',
  ];
  for (const input of cases) {
    const pcOut = pcHighlight(input);
    const mOut = mobileHighlight(input);
    check(`PC vs Mobile 一致性: ${JSON.stringify(input)}`,
      pcOut === mOut,
      `PC=${JSON.stringify(pcOut)}, Mobile=${JSON.stringify(mOut)}`);
  }
}

// === 8. 多 tag 计数 ===
{
  const input = '#a #b #c';
  const pcOut = pcHighlight(input);
  const mOut = mobileHighlight(input);
  const pcCount = (pcOut.match(/<span class="tag-highlight">/g) || []).length;
  const mCount = (mOut.match(/<span class="tag-highlight">/g) || []).length;
  check('PC: 3 个 tag 都被包装', pcCount === 3, `count=${pcCount}, out=${pcOut}`);
  check('Mobile: 3 个 tag 都被包装', mCount === 3, `count=${mCount}, out=${mOut}`);
}

// === Summary ===
console.log(`\n${testCount} assertions, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\n=== FAILED ASSERTIONS (登记为 finding) ===');
  for (const f of failures) console.error(`- ${f.desc}: ${f.details}`);
  process.exit(1);
}
console.log('All highlightTags assertions passed.');
process.exit(0);
