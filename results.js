const resultsSubtitle = document.getElementById('resultsSubtitle');
const reportDate = document.getElementById('reportDate');
const currentUse = document.getElementById('currentUse');
const proposedUse = document.getElementById('proposedUse');
const groundwaterStatus = document.getElementById('groundwaterStatus');
const contaminantCount = document.getElementById('contaminantCount');
const labDataCount = document.getElementById('labDataCount');
const thresholdNote = document.getElementById('thresholdNote');
const comparisonMeta = document.getElementById('comparisonMeta');
const resultsTable = document.getElementById('resultsTable');
const resultsChart = document.getElementById('resultsChart');
const recommendation = document.getElementById('recommendation');
const exportMenus = [...document.querySelectorAll('.export-menu')];
const printButtons = [...document.querySelectorAll('[data-print-btn]')];
const csvExportButtons = [...document.querySelectorAll('[data-csv-export-btn]')];
const wordExportButtons = [...document.querySelectorAll('[data-word-export-btn]')];
const newAssessmentButtons = [...document.querySelectorAll('[data-new-assessment-btn]')];
const exceedanceOnlyToggle = document.getElementById('exceedanceOnlyToggle');

let csrData = null;
let latestRows = [];
let latestCounts = { exceedCount: 0, filledCount: 0, selectedCount: 0 };

function groupContaminants(contaminants) {
  return contaminants.reduce((groups, contaminant) => {
    if (!groups[contaminant.category]) groups[contaminant.category] = [];
    groups[contaminant.category].push(contaminant);
    return groups;
  }, {});
}

function getLabValues(profile) {
  return profile.labValues || {};
}

function hasEnteredLabValue(labValue) {
  return Boolean(labValue && labValue.value !== undefined);
}

function getRowsForProfile(profileId) {
  const state = getAppState();
  const profile = state.profiles[profileId];
  const siteInfo = getProfileSiteInfo(profile);
  const selected = getSelectedContaminants(csrData, profileId);
  const labValues = getLabValues(profile);

  return selected.map((contaminant) => {
    const labValue = labValues[contaminant.id] || null;
    const unitDef = getUnitDef(labValue?.unit || DEFAULT_LAB_UNIT);
    const result = getResultForLabValue(contaminant, labValue, siteInfo);
    const soilThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'soil');
    const groundwaterThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'water');

    return {
      profile,
      siteInfo,
      contaminant,
      labValue,
      unitDef,
      result,
      soilThreshold,
      groundwaterThreshold,
      comparisonThreshold: result.standard,
      displayConcentration: getDisplayConcentration(labValue),
      hasLabValue: hasEnteredLabValue(labValue)
    };
  });
}

function getShowExceedancesOnly() {
  return Boolean(getAppState().ui.showExceedancesOnly);
}

function setExceedanceFilter(value) {
  updateAppUi({ showExceedancesOnly: value });
  renderResults();
}

