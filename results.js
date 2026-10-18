const resultsSubtitle = document.getElementById('resultsSubtitle');
const reportDate = document.getElementById('reportDate');
const currentUse = document.getElementById('currentUse');
const proposedUse = document.getElementById('proposedUse');
const groundwaterStatus = document.getElementById('groundwaterStatus');
const contaminantCount = document.getElementById('contaminantCount');
const labDataCount = document.getElementById('labDataCount');
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
let latestCounts = { exceedCount: 0, enteredCount: 0, evaluatedCount: 0, reviewCount: 0, selectedCount: 0 };
const REPORT_DISCLAIMER = 'Educational use only. Not professional environmental advice or a formal ESA. Verify current BC CSR requirements and pathway applicability before relying on results.';
const REGULATION_URL = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/375_96_00';


function getRowsForProfile(profileId) {
  const profile = getAppState().profiles[profileId];
  const siteInfo = getProfileSiteInfo(profile);
  const samples=getSoilSamples(profile);
  if(samples.length) return getSampleScreeningRows(csrData,profile);
  return getAssessmentContaminants(csrData,profileId).map(contaminant=>({profile,siteInfo,contaminant,matrices:getAssessmentScenarios(profile).map(({scenario,landUse})=>{
    const result=screenSoil(contaminant,'',DEFAULT_SOIL_UNIT,landUse,{factors:profile.factors,multipleLandUses:profile.multipleLandUses});
    return {key:'soil',label:`${scenario} — ${LAND_USE_LABELS[landUse] || 'Unselected'}`,scenario,landUse,concentration:'',unit:DEFAULT_SOIL_UNIT,unitDef:getUnitDef(DEFAULT_SOIL_UNIT),threshold:result.threshold,thresholdUnit:DEFAULT_SOIL_UNIT,result,displayConcentration:'—',hasLabValue:false};
  })}));
}

function getMatrixRows(rows) {
  return rows.flatMap((row) => row.matrices.map((matrix) => ({
    ...matrix,
    apec:row.apec,location:row.location,sample:row.sample,analytical:row.analytical,
    contaminant: row.contaminant
  })));
}

function formatConvertedValue(row) {
  if (row.result.converted === null || row.result.converted === undefined) return '—';
  return formatNumber(row.result.converted);
}

function getStatusMarkup(result) {
  return `<span class="result-pill ${result.className}">${escapeHtml(result.status)}</span>`;
}

function getRecommendationText(counts, thresholdLabel) {
  if (!counts.enteredCount) {
    return `No lab values were entered. Review the applicable ${thresholdLabel} thresholds before screening measured concentrations.`;
  }

  const review = counts.reviewCount
    ? ` ${counts.reviewCount} soil scenario(s) have unresolved applicability or source conditions. No confirmed pass is made for those scenarios.` : '';
  if (counts.exceedCount > 0) {
    return `One or more evaluated scenario comparisons exceed the selected Schedule 3.1 thresholds. A Detailed Site Investigation may be needed to characterize the location, extent, and degree of contamination.${review}`;
  }
  if (!counts.evaluatedCount) return `No entered measurements could be compared with a numeric threshold.${review}`;
  return `No exceedances were identified among ${counts.evaluatedCount} evaluated scenario comparison(s).${review} Use the output as an educational screening summary only.`;
}

function getResultCounts(rows) {
  const matrixRows = getMatrixRows(rows);
  return {
    exceedCount: matrixRows.filter((row) => row.result.status === 'Exceeds').length,
    enteredCount: matrixRows.filter((row) => row.hasLabValue).length,
    evaluatedCount: matrixRows.filter((row) => row.result.evaluated).length,
    reviewCount: matrixRows.filter((row) => row.hasLabValue && (row.result.uncertainties?.length || row.result.status === 'No numerical standard')).length,
    selectedCount: new Set(rows.map(row=>row.contaminant.id)).size
  };
}

