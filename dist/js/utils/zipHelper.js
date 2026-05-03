/**
 * zipHelper.js - JSZip 打包工具
 */

const ZipHelper = (() => {

  /**
   * 创建 zip 文件并下载
   * @param {string} zipName - zip 文件名
   * @param {Array<{path: string, content: string|Uint8Array|Blob}>} files - 文件列表
   */
  async function createAndDownload(zipName, files) {
    if (typeof JSZip === 'undefined') {
      alert('JSZip 库未加载，无法导出 zip 文件');
      return;
    }

    const zip = new JSZip();

    for (const file of files) {
      zip.file(file.path, file.content);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, zipName);
  }

  /**
   * 下载 Blob 文件
   */
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
