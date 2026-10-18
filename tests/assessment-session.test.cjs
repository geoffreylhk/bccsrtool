const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');

function setup(page='workflow'){
  const storage=new Map(),events={},timers=[];let callback,reloads=0,sort='category';
  const context=vm.createContext({
    document:{addEventListener(){},getElementById(id){return page==='account' && ['authStatus','accountPanel'].includes(id)?{}:null;}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{dispatchEvent(){},addEventListener(name,handler){events[name]=handler;},location:{reload(){reloads++;}}},
    CustomEvent:class{},setTimeout(fn){timers.push(fn);},client:{auth:{onAuthStateChange(handler){callback=handler;}},from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{chemical_sort:sort}};}};return q;}}
  });
  vm.runInContext(fs.readFileSync(require.resolve('../data-utils.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../assessment-session.js'),'utf8').replace("import { supabase } from './supabase-client.js';",'const supabase=client;'),context);
  const run=code=>vm.runInContext(code,context);
  const seed=()=>run("markAssessmentStarted(); updateActiveProfileData({currentLandUse:'RLLD',selectedContaminants:[{id:'benzene',soilConc:5}]});");
  return {storage,events,run,seed,setSort:value=>{sort=value;},flush:async()=>{await Promise.all(timers.splice(0).map(fn=>fn()));},emit:(name,id)=>callback(name,id?{user:{id}}:null),reloads:()=>reloads};
}

test('switching accounts removes the former working assessment and all resume/backups',()=>{
  const s=setup();s.emit('INITIAL_SESSION','alice');s.seed();
  s.storage.set('bcCsrAssessmentBeforeOpen','Alice recovery');s.storage.set('bcCsrToolStateBeforeSamples','Alice original');
  s.emit('SIGNED_IN','bob');
  assert.equal(s.run('hasSavedProgress()'),false);
  assert.equal(s.run('getActiveProfile().selectedContaminants.length'),0);
  assert.equal(s.storage.has('siteInfo'),false);
  assert.equal(s.storage.has('bcCsrAssessmentBeforeOpen'),false);
  assert.equal(s.storage.has('bcCsrToolStateBeforeSamples'),false);
  assert.equal(s.storage.get('bcCsrWorkingAccount'),'bob');
  assert.equal(s.reloads(),1);
});

test('same-account token refresh and repeated sign-in preserve the working assessment',()=>{
  const s=setup();s.emit('INITIAL_SESSION','alice');s.seed();const before=s.storage.get('bcCsrToolState');
  s.emit('TOKEN_REFRESHED','alice');s.emit('SIGNED_IN','alice');
  assert.equal(s.storage.get('bcCsrToolState'),before);assert.equal(s.reloads(),0);
});

test('guest progress may enter an account but cannot leak out on sign-out',()=>{
  const s=setup();s.emit('INITIAL_SESSION');s.seed();s.emit('SIGNED_IN','alice');
  assert.equal(s.run('hasSavedProgress()'),true);
  s.emit('SIGNED_OUT');assert.equal(s.run('hasSavedProgress()'),false);
  s.emit('SIGNED_IN','bob');assert.equal(s.run('hasSavedProgress()'),false);
});

test('unattributed legacy account progress is cleared on first account initialization',()=>{
  const s=setup();s.seed();s.emit('INITIAL_SESSION','bob');
  assert.equal(s.run('hasSavedProgress()'),false);
});

test('another tab changing ownership or clearing progress reloads stale forms',()=>{
  const s=setup();s.events.storage({key:'bcCsrWorkingAccount',newValue:'bob'});
  s.events.storage({key:'bcCsrToolState',newValue:null});
  assert.equal(s.reloads(),2);
  s.events.storage({key:'theme',newValue:'dark'});assert.equal(s.reloads(),2);
});

test('account changes reload the account page so the old email and profile are removed too',()=>{
  const s=setup('account');s.emit('INITIAL_SESSION','alice');s.seed();s.emit('SIGNED_IN','bob');
  assert.equal(s.reloads(),1);assert.equal(s.run('hasSavedProgress()'),false);
});


test('saved account defaults apply after sign-in and initialize fresh assessments', async()=>{
  const s=setup();s.setSort('alpha');s.emit('INITIAL_SESSION','alice');await s.flush();
  assert.equal(s.run('getAppState().ui.contaminantsSort.type'),'alpha');
  assert.equal(s.run('getAppState().ui.resultsSort.type'),'alpha');
  s.run('clearAssessment()');
  assert.equal(s.run('getAppState().ui.contaminantsSort.type'),'alpha');
  s.emit('SIGNED_OUT');
  assert.equal(s.run('getDefaultChemicalSort()'),'category');
  assert.equal(s.storage.has('bcCsrAccountPreferences'),false);
});

test('same saved default preserves assessment sorting overrides and another account cannot apply it',()=>{
  const s=setup();s.emit('INITIAL_SESSION','alice');
  s.run("applyAccountChemicalSort('alice','alpha'); updateAppUi({contaminantsSort:{type:'default'}}); applyAccountChemicalSort('alice','alpha')");
  assert.equal(s.run('getAppState().ui.contaminantsSort.type'),'default');
  s.run("applyAccountChemicalSort('bob','category')");
  assert.equal(s.run('getDefaultChemicalSort()'),'alpha');
});
