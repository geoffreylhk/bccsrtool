const labTable = document.getElementById('labTable');
const filledCount = document.getElementById('filledCount');
const resultsBtn = document.getElementById('resultsBtn');
const resultsBtnText = document.getElementById('resultsBtnText');

let csrData = null;
let selectedContaminants = [];
const siteInfo = getStoredSiteInfo();

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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

function saveLabValues() {
  const values = {};
  document.querySelectorAll('.lab-row').forEach((row) => {
    const id = row.dataset.id;
    const concentration = row.querySelector('.concentration-input').value.trim();
    const unit = row.querySelector('.unit-select').value;

    if (concentration) {
      values[id] = {
        value: Number(concentration),
        unit
      };
    }
  });

  localStorage.setItem('labValues', JSON.stringify(values));
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
  const availableUnits = getAvailableUnits(siteInfo.nearWater);
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
    ${waterOptions ? `<optgroup label="Water">${waterOptions}</optgroup>` : ''}
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

  const grouped = groupSelected(selectedContaminants);
  const rows = Object.entries(grouped).map(([groupName, contaminants]) => {
    const itemRows = contaminants.map((contaminant) => {
      const saved = labValues[contaminant.id] || {};
      const savedUnit = saved.unit || DEFAULT_LAB_UNIT;

      return `
        <div class="lab-row" data-id="${escapeHtml(contaminant.id)}">
          <div class="lab-substance">
            <strong>${escapeHtml(contaminant.name)}</strong>
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

  document.querySelectorAll('.concentration-input, .unit-select').forEach((field) => {
    field.addEventListener('input', saveLabValues);
    field.addEventListener('change', saveLabValues);
  });

  updateFilledCount();
}

resultsBtn.addEventListener('click', () => {
  saveLabValues();
  window.location.href = 'results.html';
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
