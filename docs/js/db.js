/**
 * db.js - 数据库层
 * sql.js 初始化 + IndexedDB 持久化 + 所有 CRUD 操作
 *
 * 存储架构：sql.js (WASM) 运行在内存，整个 .db 二进制通过 IndexedDB 持久化
 * IndexedDB 无 5MB 限制，可容纳大量笔记
 *
 * ============================================================
 * Interface Contract (与 db-supabase.js 对齐，2026-05-16)
 * ============================================================
 * 所有公共方法 async；字段命名 snake_case；标签字段恒为数组。
 *
 *   async init(): db
 *   async addNote({ content, tags: string[],
 *                   image_paths?: string|string[], image_data?: string|string[],
 *                   type?, is_done?: boolean|0|1,
 *                   created_at?, updated_at?, skipSave? }): note
 *   async addNotesBatch(notes[], opts?): note[]
 *   async getNotes({ pageCurrent=1, pageSize=50, tag?, search?, date? }): { data, total, hasMore }
 *   async getNoteById(id): note | null
 *   async updateNote(id, { content, tags, image_paths?, image_data?, is_done? }): boolean
 *   async deleteNote(id): boolean
 *   async getNoteCount({ tag?, search? }): number
 *   async getTags(): { name, count }[]
 *   async getRandomNotes(count): note[]
 *
 * 兼容：传入 imagePaths/imageData/isDone (camelCase) 仍接受，会一次性
 * console.warn 提示 deprecation，并自动映射为 snake_case。
 * ============================================================
 */

