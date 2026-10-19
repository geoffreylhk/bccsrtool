const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');

function setup(key='public-test-site-key') {
  const widgets=[],scripts=[],timers=[];
  const forms=Array.from({length:3},(_,i)=>{
    const button={disabled:true},message={textContent:''},target={};
    const form={id:['signinForm','signupForm','forgotForm'][i],dataset:{},querySelector:()=>button};
    const container={hidden:true,closest:()=>form,querySelector:selector=>selector==='[data-captcha-status]'?message:target};
    return {form,container,button,message,target};
  });
  const context=vm.createContext({window:{},document:{
    querySelector:()=>({content:key}),querySelectorAll:()=>forms.map(f=>f.container),
    createElement:()=>({}),head:{append(script){scripts.push(script);}}
  },setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}});
  const api={render(target,options){widgets.push({target,options,token:''});return widgets.length-1;},getResponse(id){return widgets[id].token;},reset(id){widgets[id].token='';}};
  const run=()=>vm.runInContext(fs.readFileSync(require.resolve('../auth-captcha.js'),'utf8'),context);
  run();
  return {forms,widgets,scripts,timers,context,api,captcha:context.window.authCaptcha,solve(i){widgets[i].token='token-'+i;widgets[i].options.callback('token-'+i);}};
}

test('unconfigured CAPTCHA preserves the existing flow and never loads third-party scripts',async()=>{
  const s=setup('');await s.captcha.initialize();
  assert.equal(s.scripts.length,0);assert.equal(s.captcha.isReady(s.forms[0].form),true);
  assert.equal(s.captcha.getToken(s.forms[0].form),undefined);
});

test('each form requires its own token; expiry, reset and errors fail closed',async()=>{
  const s=setup();s.context.window.turnstile=s.api;await s.captcha.initialize();
  assert.equal(s.widgets.length,3);
  assert.throws(()=>s.captcha.getToken(s.forms[0].form),/security check/i);
  s.solve(0);assert.equal(s.captcha.getToken(s.forms[0].form),'token-0');
  assert.equal(s.forms[0].button.disabled,false);assert.equal(s.forms[1].button.disabled,true);
  s.widgets[0].options['expired-callback']();assert.equal(s.captcha.isReady(s.forms[0].form),false);
  s.solve(0);s.captcha.reset(s.forms[0].form);assert.equal(s.captcha.isReady(s.forms[0].form),false);
  s.solve(1);s.widgets[1].options['error-callback']();assert.equal(s.forms[1].button.disabled,true);
  assert.throws(()=>s.captcha.getToken(s.forms[1].form),/security check/i);
});

test('widget callbacks never enable a form while its request is in flight',async()=>{
  const s=setup();s.context.window.turnstile=s.api;await s.captcha.initialize();
  s.forms[0].form.dataset.submitting='true';s.solve(0);assert.equal(s.forms[0].button.disabled,true);
});

test('narrow cards use the compact widget to avoid mobile overflow',async()=>{
  const s=setup();s.forms[0].container.clientWidth=240;s.context.window.turnstile=s.api;
  await s.captcha.initialize();assert.equal(s.widgets[0].options.size,'compact');
});

test('script failure or timeout leaves protected forms disabled',async()=>{
  for(const fail of ['error','timeout']) {
    const s=setup();const pending=s.captcha.initialize();
    assert.match(s.scripts[0].src,/^https:\/\/challenges.cloudflare.com\/turnstile\/v0\/api.js\?render=explicit$/);
    if(fail==='error')s.scripts[0].onerror();else s.timers[0]();
    await assert.rejects(pending,/security check/i);
    assert.equal(s.captcha.isReady(s.forms[0].form),false);
    assert.equal(s.forms[0].button.disabled,true);
  }
});

test('successful SDK loading creates the widgets without prematurely enabling forms',async()=>{
  const s=setup(),pending=s.captcha.initialize();
  s.context.window.turnstile=s.api;s.scripts[0].onload();await pending;
  assert.equal(s.widgets.length,3);assert.equal(s.forms[0].button.disabled,true);
});
