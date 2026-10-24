const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));

function setup(page, initialSelections = []) {
  const storage = new Map();
  const elements = new Map();
  const selections = new Map(initialSelections);
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', disabled: false, hidden: false,
      dataset: {}, handlers: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      attrs: {}, setAttribute(k,v) { this.attrs[k]=v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; }, parentElement: {append() {}}, focus() {}, querySelector() { return null; }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {
      getElementById: element, querySelector: element,
      querySelectorAll: (selector) => selections.get(selector) || [],
      addEventListener() {}
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key)
    },
    window: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, location: { href: '' } },
    CustomEvent: class {}, Blob, Date, URLSearchParams, console,
    fetch: () => new Promise(() => {})
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'data-utils.js'), 'utf8'), context);
  if (page) {
    vm.runInContext(fs.readFileSync(path.join(root, page), 'utf8'), context);
    context.fixture = data;
    vm.runInContext('csrData = fixture;', context);
  }
  const run = (code) => vm.runInContext(code, context);
  const seed = (records = []) => {
    context.records = records;
    run("updateActiveProfileData({ currentLandUse: 'IL', proposedLandUse: 'RLLD', assessmentMode:'both', selectedContaminants: records, apecs:migrateLegacySamples(records) });");
  };
  return { context, run, seed, elements, element, selections, storage };
}

const record = (id, values = {}) => ({ ...data.contaminants.find((item) => item.id === id), ...values });

test('storage rejects invalid measurements atomically and keeps zero', () => {
  const s = setup();
  s.seed([record('benzene', { soilConc: 10 })]);
  for (const value of [-5, Infinity, NaN, 'abc', '0x10', true, []]) {
    s.context.value = value;
    assert.throws(() => s.run("saveAssessmentContaminants([{ id: 'benzene', soilConc: value }]);"), /finite, non-negative/);
    assert.equal(s.run('getActiveProfile().selectedContaminants[0].soilConc'), 10);
  }
  assert.throws(() => s.run("saveAssessmentContaminants([{ id: 'benzene', gwConc: 1, gwUnit: 'mg/kg' }]);"), /supported unit/);
  assert.throws(() => s.run("saveAssessmentContaminants([{ id: 'benzene', gwConc: 1e308, gwUnit: 'mg/L' }]);"), /too large/);
  s.run("saveAssessmentContaminants([{ id: 'benzene', soilConc: 0 }]);");
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].soilConc'), 0);
});

test('small threshold and measurement values retain meaningful digits', () => {
  const s = setup();
  assert.equal(s.run('formatThreshold(0.000095)'), '0.000095');
  assert.equal(s.run('formatNumber(0.00004)'), '0.00004');
  assert.equal(s.run('formatNumber(0.3)'), '0.3');
  assert.equal(s.run('getNumericThreshold(Infinity)'), null);
});

test('CSV validates soil units, missing values and malformed quoting', () => {
  const s=setup();s.context.d=data;
  for(const csv of ['name,matrix,value,unit\nBenzene,groundwater,1,mg/L','name,value,unit\nBenzene,-1,mg/kg','name,value,unit\nBenzene,1,ppm','name,value,unit\nBenzene,Infinity,mg/kg']) {
    s.context.csv=csv;
    assert.ok(s.run('buildSampleImportPreview(d,csv).errors.length'));
  }
  assert.throws(()=>s.run("buildSampleImportPreview(d,'name,unit\\nBenzene,mg/kg')"),/value or reporting_limit/);
  assert.throws(()=>s.run("parseCsv('name,value\\n\"Benzene,1')"),/unclosed/);
});

 test('CSV preview errors and blank cells cannot overwrite saved samples', () => {
  const s=setup();s.context.d=data;s.seed([record('benzene',{soilConc:10,gwConc:2})]);
  s.context.csv='contaminant,value,unit\nBenzene,-5,mg/kg';
  const before=s.storage.get('bcCsrToolState');
  assert.throws(()=>s.run('applySampleImport(d,buildSampleImportPreview(d,csv))'),/Resolve CSV errors/);
  assert.equal(s.storage.get('bcCsrToolState'),before);
  s.context.csv='contaminant,value,unit\nBenzene,,mg/kg';
  assert.equal(s.run('buildSampleImportPreview(d,csv).entries.length'),0);
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),10);
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwConc'),2);
});

test('undo and redo preserve complete dual-matrix measurements', () => {
  const s = setup('contaminants.js');
  s.seed([record('benzene', { soilConc: 10, soilUnit: 'mg/kg', gwConc: 2, gwUnit: 'mg/L' })]);
  s.run("allContaminants = fixture.contaminants; selectedIds.add('benzene'); renderContaminants = () => {};");
  s.run("setContaminantSelected('benzene', false); undoSelection();");
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].soilConc'), 10);
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwConc'), 2);
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwUnit'), 'mg/L');
  s.run('redoSelection();');
  assert.equal(s.run('getActiveProfile().selectedContaminants.length'), 0);
  s.run('undoSelection();');
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].soilConc'), 10);
});

test('soil engine handles conversions, equality, invalid values and mandatory ecological exceedances', () => {
  const s = setup(); s.context.c = data.contaminants.find(c => c.id === 'anthracene');
  s.context.options = { factors: Object.fromEntries(['drinking','livestock','microbial','aquatic','watering','irrigation'].map(key => [key, 'not_applicable'])) };
  assert.equal(s.run("screenSoil(c, 3, 'mg/kg', 'RLLD', options).status"), 'Exceeds');
  assert.equal(s.run("screenSoil(c, 2.5, 'µg/g', 'RLLD', options).status"), 'Pass');
  assert.equal(s.run("screenSoil(c, 0.0025, 'mg/g', 'RLLD', options).status"), 'Pass');
  assert.equal(s.run("screenSoil(c, -5, 'mg/kg', 'RLLD', options).status"), 'Inconclusive');
  assert.equal(s.run("screenSoil(c, Infinity, 'mg/kg', 'RLLD', options).status"), 'Inconclusive');
  assert.equal(s.run("screenSoil(c, 1, 'mg/L', 'RLLD', options).status"), 'Inconclusive');
  assert.equal(s.run("screenSoil(c, '', 'mg/kg', 'RLLD', options).status"), 'Inconclusive');
});

test('summary distinguishes entered, evaluated and unresolved measurements', () => {
  const s = setup('results.js');
  s.seed([record('benzene', { soilConc: 10 }), record('lead', { gwConc: 2 })]);
  s.run("updateActiveProfileData({factors:{drinking:'not_assessed'}});renderResults();");
  assert.equal(s.run('latestCounts.enteredCount'), 2);
  assert.equal(s.run('latestCounts.evaluatedCount'), 2);
  assert.equal(s.run('latestCounts.reviewCount'), 2);
  assert.equal(s.element('recommendation').hidden,true);
  assert.equal(s.element('recommendation').innerHTML,'');
  assert.match(s.element('sampleSummary').innerHTML,/Unassessed factors and limitations/);
  s.seed([record('benzene')]);
  s.run('renderResults();');
  assert.equal(s.element('recommendation').hidden, true);
  assert.equal(s.element('recommendation').innerHTML, '');
  s.seed([record('benzene', {soilConc:1000})]);s.run('renderResults()');
  assert.equal(s.element('recommendation').hidden, false);
  assert.match(s.element('recommendation').innerHTML, /Exceedance/);
  const html=fs.readFileSync(path.join(root,'results.html'),'utf8');
  assert.doesNotMatch(html,/id="reportContext"|id="thresholdNote"/);
});

test('one results notice contains the conditional exceedance message above the educational notice', () => {
  const html=fs.readFileSync(path.join(root,'results.html'),'utf8');
  assert.match(html,/<section class="notice-card results-notice">\s*<div id="recommendation" class="result-exceedance"[^>]*hidden><\/div>\s*<div class="compact-notice">/);
  assert.equal((html.match(/Educational tool only\./g)||[]).length,1);
  const s=setup('results.js');s.seed([record('benzene',{soilConc:0})]);s.run('renderResults()');
  assert.equal(s.element('recommendation').hidden,true);
  assert.equal(s.element('recommendation').innerHTML,'');
  s.run("changeSampleData(apecs=>apecs[0].locations[0].samples[0].results[0].value=1000);renderResults()");
  assert.equal(s.element('recommendation').hidden,false);
  assert.equal(s.element('recommendation').className,'result-exceedance');
  assert.match(s.element('recommendation').innerHTML,/Exceedance — Further Assessment May Be Needed/);
  assert.doesNotMatch(s.element('recommendation').innerHTML,/Educational tool only/);
});

