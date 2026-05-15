/**
 * timeline.js - 时间线展示模块（Supabase 版本）
 * 卡片流 + 编辑 + 删除 + 图片展示 + 无限滚动
 */

const Timeline = (() => {

  let scrollListener = null;

  /**
   * 渲染笔记列表（替换模式）
   */
  function renderNotes(notes) {
    const container = document.getElementById('notes-container');
    if (!container) return;

    if (!notes || notes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <p>还没有笔记，开始记录吧</p>
        </div>
      `;
      removeScrollListener();
      return;
    }

    // 按日期分组
    const grouped = groupByDate(notes);

    let html = '';
    for (const [date, items] of Object.entries(grouped)) {
      html += `<div class="date-group">`;
      html += `<div class="date-label">${formatDateLabel(date)}</div>`;
      items.forEach(note => {
        html += renderCard(note);
      });
      html += `</div>`;
    }

    container.innerHTML = html;

    // 事件委托
    container.onclick = handleContainerClick;

    // 注册无限滚动
    setupInfiniteScroll();
  }

  /**
   * 追加笔记（分页加载更多）
   */
  function appendNotes(notes) {
    const container = document.getElementById('notes-container');
    if (!container || !notes || notes.length === 0) return;

    // 检查最后一个日期组
    const lastDateGroup = container.querySelector('.date-group:last-child');
    const lastDateLabel = lastDateGroup ? lastDateGroup.querySelector('.date-label')?.textContent : '';

    // 按日期分组
    const grouped = groupByDate(notes);

    for (const [date, items] of Object.entries(grouped)) {
      const dateLabel = formatDateLabel(date);

      // 如果和最后一个日期组相同，追加到该组
      if (dateLabel === lastDateLabel && lastDateGroup) {
        let html = '';
        items.forEach(note => { html += renderCard(note); });
        lastDateGroup.insertAdjacentHTML('beforeend', html);
      } else {
        // 新的日期组
        let html = `<div class="date-group">`;
        html += `<div class="date-label">${dateLabel}</div>`;
        items.forEach(note => { html += renderCard(note); });
        html += `</div>`;
        container.insertAdjacentHTML('beforeend', html);
      }
    }
  }

  /**
   * 无限滚动
   */
  function setupInfiniteScroll() {
    removeScrollListener();

    const contentArea = document.querySelector('.content-area');
    if (!contentArea) return;

    scrollListener = () => {
      const { scrollTop, scrollHeight, clientHeight } = contentArea;
      // 距离底部 100px 时触发
      if (scrollHeight - scrollTop - clientHeight < 100) {
        if (window.app && window.app.loadMoreNotes) {
          window.app.loadMoreNotes();
        }
      }
    };

    contentArea.addEventListener('scroll', scrollListener);
  }

  function removeScrollListener() {
    if (scrollListener) {
      const contentArea = document.querySelector('.content-area');
      if (contentArea) contentArea.removeEventListener('scroll', scrollListener);
      scrollListener = null;
    }
  }

  /**
   * 渲染单张笔记卡片
   */
  function renderCard(note) {
    // 高亮标签
    const highlightedContent = highlightTags(escapeHtml(note.content || ''));

    // 图片
    const images = ImageHelper.getImageUrls(note);
    let imagesHtml = '';
    if (images.length > 0) {
      imagesHtml = `<div class="card-images">`;
      images.forEach((img, idx) => {
        imagesHtml += `
          <div class="card-image-wrapper" data-img-src="${encodeURIComponent(img.src)}" onclick="Timeline.zoomImage(decodeURIComponent(this.dataset.imgSrc))">
            <img src="${img.src}" alt="图片" loading="lazy" class="card-image">
          </div>
        `;
      });
      imagesHtml += `</div>`;
    }

    // 标签（Supabase 版本：tags 是数组）
    let tagsHtml = '';
    const tags = Array.isArray(note.tags) ? note.tags : (note.tags ? note.tags.split(',').filter(t => t.trim()) : []);
    if (tags.length > 0) {
      tagsHtml = `<div class="card-tags">`;
      tags.forEach(tag => {
        const safeTag = tag.trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        tagsHtml += `<span class="tag-link" data-tag="${safeTag}">#${tag.trim()}</span>`;
      });
      tagsHtml += `</div>`;
    }

    // 时间
    const timeStr = formatTime(note.created_at);

    return `
      <div class="note-card" data-id="${note.id}">
        <div class="card-content">${highlightedContent.replace(/\n/g, '<br>')}</div>
        ${imagesHtml}
        ${tagsHtml}
        <div class="card-footer">
          <span class="card-time">${timeStr}</span>
          <div class="card-actions">
            <button class="btn-icon" onclick="Timeline.startEdit(${note.id})" title="编辑">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon btn-danger-icon" onclick="Timeline.confirmDelete(${note.id})" title="删除">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 处理内容区点击事件委托
   */
  function handleContainerClick(e) {
    const tagLink = e.target.closest('.tag-link');
    if (tagLink && tagLink.dataset.tag) {
      if (window.app) window.app.filterByTag(tagLink.dataset.tag);
      return;
    }
  }

  /**
   * 高亮 #标签
   */
  function highlightTags(html) {
    // 用占位符保护 URL，避免 URL 内的 #frag 被高亮成 tag
    const urls = [];
    html = html.replace(/https?:\/\/\S+/g, (m) => {
      urls.push(m);
      return '\x00URL' + (urls.length - 1) + '\x00';
    });
    const highlighted = html.replace(
      /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g,
      (match, tag) => {
        if (/^[a-zA-Z]+\d+$/.test(tag)) return match;
        return `<span class="tag-highlight">${match}</span>`;
      }
    );
    // 还原 URL 占位符
    return highlighted.replace(/\x00URL(\d+)\x00/g, (_, i) => urls[+i]);
  }

  /**
   * HTML 转义
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 按日期分组
   */
  function groupByDate(notes) {
    const groups = {};
    notes.forEach(note => {
      const date = (note.created_at || '').slice(0, 10) || '未知日期';
      if (!groups[date]) groups[date] = [];
      groups[date].push(note);
    });
    return groups;
  }

  /**
   * 格式化日期标签
   */
  function formatDateLabel(dateStr) {
    if (!dateStr || dateStr === '未知日期') return dateStr;

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (dateStr === today) return '今天';
    if (dateStr === yesterday) return '昨天';

    const date = new Date(dateStr);
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekDay = weekDays[date.getDay()];

    return `${month}月${day}日 ${weekDay}`;
  }

  /**
   * 格式化时间
   */
  function formatTime(timeStr) {
    if (!timeStr) return '';
    const match = timeStr.match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : timeStr.slice(11, 16);
  }

  /**
   * 编辑笔记
   */
  async function startEdit(noteId) {
    const note = await DB.getNoteById(noteId);
    if (!note) return;

    const modal = document.getElementById('edit-modal');
    if (!modal) return;

    const textarea = document.getElementById('edit-content');
    textarea.value = note.content;

    modal.classList.add('active');
    modal.dataset.noteId = noteId;
    textarea.focus();
  }

  /**
   * 保存编辑
   */
  async function saveEdit() {
    const modal = document.getElementById('edit-modal');
    const noteId = parseInt(modal.dataset.noteId);
    const content = document.getElementById('edit-content').value.trim();

    if (!content) {
      Editor.showToast('内容不能为空', 'error');
      return;
    }

    const tags = Editor.extractTags(content);
    await DB.updateNote(noteId, {
      content,
      tags: tags, // Supabase 版：传数组
    });

    closeEditModal();

    if (window.app) {
      await window.app.refreshNotes();
      await window.app.refreshTags();
    }

    Editor.showToast('笔记已更新');
  }

  /**
   * 关闭编辑模态框
   */
  function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
      modal.classList.remove('active');
      delete modal.dataset.noteId;
    }
  }

  /**
   * 确认删除
   */
  async function confirmDelete(noteId) {
    if (confirm('确定要删除这条笔记吗？删除后无法恢复。')) {
      await DB.deleteNote(noteId);

      if (window.app) {
        await window.app.refreshNotes();
        await window.app.refreshTags();
      }

      Editor.showToast('笔记已删除');
    }
  }

  /**
   * 图片放大查看
   */
  function zoomImage(src) {
    let overlay = document.getElementById('image-zoom-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'image-zoom-overlay';
      overlay.className = 'image-zoom-overlay';
      overlay.innerHTML = `
        <div class="image-zoom-content">
          <img id="zoomed-image" src="" alt="放大查看">
          <button class="zoom-close" onclick="Timeline.closeZoom()">×</button>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    document.getElementById('zoomed-image').src = src;
    overlay.classList.add('active');

    overlay.onclick = (e) => {
      if (e.target === overlay) closeZoom();
    };
  }

  function closeZoom() {
    const overlay = document.getElementById('image-zoom-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  return {
    renderNotes,
    appendNotes,
    renderCard,
    startEdit,
    saveEdit,
    closeEditModal,
    confirmDelete,
    zoomImage,
    closeZoom
  };
})();
