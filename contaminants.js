const contaminantList = document.getElementById('contaminantList');
const searchInput = document.getElementById('searchInput');
const expandBtn = document.getElementById('expandBtn');
const nextBtn = document.getElementById('nextBtn');
const selectedPanel = document.querySelector('.selected-panel');
const selectedList = document.getElementById('selectedList');
const selectedCount = document.getElementById('selectedCount');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const sortSelect = document.getElementById('sortSelect');
const sortDirectionBtn = document.getElementById('sortDirectionBtn');
const quickAddBtn = document.getElementById('quickAddBtn');
const commandPalette = document.getElementById('commandPalette');
const paletteSearchInput = document.getElementById('paletteSearchInput');
const paletteResults = document.getElementById('paletteResults');

const SELECTED_PANEL_COLLAPSE_THRESHOLD = 5;
const MAX_PALETTE_RESULTS = 18;

let csrData = null;
let siteInfo = getStoredSiteInfo();
let categoryEntries = [];
let allContaminants = [];
let searchQuery = '';
let paletteQuery = '';
let selectedPanelExpanded = false;
let previousSelectedCount = 0;
let paletteIndex = 0;

const collapsedCategories = new Set();
const selectedIds = new Set();
const undoStack = [];
const redoStack = [];

function getSortState() {
  if (!sortSelect || !sortDirectionBtn) {
    return { type: 'category', direction: 'asc' };
  }

  const state = getAppState();
  return state.ui.contaminantsSort || { type: 'category', direction: 'asc' };
}

function saveSortState() {
  if (!sortSelect || !sortDirectionBtn) return;

  updateAppUi({
    contaminantsSort: {
      type: sortSelect.value,
      direction: sortDirectionBtn.dataset.direction || 'asc'
    }
  });
}

function restoreSortControls() {
  if (!sortSelect || !sortDirectionBtn) return;

  const sort = getSortState();
  sortSelect.value = sort.type || 'category';
  sortDirectionBtn.dataset.direction = sort.direction || 'asc';
  sortDirectionBtn.textContent = sortDirectionBtn.dataset.direction === 'desc' ? '↑' : '↓';
  sortDirectionBtn.setAttribute('aria-pressed', String(sortDirectionBtn.dataset.direction === 'desc'));
}

function restoreSelections(data) {
  getSelectedContaminants(data).forEach((contaminant) => {
    selectedIds.add(contaminant.id);
  });
}

function getDataIndex(contaminant) {
  return allContaminants.findIndex((item) => item.id === contaminant.id);
}

function getDefaultSortedContaminants(contaminants) {
  const sorted = [...contaminants];

  sorted.sort((a, b) => getDataIndex(a) - getDataIndex(b));

  return sorted;
}

function getCategoryContaminants(categoryName) {
  return getDefaultSortedContaminants(allContaminants.filter((contaminant) => contaminant.category === categoryName));
}

function getSelectedCategoryEntries() {
  const sort = getSortState();
  const entries = [...categoryEntries];

  if (sort.direction === 'desc') {
    entries.reverse();
  }

  return entries;
}

function getSelectedContaminantsInAddedOrder() {
  const contaminantsById = new Map(allContaminants.map((contaminant) => [contaminant.id, contaminant]));
  return [...selectedIds]
    .map((id) => contaminantsById.get(id))
    .filter(Boolean);
}