function getReportContext() {
  const siteInfo = getProfileSiteInfo(getActiveProfile());
  return {
    site_id:getActiveProfile().siteId,
    site_name:getActiveProfile().siteName || '',
    factor_selections:JSON.stringify(getActiveProfile().factors),
    factor_justifications:JSON.stringify(getActiveProfile().factorJustifications),
    assessment_mode:getActiveProfile().assessmentMode,
    generated_at: new Date().toISOString(),
    dataset: csrData.metadata.title,
    dataset_version: csrData.metadata.last_amended,
    current_land_use: siteInfo.currentLandUseLabel || 'Not provided',
    proposed_land_use: siteInfo.proposedLandUseLabel || 'Not provided',
    regulation_url: REGULATION_URL,
    disclaimer: REPORT_DISCLAIMER,
    pathway_note: 'Schedule 3.1 soil only. Unassessed factors and unsupported conditions prevent a confirmed pass. Source URLs: ' + Object.values(csrData.sources).map((source) => source.url).join(' ; ')
  };
}

function getReportRows(rows) {
  return getMatrixRows(rows).filter(row=>!latestCounts.enteredCount || row.hasLabValue).flatMap((row) => row.result.comparisons.filter(c=>c.applicability!=='not_applicable').map((comparison) => ({
    ...row,
    label: `${row.scenario || ''} ${row.landUse} — ${comparison.label}${row.result.controls.includes(comparison.label)?' (controlling standard)':''}`,
    threshold: comparison.threshold,
    thresholdUnit: comparison.unit,
    standardText: comparison.raw || 'Blank / unavailable',
    thresholdSource: `${comparison.source}; ${csrData.sources[comparison.part].url}`,
    result: { ...row.result, status: comparison.status,
      percentLabel: comparison.ratio !== null ? `${formatRatio(comparison.ratio)}×` : '—',
      guidance: [comparison.reason, `Overall soil scenario: ${row.result.status}`].filter(Boolean).join(' ') }
  })));
}

function renderSummary(rows) {
  const state = getAppState();
  const profile = getActiveProfile(state);
  const siteInfo = getProfileSiteInfo(profile);
  const thresholdLabel = getAssessmentScenarios(profile).map(s=>`${s.scenario}: ${LAND_USE_LABELS[s.landUse] || 'Unselected'}`).join(' / ');
  const filled = rows.filter(row=>row.matrices.some(matrix=>matrix.hasLabValue)).length;

  resultsSubtitle.textContent = `BC CSR Schedule 3.1 — ${thresholdLabel} standards`;
  reportDate.textContent = `Generated ${new Date().toLocaleDateString()} · Source snapshot: ${csrData.metadata.last_amended}`;
  currentUse.textContent = siteInfo.currentLandUseLabel || 'Not provided';
  proposedUse.textContent = siteInfo.proposedLandUseLabel || 'Not provided';
  groundwaterStatus.textContent = 'Soil protection factors only; no water screening';
  contaminantCount.textContent = `${latestCounts.selectedCount} selected`;
  labDataCount.textContent = filled === 1 ? '1 value' : `${filled} values`;
  comparisonMeta.textContent = `${getSoilSamples(profile).length} samples · ${latestCounts.selectedCount} contaminants`;
}

function matchesResultFilter(matrix, filter) {
  return filter === 'all' || filter === 'exceeds' && matrix.result.status === 'Exceeds'
    || filter === 'review' && matrix.hasLabValue && (matrix.result.uncertainties.length || matrix.result.status === 'No numerical standard');
}

function resultMeasurement(matrix) {
  if (matrix.qualifier === 'non_detect' && !hasConcentration(matrix.reportingLimit)) return 'No detection';
  if (!matrix.hasLabValue) return '—';
  return `${matrix.displayConcentration} ${matrix.unitDef.label}`;
}

function resultThreshold(matrix) {
  return matrix.threshold === null ? 'Unresolved' : `${formatThreshold(matrix.threshold)} ${matrix.thresholdUnit}`;
}

function resultThresholdMarkup(matrix) {
  return escapeHtml(resultThreshold(matrix))+resultFactorMarkup(matrix);
}

