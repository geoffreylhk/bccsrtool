const labTable = document.getElementById('labTable');
const filledCount = document.getElementById('filledCount');
const resultsBtn = document.getElementById('resultsBtn');
const resultsBtnText = document.getElementById('resultsBtnText');
const csvImportBtn = document.getElementById('csvImportBtn');
const csvModal = document.getElementById('csvModal');
const csvText = document.getElementById('csvText');
const csvFile = document.getElementById('csvFile');
const previewCsvBtn = document.getElementById('previewCsvBtn');
const applyCsvBtn = document.getElementById('applyCsvBtn');
const csvPreview = document.getElementById('csvPreview');

let csrData = null;
let selectedContaminants = [];
let latestImportPreview = [];

function groupSelected(contaminants) {
  return contaminants.reduce((groups, contaminant) => {
    if (!groups[contaminant.category]) {
      groups[contaminant.category] = [];
    }
    groups[contaminant.category].push(contaminant);
    return groups;
  }, {});
}

function getSavedLabValues() {
  return getStoredObject('labValues');
}

function getValueFromRow(row) {
  const concentration = row.querySelector('.concentration-input').value.trim();
  const unit = row.querySelector('.unit-select').value;

  if (!concentration) return null;

  return {
    unit,
    value: Number(concentration)
  };
}

function saveLabValues() {
  const values = {};

  document.querySelectorAll('.lab-row').forEach((row) => {
    const id = row.dataset.id;
    const labValue = getValueFromRow(row);
    if (labValue) values[id] = labValue;
  });

  updateActiveProfileData({ labValues: values });
  updateFilledCount();
}

function updateFilledCount() {
  const rows = document.querySelectorAll('.lab-row');
  const filled = Array.from(rows).filter((row) => {
    return row.querySelector('.concentration-input').value.trim();
  }).length;

  filledCount.textContent = `${filled} of ${rows.length} filled`;
  resultsBtnText.textContent = filled > 0 ? 'View Results' : 'Show Thresholds Only';
}

function renderUnitOptions(savedUnit) {
  const availableUnits = getAvailableUnits();
  const soilOptions = availableUnits.filter((unit) => unit.category === 'soil').map((unit) => {
    return `<option value="${unit.id}" ${savedUnit === unit.id ? 'selected' : ''}>${unit.label}</option>`;
  }).join('');
  const waterOptions = availableUnits.filter((unit) => unit.category === 'water').map((unit) => {
    return `<option value="${unit.id}" ${savedUnit === unit.id ? 'selected' : ''}>${unit.label}</option>`;
  }).join('');

  return `
    <optgroup label="Soil">
      ${soilOptions}
    </optgroup>
    <optgroup label="Water">
      ${waterOptions}
    </optgroup>
  `;
}

