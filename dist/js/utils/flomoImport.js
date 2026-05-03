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

      // 图片（MVP阶段跳过，只记录路径）
      const images = [];
      const imgElements = memo.querySelectorAll('.files img');
      imgElements.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src) images.push(src);
      });

      // 提取标签
      const tags = extractTags(content);

      if (content) {
        memos.push({
          content,
          tags: tags, // 数组格式
          createdAt,
          images
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
  async function importToDB(htmlText, onProgress) {
    const memos = parseHTML(htmlText);
    if (onProgress) onProgress(0, memos.length, '解析完成，开始导入...');

    // 去重：查出所有已有笔记
    const existingResult = await DB.getNotes({ pageSize: 999999 });
    const existingNotes = existingResult.data || [];
    const existSet = new Set();
    existingNotes.forEach(n => {
      if (n.created_at && n.content) {
        existSet.add(n.created_at.slice(0, 10) + '|' + n.content.slice(0, 50));
      }
    });

    // 过滤重复
    const newMemos = memos.filter(m => {
      if (!m.content) return false;
      const key = (m.createdAt ? m.createdAt.slice(0, 10) : '') + '|' + m.content.slice(0, 50);
      return !existSet.has(key);
    });

    if (onProgress) onProgress(0, memos.length, `去重后 ${newMemos.length} 条待导入`);

    // 批量导入
    const result = await DB.addNotesBatch(newMemos.map(m => ({
      content: m.content,
      tags: m.tags || [], // 数组格式
      created_at: m.createdAt || null,
      updated_at: m.createdAt || null
    })));

    const imported = result ? result.length : 0;
    return { imported, skipped: memos.length - imported, dbSizeKB: 0 };
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