function resultFactorMarkup(matrix) {
  const result=matrix.result;
  const unresolved=result.comparisons.some(c=>c.applicability!=='not_applicable' && c.status==='Inconclusive' && c.threshold===null);
  const controls=result.controls.length ? `${unresolved?'Lowest resolved factor':'Controlling factor'}: ${result.controls.join('; ')}` : 'No resolved numerical factor';
  const factors=result.comparisons.map(c=>{
    const source=csrData.sources[String(c.part)];
    const url=`${source.url}#page=${c.pages[0] || 1}`;
    const standard=c.raw ? `${c.raw}${c.raw==='NS'?'':` ${c.unit}`}` : 'Blank / unavailable';
    const state=c.applicability==='not_applicable'?'Not applicable':c.applicability==='not_assessed'?'Not assessed':c.status==='Inconclusive' && c.threshold===null?'Requires review':c.status;
    return `<div><dt>${escapeHtml(c.label)}${result.controls.includes(c.label)?' (controlling)':''}</dt><dd><span class="result-factor-standard">${escapeHtml(standard)}</span><span>${escapeHtml(state)}</span><a href="${escapeHtml(url)}" aria-label="Official source: ${escapeHtml(c.source)}" target="_blank" rel="noopener">Part ${c.part}, p. ${escapeHtml(c.pages.join(', '))}</a></dd></div>`;
  }).join('');
  return `<small class="result-control-factor">${escapeHtml(controls)}</small><details class="result-standard-details"><summary>Standards by factor</summary><dl class="result-factor-list">${factors}</dl></details>`;
}

function resultChemicalName(contaminant) {
  return `${escapeHtml(contaminant.name)}<small>CAS ${escapeHtml(contaminant.cas)}</small>`;
}

function renderSlimResults(rows, filter) {
  const entered=rows.some(row=>row.matrices.some(m=>m.hasLabValue));
  const groups=new Map();
  for(const row of rows) {
    if(entered && !row.matrices.some(m=>m.hasLabValue)) continue;
    const matrices=row.matrices.filter(m=>matchesResultFilter(m,filter));
    if(!matrices.length) continue;
    const key=row.sample?.id || 'thresholds';
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({...row,matrices});
  }
  return [...groups.values()].map(group=>{
    const first=group[0];
    const identity=first.sample ? `${first.apec.name} → ${first.sample.name}` : 'Thresholds only';
    const scenarios=new Set(group.flatMap(row=>row.matrices.map(m=>m.label)));
    return `<section class="result-sample"><h3>${escapeHtml(identity)}</h3>${scenarios.size===1?`<p class="result-scenario">${escapeHtml([...scenarios][0])}</p>`:''}<div class="sample-table-wrap"><table class="sample-table result-rows-table"><thead><tr><th scope="col">Contaminant</th>${scenarios.size>1?'<th scope="col">Land use</th>':''}<th scope="col">Measured</th><th scope="col">Threshold</th><th scope="col">Result</th></tr></thead><tbody>${group.flatMap(row=>row.matrices.map(matrix=>`<tr><th scope="row">${resultChemicalName(row.contaminant)}</th>${scenarios.size>1?`<td>${escapeHtml(matrix.label)}</td>`:''}<td class="result-number" data-label="Measured">${escapeHtml(resultMeasurement(matrix))}</td><td class="result-number" data-label="Threshold">${escapeHtml(resultThreshold(matrix))}</td><td data-label="Result">${getStatusMarkup(matrix.result)}</td></tr><tr class="result-provenance-row"><td colspan="${scenarios.size>1?5:4}">${resultFactorMarkup(matrix)}</td></tr>`)).join('')}</tbody></table></div></section>`;
  }).join('');
}

function sortedResultChemicals(rows) {
  const unique=[...new Map(rows.map(row=>[row.contaminant.id,row.contaminant])).values()];
  const type=document.getElementById('resultSort')?.value || 'category';
  const dataOrder=new Map(csrData.contaminants.map((c,i)=>[c.id,i]));
  if(type==='alpha') unique.sort((a,b)=>a.name.localeCompare(b.name));
  else if(type==='category') {
    const categories=Object.keys(csrData.contaminantCategories);
    if(document.getElementById('resultSortDirection')?.dataset.direction==='desc') categories.reverse();
    unique.sort((a,b)=>categories.indexOf(a.category)-categories.indexOf(b.category) || dataOrder.get(a.id)-dataOrder.get(b.id));
  } else {
    const added=new Map(getActiveProfile().selectedContaminants.map((c,i)=>[c.id,i]));
    unique.sort((a,b)=>(added.get(a.id) ?? Infinity)-(added.get(b.id) ?? Infinity));
  }
  if(type!=='category' && document.getElementById('resultSortDirection')?.dataset.direction==='desc') unique.reverse();
  return unique;
}

