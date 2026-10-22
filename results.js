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
const csvExportButtons = [...document.querySelectorAll('[data-csv-export-btn]')];
if (new URLSearchParams(window.location.search).get('from') === 'saved') {
  document.querySelectorAll('[data-results-back]').forEach(link => { link.href = 'account.html#saved'; });
}

let csrData = null;
let latestRows = [];
let factorDisclosureIndex = 0;
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

function resultFactorMarkup(matrix) {
  const result=matrix.result;
  const factors=result.comparisons.filter(c=>c.applicability!=='not_applicable').map(c=>{
    const source=csrData.sources[String(c.part)];
    const url=`${source.url}#page=${c.pages[0] || 1}`;
    const standard=c.raw ? `${c.raw}${c.raw==='NS'?'':` ${c.unit}`}` : 'Blank / unavailable';
    const state=c.applicability==='not_assessed'?'Not assessed':c.status==='Inconclusive' && c.threshold===null?'Requires review':c.status==='Pass'?'Below standard':c.status;
    const tone=state==='Exceeds'?'exceeds':state==='Below standard'?'below':'review';
    return `<tr><th scope="row">${escapeHtml(c.label)}</th><td class="result-factor-standard">${state==='Exceeds'?'<span aria-hidden="true">⚠️</span> ':''}${escapeHtml(standard)}</td><td><span class="factor-comparison factor-comparison--${tone}">${escapeHtml(state)}</span></td><td><a href="${escapeHtml(url)}" aria-label="Official source: ${escapeHtml(c.source)}" target="_blank" rel="noopener">Part ${c.part}, p. ${escapeHtml(c.pages.join(', '))}</a></td></tr>`;
  }).join('');
  return `<div class="result-factor-scroll" role="region" aria-label="Standards by factor" tabindex="0"><table class="result-factor-table"><thead><tr><th scope="col">Soil protection factor</th><th scope="col">Standard</th><th scope="col">Comparison</th><th scope="col">Source</th></tr></thead><tbody>${factors}</tbody></table></div>`;
}

function resultFactorToggle(panelId, contaminant) {
  return `<button type="button" class="result-factor-toggle" data-factor-toggle aria-controls="${panelId}" aria-expanded="false" aria-label="Standards by factor for ${escapeHtml(contaminant.name)}">Standards by factor</button>`;
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
    return `<section class="result-sample"><h3>${escapeHtml(identity)}</h3>${scenarios.size===1?`<p class="result-scenario">${escapeHtml([...scenarios][0])}</p>`:''}<div class="sample-table-wrap"><table class="sample-table result-rows-table"><thead><tr><th scope="col">Contaminant</th>${scenarios.size>1?'<th scope="col">Land use</th>':''}<th scope="col">Measured</th><th scope="col">Threshold</th><th scope="col">Result</th></tr></thead><tbody>${group.flatMap(row=>row.matrices.map(matrix=>{const panelId=`result-factor-${++factorDisclosureIndex}`;return `<tr><th scope="row">${resultChemicalName(row.contaminant)}${resultFactorToggle(panelId,row.contaminant)}</th>${scenarios.size>1?`<td>${escapeHtml(matrix.label)}</td>`:''}<td class="result-number" data-label="Measured">${escapeHtml(resultMeasurement(matrix))}</td><td class="result-number" data-label="Threshold">${escapeHtml(resultThreshold(matrix))}</td><td data-label="Result">${getStatusMarkup(matrix.result)}</td></tr><tr id="${panelId}" class="result-provenance-row" hidden><td colspan="${scenarios.size>1?5:4}">${resultFactorMarkup(matrix)}</td></tr>`;})).join('')}</tbody></table></div></section>`;
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
      const panelId=`result-factor-${++factorDisclosureIndex}`;
      const heading=byCategory && category!==chemical.category ? `<tr class="result-category-row"><th scope="rowgroup" colspan="${samples.length+2}">${escapeHtml(chemical.category)}</th></tr>` : '';
      category=chemical.category;
      return `${heading}<tr><th scope="row">${resultChemicalName(chemical)}${resultFactorToggle(panelId,chemical)}</th><td class="result-number">${escapeHtml(resultThreshold(matrix))}</td>${values.map(m=>`<td>${!m?'<span class="result-missing">No value</span>':!matchesResultFilter(m,filter)?'<span class="result-missing">Filtered out</span>':`<span class="result-number">${escapeHtml(resultMeasurement(m))}</span>${getStatusMarkup(m.result)}`}</td>`).join('')}</tr><tr id="${panelId}" class="result-provenance-row" hidden><td colspan="${samples.length+2}">${resultFactorMarkup(matrix)}</td></tr>`;
    }).join('');
    if(!body) return '';
    return `<section class="result-sample"><h3>${escapeHtml(label)}</h3><div class="sample-table-wrap" role="region" aria-label="${escapeHtml(label)} sample matrix" tabindex="0"><table class="sample-table result-matrix-table"><thead><tr><th scope="col">Contaminant</th><th scope="col">Threshold</th>${samples.map(s=>`<th scope="col">${s.apec?`${escapeHtml(s.apec.name)}<small>${escapeHtml(s.sample.name)}</small>`:'Measured'}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }).join('');
}

function renderResultCards(rows) {
  factorDisclosureIndex = 0;
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
  const now=new Date();
  const pad=value=>String(value).padStart(2,'0');
  const date=[now.getFullYear(),pad(now.getMonth()+1),pad(now.getDate())].join('-');
  const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(pad).join('-');
  downloadBlob(new Blob(['\uFEFF',lines.join('\n')],{type:'text/csv;charset=utf-8'}),`bc-csr-results-${date}_${time}.csv`);
}

resultsTable.addEventListener('click', (event) => {
  const factorToggle = event.target.closest('[data-factor-toggle]');
  if (factorToggle) {
    const panel = document.getElementById(factorToggle.getAttribute('aria-controls'));
    const expanded = factorToggle.getAttribute('aria-expanded') === 'true';
    panel.hidden = expanded;
    factorToggle.setAttribute('aria-expanded', String(!expanded));
    return;
  }
  const infoButton = event.target.closest('[data-action="info"]');
  if (!infoButton || !csrData) return;
  const contaminant = csrData.contaminants.find((item) => item.id === infoButton.dataset.id);
  openContaminantDrawer(contaminant, infoButton);
});

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

window.addEventListener('bc-csr-preferences-applied', () => {
  if (!csrData) return;
  restoreResultControls();
  renderResultCards(latestRows);
});
