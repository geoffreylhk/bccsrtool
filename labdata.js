const labTable = document.getElementById('labTable');
const filledCount = document.getElementById('filledCount');
const csvImportBtn = document.getElementById('csvImportBtn');
const resultsBtns = document.querySelectorAll('[data-results-action]');
const resultsBtnTexts = document.querySelectorAll('[data-results-label]');
const csvImportBtns = document.querySelectorAll('[data-csv-import]');
const csvModal = document.getElementById('csvModal');
const csvText = document.getElementById('csvText');
const csvFile = document.getElementById('csvFile');
const previewCsvBtn = document.getElementById('previewCsvBtn');
const applyCsvBtn = document.getElementById('applyCsvBtn');
const csvPreview = document.getElementById('csvPreview');

let csrData = null;
let selectedContaminants = [];
let latestImportPreview = [];
let latestCsvTrigger = csvImportBtn;

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
  return new Map(
    getAssessmentContaminants(csrData).map((contaminant) => [contaminant.id, contaminant])
  );
}

function getValueFromSubrow(subrow) {
  return {
    concentration: subrow.querySelector('.concentration-input').value.trim(),
    unit: subrow.querySelector('.unit-select').value
  };
}

function saveLabValues() {
  const recordsById = getSavedLabValues();

  document.querySelectorAll('.lab-contaminant').forEach((row) => {
    const record = recordsById.get(row.dataset.id);
    if (!record) return;

    const soil = getValueFromSubrow(row.querySelector('[data-matrix="soil"]'));
    const groundwater = getValueFromSubrow(row.querySelector('[data-matrix="groundwater"]'));
    record.soilConc = soil.concentration === '' ? '' : Number(soil.concentration);
    record.soilUnit = soil.unit;
    record.gwConc = groundwater.concentration === '' ? '' : Number(groundwater.concentration);
    record.gwUnit = groundwater.unit;
  });

  saveAssessmentContaminants([...recordsById.values()]);
  updateFilledCount();
}

function updateFilledCount() {
  const inputs = document.querySelectorAll('.lab-matrix-row .concentration-input');
  const filled = Array.from(inputs).filter((input) => {
    return input.value.trim();
  }).length;

  filledCount.textContent = `${filled} of ${inputs.length} filled`;
  resultsBtnTexts.forEach((buttonText) => {
    buttonText.textContent = filled > 0 ? 'View Results' : 'Show Thresholds Only';
  });
}

function setResultsButtonsDisabled(disabled) {
  resultsBtns.forEach((button) => {
    button.disabled = disabled;
  });
}

function renderUnitOptions(matrix, savedUnit) {
  const allowedIds = matrix === 'soil' ? ['ug_g', 'mg_kg'] : ['ug_L', 'mg_L'];
  const fallback = matrix === 'soil' ? DEFAULT_SOIL_UNIT : DEFAULT_GW_UNIT;
  const selectedUnit = savedUnit || fallback;

  return getAvailableUnits()
    .filter((unit) => allowedIds.includes(unit.id))
    .map((unit) => {
      const selected = selectedUnit === unit.id || selectedUnit === unit.label;
      return `<option value="${unit.label}" ${selected ? 'selected' : ''}>${unit.label}</option>`;
    })
    .join('');
}

