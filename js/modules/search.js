/**
 * search.js - 全文搜索模块
 */

const SearchModule = (() => {

  let debounceTimer = null;
  const DEBOUNCE_DELAY = 300;

  /**
   * 初始化搜索框（幂等）
   * Vue v-else 重渲染时 search-input 是新 DOM 节点，旧标记丢失，新节点会重新绑定
   */
  function init(vm) {
    const input = document.getElementById('search-input');
    if (!input || input._searchBound) return;
    input._searchBound = true;

    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const keyword = e.target.value.trim();
        if (vm && vm.setSearch) vm.setSearch(keyword);
      }, DEBOUNCE_DELAY);
    });

    // Escape 清空搜索
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        if (vm && vm.setSearch) vm.setSearch('');
        input.blur();
      }
    });
  }

  /**
   * 清空搜索
   */
  function clearSearch() {
    clearTimeout(debounceTimer);
    const input = document.getElementById('search-input');
    if (input) {
      input.value = '';
    }
  }

  return {
    init,
    clearSearch
  };
})();