const DB = (() => {
  // 一次性 deprecation warning（每个 key 只 warn 一次/会话）
  const _deprecationWarned = new Set();
  function warnDeprecatedField(oldKey, newKey) {
    if (_deprecationWarned.has(oldKey)) return;
    _deprecationWarned.add(oldKey);
    console.warn(`[DB] deprecated field "${oldKey}" → 请改用 "${newKey}"（与 db-supabase.js 对齐）`);
  }

  /**
   * 接受 camelCase 兼容输入并映射到 snake_case
   * 用于 addNote / updateNote 等公共入口
   */
  function compatFieldNames(opts) {
    if (!opts || typeof opts !== 'object') return opts || {};
    const out = { ...opts };
    if (out.imagePaths !== undefined && out.image_paths === undefined) {
      warnDeprecatedField('imagePaths', 'image_paths');
      out.image_paths = out.imagePaths;
    }
    if (out.imageData !== undefined && out.image_data === undefined) {
      warnDeprecatedField('imageData', 'image_data');
      out.image_data = out.imageData;
    }
    if (out.isDone !== undefined && out.is_done === undefined) {
      warnDeprecatedField('isDone', 'is_done');
      out.is_done = out.isDone;
    }
    if (out.createdAt !== undefined && out.created_at === undefined) {
      warnDeprecatedField('createdAt', 'created_at');
      out.created_at = out.createdAt;
    }
    if (out.updatedAt !== undefined && out.updated_at === undefined) {
      warnDeprecatedField('updatedAt', 'updated_at');
      out.updated_at = out.updatedAt;
    }
    return out;
  }

  /**
   * image_paths / image_data 字段值归一化为字符串（SQLite 列存逗号分隔）
   * 接受 string | string[] | null/undefined
   */
  function imageFieldToString(val) {
    if (val == null) return '';
    if (Array.isArray(val)) return val.filter(Boolean).join(',');
    return String(val);
  }

  let db = null;
  const IDB_NAME = 'noteflow';
  const IDB_STORE = 'databases';
  const IDB_VERSION = 1;
  const CURRENT_USER_KEY = 'noteflow_current_user';
  const AUTO_SAVE_INTERVAL = 30000; // 30秒自动保存
  let autoSaveTimer = null;
  let dirty = false; // 脏标记，减少无意义保存
  let dirtyVersion = 0;     // 单调递增版本号，每次 markDirty 自增
  let lastSavedVersion = 0; // 最近一次成功持久化的版本号

  // SQLite 事务封装：保证 BEGIN..COMMIT/ROLLBACK 原子性
  // sql.js 同步执行，fn 必须是同步函数（不要 await）
  function withTransaction(fn) {
    if (!db) throw new Error('db not initialized');
    db.run('BEGIN');
    try {
      const result = fn();
      db.run('COMMIT');
      return result;
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (_) {}
      throw e;
    }
  }

  // ==================== IndexedDB 工具 ====================

  /**
   * 打开 IndexedDB
   */
  function openIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(IDB_STORE)) {
          idb.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 从 IndexedDB 读取数据
   */
  async function idbGet(key) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 写入 IndexedDB
   */
  async function idbSet(key, value) {
    const idb = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ==================== 初始化 ====================

  /**
   * 初始化 sql.js 和数据库
   */
  async function init() {
    const SQL = await initSqlJs({
      locateFile: file => `https://sql.js.org/dist/${file}`
    });

    const userId = getCurrentUserId();

    // 尝试从 IndexedDB 加载已有数据库
    let loaded = false;
    try {
      const savedBuf = await idbGet('user_' + userId);
      if (savedBuf) {
        db = new SQL.Database(new Uint8Array(savedBuf));
        loaded = true;
      }
    } catch (e) {
      console.warn('IndexedDB 加载失败，尝试 localStorage 兼容:', e);
    }

    // 兼容旧版：尝试从 localStorage 迁移
    if (!loaded) {
      const oldKey = 'noteflow_db_' + userId;
      const savedDb = localStorage.getItem(oldKey);
      if (savedDb) {
        try {
          const buf = new Uint8Array(JSON.parse(savedDb));
          db = new SQL.Database(buf);
          loaded = true;
          // 迁移到 IndexedDB，删除旧数据
          await saveDb();
          localStorage.removeItem(oldKey);
          console.log('已从 localStorage 迁移到 IndexedDB');
        } catch (e) {
          console.warn('localStorage 数据迁移失败:', e);
        }
      }
    }

    // 尝试从预填充的 .db 文件加载（首次部署时用）
    if (!loaded) {
      try {
        const resp = await fetch('data/noteflow_user1.db');
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          db = new SQL.Database(new Uint8Array(buf));
          loaded = true;
          await saveDb();
          console.log('已从预填充数据库加载');
        }
      } catch (e) {
        // 没有预填充文件，正常流程
      }
    }

    if (!loaded) {
      db = new SQL.Database();
    }

    createTables();
    ensureDefaultUsers();
    startAutoSave();

    return db;
  }

  /**
   * 创建数据库表
   */
  function createTables() {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        avatar TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '',
        image_paths TEXT DEFAULT '',
        image_data TEXT DEFAULT '',
        type TEXT DEFAULT 'note',
        is_done INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        UNIQUE(user_id, name),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  }

  /**
   * 确保默认用户存在
   */
  function ensureDefaultUsers() {
    const users = getUsers();
    if (users.length === 0) {
      db.run("INSERT INTO users (name, avatar) VALUES (?, ?)", ['用户一', '👤']);
      db.run("INSERT INTO users (name, avatar) VALUES (?, ?)", ['用户二', '👩']);
      markDirty();
    }
  }

  // ==================== 用户操作 ====================

  function getCurrentUserId() {
    return parseInt(localStorage.getItem(CURRENT_USER_KEY) || '1');
  }

  function setCurrentUserId(userId) {
    localStorage.setItem(CURRENT_USER_KEY, String(userId));
  }

  function getUsers() {
    const result = db.exec("SELECT * FROM users ORDER BY id");
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0],
      name: row[1],
      avatar: row[2],
      created_at: row[3]
    }));
  }

  function getUserById(userId) {
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    stmt.bind([userId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  // ==================== 工具函数 ====================

  /**
   * 标签格式归一化：接受数组或逗号字符串，统一返回数组
   */
  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string' && tags.trim()) {
      // 先尝试 JSON.parse（兼容 db-supabase 旧导出的 JSON 字符串，与 db-supabase.normalizeTags 对齐）
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) return parsed.map(t => String(t).trim()).filter(Boolean);
      } catch (_) { /* fall through to comma split */ }
      return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
  }

  /**
   * 标签数组 → 逗号字符串（用于 SQLite 存储）
   */
  function tagsToString(tags) {
    const arr = normalizeTags(tags);
    return arr.join(',');
  }

  /**
   * 笔记对象 tags 字段归一化：逗号字符串 → 数组
   */
  function normalizeNoteTags(note) {
    if (!note) return note;
    if (note.tags != null) {
      note.tags = normalizeTags(note.tags);
    }
    return note;
  }

  // ==================== 笔记操作 ====================

  /**
   * 添加笔记
   * SDB-4: snake_case 字段（image_paths/image_data/is_done/created_at/updated_at），
   *        camelCase 同名字段一次性 deprecation warn 后向下兼容。
   *        返回新建的 note 对象（与 db-supabase.js 对齐）。
   */
  async function addNote(options) {
    const opts = compatFieldNames(options);
    const {
      content,
      tags = [],
      image_paths = '',
      image_data = '',
      created_at = null,
      updated_at = null,
      type = 'note',
      is_done = 0,
      skipSave = false,
    } = opts;

    const userId = getCurrentUserId();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const ca = created_at || now;
    const ua = updated_at || now;
    const tagsStr = tagsToString(tags);
    const imagePathsStr = imageFieldToString(image_paths);
    const imageDataStr = imageFieldToString(image_data);
    const isDoneInt = is_done ? 1 : 0;

    // SDB-6: 单事务包 INSERT + 标签计数更新
    const newId = withTransaction(() => {
      db.run(
        "INSERT INTO notes (user_id, content, tags, image_paths, image_data, type, is_done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, content, tagsStr, imagePathsStr, imageDataStr, type, isDoneInt, ca, ua]
      );

      // 更新标签（已在事务内，updateTagCount 自带事务时是 no-op 嵌套？此处 updateTagCount 自包事务，
      // 但 sql.js BEGIN 嵌套会报错。为避免嵌套事务，这里直接走内联标签更新。）
      normalizeTags(tags).forEach(tag => {
        updateTagCountInline(tag, 1);
      });

      return db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    });

    markDirty();
    if (!skipSave) {
      // SDB-5: 等待并向上传播保存错误
      await saveDb();
    }

    // SDB-4: 返回新 note 对象（与 db-supabase.addNote 对齐）
    return getNoteByIdSync(newId);
  }

  /**
   * 批量添加笔记（导入用，跳过逐条保存）
   * SDB-4: 返回成功导入的 note 对象数组（与 db-supabase.addNotesBatch 对齐）。
   *        调用方需要计数时用 result.length。
   * @param {Array} notes - [{content, tags, image_paths?, image_data?, created_at?, updated_at?}]
   * @param {Object} [opts] - 兼容 db-supabase.addNotesBatch 第二参（这里实际无视）
   * @returns {Promise<Array>} 成功导入的 note 对象数组
   */
  async function addNotesBatch(notes, opts = {}) { // eslint-disable-line no-unused-vars
    const inserted = [];
    for (const note of notes) {
      if (!note.content || note.content.length < 1) continue;
      try {
        const compat = compatFieldNames(note);
        const created = await addNote({
          content: compat.content,
          tags: compat.tags || [],
          image_paths: compat.image_paths || '',
          image_data: compat.image_data || '',
          created_at: compat.created_at || null,
          updated_at: compat.updated_at || null,
          skipSave: true,
        });
        if (created) inserted.push(created);
      } catch (e) {
        console.error('批量导入单条失败:', e);
      }
    }
    // 批量结束后统一保存
    if (inserted.length > 0) {
      markDirty();
      await saveDb();
    }
    return inserted;
  }

  /**
   * 获取笔记列表
   * SDB-4: async + pageCurrent 默认 1（与 db-supabase.getNotes 对齐）
   * 返回 { data, total, hasMore }
   */
  async function getNotes(options = {}) {
    return getNotesSync(options);
  }

  /**
   * 同步实现（内部用，比如 exportAsJSON / getAllNotes）
   * 兼容 pageCurrent（从1开始）和 page（从0开始，旧字段）
   */
  function getNotesSync(options = {}) {
    const pageCurrent = options.pageCurrent != null ? options.pageCurrent : 1;
    const page = options.page != null ? options.page : Math.max(0, pageCurrent - 1);
    const { pageSize = 50, tag = '', search = '', date = '' } = options;
    const userId = getCurrentUserId();

    let sql = "SELECT * FROM notes WHERE user_id = ?";
    const params = [userId];

    if (tag) {
      // tags 字段格式："tag1,tag2,tag3"（无首尾逗号）
      // 用 ',' || tags || ',' 包裹后匹配，覆盖所有位置
      sql += " AND (',' || tags || ',' LIKE '%,' || ? || ',%' OR tags = ?)";
      params.push(tag, tag);
    }

    if (search) {
      const keywords = search.trim().split(/\s+/);
      keywords.forEach(kw => {
        sql += " AND (content LIKE ? OR tags LIKE ?)";
        params.push(`%${kw}%`, `%${kw}%`);
      });
    }

    if (date) {
      sql += " AND created_at LIKE ?";
      params.push(`${date}%`);
    }

    // 先算总数
    const countStmt = db.prepare(sql.replace(/SELECT \* FROM/, 'SELECT COUNT(*) as cnt FROM'));
    countStmt.bind(params);
    let total = 0;
    if (countStmt.step()) {
      total = countStmt.getAsObject().cnt;
    }
    countStmt.free();

    // 再取分页数据
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(pageSize, page * pageSize);

    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      normalizeNoteTags(row);
      results.push(row);
    }
    stmt.free();

    return {
      data: results,
      total,
      hasMore: (page * pageSize + results.length) < total,
    };
  }

  /**
   * 获取笔记总数
   * SDB-4: async（与 db-supabase 对齐）
   */
  async function getNoteCount(options = {}) {
    const { tag = '', search = '' } = options;
    const userId = getCurrentUserId();

    let sql = "SELECT COUNT(*) as cnt FROM notes WHERE user_id = ?";
    const params = [userId];

    if (tag) {
      // tags 字段格式："tag1,tag2,tag3"（无首尾逗号）
      // 用 ',' || tags || ',' 包裹后匹配，覆盖所有位置
      sql += " AND (',' || tags || ',' LIKE '%,' || ? || ',%' OR tags = ?)";
      params.push(tag, tag);
    }

    if (search) {
      const keywords = search.trim().split(/\s+/);
      keywords.forEach(kw => {
        sql += " AND (content LIKE ? OR tags LIKE ?)";
        params.push(`%${kw}%`, `%${kw}%`);
      });
    }

    const stmt = db.prepare(sql);
    stmt.bind(params);
    let count = 0;
    if (stmt.step()) {
      count = stmt.getAsObject().cnt;
    }
    stmt.free();
    return count;
  }

  /**
   * 获取单条笔记（async，与 db-supabase.js 接口一致）
   */
  async function getNoteById(id) {
    return getNoteByIdSync(id);
  }

  /**
   * 获取单条笔记（同步版本，供内部 updateNote/deleteNote 使用）
   */
  function getNoteByIdSync(id) {
    const stmt = db.prepare("SELECT * FROM notes WHERE id = ?");
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return normalizeNoteTags(row);
    }
    stmt.free();
    return null;
  }

  /**
   * 更新笔记（tags 接受数组或逗号字符串）
   * SDB-5/SDB-6: async + 单事务 + 错误传播
   * SDB-4: snake_case 字段（image_paths/image_data/is_done），camelCase 兼容；
   *        返回 boolean（与 db-supabase.updateNote 对齐：note 不存在返回 false）
   */
  async function updateNote(id, updates) {
    const opts = compatFieldNames(updates || {});
    const {
      content,
      tags = [],
      image_paths = '',
      image_data = '',
    } = opts;

    const tagsArr = normalizeTags(tags);
    const tagsStr = tagsToString(tags);
    const imagePathsStr = imageFieldToString(image_paths);
    const imageDataStr = imageFieldToString(image_data);

    let noteFound = false;
    withTransaction(() => {
      const oldNote = getNoteByIdSync(id);
      if (!oldNote) return;
      noteFound = true;

      normalizeTags(oldNote.tags).forEach(tag => {
        updateTagCountInline(tag, -1);
      });

      db.run(
        "UPDATE notes SET content = ?, tags = ?, image_paths = ?, image_data = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        [content, tagsStr, imagePathsStr, imageDataStr, id]
      );

      tagsArr.forEach(tag => {
        updateTagCountInline(tag, 1);
      });
    });

    if (noteFound) {
      markDirty();
      await saveDb();
    }
    return noteFound;
  }

  /**
   * 删除笔记
   * SDB-5/SDB-6: async + 单事务 + 错误传播
   * SDB-4: 返回 boolean（与 db-supabase.deleteNote 对齐：note 不存在返回 false）
   */
  async function deleteNote(id) {
    let noteFound = false;
    withTransaction(() => {
      const note = getNoteByIdSync(id);
      if (!note) return;
      noteFound = true;

      normalizeTags(note.tags).forEach(tag => {
        updateTagCountInline(tag, -1);
      });

      db.run("DELETE FROM notes WHERE id = ?", [id]);
    });

    if (noteFound) {
      markDirty();
      await saveDb();
    }
    return noteFound;
  }

  // ==================== 标签操作 ====================

  /**
   * 内部使用：更新标签计数的纯 SQL 操作（不开事务，供已在事务内的代码调用）
   */
  function updateTagCountInline(tagName, delta) {
    const userId = getCurrentUserId();

    // 用 prepare 查询
    const stmt = db.prepare("SELECT id, count FROM tags WHERE user_id = ? AND name = ?");
    stmt.bind([userId, tagName]);

    let tagId = null;
    let currentCount = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      tagId = row.id;
      currentCount = row.count;
    }
    stmt.free();

    if (tagId !== null) {
      const newCount = currentCount + delta;
      if (newCount <= 0) {
        db.run("DELETE FROM tags WHERE id = ?", [tagId]);
      } else {
        db.run("UPDATE tags SET count = ? WHERE id = ?", [newCount, tagId]);
      }
    } else if (delta > 0) {
      db.run("INSERT INTO tags (user_id, name, count) VALUES (?, ?, ?)", [userId, tagName, delta]);
    }
  }

  /**
   * 更新标签计数（公共 API：单独调用时自带事务原子性）
   * SDB-6: 用 withTransaction 包住读改写，避免并发场景下计数丢失
   */
  function updateTagCount(tagName, delta) {
    return withTransaction(() => updateTagCountInline(tagName, delta));
  }

  /**
   * 获取标签列表
   * SDB-4: async（与 db-supabase.getTags 对齐）
   */
  async function getTags() {
    const userId = getCurrentUserId();
    const stmt = db.prepare("SELECT name, count FROM tags WHERE user_id = ? ORDER BY count DESC, name ASC");
    stmt.bind([userId]);
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({ name: row.name, count: row.count });
    }
    stmt.free();
    return results;
  }

  /**
   * 随机获取 N 条笔记（每日回顾用）
   * SDB-4: async（与 db-supabase.getRandomNotes 对齐）
   */
  async function getRandomNotes(count) {
    const userId = getCurrentUserId();
    const stmt = db.prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY RANDOM() LIMIT ?");
    stmt.bind([userId, count]);
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      normalizeNoteTags(row);
      results.push(row);
    }
    stmt.free();
    return results;
  }

  // ==================== 数据库持久化 ====================

  // SDB-5: dirtyVersion 单调递增，防止 saveDb 期间并发 markDirty 被覆盖丢失
  function markDirty() {
    dirty = true;
    dirtyVersion++;
  }

  /**
   * 保存数据库到 IndexedDB
   * SDB-5: 失败时抛错向上传播，便于调用方 toast；并发 markDirty 不会被错误清掉 dirty 标志
   */
  async function saveDb() {
    if (!dirty || !db) return true;
    const myVersion = dirtyVersion;
    try {
      const userId = getCurrentUserId();
      const data = db.export();
      await idbSet('user_' + userId, data);
      // 仅当本次保存期间无新增 markDirty 才清 dirty 标志
      if (myVersion === dirtyVersion) {
        dirty = false;
      }
      lastSavedVersion = myVersion;
      return true;
    } catch (e) {
      console.error('数据库保存失败:', e);
      throw e; // 向上传播，调用方决定 toast / 重试
    }
  }

  /**
   * 获取当前数据库大小（估算，单位：KB）
   */
  function getDbSize() {
    try {
      const data = db.export();
      return Math.round(data.length / 1024);
    } catch (e) {
      return 0;
    }
  }

  /**
   * 启动自动保存
   */
  function startAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
      if (dirty) saveDb().catch(e => console.error('[db] auto save failed:', e));
    }, AUTO_SAVE_INTERVAL);
  }

  /**
   * 切换用户数据库
   */
  async function switchUserDb(targetUserId) {
    // 1. 保存当前用户数据库
    await saveDb();

    // 2. 切换用户ID
    setCurrentUserId(targetUserId);

    // 3. 加载目标用户数据库
    try {
      const savedBuf = await idbGet('user_' + targetUserId);
      if (savedBuf) {
        db = new SQL.Database(new Uint8Array(savedBuf));
      } else {
        db = new SQL.Database();
      }
    } catch (e) {
      console.warn('加载用户数据库失败，创建新数据库:', e);
      db = new SQL.Database();
    }

    createTables();
    ensureDefaultUsers();
    dirty = false;
  }

  // ==================== 导出操作 ====================

  function exportAsSQLite() {
    return db.export();
  }

  // SDB-4: getNotes/getTags 已改 async，导出函数顺势 async（向后兼容：原本无外部 await 也能正常工作，因为 sql.js 同步）
  async function exportAsJSON() {
    const userId = getCurrentUserId();
    // 内部用 sync 实现，保留原始行为
    const result = getNotesSync({ page: 0, pageSize: 999999 });
    const tags = await getTags();

    return JSON.stringify({
      version: '1.0',
      exported_at: new Date().toISOString(),
      user_id: userId,
      notes: result.data,
      tags
    }, null, 2);
  }

  async function getAllNotes() {
    return getNotesSync({ page: 0, pageSize: 999999 });
  }

  // ==================== 公开接口 ====================

  return {
    init,
    getDb: () => db,
    // 用户
    getCurrentUserId,
    setCurrentUserId,
    getUsers,
    getUserById,
    switchUserDb,
    // 笔记
    addNote,
    addNotesBatch,
    getNotes,
    getNoteCount,
    getNoteById,
    updateNote,
    deleteNote,
    // 标签
    getTags,
    getRandomNotes,
    // 数据库信息
    saveDb,
    getDbSize,
    markDirty,
    // 导出
    exportAsSQLite,
    exportAsJSON,
    getAllNotes
  };
})();