function renderMatrixResults(rows, filter) {
  const scenarios=new Map();
  for(const row of rows) for(const matrix of row.matrices) {
    const key=matrix.label;
    if(!scenarios.has(key)) scenarios.set(key,[]);
    scenarios.get(key).push({...matrix,contaminant:row.contaminant,sample:row.sample,apec:row.apec});
  }
  const chemicals=sortedResultChemicals(rows);
  const byCategory=document.getElementById('resultSort')?.value==='category';
  return [...scenarios.entries()].map(([label,entries])=>{
    const samples=[...new Map(entries.map(e=>[e.sample?.id || 'thresholds',e])).values()];
    const cells=new Map(entries.map(e=>[JSON.stringify([e.contaminant.id,e.sample?.id || 'thresholds']),e]));
    let category=null;
    const body=chemicals.map(chemical=>{
      const values=samples.map(sample=>cells.get(JSON.stringify([chemical.id,sample.sample?.id || 'thresholds'])));
      if(!values.some(m=>m && matchesResultFilter(m,filter))) return '';
      const matrix=values.find(Boolean);
      const heading=byCategory && category!==chemical.category ? `<tr class="result-category-row"><th scope="rowgroup" colspan="${samples.length+2}">${escapeHtml(chemical.category)}</th></tr>` : '';
      category=chemical.category;
      return `${heading}<tr><th scope="row">${resultChemicalName(chemical)}</th><td class="result-number">${resultThresholdMarkup(matrix)}</td>${values.map(m=>`<td>${!m?'<span class="result-missing">No value</span>':!matchesResultFilter(m,filter)?'<span class="result-missing">Filtered out</span>':`<span class="result-number">${escapeHtml(resultMeasurement(m))}</span>${getStatusMarkup(m.result)}`}</td>`).join('')}</tr>`;
    }).join('');
    if(!body) return '';
    return `<section class="result-sample"><h3>${escapeHtml(label)}</h3><div class="sample-table-wrap" role="region" aria-label="${escapeHtml(label)} sample matrix" tabindex="0"><table class="sample-table result-matrix-table"><thead><tr><th scope="col">Contaminant</th><th scope="col">Threshold</th>${samples.map(s=>`<th scope="col">${s.apec?`${escapeHtml(s.apec.name)}<small>${escapeHtml(s.sample.name)}</small>`:'Measured'}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }).join('');
}

function renderResultCards(rows) {
  const filter=document.getElementById('resultFilter')?.value || 'all';
  const matrix=document.getElementById('resultLayout')?.value==='matrix';
  const sortControls=document.getElementById('resultSortControls');
  if(sortControls) sortControls.hidden=!matrix;
  resultsTable.innerHTML=(matrix?renderMatrixResults(rows,filter):renderSlimResults(rows,filter)) || '<p class="empty-state">No results match this view.</p>';
}

function restoreResultControls() {
  const ui=getAppState().ui;
  const sort=ui.resultsSort || ui.contaminantsSort;
  document.getElementById('resultLayout').value=ui.resultsLayout==='matrix'?'matrix':'rows';
  document.getElementById('resultSort').value=['category','default','alpha'].includes(sort?.type)?sort.type:'category';
  const direction=document.getElementById('resultSortDirection');
  direction.dataset.direction=sort?.direction==='desc'?'desc':'asc';
  direction.textContent=direction.dataset.direction==='desc'?'↑':'↓';
  direction.setAttribute('aria-pressed',String(direction.dataset.direction==='desc'));
}

