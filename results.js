const resultsSubtitle = document.getElementById('resultsSubtitle');
const currentUse = document.getElementById('currentUse');
const proposedUse = document.getElementById('proposedUse');
const waterProximity = document.getElementById('waterProximity');
const contaminantCount = document.getElementById('contaminantCount');
const labDataCount = document.getElementById('labDataCount');
const thresholdNote = document.getElementById('thresholdNote');
const comparisonMeta = document.getElementById('comparisonMeta');
const resultsTable = document.getElementById('resultsTable');
const recommendation = document.getElementById('recommendation');
const printBtn = document.getElementById('printBtn');
const newAssessmentBtn = document.getElementById('newAssessmentBtn');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function groupContaminants(contaminants) {
  return contaminants.reduce((groups, contaminant) => {
    if (!groups[contaminant.category]) {
      groups[contaminant.category] = [];
    }
    groups[contaminant.category].push(contaminant);
    return groups;
  }, {});
}

function getSensitivity(contaminant) {
  const residential = getNumericThreshold(getThreshold(contaminant, 'RLLD', 'soil'));
  const industrial = getNumericThreshold(getThreshold(contaminant, 'IL', 'soil'));

  if (residential === null || industrial === null) {
    return '';
  }

  if (residential < industrial * 0.01) return 'High';
  if (residential < industrial * 0.1) return 'Medium';
  return 'Low';
}

function getResultForValue(contaminant, labValue, siteInfo) {
  if (!labValue || labValue.value === undefined || labValue.value === null || labValue.value === '') {
    return { status: 'Threshold only', className: 'neutral', converted: null };
  }

  const unitDef = getUnitDef(labValue.unit || DEFAULT_LAB_UNIT);
  const converted = Number(labValue.value) * unitDef.factor;
  const standard = getThreshold(contaminant, siteInfo.proposedLandUse, unitDef.category === 'water' ? 'water' : 'soil');
  const numericStandard = getNumericThreshold(standard);

  if (numericStandard === null) {
    return { status: 'Review', className: 'review', converted };
  }

  if (converted > numericStandard) {
    return { status: 'Exceeds', className: 'exceeds', converted };
  }

  if (converted > numericStandard * 0.9) {
    return { status: 'Borderline', className: 'review', converted };
  }

  return { status: 'Below', className: 'below', converted };
}

function renderSummary(siteInfo, selected, labValues) {
  const thresholdLabel = siteInfo.proposedLandUseLabel || LAND_USE_LABELS[siteInfo.proposedLandUse] || 'selected land use';
  const filled = Object.keys(labValues).length;

  resultsSubtitle.textContent = `BC CSR Schedule 3.1 — ${thresholdLabel} standards`;
  currentUse.textContent = siteInfo.currentLandUseLabel || LAND_USE_LABELS[siteInfo.currentLandUse] || 'Not provided';
  proposedUse.textContent = thresholdLabel || 'Not provided';
  waterProximity.textContent = siteInfo.waterBodyLabel || (siteInfo.nearWater ? 'Within 500 m' : 'Greater than 500 m');
  contaminantCount.textContent = `${selected.length} selected`;
  labDataCount.textContent = filled === 1 ? '1 value' : `${filled} values`;
  thresholdNote.innerHTML = `Thresholds apply to <strong>${escapeHtml(thresholdLabel)}</strong> land use.`;
  comparisonMeta.textContent = `${selected.length} contaminants · ${thresholdLabel} standards${filled ? ' · per-substance units' : ''}`;
}

function getGridColumns(hasLabData, showGroundwater) {
  if (hasLabData && showGroundwater) {
    return 'minmax(240px, 1.6fr) minmax(95px, 0.6fr) minmax(95px, 0.6fr) minmax(95px, 0.65fr) minmax(105px, 0.65fr) minmax(70px, 0.45fr) minmax(120px, 0.75fr)';
  }

  if (hasLabData) {
    return 'minmax(260px, 1.6fr) minmax(110px, 0.7fr) minmax(110px, 0.7fr) minmax(110px, 0.7fr) minmax(80px, 0.5fr) minmax(120px, 0.7fr)';
  }

  if (showGroundwater) {
    return 'minmax(260px, 1.7fr) minmax(120px, 0.7fr) minmax(120px, 0.7fr) minmax(120px, 0.7fr)';
  }

  return 'minmax(260px, 1.7fr) minmax(120px, 0.7fr) minmax(120px, 0.7fr)';
}