function formatConvertedValue(row) {
  if (row.result.converted === null || row.result.converted === undefined) return '—';
  return Number(row.result.converted).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function getStatusMarkup(result) {
  return `<span class="result-pill ${result.className}" title="Borderline means 80–100% of the applicable threshold.">${escapeHtml(result.status)}</span>`;
}

function getRecommendationText(exceedCount, filledCount, thresholdLabel) {
  if (!filledCount) {
    return `No lab values were entered. Review the applicable ${thresholdLabel} thresholds before screening measured concentrations.`;
  }

  if (exceedCount > 0) {
    return `One or more contaminants exceed applicable Schedule 3.1 thresholds. A Detailed Site Investigation may be needed to characterize the location, extent, and degree of contamination.`;
  }

  return `This screening did not identify concentrations above the selected Schedule 3.1 thresholds. Use the output as an educational screening summary only.`;
}

function renderSummary(rows) {
  const state = getAppState();
  const profile = getActiveProfile(state);
  const siteInfo = getProfileSiteInfo(profile);
  const thresholdLabel = siteInfo.proposedLandUseLabel || LAND_USE_LABELS[siteInfo.proposedLandUse] || 'selected land use';
  const filled = rows.filter((row) => row.hasLabValue).length;

  resultsSubtitle.textContent = `BC CSR Schedule 3.1 — ${thresholdLabel} standards`;
  reportDate.textContent = `Generated ${new Date().toLocaleDateString()}`;
  currentUse.textContent = siteInfo.currentLandUseLabel || 'Not provided';
  proposedUse.textContent = thresholdLabel || 'Not provided';
  groundwaterStatus.textContent = 'Shown for every selected contaminant';
  contaminantCount.textContent = `${rows.length} selected`;
  labDataCount.textContent = filled === 1 ? '1 value' : `${filled} values`;
  thresholdNote.innerHTML = `Thresholds apply to <strong>${escapeHtml(thresholdLabel)}</strong> land use. Groundwater threshold values are displayed for educational comparison and require pathway review.`;
  comparisonMeta.textContent = `${rows.length} contaminants · ${thresholdLabel} standards`;
}

function renderChart(rows) {
  const visibleRows = getShowExceedancesOnly() ? rows.filter((row) => row.result.status === 'Exceeds') : rows;

  if (!visibleRows.length) {
    resultsChart.innerHTML = '<p class="empty-state">No rows to chart with the current filter.</p>';
    return;
  }

  resultsChart.innerHTML = visibleRows.map((row) => {
    const result = row.result;
    const ratio = typeof result.ratio === 'number' ? result.ratio : null;
    const percent = ratio === null ? 0 : Math.max(2, Math.min(100, ratio * 100));
    const ratioLabel = ratio === null ? result.status : `${ratio.toFixed(ratio >= 10 ? 0 : 2)}x threshold`;

    return `
      <div class="chart-row ${result.className}">
        <div class="chart-label">
          <button class="text-button result-info-btn" type="button" data-action="info" data-id="${escapeHtml(row.contaminant.id)}">${escapeHtml(row.contaminant.name)}</button>
          <span>${escapeHtml(row.displayConcentration)} ${row.labValue ? escapeHtml(row.unitDef.label) : ''}</span>
        </div>
        <div class="chart-track" aria-hidden="true">
          <div class="chart-fill" style="width:${percent}%"></div>
        </div>
        <div class="chart-ratio">${escapeHtml(ratioLabel)}</div>
      </div>
    `;
  }).join('');
}

function renderSingleTable(rows) {
  const hasFilter = getShowExceedancesOnly();
  const visibleRows = hasFilter ? rows.filter((row) => row.result.status === 'Exceeds') : rows;
  const gridColumns = 'minmax(230px, 1.5fr) minmax(90px, 0.55fr) minmax(90px, 0.55fr) minmax(95px, 0.65fr) minmax(70px, 0.4fr) minmax(105px, 0.65fr)';

  if (!rows.length) {
    resultsTable.innerHTML = '<p class="empty-state">No contaminants were selected.</p>';
    return;
  }

  if (!visibleRows.length) {
    resultsTable.innerHTML = '<p class="empty-state">No exceedances found with the current filter.</p>';
    return;
  }

  const grouped = groupContaminants(visibleRows.map((row) => row.contaminant));
  const rowById = Object.fromEntries(visibleRows.map((row) => [row.contaminant.id, row]));

  const groupMarkup = Object.entries(grouped).map(([categoryName, contaminants]) => {
    const rowsMarkup = contaminants.map((contaminant) => {
      const row = rowById[contaminant.id];
      return `
        <div class="result-row ${row.result.className}" style="grid-template-columns: ${gridColumns};">
          <div class="result-substance">
            <button class="text-button result-info-btn" type="button" data-action="info" data-id="${escapeHtml(contaminant.id)}">
              ${escapeHtml(contaminant.name)}
            </button>
            ${contaminant.cas !== 'NS' ? `<span>CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
            <small>${escapeHtml(contaminant.category)}</small>
          </div>
          <div data-label="Soil">${formatThreshold(row.soilThreshold)}</div>
          <div data-label="GW">${formatThreshold(row.groundwaterThreshold)}</div>
          <div data-label="Your Conc.">${escapeHtml(row.displayConcentration)}</div>
          <div data-label="Unit">${row.labValue ? escapeHtml(row.unitDef.label) : '—'}</div>
          <div data-label="Status">${getStatusMarkup(row.result)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="result-group-title">${escapeHtml(categoryName)}</div>
      ${rowsMarkup}
    `;
  }).join('');

  resultsTable.innerHTML = `
    <div class="results-table-head" style="grid-template-columns: ${gridColumns};">
      <span>Contaminant</span>
      <span>Soil</span>
      <span>GW</span>
      <span>Your Conc.</span>
      <span>Unit</span>
      <span>Status</span>
    </div>
    ${groupMarkup}
  `;
}

function renderRecommendation(exceedCount, selectedCount, filledCount, thresholdLabel) {
  const text = getRecommendationText(exceedCount, filledCount, thresholdLabel);

  if (!filledCount) {
    recommendation.className = 'recommendation-card review';
    recommendation.innerHTML = `
      <h2 class="card-heading-with-icon">
        <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#flask-conical"></use></svg>
        Threshold Review Only
      </h2>
      <p>${escapeHtml(text)}</p>
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
      <p>${escapeHtml(text)}</p>
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
    <p>${escapeHtml(text)}</p>
  `;
}

function renderResults() {
  const state = getAppState();
  const activeProfile = getActiveProfile(state);
  const siteInfo = getProfileSiteInfo(activeProfile);
  const thresholdLabel = siteInfo.proposedLandUseLabel || LAND_USE_LABELS[siteInfo.proposedLandUse] || 'selected land use';

  latestRows = getRowsForProfile(state.activeProfileId);
  latestCounts = {
    exceedCount: latestRows.filter((row) => row.result.status === 'Exceeds').length,
    filledCount: latestRows.filter((row) => row.hasLabValue).length,
    selectedCount: latestRows.length
  };

  exceedanceOnlyToggle.checked = getShowExceedancesOnly();

  renderSummary(latestRows);
  renderChart(latestRows);
  renderSingleTable(latestRows);
  renderRecommendation(latestCounts.exceedCount, latestCounts.selectedCount, latestCounts.filledCount, thresholdLabel);
}

function exportResultsCsv() {
  const rows = latestRows;
  const headers = [
    'contaminant_name',
    'cas',
    'category',
    'entered_concentration',
    'display_concentration',
    'unit',
    'converted_value',
    'soil_threshold',
    'groundwater_threshold',
    'selected_comparison_threshold',
    'status',
    'confidence'
  ];
  const lines = [headers.join(',')];

  rows.forEach((row) => {
    lines.push([
      row.contaminant.name,
      row.contaminant.cas,
      row.contaminant.category,
      row.labValue?.value ?? '',
      row.displayConcentration,
      row.labValue ? row.unitDef.label : '',
      formatConvertedValue(row),
      formatThreshold(row.soilThreshold),
      formatThreshold(row.groundwaterThreshold),
      formatThreshold(row.comparisonThreshold),
      row.result.status,
      row.result.confidence
    ].map(csvEscape).join(','));
  });

  const filename = `bc-csr-results-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

function tableCell(text, bold = false) {
  const { TableCell, Paragraph, TextRun } = window.docx;
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold })] })]
  });
}