function renderSampleSummary(rows) {
  const target=document.getElementById('sampleSummary');
  if(!target) return;
  const groups=new Map((getActiveProfile().apecs || []).map(a=>[a.id,[]]));
  for(const row of rows) {
    const key=row.apec?.id || 'thresholds';
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const matrixRows=getMatrixRows(rows);
  const exceeded=[...new Set(matrixRows.filter(r=>r.result.status==='Exceeds').map(r=>r.contaminant.name))];
  const factors=[...new Set(matrixRows.flatMap(r=>r.result.comparisons.filter(c=>c.status==='Exceeds').map(c=>c.label)))];
  const unresolved=[...new Set(matrixRows.filter(r=>r.hasLabValue).flatMap(r=>r.result.uncertainties))];
  target.innerHTML=`<h2>Site-wide summary</h2><p>${escapeHtml(getActiveProfile().siteName || 'Unnamed site')} · ${getSoilSamples().length} samples · ${latestCounts.enteredCount} sample/contaminant scenarios · ${latestCounts.exceedCount} exceedances · ${latestCounts.reviewCount} requiring review</p><div class="sample-table-wrap"><table class="sample-table"><thead><tr><th>APEC</th><th>Samples</th><th>Evaluated</th><th>Exceeds</th><th>Review</th></tr></thead><tbody>${[...groups.entries()].map(([id,group])=>{const counts=getResultCounts(group),apec=getActiveProfile().apecs?.find(a=>a.id===id);return `<tr><th scope="row">${escapeHtml(apec?.name || group[0]?.apec?.name || 'Thresholds only')}</th><td>${apec?apec.locations.reduce((sum,l)=>sum+l.samples.length,0):new Set(group.map(r=>r.sample?.id).filter(Boolean)).size}</td><td>${counts.evaluatedCount}</td><td>${counts.exceedCount}</td><td>${counts.reviewCount}</td></tr>`;}).join('')}</tbody></table></div><p><strong>Contaminants exceeding:</strong> ${escapeHtml(exceeded.join(', ') || 'None identified')}</p><p><strong>Factors causing exceedances:</strong> ${escapeHtml(factors.join('; ') || 'None identified')}</p>${unresolved.length?`<details><summary>Unassessed factors and limitations (${unresolved.length})</summary><ul>${unresolved.map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul></details>`:''}`;
}

function renderRecommendation(counts, thresholdLabel) {
  const text = getRecommendationText(counts, thresholdLabel);

  recommendation.hidden = !counts.enteredCount;
  if (!counts.enteredCount) {
    recommendation.innerHTML = '';
    return;
  }

  if (counts.exceedCount > 0) {
    recommendation.className = 'recommendation-card exceeds';
    recommendation.innerHTML = `
      <h2 class="card-heading-with-icon">
        <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#alert-triangle"></use></svg>
        Exceedance — Further Assessment May Be Needed
      </h2>
      <p>${counts.exceedCount} of ${counts.evaluatedCount} evaluated scenario comparisons exceed the selected BC CSR thresholds for ${escapeHtml(thresholdLabel)}.</p>
      <p>${escapeHtml(text)}</p>
    `;
    return;
  }

  recommendation.className = `recommendation-card ${counts.reviewCount ? 'review' : 'below'}`;
  recommendation.innerHTML = `
    <h2 class="card-heading-with-icon">
      <svg class="icon icon-lg" aria-hidden="true"><use href="assets/icons/ui-sprite.svg#check-circle"></use></svg>
      ${counts.reviewCount ? 'Incomplete Screening — Review Required' : 'No Exceedance Identified in Evaluated Measurements'}
    </h2>
    <p>${counts.evaluatedCount} of ${counts.enteredCount} entered measurements were evaluated for ${escapeHtml(thresholdLabel)}.</p>
    <p>${escapeHtml(text)}</p>
  `;
}

function renderResults() {
  const state = getAppState();
  const activeProfile = getActiveProfile(state);
  const siteInfo = getProfileSiteInfo(activeProfile);
  const thresholdLabel = getAssessmentScenarios(activeProfile).map(s=>`${s.scenario}: ${LAND_USE_LABELS[s.landUse] || 'Unselected'}`).join(' / ');

  latestRows = getRowsForProfile(state.activeProfileId);
  latestCounts = getResultCounts(latestRows);

  renderSummary(latestRows);
  renderResultCards(latestRows);
  renderRecommendation(latestCounts, thresholdLabel);
  renderSampleSummary(latestRows);
}

function exportResultsCsv() {
  const context=getReportContext();
  const headers=['apec_id','apec','location_id','location','sample_id','sample','sample_date','contaminant_id','contaminant','cas','value','unit','qualifier','reporting_limit','matrix','current_standard','current_status','proposed_standard','proposed_status','threshold_unit','converted_unit','threshold_source','review_note','factor_comparisons',...Object.keys(context)];
  const lines=[headers.join(',')];
  for(const row of latestRows.filter(row=>!latestCounts.enteredCount || row.matrices.some(m=>m.hasLabValue))) {
    const current=row.matrices.find(m=>m.scenario==='Current'),proposed=row.matrices.find(m=>m.scenario==='Proposed');
    const comparisons=row.matrices.map(m=>({scenario:m.scenario,landUse:m.landUse,status:m.result.status,factors:m.result.comparisons.map(c=>({...c,url:csrData.sources[c.part].url}))}));
    const analytical=row.analytical;
    lines.push([row.apec?.id,row.apec?.name,row.location?.id,row.location?.name,row.sample?.id,row.sample?.name,row.sample?.date,row.contaminant.id,row.contaminant.name,row.contaminant.cas,analytical?.qualifier==='non_detect'?'':analytical?.value ?? '',analytical?.unit || DEFAULT_SOIL_UNIT,analytical?.qualifier || 'detected',analytical?.reportingLimit ?? '', 'soil',current?.threshold,current?.result.status,proposed?.threshold,proposed?.result.status,DEFAULT_SOIL_UNIT,DEFAULT_SOIL_UNIT,row.matrices.map(m=>m.thresholdSource || '').join(' | '),row.matrices.map(m=>m.result.guidance).filter(Boolean).join(' | '),JSON.stringify(comparisons),...Object.values(context)].map(csvEscape).join(','));
  }
  downloadBlob(new Blob(['\uFEFF',lines.join('\n')],{type:'text/csv;charset=utf-8'}),`bc-csr-results-${new Date().toISOString().slice(0,10)}.csv`);
}

function tableCell(text, width, bold = false) {
  const { TableCell, Paragraph, TextRun, WidthType } = window.docx;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })] })]
  });
}