function getFlatSelectedContaminants() {
  const sort = getSortState();
  const contaminants = getSelectedContaminantsInAddedOrder();

  if (sort.type === 'alpha') {
    contaminants.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (sort.direction === 'desc') {
    contaminants.reverse();
  }

  return contaminants;
}

function getVisibleContaminants(contaminants) {
  if (!searchQuery) return contaminants;

  return contaminants.filter((contaminant) => {
    const haystack = `${contaminant.name} ${contaminant.cas} ${contaminant.category}`.toLowerCase();
    return haystack.includes(searchQuery);
  });
}

function isCategoryCollapsed(categoryName) {
  return collapsedCategories.has(categoryName) && !searchQuery;
}

function getSelectionSnapshot() {
  return [...selectedIds];
}

function setSelectionFromSnapshot(snapshot) {
  selectedIds.clear();
  snapshot.forEach((id) => selectedIds.add(id));
  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
}

function trackSelectionAction(type, before, after) {
  const beforeKey = before.join('|');
  const afterKey = after.join('|');
  if (beforeKey === afterKey) return;

  undoStack.push({ type, before, after });
  redoStack.length = 0;
}

function applySelectionChange(type, callback) {
  const before = getSelectionSnapshot();
  callback();
  const after = getSelectionSnapshot();
  trackSelectionAction(type, before, after);
  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
}

function toggleCategorySelection(categoryName) {
  applySelectionChange(`category:${categoryName}`, () => {
    const contaminants = getCategoryContaminants(categoryName);
    const allSelected = contaminants.every((contaminant) => selectedIds.has(contaminant.id));

    if (allSelected) {
      contaminants.forEach((contaminant) => selectedIds.delete(contaminant.id));
    } else {
      contaminants.forEach((contaminant) => selectedIds.add(contaminant.id));
    }
  });
}

function toggleContaminant(id) {
  applySelectionChange(`toggle:${id}`, () => {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
  });
}

function setContaminantSelected(id, isSelected) {
  applySelectionChange(`${isSelected ? 'add' : 'remove'}:${id}`, () => {
    if (isSelected) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
  });
}

function renderContaminants() {
  const markup = categoryEntries.map(([categoryName]) => {
    const categoryContaminants = getCategoryContaminants(categoryName);
    const visibleContaminants = getVisibleContaminants(categoryContaminants);

    if (searchQuery && visibleContaminants.length === 0) {
      return '';
    }

    const collapsed = isCategoryCollapsed(categoryName);
    const selectedInCategory = categoryContaminants.filter((contaminant) => selectedIds.has(contaminant.id)).length;
    const allSelected = categoryContaminants.length > 0 && selectedInCategory === categoryContaminants.length;

    const items = visibleContaminants.map((contaminant) => {
      const checked = selectedIds.has(contaminant.id) ? 'checked' : '';
      return `
        <div class="contaminant-item ${checked ? 'is-selected' : ''}" data-id="${escapeHtml(contaminant.id)}">
          <input type="checkbox" value="${escapeHtml(contaminant.id)}" data-id="${escapeHtml(contaminant.id)}" ${checked} aria-label="Select ${escapeHtml(contaminant.name)}">
          <span class="contaminant-copy">
            <button class="text-button contaminant-info-btn" type="button" data-action="info" data-id="${escapeHtml(contaminant.id)}">
              ${escapeHtml(contaminant.name)}
            </button>
            <span class="contaminant-description">${escapeHtml(contaminant.description)}</span>
            ${contaminant.cas !== 'NS' ? `<span class="cas">CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
          </span>
        </div>
      `;
    }).join('');

    return `
      <article class="contaminant-category" data-category="${escapeHtml(categoryName)}">
        <div class="category-header">
          <button class="category-toggle" type="button" data-action="toggle" data-category="${escapeHtml(categoryName)}" aria-expanded="${String(!collapsed)}">
            <img class="chevron" src="assets/icons/${collapsed ? 'chevron-down' : 'chevron-up'}.svg" alt="" aria-hidden="true">
            <span class="category-title">${escapeHtml(categoryName)}</span>
            <span class="category-total">(${categoryContaminants.length})</span>
          </button>
          <span class="category-count">${selectedInCategory ? `${selectedInCategory} selected` : ''}</span>
          <button class="select-all-btn" type="button" data-action="select-all" data-category="${escapeHtml(categoryName)}">${allSelected ? 'Deselect all' : 'Select all'}</button>
        </div>
        <div class="category-items ${collapsed ? '' : 'is-expanded'}">
          ${items}
        </div>
      </article>
    `;
  }).join('');

  contaminantList.innerHTML = markup || '<p class="empty-state">No contaminants match your search.</p>';
  renderSelectedPanel();
  updateExpandButton();
  renderPaletteResults();
}

function renderSelectedPanel() {
  const sort = getSortState();
  const selectedGroups = sort.type === 'category' ? getSelectedCategoryEntries()
    .map(([categoryName]) => ({
      categoryName,
      contaminants: getCategoryContaminants(categoryName).filter((contaminant) => selectedIds.has(contaminant.id)),
    }))
    .filter((group) => group.contaminants.length > 0) : [];
  const flatSelectedContaminants = sort.type === 'category' ? [] : getFlatSelectedContaminants();
  const selectedCountTotal = sort.type === 'category'
    ? selectedGroups.reduce((total, group) => total + group.contaminants.length, 0)
    : flatSelectedContaminants.length;
  const canCollapseSelectedPanel = selectedCountTotal > SELECTED_PANEL_COLLAPSE_THRESHOLD;

  if (!canCollapseSelectedPanel) {
    selectedPanelExpanded = false;
  } else if (previousSelectedCount <= SELECTED_PANEL_COLLAPSE_THRESHOLD) {
    selectedPanelExpanded = false;
  }

  const selectedPanelCollapsed = canCollapseSelectedPanel && !selectedPanelExpanded;

  selectedCount.textContent = selectedCountTotal ? `(${selectedCountTotal})` : '';
  clearSelectionBtn.hidden = selectedCountTotal === 0;
  nextBtn.disabled = selectedCountTotal === 0;
  selectedPanel.classList.toggle('is-collapsible', canCollapseSelectedPanel);
  selectedPanel.classList.toggle('is-collapsed', selectedPanelCollapsed);
  selectedPanel.setAttribute('aria-expanded', String(!selectedPanelCollapsed));
  selectedPanel.title = canCollapseSelectedPanel ? 'Click to expand or collapse selected contaminants' : '';
  previousSelectedCount = selectedCountTotal;

  if (!selectedCountTotal) {
    selectedList.innerHTML = '<p class="no-selection">No substances selected yet.<br>Check items from the list.</p>';
    return;
  }

  if (sort.type !== 'category') {
    selectedList.innerHTML = flatSelectedContaminants.map((contaminant) => `
      <div class="selected-tag">
        <span>
          <strong>${escapeHtml(contaminant.name)}</strong>
        </span>
        <button type="button" data-action="remove" data-id="${escapeHtml(contaminant.id)}" aria-label="Remove ${escapeHtml(contaminant.name)}">×</button>
      </div>
    `).join('');
    return;
  }

  selectedList.innerHTML = selectedGroups.map((group) => `
    <div class="selected-group">
      <div class="selected-group-title">${escapeHtml(group.categoryName)}</div>
      ${group.contaminants.map((contaminant) => `
        <div class="selected-tag">
          <span>
            <strong>${escapeHtml(contaminant.name)}</strong>
          </span>
          <button type="button" data-action="remove" data-id="${escapeHtml(contaminant.id)}" aria-label="Remove ${escapeHtml(contaminant.name)}">×</button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function updateExpandButton() {
  const allCollapsed = categoryEntries.every(([categoryName]) => collapsedCategories.has(categoryName));
  expandBtn.textContent = allCollapsed ? '+ Expand all' : '− Collapse all';
}

function toggleCategoryCollapsed(categoryName) {
  if (collapsedCategories.has(categoryName)) {
    collapsedCategories.delete(categoryName);
  } else {
    collapsedCategories.add(categoryName);
  }

  renderContaminants();
}

function openPalette() {
  commandPalette.classList.add('is-open');
  commandPalette.setAttribute('aria-hidden', 'false');
  paletteIndex = 0;
  paletteSearchInput.value = '';
  paletteQuery = '';
  renderPaletteResults();
  paletteSearchInput.focus();
}

function closePalette() {
  commandPalette.classList.remove('is-open');
  commandPalette.setAttribute('aria-hidden', 'true');
  quickAddBtn.focus();
}

function getPaletteMatches() {
  const query = normalizeText(paletteQuery);
  const sorted = getDefaultSortedContaminants(allContaminants);

  if (!query) {
    return sorted.slice(0, MAX_PALETTE_RESULTS);
  }

  return sorted.filter((contaminant) => {
    const exact = normalizeText(`${contaminant.name} ${contaminant.cas} ${contaminant.category}`);
    return exact.includes(query);
  }).slice(0, MAX_PALETTE_RESULTS);
}

function renderPaletteResults() {
  if (!csrData || !paletteResults) return;

  const matches = getPaletteMatches();
  paletteIndex = Math.min(paletteIndex, Math.max(0, matches.length - 1));

  if (!matches.length) {
    paletteResults.innerHTML = '<p class="empty-state">No matching contaminants.</p>';
    return;
  }

  paletteResults.innerHTML = matches.map((contaminant, index) => {
    const selected = selectedIds.has(contaminant.id);
    return `
      <button class="palette-result ${index === paletteIndex ? 'is-active' : ''}" type="button" role="option" aria-selected="${String(index === paletteIndex)}" data-id="${escapeHtml(contaminant.id)}">
        <span>
          <strong>${escapeHtml(contaminant.name)}</strong>
          <small>${escapeHtml(contaminant.category)}${contaminant.cas !== 'NS' ? ` · CAS ${escapeHtml(contaminant.cas)}` : ''}</small>
        </span>
        <span class="result-pill ${selected ? 'below' : 'neutral'}">${selected ? 'Selected' : 'Add'}</span>
      </button>
    `;
  }).join('');
}

function undoSelection() {
  const action = undoStack.pop();
  if (!action) return;

  redoStack.push(action);
  setSelectionFromSnapshot(action.before);
}

function redoSelection() {
  const action = redoStack.pop();
  if (!action) return;

  undoStack.push(action);
  setSelectionFromSnapshot(action.after);
}

function expandSelectedPanelIfCollapsed() {
  if (!selectedPanel.classList.contains('is-collapsed')) return;

  selectedPanelExpanded = true;
  renderSelectedPanel();
}

contaminantList.addEventListener('click', (event) => {
  const infoButton = event.target.closest('[data-action="info"]');
  if (infoButton) {
    const contaminant = allContaminants.find((item) => item.id === infoButton.dataset.id);
    openContaminantDrawer(contaminant, infoButton);
    return;
  }

  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    const categoryName = actionTarget.dataset.category;

    if (action === 'select-all') {
      toggleCategorySelection(categoryName);
      return;
    }

    if (action === 'toggle') {
      toggleCategoryCollapsed(categoryName);
      return;
    }
  }

  const categoryHeader = event.target.closest('.category-header');
  if (categoryHeader && !event.target.closest('.select-all-btn')) {
    const categoryName = categoryHeader.closest('.contaminant-category')?.dataset.category;
    if (categoryName) toggleCategoryCollapsed(categoryName);
    return;
  }

  const item = event.target.closest('.contaminant-item');
  if (item && !event.target.matches('input, button')) {
    toggleContaminant(item.dataset.id);
  }
});

contaminantList.addEventListener('change', (event) => {
  if (!event.target.matches('input[type="checkbox"]')) return;

  setContaminantSelected(event.target.dataset.id, event.target.checked);
});

selectedList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-action="remove"]');
  if (!removeButton) return;

  setContaminantSelected(removeButton.dataset.id, false);
});

selectedPanel.addEventListener('click', (event) => {
  if (
    !selectedPanel.classList.contains('is-collapsible') ||
    event.target.closest('button, select, input, a, .selected-sort')
  ) {
    return;
  }

  selectedPanelExpanded = selectedPanel.classList.contains('is-collapsed');
  renderSelectedPanel();
});

clearSelectionBtn.addEventListener('click', () => {
  applySelectionChange('clear-all', () => {
    selectedIds.clear();
  });
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  renderContaminants();
});

expandBtn.addEventListener('click', () => {
  const allCollapsed = categoryEntries.every(([categoryName]) => collapsedCategories.has(categoryName));

  if (allCollapsed) {
    collapsedCategories.clear();
  } else {
    categoryEntries.forEach(([categoryName]) => collapsedCategories.add(categoryName));
  }

  renderContaminants();
});

if (sortSelect) {
  sortSelect.addEventListener('pointerdown', expandSelectedPanelIfCollapsed);
  sortSelect.addEventListener('focus', expandSelectedPanelIfCollapsed);

  sortSelect.addEventListener('change', () => {
    expandSelectedPanelIfCollapsed();
    saveSortState();
    renderContaminants();
  });
}

if (sortDirectionBtn) {
  sortDirectionBtn.addEventListener('focus', expandSelectedPanelIfCollapsed);

  sortDirectionBtn.addEventListener('click', () => {
    expandSelectedPanelIfCollapsed();
    const nextDirection = sortDirectionBtn.dataset.direction === 'desc' ? 'asc' : 'desc';
    sortDirectionBtn.dataset.direction = nextDirection;
    sortDirectionBtn.textContent = nextDirection === 'desc' ? '↑' : '↓';
    sortDirectionBtn.setAttribute('aria-pressed', String(nextDirection === 'desc'));
    saveSortState();
    renderContaminants();
  });
}

quickAddBtn.addEventListener('click', openPalette);
commandPalette.addEventListener('palette-close', closePalette);

commandPalette.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-palette]')) {
    closePalette();
    return;
  }

  const result = event.target.closest('.palette-result');
  if (!result) return;
  toggleContaminant(result.dataset.id);
  renderPaletteResults();
});

paletteSearchInput.addEventListener('input', () => {
  paletteQuery = paletteSearchInput.value;
  paletteIndex = 0;
  renderPaletteResults();
});

paletteSearchInput.addEventListener('keydown', (event) => {
  const matches = getPaletteMatches();

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    paletteIndex = Math.min(matches.length - 1, paletteIndex + 1);
    renderPaletteResults();
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    paletteIndex = Math.max(0, paletteIndex - 1);
    renderPaletteResults();
  }

  if (event.key === 'Enter' && matches[paletteIndex]) {
    event.preventDefault();
    toggleContaminant(matches[paletteIndex].id);
    renderPaletteResults();
  }

  if (event.key === 'Escape') {
    closePalette();
  }
});

nextBtn.addEventListener('click', () => {
  saveSelectedContaminants(csrData, selectedIds);
  window.location.href = 'labdata.html';
});

document.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  const isTyping = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
    return;
  }

  if (isTyping) return;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redoSelection();
    } else {
      undoSelection();
    }
  }
});

fetch('data.json')
  .then((response) => response.json())
  .then((data) => {
    csrData = data;
    siteInfo = getStoredSiteInfo();
    categoryEntries = getCategoryEntries(data, siteInfo);
    allContaminants = data.contaminants.filter((contaminant) => {
      return categoryEntries.some(([categoryName]) => contaminant.category === categoryName);
    });

    restoreSortControls();
    categoryEntries.forEach(([categoryName]) => collapsedCategories.add(categoryName));
    restoreSelections(data);
    renderContaminants();
  })
  .catch(() => {
    contaminantList.innerHTML = `
      <p class="empty-state">
        Could not load data.json. Run this site through a local server such as
        VS Code Live Server or python3 -m http.server.
      </p>
    `;
  });
