/**
 * user.js - 用户模块（Supabase 版本）
 * 显示当前用户信息，不再需要多用户切换
 */

const UserModule = (() => {

  /**
   * 渲染用户区域
   */
  function renderUserSwitcher(users, currentUserId) {
    const container = document.getElementById('user-switcher');
    if (!container) return;

    const user = users.find(u => u.id === currentUserId);
    const displayName = user ? (user.email || user.name || '本地用户') : '本地用户';

    container.innerHTML = `
      <span class="user-name">${escapeHtml(displayName)}</span>
    `;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    renderUserSwitcher,
  };
})();
