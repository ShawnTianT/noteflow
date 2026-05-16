/**
 * flomoImport.js - flomo 导出数据解析
 * 解析 flomo HTML，批量导入数据库
 */

const FlomoImport = (() => {

  /**
   * 从 HTML 文件中解析笔记
   * @param {string} htmlText - flomo 导出的 HTML 内容
   * @returns {Array<{content: string, tags: string, createdAt: string, images: string[]}>}
   */
  function parseHTML(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const memos = [];

    // flomo 导出的 HTML 结构：每个 .memo 是一条笔记
    const memoElements = doc.querySelectorAll('.memo');

    memoElements.forEach(memo => {
      // 时间
      const timeEl = memo.querySelector('.time');
      const createdAt = timeEl ? timeEl.textContent.trim() : '';

      // 内容（保留纯文本，去除HTML标签）
      const contentEl = memo.querySelector('.content');
      let content = '';
      if (contentEl) {
        content = cleanContent(contentEl.innerHTML);
      }

      // UEU-3: 图片 — 多 selector 兼容 (.files img / .file img / 裸 img)
      //   src 可能是 data:base64 → 拆到 image_data；或相对路径 → 拆到 image_paths
      const imageData = [];
      const imagePaths = [];
      const seenSrc = new Set();
      const imgElements = memo.querySelectorAll('.files img, .file img, img[src], img[data-src]');
      imgElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (!src || seenSrc.has(src)) return;
        seenSrc.add(src);
        const m = src.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (m) imageData.push(m[1]);
        else imagePaths.push(src);
      });

      // 提取标签
      const tags = extractTags(content);

      if (content) {
        memos.push({
          content,
          tags: tags, // 数组格式
          createdAt,
          image_paths: imagePaths,
          image_data: imageData
        });
      }
    });

    return memos;
  }

  /**
   * 从文本中提取 #标签
   */
  function extractTags(text) {
    const cleanText = text.replace(/<[^>]+>/g, ' ');
    // 支持中英文、单引号、斜杠等标签字符
    const regex = /#([\w\u4e00-\u9fa5']+(?:\/[\w\u4e00-\u9fa5']+)*)/g;
    const tags = [];
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      const tag = match[1];
      // 过滤纯英文+数字尾缀（如 campaign2、test3），含中文的保留
      if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
      if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  /**
   * 清理 HTML 内容，转为纯文本（保留换行）
   */
  function cleanContent(html) {
    let text = html.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  /**
   * 导入 flomo 数据到数据库（使用批量接口，高效）
   * @param {string} htmlText - HTML 文件内容
   * @param {Function} onProgress - 进度回调 (current, total, message)
   * @returns {Promise<{imported: number, skipped: number, dbSizeKB: number}>}
   */
  /**
   * UEU-6: 去重 key — 用完整 created_at + content（原 (date.slice(0,10) + 50 字符) 会让长内容
   * 头部相同的笔记被误判为重复）
   */
  function dedupKey(createdAt, content) {
    return (createdAt || '') + '|' + (content || '');
  }

  async function importToDB(htmlText, onProgress) {
    const memos = parseHTML(htmlText);
    if (onProgress) onProgress(0, memos.length, '解析完成，开始导入...');

    // UEU-5: 流式分页拉已有笔记构建去重 Set，避免 pageSize: 999999 OOM
    //   500/页拉取，只保留 dedup key 不留 note 完整对象；万级笔记内存可控
    const existSet = new Set();
    const PAGE = 500;
    let pageCurrent = 1;
    while (true) {
      const res = await DB.getNotes({ pageSize: PAGE, pageCurrent });
      const rows = res?.data || [];
      for (const n of rows) {
        if (n.created_at && n.content) existSet.add(dedupKey(n.created_at, n.content));
      }
      if (!res?.hasMore || rows.length === 0) break;
      pageCurrent++;
      if (pageCurrent > 200) break; // 安全上限 10w 条
    }

    // 过滤重复
    const newMemos = memos.filter(m => {
      if (!m.content) return false;
      return !existSet.has(dedupKey(m.createdAt, m.content));
    });
    const skipped = memos.length - newMemos.length;

    if (onProgress) onProgress(0, memos.length, `去重后 ${newMemos.length} 条待导入（跳过 ${skipped} 重复）`);

    // 批量导入（UEU-3: 带上 image_paths / image_data）
    const result = await DB.addNotesBatch(newMemos.map(m => ({
      content: m.content,
      tags: m.tags || [], // 数组格式
      image_paths: m.image_paths || [],
      image_data: m.image_data || [],
      created_at: m.createdAt || null,
      updated_at: m.createdAt || null
    })));

    const imported = Array.isArray(result) ? result.length : (result?.imported ?? newMemos.length);
    return { imported, skipped, dbSizeKB: 0 };
  }

  /**
   * 从文件选择器导入
   * @param {Function} onProgress - 进度回调
   */
  function importFromFile(onProgress) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.html,.htm';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
          reject(new Error('未选择文件'));
          return;
        }

        try {
          const text = await file.text();
          const result = await importToDB(text, onProgress);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      input.click();
    });
  }

  return {
    parseHTML,
    importToDB,
    importFromFile,
    extractTags,
    cleanContent
  };
})();
