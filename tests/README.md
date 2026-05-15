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