test('cards and CSV use explicit threshold units, precision and report provenance', async () => {
  const s = setup('results.js');
  s.seed([record('benzene', { soilConc: 1, soilUnit: 'mg/kg' })]);
  s.run("updateActiveProfileData({factors:{drinking:'applicable'}});renderResults();");
  assert.match(s.element('resultsTable').innerHTML, /1 mg\/kg/);
  assert.match(s.element('resultsTable').innerHTML, /0\.035 µg\/g/);
  let exported;
  s.context.capture = (blob) => { exported = blob; };
  s.run('downloadBlob = capture; exportResultsCsv();');
  const csv = await exported.text();
  assert.match(csv, /current_standard,current_status,current_factor,current_source/);
  assert.match(csv, /threshold_unit/);
  assert.doesNotMatch(csv, /factor_comparisons|factor_selections|factor_justifications|pathway_note/);
  assert.match(csv, /2026-10-15/g);
  assert.match(csv, /Educational use only/);
  assert.match(csv, /Schedule 3\.1 Part 1 Matrix 4/);
  const l = setup();l.context.csv=csv;l.context.d=data;
  const imported=l.run('buildSampleImportPreview(d,csv)');
  assert.equal(imported.errors.length,0);
  assert.equal(imported.entries.length,1);
  assert.equal(imported.apecs[0].locations[0].samples[0].results[0].value,'1');
});

test('results CSV is compact, matches the active scenario and contains no multiline metadata cells', async () => {
  const s=setup('results.js');
  s.seed([record('benzene',{soilConc:300}),record('toluene')]);
  s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'WLR'});renderResults()");
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=capture;exportResultsCsv()');
  s.context.csv=await blob.text();
  const rows=s.run('parseCsv(csv.replace(/^\\uFEFF/,""))');
  const headers=[...rows[0]], values=[...rows[1]];
  const get=name=>values[headers.indexOf(name)];
  assert.equal(rows.length,2);
  assert.ok(headers.length<=18,`Expected a compact export, got ${headers.length} columns`);
  assert.equal(get('contaminant'),'Benzene');
  assert.equal(get('value'),'300');
  assert.equal(get('unit'),'µg/g');
  assert.equal(get('current_standard'),'100');
  assert.equal(get('current_status'),'Exceeds');
  assert.equal(get('current_land_use'),'Wildlands Reverted');
  assert.match(get('current_source'),/Schedule 3\.1 Part 1 Matrix 4.*p\. 4/);
  assert.doesNotMatch(headers.join(','),/proposed_|location_id|contaminant_id|converted_unit|factor_comparisons/);
  assert.ok(values.every(value=>!/[\r\n]/.test(value)));
  assert.ok(values.every(value=>!value.startsWith('[{') && !value.startsWith('{')));
  assert.equal(values.length,headers.length);
});

test('compact CSV preserves repeated sample names in different locations when reimported', async () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("graph[0].locations.push({...graph[0].locations[0],id:'l2',name:'BH-02',samples:[{...graph[0].locations[0].samples[0],id:'s3'}]});updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});saveSampleData(graph);renderResults()");
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=capture;exportResultsCsv()');
  s.context.csv=await blob.text();s.context.d=data;
  s.run('clearAssessment();applySampleImport(d,buildSampleImportPreview(d,csv))');
  assert.equal(s.run('getActiveProfile().apecs[0].locations.length'),2);
  assert.deepEqual([...s.run('getSoilSamples().map(({sample})=>sample.id)')],['s1','s2','s3']);
});

test('compact CSV escapes spreadsheet formulas and quoted names after removing embedded newlines', async () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run('graph[0].name="\\n=1+1";graph[0].locations[0].samples[0].name=\'Sample, "A"\';saveSampleData(graph);renderResults()');
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=capture;exportResultsCsv()');
  s.context.csv=await blob.text();
  const rows=s.run('parseCsv(csv.replace(/^\\uFEFF/,""))');
  assert.equal(rows[1][rows[0].indexOf('apec')],"' =1+1");
  assert.equal(rows[1][rows[0].indexOf('sample')],'Sample, "A"');
  assert.ok(rows.slice(1).every(row=>row.length===rows[0].length));
});

test('legacy storage migration retains matrix and units', () => {
  const s = setup();
  s.storage.set('selectedContaminants', JSON.stringify([{ id: 'benzene', concentration: 0.3, unit: 'mg/L' }]));
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwConc'), 0.3);
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwUnit'), 'mg/L');
});

