const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(elements = {}) {
  const storage = new Map();
  let actualUser = 'alice';
  let response;
  let pages = [];
  const calls = [];
  const client = { auth: { async getUser() { return { data: { user: { id: actualUser } } }; } }, from(table) {
    assert.equal(table, 'saved_assessments');
    const call = { filters: [] }; calls.push(call);
    const query = {
      insert(value) { call.operation = 'insert'; call.value = value; return query; },
      update(value) { call.operation = 'update'; call.value = value; return query; },
      select(value) { call.selection = value; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      async single() { return response; },
      order(value) { call.order = value; return query; },
      async range(from, to) { call.range = [from, to]; return pages.shift() || {data:[]}; }
    };
    return query;
  } };
  const context = vm.createContext({
    document: { getElementById(id) { return elements[id] || null; }, querySelectorAll() { return []; }, addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { dispatchEvent() {}, location: {}, confirm() { return true; } },
    CustomEvent: class {}, TextEncoder, console, mockSupabase: client
  });
  vm.runInContext(fs.readFileSync(require.resolve('../data-utils.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../account-assessments.js'), 'utf8')
    .replace("import { supabase } from './supabase-client.js';", 'const supabase = mockSupabase;');
  vm.runInContext(source.slice(0, source.indexOf('supabase.auth.onAuthStateChange')), context);
  const run = code => vm.runInContext(code, context);
  run("accountUser = {id:'alice'}; switchAssessmentAccount('alice'); updateActiveProfileData({currentLandUse:'RLLD',factors:{intake:'applicable'},selectedContaminants:[{id:'benzene',name:'Benzene',soilConc:0}]});");
  const snapshot = () => JSON.parse(run('JSON.stringify(getAssessmentSnapshot())'));
  const record = () => ({ id: 'saved-1', user_id: 'alice', title: 'My assessment', revision: 1, payload: snapshot() });
  return { run, storage, calls, snapshot, record, context,
    respond: value => { response = value; }, pages: value => { pages = value; }, setUser: value => { actualUser = value; } };
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
    hidden:true,value:'',dataset:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}
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

test('separate numbered copies advance only after saving and preserve custom names', async () => {
  const elements=saveElements(),s=setup(elements);
  s.context.record={...s.record(),title:'Assessment 1'};
  s.run("restoreAccountAssessment(record,'alice')");
  await s.run('initializeAccountAssessments()');
  s.pages([{data:[{title:'Assessment 1'}]}]);
  s.respond({error:{code:'network'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(elements.assessmentSaveTitle.value,'Assessment 1');
  s.pages([{data:[{title:'Assessment 1'}]}]);
  s.respond({data:{...s.record(),id:'saved-2',title:'Assessment 2'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(s.calls.at(-1).value.title,'Assessment 2');
  assert.equal(elements.assessmentSaveTitle.value,'Assessment 2');
  elements.assessmentSaveTitle.value='My custom copy';
  s.respond({data:{...s.record(),id:'saved-3',title:'My custom copy'}});
  await elements.saveAssessmentCopy.handlers.click();
  assert.equal(s.calls.at(-1).value.title,'My custom copy');
});
