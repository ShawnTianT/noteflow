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

  // 本地 ID 生成器（避免 Date.now()+random 在批量插入时撞 ID）
  let _idCounter = 0;
  function makeLocalId() {
    _idCounter = (_idCounter + 1) % 10000;
    return Date.now() * 10000 + _idCounter;
  }

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

  // URL 过滤：避免 https://x.com/#frag 这种 fragment 被误识为 tag
  const URL_REGEX = /https?:\/\/\S+/g;
  function stripUrls(text) { return (text || '').replace(URL_REGEX, ' '); }

  /**
   * 从笔记内容中提取标签（剥 URL 后用统一正则；过滤纯英文+数字尾缀如 campaign2）
   */
  function extractTagsFromContent(content) {
    if (!content) return [];
    const cleaned = stripUrls(content);
    const regex = /#([\w\u4e00-\u9fa5'-]+(?:\/[\w\u4e00-\u9fa5'-]+)*)/g;
    const matches = [];
    let m;
    while ((m = regex.exec(cleaned)) !== null) {
      const tag = m[1];
      if (/^[a-zA-Z]+\d+$/.test(tag)) continue;
      if (!matches.includes(tag)) matches.push(tag);
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

    // 未登录：检查上次是否选择了本地模式（C 修复：localMode 持久化）
    if (!currentUserId) {
      isLocalMode = localStorage.getItem('noteflow_local_mode') === '1';
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

    // 持久化登录状态（清除可能存在的本地模式 flag）
    localStorage.setItem('noteflow_user_id', currentUserId);
    localStorage.setItem('noteflow_username', currentUsername);
    localStorage.removeItem('noteflow_local_mode');

    // 从云端同步数据
    await syncFromCloud();

    return { data: { user: { id: currentUserId, username: currentUsername } }, error: null };
  }

  // 退出登录（F 修复：清当前用户的本地缓存，避免账号串数据）
  async function signOut() {
    if (currentUserId && idbDb) {
      const uid = currentUserId;
      try {
        await new Promise((resolve, reject) => {
          const tx = idbDb.transaction(['notes', 'tags', 'sync_queue'], 'readwrite');
          // 删当前用户 notes
          const noteIdx = tx.objectStore('notes').index('user_id');
          const noteReq = noteIdx.openCursor(IDBKeyRange.only(uid));
          noteReq.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { c.delete(); c.continue(); }
          };
          // 删当前用户 tags
          const tagIdx = tx.objectStore('tags').index('user_id');
          const tagReq = tagIdx.openCursor(IDBKeyRange.only(uid));
          tagReq.onsuccess = (e) => {
            const c = e.target.result;
            if (c) { c.delete(); c.continue(); }
          };
          // sync_queue 是用户作用域的，整个清空
          tx.objectStore('sync_queue').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.warn('[signOut] 清本地缓存失败:', e.message);
      }
    }

    currentUserId = null;
    currentUsername = null;
    isLocalMode = false;
    idMap.clear();

    localStorage.removeItem('noteflow_user_id');
    localStorage.removeItem('noteflow_username');
    localStorage.removeItem('noteflow_local_mode');
  }

  // 本地模式：不登录，使用本地 IndexedDB 中已有的数据
  // 本地模式下 currentUserId 为 null，getNotes 会返回所有本地缓存数据
  // C 修复：持久化 flag，刷新页面不会回到登录页
  function enterLocalMode() {
    isLocalMode = true;
    currentUserId = null;
    currentUsername = '';
    localStorage.setItem('noteflow_local_mode', '1');
  }

  // ================================================
  // 云端同步
  // ================================================
  let syncInProgress = false;
  // SDB-8: 模块级 promise，writers 入口 await，保证不与清空+回放阶段交叠
  let syncFromCloudPromise = null;
  // SDB-9: 模块级最后一次 sync 错误，getSyncStatus 反映 'error' 状态
  let lastSyncError = null;

  async function syncFromCloud() {
    if (!isLoggedIn() || !supabase) return;
    // SDB-8: 并发调用复用同一个 promise（同时也兼容旧 syncInProgress 短路）
    if (syncFromCloudPromise) return syncFromCloudPromise;
    if (syncInProgress) return;
    syncInProgress = true;

    syncFromCloudPromise = (async () => {
      try {
        // 1. 从云端拉所有笔记
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

        // 2. 一次性归一化
        // P5 修复：tags 提前提取，避免 getNotes filter 热路径反复跑正则
        // URL 修复：始终从 content 重新提取（用新 URL-aware 正则），云端老 tags 字段可能含污染数据，不可信
        const normalizedNotes = allNotes.map(note => {
          const tagList = note.content
            ? extractTagsFromContent(note.content)
            : normalizeTags(note.tags);
          return {
            ...note,
            tags: tagList,
            image_paths: normalizeToArray(note.image_paths),
            image_data: normalizeToArray(note.image_data),
            is_done: note.is_done === true || note.is_done === 1,
          };
        });

        const uid = currentUserId;

        // 3. 单事务：删当前用户旧 notes + 批量 put 新 notes
        // A 修复：原子操作，UI 不会看到中间空白态
        // B 修复：只删当前用户的，不动其他账号缓存
        // P1 修复：批量 put 在同一事务，~10x 提速
        await new Promise((resolve, reject) => {
          const tx = idbDb.transaction('notes', 'readwrite');
          const store = tx.objectStore('notes');
          const idx = store.index('user_id');
          const delReq = idx.openCursor(IDBKeyRange.only(uid));
          let deletePhaseDone = false;
          delReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            } else if (!deletePhaseDone) {
              deletePhaseDone = true;
              for (const note of normalizedNotes) store.put(note);
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('notes sync tx aborted'));
        });

        // 4. 标签：不再拉云端 tags 表（可能含 URL 污染或孤儿）
        //    直接基于已经清理过的本地 notes 重建 → 自动剔除 #p-1 / #wechat_redirect / 空标签
        const rebuiltTags = await rebuildTagCounts(uid);

        console.log(`[sync] 从云端同步了 ${normalizedNotes.length} 条笔记, ${rebuiltTags.length} 个标签（本地重建）`);

        // SDB-9: 成功 → 清掉历史 error
        lastSyncError = null;

        // 通知 UI 自动刷新（修复首次加载时机问题：refreshNotes 早于 sync 完成时，UI 自动补一次刷新）
        window.dispatchEvent(new CustomEvent('noteflow:sync-complete', {
          detail: { noteCount: normalizedNotes.length, tagCount: rebuiltTags.length }
        }));
      } catch (err) {
        console.warn('[sync] 从云端同步失败:', err.message);
        // SDB-9: 记录 + 派发事件让 UI 可订阅
        lastSyncError = { direction: 'from-cloud', message: err.message || String(err), at: Date.now() };
        try {
          window.dispatchEvent(new CustomEvent('noteflow:sync-error', {
            detail: { direction: 'from-cloud', message: err.message || String(err) }
          }));
        } catch (_) { /* SSR/test env 无 window 时静默 */ }
        // 不 rethrow：保持现有 signIn/online listener 的容错行为不变
      } finally {
        syncInProgress = false;
        syncFromCloudPromise = null;
      }
    })();

    return syncFromCloudPromise;
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
            } else {
              // SDB-9: 之前 update 失败完全静默
              console.warn('[sync] op failed:', item.action, error?.message);
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
            } else {
              // SDB-9: 之前 delete 失败完全静默
              console.warn('[sync] op failed:', item.action, error?.message);
            }
          } else if (item.action === 'updateTag') {
            const { data: existing } = await supabase
              .from('tags')
              .select('id')
              .eq('user_id', currentUserId)
              .eq('name', item.tagName)
              .single();

            if (existing) {
              if (item.count > 0) {
                await supabase
                  .from('tags')
                  .update({ count: item.count })
                  .eq('id', existing.id);
              } else {
                // 孤儿清理：count=0 时删除云端标签
                await supabase
                  .from('tags')
                  .delete()
                  .eq('id', existing.id);
              }
            } else if (item.count > 0) {
              await supabase
                .from('tags')
                .insert({ user_id: currentUserId, name: item.tagName, count: item.count });
            }
            // count=0 + 云端不存在 → 啥也不做
            await idbDelete('sync_queue', item.localId);
          }
        } catch (e) {
          console.warn('[sync] 单条同步失败:', e.message);
        }
      }
      // SDB-9: 整轮成功（即便单条失败已 warn）→ 清掉 lastSyncError
      // 注：单条失败不算整体失败，因为 sync_queue 还会保留下次重试
      // 这里只在确实抛错时才标 error
    } catch (err) {
      // SDB-9: syncToCloud 顶层错误派事件（之前完全没 catch）
      console.warn('[sync] 推送到云端失败:', err.message);
      lastSyncError = { direction: 'to-cloud', message: err.message || String(err), at: Date.now() };
      try {
        window.dispatchEvent(new CustomEvent('noteflow:sync-error', {
          detail: { direction: 'to-cloud', message: err.message || String(err) }
        }));
      } catch (_) { /* SSR/test env 无 window */ }
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
    // SDB-9: 上次 sync 有错误（且 5 分钟内）→ 报 error，让 UI 提示重试
    if (lastSyncError && (Date.now() - lastSyncError.at) < 5 * 60 * 1000) return 'error';
    if (navigator.onLine) return 'online';
    return 'offline';
  }

  // SDB-9: 给 UI 取最后一次 sync 错误的详情
  function getLastSyncError() {
    return lastSyncError;
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
    const note = await idbGet('notes', noteId);
    // SDB-3: 跨用户安全 — 拒绝读取其他用户的 note
    const currentUid = getCurrentUserId();
    if (note && currentUid != null && note.user_id !== currentUid) {
      console.warn(`[security] note ${noteId} belongs to user ${note.user_id}, not current user ${currentUid}; refusing operation`);
      return null;
    }
    return note;
  }

  async function addNote(note) {
    // SDB-8: 等待 syncFromCloud 完成，避免清空+回放期间写入被覆盖
    if (syncFromCloudPromise) await syncFromCloudPromise;
    const localId = makeLocalId();
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

    const tagList = normalizeTags(note.tags);

    // P8 修复：notes + tags + sync_queue 一次事务搞定，避免 N+1 次 idbGetAllByIndex
    await new Promise((resolve, reject) => {
      const stores = isLoggedIn() ? ['notes', 'tags', 'sync_queue'] : ['notes', 'tags'];
      const tx = idbDb.transaction(stores, 'readwrite');
      tx.objectStore('notes').put(newNote);

      if (tagList.length > 0) {
        const tagStore = tx.objectStore('tags');
        // 一次性读出当前用户所有 tag 到内存
        const req = uid
          ? tagStore.index('user_id').getAll(IDBKeyRange.only(uid))
          : tagStore.getAll();
        req.onsuccess = () => {
          const existingTags = req.result || [];
          const tagMap = new Map(existingTags.map(t => [t.name, t]));
          for (const tagName of tagList) {
            let tag = tagMap.get(tagName);
            if (!tag) {
              tag = { id: makeLocalId(), user_id: uid, name: tagName, count: 1 };
            } else {
              tag.count = (tag.count || 0) + 1;
            }
            tagStore.put(tag);
            if (isLoggedIn()) {
              tx.objectStore('sync_queue').put({
                localId: 'tag_' + tagName,
                action: 'updateTag',
                tagName,
                count: tag.count,
              });
            }
          }
          // notes 的 sync_queue 也在同事务内入队
          if (isLoggedIn()) {
            tx.objectStore('sync_queue').put({
              localId,
              action: 'insert',
              data: { ...newNote },
            });
          }
        };
      } else if (isLoggedIn()) {
        tx.objectStore('sync_queue').put({
          localId,
          action: 'insert',
          data: { ...newNote },
        });
      }

      tx.oncomplete = () => {
        if (isLoggedIn()) syncToCloud();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });

    return newNote;
  }

  // SDB-2: 批量导入维护标签计数 + 单事务写 notes/tags/sync_queue
  // SDB-8: 等待 syncFromCloud 完成
  async function addNotesBatch(notes, options = {}) {
    if (syncFromCloudPromise) await syncFromCloudPromise;
    const uid = getCurrentUserId();
    const now = new Date().toISOString();

    // 1. 预先构造所有新笔记
    const newNotes = notes.map(note => ({
      id: makeLocalId(),
      user_id: uid,
      content: note.content || '',
      tags: note.tags || [],
      image_paths: note.image_paths || [],
      image_data: note.image_data || [],
      type: note.type || 'text',
      is_done: note.is_done || false,
      created_at: note.created_at || note.createdAt || now,
      updated_at: note.updated_at || note.updatedAt || now,
    }));

    // 2. 累积所有 tag delta
    const tagDelta = new Map();
    for (const n of newNotes) {
      for (const t of normalizeTags(n.tags)) {
        tagDelta.set(t, (tagDelta.get(t) || 0) + 1);
      }
    }

    // 3. 单事务写所有 notes + tags + sync_queue
    await new Promise((resolve, reject) => {
      const stores = isLoggedIn() ? ['notes', 'tags', 'sync_queue'] : ['notes', 'tags'];
      const tx = idbDb.transaction(stores, 'readwrite');
      const notesStore = tx.objectStore('notes');
      const tagsStore = tx.objectStore('tags');

      for (const note of newNotes) notesStore.put(note);

      if (tagDelta.size > 0) {
        const tagReq = uid
          ? tagsStore.index('user_id').getAll(IDBKeyRange.only(uid))
          : tagsStore.getAll();
        tagReq.onsuccess = () => {
          const existing = tagReq.result || [];
          const tagMap = new Map(existing.map(t => [t.name, t]));
          for (const [name, delta] of tagDelta) {
            let tag = tagMap.get(name);
            if (!tag) {
              tag = { id: makeLocalId(), user_id: uid, name, count: 0 };
              tagMap.set(name, tag);
            }
            tag.count = (tag.count || 0) + delta;
            tagsStore.put(tag);
            if (isLoggedIn()) {
              tx.objectStore('sync_queue').put({
                localId: 'tag_' + name,
                action: 'updateTag',
                tagName: name,
                count: tag.count,
              });
            }
          }
          if (isLoggedIn()) {
            for (const note of newNotes) {
              tx.objectStore('sync_queue').put({
                localId: note.id,
                action: 'insert',
                data: { ...note },
              });
            }
          }
        };
      } else if (isLoggedIn()) {
        for (const note of newNotes) {
          tx.objectStore('sync_queue').put({
            localId: note.id,
            action: 'insert',
            data: { ...note },
          });
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (isLoggedIn() && !options.skipSave) {
      syncToCloud();
    }

    return newNotes;
  }

  // SDB-7: 单事务包 notes + tags + sync_queue，与 addNote 对齐
  // SDB-8: 等待 syncFromCloud 完成，避免清空+回放期间写入被覆盖
  async function updateNote(noteId, updates) {
    if (syncFromCloudPromise) await syncFromCloudPromise;
    const uid = getCurrentUserId();
    let noteFound = false;
    let crossUserReject = false;

    try {
      await new Promise((resolve, reject) => {
        const stores = isLoggedIn() ? ['notes', 'tags', 'sync_queue'] : ['notes', 'tags'];
        const tx = idbDb.transaction(stores, 'readwrite');
        const notesStore = tx.objectStore('notes');
        const tagsStore = tx.objectStore('tags');

      const getReq = notesStore.get(noteId);
      getReq.onsuccess = () => {
        const note = getReq.result;
        if (!note) return;
        // SDB-3: 跨用户安全 — 当前用户与 note.user_id 不匹配时 abort 整个 tx
        if (uid != null && note.user_id !== uid) {
          console.warn(`[security] updateNote ${noteId} belongs to user ${note.user_id}, not current user ${uid}; aborting`);
          crossUserReject = true;
          tx.abort();
          return;
        }
        noteFound = true;

        const oldTags = normalizeTags(note.tags);
        const updated = {
          ...note,
          ...updates,
          updated_at: new Date().toISOString(),
        };
        const newTags = normalizeTags(updated.tags);

        // 计算 tag delta：oldTags -1, newTags +1（互相抵消的部分 delta=0）
        const tagDelta = new Map();
        for (const t of oldTags) tagDelta.set(t, (tagDelta.get(t) || 0) - 1);
        for (const t of newTags) tagDelta.set(t, (tagDelta.get(t) || 0) + 1);

        notesStore.put(updated);

        const hasTagChange = Array.from(tagDelta.values()).some(d => d !== 0);
        if (hasTagChange) {
          const tagReq = uid
            ? tagsStore.index('user_id').getAll(IDBKeyRange.only(uid))
            : tagsStore.getAll();
          tagReq.onsuccess = () => {
            const existing = tagReq.result || [];
            const tagMap = new Map(existing.map(t => [t.name, t]));
            for (const [name, delta] of tagDelta) {
              if (delta === 0) continue;
              let tag = tagMap.get(name);
              if (!tag) {
                if (delta <= 0) continue; // 新标签且 delta 非正：跳过
                tag = { id: makeLocalId(), user_id: uid, name, count: 0 };
                tagMap.set(name, tag);
              }
              tag.count = Math.max(0, (tag.count || 0) + delta);
              if (tag.count === 0 && tag.id != null) {
                tagsStore.delete(tag.id);
              } else {
                tagsStore.put(tag);
              }
              if (isLoggedIn()) {
                tx.objectStore('sync_queue').put({
                  localId: 'tag_' + name,
                  action: 'updateTag',
                  tagName: name,
                  count: tag.count,
                });
              }
            }
            if (isLoggedIn()) {
              tx.objectStore('sync_queue').put({
                localId: noteId,
                action: 'update',
                data: { ...updated },
              });
            }
          };
        } else if (isLoggedIn()) {
          tx.objectStore('sync_queue').put({
            localId: noteId,
            action: 'update',
            data: { ...updated },
          });
        }
      };

        tx.oncomplete = () => {
          if (isLoggedIn() && noteFound) syncToCloud();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('updateNote tx aborted'));
      });
    } catch (err) {
      // SDB-3: tx.abort() 触发 AbortError；跨用户拒绝时静默返回 false
      if (crossUserReject) return false;
      throw err;
    }

    return noteFound;
  }

  // SDB-7: 单事务包 notes + tags + sync_queue
  // SDB-8: 等待 syncFromCloud 完成
  async function deleteNote(noteId) {
    if (syncFromCloudPromise) await syncFromCloudPromise;
    const uid = getCurrentUserId();
    let noteFound = false;
    let crossUserReject = false;

    try {
      await new Promise((resolve, reject) => {
        const stores = isLoggedIn() ? ['notes', 'tags', 'sync_queue'] : ['notes', 'tags'];
        const tx = idbDb.transaction(stores, 'readwrite');
        const notesStore = tx.objectStore('notes');
        const tagsStore = tx.objectStore('tags');

      const getReq = notesStore.get(noteId);
      getReq.onsuccess = () => {
        const note = getReq.result;
        if (!note) return;
        // SDB-3: 跨用户安全
        if (uid != null && note.user_id !== uid) {
          console.warn(`[security] deleteNote ${noteId} belongs to user ${note.user_id}, not current user ${uid}; aborting`);
          crossUserReject = true;
          tx.abort();
          return;
        }
        noteFound = true;

        const oldTags = normalizeTags(note.tags);
        notesStore.delete(noteId);

        if (oldTags.length > 0) {
          const tagReq = uid
            ? tagsStore.index('user_id').getAll(IDBKeyRange.only(uid))
            : tagsStore.getAll();
          tagReq.onsuccess = () => {
            const existing = tagReq.result || [];
            const tagMap = new Map(existing.map(t => [t.name, t]));
            for (const name of oldTags) {
              const tag = tagMap.get(name);
              if (!tag) continue;
              tag.count = Math.max(0, (tag.count || 0) - 1);
              if (tag.count === 0 && tag.id != null) {
                tagsStore.delete(tag.id);
              } else {
                tagsStore.put(tag);
              }
              if (isLoggedIn()) {
                tx.objectStore('sync_queue').put({
                  localId: 'tag_' + name,
                  action: 'updateTag',
                  tagName: name,
                  count: tag.count,
                });
              }
            }
            if (isLoggedIn()) {
              tx.objectStore('sync_queue').put({
                localId: noteId,
                action: 'delete',
              });
            }
          };
        } else if (isLoggedIn()) {
          tx.objectStore('sync_queue').put({
            localId: noteId,
            action: 'delete',
          });
        }
      };

        tx.oncomplete = () => {
          if (isLoggedIn() && noteFound) syncToCloud();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('deleteNote tx aborted'));
      });
    } catch (err) {
      if (crossUserReject) return false;
      throw err;
    }

    return noteFound;
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

  // E 修复：读改写包进单事务，避免并发场景下计数丢失
  // D 修复：新建 tag 用 makeLocalId，避免多个新 tag 同 ms 撞 ID
  async function updateTagCount(tagName, delta, userId) {
    const uid = userId || getCurrentUserId();
    return new Promise((resolve, reject) => {
      const stores = isLoggedIn() ? ['tags', 'sync_queue'] : ['tags'];
      const tx = idbDb.transaction(stores, 'readwrite');
      const tagStore = tx.objectStore('tags');

      let req;
      if (uid) {
        req = tagStore.index('user_id').getAll(IDBKeyRange.only(uid));
      } else {
        req = tagStore.getAll();
      }
      req.onsuccess = () => {
        const tags = req.result || [];
        let tag = tags.find(t => t.name === tagName);
        if (delta > 0 && !tag) {
          tag = { id: makeLocalId(), user_id: uid, name: tagName, count: 0 };
        }
        if (tag) {
          tag.count = Math.max(0, tag.count + delta);
          // 孤儿清理：count→0 时删除标签，不留空壳
          if (tag.count === 0 && tag.id != null) {
            tagStore.delete(tag.id);
          } else {
            tagStore.put(tag);
          }
          if (isLoggedIn()) {
            tx.objectStore('sync_queue').put({
              localId: 'tag_' + tagName,
              action: 'updateTag',
              tagName,
              count: tag.count, // count=0 → syncToCloud 处理为云端删除
            });
          }
        }
      };
      tx.oncomplete = () => {
        if (isLoggedIn()) syncToCloud();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // 重建当前用户的 tag 表（基于 notes.tags 真值）
  // 用途：syncFromCloud 后调一次，自动剔除 URL 污染产生的旧 tag、count=0 的孤儿 tag
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

    // 单事务：删当前用户旧 tags + 写新 tags（避免误清其他账号缓存）
    const result = [];
    await new Promise((resolve, reject) => {
      const tx = idbDb.transaction('tags', 'readwrite');
      const store = tx.objectStore('tags');
      let deletePhaseDone = false;

      const onDeleteDone = () => {
        if (deletePhaseDone) return;
        deletePhaseDone = true;
        for (const [name, count] of Object.entries(tagCountMap)) {
          const tag = { id: makeLocalId(), user_id: uid, name, count };
          store.put(tag);
          result.push(tag);
        }
      };

      if (uid) {
        const idx = store.index('user_id');
        const delReq = idx.openCursor(IDBKeyRange.only(uid));
        delReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
          else { onDeleteDone(); }
        };
      } else {
        // 未登录/本地模式：清整张 tags 表（旧行为兼容）
        store.clear();
        onDeleteDone();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
    getLastSyncError,
    getAllNotesForExport,
    getAllTagsForExport,
    saveDb,
    markDirty,
  };
})();

window.DB = DB;