test('Python lookup script runs against current data from another directory', () => {
  const output = execFileSync('python3', [path.join(root, 'query.py')], {
    cwd: '/private/tmp', encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.match(output, /Benzene/);
  assert.match(output, /Exceeds/);
  assert.match(output, /antimony/);
});

test('conditional factors select the controlling value; mandatory factors cannot be disabled', () => {
  const s = setup(); s.context.c = data.contaminants.find(c => c.id === 'benzene');
  s.context.opts = { factors: { intake: 'not_applicable', plants: 'not_applicable', drinking:'applicable', livestock:'not_applicable', microbial:'not_applicable', aquatic:'not_applicable', watering:'not_applicable', irrigation:'not_applicable' } };
  const result=s.run("screenSoil(c, 0.04, 'mg/kg', 'RLLD', opts)");
  assert.equal(result.threshold,0.035); assert.equal(result.status,'Exceeds');
  assert.equal(result.comparisons.find(c=>c.factor==='intake').applicability,'applicable');
  s.context.opts.factors.drinking='not_assessed';
  assert.equal(s.run("screenSoil(c, 0.04, 'mg/kg', 'RLLD', opts).status"),'Inconclusive');
  s.context.opts.factors.drinking='not_applicable';
  assert.equal(s.run("screenSoil(c, 0.04, 'mg/kg', 'RLLD', opts).threshold"),100);
});

test('generic human-health and ecological standards combine without matrix factors', () => {
  const s=setup(); s.context.c=data.contaminants.find(c=>c.cas==='7440-36-0');
  const result=s.run("screenSoil(c, 21, 'mg/kg', 'RLLD')");
  assert.equal(result.threshold,20); assert.equal(result.status,'Exceeds');
  assert.equal(result.comparisons.length,2); assert.equal(result.comparisons[0].factor,null);
  assert.equal(result.comparisons[0].threshold,250);
  s.context.c=data.contaminants.find(c=>c.cas==='83-32-9');
  assert.equal(s.run("screenSoil(c, 950, 'mg/kg', 'RLLD').status"),'Pass');
  assert.equal(s.run("screenSoil(c, 951, 'mg/kg', 'RLLD').status"),'Exceeds');
  assert.equal(s.run("screenSoil(c, 1500, 'mg/kg', 'IL').status"),'Pass');
});

test('non-detects use reporting limits and never convert uncertainty to exceedance or zero', () => {
  const s=setup(); s.context.c=data.contaminants.find(c=>c.cas==='7440-36-0');
  assert.equal(s.run("screenSoil(c, '', 'mg/kg', 'RLLD', {nonDetect:true,reportingLimit:20}).status"),'Pass');
  assert.equal(s.run("screenSoil(c, '', 'mg/kg', 'RLLD', {nonDetect:true,reportingLimit:21}).status"),'Inconclusive');
  assert.equal(s.run("screenSoil(c, '', 'mg/kg', 'RLLD', {nonDetect:true}).status"),'Inconclusive');
});

test('pH, species, activity conditions and special units require review', () => {
  const s=setup();
  for(const id of ['chromium','pcdds_pcdfs','pcbs']) {
    s.context.c=data.contaminants.find(c=>c.id===id);
    assert.equal(s.run("screenSoil(c, 0, 'mg/kg', 'RLLD').status"),'Inconclusive',id);
  }
  for(const id of ['pfos','cadmium']) {
    s.context.c=data.contaminants.find(c=>c.id===id);
    assert.equal(s.run("screenSoil(c, 0, 'mg/kg', 'RLLD', {factors:{drinking:'applicable'}}).status"),'Inconclusive',id);
  }
  s.context.c=data.contaminants.find(c=>c.cas==='1332-21-4');
  assert.equal(s.run("screenSoil(c, 0, 'mg/kg', 'RLLD').status"),'Inconclusive');
  s.context.c=data.contaminants.find(c=>c.cas==='7440-36-0');
  assert.equal(s.run("screenSoil(c, 0, 'mg/kg', 'RLLD', {depth:4}).status"),'Pass');
  assert.equal(s.run("screenSoil(c, 0, 'mg/kg', 'RLLD', {multipleLandUses:true}).status"),'Inconclusive');
});

test('source records cover all parts and reproduce all audited soil-intake entries', () => {
  assert.equal(data.contaminants.length,568);
  const s=setup('labdata.js');
  s.context.audit=fs.readFileSync(path.join(root,'verification/threshold-source-check.csv'),'utf8');
  const rows=s.run('parseCsv(audit)');
  for(const row of rows.slice(1).filter(row=>row[2]==='soil')) {
    const c=data.contaminants.find(c=>c.id===row[0]);
    const standard=c.standards.find(r=>r.factor==='intake').standards[row[1]];
    if(row[3]==='unrestricted') assert.match(standard.raw,/>/);
    else if(row[3]==='') assert.equal(standard.kind,'ns');
    else assert.equal(standard.value,Number(row[3]),`${row[0]} ${row[1]}`);
  }
  for(const c of data.contaminants) for(const record of c.standards) {
    assert.ok(data.sources[record.part].sha256); assert.ok(record.pages.length);
    for(const standard of Object.values(record.standards)) {
      assert.ok(standard.raw !== undefined);
      if(standard.kind==='numeric') assert.ok(Number.isFinite(standard.value));
      else assert.equal(standard.value,null);
    }
  }
});

test('saved water values survive edits but are excluded from screening and new CSV imports', () => {
  const s=setup('results.js');s.seed([record('anthracene',{soilConc:3,gwConc:999,gwUnit:'mg/L'})]);
  s.run('renderResults()');
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwConc'),999);
  assert.equal(s.run('latestRows[0].matrices.every(row=>row.key === "soil")'),true);
  assert.equal(s.run('latestCounts.enteredCount'),2);
});

test('changing land use recalculates both scenarios and refreshes their labels', () => {
  const s=setup('results.js');s.seed([record('anthracene',{soilConc:3})]);
  s.run('updateActiveProfileData({currentLandUse:"CL",factors:Object.fromEntries(["drinking","livestock","microbial","aquatic","watering","irrigation"].map(k=>[k,"not_applicable"]))});renderResults()');
  assert.equal(s.run('latestRows[0].matrices[0].result.status'),'Pass');
  assert.equal(s.run('latestRows[0].matrices[1].result.status'),'Exceeds');
  s.run('updateActiveProfileData({currentLandUse:"AL"});renderResults()');
  assert.equal(s.run('latestRows[0].matrices[0].result.status'),'Exceeds');
  assert.equal(s.run('getProfileSiteInfo(getActiveProfile()).currentLandUseLabel'),'Agricultural');
});

test('NA CAS identifiers cannot import into the wrong chemical family', () => {
  const s=setup();s.context.d=data;
  s.context.csv='contaminant_id,cas,value,unit\nnonylphenol,NA,1,mg/kg';
  assert.equal(s.run('buildSampleImportPreview(d,csv).apecs[0].locations[0].samples[0].results[0].contaminantId'),'nonylphenol');
  s.context.csv='cas,value,unit\nNA,1,mg/kg';
  assert.ok(s.run('buildSampleImportPreview(d,csv).errors.length'));
});

test('unanswered factors default to not applicable while explicit not assessed remains unresolved', () => {
  const s = setup();
  s.context.c = data.contaminants.find(c => c.id === 'benzene');
  const result = s.run("screenSoil(c, 0.04, 'mg/kg', 'RLLD')");
  assert.equal(result.status, 'Pass');
  assert.equal(result.comparisons.find(c => c.factor === 'drinking').applicability, 'not_applicable');
  assert.equal(result.comparisons.find(c => c.factor === 'plants').applicability, 'applicable');
  assert.equal(s.run("screenSoil(c, 0.04, 'mg/kg', 'RLLD', {factors:{drinking:'not_assessed'}}).status"), 'Inconclusive');
});

test('site summary uses short counts with red positive totals and green zero totals', () => {
  const s=setup('results.js');s.seed([record('benzene',{soilConc:300})]);
  s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'WLR'});renderResults()");
  let html=s.element('sampleSummary').innerHTML;
  assert.match(html,/<p>1 sample · 1 result evaluated · <span class="summary-exceedance">1 exceedance<\/span> · 0 requiring review<\/p>/);
  assert.doesNotMatch(html,/Unnamed site|sample\/contaminant scenarios/);
  s.run("changeSampleData(apecs=>apecs[0].locations[0].samples[0].results[0].value=0);renderResults()");
  html=s.element('sampleSummary').innerHTML;
  assert.match(html,/<p>1 sample · 1 result evaluated · <span class="summary-no-exceedances">0 exceedances<\/span> · 0 requiring review<\/p>/);
  assert.doesNotMatch(html,/class="summary-exceedance"/);
  s.run("updateActiveProfileData({factors:{intake:'not_assessed',plants:'not_assessed'}});renderResults()");
  assert.match(s.element('sampleSummary').innerHTML,/1 sample · 0 results evaluated · <span class="summary-no-exceedances">0 exceedances<\/span> · 1 requiring review/);
});

test('site summary pluralizes multiple samples and evaluated results', () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'RLLD'});saveSampleData(graph);renderResults()");
  assert.match(s.element('sampleSummary').innerHTML,/2 samples · 2 results evaluated/);
});

test('result cards retain comparison and status without explanation blocks', () => {
  const s = setup('results.js');
  s.seed([record('anthracene', {soilConc:3,soilUnit:'mg/kg'})]);
  s.run('renderResults()');
  const html = s.element('resultsTable').innerHTML;
  assert.match(html, /Exceeds/);
  assert.match(html, /2\.5/);
  assert.doesNotMatch(html, /summary-note|Individual standards|controlled by|Source cell/);
});

test('assessment shows two selectable options per factor and retains mandatory choices', () => {
  const s = setup();
  s.run("updateActiveProfileData({factors:{intake:'not_assessed',plants:'not_assessed',drinking:'not_assessed'}})");
  s.context.window.matchMedia = () => ({matches:false});
  s.context.window.addEventListener = () => {};
  s.element('factorSettings').querySelectorAll = () => [];
  s.run(fs.readFileSync(path.join(root, 'script.js'), 'utf8'));
  const html = s.element('factorSettings').innerHTML;
  assert.equal((html.match(/type="radio"/g) || []).length, 16);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /Notes \/ justification|data-justification|factor-help|textarea/);
  assert.doesNotMatch(html, /value="not_applicable"/);
  assert.match(html, /<legend>Intake of contaminated soil<\/legend>/);
  assert.match(html, /<legend>Toxicity to soil invertebrates and plants<\/legend>/);
  for (const key of ['intake','plants']) {
    assert.match(html, new RegExp(`name="factor-${key}"[^>]*value="applicable" `));
    assert.match(html, new RegExp(`name="factor-${key}"[^>]*value="not_assessed" checked`));
  }
  assert.match(html, /name="factor-drinking"[^>]*value="not_assessed" checked/);
  assert.doesNotMatch(html, /name="factor-irrigation"[^>]*checked/);
});

test('mandatory factors default applicable but not assessed prevents a pass', () => {
  const s = setup();
  s.context.c = data.contaminants.find(c => c.id === 'anthracene');
  assert.equal(s.run("screenSoil(c, 1, 'mg/kg', 'RLLD').status"), 'Pass');
  for (const factor of ['intake', 'plants']) {
    s.context.factor = factor;
    const result = s.run("screenSoil(c, 1, 'mg/kg', 'RLLD', {factors:{[factor]:'not_assessed'}})");
    assert.equal(result.status, 'Inconclusive');
    assert.equal(result.comparisons.find(row => row.factor === factor).applicability, 'not_assessed');
  }
});

test('site mode supports current-only without redevelopment and separate both scenarios', () => {
  const s = setup();
  s.context.p = {currentLandUse:'IL',proposedLandUse:'',assessmentMode:'current'};
  assert.equal(s.run('getSiteValidationError(p)'), '');
  assert.equal(s.run('getAssessmentScenarios(p).length'), 1);
  s.context.p.assessmentMode='both';
  assert.match(s.run('getSiteValidationError(p)'), /proposed land use/);
  s.context.p.proposedLandUse='RLLD';
  assert.equal(s.run('getSiteValidationError(p)'), '');
  assert.equal(s.run('getAssessmentScenarios(p).length'), 2);
  s.context.p.assessmentMode='proposed';
  s.context.p.currentLandUse='';
  assert.equal(s.run('getSiteValidationError(p)'), '');
  assert.equal(s.run('getAssessmentScenarios(p).length'), 1);
  assert.equal(s.run('getAssessmentScenarios(p)[0].landUse'), 'RLLD');
});

