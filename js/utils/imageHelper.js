/**
 * imageHelper.js - 图片处理工具
 * 压缩、base64转换、本地文件保存
 */

const ImageHelper = (() => {

  const MAX_SIZE = 1920;       // 最长边
  const QUALITY = 0.8;         // JPEG质量
  const BASE64_THRESHOLD = 100 * 1024; // 100KB以下存base64
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // UEU-7: 单图上限 20MB，避免 OOM
  const COMPRESS_TIMEOUT_MS = 30 * 1000;  // UEU-8: 单图处理 30s 超时

  /**
   * 压缩图片
   * @param {File} file - 原始图片文件
   * @returns {Promise<{base64: string, compressed: Blob, isSmall: boolean}>}
   */
  function compress(file) {
    // UEU-7: 文件大小上限校验，避免 30MB+ 文件直接 OOM
    if (file && typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
      return Promise.reject(new Error(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制`));
    }

    const work = new Promise((resolve, reject) => {
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
            // UEU-8: toBlob 在内存不足或解码异常时会返回 null，原实现立即 blob.size 抛 TypeError
            if (!blob) return reject(new Error('canvas.toBlob 失败（浏览器拒绝编码图片）'));
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
        // UEU-8: onerror 收到的是 Event，需要包成 Error
        img.onerror = () => reject(new Error('图片解码失败（可能不是有效的图片格式）'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('FileReader 读取失败'));
      reader.onabort = () => reject(new Error('FileReader 已中止'));
      reader.readAsDataURL(file);
    });

    // UEU-8: 30s 超时兜底
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`图片处理超时（>${COMPRESS_TIMEOUT_MS / 1000}s）`)), COMPRESS_TIMEOUT_MS);
    });

    return Promise.race([work, timeout]);
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
   * UEU-9: 缓存 dirHandle 到模块级，避免每张图都弹目录选择器
   */
  let _cachedDirHandle = null;
  async function saveToLocal(relativePath, blob) {
    if (!('showDirectoryPicker' in window)) return false;
    try {
      // UEU-9: 命中缓存就不再弹窗
      if (!_cachedDirHandle) {
        _cachedDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      }
      const parts = relativePath.split('/');
      let current = _cachedDirHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i], { create: true });
      }
      const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      // UEU-9: AbortError = 用户取消选择目录，无需打日志；其余降级 + 清缓存让下次重试
      if (e?.name === 'AbortError') {
        _cachedDirHandle = null;
      } else {
        console.warn('File System Access API 失败:', e?.message || e);
        // 权限失效（NotAllowedError 等）也清缓存
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
          _cachedDirHandle = null;
        }
      }
      return false;
    }
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
          // UEU-1: 小图仅 base64，删除原 fire-and-forget saveToLocal
          //   原方案 push 到 imagePaths 时，外层 await processUpload 早已返回，
          //   imagePaths 数组事实上不会再被消费，但 saveToLocal 仍会弹目录选择器（UX 异常 + 可能 race）
          imageData.push(result.base64);
          previews.push(result.dataUrl);
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
