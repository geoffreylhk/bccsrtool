const labTable = document.getElementById('labTable');
const labStatus = document.getElementById('labStatus');
const filledCount = document.getElementById('filledCount');
const csvModal = document.getElementById('csvModal');
const csvText = document.getElementById('csvText');
const csvFile = document.getElementById('csvFile');
const csvPreview = document.getElementById('csvPreview');
const applyCsvBtn = document.getElementById('applyCsvBtn');
let csrData = null;
let latestCsvTrigger = null;

function renderSampleEditor() {
  if(!getActiveProfile().apecs.length) changeSampleData(apecs=>apecs.push(newApec(apecs)));
  const profile=getActiveProfile();
  const contaminants=new Map(csrData.contaminants.map(c=>[c.id,c]));
  labTable.innerHTML=(profile.apecs || []).map(apec=>`
    <section class="sample-apec" data-apec="${escapeHtml(apec.id)}">
      <div class="sample-title-row"><h3><button class="sample-name" type="button" data-action="rename-apec" aria-label="Rename ${escapeHtml(apec.name)}" title="Click to rename">${escapeHtml(apec.name)}</button></h3><button type="button" data-action="delete-apec">Delete APEC</button></div>
      ${(apec.locations || []).flatMap(location=>location.samples.map(sample=>`
            <section class="soil-sample" data-location="${escapeHtml(location.id)}" data-sample="${escapeHtml(sample.id)}">
              <div class="sample-title-row"><h4>${escapeHtml(sample.name)}</h4><button type="button" data-action="delete-sample">Delete sample</button></div>
              <div class="sample-table-wrap"><table class="sample-table"><thead><tr><th>Contaminant</th><th>Detection</th><th>Concentration</th><th>Unit</th></tr></thead><tbody>
              ${sample.results.map(result=>{const substance=contaminants.get(result.contaminantId);return `<tr data-contaminant="${escapeHtml(result.contaminantId)}"><th scope="row">${escapeHtml(substance?.name || 'Unknown substance')}<small>${escapeHtml(substance?.cas || '')}</small></th>
                <td><select aria-label="Detection for ${escapeHtml(substance?.name)}" data-result="qualifier"><option value="detected" ${result.qualifier==='detected'?'selected':''}>Detected</option><option value="non_detect" ${result.qualifier==='non_detect'?'selected':''}>No detection</option></select></td>
                <td><input aria-label="${result.qualifier==='non_detect'?'Reporting limit':'Concentration'} for ${escapeHtml(substance?.name)}" data-result="measurement" type="number" min="0" step="any" value="${escapeHtml(result.qualifier==='non_detect'?result.reportingLimit:result.value)}" placeholder="${result.qualifier==='non_detect'?'Reporting limit':''}"></td>
                <td><select aria-label="Unit for ${escapeHtml(substance?.name)}" data-result="unit">${LAB_UNITS.filter(u=>u.category==='soil').map(u=>`<option ${result.unit===u.label?'selected':''} value="${u.label}">${u.label}</option>`).join('')}</select></td></tr>`;}).join('')}
              </tbody></table></div>
            </section>`)).join('')}
      <button type="button" class="secondary-action compact-action" data-action="add-sample">+ Add sample</button>
    </section>`).join('');
  updateEditorCounts();
}

function updateEditorCounts() {
  const profile=getActiveProfile();
  const samples=getSoilSamples(profile),filled=samples.flatMap(r=>r.sample.results).filter(r=>r.qualifier==='non_detect' || hasConcentration(r.value)).length;
  filledCount.textContent=`${samples.length} samples · ${filled} entered results`;
  document.querySelectorAll('[data-results-label]').forEach(el=>el.textContent=filled ? 'View Results' : 'Show Thresholds Only');
}

function nextName(list,prefix) {
  let index=list.length+1;
  while(list.some(r=>r.name===`${prefix} ${index}`)) index++;
  return `${prefix} ${index}`;
}

function newApec(apecs) {
  const apec={id:newRecordId('apec'),name:nextName(apecs,'Area of Potential Concern'),description:'',locations:[
    {id:newRecordId('location'),name:'Sampling location 1',type:'',samples:[]}
  ]};
  apec.locations[0].samples.push(newSample(apec));
  return apec;
}

function newSample(apec) {
  return {id:newRecordId('sample'),name:nextName(apec.locations.flatMap(l=>l.samples),'Sample'),date:'',results:selectedSampleResults()};
}