test('site form shows both editable land uses but requires only the chosen screening use', () => {
  const s=setup();
  s.context.window.matchMedia=()=>({matches:false});
  s.element('factorSettings').querySelectorAll=()=>[];
  s.run(fs.readFileSync(path.join(root,'script.js'),'utf8'));
  const current=s.element('currentLandUse'), proposed=s.element('proposedLandUse'), mode=s.element('assessmentMode');
  assert.equal(s.element('nextBtn').disabled,false);
  assert.equal(s.element('proposedLandUseGroup').hidden,false);
  mode.value='proposed';mode.handlers.change();
  assert.equal(s.element('currentLandUseGroup').hidden,false);
  assert.equal(current.disabled,false);assert.equal(current.required,false);
  assert.equal(proposed.required,true);assert.equal(proposed.disabled,false);
  s.element('nextBtn').handlers.click();
  assert.match(s.element('siteStatus').textContent,/proposed land use/);
  proposed.value='RLLD';proposed.handlers.change();
  assert.equal(s.element('nextBtn').disabled,false);
  assert.equal(s.run('getActiveProfile().currentLandUse'),'');
  assert.equal(s.run('getAssessmentScenarios(getActiveProfile())[0].landUse'),'RLLD');
  mode.value='current';mode.handlers.change();
  assert.equal(s.element('nextBtn').disabled,false);
  assert.equal(s.element('currentLandUseGroup').hidden,false);
  assert.equal(s.element('proposedLandUseGroup').hidden,false);
  assert.equal(proposed.disabled,false);assert.equal(proposed.required,false);
  current.value='IL';current.handlers.change();
  assert.equal(s.element('nextBtn').disabled,false);
  assert.equal(s.run('getAssessmentScenarios(getActiveProfile())[0].landUse'),'IL');
  const html=fs.readFileSync(path.join(root,'assessment.html'),'utf8');
  assert.doesNotMatch(html,/id="(?:current|proposed)LandUseGroup"[^>]*hidden/);
  assert.doesNotMatch(html,/Both land uses|value="both"|id="multipleLandUses"|Proposed Land Use \(optional\)/);
});

function sampleFixture() {
  return [{id:'a1',name:'Fuel storage',description:'',locations:[{id:'l1',name:'BH-01',type:'Borehole',samples:[
    {id:'s1',name:'S01',depthFrom:0.5,depthTo:'',date:'',results:[{contaminantId:'anthracene',value:3,unit:'mg/kg',qualifier:'detected',reportingLimit:''}]},
    {id:'s2',name:'S02',depthFrom:1.5,depthTo:'',date:'',results:[{contaminantId:'anthracene',value:1,unit:'µg/g',qualifier:'detected',reportingLimit:''}]}
  ]}]}];
}

test('sample hierarchy preserves independent concentrations, stable IDs and mode', () => {
  const s=setup(); s.context.graph=sampleFixture(); s.context.d=data;
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});saveSampleData(graph)");
  const rows=s.run('getSampleScreeningRows(d,getActiveProfile())');
  assert.equal(rows.length,2); assert.equal(rows[0].matrices[0].result.status,'Exceeds');
  assert.equal(rows[1].matrices[0].result.status,'Pass');
  s.run("changeSampleData(a=>{a[0].name='Renamed';a[0].locations[0].samples.reverse()})");
  assert.equal(s.run('getSoilSamples()[0].sample.id'),'s2');
  assert.equal(s.run('getSoilSamples()[1].sample.results[0].value'),3);
});

test('invalid sample edits fail atomically; IDs and qualifiers validated', () => {
  const s=setup(); s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  const before=s.storage.get('bcCsrToolState');
  assert.throws(()=>s.run("changeSampleData(a=>a[0].locations[0].samples[1].id='s1')"),/unique/);
  assert.throws(()=>s.run("changeSampleData(a=>{const r=a[0].locations[0].samples[0].results[0];r.qualifier='non_detect';r.reportingLimit=0;})"),/reporting limit/);
  assert.equal(s.storage.get('bcCsrToolState'),before);
});

test('old measurements migrate once into a legacy sample with water retained separately', () => {
  const s=setup();
  s.storage.set('bcCsrToolState',JSON.stringify({version:3,profiles:{assessment:{id:'assessment',currentLandUse:'RLLD',selectedContaminants:[record('benzene',{soilConc:0.02,gwConc:7})]}}}));
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),0.02);
  assert.equal(s.run('getActiveProfile().selectedContaminants[0].gwConc'),7);
  assert.equal(s.run('getSoilSamples().length'),1);
  assert.ok(s.storage.get('bcCsrToolStateBeforeSamples'));
  assert.equal(s.run('getSoilSamples()[0].sample.depthFrom'),undefined);
});

test('CSV builds two areas and four independent samples including ND', () => {
  const s=setup();s.context.d=data;s.context.csv=fs.readFileSync(path.join(root,'sample-import-template.csv'),'utf8');
  const preview=s.run('buildSampleImportPreview(d,csv)');
  assert.equal(preview.errors.length,0);assert.equal(preview.apecs.length,2);
  s.run('applySampleImport(d,buildSampleImportPreview(d,csv))');
  assert.equal(s.run('getSoilSamples().length'),4);
  assert.equal(s.run('getSoilSamples()[2].sample.results[0].qualifier'),'non_detect');
  assert.equal(s.run('getSoilSamples()[2].sample.results[0].reportingLimit'),'0.01');
});

test('CSV duplicates, conflicting sample dates and reused hierarchy IDs are rejected', () => {
  const s=setup();s.context.d=data;
  for(const csv of [
    'apec,location,sample,depth,contaminant,value\nA,B,S,1,Benzene,1\nA,B,S,1,Benzene,2',
    'apec,location,sample,sample_date,contaminant,value\nA,B,S,2026-10-12,Benzene,1\nA,B,S,2026-10-13,Anthracene,2',
    'apec_id,location_id,sample_id,contaminant,value\nrepeat,repeat,s,Benzene,1'
  ]) {s.context.csv=csv;assert.ok(s.run('buildSampleImportPreview(d,csv).errors.length'));}
});

test('CSV gives an imported APEC a numbered name when a different area already uses its name', () => {
  const s=setup();s.context.d=data;s.context.graph=sampleFixture();
  s.run('saveSampleData(graph)');
  const before=s.run('JSON.stringify(getActiveProfile().apecs)');
  s.context.csv='apec_id,apec,location_id,location,sample_id,sample,contaminant,value,unit\nforeign-area,Fuel storage,foreign-location,BH-01,foreign-sample,S01,Benzene,300,µg/g\nforeign-area,Fuel storage,foreign-location,BH-01,foreign-sample,S01,Toluene,5,µg/g';
  const preview=s.run('buildSampleImportPreview(d,csv)');
  assert.deepEqual([...preview.errors],[]);
  assert.equal(preview.apecs.length,2);
  assert.equal(preview.apecs[0].id,'a1');
  assert.equal(preview.apecs[1].id,'foreign-area');
  assert.equal(preview.apecs[1].name,'Fuel storage (1)');
  assert.ok(preview.entries.every(entry=>entry.apec==='Fuel storage (1)'));
  assert.equal(JSON.stringify(preview.apecs[0]),JSON.stringify(JSON.parse(before)[0]));
  assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
  s.context.preview=preview;s.run('applySampleImport(d,preview)');
  assert.equal(s.run("getSoilSamples()[2].sample.results.find(r=>r.contaminantId==='benzene').value"),'300');
  assert.equal(s.run('getSoilSamples()[0].sample.results.length'),1);
  assert.equal(s.run('getSoilSamples()[1].sample.results[0].value'),1);
  const repeated=s.run('buildSampleImportPreview(d,csv)');
  assert.deepEqual([...repeated.errors],[]);
  assert.equal(repeated.apecs.length,2);
});

test('CSV APEC copy names skip existing suffixes and fit the name limit', () => {
  const s=setup();s.context.d=data;s.context.graph=sampleFixture();
  s.run("graph[0].name='X'.repeat(160);graph.push({id:'a2',name:'X'.repeat(156)+' (1)',locations:[]});saveSampleData(graph)");
  s.context.csv='apec_id,apec,sample_id,sample,contaminant,value\nforeign-area,'+'X'.repeat(160)+',foreign-sample,S01,Benzene,300';
  const preview=s.run('buildSampleImportPreview(d,csv)');
  assert.deepEqual([...preview.errors],[]);
  assert.equal(preview.apecs[2].name,'X'.repeat(156)+' (2)');
  assert.equal(preview.apecs[2].name.length,160);
});

