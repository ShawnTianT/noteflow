/**
 * tags.js - 标签侧边栏 + 层级树形展示 + 筛选 + 置顶
 *
 * 标签以 / 分隔层级，如 area's/跑步 → 一级 area's，二级 跑步
 * 一级标签可展开/折叠，显示下属二级标签及汇总计数
 * 二级标签缩进显示，点击精确筛选
 * 置顶标签固定在列表最前，右键或长按可置顶/取消置顶
 */

const TagsModule = (() => {

  // 展开状态记忆
  const expandedTags = new Set();

  const PINNED_KEY_PREFIX = 'noteflow_pinned_tags_';

  /**
   * 获取当前用户的置顶标签列表（NF-7: 无登录态时返回空，避免污染共享 key）
   */
  function getPinnedTags() {
    const userId = DB.getCurrentUserId();
    if (!userId) return [];
    try {
      const data = localStorage.getItem(PINNED_KEY_PREFIX + userId);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 保存置顶标签列表（NF-7: 无登录态时不写，写失败不抛）
   */
  function savePinnedTags(pinnedList) {
    const userId = DB.getCurrentUserId();
    if (!userId) return;
    try {
      localStorage.setItem(PINNED_KEY_PREFIX + userId, JSON.stringify(pinnedList));
    } catch (e) {
      console.warn('[TagsModule] savePinnedTags failed:', e?.message || e);
    }
  }

  /**
   * 切换标签置顶状态
   */
  function togglePin(tagName) {
    const pinned = getPinnedTags();
    const idx = pinned.indexOf(tagName);
    if (idx >= 0) {
      pinned.splice(idx, 1);
    } else {
      pinned.push(tagName);
    }
    savePinnedTags(pinned);
  }

  /**
   * 渲染标签列表（树形层级 + 置顶排序）
   */
  function renderTags(tags, activeTag) {
    const container = document.getElementById('tags-list');
    if (!container) return;

    if (tags.length === 0) {
      container.innerHTML = `
        <div class="tags-empty">
          <p>暂无标签</p>
          <p class="tags-hint">在笔记中使用 #标签 添加</p>
        </div>
      `;
      return;
    }

    // 解析标签层级结构
    const tree = buildTagTree(tags);

    // 置顶排序：置顶的一级标签排最前
    const pinned = getPinnedTags();
    tree.sort((a, b) => {
      const aPin = pinned.includes(a.name) ? 0 : 1;
      const bPin = pinned.includes(b.name) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      return b.count - a.count;
    });

    // 全部标签按钮
    let html = `
      <div class="tag-item ${!activeTag ? 'active' : ''}" data-tag="">
        <span class="tag-name">全部</span>
      </div>
    `;

    // 渲染树形标签（置顶与普通之间加分隔线）
    let hasRenderedPinnedDivider = false;
    tree.forEach(node => {
      const isPinned = pinned.includes(node.name);
      // 如果已渲染过非置顶标签，当前是置顶标签，不需要分隔线
      // 如果已渲染过置顶标签，当前是第一个非置顶标签，加分隔线
      if (!isPinned && !hasRenderedPinnedDivider && pinned.length > 0) {
        html += `<div class="tag-divider"></div>`;
        hasRenderedPinnedDivider = true;
      }
      html += renderTagNode(node, activeTag, pinned);
    });

    container.innerHTML = html;

    // 绑定事件委托
    container.onclick = handleTagClick;
    // 绑定右键置顶
    container.oncontextmenu = handleTagContext;
  }

  /**
   * 构建标签树（P3 + NF-6: 引用 + 内容签名双重缓存）
   * 原方案只比 tagsRef + length，同引用下原地改 tag.count（add 已有 tag）不会失效。
   * NF-6: 加入 name:count join 内容签名比对，count 变化即失效。
   */
  let _treeCache = { tagsRef: null, sig: null, tree: null };
  function buildTagTree(tags) {
    // 轻量签名：name:count 拼接，长度变化与 count 变化都会破坏签名
    let sig = '';
    for (let i = 0; i < tags.length; i++) {
      sig += tags[i].name + ':' + tags[i].count + '|';
    }
    if (_treeCache.tagsRef === tags && _treeCache.sig === sig && _treeCache.tree) {
      return _treeCache.tree;
    }
    const rootMap = new Map();

    tags.forEach(tag => {
      const slashIdx = tag.name.indexOf('/');
      if (slashIdx > 0) {
        const parentName = tag.name.slice(0, slashIdx);
        if (!rootMap.has(parentName)) {
          rootMap.set(parentName, { name: parentName, count: 0, children: [] });
        }
        const parentNode = rootMap.get(parentName);
        parentNode.count += tag.count;
        parentNode.children.push(tag);
      } else {
        if (!rootMap.has(tag.name)) {
          rootMap.set(tag.name, { name: tag.name, count: 0, children: [] });
        }
        rootMap.get(tag.name).count += tag.count;
      }
    });

    const result = Array.from(rootMap.values());
    // 初始排序按 count 降序（后续 renderTags 会按置顶重新排序）
    result.sort((a, b) => b.count - a.count);

    result.forEach(node => {
      node.children.sort((a, b) => b.count - a.count);
    });

    _treeCache = { tagsRef: tags, sig: sig, tree: result };
    return result;
  }

  /**
   * 渲染单个标签节点（含子标签）
   */
  function renderTagNode(node, activeTag, pinned) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedTags.has(node.name);
    const isParentActive = activeTag === node.name;
    const isPinned = pinned && pinned.includes(node.name);

    // 一级标签
    let html = `<div class="tag-item tag-parent ${isParentActive ? 'active' : ''} ${isPinned ? 'pinned' : ''}" data-tag="${escapeAttr(node.name)}">`;
    if (hasChildren) {
      html += `<span class="tag-toggle ${isExpanded ? 'expanded' : ''}" data-toggle="${escapeAttr(node.name)}">▶</span>`;
    }
    html += `<span class="tag-name">#${escapeHtml(node.name)}</span>`;
    html += `<span class="tag-count">${node.count}</span>`;
    if (isPinned) {
      html += `<span class="tag-pin-icon" data-pin="${escapeAttr(node.name)}" title="取消置顶">📌</span>`;
    } else {
      html += `<span class="tag-pin-icon tag-pin-hidden" data-pin="${escapeAttr(node.name)}" title="置顶">📌</span>`;
    }
    html += `</div>`;

    // 二级标签（折叠状态）
    if (hasChildren) {
      html += `<div class="tag-children ${isExpanded ? 'expanded' : ''}" data-parent="${escapeAttr(node.name)}">`;
      node.children.forEach(child => {
        const isChildActive = activeTag === child.name;
        const displayName = child.name.slice(child.name.indexOf('/') + 1);
        html += `<div class="tag-item tag-child ${isChildActive ? 'active' : ''}" data-tag="${escapeAttr(child.name)}">`;
        html += `<span class="tag-name">#${escapeHtml(displayName)}</span>`;
        html += `<span class="tag-count">${child.count}</span>`;
        html += `</div>`;
      });
      html += `</div>`;
    }

    return html;
  }

  /**
   * 事件委托处理点击
   */
  function handleTagClick(e) {
    // 点击置顶图标
    const pinIcon = e.target.closest('.tag-pin-icon');
    if (pinIcon && pinIcon.dataset.pin) {
      e.stopPropagation();
      togglePin(pinIcon.dataset.pin);
      if (window.app) window.app.refreshTags();
      return;
    }

    // 点击展开/折叠按钮
    const toggle = e.target.closest('.tag-toggle');
    if (toggle) {
      const tagName = toggle.dataset.toggle;
      if (expandedTags.has(tagName)) {
        expandedTags.delete(tagName);
      } else {
        expandedTags.add(tagName);
      }
      if (window.app) window.app.refreshTags();
      return;
    }

    // 点击标签项
    const tagItem = e.target.closest('.tag-item');
    if (tagItem && tagItem.dataset.tag !== undefined) {
      const tagName = tagItem.dataset.tag;
      if (window.app) window.app.filterByTag(tagName);
    }
  }

  /**
   * 右键菜单：快速置顶/取消置顶
   */
  function handleTagContext(e) {
    const tagItem = e.target.closest('.tag-item');
    if (!tagItem || tagItem.dataset.tag === undefined || tagItem.dataset.tag === '') return;

    e.preventDefault();
    const tagName = tagItem.dataset.tag;
    togglePin(tagName);
    if (window.app) window.app.refreshTags();

    const pinned = getPinnedTags();
    const isPinned = pinned.includes(tagName);
    Editor.showToast(isPinned ? `📌 已置顶 #${tagName}` : `已取消置顶 #${tagName}`);
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
   * 属性值转义（用于 data-* 属性）
   */
  function escapeAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    renderTags
  };
})();