function exportWordReport() {
  if (!window.docx) {
    window.alert('Word export library could not be loaded. Check your internet connection and try again.');
    return;
  }

  const { Document, Packer, Paragraph, TextRun, Table, TableRow, HeadingLevel } = window.docx;
  const profile = getActiveProfile();
  const siteInfo = getProfileSiteInfo(profile);
  const thresholdLabel = siteInfo.proposedLandUseLabel || 'selected land use';
  const today = new Date().toLocaleDateString();
  const recommendationText = getRecommendationText(latestCounts.exceedCount, latestCounts.filledCount, thresholdLabel);
  const resultRows = latestRows.map((row) => new TableRow({
    children: [
      tableCell(row.contaminant.name),
      tableCell(row.contaminant.cas),
      tableCell(row.displayConcentration),
      tableCell(row.labValue ? row.unitDef.label : ''),
      tableCell(formatThreshold(row.soilThreshold)),
      tableCell(formatThreshold(row.groundwaterThreshold)),
      tableCell(row.result.status)
    ]
  }));

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'BC CSR Screening Report', heading: HeadingLevel.TITLE }),
        new Paragraph(`Date generated: ${today}`),
        new Paragraph('Educational use only. Not professional environmental advice or a formal ESA. Verify current BC CSR requirements before relying on results.'),
        new Paragraph({ text: 'Land Use Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`Current land use: ${siteInfo.currentLandUseLabel || 'Not provided'}`),
        new Paragraph(`Proposed land use: ${thresholdLabel}`),
        new Paragraph(`Selected thresholds: Schedule 3.1 soil and groundwater threshold values`),
        new Paragraph({ text: 'Results Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`${latestCounts.exceedCount} exceedance(s), ${latestCounts.filledCount} evaluated lab value(s), ${latestCounts.selectedCount} selected contaminant(s).`),
        new Table({
          rows: [
            new TableRow({
              children: ['Contaminant', 'CAS', 'Concentration', 'Unit', 'Soil threshold', 'GW threshold', 'Status'].map((heading) => tableCell(heading, true))
            }),
            ...resultRows
          ]
        }),
        new Paragraph({ text: 'Recommendation', heading: HeadingLevel.HEADING_1 }),
        new Paragraph(recommendationText)
      ]
    }]
  });

  Packer.toBlob(doc).then((blob) => {
    downloadBlob(blob, `bc-csr-screening-report-${new Date().toISOString().slice(0, 10)}.docx`);
  }).catch(() => {
    window.alert('Word export failed. Please try again or use PDF/CSV export.');
  });
}