test('lab CSV preview enables Apply and shows the numbered APEC before saving', () => {
  const s=setup('labdata.js');s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  s.element('csvText').value='apec_id,apec,location_id,location,sample_id,sample,contaminant,value\nforeign-area,Fuel storage,foreign-location,BH-01,foreign-sample,S01,Benzene,300';
  s.element('previewCsvBtn').handlers.click();
  assert.equal(s.element('applyCsvBtn').disabled,false);
  assert.match(s.element('csvPreview').innerHTML,/1 results · 0 errors/);
  assert.match(s.element('csvPreview').innerHTML,/Fuel storage \(1\)/);
  assert.equal(s.run('getActiveProfile().apecs.length'),1);
  s.element('applyCsvBtn').handlers.click();
  assert.equal(s.element('labStatus').textContent,'CSV imported and saved.');
  assert.equal(s.run('getActiveProfile().apecs[1].name'),'Fuel storage (1)');
});

test('CSV name matching cannot hide conflicting or reused imported IDs', () => {
  const s=setup();s.context.d=data;s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  const before=s.run('JSON.stringify(getActiveProfile().apecs)');
  for(const csv of [
    'apec_id,apec,sample_id,sample,contaminant,value\na1,Renamed area,s1,S01,Benzene,1',
    'apec_id,apec,sample_id,sample,contaminant,value\nforeign-area,Fuel storage,s1,S01,Benzene,1\nforeign-area,Other area,s3,S03,Toluene,2',
    'apec_id,apec,location_id,location,sample_id,sample,contaminant,value\nforeign-area,Fuel storage,foreign-area,BH-01,s1,S01,Benzene,1'
  ]) {
    s.context.csv=csv;
    assert.ok(s.run('buildSampleImportPreview(d,csv).errors.length'));
    assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
    assert.throws(()=>s.run('applySampleImport(d,buildSampleImportPreview(d,csv))'),/Resolve CSV errors/);
  }
});

test('non-detect sample comparisons use reporting limits without depth requirements', () => {
  const s=setup();s.context.d=data;s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});graph[0].locations[0].samples[0].results[0]={contaminantId:'anthracene',value:'',unit:'mg/kg',qualifier:'non_detect',reportingLimit:1};saveSampleData(graph)");
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[0].matrices[0].result.status'),'Pass');
  s.run("changeSampleData(a=>a[0].locations[0].samples[0].results[0].reportingLimit=3)");
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[0].matrices[0].result.status'),'Inconclusive');
  s.run("changeSampleData(a=>{a[0].locations[0].samples[1].depthFrom=4})");
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[1].matrices[0].result.status'),'Pass');
});

test('legacy depth columns are ignored on import', () => {
  const s=setup();s.context.d=data;s.context.csv='apec,location,sample,depth,contaminant,value\nA,B,S,1,Benzene,1\nA,B,S,1.0,Anthracene,2';
  assert.equal(s.run('buildSampleImportPreview(d,csv).errors.length'),0);
});

test('deleting one sample preserves other IDs and measurements', () => {
  const s=setup();s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  const second=s.run('JSON.stringify(getSoilSamples()[1].sample)');
  s.run('changeSampleData(a=>a[0].locations[0].samples.splice(0,1))');
  assert.equal(s.run('JSON.stringify(getSoilSamples()[0].sample)'),second);
});

test('invalid date cannot overwrite saved samples', () => {
  const s=setup();s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  const before=s.run('JSON.stringify(getActiveProfile().apecs)');
  assert.throws(()=>s.run("changeSampleData(a=>a[0].locations[0].samples[0].date='2026-02-30')"),/date/);
  assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
});

test('ND CSV export omits inactive detected value and reimports the reporting limit', async () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});graph[0].locations[0].samples[0].results[0]={contaminantId:'anthracene',value:99,unit:'mg/kg',qualifier:'non_detect',reportingLimit:1};saveSampleData(graph);renderResults()");
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=(b)=>capture(b);exportResultsCsv()');
  s.context.csv=await blob.text();s.run('clearAssessment()');s.context.d=data;
  const preview=s.run('buildSampleImportPreview(d,csv)');assert.deepEqual([...preview.errors],[]);
  assert.equal(preview.apecs[0].locations[0].samples[0].results[0].value,'');
  assert.equal(preview.apecs[0].locations[0].samples[0].results[0].reportingLimit,'1');
});

test('site identity stays stable through reloads and edits', () => {
  const s=setup();s.run("updateActiveProfileData({siteName:'First site'})");
  const id=s.run('getActiveProfile().siteId');assert.ok(id);
  s.run("updateActiveProfileData({siteName:'Renamed site'})");
  assert.equal(s.run('getActiveProfile().siteId'),id);
  assert.equal(s.run('getActiveProfile().siteId'),id);
});

test('both scenarios do not double-count entered laboratory values', () => {
  const s=setup('results.js');s.seed([record('anthracene',{soilConc:3})]);s.run('renderResults()');
  assert.equal(s.element('labDataCount').textContent,'1 value');
  assert.equal(s.run('latestCounts.enteredCount'),2);
});

test('lab editor opens one numbered area/location and numbers the next area', () => {
  const s=setup('labdata.js');s.run('renderSampleEditor()');
  assert.equal(s.run('getActiveProfile().apecs.length'),1);
  assert.equal(s.run('getActiveProfile().apecs[0].name'),'Area of Potential Concern 1');
  assert.equal(s.run('getActiveProfile().apecs[0].locations[0].name'),'Sampling location 1');
  assert.equal(s.run('getSoilSamples().length'),1);
  assert.equal(s.run('getSoilSamples()[0].sample.name'),'Sample 1');
  s.element('addApecBtn').handlers.click();
  assert.equal(s.run('getActiveProfile().apecs[1].name'),'Area of Potential Concern 2');
  assert.equal(s.run('getActiveProfile().apecs[1].locations[0].samples[0].name'),'Sample 1');
  assert.equal(s.run('getSoilSamples().length'),2);
  assert.doesNotMatch(s.element('labTable').innerHTML,/APEC name|Description<textarea|Location name|Location type/);
});

test('opening lab data seeds empty areas once and retains existing samples and values',()=>{
  const s=setup('labdata.js');s.context.graph=sampleFixture();
  s.run("saveSampleData(graph);changeSampleData(apecs=>apecs.push({id:'empty-area',name:'Empty area',locations:[]}));initializeSampleEditor(fixture)");
  assert.equal(s.run('getSoilSamples().length'),3);
  assert.equal(s.run("getActiveProfile().apecs[1].locations[0].samples[0].name"),'Sample 1');
  assert.equal(s.run("getSoilSamples()[0].sample.id"),'s1');
  assert.equal(s.run("getSoilSamples()[0].sample.results[0].value"),3);
  const before=s.run('JSON.stringify(getActiveProfile().apecs)');
  s.run('initializeSampleEditor(fixture)');
  assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
});

test('new areas open one independent blank sample with all selected contaminants',()=>{
  const s=setup('labdata.js');s.seed([record('benzene')]);s.run('renderSampleEditor()');
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].contaminantId'),'benzene');
  s.run("changeSampleData(apecs=>apecs[0].locations[0].samples[0].results[0].value=5)");
  s.element('addApecBtn').handlers.click();
  assert.equal(s.run('getSoilSamples()[1].sample.results[0].value'),'');
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),5);
  assert.notEqual(s.run('getSoilSamples()[0].sample.id'),s.run('getSoilSamples()[1].sample.id'));
});

test('simplified headings preserve saved metadata and rename without changing sample IDs', () => {
  const s=setup('labdata.js');s.context.graph=sampleFixture();
  s.run("graph[0].description='Stored description';saveSampleData(graph);renderSampleEditor()");
  const before=s.run('JSON.stringify(getSoilSamples()[0].sample)');
  const input={dataset:{field:'name',kind:'apec'},value:'Renamed area',validity:{},checkValidity(){return true;},removeAttribute(){},setAttribute(){},closest(selector){return selector==='[data-apec]'?{dataset:{apec:'a1'}}:selector==='[data-location]'?{dataset:{location:'l1'}}:null;}};
  s.context.edit=input;s.run("saveSampleField({target:edit,type:'change'})");
  assert.equal(s.run('getActiveProfile().apecs[0].name'),'Renamed area');
  assert.equal(s.run('getActiveProfile().apecs[0].description'),'Stored description');
  assert.equal(s.run('getActiveProfile().apecs[0].locations[0].type'),'Borehole');
  assert.equal(s.run('JSON.stringify(getSoilSamples()[0].sample)'),before);
  assert.doesNotMatch(s.element('labTable').innerHTML,/data-action="rename-location"|<th>Reporting limit<|Depth from|Depth to|Sample date|Sample ID/);
});