function exportWordReport() {
  if (!window.docx) {
    window.alert('Word export library could not be loaded. Check your internet connection and try again.');
    return;
  }

  const { Document, Packer, Paragraph, Table, TableRow, HeadingLevel, WidthType, TableLayoutType, PageOrientation } = window.docx;
  const columnWidths = [2000, 1200, 2500, 1000, 700, 1000, 700, 1000, 800, 3500];
  const profile = getActiveProfile();
  const siteInfo = getProfileSiteInfo(profile);
  const thresholdLabel = getAssessmentScenarios(profile).map(s=>`${s.scenario}: ${LAND_USE_LABELS[s.landUse] || 'Unselected'}`).join(' / ');
  const today = new Date().toLocaleDateString();
  const recommendationText = getRecommendationText(latestCounts, thresholdLabel);
  const context = getReportContext();
  const resultRows = getReportRows(latestRows).map((row) => new TableRow({
    children: [
      [row.apec?.name,row.sample?.name,row.sample?.date,row.contaminant.name].filter(Boolean).join(' / '),
      row.contaminant.cas,
      row.label,
      row.displayConcentration,
      row.unitDef.label,
      row.standardText,
      row.thresholdUnit,
      row.result.status,
      row.result.percentLabel,
      `${row.thresholdSource}${row.result.guidance ? `; ${row.result.guidance}` : ''}`
    ].map((text, index) => tableCell(text, columnWidths[index])),
    cantSplit: true
  }));

  const doc = new Document({
    sections: [{
      properties: { page: {
        size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 720, right: 720, bottom: 720, left: 720 }
      } },
      children: [
        new Paragraph({ text: 'BC CSR Screening Report', heading: HeadingLevel.TITLE }),
        new Paragraph(`Date generated: ${today}`),
        new Paragraph(`Site: ${profile.siteName || 'Unnamed site'}; assessment mode: ${profile.assessmentMode}`),
        new Paragraph(`Sample count: ${getSoilSamples(profile).length}. Samples are compared individually; no averaging.`),
        ...Object.entries(profile.factorJustifications || {}).filter(([,text])=>text).map(([key,text])=>new Paragraph(`${SOIL_FACTORS[key]}: ${text}`)),
        new Paragraph(REPORT_DISCLAIMER),
        new Paragraph(`Dataset: ${context.dataset}; source snapshot: ${context.dataset_version}`),
        new Paragraph(`Official regulation: ${context.regulation_url}`),
        new Paragraph(context.pathway_note),
        new Paragraph({ text: 'Land Use Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`Current land use: ${siteInfo.currentLandUseLabel || 'Not provided'}`),
        new Paragraph(`Proposed land use: ${siteInfo.proposedLandUseLabel || 'Not provided'}`),
        new Paragraph(`Scenarios evaluated: ${thresholdLabel}`),
        new Paragraph(`Selected thresholds: Schedule 3.1 soil standards (Parts 1–3)`),
        new Paragraph({ text: 'Results Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph(`${latestCounts.exceedCount} exceedance(s), ${latestCounts.evaluatedCount} evaluated scenario comparison(s), ${latestCounts.reviewCount} scenario comparison(s) requiring review, ${latestCounts.selectedCount} selected contaminant(s).`),
        new Table({
          width: { size: 14400, type: WidthType.DXA },
          columnWidths,
          layout: TableLayoutType.FIXED,
          rows: [
            new TableRow({
              tableHeader: true,
              children: ['Sample / contaminant', 'CAS', 'Land use / factor', 'Result', 'Unit', 'Standard', 'Unit', 'Status', 'Ratio', 'Source / review note'].map((heading, index) => tableCell(heading, columnWidths[index], true))
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

function printReport() {
  const filter=document.getElementById('resultFilter');
  const priorFilter=filter?.value;
  const layout=document.getElementById('resultLayout');
  const priorLayout=layout?.value;
  if(layout) layout.value='rows';
  if(filter) filter.value='all';
  renderResultCards(latestRows);
  const details=[...document.querySelectorAll('.result-standard-details, #sampleSummary details')];
  const previous=details.map(d=>d.open);
  details.forEach(d=>d.open=true);
  const restore=()=>{details.forEach((d,i)=>d.open=previous[i]);if(filter) filter.value=priorFilter;if(layout) layout.value=priorLayout;renderResultCards(latestRows);window.removeEventListener('afterprint',restore);};
  window.addEventListener('afterprint',restore);
  window.print();
}
printButtons.forEach((button) => button.addEventListener('click', printReport));
document.getElementById('resultFilter')?.addEventListener('change',()=>renderResultCards(latestRows));
function saveResultControls() {
  updateAppUi({resultsLayout:document.getElementById('resultLayout').value,resultsSort:{type:document.getElementById('resultSort').value,direction:document.getElementById('resultSortDirection').dataset.direction}});
  renderResultCards(latestRows);
}
document.getElementById('resultLayout')?.addEventListener('change',saveResultControls);
document.getElementById('resultSort')?.addEventListener('change',saveResultControls);
document.getElementById('resultSortDirection')?.addEventListener('click',()=>{
  const button=document.getElementById('resultSortDirection');
  button.dataset.direction=button.dataset.direction==='desc'?'asc':'desc';
  button.textContent=button.dataset.direction==='desc'?'↑':'↓';
  button.setAttribute('aria-pressed',String(button.dataset.direction==='desc'));
  saveResultControls();
});

csvExportButtons.forEach((button) => button.addEventListener('click', exportResultsCsv));
wordExportButtons.forEach((button) => button.addEventListener('click', exportWordReport));

newAssessmentButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!window.confirm('Start a new assessment and clear saved local progress?')) return;
    clearAssessment();
    window.location.href = 'index.html';
  });
});

fetch('data.json?v=20261015-source-audit')
  .then((response) => response.json())
  .then((data) => {
    csrData = data;
    restoreResultControls();
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
