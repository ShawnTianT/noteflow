/**
 * editor.js - 笔记输入模块
 * 极简输入 + #标签解析 + 图片上传
 */

const Editor = (() => {

  let pendingImages = []; // 待发送的图片预览
  let vmRef = null;       // Vue 实例引用（document listener 闭包用）
  let globalListenersAttached = false; // document 级 listener 仅绑一次

  /**
   * 初始化编辑器（幂等）
   * - element listener（fab/textarea/upload/editor-area）：每次 init 检查并绑定，
   *   通过元素 _editorBound 标记避免重复（Vue v-else 重渲染会创建新 DOM 节点，标记自然失效）
   * - document listener（paste/keydown）：进程内只绑一次
   */
  function init(vm) {
    vmRef = vm;

    // 浮动按钮点击 → 打开发布弹窗
    const fabBtn = document.getElementById('fab-publish');
    if (fabBtn && !fabBtn._editorBound) {
      fabBtn.addEventListener('click', () => openPublishModal());
      fabBtn._editorBound = true;
    }

    // 绑定键盘事件
    const textarea = document.getElementById('note-input');
    if (textarea && !textarea._editorBound) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value = textarea.value.slice(0, start) + '    ' + textarea.value.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + 4;
          updateTagPreview(textarea.value);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendNote(vmRef);
        }
      });

      // 实时标签高亮预览
      textarea.addEventListener('input', () => {
        updateTagPreview(textarea.value);
      });
      textarea._editorBound = true;
    }

    // 绑定图片上传按钮
    const uploadBtn = document.getElementById('image-upload-btn');
    if (uploadBtn && !uploadBtn._editorBound) {
      uploadBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = (e) => handleImageFiles(e.target.files, vmRef);
        input.click();
      });
      uploadBtn._editorBound = true;
    }

    // 绑定拖拽上传
    const editorArea = document.getElementById('editor-area');
    if (editorArea && !editorArea._editorBound) {
      editorArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        editorArea.classList.add('drag-over');
      });
      editorArea.addEventListener('dragleave', () => {
        editorArea.classList.remove('drag-over');
      });
      editorArea.addEventListener('drop', (e) => {
        e.preventDefault();
        editorArea.classList.remove('drag-over');
        const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
        if (files.length) handleImageFiles(files, vmRef);
      });
      editorArea._editorBound = true;
    }

    // document 级 listener（paste / ESC 关闭）—— 全局只绑一次
    if (!globalListenersAttached) {
      // 绑定粘贴上传
      document.addEventListener('paste', (e) => {
        const items = [...(e.clipboardData?.items || [])];
        const imageItems = items.filter(item => item.type.startsWith('image/'));
        if (imageItems.length) {
          e.preventDefault();
          const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
          handleImageFiles(files, vmRef);
        }
      });

      // 编辑弹窗 ESC 关闭
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const editModal = document.getElementById('edit-modal');
          if (editModal && editModal.classList.contains('active')) {
            closeEditModal();
          }
          const publishModal = document.getElementById('publish-modal');
          if (publishModal && publishModal.classList.contains('active')) {
            closePublishModal();
          }
        }
      });

      globalListenersAttached = true;
    }
  }

  /**
   * 发送笔记
   */
  async function sendNote(vm) {
    const textarea = document.getElementById('note-input');
    const content = textarea.value.trim();
    if (!content && pendingImages.length === 0) return;

    // 提取标签
    const tags = extractTags(content);

    // 处理图片
    let imagePaths = [];
    let imageData = [];
    if (pendingImages.length > 0) {
      const imgResult = await ImageHelper.processUpload(pendingImages.map(p => p.file));
      imagePaths = imgResult.imagePaths || [];
      imageData = imgResult.imageData || [];
    }

    // 写入数据库（Supabase 版：tags 传数组）
    try {
      await DB.addNote({
        content,
        tags: tags, // 数组格式
        image_paths: imagePaths,
        image_data: imageData
      });

      // 清空输入
      textarea.value = '';
      pendingImages = [];
      updateImagePreview();
      updateTagPreview('');

      // 关闭发布弹窗
      closePublishModal();

      // 刷新时间线
      if (vm && vm.refreshNotes) vm.refreshNotes();
      if (vm && vm.refreshTags) vm.refreshTags();

      showToast('笔记已保存');
    } catch (e) {
      console.error('保存笔记失败:', e);
      showToast('保存失败，请重试', 'error');
    }
  }

  /**
   * 从文本中提取 #标签
   */
  function extractTags(text) {
    // 先剥 URL 避免 https://x.com/#frag 被误识为标签；再支持中英文、单引号、连字符、斜杠
    text = (text || '').replace(/https?:\/\/\S+/g, ' ');
    const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
    const tags = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const tag = match[1];
      // 过滤纯英文+数字尾缀（如 campaign2、test3），含中文的保留
      if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
      if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  /**
   * 更新标签预览
   */
  function updateTagPreview(text) {
    const previewEl = document.getElementById('tag-preview');
    if (!previewEl) return;

    const tags = extractTags(text);
    if (tags.length === 0) {
      previewEl.innerHTML = '';
      return;
    }

    previewEl.innerHTML = tags.map(tag => 
      `<span class="tag-badge">#${tag}</span>`
    ).join(' ');
  }

  /**
   * 处理图片文件
   */
  async function handleImageFiles(files, vm) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      try {
        const result = await ImageHelper.compress(file);
        pendingImages.push({
          file,
          dataUrl: result.dataUrl,
          size: result.size
        });
      } catch (e) {
        console.error('图片处理失败:', e);
        showToast('图片处理失败', 'error');
      }
    }

    updateImagePreview();
  }

  /**
   * 更新图片预览
   */
  function updateImagePreview() {
    const previewEl = document.getElementById('image-preview');
    if (!previewEl) return;

    if (pendingImages.length === 0) {
      previewEl.innerHTML = '';
      previewEl.style.display = 'none';
      return;
    }

    previewEl.style.display = 'flex';
    previewEl.innerHTML = pendingImages.map((img, idx) => `
      <div class="image-preview-item">
        <img src="${img.dataUrl}" alt="预览">
        <button class="remove-image" onclick="Editor.removeImage(${idx})" title="移除">×</button>
        <span class="image-size">${formatSize(img.size)}</span>
      </div>
    `).join('');
  }

  /**
   * 移除待发送图片
   */
  function removeImage(index) {
    pendingImages.splice(index, 1);
    updateImagePreview();
  }

  /**
   * 格式化文件大小
   */
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }

  /**
   * Toast 提示
   */
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /**
   * 打开发布弹窗
   */
  function openPublishModal() {
    const modal = document.getElementById('publish-modal');
    if (modal) {
      modal.classList.add('active');
      // 聚焦输入框
      setTimeout(() => {
        const textarea = document.getElementById('note-input');
        if (textarea) textarea.focus();
      }, 100);
    }
  }

  /**
   * 关闭发布弹窗
   */
  function closePublishModal() {
    const modal = document.getElementById('publish-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  return {
    init,
    sendNote,
    extractTags,
    removeImage,
    showToast,
    formatSize,
    openPublishModal,
    closePublishModal
  };
})();