test('area-only UI retains all legacy samples and hides location/metadata/limit columns', () => {
  const s=setup('labdata.js');s.context.graph=sampleFixture();
  s.run("graph[0].locations.push({id:'l2',name:'BH-02',type:'Borehole',samples:[{...graph[0].locations[0].samples[0],id:'s3',name:'S03'}]});saveSampleData(graph);renderSampleEditor()");
  const html=s.element('labTable').innerHTML;
  assert.equal((html.match(/class="soil-sample"/g)||[]).length,3);
  assert.doesNotMatch(html,/sample-location|rename-location|add-location|Sample ID|Depth from|Depth to|Sample date|<th>Reporting limit/);
  assert.equal(s.run('getSoilSamples().length'),3);
});

test('no detection accepts a reporting limit without layout text and retains the detected value', () => {
  const s=setup('labdata.js');s.context.graph=sampleFixture();s.run('saveSampleData(graph)');
  const row={dataset:{contaminant:'anthracene'},querySelector(){return {removeAttribute(){}};}};
  const input={dataset:{result:'qualifier'},value:'non_detect',validity:{},checkValidity(){return true;},removeAttribute(){},setAttribute(){},closest(selector){return selector==='[data-apec]'?{dataset:{apec:'a1'}}:selector==='[data-location]'?{dataset:{location:'l1'}}:selector==='[data-sample]'?{dataset:{sample:'s1'}}:row;}};
  s.context.edit=input;s.run("saveSampleField({target:edit,type:'change'})");
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].qualifier'),'non_detect');
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),3);
  const html=s.element('labTable').innerHTML;
  assert.match(html,/data-result="measurement"[^>]*value="" placeholder="Reporting limit"/);
  assert.doesNotMatch(html,/data-result="measurement"[^>]*disabled/);
  assert.doesNotMatch(html,/enter the lab reporting limit|placeholder="Lab reporting limit"/);
  input.dataset.result='measurement';input.value='1';s.run("saveSampleField({target:edit,type:'input'})");
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),3);
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].reportingLimit'),'1');
  input.value='0';s.run("saveSampleField({target:edit,type:'input'})");
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].reportingLimit'),'1');
  s.run('renderSampleEditor()');
  assert.match(s.element('labTable').innerHTML,/data-result="measurement"[^>]*value="1" placeholder="Reporting limit"/);
  input.dataset.result='qualifier';input.value='detected';s.run("saveSampleField({target:edit,type:'change'})");
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),3);
  assert.doesNotMatch(s.element('labTable').innerHTML,/data-result="measurement"[^>]*disabled/);
});

test('unquantified no detection is included in both result layouts without claiming a pass', () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});graph[0].locations[0].samples[0].results[0].qualifier='non_detect';saveSampleData(graph);renderResults()");
  assert.match(s.element('resultsTable').innerHTML,/No detection/);
  assert.equal(s.run('latestRows[0].matrices[0].result.status'),'Inconclusive');
  assert.equal(s.run('latestRows[0].matrices[0].result.converted'),null);
  assert.equal(s.run('latestCounts.enteredCount'),2);
  assert.equal(s.run('latestCounts.reviewCount'),1);
  s.element('resultLayout').value='matrix';s.run('renderResultCards(latestRows)');
  assert.match(s.element('resultsTable').innerHTML,/No detection/);
  s.element('resultFilter').value='review';s.run('renderResultCards(latestRows)');
  assert.match(s.element('resultsTable').innerHTML,/No detection/);
});

test('area/sample CSV needs no location or reporting-limit column', () => {
  const s=setup();s.context.d=data;s.context.csv='apec,sample,contaminant,value,unit,qualifier\nA,S01,Benzene,0.1,mg/kg,detected\nA,S02,Benzene,0.01,mg/kg,non_detect';
  const preview=s.run('buildSampleImportPreview(d,csv)');assert.equal(preview.errors.length,0);
  s.run('applySampleImport(d,buildSampleImportPreview(d,csv))');
  assert.equal(s.run('getSoilSamples().length'),2);
  assert.equal(s.run('getSoilSamples()[1].sample.results[0].reportingLimit'),'0.01');
});

test('schema 5 removes saved sample depth while preserving measurements and original backup', () => {
  const s=setup();const graph=sampleFixture();
  s.storage.set('bcCsrToolState',JSON.stringify({version:4,profiles:{assessment:{id:'assessment',siteId:'site-existing',currentLandUse:'RLLD',assessmentMode:'current',apecs:graph}}}));
  assert.equal(s.run('getAppState().version'),5);
  assert.equal(s.run('getSoilSamples()[0].sample.depthFrom'),undefined);
  assert.equal(s.run('getSoilSamples()[0].sample.depthTo'),undefined);
  assert.equal(s.run('getSoilSamples()[0].sample.results[0].value'),3);
  assert.equal(s.run('getActiveProfile().siteId'),'site-existing');
  assert.equal(JSON.parse(s.storage.get('bcCsrToolStateBeforeSamples')).profiles.assessment.apecs[0].locations[0].samples[0].depthFrom,0.5);
});

test('samples without depth can pass while exceedance and uncertainty checks remain', () => {
  const s=setup();s.context.d=data;s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});saveSampleData(graph)");
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[1].matrices[0].result.status'),'Pass');
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[0].matrices[0].result.status'),'Exceeds');
  s.run("updateActiveProfileData({factors:{intake:'not_assessed'}})");
  assert.equal(s.run('getSampleScreeningRows(d,getActiveProfile())[1].matrices[0].result.status'),'Inconclusive');
});

test('results and CSV omit all sample depth fields', async () => {
  const s=setup('results.js');s.seed([record('anthracene',{soilConc:1})]);s.run('renderResults()');
  assert.doesNotMatch(s.element('resultsTable').innerHTML,/Depth not recorded|sample-meta/);
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=(b)=>capture(b);exportResultsCsv()');
  assert.doesNotMatch((await blob.text()).split('\n')[0],/depth_from|depth_to/);
});

test('compact result views keep measurements, units and uncertain outcomes without clickable details', () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current',factors:{intake:'not_assessed'}});saveSampleData(graph);renderResults()");
  let html=s.element('resultsTable').innerHTML;
  assert.match(html,/>Measured</);assert.match(html,/>Threshold</);
  assert.match(html,/3 mg\/kg/);assert.match(html,/1 µg\/g/);
  assert.match(html,/Inconclusive/);
  assert.doesNotMatch(html,/data-action="info"/);
  assert.match(html,/Standards by factor/);
  assert.match(html,/Official source/);
  s.element('resultLayout').value='matrix';s.run('renderResultCards(latestRows)');
  html=s.element('resultsTable').innerHTML;
  assert.match(html,/S01/);assert.match(html,/S02/);assert.match(html,/result-matrix-table/);
  assert.match(html,/3 mg\/kg/);assert.match(html,/1 µg\/g/);
  assert.doesNotMatch(html,/data-action="info"/);
  assert.doesNotMatch(html,/Controlling factor:|Lowest resolved factor:|No resolved numerical factor/);
  assert.equal(s.element('resultSortControls').hidden,false);
});

test('matrix sorts chemicals by selection order, alphabet or category and restores view preferences', () => {
  const s=setup('results.js');
  s.seed([record('benzene',{soilConc:1}),record('anthracene',{soilConc:2}),record('generic_26',{soilConc:3})]);
  s.run('renderResults()');
  s.element('resultSort').value='default';
  assert.equal(s.run('sortedResultChemicals(latestRows).map(c=>c.id).join(",")'),'benzene,anthracene,generic_26');
  s.element('resultSort').value='alpha';
  assert.equal(s.run('sortedResultChemicals(latestRows).map(c=>c.id).join(",")'),'anthracene,generic_26,benzene');
  s.element('resultSortDirection').dataset.direction='desc';
  assert.equal(s.run('sortedResultChemicals(latestRows).map(c=>c.id).join(",")'),'benzene,generic_26,anthracene');
  s.element('resultSort').value='category';s.element('resultLayout').value='matrix';
  s.run('saveResultControls();restoreResultControls()');
  assert.equal(s.element('resultLayout').value,'matrix');assert.equal(s.element('resultSort').value,'category');
  const categories=s.run('sortedResultChemicals(latestRows).map(c=>c.category)');
  const expected=Object.keys(data.contaminantCategories).reverse().filter(c=>categories.includes(c));
  assert.deepEqual([...new Set(categories)],expected);
});

