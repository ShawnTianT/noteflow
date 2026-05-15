/**
 * app.js - Vue 3 主应用（Supabase 自定义用户表版本）
 * 布局、状态管理、模块协调
 */

const app = {
  // ==================== 响应式数据 ====================
  data() {
    return {
      loaded: false,
      notes: [],
      tags: [],
      users: [],
      currentUserId: null,
      currentTag: '',
      searchKey: '',
      noteCount: 0,
      showExportMenu: false,

      // Supabase 登录相关
      isLoggedIn: false,
      localMode: false,
      userUsername: '',

      // 登录表单
      loginUsername: '',
      loginPassword: '',
      loginError: '',
      loginLoading: false,

      // 分页
      currentPage: 1,
      hasMoreNotes: false,
      notesLoaded: false,
      loadingMore: false,

      // 同步状态
      syncStatus: 'local',
    };
  },

  // ==================== 计算属性 ====================
  computed: {
    syncStatusClass() {
      return {
        'sync-local': this.localMode,
        'sync-online': this.isLoggedIn && !this.localMode,
        'sync-offline': this.isLoggedIn && !navigator.onLine,
        'sync-syncing': this.syncStatus === 'syncing',
      };
    },
    syncStatusText() {
      if (this.localMode) return '📱 本地模式';
      if (this.syncStatus === 'syncing') return '🔄 同步中...';
      if (!navigator.onLine) return '📴 离线';
      return '☁️ 已同步';
    }
  },

  // ==================== 生命周期 ====================
  async mounted() {
    // 监听后台同步完成事件（修复首次加载时机问题：sync 完成后 UI 自动补一次刷新）
    window.addEventListener('noteflow:sync-complete', () => {
      if (this.isLoggedIn || this.localMode) {
        this.refreshNotes();
        this.refreshTags();
      }
    });

    try {
      await DB.init();
      this.isLoggedIn = DB.isLoggedIn();
      this.localMode = DB.isOfflineMode();
      this.userUsername = DB.getCurrentUsername();

      if (this.isLoggedIn || this.localMode) {
        this.currentUserId = DB.getCurrentUserId();
        this.loaded = true;

        this.$nextTick(async () => {
          try {
            await this.refreshNotes();
            await this.refreshTags();

            Editor.init(this);
            SearchModule.init(this);

            const users = await DB.getUsers();
            UserModule.renderUserSwitcher(users, this.currentUserId);
          } catch (innerErr) {
            console.error('模块初始化失败:', innerErr);
          }
        });
      } else {
        // 未登录，显示登录界面
        this.loaded = true;
      }
    } catch (e) {
      console.error('应用初始化失败:', e);
      // 降级到本地模式
      DB.enterLocalMode();
      this.localMode = true;
      this.isLoggedIn = false;
      this.currentUserId = DB.getCurrentUserId();
      this.loaded = true;

      this.$nextTick(async () => {
        await this.refreshNotes();
        await this.refreshTags();
        Editor.init(this);
        SearchModule.init(this);
      });
    }
  },

  // ==================== 方法 ====================
  methods: {
    // ======== 登录 ========

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
        this.userUsername = this.loginUsername;
        this.currentUserId = DB.getCurrentUserId();

        // Vue v-else 主界面渲染完成后才能拿到 #fab-publish 等元素
        await this.$nextTick();

        // 绑定 FAB 按钮、textarea、搜索框等 listener（首次/重登都需要）
        Editor.init(this);
        SearchModule.init(this);

        await this.refreshNotes();
        await this.refreshTags();

        const users = await DB.getUsers();
        UserModule.renderUserSwitcher(users, this.currentUserId);

        Editor.showToast('登录成功');
      } catch (e) {
        this.loginError = e.message;
      } finally {
        this.loginLoading = false;
      }
    },

    async doSignOut() {
      await DB.signOut();
      this.isLoggedIn = false;
      this.localMode = false;
      this.userUsername = '';
      this.currentUserId = null;

      Editor.showToast('已退出登录');
    },

    enterLocalMode() {
      DB.enterLocalMode();
      this.localMode = true;
      this.isLoggedIn = false;
      this.currentUserId = DB.getCurrentUserId();

      // 等 Vue 渲染主界面 DOM 后再绑定 FAB / textarea / 搜索框 listener
      this.$nextTick(async () => {
        await this.refreshNotes();
        await this.refreshTags();
        Editor.init(this);
        SearchModule.init(this);
      });
    },

    async manualSync() {
      if (this.isLoggedIn) {
        await DB.syncFromCloud();
        await this.refreshNotes();
        await this.refreshTags();
        Editor.showToast('同步完成');
      }
    },

    // ======== 数据刷新 ========

    async refreshNotes() {
      try {
        const result = await DB.getNotes({
          tag: this.currentTag || null,
          search: this.searchKey || null,
          pageSize: 50,
          pageCurrent: 1,
        });
        this.notes = result.data;
        this.noteCount = result.total;
        this.hasMoreNotes = result.hasMore;
        this.currentPage = 1;
        this.notesLoaded = true;

        Timeline.renderNotes(this.notes);
      } catch (e) {
        console.error('刷新笔记失败:', e);
      }
    },

    async loadMoreNotes() {
      if (this.loadingMore || !this.hasMoreNotes) return;
      this.loadingMore = true;
      try {
        this.currentPage++;
        const result = await DB.getNotes({
          tag: this.currentTag || null,
          search: this.searchKey || null,
          pageSize: 50,
          pageCurrent: this.currentPage,
        });
        this.notes = this.notes.concat(result.data);
        this.hasMoreNotes = result.hasMore;

        Timeline.appendNotes(result.data);
      } catch (e) {
        console.error('加载更多失败:', e);
        this.currentPage--;
      } finally {
        this.loadingMore = false;
      }
    },

    async refreshTags() {
      try {
        this.tags = await DB.getTags();
        TagsModule.renderTags(this.tags, this.currentTag);
      } catch (e) {
        console.error('刷新标签失败:', e);
      }
    },

    // ======== 筛选 ========

    async filterByTag(tagName) {
      this.currentTag = tagName;
      if (this.searchKey) {
        this.searchKey = '';
        SearchModule.clearSearch();
      }
      await this.refreshNotes();
      await this.refreshTags();
    },

    async setSearch(keyword) {
      this.searchKey = keyword;
      await this.refreshNotes();
    },

    async dailyReview() {
      this.currentTag = '';
      this.searchKey = '';
      SearchModule.clearSearch();

      const randomNotes = await DB.getRandomNotes(10);
      this.noteCount = randomNotes.length;
      this.hasMoreNotes = false;
      Timeline.renderNotes(randomNotes);
      await this.refreshTags();

      Editor.showToast(`📖 随机回顾 ${randomNotes.length} 条笔记`);
    },

    // ======== 用户 ========

    async switchUser(userId) {
      if (userId === this.currentUserId) return;
      Editor.showToast('请使用登录/退出切换账号');
    },

    getUserName() {
      if (this.isLoggedIn) return this.userUsername;
      return '本地用户';
    },

    // ======== 导入导出 ========

    async exportJSON() {
      ExportModule.exportJSON();
      this.showExportMenu = false;
    },

    async exportFlomo() {
      ExportModule.exportFlomo();
      this.showExportMenu = false;
    },

    importFlomo() {
      ExportModule.importFlomo();
      this.showExportMenu = false;
    },

    toggleExportMenu() {
      this.showExportMenu = !this.showExportMenu;
    },

    closeExportMenu(e) {
      if (!e.target.closest('.export-menu-wrapper')) {
        this.showExportMenu = false;
      }
    }
  }
};

// 创建 Vue 应用
const vm = Vue.createApp(app).mount('#app');

// 暴露到全局
window.app = vm;
window.App = vm;
