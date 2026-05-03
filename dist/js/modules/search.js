/**
 * search.js - 全文搜索模块
 */

const SearchModule = (() => {

  let debounceTimer = null;
  const DEBOUNCE_DELAY = 300;

  /**
   * 初始化搜索框
   */
  function init(vm) {
    const input = document.getElementById('search-input');
    if (!input) return;

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
