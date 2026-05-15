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