function selectedSampleResults() {
  return getActiveProfile().selectedContaminants.map(c=>({contaminantId:c.id,value:'',unit:DEFAULT_SOIL_UNIT,qualifier:'detected',reportingLimit:''}));
}

function sampleHasEnteredData(sample) {
  return Boolean(sample?.date || sample?.results?.some(result =>
    hasConcentration(result.value) || hasConcentration(result.reportingLimit) ||
    result.qualifier === 'non_detect' || (result.unit && result.unit !== DEFAULT_SOIL_UNIT)
  ));
}

labTable.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if(!button) return;
  const action=button.dataset.action;
  if(labTable.querySelector('[aria-invalid="true"]')) {labStatus.textContent='Correct unsaved fields before changing the hierarchy.';return;}
  if(action==='rename-apec') {
    const apec=getActiveProfile().apecs.find(r=>r.id===button.closest('[data-apec]').dataset.apec);
    const kind='apec',record=apec;
    button.outerHTML=`<input data-rename data-field="name" data-kind="${kind}" aria-label="Rename ${escapeHtml(record.name)}" value="${escapeHtml(record.name)}" maxlength="160" required>`;
    const input=labTable.querySelector('[data-rename]');input.focus();input.select();
    return;
  }
  if(action.startsWith('delete-')) {
    const apec=getActiveProfile().apecs.find(r=>r.id===button.closest('[data-apec]')?.dataset.apec);
    const samples=action==='delete-apec'
      ? (apec?.locations || []).flatMap(location=>location.samples)
      : (apec?.locations || []).flatMap(location=>location.samples).filter(sample=>sample.id===button.closest('[data-sample]')?.dataset.sample);
    if(samples.some(sampleHasEnteredData) && !await showSiteDialog('This will delete the selected record and its samples/results from your working assessment.', { title: action === 'delete-apec' ? 'Delete this APEC?' : 'Delete this sample?', confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true })) return;
  }
  try {
    changeSampleData(apecs=>{
      const apec=apecs.find(r=>r.id===button.closest('[data-apec]')?.dataset.apec);
      if(!apec) throw new Error('This APEC is no longer available. Refresh the page before trying again.');
      const location=apec.locations.find(r=>r.id===button.closest('[data-location]')?.dataset.location);
      if(action==='delete-apec') apecs.splice(apecs.indexOf(apec),1);
      if(action==='add-sample') {
        if(!apec.locations.length) apec.locations.push({id:newRecordId('location'),name:'Samples',type:'',samples:[]});
        apec.locations[0].samples.push(newSample(apec));
      }
      if(action==='delete-sample') location.samples=location.samples.filter(r=>r.id!==button.closest('[data-sample]').dataset.sample);
    });
    labStatus.textContent='Saved in this browser.';renderSampleEditor();
  } catch(error) {labStatus.textContent=error.message;}
});

function saveSampleField(event) {
  const input=event.target;
  if(!input.dataset.field && !input.dataset.result) return;
  try {
    if(input.validity?.badInput) throw new Error('Enter a valid number.');
    if(!input.checkValidity()) throw new Error('Correct this field before saving.');
    changeSampleData(apecs=>{
      const apec=apecs.find(r=>r.id===input.closest('[data-apec]').dataset.apec);
      const location=apec.locations.find(r=>r.id===input.closest('[data-location]')?.dataset.location);
      const sample=location?.samples.find(r=>r.id===input.closest('[data-sample]')?.dataset.sample);
      if(input.dataset.result) {
        const result=sample.results.find(r=>r.contaminantId===input.closest('[data-contaminant]').dataset.contaminant);
        if(input.dataset.result==='measurement') {
          if(result.qualifier==='non_detect') result.reportingLimit=input.value;
          else {result.value=input.value;result.reportingLimit='';}
        } else result[input.dataset.result]=input.value;
      } else {
        const target=input.dataset.kind==='apec'?apec:input.dataset.kind==='location'?location:sample;
        target[input.dataset.field]=input.dataset.field==='name'?input.value.trim():input.value;
      }
    });
    input.removeAttribute('aria-invalid');
    if(input.dataset.result==='measurement') input.closest('tr').querySelector('[data-result="qualifier"]').removeAttribute('aria-invalid');
    labStatus.textContent='Saved in this browser.';
    if(event.type==='change') renderSampleEditor(); else updateEditorCounts();
  } catch(error) {input.setAttribute('aria-invalid','true');labStatus.textContent=error.message;}
}
labTable.addEventListener('change',saveSampleField);
labTable.addEventListener('focusout',event=>{if(event.target.hasAttribute('data-rename') && labTable.contains(event.target)) saveSampleField({target:event.target,type:'change'});});
labTable.addEventListener('input',event=>{if(event.target.tagName!=='SELECT' && !event.target.hasAttribute('data-rename')) saveSampleField(event);});
labTable.addEventListener('keydown',event=>{
  if(!event.target.hasAttribute('data-rename')) return;
  if(event.key==='Enter'){event.preventDefault();saveSampleField({target:event.target,type:'change'});}
  if(event.key==='Escape'){event.preventDefault();renderSampleEditor();}
});