test('matrix filters retain sample alignment, threshold-only mode and missing measurements', () => {
  const s=setup('results.js');s.context.graph=sampleFixture();
  s.run("updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'});saveSampleData(graph);renderResults()");
  s.element('resultLayout').value='matrix';s.element('resultFilter').value='exceeds';
  s.run('renderResultCards(latestRows)');
  let html=s.element('resultsTable').innerHTML;
  assert.match(html,/S01/);assert.match(html,/S02/);assert.match(html,/3 mg\/kg/);assert.match(html,/Filtered out/);
  assert.doesNotMatch(html,/>1 µg\/g</);
  s.element('resultFilter').value='review';s.run('renderResultCards(latestRows)');
  assert.match(s.element('resultsTable').innerHTML,/No results match/);
  s.run("clearAssessment();saveAssessmentContaminants([{id:'anthracene'}]);updateActiveProfileData({currentLandUse:'RLLD',assessmentMode:'current'})");
  s.element('resultFilter').value='all';s.run('renderResults()');
  html=s.element('resultsTable').innerHTML;
  assert.match(html,/Anthracene/i);assert.match(html,/Unresolved|µg\/g/);assert.match(html,/—/);
});

test('official benzene Matrix 4 values and controlling factors match both residential columns', () => {
  const s=setup();s.context.c=data.contaminants.find(c=>c.id==='benzene');
  assert.equal(s.run("c.standards.find(r=>r.factor==='intake').standards.RLLD.value"),150);
  assert.equal(s.run("c.standards.find(r=>r.factor==='plants').standards.RLLD.value"),100);
  assert.equal(s.run("c.standards.find(r=>r.factor==='drinking').standards.RLLD.value"),0.035);
  assert.equal(s.run("c.standards.find(r=>r.factor==='aquatic').standards.RLLD.raw"),'2.5\n6.5');
  assert.equal(s.run("screenSoil(c, 1, 'µg/g', 'RLLD').threshold"),100);
  assert.equal(s.run("screenSoil(c, 1, 'µg/g', 'RLHD').threshold"),250);
  assert.equal(s.run("screenSoil(c, 1, 'µg/g', 'RLLD').controls[0]"),'Toxicity to soil invertebrates and plants');
  assert.equal(s.run("screenSoil(c, 1, 'µg/g', 'RLLD', {factors:{drinking:'applicable'}}).threshold"),0.035);
});

test('lead uses unconditional intake/ecological rows while pH and hardness remain factor-specific', () => {
  const s=setup();s.context.c=data.contaminants.find(c=>c.id==='lead');
  for(const land of ['WLN','WLR','AL','PL','RLLD','RLHD','CL','IL']) {
    s.context.land=land;
    const r=s.run("screenSoil(c, 1, 'µg/g', land)");
    assert.equal(r.status,'Pass',land);
    assert.equal(r.threshold,land==='IL'?1000:land==='CL'?150:120,land);
  }
  assert.equal(s.run("screenSoil(c, 121, 'µg/g', 'RLLD').status"),'Exceeds');
  const drinking=s.run("screenSoil(c, 1, 'µg/g', 'RLLD', {factors:{drinking:'applicable'}})");
  assert.equal(drinking.status,'Inconclusive');assert.equal(drinking.threshold,120);
  assert.equal(drinking.comparisons.find(c=>c.factor==='drinking').threshold,null);
  assert.match(s.run("c.standards.find(r=>r.factor==='aquatic').conditions.join(' ')"),/hardness/);
  assert.equal(s.run("c.standards.find(r=>r.factor==='intake').conditions.length"),0);
});

test('scope of explanatory and activity notes follows the official factor note column', () => {
  const s=setup();
  for(const id of ['beryllium','cadmium','copper','lead','manganese','nickel','selenium','zinc','chloride','dipa','pcp','pfos','sulfolane']) {
    s.context.c=data.contaminants.find(c=>c.id===id);
    assert.equal(s.run("c.standards.find(r=>r.factor==='intake').conditions.length"),0,id);
  }
  s.context.c=data.contaminants.find(c=>c.id==='pfos');
  assert.equal(s.run("screenSoil(c, 0, 'µg/g', 'RLLD').status"),'Pass');
  assert.equal(s.run("screenSoil(c, 0, 'µg/g', 'RLLD', {factors:{drinking:'applicable'}}).status"),'Inconclusive');
  s.context.c=data.contaminants.find(c=>c.id==='pcbs');
  assert.equal(s.run("screenSoil(c, 0, 'µg/g', 'RLLD').status"),'Inconclusive');
});

test('both layouts expose the controlling factor and individual standards with official page links', () => {
  const s=setup('results.js');s.seed([record('benzene',{soilConc:1})]);
  s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'RLLD'});renderResults()");
  for(const layout of ['rows','matrix']) {
    s.element('resultLayout').value=layout;s.run('renderResultCards(latestRows)');
    const html=s.element('resultsTable').innerHTML;
    assert.doesNotMatch(html,/Controlling factor:/);
    assert.match(html,/Standards by factor/);assert.match(html,/#page=4/);
    assert.match(html,/Intake of contaminated soil/);assert.match(html,/150 µg\/g/);
    assert.doesNotMatch(html,/Groundwater used for drinking water|Not applicable/);
    assert.doesNotMatch(html,/data-action="info"/);
  }
});

test('APEC deletion waits for the website decision; cancellation preserves all sample data', async () => {
  const s=setup('labdata.js');s.seed([record('benzene',{soilConc:0})]);s.run('renderSampleEditor()');
  s.element('addApecBtn').handlers.click();
  const before=s.run('JSON.stringify(getActiveProfile().apecs)');
  const id=s.run('getActiveProfile().apecs[0].id');
  const button={dataset:{action:'delete-apec'},closest(selector){return selector==='[data-apec]'?{dataset:{apec:id}}:null;}};
  let decide;s.context.showSiteDialog=()=>new Promise(resolve=>{decide=resolve;});
  const pending=s.element('labTable').handlers.click({target:{closest(){return button;}}});
  assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
  decide(false);await pending;
  assert.equal(s.run('JSON.stringify(getActiveProfile().apecs)'),before);
  s.context.showSiteDialog=async()=>true;
  await s.element('labTable').handlers.click({target:{closest(){return button;}}});
  assert.equal(s.run('getActiveProfile().apecs.length'),1);
  assert.notEqual(s.run('getActiveProfile().apecs[0].id'),id);
});

test('empty samples and APECs delete without warnings, even beside a populated sample', async () => {
  const s=setup('labdata.js');s.seed([record('benzene',{soilConc:1})]);s.run('renderSampleEditor()');
  s.run('changeSampleData(apecs=>apecs[0].locations[0].samples.push(newSample(apecs[0])))');
  let prompts=0;s.context.showSiteDialog=async()=>{prompts++;return false;};
  const apec=s.run('getActiveProfile().apecs[0]'),location=apec.locations[0],empty=location.samples.at(-1);
  function button(action,apecId,sampleId) {
    return {dataset:{action},closest(selector){return ({
      '[data-apec]':{dataset:{apec:apecId}},
      '[data-location]':{dataset:{location:location.id}},
      '[data-sample]':{dataset:{sample:sampleId}}
    })[selector];}};
  }
  async function click(target) {await s.element('labTable').handlers.click({target:{closest(){return target;}}});}
  await click(button('delete-sample',apec.id,empty.id));
  assert.equal(s.run('getSoilSamples().length'),1);assert.equal(prompts,0);
  await click(button('delete-sample',apec.id,location.samples[0].id));
  assert.equal(s.run('getSoilSamples().length'),1);assert.equal(prompts,1);
  s.element('addApecBtn').handlers.click();
  const emptyApec=s.run('getActiveProfile().apecs[1].id');
  await click(button('delete-apec',emptyApec));
  assert.equal(s.run('getActiveProfile().apecs.length'),1);assert.equal(prompts,1);
});

