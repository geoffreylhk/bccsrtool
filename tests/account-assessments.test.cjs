const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(elements = {}) {
  const storage = new Map();
  let actualUser = 'alice';
  let profileResponse = {data:{id:'alice',display_name:'Alice',chemical_sort:'alpha'}};
  let response;
  let pages = [];
  const calls = [];
  const client = { auth: { async getUser() { return { data: { user: { id: actualUser, email: 'alice@example.com', access_token:'never-export-this', app_metadata:{providers:['google']}, user_metadata:{display_name:'Alice'} } } }; } }, from(table) {
    assert.ok(['saved_assessments','profiles'].includes(table));
    const call = { table, filters: [] }; calls.push(call);
    const query = {
      insert(value) { call.operation = 'insert'; call.value = value; return query; },
      update(value) { call.operation = 'update'; call.value = value; return query; },
      select(value) { call.selection = value; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      async single() { return response; },
      async maybeSingle() { return profileResponse; },
      order(value) { call.order = value; return query; },
      async range(from, to) { call.range = [from, to]; return pages.shift() || {data:[]}; }
    };
    return query;
  } };
  const context = vm.createContext({
    document: { getElementById(id) { return elements[id] || null; }, querySelectorAll() { return []; }, addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { dispatchEvent() {}, location: {}, confirm() { return true; } },
    CustomEvent: class {}, TextEncoder, Blob, console, mockSupabase: client
  });
  context.showSiteDialog = async () => context.window.confirm();
  vm.runInContext(fs.readFileSync(require.resolve('../data-utils.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../account-assessments.js'), 'utf8')
    .replace("import { supabase } from './supabase-client.js';", 'const supabase = mockSupabase;');
  vm.runInContext(source.slice(0, source.indexOf('supabase.auth.onAuthStateChange')), context);
  const run = code => vm.runInContext(code, context);
  run("accountUser = {id:'alice'}; switchAssessmentAccount('alice'); updateActiveProfileData({currentLandUse:'RLLD',factors:{intake:'applicable'},selectedContaminants:[{id:'benzene',name:'Benzene',soilConc:0}]});");
  const snapshot = () => JSON.parse(run('JSON.stringify(getAssessmentSnapshot())'));
  const record = () => ({ id: 'saved-1', user_id: 'alice', title: 'My assessment', revision: 1, payload: snapshot() });
  return { run, storage, calls, snapshot, record, context,
    profile: value => { profileResponse = value; }, respond: value => { response = value; }, pages: value => { pages = value; }, setUser: value => { actualUser = value; } };
}

test('account save uploads assessment inputs without local ownership/session/UI metadata', async () => {
  const s = setup();
  s.run("saveAppState({...getAppState(),cloudAssessment:{id:'other',userId:'alice'},ui:{private:'local'}});");
  s.respond({ data: s.record() });
  await s.run("saveAccountAssessment(' My assessment ',true)");
  assert.equal(s.calls[0].operation, 'insert');
  assert.equal(s.calls[0].value.user_id, 'alice');
  assert.equal(s.calls[0].value.title, 'My assessment');
  assert.equal(s.calls[0].value.payload.cloudAssessment, undefined);
  assert.equal(s.calls[0].value.payload.ui, undefined);
  assert.equal(s.run('getAppState().cloudAssessment.userId'), 'alice');
});

test('editing saved inputs updates the selected record with an optimistic revision check', async () => {
  const s = setup();
  s.context.record = s.record();
  s.run("restoreAccountAssessment(record,'alice'); updateActiveProfileData({siteName:'Changed site'});");
  s.respond({ data: { ...s.record(), revision: 2 } });
  await s.run("saveAccountAssessment('Updated')");
  assert.equal(s.calls[0].operation, 'update');
  assert.deepEqual(s.calls[0].filters, [['id', 'saved-1'], ['user_id', 'alice'], ['revision', 1]]);
  assert.equal(s.calls[0].value.payload.profiles.assessment.siteName, 'Changed site');
  assert.equal(s.run('getAppState().cloudAssessment.revision'), 2);
});

test('save as a copy inserts a new record and retains the prior account record', async () => {
  const s = setup(); s.context.record = s.record();
  s.run("restoreAccountAssessment(record,'alice');");
  s.respond({ data: { ...s.record(), id: 'saved-2' } });
  await s.run("saveAccountAssessment('Copy',true)");
  assert.equal(s.calls[0].operation, 'insert');
  assert.equal(s.run('getAppState().cloudAssessment.id'), 'saved-2');
});

test('stale saves and network failures never report success or change local ownership', async () => {
  const s = setup(); s.context.record = s.record();
  s.run("restoreAccountAssessment(record,'alice');");
  const before = s.storage.get('bcCsrToolState');
  for (const code of ['PGRST116', 'PGRST205', 'network']) {
    s.respond({ error: { code } });
    await assert.rejects(s.run("saveAccountAssessment('Update')"));
    assert.equal(s.storage.get('bcCsrToolState'), before);
  }
});

test('account changes block operations before any assessment query', async () => {
  const s = setup(); s.setUser('bob');
  await assert.rejects(s.run("saveAccountAssessment('Wrong account')"), /sign-in has changed/);
  await assert.rejects(s.run("openAccountAssessment('saved-1','labdata.html')"), /sign-in has changed/);
  assert.equal(s.calls.length, 0);
});

test('empty names and oversized account payloads are rejected before upload', async () => {
  const s = setup();
  await assert.rejects(s.run("saveAccountAssessment('   ')"), /assessment name/);
  s.run("updateActiveProfileData({factorJustifications:{test:'x'.repeat(250001)}});");
  await assert.rejects(s.run("saveAccountAssessment('Too large')"), /too large/);
  assert.equal(s.calls.length, 0);
});

test('successful reopen restores the selected account record and navigates to editing', async () => {
  const s = setup(); const selected = s.record();
  selected.payload.profiles.assessment.siteName = 'Chosen assessment';
  s.respond({ data: selected });
  await s.run("openAccountAssessment('saved-1','labdata.html')");
  assert.equal(s.run('getActiveProfile().siteName'), 'Chosen assessment');
  assert.equal(s.context.window.location.href, 'labdata.html');
});

test('reopening restores area/sample IDs, non-detects, zero, units, land use and factors', () => {
  const s = setup();
  s.run("updateActiveProfileData({apecs:[{id:'a1',name:'Area 1',locations:[{id:'l1',name:'Samples',samples:[{id:'s1',name:'Sample 1',results:[{contaminantId:'benzene',value:0,unit:'mg/kg',qualifier:'detected'},{contaminantId:'arsenic',value:'',unit:'µg/g',qualifier:'non_detect',reportingLimit:0.5}]}]}]}]});");
  const expected = s.snapshot(); s.context.record = s.record();
  s.run("clearAssessment(); restoreAccountAssessment(record,'alice');");
  assert.deepEqual(s.snapshot(), expected);
  assert.equal(s.run('hasSavedProgress()'), true);
  assert.ok(s.storage.has('bcCsrAssessmentBeforeOpen'));
  s.run('clearAssessment()');
  assert.equal(s.storage.has('bcCsrAssessmentBeforeOpen'), false);
});

test('invalid, future-format and wrong-owner records never replace the working assessment', () => {
  const s = setup(); const before = s.storage.get('bcCsrToolState');
  for (const bad of [ { ...s.record(), user_id: 'bob' }, { ...s.record(), payload: {version:99} }, { ...s.record(), payload: {version:5, profiles:{assessment:{apecs:[{}]}}} } ]) {
    s.context.record = bad;
    assert.throws(() => s.run("restoreAccountAssessment(record,'alice')"));
    assert.equal(s.storage.get('bcCsrToolState'), before);
  }
});

test('opening uses owner-filtered fetch and cancellation preserves the working assessment', async () => {
  const s = setup(); const before = s.storage.get('bcCsrToolState');
  s.context.window.confirm = () => false; s.respond({ data: s.record() });
  await s.run("openAccountAssessment('saved-1','labdata.html')");
  assert.deepEqual(s.calls[0].filters, [['id', 'saved-1'], ['user_id', 'alice']]);
  assert.equal(s.storage.get('bcCsrToolState'), before);
  assert.equal(s.context.window.location.href, undefined);
});

test('default assessment numbering follows the highest saved numbered title for this user', async () => {
  const s=setup();
  assert.equal(await s.run('nextAssessmentName()'),'Assessment 1');
  s.pages([{data:[{title:'Assessment 1'}]}]);
  assert.equal(await s.run('nextAssessmentName()'),'Assessment 2');
  s.pages([{data:[{title:'Assessment 3'},{title:'Assessment 1'},{title:'Custom site'},{title:'Assessment 15/10/2026'},{title:'Assessment 90071992547409919999'}]}]);
  assert.equal(await s.run('nextAssessmentName()'),'Assessment 4');
  for (const call of s.calls) {
    assert.deepEqual(call.filters,[['user_id','alice']]);
    assert.equal(call.selection,'title');assert.equal(call.order,'id');
  }
});

test('numbered name lookup checks older pages and rejects errors or changed accounts', async () => {
  const s=setup();
  s.pages([{data:Array.from({length:100},()=>({title:'Custom name'}))},{data:[{title:'Assessment 105'}]}]);
  assert.equal(await s.run('nextAssessmentName()'),'Assessment 106');
  assert.deepEqual(s.calls.map(c=>c.range),[[0,99],[100,199]]);
  s.pages([{error:{code:'network'}}]);
  await assert.rejects(s.run('nextAssessmentName()'),/Unable to access/);
  s.setUser('bob');const before=s.calls.length;
  await assert.rejects(s.run('nextAssessmentName()'),/sign-in has changed/);
  assert.equal(s.calls.length,before);
});

function saveElements() {
  return Object.fromEntries(['accountSaveForm','savedAssessmentStatus','assessmentSaveTitle','saveAssessmentButton','saveAssessmentCopy'].map(id=>[id,{
    hidden:true,value:'',dataset:{},handlers:{},reportValidity(){return true;},addEventListener(event,fn){this.handlers[event]=fn;}
  }]));
}

test('new forms use numbered names while editing keeps the original saved name', async () => {
  const elements=saveElements(),s=setup(elements);
  s.run("updateActiveProfileData({siteName:'Custom site name'})");
  s.pages([{data:[{title:'Assessment 1'}]}]);
  await s.run('initializeAccountAssessments()');
  assert.equal(elements.assessmentSaveTitle.value,'Assessment 2');
  assert.equal(elements.accountSaveForm.hidden,false);
  s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice')");
  await s.run('initializeAccountAssessments()');
  assert.equal(elements.assessmentSaveTitle.value,'My assessment');
  assert.equal(elements.saveAssessmentButton.textContent,'Save changes to account');
});

test('separate copies suffix unchanged names and preserve deliberately changed names', async () => {
  const elements=saveElements(),s=setup(elements);
  s.context.record={...s.record(),title:'Assessment 1'};
  s.run("restoreAccountAssessment(record,'alice')");
  await s.run('initializeAccountAssessments()');
  s.run("updateActiveProfileData({siteName:'Edited site'})");
  s.pages([{data:[{title:'Assessment 1'}]}]);
  s.respond({error:{code:'network'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(elements.assessmentSaveTitle.value,'Assessment 1');
  s.pages([{data:[{title:'Assessment 1'}]}]);
  s.respond({data:{...s.record(),id:'saved-2',title:'Assessment 1 (1)'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(s.calls.at(-1).value.title,'Assessment 1 (1)');
  assert.equal(elements.assessmentSaveTitle.value,'Assessment 1 (1)');
  assert.equal(elements.saveAssessmentButton.hidden,true);
  assert.equal(elements.saveAssessmentCopy.hidden,true);
  elements.assessmentSaveTitle.value='My custom copy';
  s.respond({data:{...s.record(),id:'saved-3',title:'My custom copy'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(s.calls.at(-1).value.title,'My custom copy');
});

test('renaming changes only the owner-filtered title, checks revision and preserves working edits', async () => {
  const s = setup();
  const record = s.record(); s.context.record = record;
  s.run("restoreAccountAssessment(record,'alice'); updateActiveProfileData({siteName:'Unsaved edit'})");
  s.respond({data:{id:record.id,user_id:'alice',title:'New name',revision:2}});
  await s.run("renameAccountAssessment(record,' New name ')");
  assert.equal(JSON.stringify(s.calls[0].value),JSON.stringify({title:'New name'}));
  assert.deepEqual(s.calls[0].filters,[['id',record.id],['user_id','alice'],['revision',1]]);
  assert.equal(s.run('getActiveProfile().siteName'),'Unsaved edit');
  assert.equal(s.run('getAppState().cloudAssessment.title'),'New name');
  assert.equal(s.run('getAppState().cloudAssessment.revision'),2);
  assert.equal(s.run('getAppState().cloudAssessment.savedSnapshot.profiles.assessment.siteName'),'');
});

test('rename failures and invalid titles preserve local ownership and inputs', async () => {
  const s=setup();s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice')");
  const before=s.storage.get('bcCsrToolState');
  await assert.rejects(s.run("renameAccountAssessment(record,'   ')"),/1–100/);
  s.respond({error:{code:'PGRST116'}});
  await assert.rejects(s.run("renameAccountAssessment(record,'New name')"),/has changed/);
  assert.equal(s.storage.get('bcCsrToolState'),before);
  s.setUser('bob');const requests=s.calls.length;
  await assert.rejects(s.run("renameAccountAssessment(record,'New name')"),/sign-in has changed/);
  assert.equal(s.calls.length,requests);
});

test('search matches title and site; sorting supports both date directions without mutating records', () => {
  const s=setup();
  s.context.records=[
    {...s.record(),id:'one',title:'Assessment 10',updated_at:'2026-10-14',payload:{profiles:{assessment:{siteName:'Harbour'}}}},
    {...s.record(),id:'two',title:'Assessment 2',updated_at:'2026-10-17'},
    {...s.record(),id:'three',title:'Custom',updated_at:'2026-10-15'}
  ];
  assert.equal(s.run("visibleAssessments(records,' HARBOUR ').map(r=>r.id).join(',')"),'one');
  assert.equal(s.run("visibleAssessments(records,'assessment').map(r=>r.id).join(',')"),'two,one');
  assert.equal(s.run("visibleAssessments(records,'','recent').map(r=>r.id).join(',')"),'two,three,one');
  assert.equal(s.run("visibleAssessments(records,'','oldest').map(r=>r.id).join(',')"),'one,three,two');
  assert.equal(s.context.records[0].id,'one');
});

test('previews use saved proposed land use and count samples across APECs', () => {
  const s=setup();s.context.record=s.record();
  s.run("record.payload.profiles.assessment.assessmentMode='proposed'; record.payload.profiles.assessment.proposedLandUse='IL'; record.payload.profiles.assessment.apecs=[{locations:[{samples:[{},{}]}]},{locations:[{samples:[{}]}]}]");
  assert.match(s.run('assessmentPreview(record).text'),/Proposed: Industrial.*2 APECs.*3 samples/);
});

test('saving status distinguishes saved inputs, unsaved values and unsaved titles', async () => {
  const elements=saveElements(),s=setup(elements);
  s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice')");
  await s.run('initializeAccountAssessments()');
  assert.match(elements.savedAssessmentStatus.textContent,/^Saved to your account/);
  assert.equal(elements.saveAssessmentButton.hidden,true);
  assert.equal(elements.saveAssessmentCopy.hidden,true);
  s.run("updateActiveProfileData({siteName:'Changed'}); updateAccountSaveStatus()");
  assert.match(elements.savedAssessmentStatus.textContent,/haven’t been saved/);
  assert.equal(elements.saveAssessmentButton.hidden,false);
  assert.equal(elements.saveAssessmentCopy.hidden,false);
  s.run("restoreAccountAssessment(record,'alice')");
  elements.assessmentSaveTitle.value='Renamed locally';s.run('updateAccountSaveStatus()');
  assert.match(elements.savedAssessmentStatus.textContent,/haven’t been saved/);
  elements.assessmentSaveTitle.value='My assessment';s.run('updateAccountSaveStatus()');
  assert.equal(elements.saveAssessmentButton.hidden,true);
  assert.equal(elements.saveAssessmentCopy.hidden,true);
});

test('copy numbering checks every owner page, skips occupied names and fits the name limit',async()=>{
  const s=setup();
  s.pages([{data:Array.from({length:100},(_,i)=>({title:i?'Other '+i:'Former gas station (1)'}))},{data:[{title:'Former gas station (2)'}]}]);
  assert.equal(await s.run("nextAssessmentCopyName('Former gas station')"),'Former gas station (3)');
  for(const call of s.calls) assert.deepEqual(call.filters,[['user_id','alice']]);
  s.pages([{data:[]}]);
  const name=await s.run("nextAssessmentCopyName('x'.repeat(100))");
  assert.equal(name.length,100);assert.ok(name.endsWith(' (1)'));
  s.pages([{error:{code:'network'}}]);
  await assert.rejects(s.run("nextAssessmentCopyName('Former gas station')"),/Unable to access/);
});

test('successful updates hide both save actions and the Results shortcut is removed',async()=>{
  const elements=saveElements(),s=setup(elements);
  s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice')");
  await s.run('initializeAccountAssessments()');
  s.run("updateActiveProfileData({siteName:'Edited'});updateAccountSaveStatus()");
  s.respond({data:{...s.record(),revision:2}});
  await elements.accountSaveForm.handlers.submit({preventDefault(){}});
  assert.equal(elements.saveAssessmentButton.hidden,true);assert.equal(elements.saveAssessmentCopy.hidden,true);
  const html=fs.readFileSync(require.resolve('../results.html'),'utf8');
  assert.doesNotMatch(html,/>Saved assessments<\/a>/);
});

test('library paginates all owner saves so search includes records beyond the first hundred', async () => {
  const s=setup();
  s.pages([{data:Array.from({length:100},(_,i)=>({...s.record(),id:`a${i}`}))},{data:[{...s.record(),id:'older',title:'Old harbour assessment'}]}]);
  s.run('renderSavedAssessments = () => {}');
  await s.run('listAccountAssessments()');
  assert.equal(s.run('savedRecords.length'),101);
  assert.equal(s.run("visibleAssessments(savedRecords,'harbour')[0].id"),'older');
  assert.deepEqual(s.calls.map(c=>c.range),[[0,99],[100,199]]);
  s.calls.forEach(call=>assert.deepEqual(call.filters,[['user_id','alice']]));
});


test('account export includes profile/preferences and every save without session tokens',async()=>{
  const s=setup();
  s.pages([{data:Array.from({length:100},(_,i)=>({...s.record(),id:`save-${i}`}))},{data:[{...s.record(),id:'last-save'}]}]);
  const result=await s.run('collectAccountExport()');
  assert.equal(result.profile.chemical_sort,'alpha');
  assert.equal(result.saved_assessments.length,101);
  assert.equal(result.account.email,'alice@example.com');
  assert.equal(result.account.access_token,undefined);
  assert.doesNotMatch(JSON.stringify(result),/never-export-this/);
  for(const call of s.calls)assert.deepEqual(call.filters,[[call.table==='profiles'?'id':'user_id','alice']]);
});

test('failed or wrong-owner exports never return partial account data',async()=>{
  const s=setup();s.profile({data:{id:'bob'}});
  await assert.rejects(s.run('collectAccountExport()'),/sign-in has changed/);
  s.profile({data:{id:'alice'}});s.pages([{error:{code:'network'}}]);
  await assert.rejects(s.run('collectAccountExport()'),/Unable to access/);
  s.setUser('bob');await assert.rejects(s.run('collectAccountExport()'),/sign-in has changed/);
});

test('account CSV download keeps profile, preferences and nested assessment values safely',async()=>{
  const s=setup({savedAssessmentStatus:{dataset:{}}});
  const saved=s.record();saved.title='=HYPERLINK("example")';
  saved.payload.extra={note:'Commas, "quotes"\r\nand lines',zero:0,empty:'',nothing:null,flag:false,array:[],object:{}};
  s.pages([{data:[saved]}]);
  let file;s.context.capture=(blob,name)=>{file={blob,name};};s.run('downloadBlob=capture');
  await s.run('downloadAccountData()');
  assert.match(file.name,/^bccsrtool-account-data-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(file.blob.type,'text/csv;charset=utf-8');
  const csv=await file.blob.text();s.context.csv=csv;
  const rows=JSON.parse(s.run('JSON.stringify(parseCsv(csv))'));
  assert.deepEqual(rows[0],['section','assessment_id','assessment_name','field','type','value']);
  assert.ok(rows.some(row=>row[0]==='account' && row[3]==='/email' && row[5]==='alice@example.com'));
  assert.ok(rows.some(row=>row[0]==='profile' && row[3]==='/chemical_sort' && row[5]==='alpha'));
  for(const [key,type,value] of [['note','string',saved.payload.extra.note],['zero','number','0'],['empty','string',''],['nothing','null',''],['flag','boolean','false'],['array','array','[]'],['object','object','{}']]) {
    const row=rows.find(row=>row[3]===`/payload/extra/${key}`);
    assert.deepEqual(row.slice(0,3),['saved_assessment',saved.id,"'"+saved.title]);
    assert.deepEqual(row.slice(4),[type,value]);
  }
  assert.doesNotMatch(csv,/never-export-this/);
});

test('CSV cells quote line breaks and protect spreadsheet formulas without changing numeric values',()=>{
  const s=setup();
  for(const text of ['=1+1','+SUM(1,2)','-1+2','@SUM(1,2)','\t=1','\r=1','  =1']) {
    s.context.text=text;
    assert.equal(s.run('parseCsv(csvEscape(text))[0][0]'),"'"+text);
  }
  assert.equal(s.run('csvEscape(-12)'),'-12');
  assert.equal(s.run("parseCsv(csvEscape('a\\rb'))[0][0]"),'a\rb');
});

test('viewing saved results carries the Saved assessments return destination', async()=>{
  const s=setup();s.respond({data:s.record()});
  await s.run("openAccountAssessment('saved-1','results.html')");
  assert.equal(s.context.window.location.href,'results.html?from=saved');
});

test('unchanged saved inputs and reverted edits start fresh without a warning or save',async()=>{
  for(const revert of [false,true]) {
    const elements=saveElements(),s=setup(elements);
    s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice')");
    elements.assessmentSaveTitle.value='My assessment';
    if(revert) s.run("updateActiveProfileData({siteName:'Edited'});updateActiveProfileData({siteName:''});updateAppUi({resultsLayout:'matrix'})");
    s.context.showSiteDialog=()=>assert.fail('Already saved: no warning needed');
    await s.run('startNewAssessment()');
    assert.equal(s.context.window.location.href,'index.html');
    assert.equal(s.run('getActiveProfile().selectedContaminants.length'),0);
    assert.equal(s.calls.length,0);
  }
});

test('unsaved changes can be cancelled or discarded without changing the account save',async()=>{
  for(const decision of [false,'discard']) {
    const elements=saveElements(),s=setup(elements);
    s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice');updateActiveProfileData({siteName:'Unsaved site'})");
    elements.assessmentSaveTitle.value='My assessment';
    const before=s.storage.get('bcCsrToolState');
    s.context.showSiteDialog=async(message,options)=>{
      assert.equal(options.confirmLabel,'Save');assert.equal(options.discardLabel,'New assessment');assert.equal(options.cancelLabel,'Cancel');
      return decision;
    };
    await s.run('startNewAssessment()');
    assert.equal(s.calls.length,0);
    if(decision===false) {assert.equal(s.storage.get('bcCsrToolState'),before);assert.equal(s.context.window.location.href,undefined);}
    else assert.equal(s.context.window.location.href,'index.html');
  }
});

test('Save waits for the account update before starting fresh; save failure preserves edits',async()=>{
  for(const fail of [false,true]) {
    const elements=saveElements(),s=setup(elements);
    s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice');updateActiveProfileData({siteName:'Edited site'})");
    elements.assessmentSaveTitle.value='Renamed assessment';s.context.showSiteDialog=async()=>true;
    let complete;s.respond(new Promise(resolve=>{complete=resolve;}));
    const before=s.storage.get('bcCsrToolState'),pending=s.run('startNewAssessment()');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.storage.get('bcCsrToolState'),before);assert.equal(s.context.window.location.href,undefined);
    assert.equal(s.calls[0].value.payload.profiles.assessment.siteName,'Edited site');
    assert.equal(s.calls[0].value.title,'Renamed assessment');
    complete(fail?{error:{code:'network'}}:{data:{...s.record(),title:'Renamed assessment',revision:2}});
    if(fail) {await assert.rejects(pending,/Unable to access/);assert.equal(s.storage.get('bcCsrToolState'),before);}
    else {await pending;assert.equal(s.context.window.location.href,'index.html');assert.equal(s.run('getActiveProfile().selectedContaminants.length'),0);}
  }
});

test('edits made while saving and account changes during the decision cannot be discarded by Save',async()=>{
  const elements=saveElements(),s=setup(elements);
  s.context.record=s.record();s.run("restoreAccountAssessment(record,'alice');updateActiveProfileData({siteName:'First edit'})");
  elements.assessmentSaveTitle.value='My assessment';s.context.showSiteDialog=async()=>true;
  let complete;s.respond(new Promise(resolve=>{complete=resolve;}));
  const pending=s.run('startNewAssessment()');await new Promise(resolve=>setImmediate(resolve));
  s.run("updateActiveProfileData({siteName:'Newer edit'})");
  complete({data:{...s.record(),revision:2}});
  await assert.rejects(pending,/changed while saving/);
  assert.equal(s.run('getActiveProfile().siteName'),'Newer edit');assert.equal(s.context.window.location.href,undefined);
  s.context.showSiteDialog=async()=>{s.setUser('bob');return 'discard';};
  await assert.rejects(s.run('startNewAssessment()'),/sign-in has changed/);
  assert.equal(s.run('getActiveProfile().siteName'),'Newer edit');
});