document.getElementById('addApecBtn').addEventListener('click',()=>{
  if(labTable.querySelector('[aria-invalid="true"]')) {labStatus.textContent='Correct unsaved fields before adding an APEC.';return;}
  try {changeSampleData(apecs=>apecs.push(newApec(apecs)));renderSampleEditor();} catch(error){labStatus.textContent=error.message;}
});

document.querySelectorAll('[data-results-action]').forEach(button=>button.addEventListener('click',()=>{
  if(labTable.querySelector('[aria-invalid="true"]')) {labStatus.textContent='Correct unsaved fields before continuing.';labTable.querySelector('[aria-invalid="true"]').focus();return;}
  window.location.href='results.html';
}));

function showCsvPreview() {
  try {
    const preview=buildSampleImportPreview(csrData,csvText.value);
    applyCsvBtn.disabled=Boolean(preview.errors.length || !preview.entries.length);
    csvPreview.innerHTML=`<p>${preview.entries.length} results · ${preview.errors.length} errors. Import is applied only when all rows are valid.</p>`+preview.errors.map(e=>`<p class="import-error">Row ${escapeHtml(e.row)}: ${escapeHtml(e.message)}</p>`).join('')+preview.entries.map(r=>`<p>${escapeHtml(r.apec)} / ${escapeHtml(r.sample)} — ${escapeHtml(r.contaminant)}: ${escapeHtml(r.value)} ${escapeHtml(r.unit)}</p>`).join('');
  } catch(error){applyCsvBtn.disabled=true;csvPreview.textContent=error.message;}
}
function closeCsv() {csvModal.classList.remove('is-open');csvModal.setAttribute('aria-hidden','true');latestCsvTrigger?.focus();}
document.querySelectorAll('[data-csv-import]').forEach(button=>button.addEventListener('click',()=>{latestCsvTrigger=button;csvModal.classList.add('is-open');csvModal.setAttribute('aria-hidden','false');csvText.focus();}));
document.querySelectorAll('[data-close-csv]').forEach(button=>button.addEventListener('click',closeCsv));
document.getElementById('previewCsvBtn').addEventListener('click',showCsvPreview);
csvText.addEventListener('input',()=>{applyCsvBtn.disabled=true;csvPreview.textContent='Preview the updated CSV before applying.';});
csvFile.addEventListener('change',async()=>{try{if(csvFile.files[0]){csvText.value=await csvFile.files[0].text();showCsvPreview();}}catch(error){csvPreview.textContent=error.message;applyCsvBtn.disabled=true;}});
applyCsvBtn.addEventListener('click',()=>{try{applySampleImport(csrData,buildSampleImportPreview(csrData,csvText.value));closeCsv();renderSampleEditor();labStatus.textContent='CSV imported and saved.';}catch(error){csvPreview.textContent=error.message;}});
document.addEventListener('keydown',event=>{
  if(!csvModal.classList.contains('is-open')) return;
  if(event.key==='Escape') closeCsv();
  if(event.key==='Tab') {
    const controls=[...csvModal.querySelectorAll('button:not(:disabled),textarea,input')];
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
  }
});

function initializeSampleEditor(data) {
  csrData=data;
  const profile=getActiveProfile();
  const apecs=profile.selectedContaminants.length ? syncSelectedSampleResults(profile.apecs, profile.selectedContaminants) : JSON.parse(JSON.stringify(profile.apecs));
  for(const apec of apecs) {
    if(!apec.locations.length) apec.locations.push({id:newRecordId('location'),name:'Samples',type:'',samples:[]});
    if(!apec.locations.some(location=>location.samples.length)) apec.locations[0].samples.push(newSample(apec));
  }
  if(JSON.stringify(apecs)!==JSON.stringify(profile.apecs)) saveSampleData(apecs);
  renderSampleEditor();
}

fetch('data.json?v=20261015-source-audit').then(response=>response.json()).then(initializeSampleEditor)
  .catch(error=>{labTable.textContent=`Could not load sample data: ${error.message}`;});