function renderLabRows() {
  const savedRecords = getSavedLabValues();

  if (!selectedContaminants.length) {
    labTable.innerHTML = `
      <div class="empty-state">
        No contaminants selected yet. Go back and choose at least one substance.
      </div>
    `;
    filledCount.textContent = '0 of 0 filled';
    setResultsButtonsDisabled(true);
    return;
  }

  setResultsButtonsDisabled(false);
  const grouped = groupSelected(selectedContaminants);
  const rows = Object.entries(grouped).map(([groupName, contaminants]) => {
    const itemRows = contaminants.map((contaminant) => {
      const saved = savedRecords.get(contaminant.id) || contaminant;

      return `
        <div class="lab-contaminant" data-id="${escapeHtml(contaminant.id)}">
          <div class="lab-substance">
            <button class="text-button lab-info-btn" type="button" data-action="info" data-id="${escapeHtml(contaminant.id)}">
              ${escapeHtml(contaminant.name)}
            </button>
            ${contaminant.cas !== 'NS' ? `<span>CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
          </div>
          <div class="lab-matrix-rows">
            <div class="lab-matrix-row soil" data-matrix="soil">
              <span class="matrix-label"><span class="matrix-dot" aria-hidden="true"></span>Soil</span>
              <input
                class="concentration-input"
                type="number"
                min="0"
                step="any"
                inputmode="decimal"
                value="${saved.soilConc ?? ''}"
                placeholder="—"
                aria-label="${escapeHtml(contaminant.name)} soil concentration"
              >
              <select class="unit-select" aria-label="${escapeHtml(contaminant.name)} soil unit">
                ${renderUnitOptions('soil', saved.soilUnit)}
              </select>
            </div>
            <div class="lab-matrix-row groundwater" data-matrix="groundwater">
              <span class="matrix-label"><span class="matrix-dot" aria-hidden="true"></span>Groundwater</span>
              <input
                class="concentration-input"
                type="number"
                min="0"
                step="any"
                inputmode="decimal"
                value="${saved.gwConc ?? ''}"
                placeholder="—"
                aria-label="${escapeHtml(contaminant.name)} groundwater concentration"
              >
              <select class="unit-select" aria-label="${escapeHtml(contaminant.name)} groundwater unit">
                ${renderUnitOptions('groundwater', saved.gwUnit)}
              </select>
            </div>
          </div>
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
      <span>Matrix / Concentration / Unit</span>
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
  if (!unitText) return DEFAULT_SOIL_UNIT;
  const normalized = normalizeText(unitText);
  const matched = LAB_UNITS.find((unit) => {
    return normalizeText(unit.id) === normalized || normalizeText(unit.label) === normalized || normalizeText(unit.detail) === normalized;
  });
  return matched?.label || DEFAULT_SOIL_UNIT;
}

function getMatrixFromCsv(matrixText) {
  const normalized = normalizeText(matrixText);
  if (['groundwater', 'ground water', 'gw', 'water'].includes(normalized)) return 'groundwater';
  if (['soil', 'land'].includes(normalized)) return 'soil';
  return '';
}

function buildImportPreview(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const columns = {
    id: getColumnIndex(headers, ['id', 'contaminant_id', 'substance_id']),
    name: getColumnIndex(headers, ['contaminant', 'contaminant_name', 'substance', 'substance_name', 'name']),
    cas: getColumnIndex(headers, ['cas', 'cas_number', 'cas no']),
    matrix: getColumnIndex(headers, ['matrix', 'media', 'medium', 'sample_matrix']),
    value: getColumnIndex(headers, ['value', 'concentration', 'entered_concentration', 'display_concentration', 'result']),
    unit: getColumnIndex(headers, ['unit', 'units']),
    soilValue: getColumnIndex(headers, ['soil_concentration', 'soil concentration', 'soilconc']),
    soilUnit: getColumnIndex(headers, ['soil_unit', 'soil unit', 'soilunit']),
    gwValue: getColumnIndex(headers, ['groundwater_concentration', 'groundwater concentration', 'gw_concentration', 'gwconc']),
    gwUnit: getColumnIndex(headers, ['groundwater_unit', 'groundwater unit', 'gw_unit', 'gwunit'])
  };

  return rows.slice(1).flatMap((row, index) => {
    const contaminant = findContaminantByImportRow(row, columns);
    const rawName = row[columns.name] || row[columns.cas] || row[columns.id] || `Row ${index + 2}`;
    const entries = [];

    const addEntry = (matrix, rawValue, rawUnit) => {
      const cleanedValue = String(rawValue || '').trim();
      if (!cleanedValue && columns.soilValue >= 0 && columns.gwValue >= 0) return;
      const unit = getUnitFromCsv(rawUnit);
      const unitDef = getUnitDef(unit);
      const resolvedMatrix = matrix || (unitDef.category === 'water' ? 'groundwater' : 'soil');
      const hasValue = cleanedValue !== '';
      const numericValue = hasValue ? Number(cleanedValue) : undefined;
      const invalidValue = hasValue && Number.isNaN(numericValue);

      entries.push({
        rowNumber: index + 2,
        contaminant,
        rawName,
        matrix: resolvedMatrix,
        value: invalidValue ? undefined : numericValue,
        unit,
        invalidValue,
        matched: Boolean(contaminant)
      });
    };

    if (columns.soilValue >= 0 || columns.gwValue >= 0) {
      if (columns.soilValue >= 0) {
        addEntry('soil', row[columns.soilValue], columns.soilUnit >= 0 ? row[columns.soilUnit] : DEFAULT_SOIL_UNIT);
      }
      if (columns.gwValue >= 0) {
        addEntry('groundwater', row[columns.gwValue], columns.gwUnit >= 0 ? row[columns.gwUnit] : DEFAULT_GW_UNIT);
      }
    } else {
      const matrix = columns.matrix >= 0 ? getMatrixFromCsv(row[columns.matrix]) : '';
      addEntry(matrix, columns.value >= 0 ? row[columns.value] : '', columns.unit >= 0 ? row[columns.unit] : '');
    }

    return entries;
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
            ${row.matched ? `Matched ${row.matrix === 'soil' ? 'soil' : 'groundwater'}` : 'Unmatched'}
            ${row.invalidValue ? ' · invalid numeric value' : ''}
            ${row.value !== undefined ? ` · ${escapeHtml(row.value)} ${escapeHtml(row.unit)}` : ''}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

function openCsvModal(event) {
  latestCsvTrigger = event?.currentTarget || csvImportBtn;
  csvModal.classList.add('is-open');
  csvModal.setAttribute('aria-hidden', 'false');
  csvText.focus();
  renderCsvPreview(latestImportPreview);
}

function closeCsvModal() {
  csvModal.classList.remove('is-open');
  csvModal.setAttribute('aria-hidden', 'true');
  latestCsvTrigger?.focus();
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

resultsBtns.forEach((button) => {
  button.addEventListener('click', () => {
    saveLabValues();
    window.location.href = 'results.html';
  });
});

csvImportBtns.forEach((button) => {
  button.addEventListener('click', openCsvModal);
});
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
  const recordsById = getSavedLabValues();

  latestImportPreview
    .filter((row) => row.matched && !row.invalidValue)
    .forEach((row) => {
      const record = recordsById.get(row.contaminant.id);
      if (!record) return;

      if (row.matrix === 'groundwater') {
        record.gwConc = row.value ?? '';
        record.gwUnit = row.unit || DEFAULT_GW_UNIT;
      } else {
        record.soilConc = row.value ?? '';
        record.soilUnit = row.unit || DEFAULT_SOIL_UNIT;
      }
    });

  saveAssessmentContaminants([...recordsById.values()]);
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
