const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(supabase) {
  const elements = new Map();
  const storage = new Map();
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        dataset: {}, value: '', hidden: false, listeners: {},
        showModal() { this.open = true; },
        close(value = '') { this.returnValue = value; this.open = false; this.listeners.close?.(); },
        button: { disabled: false },
        querySelector() { return this.button; },
        reportValidity() { return true; },
        reset() { this.wasReset = true; },
        addEventListener(event, handler) { this.listeners[event] = handler; if (event !== 'close') this[event] = handler; }
      });
      return elements.get(id);
    }
  };
  const context = vm.createContext({ document, URL, URLSearchParams,
    CustomEvent: class {}, localStorage: {
      getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key)
    }, FormData: class {
    constructor(form) { this.fields = form.fields; }
    get(key) { return this.fields[key]; }
  }, window: { dispatchEvent() {}, confirm() { return true; }, location: { href: 'http://127.0.0.1:5500/signin.html', replace(url) { this.destination = url; } } } });
  context.showSiteDialog = () => new Promise(resolve => {
    const dialog = document.getElementById('signoutDialog');
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'signout'));
    dialog.showModal();
  });
  vm.runInContext(fs.readFileSync(require.resolve('../data-utils.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../auth.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('initialize().catch')), context);
  context.mockClient = supabase;
  vm.runInContext("supabase = mockClient; user = { id: 'alice', user_metadata: { display_name: 'Alice' } };", context);
  return { context, elements, document, storage };
}

test('sign-out clears browser progress and recovery copies without deleting cloud saves', async () => {
  const {context,storage,document} = setup({auth:{async signOut(){return {data:{}};}},from(){assert.fail('Sign-out must never delete cloud assessments');}});
  vm.runInContext("switchAssessmentAccount('alice'); markAssessmentStarted(); updateActiveProfileData({currentLandUse:'RLLD'});",context);
  storage.set('bcCsrAssessmentBeforeOpen','private backup');
  storage.set('bcCsrToolStateBeforeSamples','private migration backup');
  const pending = vm.runInContext('signOutAccount()',context);
  assert.equal(document.getElementById('signoutDialog').open,true);
  document.getElementById('signoutDialog').close('signout');
  await pending;
  assert.equal(vm.runInContext('hasSavedProgress()',context),false);
  assert.equal(storage.has('bcCsrAssessmentBeforeOpen'),false);
  assert.equal(storage.has('bcCsrToolStateBeforeSamples'),false);
  assert.equal(storage.get('bcCsrWorkingAccount'),'guest');
  assert.equal(context.window.location.destination,'signin.html');
});

test('cancelled and failed sign-out preserve unsaved work', async () => {
  let requests=0;
  const {context,storage,document} = setup({auth:{async signOut(){requests++;return {error:new Error('Offline')};}}});
  vm.runInContext("switchAssessmentAccount('alice'); markAssessmentStarted(); updateActiveProfileData({currentLandUse:'RLLD'});",context);
  const before=storage.get('bcCsrToolState');
  context.window.confirm=()=>assert.fail('Sign-out must use the website dialog');
  const cancelled=vm.runInContext('signOutAccount()',context);
  document.getElementById('signoutDialog').close('cancel');
  assert.equal(await cancelled,false);
  assert.equal(requests,0);
  const failed=vm.runInContext('signOutAccount()',context);
  document.getElementById('signoutDialog').close('signout');
  await assert.rejects(failed,/Offline/);
  assert.equal(storage.get('bcCsrToolState'),before);
});

test('password mismatch never sends a password update', async () => {
  const { elements, document } = setup({ auth: {
    updateUser() { assert.fail('Must not update mismatched passwords'); }
  } });
  const form = document.getElementById('resetForm');
  form.fields = { password: 'long-password-a', confirm_password: 'long-password-b' };
  await form.submit({ preventDefault() {} });
  assert.equal(elements.get('authStatus').textContent, 'The passwords do not match.');
  assert.equal(form.button.disabled, false);
});

test('signup keeps passwords out of metadata and uses the local callback', async () => {
  let request;
  const { elements, document } = setup({ auth: {
    async signUp(value) { request = value; return { data: {}, error: null }; }
  } });
  const form = document.getElementById('signupForm');
  form.fields = { email: ' alice@example.com ', password: 'long-password-a', display_name: ' Alice ' };
  await form.submit({ preventDefault() {} });
  assert.equal(request.email, 'alice@example.com');
  assert.equal(request.options.emailRedirectTo, 'http://127.0.0.1:5500/account.html');
  assert.deepEqual(Object.keys(request.options.data), ['display_name']);
  assert.equal(form.wasReset, true);
  assert.equal(elements.get('authStatus').dataset.error, 'false');
});

test('profile creation recovers when another tab inserts the same profile', async () => {
  let reads = 0;
  const { context, document } = setup({ from(table) {
    assert.equal(table, 'profiles');
    return {
      select() { return { eq(column, id) {
        assert.equal(column, 'id'); assert.equal(id, 'alice');
        return {
          async maybeSingle() { reads++; return { data: null, error: null }; },
          async single() { reads++; return { data: { id: 'alice', display_name: 'Existing name' }, error: null }; }
        };
      } }; },
      async insert(profile) {
        assert.equal(profile.id, 'alice');
        return { error: { code: '23505' } };
      }
    };
  } });
  await vm.runInContext('loadProfile()', context);
  assert.equal(reads, 2);
  assert.equal(document.getElementById('profileName').value, 'Existing name');
});

test('profile errors are not swallowed', async () => {
  const { context } = setup({ from() { return {
    select() { return { eq() { return {
      async maybeSingle() { return { error: new Error('permission denied') }; }
    }; } }; }
  }; } });
  await assert.rejects(vm.runInContext('loadProfile()', context), /permission denied/);
});

test('Google sign-in uses Supabase OAuth and returns to the current account page', async () => {
  let request;
  const {document,context}=setup({auth:{async signInWithOAuth(value){request=value;return {data:{url:'https://accounts.google.com/'},error:null};}}});
  const button=document.getElementById('googleSigninButton');button.disabled=false;
  context.window.location.href='https://www.bccsrtool.ca/signin.html';
  await button.click();
  assert.equal(request.provider,'google');
  assert.equal(request.options.redirectTo,'https://www.bccsrtool.ca/account.html');
  assert.equal(request.options.queryParams.prompt,'select_account');
  assert.equal(button.disabled,true);
  assert.equal(request.options.scopes,undefined);
});

test('Google errors restore the button; repeated clicks cannot start duplicate requests', async () => {
  let resolve,calls=0;
  const {document}=setup({auth:{signInWithOAuth(){calls++;return new Promise(r=>resolve=r);}}});
  const button=document.getElementById('googleSigninButton');button.disabled=false;
  const pending=button.click();await button.click();assert.equal(calls,1);
  resolve({error:new Error('Google provider is not enabled')});await pending;
  assert.equal(button.disabled,false);
  assert.equal(document.getElementById('authStatus').textContent,'Google provider is not enabled');
  assert.equal(document.getElementById('authStatus').dataset.error,'true');
});

test('OAuth callback cancellation and failures are handled without echoing provider text', () => {
  const {context}=setup({});
  context.callback=new URL('https://www.bccsrtool.ca/account.html#error=access_denied&error_description=untrusted');
  assert.match(vm.runInContext('getCallbackError(callback)',context),/cancelled/);
  context.callback=new URL('https://www.bccsrtool.ca/account.html?error=server_error&error_description=untrusted');
  assert.match(vm.runInContext('getCallbackError(callback)',context),/could not be completed/);
  assert.doesNotMatch(vm.runInContext('getCallbackError(callback)',context),/untrusted/);
  context.callback=new URL('https://www.bccsrtool.ca/account.html');
  assert.equal(vm.runInContext('getCallbackError(callback)',context),'');
});

test('new Google profile gets its own name without overwriting an existing profile', async () => {
  let inserted,existing=null;
  const {context,document}=setup({from(){return {
    select(){return {eq(){return {async maybeSingle(){return {data:existing,error:null};},async single(){return {data:inserted,error:null};}};}};},
    async insert(value){inserted=value;return {error:null};}
  };}});
  vm.runInContext("user={id:'google-user',user_metadata:{full_name:' Google Person '}}",context);
  await vm.runInContext('loadProfile()',context);
  assert.equal(inserted.id,'google-user');assert.equal(inserted.display_name,'Google Person');
  existing={id:'google-user',display_name:'Chosen username'};inserted=null;
  await vm.runInContext('loadProfile()',context);
  assert.equal(inserted,null);assert.equal(document.getElementById('profileName').value,'Chosen username');
});


test('website sign-out warning always appears and Escape cannot sign out', async () => {
  let requests=0;
  const {context,document}=setup({auth:{async signOut(){requests++;return {data:{}};}}});
  context.window.confirm=()=>assert.fail('Must never open a browser confirmation');
  const pending=vm.runInContext('signOutAccount()',context);
  const dialog=document.getElementById('signoutDialog');
  assert.equal(dialog.open,true);
  assert.equal(requests,0);
  dialog.close();
  assert.equal(await pending,false);
  assert.equal(requests,0);
});


test('account deletion requires both dialogs and uses the authenticated sign-in email regardless of display name',async()=>{
  let deleted=0,signouts=0;const calls=[];
  const {context,document}=setup({
    auth:{async getUser(){return {data:{user:{id:'alice',email:'alice@example.com'}}};},async signOut(){signouts++;return {data:{}};}},
    from(table){assert.equal(table,'profiles');const q={select(){return q;},eq(key,value){assert.equal(value,'alice');return q;},async maybeSingle(){return {data:{id:'alice',display_name:'Alice Smith'}};}};return q;},
    async rpc(name,args){deleted++;assert.equal(name,'delete_own_account');assert.equal(args.confirmation_name,'alice@example.com');return {data:null};}
  });
  document.getElementById('profileName').value='Unsaved new name';
  let decisions=[false];context.showSiteDialog=async(message,options)=>{calls.push(options);return decisions.shift();};
  assert.equal(await vm.runInContext('deleteAccount()',context),false);assert.equal(deleted,0);
  decisions=[true,false];assert.equal(await vm.runInContext('deleteAccount()',context),false);assert.equal(deleted,0);
  assert.equal(calls.at(-1).requiredText,'alice@example.com');
  assert.equal(calls[0].title,'Are you sure?');
  decisions=[true,true];assert.equal(await vm.runInContext('deleteAccount()',context),true);
  assert.equal(deleted,1);assert.equal(signouts,1);
  assert.equal(context.window.location.destination,'signin.html');
});

test('account deletion failure leaves browser work intact and changed accounts cannot delete',async()=>{
  let account='alice',requests=0;
  const {context,storage}=setup({auth:{async getUser(){return {data:{user:{id:account,email:'alice@example.com'}}};}},
    from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{display_name:'Alice'}};}};return q;},
    async rpc(){requests++;return {error:{code:'offline'}};}
  });
  context.showSiteDialog=async()=>true;
  vm.runInContext("switchAssessmentAccount('alice');markAssessmentStarted();updateActiveProfileData({siteName:'Keep this'})",context);
  const before=storage.get('bcCsrToolState');
  await assert.rejects(vm.runInContext('deleteAccount()',context),/could not be completed/);
  assert.equal(storage.get('bcCsrToolState'),before);
  account='bob';await assert.rejects(vm.runInContext('deleteAccount()',context),/sign-in has changed/);
  assert.equal(requests,1);
});

test('settings update validates and saves the account sorting default',async()=>{
  let request;
  const {context,document,storage}=setup({auth:{async getUser(){return {data:{user:{id:'alice'}}};}},from(){const q={update(value){request=value;return q;},eq(){return q;},select(){return q;},async single(){return {data:{id:'alice'}};}};return q;}});
  vm.runInContext("switchAssessmentAccount('alice');accountSettingsReady=true",context);
  const form=document.getElementById('profileForm');form.fields={display_name:'Alice',chemical_sort:'alpha'};
  await form.submit({preventDefault(){}});
  assert.equal(request.chemical_sort,'alpha');
  assert.equal(JSON.parse(storage.get('bcCsrAccountPreferences')).chemicalSort,'alpha');
  form.fields.chemical_sort='unknown';request=undefined;await form.submit({preventDefault(){}});
  assert.equal(request,undefined);
});
