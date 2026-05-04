// db-supabase.js
// Noteflow 数据库层 — Supabase 版本（离线优先 + 自定义用户表）
// 替换原来的 db.js（sql.js 版本）

const DB = (() => {
  // ================================================
  // 配置
  // ================================================
  const SUPABASE_URL = 'https://rsqamgjvreurggjoxphq.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_ALz1AArY5Khm7hBdynxPIg_jx59B0zW';

  let supabase = null;
  let currentUserId = null;   // BIGINT，来自 public.users.id
  let currentUsername = null;   // 用户名（如 '18134158895'）
  let isLocalMode = false;

  // IndexedDB 本地缓存
  let idbDb = null;
  const IDB_NAME = 'noteflow_offline';
  const IDB_VERSION = 2;

  // ID 映射：本地临时 ID → 云端真实 ID
  const idMap = new Map();

  // ================================================
  // IndexedDB 操作
  // ================================================
  function openIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('notes')) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('user_id', 'user_id', { unique: false });
          noteStore.createIndex('created_at', 'created_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('tags')) {
          const tagStore = db.createObjectStore('tags', { keyPath: 'id' });
          tagStore.createIndex('user_id', 'user_id', { unique: false });
          tagStore.createIndex('name_user', ['name', 'user_id'], { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'localId' });
        }
        if (!db.objectStoreNames.contains('id_map')) {
          db.createObjectStore('id_map', { keyPath: 'localId' });
        }
      };
      request.onsuccess = () => { idbDb = request.result; resolve(idbDb); };
      request.onerror = () => reject(request.error);
    });
  }

  function idbTx(storeName, mode) {
    return idbDb.transaction(storeName, mode).objectStore(storeName);
  }

  function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = idbTx(storeName, 'readonly').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = idbTx(storeName, 'readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
      const req = idbTx(storeName, 'readwrite').put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = idbTx(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = idbDb.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbClear(storeName) {
    return new Promise((resolve, reject) => {
      const req = idbTx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ================================================
  // 数据格式归一化工具
  // ================================================

  /**
   * 从笔记内容中提取标签（后备方案，当 tags 字段为空时）
   */
  function extractTagsFromContent(content) {
    if (!content) return [];
    const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
    const matches = [];
    let m;
    while ((m = regex.exec(content)) !== null) {
      matches.push(m[1]);
    }
    return matches;
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') {
      if (tags.trim() === '') return [];
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
  }

  /**
   * 将字段归一化为数组（image_paths, image_data）
   */
  function normalizeToArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      if (val.trim() === '') return [];
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return val.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
  }

  // ================================================
  // 初始化
  // ================================================
  async function init() {
    await openIDB();

    // 加载 ID 映射
    const mappings = await idbGetAll('id_map');
    mappings.forEach(m => idMap.set(m.localId, m.cloudId));

    // 初始化 Supabase
    try {
      if (window.supabase && window.supabase.createClient) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // 检查本地是否有登录状态
        const savedUserId = localStorage.getItem('noteflow_user_id');
        const savedUsername = localStorage.getItem('noteflow_username');
        if (savedUserId && savedUsername) {
          currentUserId = parseInt(savedUserId, 10);
          currentUsername = savedUsername;
          isLocalMode = false;
          // 后台同步
          syncFromCloud();
        }
      } else {
        console.warn('[DB] Supabase SDK 未加载，仅本地模式');
      }
    } catch (e) {
      console.warn('[DB] Supabase 初始化失败，仅本地模式:', e.message);
    }

    // 未登录：不自动进入本地模式，让用户界面选择
    if (!currentUserId) {
      isLocalMode = false;
    }

    return true;
  }

  // ================================================
  // 认证（自定义用户表）
  // ================================================
  function getCurrentUserId() {
    return currentUserId;  // 返回实际值：BIGINT 数字 或 null（未登录）
  }

  function getCurrentUsername() {
    return currentUsername || '';
  }

  function isLoggedIn() {
    return currentUserId !== null;
  }

  function isOfflineMode() {
    return isLocalMode;
  }

  // 登录：调用 Supabase RPC 验证密码
  async function signIn(username, password) {
    if (!supabase) return { error: { message: 'Supabase 未初始化' } };

    const { data, error } = await supabase
      .rpc('verify_password', {
        p_username: username,
        p_password: password,
      });

    if (error) return { error };
    if (!data || data.length === 0) {
      return { error: { message: '账号或密码错误' } };
    }

    // 登录成功
    currentUserId = data[0].user_id;
    currentUsername = data[0].user_username;
    isLocalMode = false;

    // 持久化登录状态
    localStorage.setItem('noteflow_user_id', currentUserId);
    localStorage.setItem('noteflow_username', currentUsername);

    // 从云端同步数据
    await syncFromCloud();

    return { data: { user: { id: currentUserId, username: currentUsername } }, error: null };
  }

  // 退出登录
  async function signOut() {
    currentUserId = null;
    currentUsername = null;
    isLocalMode = false;

    localStorage.removeItem('noteflow_user_id');
    localStorage.removeItem('noteflow_username');

    // 清空本地缓存（可选，保留可离线查看）
    // await idbClear('notes');
    // await idbClear('tags');
  }

  // 本地模式：不登录，使用本地 IndexedDB 中已有的数据
  // 本地模式下 currentUserId 为 null，getNotes 会返回所有本地缓存数据
  function enterLocalMode() {
    isLocalMode = true;
    currentUserId = null;
    currentUsername = '';
  }

  // ================================================
  // 云端同步
  // ================================================
  let syncInProgress = false;

  async function syncFromCloud() {
    if (!isLoggedIn() || !supabase || syncInProgress) return;
    syncInProgress = true;
    try {
      let allNotes = [];
      let page = 0;
      const pageSize = 200;
      while (true) {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', currentUserId)
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allNotes = allNotes.concat(data);
        if (data.length < pageSize) break;
        page++;
      }

      await idbClear('notes');
      for (const note of allNotes) {
        const normalized = {
          ...note,
          tags: normalizeTags(note.tags),
          image_paths: normalizeToArray(note.image_paths),
          image_data: normalizeToArray(note.image_data),
          is_done: note.is_done === true || note.is_done === 1,
        };
        await idbPut('notes', normalized);
      }

      const { data: tags, error: tagError } = await supabase
        .from('tags')
        .select('*')
        .eq('user_id', currentUserId);
      if (!tagError && tags) {
        await idbClear('tags');
        for (const tag of tags) {
          await idbPut('tags', tag);
        }
      }

      console.log(`[sync] 从云端同步了 ${allNotes.length} 条笔记, ${tags ? tags.length : 0} 个标签`);
    } catch (err) {
      console.warn('[sync] 从云端同步失败:', err.message);
    } finally {
      syncInProgress = false;
    }
  }

  async function syncToCloud() {
    if (!isLoggedIn() || !supabase || syncInProgress) return;
    syncInProgress = true;
    try {
      const queue = await idbGetAll('sync_queue');
      for (const item of queue) {
        try {
          if (item.action === 'insert') {
            const cloudData = { ...item.data };
            delete cloudData.id;
            delete cloudData._local;
            cloudData.user_id = currentUserId;

            const { data, error } = await supabase
              .from('notes')
              .insert(cloudData)
              .select()
              .single();
            if (!error && data) {
              idMap.set(item.localId, data.id);
              await idbPut('id_map', { localId: item.localId, cloudId: data.id });
              await idbDelete('sync_queue', item.localId);
            } else if (error) {
              console.warn('[sync] 插入失败:', error.message);
            }
          } else if (item.action === 'update') {
            const cloudId = idMap.get(item.localId) || item.localId;
            const cloudData = { ...item.data };
            delete cloudData.id;
            delete cloudData._local;

            const { error } = await supabase
              .from('notes')
              .update(cloudData)
              .eq('id', cloudId);
            if (!error) {
              await idbDelete('sync_queue', item.localId);
            }
          } else if (item.action === 'delete') {
            const cloudId = idMap.get(item.localId) || item.localId;
            const { error } = await supabase
              .from('notes')
              .delete()
              .eq('id', cloudId);
            if (!error) {
              await idbDelete('sync_queue', item.localId);
              idMap.delete(item.localId);
            }
          } else if (item.action === 'updateTag') {
            const { data: existing } = await supabase
              .from('tags')
              .select('id')
              .eq('user_id', currentUserId)
              .eq('name', item.tagName)
              .single();

            if (existing) {
              await supabase
                .from('tags')
                .update({ count: item.count })
                .eq('id', existing.id);
            } else if (item.count > 0) {
              await supabase
                .from('tags')
                .insert({ user_id: currentUserId, name: item.tagName, count: item.count });
            }
            await idbDelete('sync_queue', item.localId);
          }
        } catch (e) {
          console.warn('[sync] 单条同步失败:', e.message);
        }
      }
    } finally {
      syncInProgress = false;
    }
  }

  // 联网时自动同步
  window.addEventListener('online', () => {
    if (isLoggedIn()) {
      syncFromCloud();
      syncToCloud();
    }
  });

  function getSyncStatus() {
    if (isLocalMode) return 'local';
    if (syncInProgress) return 'syncing';
    if (navigator.onLine) return 'online';
    return 'offline';
  }

  // ================================================
  // 笔记操作（离线优先）
  // ================================================
  async function getNotes(options = {}) {
    const {
      pageSize = 50,
      pageCurrent = 1,
      userId = null,
      tag = null,
      search = null,
    } = options;

    const uid = userId || getCurrentUserId();

    let notes;
    if (uid) {
      // 已登录：按 user_id 精确查询
      notes = await idbGetAllByIndex('notes', 'user_id', uid);
    } else {
      // 本地模式/未登录：返回所有本地缓存数据
      notes = await idbGetAll('notes');
    }

    if (tag) {
      notes = notes.filter(n => {
        // 先尝试从 tags 字段获取
        let tagList = normalizeTags(n.tags);
        // 如果 tags 为空，从 content 提取
        if (tagList.length === 0 && n.content) {
          tagList = extractTagsFromContent(n.content);
        }
        return tagList.some(t => t === tag || t.startsWith(tag + '/'));
      });
    }

    if (search) {
      const keywords = search.trim().split(/\s+/).map(kw => kw.toLowerCase());
      notes = notes.filter(n => {
        // 所有关键词必须匹配（AND 逻辑）
        return keywords.every(kw => {
          const contentMatch = n.content && n.content.toLowerCase().includes(kw);
          const tagList = normalizeTags(n.tags);
          const tagsMatch = tagList.some(t => t.toLowerCase().includes(kw));
          return contentMatch || tagsMatch;
        });
      });
    }

    notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = notes.length;
    const start = (pageCurrent - 1) * pageSize;
    const paged = notes.slice(start, start + pageSize);

    return {
      data: paged,
      total,
      hasMore: start + pageSize < total,
    };
  }

  async function getNoteById(noteId) {
    return await idbGet('notes', noteId);
  }

  async function addNote(note) {
    const localId = Math.floor(Date.now() + Math.random() * 10000);
    const now = new Date().toISOString();
    const uid = getCurrentUserId();

    const newNote = {
      id: localId,
      user_id: uid,
      content: note.content || '',
      tags: note.tags || [],
      image_paths: note.image_paths || [],
      image_data: note.image_data || [],
      type: note.type || 'text',
      is_done: note.is_done || false,
      created_at: now,
      updated_at: now,
      _local: true,
    };

    await idbPut('notes', newNote);

    // 更新标签计数
    const tagList = normalizeTags(note.tags);
    for (const tag of tagList) {
      await updateTagCount(tag, 1);
    }

    if (isLoggedIn()) {
      await idbPut('sync_queue', {
        localId,
        action: 'insert',
        data: { ...newNote },
      });
      syncToCloud();
    }

    return newNote;
  }

  async function addNotesBatch(notes, options = {}) {
    const uid = getCurrentUserId();
    const now = new Date().toISOString();
    const results = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const localId = Math.floor(Date.now() + Math.random() * 10000) + i;

      const newNote = {
        id: localId,
        user_id: uid,
        content: note.content || '',
        tags: note.tags || [],
        image_paths: note.image_paths || [],
        image_data: note.image_data || [],
        type: note.type || 'text',
        is_done: note.is_done || false,
        created_at: note.created_at || note.createdAt || now,
        updated_at: note.updated_at || note.updatedAt || now,
      };

      await idbPut('notes', newNote);
      results.push(newNote);

      if (isLoggedIn()) {
        await idbPut('sync_queue', {
          localId,
          action: 'insert',
          data: { ...newNote },
        });
      }
    }

    if (isLoggedIn() && !options.skipSave) {
      syncToCloud();
    }

    return results;
  }

  async function updateNote(noteId, updates) {
    const note = await idbGet('notes', noteId);
    if (!note) return false;

    // 更新标签计数：旧标签 -1
    const oldTags = normalizeTags(note.tags);
    for (const tag of oldTags) {
      await updateTagCount(tag, -1);
    }

    const updated = {
      ...note,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    await idbPut('notes', updated);

    // 更新标签计数：新标签 +1
    const newTags = normalizeTags(updated.tags);
    for (const tag of newTags) {
      await updateTagCount(tag, 1);
    }

    if (isLoggedIn()) {
      await idbPut('sync_queue', {
        localId: noteId,
        action: 'update',
        data: { ...updated },
      });
      syncToCloud();
    }

    return true;
  }

  async function deleteNote(noteId) {
    const note = await idbGet('notes', noteId);

    // 更新标签计数
    if (note) {
      const tags = normalizeTags(note.tags);
      for (const tag of tags) {
        await updateTagCount(tag, -1);
      }
    }

    await idbDelete('notes', noteId);

    if (isLoggedIn()) {
      await idbPut('sync_queue', {
        localId: noteId,
        action: 'delete',
      });
      syncToCloud();
    }

    return true;
  }

  async function getNoteCount(userId) {
    const uid = userId || getCurrentUserId();
    let notes;
    if (uid) {
      notes = await idbGetAllByIndex('notes', 'user_id', uid);
    } else {
      notes = await idbGetAll('notes');
    }
    return notes.length;
  }

  async function getRandomNotes(count = 10) {
    const uid = getCurrentUserId();
    let notes;
    if (uid) {
      notes = await idbGetAllByIndex('notes', 'user_id', uid);
    } else {
      notes = await idbGetAll('notes');
    }
    for (let i = notes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [notes[i], notes[j]] = [notes[j], notes[i]];
    }
    return notes.slice(0, count);
  }

  // ================================================
  // 标签操作
  // ================================================
  async function getTags(userId) {
    const uid = userId || getCurrentUserId();
    let tags;
    if (uid) {
      tags = await idbGetAllByIndex('tags', 'user_id', uid);
    } else {
      tags = await idbGetAll('tags');
    }
    return tags.sort((a, b) => b.count - a.count);
  }

  async function updateTagCount(tagName, delta, userId) {
    const uid = userId || getCurrentUserId();
    let tags;
    if (uid) {
      tags = await idbGetAllByIndex('tags', 'user_id', uid);
    } else {
      tags = await idbGetAll('tags');
    }
    let tag = tags.find(t => t.name === tagName);

    if (delta > 0 && !tag) {
      tag = { id: Date.now(), user_id: uid, name: tagName, count: 0 };
    }
    if (tag) {
      tag.count = Math.max(0, tag.count + delta);
      await idbPut('tags', tag);

      if (isLoggedIn()) {
        await idbPut('sync_queue', {
          localId: 'tag_' + tagName,
          action: 'updateTag',
          tagName,
          count: tag.count,
        });
        syncToCloud();
      }
    }
  }

  async function rebuildTagCounts(userId) {
    const uid = userId || getCurrentUserId();
    let notes;
    if (uid) {
      notes = await idbGetAllByIndex('notes', 'user_id', uid);
    } else {
      notes = await idbGetAll('notes');
    }
    const tagCountMap = {};

    for (const note of notes) {
      const tags = normalizeTags(note.tags);
      for (const tag of tags) {
        tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
      }
    }

    await idbClear('tags');
    const result = [];
    for (const [name, count] of Object.entries(tagCountMap)) {
      const tag = { id: Date.now() + Math.random(), user_id: uid, name, count };
      await idbPut('tags', tag);
      result.push(tag);
    }
    return result;
  }

  // ================================================
  // 用户操作
  // ================================================
  async function getUsers() {
    if (isLoggedIn()) {
      return [{ id: currentUserId, name: currentUsername, username: currentUsername }];
    }
    return [{ id: 'local', name: '本地用户', username: '' }];
  }

  // ================================================
  // 导出数据
  // ================================================
  async function getAllNotesForExport(userId) {
    const uid = userId || getCurrentUserId();
    if (uid) {
      return await idbGetAllByIndex('notes', 'user_id', uid);
    }
    return await idbGetAll('notes');
  }

  async function getAllTagsForExport(userId) {
    const uid = userId || getCurrentUserId();
    if (uid) {
      return await idbGetAllByIndex('tags', 'user_id', uid);
    }
    return await idbGetAll('tags');
  }

  async function saveDb() {
    if (isLoggedIn()) {
      syncToCloud();
    }
  }

  function markDirty() {}

  // ================================================
  // 公开 API
  // ================================================
  return {
    init,
    getCurrentUserId,
    getCurrentUsername,
    isLoggedIn,
    isOfflineMode,
    signIn,
    signOut,
    enterLocalMode,
    getNotes,
    getNoteById,
    addNote,
    addNotesBatch,
    updateNote,
    deleteNote,
    getNoteCount,
    getRandomNotes,
    getTags,
    updateTagCount,
    rebuildTagCounts,
    getUsers,
    syncFromCloud,
    syncToCloud,
    getSyncStatus,
    getAllNotesForExport,
    getAllTagsForExport,
    saveDb,
    markDirty,
  };
})();

window.DB = DB;
