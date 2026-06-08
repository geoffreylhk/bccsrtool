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
const recommendation = document.getElementById('recommendation');
const exportMenus = [...document.querySelectorAll('.export-menu')];
const printButtons = [...document.querySelectorAll('[data-print-btn]')];
const csvExportButtons = [...document.querySelectorAll('[data-csv-export-btn]')];
const wordExportButtons = [...document.querySelectorAll('[data-word-export-btn]')];
const newAssessmentButtons = [...document.querySelectorAll('[data-new-assessment-btn]')];

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

function hasConcentration(value) {
  return value !== undefined && value !== null && value !== '';
}

function getMatrixResult(matrix, concentration, unit, threshold) {
  const hasValue = hasConcentration(concentration);
  const unitDef = getUnitDef(unit || (matrix === 'soil' ? DEFAULT_SOIL_UNIT : DEFAULT_GW_UNIT));
  const numericThreshold = getNumericThreshold(threshold);
  const converted = hasValue ? Number(concentration) * unitDef.factor : null;

  if (!hasValue || numericThreshold === null) {
    return {
      status: 'No data',
      className: 'neutral',
      converted,
      percentLabel: '—',
      percentValue: null
    };
  }

  const exceeds = converted > numericThreshold;
  const percentValue = numericThreshold === 0
    ? 0
    : Math.round((Math.abs(converted - numericThreshold) / numericThreshold) * 100);

  return {
    status: exceeds ? 'Exceeds' : 'Below',
    className: exceeds ? 'exceeds' : 'below',
    converted,
    percentLabel: `${percentValue}% ${exceeds ? 'above' : 'below'}`,
    percentValue
  };
}

function getRowsForProfile(profileId) {
  const state = getAppState();
  const profile = state.profiles[profileId];
  const siteInfo = getProfileSiteInfo(profile);
  const selected = getAssessmentContaminants(csrData, profileId);

  return selected.map((contaminant) => {
    const soilThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'soil');
    const groundwaterThreshold = getThreshold(contaminant, siteInfo.proposedLandUse, 'water');
    const matrices = [
      {
        key: 'soil',
        label: 'Soil',
        concentration: contaminant.soilConc,
        unit: contaminant.soilUnit || DEFAULT_SOIL_UNIT,
        threshold: soilThreshold
      },
      {
        key: 'groundwater',
        label: 'Groundwater',
        concentration: contaminant.gwConc,
        unit: contaminant.gwUnit || DEFAULT_GW_UNIT,
        threshold: groundwaterThreshold
      }
    ].map((matrix) => ({
      ...matrix,
      unitDef: getUnitDef(matrix.unit),
      result: getMatrixResult(matrix.key, matrix.concentration, matrix.unit, matrix.threshold),
      displayConcentration: hasConcentration(matrix.concentration)
        ? Number(matrix.concentration).toLocaleString()
        : '—',
      hasLabValue: hasConcentration(matrix.concentration)
    }));

    return {
      profile,
      siteInfo,
      contaminant,
      matrices,
      hasLabValue: matrices.some((matrix) => matrix.hasLabValue)
    };
  });
}

function getMatrixRows(rows) {
  return rows.flatMap((row) => row.matrices.map((matrix) => ({
    ...matrix,
    contaminant: row.contaminant
  })));
}