test('deletion warnings recognize zero, non-detection, reporting limits, dates, and changed units', () => {
  const s=setup('labdata.js');
  assert.equal(s.run("sampleHasEnteredData({date:'',results:[{value:'',reportingLimit:'',qualifier:'detected',unit:DEFAULT_SOIL_UNIT}]})"),false);
  for(const result of [{value:0},{qualifier:'non_detect'},{reportingLimit:0},{unit:'mg/kg'}]) {
    s.context.result=result;
    // mg/kg is the other supported soil unit, distinct from the default µg/g.
    assert.equal(s.run('sampleHasEnteredData({results:[result]})'),true);
  }
  assert.equal(s.run("sampleHasEnteredData({date:'2026-10-18',results:[]})"),true);
});

test('Results offers direct CSV exports only, with no PDF or Word library or handlers', async () => {
  const buttons=Array.from({length:2},()=>({addEventListener(event,handler){this[event]=handler;}}));
  const s=setup('results.js',[['[data-csv-export-btn]',buttons]]);
  s.seed([record('benzene',{soilConc:0})]);s.run('renderResults()');
  let blob;s.context.capture=b=>blob=b;s.run('downloadBlob=capture');
  for(const button of buttons) {button.click();assert.match(blob.type,/text\/csv/);assert.match(await blob.text(),/Benzene/);}
  const html=fs.readFileSync(path.join(root,'results.html'),'utf8');
  assert.equal((html.match(/data-csv-export-btn/g)||[]).length,2);
  assert.doesNotMatch(html,/data-print-btn|data-word-export-btn|data-export-menu-btn|docx@|Export PDF|Export Word/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'results.js'),'utf8'),/exportWordReport|printReport|window\.print\(/);
});

test('Results Back links return to Saved assessments only when opened from the library',()=>{
  for(const fromSaved of [false,true]) {
    const links=[{href:'labdata.html'},{href:'labdata.html'}];
    const s=setup(null,[['[data-results-back]',links]]);
    s.context.window.location.search=fromSaved?'?from=saved':'';
    vm.runInContext(fs.readFileSync(path.join(root,'results.js'),'utf8'),s.context);
    assert.deepEqual(links.map(link=>link.href),Array(2).fill(fromSaved?'account.html#saved':'labdata.html'));
  }
});

test('continued assessments sync existing sample rows to selection and restore deselected measurements',()=>{
 const s=setup('labdata.js');
 s.seed([record('arsenic'),record('benzene')]);
 s.run('renderSampleEditor()');
 s.run("changeSampleData(apecs=>{const sample=apecs[0].locations[0].samples[0];sample.results.find(r=>r.contaminantId==='arsenic').value=55;sample.results.find(r=>r.contaminantId==='benzene').value=0;})");
 const sampleId=s.run('getSoilSamples()[0].sample.id');
 s.run("saveSelectedContaminants(fixture,new Set(['benzene','toluene']));initializeSampleEditor(fixture)");
 assert.deepEqual(JSON.parse(s.run('JSON.stringify(getSoilSamples()[0].sample.results.map(r=>r.contaminantId).sort())')),['benzene','toluene']);
 assert.equal(s.run("getSoilSamples()[0].sample.results.find(r=>r.contaminantId==='benzene').value"),0);
 assert.doesNotMatch(s.element('labTable').innerHTML,/data-contaminant="arsenic"/);
 assert.equal(s.run('getSampleScreeningRows(fixture,getActiveProfile()).some(r=>r.contaminant.id==="arsenic")'),false);
 s.run("saveSelectedContaminants(fixture,new Set(['arsenic','benzene']));initializeSampleEditor(fixture)");
 assert.equal(s.run("getSoilSamples()[0].sample.results.find(r=>r.contaminantId==='arsenic').value"),55);
 assert.equal(s.run('getSoilSamples()[0].sample.id'),sampleId);
});

test('factor breakdown uses aligned columns and status-specific labels without changing screening',()=>{
 const s=setup('results.js');s.seed([record('benzene',{soilConc:300})]);
 s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'RLHD'});renderResults()");
 for(const layout of ['rows','matrix']) {
  s.element('resultLayout').value=layout;s.run('renderResultCards(latestRows)');
  const html=s.element('resultsTable').innerHTML;
  assert.match(html,/class="result-factor-table"/);
  for(const label of ['Soil protection factor','Standard','Comparison','Source']) assert.ok(html.includes(label));
  assert.match(html,/factor-comparison--exceeds[^>]*>Exceeds/);
  assert.match(html,/factor-comparison--below[^>]*>Below standard/);
  assert.doesNotMatch(html,/factor-comparison--inactive|Not applicable/);
  assert.doesNotMatch(html,/>Pass</);
  assert.doesNotMatch(html,/Sets standard/);
  assert.doesNotMatch(html,/factor-row--controlling|<u>/);
  assert.match(html,/aria-hidden="true">⚠️<\/span> 250 µg\/g/);
 }
});


test('factor details hide only not-applicable rows and preserve unresolved comparisons and source data',()=>{
 const s=setup('results.js');
 s.seed([record('benzene',{soilConc:300})]);
 s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'RLHD',factors:{drinking:'not_assessed',livestock:'applicable'}});renderResults()");
 const before=s.run('JSON.stringify(latestRows[0].matrices[0].result)');
 const html=s.run('resultFactorMarkup(latestRows[0].matrices[0])');
 assert.match(html,/Groundwater used for drinking water/);assert.match(html,/Not assessed/);
 assert.match(html,/Livestock ingesting soil and fodder/);assert.match(html,/Requires review/);
 assert.doesNotMatch(html,/Groundwater used for irrigation|Not applicable|Sets standard/);
 assert.equal(s.run('JSON.stringify(latestRows[0].matrices[0].result)'),before);
});

test('results CSV filenames include zero-padded local date and time',()=>{
 const s=setup('results.js');s.seed([record('benzene',{soilConc:0})]);s.run('renderResults()');
 let filename;s.context.capture=(_blob,name)=>{filename=name;};
 s.run("Date=class extends Date { constructor(...args) { super(...(args.length?args:[2026,9,22,1,28,51])); } };downloadBlob=capture;exportResultsCsv()");
 assert.equal(filename,'bc-csr-results-2026-10-22_01-28-51.csv');
 assert.doesNotMatch(filename,/[/:]/);
});


test('warning triangles appear only beside exceeded factor standards',()=>{
 const s=setup('results.js');s.seed([record('benzene',{soilConc:300})]);
 s.run("updateActiveProfileData({assessmentMode:'current',currentLandUse:'RLLD'});renderResults()");
 let html=s.run('resultFactorMarkup(latestRows[0].matrices[0])');
 assert.equal((html.match(/⚠️/g)||[]).length,2);
 assert.match(html,/⚠️<\/span> 150 µg\/g/);assert.match(html,/⚠️<\/span> 100 µg\/g/);
 s.run("updateActiveProfileData({currentLandUse:'RLHD'});renderResults()");
 html=s.run('resultFactorMarkup(latestRows[0].matrices[0])');
 assert.equal((html.match(/⚠️/g)||[]).length,1);
 assert.match(html,/<td class="result-factor-standard">350 µg\/g<\/td>/);
});


test('factor disclosure sits directly beneath CAS and opens only its associated full-width panel',()=>{
 const s=setup('results.js');s.seed([record('benzene',{soilConc:300})]);s.run('renderResults()');
 for(const layout of ['rows','matrix']) {
  s.element('resultLayout').value=layout;s.run('renderResultCards(latestRows)');
  const html=s.element('resultsTable').innerHTML;
  assert.match(html,/CAS 71-43-2<\/small><button[^>]*data-factor-toggle/);
  assert.doesNotMatch(html,/Controlling factor:|Lowest resolved factor:|<details/);
  const ids=[...html.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(ids.length);assert.equal(new Set(ids).size,ids.length);
  for(const id of ids) assert.ok(html.includes(`id="${id}" class="result-provenance-row" hidden`));
 }
 const panel=s.element('test-panel');panel.hidden=true;
 const button={attrs:{'aria-controls':'test-panel','aria-expanded':'false'},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;}};
 const event={target:{closest(selector){return selector==='[data-factor-toggle]'?button:null;}}};
 s.element('resultsTable').handlers.click(event);assert.equal(panel.hidden,false);assert.equal(button.attrs['aria-expanded'],'true');
 s.element('resultsTable').handlers.click(event);assert.equal(panel.hidden,true);assert.equal(button.attrs['aria-expanded'],'false');
});
