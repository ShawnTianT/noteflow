/**
 * Noteflow Mobile - 手机端 Vue App
 * 复用共享数据层 ../js/db-supabase.js，只读不修改
 */

const PINNED_KEY_PREFIX = 'noteflow_pinned_tags_';

const App = {
  data() {
    return {
      loaded: false,
      isLoggedIn: false,
      localMode: false,
      syncStatus: 'local',

      // 登录
      loginUsername: '',
      loginPassword: '',
      loginError: '',
      loginLoading: false,

      // 笔记
      notes: [],
      noteCount: 0,
      notesLoaded: false,
      currentPage: 1,
      hasMore: false,
      loadingMore: false,
      pageSize: 30,

      // 标签
      tags: [],
      currentTag: '',
      tagSearchKey: '',
      tagSearchDebounced: '', // P6: debounced 后的值，computed 用这个
      tagSearchTimer: null,
      tagDrawerOpen: false,
      expandedTags: new Set(),
      pinnedTags: [],

      // 搜索
      searchKey: '',
      searchDebounceTimer: null,

      // 发布弹窗（FAB 入口）
      publishModalOpen: false,
      publishInput: '',
      publishTags: [],
      publishImages: [],

      // 图片放大
      zoomSrc: '',

      // 操作菜单
      actionNote: null,

      // 编辑
      editingNote: null,
      editText: '',

      // 更多菜单
      moreMenuOpen: false,

      // Toast
      toast: { show: false, msg: '' },
      toastTimer: null,

      // 日期分割缓存
      _dateCache: {},
    };
  },

  computed: {
    // 标签按层级分组（支持搜索）
    // P6 修复：用 tagSearchDebounced 触发，避免每次 keystroke 都重算 134 个 tag 的层级树
    filteredGroupedTags() {
      const key = this.tagSearchDebounced;
      const tags = key
        ? this.tags.filter(t => t.name.toLowerCase().includes(key.toLowerCase()))
        : this.tags;

      const grouped = {};
      tags.forEach(tag => {
        const parts = tag.name.split('/');
        const parent = parts[0];
        const child = parts.slice(1).join('/');

        if (!grouped[parent]) {
          grouped[parent] = { children: [], total: 0 };
        }
        if (child) {
          grouped[parent].children.push({ name: child, count: tag.count });
        }
        grouped[parent].total += tag.count;
      });

      // 置顶排序
      const sorted = {};
      const pinnedFirst = Object.keys(grouped).filter(k => this.pinnedTags.includes(k)).sort((a, b) => grouped[b].total - grouped[a].total);
      const rest = Object.keys(grouped).filter(k => !this.pinnedTags.includes(k)).sort((a, b) => grouped[b].total - grouped[a].total);
      [...pinnedFirst, ...rest].forEach(k => { sorted[k] = grouped[k]; });
      return sorted;
    },
  },

  watch: {
    // P6: 标签搜索 200ms debounce，避免每次输入都重算 computed
    tagSearchKey(newVal) {
      clearTimeout(this.tagSearchTimer);
      this.tagSearchTimer = setTimeout(() => {
        this.tagSearchDebounced = newVal;
      }, 200);
    },
  },

  async mounted() {
    console.log('[Mobile] 开始初始化...');

    // 监听后台同步完成事件（修复首次加载时机问题）
    window.addEventListener('noteflow:sync-complete', () => {
      if (this.isLoggedIn || this.localMode) {
        this.refreshNotes();
        this.refreshTags();
      }
    });

    try {
      if (!DB) throw new Error('DB 对象未定义！检查 db-supabase.js 是否加载');

      await DB.init();
      console.log('[Mobile] DB.init 完成');

      this.isLoggedIn = DB.isLoggedIn();
      this.localMode = DB.isOfflineMode();
      this.syncStatus = DB.getSyncStatus ? DB.getSyncStatus() : 'local';

      if (this.isLoggedIn || this.localMode) {
        this.loadPinnedTags();
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
      }

      this.loaded = true;
      console.log('[Mobile] 初始化成功！');

      this.$nextTick(() => { this.setupGlobalEvents(); });
    } catch (e) {
      console.error('[Mobile] 初始化失败:', e);
      this.loaded = true;
      this.showToast('初始化失败: ' + (e.message || '请刷新重试'));
    }
  },

  methods: {
    setupGlobalEvents() {
      document.addEventListener('paste', (e) => {
        if (!this.isLoggedIn && !this.localMode) return;
        const items = [...(e.clipboardData?.items || [])];
        const imgItems = items.filter(item => item.type.startsWith('image/'));
        if (imgItems.length > 0) {
          e.preventDefault();
          // 如果发布弹窗开着，往弹窗里加图片
          if (this.publishModalOpen) {
            const files = imgItems.map(item => item.getAsFile()).filter(Boolean);
            this.handlePublishImageFiles(files);
          }
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeZoom();
          this.closeActionSheet();
          this.closeEditModal();
          this.closeMoreMenu();
          this.closePublishModal();
        }
      });
    },

    // ===== 登录 =====
    async doSignIn() {
      this.loginError = '';
      this.loginLoading = true;
      try {
        if (!this.loginUsername || !this.loginPassword) {
          this.loginError = '请输入账号和密码';
          return;
        }
        const { data, error } = await DB.signIn(this.loginUsername, this.loginPassword);
        if (error) {
          this.loginError = error.message || '登录失败';
          return;
        }
        this.isLoggedIn = true;
        this.localMode = false;
        this.syncStatus = DB.getSyncStatus ? DB.getSyncStatus() : 'synced';

        this.loadPinnedTags();
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.showToast('登录成功');
      } catch (e) {
        this.loginError = e.message || '登录失败';
      } finally {
        this.loginLoading = false;
      }
    },

    enterLocalMode() {
      DB.enterLocalMode();
      this.localMode = true;
      this.isLoggedIn = false;
      this.syncStatus = 'local';

      this.loadPinnedTags();
      this.refreshNotes();
      this.refreshTags();
      this.showToast('已进入本地模式');
    },

    // MOB-7: 抽出 resetUserState，集中复位 Vue 状态 (与 UEU-4 思路一致)
    resetUserState() {
      this.notes = [];
      this.tags = [];
      this.noteCount = 0;
      this.notesLoaded = false;
      this.currentTag = '';
      this.searchKey = '';
      this.pinnedTags = [];
    },

    async doSignOut() {
      this.closeMoreMenu();
      if (!confirm('确定退出登录？')) return;
      await DB.signOut();
      this.isLoggedIn = false;
      this.localMode = false;
      this.loginUsername = '';
      this.loginPassword = '';
      this.loginError = '';
      this.resetUserState(); // MOB-7
      this.showToast('已退出登录');
    },

    backToLogin() {
      this.closeMoreMenu();
      this.localMode = false;
      this.isLoggedIn = false;
      this.loginUsername = '';
      this.loginPassword = '';
      this.loginError = '';
      this.resetUserState(); // MOB-7
    },

    // ===== 置顶标签 =====
    loadPinnedTags() {
      // MOB-5: 无登录态时不读，避免和未登录公共 key 串数据
      const userId = DB.getCurrentUserId();
      if (!userId) { this.pinnedTags = []; return; }
      try {
        const data = localStorage.getItem(PINNED_KEY_PREFIX + userId);
        this.pinnedTags = data ? JSON.parse(data) : [];
      } catch (e) { this.pinnedTags = []; }
    },

    savePinnedTags() {
      // MOB-5: 无登录态时不写；写失败 (quota / 私密浏览) 不抛
      const userId = DB.getCurrentUserId();
      if (!userId) return;
      try {
        localStorage.setItem(PINNED_KEY_PREFIX + userId, JSON.stringify(this.pinnedTags));
      } catch (e) {
        console.warn('[mobile] savePinnedTags failed:', e?.message || e);
      }
    },

    // ===== 同步 =====
    async manualSync() {
      if (!this.isLoggedIn) return;
      try {
        this.syncStatus = 'syncing';
        await DB.syncFromCloud();
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.syncStatus = DB.getSyncStatus ? DB.getSyncStatus() : 'synced';
        this.showToast('同步完成 ☁️');
      } catch (e) {
        console.error('同步失败:', e);
        this.syncStatus = DB.getSyncStatus ? DB.getSyncStatus() : 'offline';
        this.showToast('同步失败');
      }
    },

    doSync() { this.closeMoreMenu(); this.manualSync(); },

    // ===== 每日回顾 =====
    async dailyReview() {
      try {
        this.currentTag = '';
        this.searchKey = '';
        const randomNotes = await DB.getRandomNotes(10);
        this.notes = randomNotes;
        this.noteCount = randomNotes.length;
        this.hasMore = false;
        this.currentPage = 1;
        this._dateCache = {};
        this.showToast('📖 随机回顾 ' + randomNotes.length + ' 条笔记');
      } catch (e) {
        console.error('每日回顾失败:', e);
        this.showToast('回顾失败');
      }
    },

    // ===== 更多菜单 =====
    showMoreMenu() { this.moreMenuOpen = true; },
    closeMoreMenu() { this.moreMenuOpen = false; },

    // ===== 标签抽屉 =====
    toggleTagDrawer() { this.tagDrawerOpen = !this.tagDrawerOpen; },
    closeTagDrawer() { this.tagDrawerOpen = false; },
    toggleExpand(parent) {
      if (this.expandedTags.has(parent)) {
        this.expandedTags.delete(parent);
      } else {
        this.expandedTags.add(parent);
      }
      // Vue 2 reactivity hack for Set
      this.expandedTags = new Set(this.expandedTags);
    },

    // ===== 笔记操作 =====
    async refreshNotes() {
      try {
        const result = await DB.getNotes({
          tag: this.currentTag || null,
          search: this.searchKey || null,
          pageCurrent: 1,
          pageSize: this.pageSize,
        });
        this.notes = result.data || [];
        this.noteCount = result.total || 0;
        this.hasMore = result.hasMore || false;
        this.currentPage = 1;
        this.notesLoaded = true;
        this._dateCache = {};
      } catch (e) {
        console.error('[Mobile] 刷新笔记失败:', e);
        this.notesLoaded = true;
      }
    },

    async loadMore() {
      if (this.loadingMore || !this.hasMore) return;
      this.loadingMore = true;
      try {
        this.currentPage++;
        const result = await DB.getNotes({
          tag: this.currentTag || null,
          search: this.searchKey || null,
          pageCurrent: this.currentPage,
          pageSize: this.pageSize,
        });
        this.notes = this.notes.concat(result.data || []);
        this.hasMore = result.hasMore || false;
      } catch (e) {
        console.error('[Mobile] 加载更多失败:', e);
        this.currentPage--;
      } finally {
        this.loadingMore = false;
      }
    },

    async refreshTags() {
      try {
        const allTags = await DB.getTags();
        this.tags = allTags || [];
      } catch (e) {
        console.error('[Mobile] 刷新标签失败:', e);
      }
    },

    async filterByTag(tagName) {
      this.currentTag = tagName;
      if (this.searchKey) this.searchKey = '';
      await this.refreshNotes();
      this.$nextTick(() => {
        const el = this.$refs.notesScroll;
        if (el) el.scrollTop = 0;
      });
    },

    onSearchInput() {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        if (this.currentTag) this.currentTag = '';
        this.refreshNotes();
      }, 300);
    },

    clearSearch() {
      this.searchKey = '';
      this.refreshNotes();
    },

    onScroll(e) {
      const el = e.target;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        this.loadMore();
      }
    },

    onCardClick(note) {},

    // ===== FAB 发布弹窗 =====
    openPublishModal() {
      this.publishModalOpen = true;
      this.publishInput = '';
      this.publishTags = [];
      this.publishImages = [];
      this.$nextTick(() => {
        if (this.$refs.publishInput) this.$refs.publishInput.focus();
      });
    },

    closePublishModal() { this.publishModalOpen = false; },

    updatePublishTags() {
      const text = this.publishInput;
      const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
      const tags = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        const tag = match[1];
        if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
        if (!tags.includes(tag)) tags.push(tag);
      }
      this.publishTags = tags;
    },

    async sendFromPublish() {
      const text = this.publishInput.trim();
      if (!text && this.publishImages.length === 0) return;

      const tags = this.publishTags;
      let imagePaths = [];
      let imageData = [];

      if (this.publishImages.length > 0) {
        try {
          const result = await ImageHelper.processUpload(this.publishImages.map(p => p.file));
          imagePaths = result.imagePaths || [];
          imageData = result.imageData || [];
        } catch (e) { console.error('图片处理失败:', e); }
      }

      try {
        await DB.addNote({
          content: text,
          tags: tags,
          image_paths: imagePaths,
          image_data: imageData,
          type: 'text',
        });
        this.closePublishModal();
        this._dateCache = {};
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.showToast('已发布');
        // 滚动到顶部
        this.$nextTick(() => {
          const el = this.$refs.notesScroll;
          if (el) el.scrollTop = 0;
        });
      } catch (e) {
        console.error('发布失败:', e);
        this.showToast('发布失败');
      }
    },

    triggerPublishImageUpload() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = (e) => {
        const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
        if (files.length) this.handlePublishImageFiles(files);
      };
      input.click();
    },

    async handlePublishImageFiles(files) {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        try {
          const result = await ImageHelper.compress(file);
          this.publishImages.push({ file, dataUrl: result.dataUrl, size: result.size });
        } catch (e) { console.error('图片处理失败:', e); }
      }
    },

    // ===== 图片 =====
    zoomImage(src) { this.zoomSrc = src; },
    closeZoom() { this.zoomSrc = ''; },

    // ===== 复制笔记 =====
    copyNote(note) {
      navigator.clipboard.writeText(note.content || '').then(() => {
        this.showToast('已复制');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = note.content || '';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        this.showToast('已复制');
      });
    },

    // ===== 操作菜单 =====
    showCardMenu(note) { this.actionNote = note; },
    closeActionSheet() { this.actionNote = null; },

    copyNoteFromSheet() {
      if (!this.actionNote) return;
      this.copyNote(this.actionNote);
      this.closeActionSheet();
    },

    startEditFromSheet() {
      if (!this.actionNote) return;
      this.editingNote = this.actionNote;
      this.editText = this.actionNote.content;
      this.closeActionSheet();
    },

    async deleteFromSheet() {
      if (!this.actionNote) return;
      const note = this.actionNote;
      this.closeActionSheet();
      if (!confirm('确定删除这条笔记？')) return;
      try {
        await DB.deleteNote(note.id);
        this._dateCache = {};
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.showToast('已删除');
      } catch (e) {
        console.error('删除失败:', e);
        this.showToast('删除失败');
      }
    },

    // ===== 编辑 =====
    startEdit(note) {
      this.editingNote = note;
      this.editText = note.content;
    },

    closeEditModal() {
      this.editingNote = null;
      this.editText = '';
    },

    async saveEdit() {
      if (!this.editText.trim()) { this.showToast('内容不能为空'); return; }
      const tags = this.extractTags(this.editText);
      try {
        await DB.updateNote(this.editingNote.id, { content: this.editText.trim(), tags });
        this.closeEditModal();
        this._dateCache = {};
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.showToast('已更新');
      } catch (e) {
        console.error('更新失败:', e);
        this.showToast('更新失败');
      }
    },

    confirmDelete(note) {
      if (!confirm('确定删除这条笔记？')) return;
      this.doDelete(note);
    },

    async doDelete(note) {
      try {
        await DB.deleteNote(note.id);
        this._dateCache = {};
        await Promise.all([this.refreshNotes(), this.refreshTags()]);
        this.showToast('已删除');
      } catch (e) {
        console.error('删除失败:', e);
        this.showToast('删除失败');
      }
    },

    // ===== 标签提取 =====
    extractTags(text) {
      // \u5148\u5265 URL\uff0c\u907f\u514d fragment \u88ab\u8bc6\u522b\u4e3a tag
      text = (text || '').replace(/https?:\/\/\S+/g, ' ');
      const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
      const tags = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        const tag = match[1];
        if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
        if (!tags.includes(tag)) tags.push(tag);
      }
      return tags;
    },

    // ===== 标签高亮（占位符保护 URL）=====
    highlightTags(html) {
      // 先用占位符保护 URL，避免 URL 内的 #frag 被高亮
      const _urls = [];
      html = html.replace(/https?:\/\/\S+/g, (m) => {
        _urls.push(m);
        return '\x00URL' + (_urls.length - 1) + '\x00';
      });
      const highlighted = html.replace(
        /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g,
        (match, tag) => {
          if (/^[a-zA-Z]+\d+$/.test(tag)) return match;
          return '<span class="tag-highlight">' + match + '</span>';
        }
      );
      // \u8fd8\u539f URL \u5360\u4f4d\u7b26
      return highlighted.replace(/\x00URL(\d+)\x00/g, (_, i) => _urls[+i]);
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // ===== 日期分割 =====
    isFirstNoteOfDate(idx) {
      const note = this.notes[idx];
      if (!note || !note.created_at) return idx === 0;
      const date = note.created_at.slice(0, 10);
      if (idx === 0) { this._dateCache[idx] = date; return true; }
      const prevNote = this.notes[idx - 1];
      const prevDate = prevNote?.created_at?.slice(0, 10) || '';
      this._dateCache[idx] = date;
      return date !== prevDate;
    },

    formatDateLabel(dateStr) {
      if (!dateStr) return '';
      const date = dateStr.slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (date === today) return '今天';
      if (date === yesterday) return '昨天';
      const d = new Date(date);
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekDays[d.getDay()];
    },

    formatTime(timeStr) {
      if (!timeStr) return '';
      const match = timeStr.match(/(\d{2}):(\d{2})/);
      return match ? match[1] + ':' + match[2] : timeStr.slice(11, 16);
    },

    getImageUrls(note) {
      const urls = [];
      this.normalizeToArray(note.image_paths).forEach(p => { if (p) urls.push({ src: p }); });
      this.normalizeToArray(note.image_data).forEach(b => { if (b) urls.push({ src: 'data:image/jpeg;base64,' + b }); });
      return urls;
    },

    normalizeToArray(val) {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val.trim()) {
        try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch {}
        return val.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
    },

    showToast(msg) {
      clearTimeout(this.toastTimer);
      this.toast = { show: true, msg };
      this.toastTimer = setTimeout(() => { this.toast.show = false; }, 2000);
    },
  },
};

const vm = Vue.createApp(App).mount('#app');
window.vm = vm;
