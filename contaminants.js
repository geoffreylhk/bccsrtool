const contaminantList = document.getElementById('contaminantList');
const searchInput = document.getElementById('searchInput');
const expandBtn = document.getElementById('expandBtn');
const nextBtn = document.getElementById('nextBtn');
const selectedList = document.getElementById('selectedList');
const selectedCount = document.getElementById('selectedCount');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');

let csrData = null;
let siteInfo = getStoredSiteInfo();
let categoryEntries = [];
let allContaminants = [];
let searchQuery = '';

const collapsedCategories = new Set();
const selectedIds = new Set();

function restoreSelections(data) {
  getSelectedContaminants(data).forEach((contaminant) => {
    selectedIds.add(contaminant.id);
  });
}

function getCategoryContaminants(categoryName) {
  return allContaminants.filter((contaminant) => contaminant.category === categoryName);
}

function getVisibleContaminants(contaminants) {
  if (!searchQuery) {
    return contaminants;
  }

  return contaminants.filter((contaminant) => {
    const haystack = `${contaminant.name} ${contaminant.cas} ${contaminant.category}`.toLowerCase();
    return haystack.includes(searchQuery);
  });
}

function isCategoryCollapsed(categoryName) {
  return collapsedCategories.has(categoryName) && !searchQuery;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toggleCategorySelection(categoryName) {
  const contaminants = getCategoryContaminants(categoryName);
  const allSelected = contaminants.every((contaminant) => selectedIds.has(contaminant.id));

  if (allSelected) {
    contaminants.forEach((contaminant) => selectedIds.delete(contaminant.id));
  } else {
    contaminants.forEach((contaminant) => selectedIds.add(contaminant.id));
  }

  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
}

function renderContaminants() {
  const markup = categoryEntries.map(([categoryName]) => {
    const categoryContaminants = getCategoryContaminants(categoryName);
    const visibleContaminants = getVisibleContaminants(categoryContaminants);

    if (searchQuery && visibleContaminants.length === 0) {
      return '';
    }

    const collapsed = isCategoryCollapsed(categoryName);
    const selectedInCategory = categoryContaminants.filter((contaminant) => {
      return selectedIds.has(contaminant.id);
    }).length;
    const allSelected = categoryContaminants.length > 0 && selectedInCategory === categoryContaminants.length;

    const items = visibleContaminants.map((contaminant) => {
      const checked = selectedIds.has(contaminant.id) ? 'checked' : '';
      return `
        <label class="contaminant-item ${checked ? 'is-selected' : ''}">
          <input type="checkbox" value="${escapeHtml(contaminant.id)}" data-id="${escapeHtml(contaminant.id)}" ${checked}>
          <span class="contaminant-copy">
            <span class="contaminant-name">${escapeHtml(contaminant.name)}</span>
            <span class="contaminant-description">${escapeHtml(contaminant.description)}</span>
            ${contaminant.cas !== 'NS' ? `<span class="cas">CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
          </span>
        </label>
      `;
    }).join('');

    return `
      <article class="contaminant-category" data-category="${escapeHtml(categoryName)}">
        <button class="category-header" type="button" data-action="toggle" data-category="${escapeHtml(categoryName)}">
          <img class="chevron" src="assets/icons/${collapsed ? 'chevron-down' : 'chevron-up'}.svg" alt="" aria-hidden="true">
          <span class="category-title">${escapeHtml(categoryName)}</span>
          <span class="category-total">(${categoryContaminants.length})</span>
          <span class="category-count">${selectedInCategory ? `${selectedInCategory} selected` : ''}</span>
          <span class="select-all-btn" data-action="select-all" data-category="${escapeHtml(categoryName)}">${allSelected ? 'Deselect all' : 'Select all'}</span>
        </button>
        <div class="category-items ${collapsed ? '' : 'is-expanded'}">
          ${items}
        </div>
      </article>
    `;
  }).join('');

  contaminantList.innerHTML = markup || '<p class="empty-state">No contaminants match your search.</p>';
  renderSelectedPanel();
  updateExpandButton();
}

function renderSelectedPanel() {
  const selected = allContaminants.filter((contaminant) => selectedIds.has(contaminant.id));

  selectedCount.textContent = selected.length ? `(${selected.length})` : '';
  clearSelectionBtn.hidden = selected.length === 0;
  nextBtn.disabled = selected.length === 0;

  if (!selected.length) {
    selectedList.innerHTML = '<p class="no-selection">No substances selected yet.<br>Check items from the list.</p>';
    return;
  }

  selectedList.innerHTML = selected.map((contaminant) => `
    <div class="selected-tag">
      <span>
        <strong>${escapeHtml(contaminant.name)}</strong>
        <small>${escapeHtml(contaminant.category)}</small>
      </span>
      <button type="button" data-action="remove" data-id="${escapeHtml(contaminant.id)}" aria-label="Remove ${escapeHtml(contaminant.name)}">×</button>
    </div>
  `).join('');
}

function updateExpandButton() {
  const allCollapsed = categoryEntries.every(([categoryName]) => collapsedCategories.has(categoryName));
  expandBtn.textContent = allCollapsed ? '+ Expand all' : '− Collapse all';
}

contaminantList.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  const categoryName = actionTarget.dataset.category;

  if (action === 'select-all') {
    event.stopPropagation();
    toggleCategorySelection(categoryName);
    return;
  }

  if (action === 'toggle') {
    if (collapsedCategories.has(categoryName)) {
      collapsedCategories.delete(categoryName);
    } else {
      collapsedCategories.add(categoryName);
    }
    renderContaminants();
  }
});

contaminantList.addEventListener('change', (event) => {
  if (!event.target.matches('input[type="checkbox"]')) {
    return;
  }

  const id = event.target.dataset.id;
  if (event.target.checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }

  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
});

selectedList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-action="remove"]');
  if (!removeButton) {
    return;
  }

  selectedIds.delete(removeButton.dataset.id);
  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
});

clearSelectionBtn.addEventListener('click', () => {
  selectedIds.clear();
  saveSelectedContaminants(csrData, selectedIds);
  renderContaminants();
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

nextBtn.addEventListener('click', () => {
  saveSelectedContaminants(csrData, selectedIds);
  window.location.href = 'labdata.html';
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