function renderLabRows() {
  const labValues = getSavedLabValues();

  if (!selectedContaminants.length) {
    labTable.innerHTML = `
      <div class="empty-state">
        No contaminants selected yet. Go back and choose at least one substance.
      </div>
    `;
    filledCount.textContent = '0 of 0 filled';
    resultsBtn.disabled = true;
    return;
  }

  resultsBtn.disabled = false;
  const grouped = groupSelected(selectedContaminants);
  const rows = Object.entries(grouped).map(([groupName, contaminants]) => {
    const itemRows = contaminants.map((contaminant) => {
      const saved = labValues[contaminant.id] || {};
      const savedUnit = saved.unit || DEFAULT_LAB_UNIT;

      return `
        <div class="lab-row" data-id="${escapeHtml(contaminant.id)}">
          <div class="lab-substance">
            <button class="text-button lab-info-btn" type="button" data-action="info" data-id="${escapeHtml(contaminant.id)}">
              ${escapeHtml(contaminant.name)}
            </button>
            ${contaminant.cas !== 'NS' ? `<span>CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
          </div>
          <input
            class="concentration-input"
            type="number"
            min="0"
            step="any"
            inputmode="decimal"
            value="${saved.value ?? ''}"
            placeholder="—"
            aria-label="${escapeHtml(contaminant.name)} concentration"
          >
          <select class="unit-select" aria-label="${escapeHtml(contaminant.name)} unit">
            ${renderUnitOptions(savedUnit)}
          </select>
        </div>
      `;
    }).join('');

    return `
      <div class="lab-group">
        <div class="lab-group-title">${escapeHtml(groupName)}</div>
        ${itemRows}
      </div>
    `;
  }).join('');

  labTable.innerHTML = `
    <div class="lab-table-head">
      <span>Substance</span>
      <span>Concentration</span>
      <span>Unit</span>
    </div>
    ${rows}
  `;

  updateFilledCount();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function getColumnIndex(headers, names) {
  const normalizedHeaders = headers.map(normalizeText);
  return normalizedHeaders.findIndex((header) => names.some((name) => header === normalizeText(name)));
}

function findContaminantByImportRow(row, columns) {
  const id = row[columns.id] || '';
  const name = row[columns.name] || '';
  const cas = row[columns.cas] || '';
  const normalizedName = normalizeText(name);

  return selectedContaminants.find((contaminant) => {
    return (
      (id && contaminant.id === id) ||
      (name && contaminant.name.toLowerCase() === name.toLowerCase()) ||
      (cas && contaminant.cas === cas) ||
      (normalizedName && normalizeText(contaminant.name) === normalizedName)
    );
  }) || null;
}

function getUnitFromCsv(unitText) {
  if (!unitText) return DEFAULT_LAB_UNIT;
  const normalized = normalizeText(unitText);
  const matched = LAB_UNITS.find((unit) => {
    return normalizeText(unit.id) === normalized || normalizeText(unit.label) === normalized || normalizeText(unit.detail) === normalized;
  });
  return matched?.id || DEFAULT_LAB_UNIT;
}

function buildImportPreview(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const columns = {
    id: getColumnIndex(headers, ['id', 'contaminant_id', 'substance_id']),
    name: getColumnIndex(headers, ['contaminant', 'substance', 'name']),
    cas: getColumnIndex(headers, ['cas', 'cas_number', 'cas no']),
    value: getColumnIndex(headers, ['value', 'concentration', 'result']),
    unit: getColumnIndex(headers, ['unit', 'units'])
  };

  return rows.slice(1).map((row, index) => {
    const contaminant = findContaminantByImportRow(row, columns);
    const rawValue = columns.value >= 0 ? row[columns.value] : '';
    const unit = getUnitFromCsv(columns.unit >= 0 ? row[columns.unit] : '');
    const cleanedValue = String(rawValue || '').trim();
    const hasValue = cleanedValue !== '';
    const numericValue = hasValue ? Number(cleanedValue) : undefined;
    const invalidValue = hasValue && Number.isNaN(numericValue);

    return {
      rowNumber: index + 2,
      contaminant,
      rawName: row[columns.name] || row[columns.cas] || row[columns.id] || `Row ${index + 2}`,
      value: invalidValue ? undefined : numericValue,
      unit,
      invalidValue,
      matched: Boolean(contaminant)
    };
  });
}

function renderCsvPreview(preview) {
  const matched = preview.filter((row) => row.matched && !row.invalidValue);
  const unmatched = preview.filter((row) => !row.matched);
  const invalid = preview.filter((row) => row.invalidValue);

  applyCsvBtn.disabled = matched.length === 0;

  if (!preview.length) {
    csvPreview.innerHTML = '<p class="empty-state">Add CSV text with a header row, then preview the import.</p>';
    return;
  }

  csvPreview.innerHTML = `
    <div class="preview-summary">
      <span>${matched.length} matched</span>
      <span>${unmatched.length} unmatched</span>
      <span>${invalid.length} invalid values</span>
    </div>
    <div class="preview-list">
      ${preview.map((row) => `
        <div class="preview-row ${row.matched && !row.invalidValue ? 'is-ok' : 'needs-review'}">
          <strong>${escapeHtml(row.contaminant?.name || row.rawName)}</strong>
          <span>
            ${row.matched ? 'Matched' : 'Unmatched'}
            ${row.invalidValue ? ' · invalid numeric value' : ''}
            ${row.value !== undefined ? ` · ${escapeHtml(row.value)} ${escapeHtml(getUnitDef(row.unit).label)}` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function openCsvModal() {
  csvModal.classList.add('is-open');
  csvModal.setAttribute('aria-hidden', 'false');
  csvText.focus();
  renderCsvPreview(latestImportPreview);
}

function closeCsvModal() {
  csvModal.classList.remove('is-open');
  csvModal.setAttribute('aria-hidden', 'true');
  csvImportBtn.focus();
}

labTable.addEventListener('input', (event) => {
  if (event.target.matches('.concentration-input')) saveLabValues();
});

labTable.addEventListener('change', (event) => {
  if (event.target.matches('.unit-select')) saveLabValues();
});

labTable.addEventListener('click', (event) => {
  const infoButton = event.target.closest('[data-action="info"]');
  if (!infoButton) return;
  const contaminant = selectedContaminants.find((item) => item.id === infoButton.dataset.id);
  openContaminantDrawer(contaminant, infoButton);
});

resultsBtn.addEventListener('click', () => {
  saveLabValues();
  window.location.href = 'results.html';
});

csvImportBtn.addEventListener('click', openCsvModal);
csvModal.addEventListener('csv-close', closeCsvModal);

csvModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-close-csv]')) {
    closeCsvModal();
  }
});

csvFile.addEventListener('change', () => {
  const file = csvFile.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    csvText.value = String(reader.result || '');
  });
  reader.readAsText(file);
});

previewCsvBtn.addEventListener('click', () => {
  latestImportPreview = buildImportPreview(csvText.value);
  renderCsvPreview(latestImportPreview);
});

applyCsvBtn.addEventListener('click', () => {
  const labValues = getSavedLabValues();

  latestImportPreview
    .filter((row) => row.matched && !row.invalidValue)
    .forEach((row) => {
      labValues[row.contaminant.id] = {
        unit: row.unit
      };

      if (row.value !== undefined) {
        labValues[row.contaminant.id].value = row.value;
      }
    });

  updateActiveProfileData({ labValues });
  closeCsvModal();
  renderLabRows();
});

fetch('data.json')
  .then((response) => response.json())
  .then((data) => {
    csrData = data;
    selectedContaminants = getSelectedContaminants(data);
    renderLabRows();
  })
  .catch(() => {
    labTable.innerHTML = `
      <p class="empty-state">
        Could not load data.json. Run this site through a local server such as
        VS Code Live Server or python3 -m http.server.
      </p>
    `;
  });
