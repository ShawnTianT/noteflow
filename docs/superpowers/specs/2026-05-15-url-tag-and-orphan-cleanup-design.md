# URL 标签过滤 + 孤儿标签清理 Design

**日期**：2026-05-15
**起因**：用户反馈两个问题。(1) 笔记里的 URL fragment（`#p-1`、`#wechat_redirect`）被误识为标签；(2) 删除笔记后空标签（如 `#e`）残留。

## 问题根因

1. 标签正则不知道 `#` 是不是在 URL 内
2. `updateTagCount` 在 count=0 时仍 `put`，不删 → 孤儿标签
3. `syncFromCloud` 信任云端的 `tags` 字段（但那是用老正则提取的，可能含污染数据）

## 修复方案

### 1. URL 过滤（标签提取 + 高亮 4 处）

新增工具函数：
```js
const URL_REGEX = /https?:\/\/\S+/g;
function stripUrls(text) { return (text || '').replace(URL_REGEX, ' '); }
```

应用：
- `js/db-supabase.js` `extractTagsFromContent`
- `js/modules/editor.js` `extractTags`
- `mobile/js/app.js` `extractTags`

高亮（要保留 URL 显示，仅不让 URL 内 `#xxx` 变绿）用**占位符策略**：
- `js/modules/timeline.js` `highlightTags`
- `mobile/js/app.js` `highlightTags`

```js
function highlightTags(html) {
  const urls = [];
  let s = html.replace(URL_REGEX, m => { urls.push(m); return `\x00URL${urls.length-1}\x00`; });
  s = s.replace(TAG_REGEX, (m, tag) => /^[a-zA-Z]+\d+$/.test(tag) ? m : `<span class="tag-highlight">${m}</span>`);
  return s.replace(/\x00URL(\d+)\x00/g, (_, i) => urls[+i]);
}
```

### 2. 孤儿标签清理

**前向**：
- `updateTagCount`：count→0 时 `tagStore.delete(tag.id)` 而非 put
- `syncToCloud` 'updateTag' handler：count=0 时调云端 `.delete()`

**回溯（清老数据）**：
- `syncFromCloud` 总是从 content 重新 extract（用新 URL-aware 正则），不信任云端 `tags` 字段
- `syncFromCloud` 在 puts 完成后调 `rebuildTagCounts(uid)` 重建 → 旧脏 tag（URL fragment 来源、count=0 残留）全部消失
- `rebuildTagCounts` 修复：原 `idbClear('tags')` 清整张表 → 改为 cursor by user_id 删（避免误清其他账号缓存）

## 文件清单

- `js/db-supabase.js`（核心，~5 处改动）
- `js/modules/editor.js`（1 处）
- `js/modules/timeline.js`（1 处）
- `mobile/js/app.js`（2 处）

## 验证

- 手动测：发个含上面 3 条 URL 的笔记 → tag 区不应出现 `#p-1` / `#wechat_redirect`
- 手动测：把所有用 `#e` 的笔记删光 → 刷新后 `#e` 应消失
- 手动测：换设备/清缓存重登 → 老的 `#p-1` 应在 sync 后消失（rebuildTagCounts 兜底）
- node `--check` + `bash build.sh`

## 不在范围

- 把云端 notes 表的 tags 字段也清洗一遍（重，1687 次 UPDATE）。本地每次同步重建即可。
- 改 URL 检测规则（不识别裸域名 `bilibili.com/x#y`）。当前 https/http 已覆盖 99% 情况。
