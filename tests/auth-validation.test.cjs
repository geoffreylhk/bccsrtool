const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(values = {}) {
  const fields = ['email', 'password', 'confirm_password'].map(name => ({
    name, id: name, value: values[name] ?? '', required: true,
    minLength: name === 'password' ? 8 : -1, maxLength: -1,
    validity: { typeMismatch: name === 'email' && Boolean(values.email) && !values.email.includes('@') },
    dataset: { ...(name === 'password' ? {passwordPolicy:'signup'} : {}) }, attrs: {}, listeners: {},
    setAttribute(k,v) { this.attrs[k]=v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(k,v) { this.listeners[k]=v; }, focus() { this.focused=true; },
    closest() { return { append() {} }; }
  }));
  const rows=Array.from({length:4},()=>({dataset:{},setAttribute(){}}));
  const checklist={hidden:true,querySelectorAll:()=>rows};
  const form = { querySelector:()=>checklist, querySelectorAll: () => fields, elements: { namedItem: name => fields.find(f => f.name===name) } };
  const context = vm.createContext({ window: {}, document: { createElement: () => ({ textContent:'',hidden:true }) } });
  vm.runInContext(fs.readFileSync(require.resolve('../auth-validation.js'),'utf8'),context);
  const api=context.window.authValidation;api.bind(form);
  return { api, form, fields, checklist, rows };
}
test('required, email, minimum length and exact confirmation errors mark the corresponding fields', () => {
  const s=setup({email:'bad',password:'short',confirm_password:'different'});
  assert.equal(s.api.validate(s.form),false);
  assert.ok(s.fields.every(f=>f.attrs['aria-invalid']==='true'));
  assert.equal(s.fields[0].focused,true);
  assert.equal(s.form.noValidate,true);
});
test('corrected fields clear their errors and matching valid values pass', () => {
  const s=setup({email:'a@example.com',password:'Password1!' ,confirm_password:''});
  assert.equal(s.api.validate(s.form),false);
  s.fields[2].value='Password1!';s.fields[2].listeners.input();
  assert.equal(s.fields[2].attrs['aria-invalid'],undefined);
  assert.equal(s.api.validate(s.form),true);
  s.fields[2].value+=' ';assert.equal(s.api.validate(s.form),false);
});
test('invalid credentials mark email and password; unrelated service errors do not blame fields', () => {
  const s=setup({email:'a@example.com',password:'Password1!' ,confirm_password:'Password1!' });
  assert.equal(s.api.showServerError(s.form,{code:'invalid_credentials'}),true);
  assert.equal(s.fields[0].attrs['aria-invalid'],'true');assert.equal(s.fields[1].attrs['aria-invalid'],'true');
  assert.equal(s.api.showServerError(s.form,{code:'over_request_rate_limit'}),false);
});


test('password requirements stay hidden during first typing, appear on blur, and update after that', () => {
 const s=setup({email:'a@example.com',password:'abc',confirm_password:''});
 s.fields[1].listeners.input();assert.equal(s.checklist.hidden,true);
 s.fields[1].listeners.blur();assert.equal(s.checklist.hidden,false);
 assert.deepEqual(s.rows.map(r=>r.dataset.met),['false','false','false','true']);
 s.fields[1].value='Password1!';s.fields[1].listeners.input();
 assert.deepEqual(s.rows.map(r=>r.dataset.met),['true','true','true','true']);
 assert.equal(s.fields[1].attrs['aria-invalid'],undefined);
});
test('eight characters, a number, a special character and edge whitespace are enforced independently', () => {
 for(const password of ['Short1!','Password!','Password1',' Password1!','Password1! ']) {
  const s=setup({email:'a@example.com',password,confirm_password:password});assert.equal(s.api.validate(s.form),false,password);
 }
 const s=setup({email:'a@example.com',password:'Abcdef1!',confirm_password:'Abcdef1!'});assert.equal(s.api.validate(s.form),true);
});
