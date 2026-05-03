/**
 * export.js - 数据导出模块（Supabase 版本）
 * 支持 JSON / flomo 格式 .zip
 */

const ExportModule = (() => {

  /**
   * 导出为 JSON
   */
  async function exportJSON() {
    const notes = await DB.getAllNotesForExport();
    const tags = await DB.getAllTagsForExport();

    const exportData = {
      version: '2.0',
      exportTime: new Date().toISOString(),
      notes: notes.map(n => ({
        ...n,
        tags: Array.isArray(n.tags) ? n.tags : [],
        image_paths: Array.isArray(n.image_paths) ? n.image_paths : [],
        image_data: Array.isArray(n.image_data) ? n.image_data : [],
      })),
      tags
    };

    const json = JSON.stringify(exportData, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    ZipHelper.downloadText(json, `noteflow_${dateStr}.json`, 'application/json');
    Editor.showToast('JSON 已导出');
  }

  /**
   * 导出为 flomo 同款格式（HTML + file文件夹 → zip）
   */
  async function exportFlomo() {
    const notes = await DB.getAllNotesForExport();
    if (notes.length === 0) {
      Editor.showToast('没有笔记可导出', 'error');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const files = [];

    // 生成 notes.html
    let html = generateFlomoHTML(notes);
    files.push({ path: 'notes.html', content: html });

    // 收集图片
    let imageIndex = 0;
    for (const note of notes) {
      const imageUrls = ImageHelper.getImageUrls(note);
      for (const img of imageUrls) {
        imageIndex++;
        const noteDate = (note.created_at || dateStr).slice(0, 10);
        const imgFileName = `img_${String(imageIndex).padStart(3, '0')}.jpg`;
        const imgPath = `file/${noteDate}/${imgFileName}`;

        if (img.type === 'base64') {
          const base64Data = img.src.replace(/^data:image\/[^;]+;base64,/, '');
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          files.push({ path: imgPath, content: bytes });
        }
      }
    }

    try {
      await ZipHelper.createAndDownload(`flomo_export_${dateStr}.zip`, files);
      Editor.showToast('flomo 格式已导出');
    } catch (e) {
      console.error('导出失败:', e);
      Editor.showToast('导出失败', 'error');
    }
  }

  /**
   * 生成 flomo 同款 HTML
   */
  function generateFlomoHTML(notes) {
    let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Noteflow 导出</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .memo { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .content { font-size: 15px; line-height: 1.6; color: #333; white-space: pre-wrap; word-break: break-word; }
    .content .tag { color: #409EFF; }
    .time { font-size: 12px; color: #999; margin-top: 8px; }
    .images { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
    .images img { max-width: 200px; max-height: 200px; border-radius: 4px; object-fit: cover; }
    h1 { font-size: 20px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 12px; }
    .stats { font-size: 13px; color: #666; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Noteflow 导出</h1>
  <div class="stats">共 ${notes.length} 条笔记 · 导出时间 ${new Date().toLocaleString('zh-CN')}</div>
`;

    notes.forEach(note => {
      const content = highlightTagsHTML(escapeHtml(note.content || ''));
      const time = note.created_at || '';

      let imagesHtml = '';
      const imageUrls = ImageHelper.getImageUrls(note);
      if (imageUrls.length > 0) {
        imagesHtml = '<div class="images">';
        imageUrls.forEach(img => {
          imagesHtml += `<img src="${img.src}" alt="图片">`;
        });
        imagesHtml += '</div>';
      }

      html += `
  <div class="memo">
    <div class="content">${content.replace(/\n/g, '<br>')}</div>
    ${imagesHtml}
    <div class="time">${time}</div>
  </div>
`;
    });

    html += `</body></html>`;
    return html;
  }

  function highlightTagsHTML(html) {
    return html.replace(
      /#([\w\u4e00-\u9fa5']+(?:\/[\w\u4e00-\u9fa5']+)*)/g,
      (match, tag) => {
        if (/^[a-zA-Z]+\d+$/.test(tag)) return match;
        return `<span class="tag">#${tag}</span>`;
      }
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 导入 flomo 数据
   */
  async function importFlomo() {
    try {
      Editor.showToast('正在打开文件选择器...', 'info');
      const result = await FlomoImport.importFromFile((current, total, msg) => {
        console.log(`导入进度: ${current}/${total}`, msg || '');
      });
      Editor.showToast(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条（重复）`);
      if (window.app) {
        await window.app.refreshNotes();
        await window.app.refreshTags();
      }
    } catch (e) {
      console.error('导入失败:', e);
      Editor.showToast('导入失败：' + e.message, 'error');
    }
  }

  return {
    exportJSON,
    exportFlomo,
    importFlomo
  };
})();