function renderTable(siteInfo, selected, labValues) {
  const hasLabData = Object.keys(labValues).length > 0;
  const showGroundwater = siteInfo.nearWater;
  const gridColumns = getGridColumns(hasLabData, showGroundwater);
  let exceedCount = 0;
  let filledCount = 0;

  if (!selected.length) {
    resultsTable.innerHTML = '<p class="empty-state">No contaminants were selected.</p>';
    return { exceedCount, filledCount };
  }

  const grouped = groupContaminants(selected);
  const groupMarkup = Object.entries(grouped).map(([categoryName, contaminants]) => {
    const rows = contaminants.map((contaminant) => {
      const labValue = labValues[contaminant.id];
      const unitDef = getUnitDef(labValue?.unit || DEFAULT_LAB_UNIT);
      const result = getResultForValue(contaminant, labValue, siteInfo);
      const soilThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'soil');
      const groundwaterThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'water');
      const sensitivity = getSensitivity(contaminant);
      const sensitivityMarkup = sensitivity
        ? `<span class="sensitivity ${sensitivity.toLowerCase()}">${sensitivity}</span>`
        : '';

      if (labValue?.value !== undefined) {
        filledCount += 1;
      }

      if (result.status === 'Exceeds') {
        exceedCount += 1;
      }

      return `
        <div class="result-row ${result.className}" style="grid-template-columns: ${gridColumns};">
          <div class="result-substance">
            <strong>${escapeHtml(contaminant.name)}</strong>
            ${contaminant.cas !== 'NS' ? `<span>CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
            <small>${escapeHtml(contaminant.category)}</small>
          </div>
          <div data-label="Soil">${formatThreshold(soilThreshold)}</div>
          ${showGroundwater ? `<div data-label="GW">${formatThreshold(groundwaterThreshold)}</div>` : ''}
          <div data-label="Sensitivity">${sensitivityMarkup}</div>
          ${hasLabData ? `
            <div data-label="Your Conc.">${labValue?.value ?? '—'}</div>
            <div data-label="Unit">${labValue ? unitDef.label : '—'}</div>
            <div data-label="Result"><span class="result-pill ${result.className}">${result.status}</span></div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="result-group-title">${escapeHtml(categoryName)}</div>
      ${rows}
    `;
  }).join('');

  resultsTable.innerHTML = `
    <div class="results-table-head" style="grid-template-columns: ${gridColumns};">
      <span>Contaminant</span>
      <span>Soil (µg/g)</span>
      ${showGroundwater ? '<span>GW (µg/L)</span>' : ''}
      <span>Sensitivity</span>
      ${hasLabData ? `
        <span>Your Conc.</span>
        <span>Unit</span>
        <span>Result</span>
      ` : ''}
    </div>
    ${groupMarkup}
  `;

  return { exceedCount, filledCount };
}

function renderRecommendation(exceedCount, selectedCount, filledCount, thresholdLabel) {
  if (!filledCount) {
    recommendation.className = 'recommendation-card review';
    recommendation.innerHTML = `
      <h2 class="card-heading-with-icon">
        <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#flask-conical"></use></svg>
        Threshold Review Only
      </h2>
      <p>No lab values were entered. Review the applicable ${escapeHtml(thresholdLabel)} thresholds before screening measured concentrations.</p>
    `;
    return;
  }

  if (exceedCount > 0) {
    recommendation.className = 'recommendation-card exceeds';
    recommendation.innerHTML = `
      <h2 class="card-heading-with-icon">
        <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#alert-triangle"></use></svg>
        Detailed Site Investigation Recommended
      </h2>
      <p>${exceedCount} of ${filledCount} evaluated contaminants exceed BC CSR thresholds for ${escapeHtml(thresholdLabel)}.</p>
      <p>One or more contaminants exceed applicable Schedule 3.1 thresholds. A qualified professional should review the results and determine the appropriate scope for a Detailed Site Investigation to characterize the location, extent, and degree of contamination.</p>
    `;
    return;
  }

  recommendation.className = 'recommendation-card below';
  recommendation.innerHTML = `
    <h2 class="card-heading-with-icon">
      <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#check-circle"></use></svg>
      No Exceedance Identified in This Screening
    </h2>
    <p>0 of ${filledCount} evaluated contaminants exceed applicable BC CSR thresholds for ${escapeHtml(thresholdLabel)}.</p>
    <p>This screening did not identify concentrations above the selected Schedule 3.1 thresholds. Professional review is still recommended prior to any property transaction or redevelopment.</p>
  `;
}

function loadResults() {
  const siteInfo = getStoredSiteInfo();
  const labValues = getStoredObject('labValues');
  const thresholdLabel = siteInfo.proposedLandUseLabel || LAND_USE_LABELS[siteInfo.proposedLandUse] || 'selected land use';

  fetch('data.json')
    .then((response) => response.json())
    .then((data) => {
      const selected = getSelectedContaminants(data);
      renderSummary(siteInfo, selected, labValues);
      const counts = renderTable(siteInfo, selected, labValues);
      renderRecommendation(counts.exceedCount, selected.length, counts.filledCount, thresholdLabel);
    })
    .catch(() => {
      resultsTable.innerHTML = `
        <p class="empty-state">
          Could not load data.json. Run this site through a local server such as
          VS Code Live Server or python3 -m http.server.
        </p>
      `;
    });
}

printBtn.addEventListener('click', () => {
  window.print();
});

newAssessmentBtn.addEventListener('click', () => {
  localStorage.removeItem('siteInfo');
  localStorage.removeItem('selectedContaminants');
  localStorage.removeItem('labValues');
  window.location.href = 'index.html';
});

loadResults();
