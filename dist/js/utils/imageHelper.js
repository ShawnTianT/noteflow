/**
 * imageHelper.js - 图片处理工具
 * 压缩、base64转换、本地文件保存
 */

const ImageHelper = (() => {

  const MAX_SIZE = 1920;       // 最长边
  const QUALITY = 0.8;         // JPEG质量
  const BASE64_THRESHOLD = 100 * 1024; // 100KB以下存base64

  /**
   * 压缩图片
   * @param {File} file - 原始图片文件
   * @returns {Promise<{base64: string, compressed: Blob, isSmall: boolean}>}
   */
  function compress(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          // 等比缩放
          if (width > MAX_SIZE || height > MAX_SIZE) {
            if (width > height) {
              height = Math.round(height * MAX_SIZE / width);
              width = MAX_SIZE;
            } else {
              width = Math.round(width * MAX_SIZE / height);
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            const base64 = canvas.toDataURL('image/jpeg', QUALITY);
            const isSmall = blob.size < BASE64_THRESHOLD;
            resolve({
              base64: base64.replace(/^data:image\/jpeg;base64,/, ''),
              dataUrl: base64,
              compressed: blob,
              isSmall,
              size: blob.size,
              width,
              height
            });
          }, 'image/jpeg', QUALITY);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * 生成图片文件名
   */
  function generateFileName() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.getTime();
    return { dateStr, fileName: `img_${timeStr}.jpg` };
  }

  /**
   * 获取图片的本地相对路径
   */
  function getRelativePath(dateStr, fileName) {
    return `data/images/${dateStr}/${fileName}`;
  }

  /**
   * 从笔记记录中获取图片URL列表（用于展示）
   * 优先使用 image_paths（本地文件），其次 image_data（base64）
   */
  function getImageUrls(note) {
    const urls = [];

    // 支持数组格式（Supabase 版）和字符串格式（旧版兼容）
    const imagePaths = Array.isArray(note.image_paths)
      ? note.image_paths
      : (note.image_paths && note.image_paths.trim ? note.image_paths.split(',').map(s => s.trim()).filter(Boolean) : []);
    const imageDataArr = Array.isArray(note.image_data)
      ? note.image_data
      : (note.image_data && note.image_data.trim ? note.image_data.split(',').map(s => s.trim()).filter(Boolean) : []);

    // 优先本地文件路径
    imagePaths.forEach(path => {
      if (path) urls.push({ type: 'file', src: path });
    });

    // 其次 base64
    imageDataArr.forEach(b64 => {
      if (b64) urls.push({ type: 'base64', src: `data:image/jpeg;base64,${b64}` });
    });

    return urls;
  }

  /**
   * 下载图片到本地（Safari降级方案）
   * 因为浏览器无法直接写本地文件，这里用 File System Access API
   * 如果不支持，图片只存 base64
   */
  async function saveToLocal(relativePath, blob) {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const parts = relativePath.split('/');
        let current = dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i], { create: true });
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.warn('File System Access API 失败:', e);
        }
        return false;
      }
    }
    // 不支持 File System Access API，图片只存base64
    return false;
  }

  /**
   * 处理上传的图片文件列表
   * @param {FileList|File[]} files
   * @returns {Promise<{imagePaths: string, imageData: string, previews: string[]}>}
   */
  async function processUpload(files) {
    const imagePaths = [];
    const imageData = [];
    const previews = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      try {
        const result = await compress(file);
        const { dateStr, fileName } = generateFileName();
        const relativePath = getRelativePath(dateStr, fileName);

        if (result.isSmall) {
          // 小图：base64 + 也尝试存本地
          imageData.push(result.base64);
          previews.push(result.dataUrl);
          // 尝试本地文件（可选）
          saveToLocal(relativePath, result.compressed).then(saved => {
            if (saved) imagePaths.push(relativePath);
          });
        } else {
          // 大图：优先本地文件，base64作为备用
          imagePaths.push(relativePath);
          previews.push(result.dataUrl);
          // 尝试保存本地文件
          const saved = await saveToLocal(relativePath, result.compressed);
          if (!saved) {
            // 无法保存本地，退回base64
            imageData.push(result.base64);
          }
        }
      } catch (e) {
        console.error('图片处理失败:', e);
      }
    }

    return {
      imagePaths: imagePaths, // 数组格式
      imageData: imageData,   // 数组格式
      previews
    };
  }

  return {
    compress,
    generateFileName,
    getRelativePath,
    getImageUrls,
    saveToLocal,
    processUpload,
    MAX_SIZE,
    QUALITY,
    BASE64_THRESHOLD
  };
})();
