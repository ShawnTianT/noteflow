/**
 * zipHelper.js - JSZip 打包工具
 */

const ZipHelper = (() => {

  /**
   * 创建 zip 文件并下载
   * @param {string} zipName - zip 文件名
   * @param {Array<{path: string, content: string|Uint8Array|Blob}>} files - 文件列表
   * UEU-13: JSZip 缺失走异常（让上层 toast），原 alert 会卡 UI；generateAsync 失败也抛
   */
  async function createAndDownload(zipName, files) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip 库未加载');
    }
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.content);
    }
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, zipName);
    } catch (e) {
      throw new Error('生成 zip 失败：' + (e?.message || e));
    }
  }

  /**
   * 下载 Blob 文件
   * UEU-13: revokeObjectURL 改为延迟，避免某些浏览器（Safari）click 触发的下载还未开始就已撤销
   */
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * 下载文本文件
   */
  function downloadText(content, fileName, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    downloadBlob(blob, fileName);
  }

  return {
    createAndDownload,
    downloadBlob,
    downloadText
  };
})();