function formatConvertedValue(row) {
  if (row.result.converted === null || row.result.converted === undefined) return '—';
  return Number(row.result.converted).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function getStatusMarkup(result) {
  return `<span class="result-pill ${result.className}">${escapeHtml(result.status)}</span>`;
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
  const filled = getMatrixRows(rows).filter((row) => row.hasLabValue).length;

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

function getResultProgress(matrix) {
  const numericThreshold = getNumericThreshold(matrix.threshold);
  if (!matrix.hasLabValue || numericThreshold === null || numericThreshold <= 0) return 0;
  return Math.max(2, Math.min(100, (matrix.result.converted / numericThreshold) * 100));
}

function renderMediaCard(matrix) {
  const statusClass = matrix.result.className;
  const progress = getResultProgress(matrix);
  const measured = matrix.hasLabValue ? matrix.displayConcentration : '—';
  const threshold = formatThreshold(matrix.threshold);

  return `
    <article class="result-media-card ${statusClass}">
      <div class="result-media-card__header">
        <h4 class="result-media-card__title ${matrix.key}">
          <span class="matrix-dot" aria-hidden="true"></span>
          ${escapeHtml(matrix.label)}
        </h4>
        ${getStatusMarkup(matrix.result)}
      </div>
      <p class="result-media-card__values">
        <strong>${escapeHtml(measured)}</strong>
        <span aria-hidden="true">/</span>
        <span>${escapeHtml(threshold)} ${escapeHtml(matrix.unitDef.label)}</span>
      </p>
      <div class="result-media-card__track" aria-hidden="true">
        <span class="result-media-card__fill" style="width:${progress}%"></span>
      </div>
      <p class="result-media-card__percent">${escapeHtml(matrix.result.percentLabel)}</p>
    </article>
  `;
}

function renderResultCards(rows) {
  if (!rows.length) {
    resultsTable.innerHTML = '<p class="empty-state">No contaminants were selected.</p>';
    return;
  }

  const grouped = rows.reduce((groups, row) => {
    const category = row.contaminant.category;
    if (!groups[category]) groups[category] = [];
    groups[category].push(row);
    return groups;
  }, {});

  const groupMarkup = Object.entries(grouped).map(([categoryName, groupRows]) => {
    const rowsMarkup = groupRows.map((row) => {
      const contaminant = row.contaminant;
      const mediaCards = row.matrices.map(renderMediaCard).join('');

      return `
        <section class="result-card-contaminant">
          <header class="result-card-contaminant__header">
            <button class="text-button result-info-btn" type="button" data-action="info" data-id="${escapeHtml(contaminant.id)}">
              ${escapeHtml(contaminant.name)}
            </button>
            ${contaminant.cas !== 'NS' ? `<span>CAS ${escapeHtml(contaminant.cas)}</span>` : ''}
          </header>
          <div class="result-media-grid">
            ${mediaCards}
          </div>
        </section>
      `;
    }).join('');

    return `
      <section class="result-card-category">
        <h3 class="result-card-category__title">${escapeHtml(categoryName)}</h3>
        ${rowsMarkup}
      </section>
    `;
  }).join('');

  resultsTable.innerHTML = groupMarkup;
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
      <p>${exceedCount} of ${filledCount} evaluated measurements exceed BC CSR thresholds for ${escapeHtml(thresholdLabel)}.</p>
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
    <p>0 of ${filledCount} evaluated measurements exceed applicable BC CSR thresholds for ${escapeHtml(thresholdLabel)}.</p>
    <p>${escapeHtml(text)}</p>
  `;
}

function renderResults() {
  const state = getAppState();
  const activeProfile = getActiveProfile(state);
  const siteInfo = getProfileSiteInfo(activeProfile);
  const thresholdLabel = siteInfo.proposedLandUseLabel || LAND_USE_LABELS[siteInfo.proposedLandUse] || 'selected land use';

  latestRows = getRowsForProfile(state.activeProfileId);
  const matrixRows = getMatrixRows(latestRows);
  latestCounts = {
    exceedCount: matrixRows.filter((row) => row.result.status === 'Exceeds').length,
    filledCount: matrixRows.filter((row) => row.hasLabValue).length,
    selectedCount: latestRows.length
  };

  renderSummary(latestRows);
  renderResultCards(latestRows);
  renderRecommendation(latestCounts.exceedCount, latestCounts.selectedCount, latestCounts.filledCount, thresholdLabel);
}

function exportResultsCsv() {
  const rows = latestRows;
  const headers = [
    'contaminant_name',
    'cas',
    'category',
    'matrix',
    'entered_concentration',
    'display_concentration',
    'unit',
    'converted_value',
    'threshold',
    'status',
    'vs_threshold'
  ];
  const lines = [headers.join(',')];

  getMatrixRows(rows).forEach((row) => {
    lines.push([
      row.contaminant.name,
      row.contaminant.cas,
      row.contaminant.category,
      row.label,
      row.concentration ?? '',
      row.displayConcentration,
      row.unitDef.label,
      formatConvertedValue(row),
      formatThreshold(row.threshold),
      row.result.status,
      row.result.percentLabel
    ].map(csvEscape).join(','));
  });

  const filename = `bc-csr-results-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(new Blob(['\uFEFF', lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
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
  const resultRows = getMatrixRows(latestRows).map((row) => new TableRow({
    children: [
      tableCell(row.contaminant.name),
      tableCell(row.contaminant.cas),
      tableCell(row.label),
      tableCell(row.displayConcentration),
      tableCell(row.unitDef.label),
      tableCell(formatThreshold(row.threshold)),
      tableCell(row.result.status),
      tableCell(row.result.percentLabel)
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
              children: ['Contaminant', 'CAS', 'Matrix', 'Concentration', 'Unit', 'Threshold', 'Status', 'vs Threshold'].map((heading) => tableCell(heading, true))
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

exportMenus.forEach((menu) => {
  const menuButton = menu.querySelector('[data-export-menu-btn]');
  const menuList = menu.querySelector('.export-menu-list');

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const shouldOpen = menuList.hidden;
    closeExportMenus(menu);
    setExportMenuOpen(menu, shouldOpen);
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