resultsTable.addEventListener('click', (event) => {
  const infoButton = event.target.closest('[data-action="info"]');
  if (!infoButton || !csrData) return;
  const contaminant = csrData.contaminants.find((item) => item.id === infoButton.dataset.id);
  openContaminantDrawer(contaminant, infoButton);
});

resultsChart.addEventListener('click', (event) => {
  const infoButton = event.target.closest('[data-action="info"]');
  if (!infoButton || !csrData) return;
  const contaminant = csrData.contaminants.find((item) => item.id === infoButton.dataset.id);
  openContaminantDrawer(contaminant, infoButton);
});

function setExportMenuOpen(menu, isOpen) {
  const menuList = menu.querySelector('.export-menu-list');
  const menuButton = menu.querySelector('[data-export-menu-btn]');

  menuList.hidden = !isOpen;
  menuButton.setAttribute('aria-expanded', String(isOpen));
}

function closeExportMenus(exceptMenu = null) {
  exportMenus.forEach((menu) => {
    if (menu !== exceptMenu) setExportMenuOpen(menu, false);
  });
}

exceedanceOnlyToggle.addEventListener('change', () => setExceedanceFilter(exceedanceOnlyToggle.checked));

exportMenus.forEach((menu) => {
  const menuButton = menu.querySelector('[data-export-menu-btn]');
  const menuList = menu.querySelector('.export-menu-list');

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const shouldOpen = menuList.hidden;
    closeExportMenus(menu);
    setExportMenuOpen(menu, shouldOpen);
  });

  menu.addEventListener('mouseleave', () => {
    setExportMenuOpen(menu, false);
  });

  menuList.addEventListener('click', () => {
    setExportMenuOpen(menu, false);
  });

  menuList.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setExportMenuOpen(menu, false);
      menuButton.focus();
    }
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.export-menu')) {
    closeExportMenus();
  }
});

printButtons.forEach((button) => button.addEventListener('click', () => window.print()));

csvExportButtons.forEach((button) => button.addEventListener('click', exportResultsCsv));
wordExportButtons.forEach((button) => button.addEventListener('click', exportWordReport));

newAssessmentButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!window.confirm('Start a new assessment and clear saved local progress?')) return;
    clearAssessment();
    window.location.href = 'index.html';
  });
});

fetch('data.json')
  .then((response) => response.json())
  .then((data) => {
    csrData = data;
    renderResults();
  })
  .catch(() => {
    resultsTable.innerHTML = `
      <p class="empty-state">
        Could not load data.json. Run this site through a local server such as
        VS Code Live Server or python3 -m http.server.
      </p>
    `;
  });
