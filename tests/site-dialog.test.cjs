const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
  const elements = [];
  const opener = { focused: false, focus() { this.focused = true; } };
  function element(tag) {
    const node = { tag, children: [], attrs: {}, handlers: {}, returnValue: '',
      append(...children) { this.children.push(...children); },
      prepend(...children) { this.children.unshift(...children); },
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      showModal() { this.open = true; },
      close(value = '') { this.returnValue = value; this.open = false; this.handlers.close(); },
      remove() { this.removed = true; }
    };
    elements.push(node); return node;
  }
  const document = { activeElement: opener, body: element('body'), createElement: element };
  const context = vm.createContext({document});
  vm.runInContext(fs.readFileSync(require.resolve('../site-dialog.js'), 'utf8'), context);
  return { run: code => vm.runInContext(code, context), elements, opener,
    dialog: () => elements.filter(e => e.tag === 'dialog').at(-1) };
}

test('confirmation shows Yes left and No right, focuses No, and restores focus on cancellation', async () => {
  const s = setup();const pending = s.run("showSiteDialog('Unsaved changes',{title:'Save first?',danger:true})");
  const dialog = s.dialog(), buttons = dialog.children[2].children;
  assert.equal(dialog.open, true);
  assert.equal(dialog.children[0].textContent, 'Save first?');
  assert.deepEqual(buttons.map(b=>b.textContent),['Yes','No']);
  assert.equal(buttons[1].autofocus,true);
  assert.match(buttons[0].className,/danger/);
  dialog.close('cancel');
  assert.equal(await pending,false);assert.equal(dialog.removed,true);assert.equal(s.opener.focused,true);
});

test('acceptance is explicit; Escape and duplicate clicks cannot confirm an action', async () => {
  const s=setup();const first=s.run("showSiteDialog('Delete?')");
  assert.equal(await s.run("showSiteDialog('Duplicate')"),false);
  assert.equal(s.elements.filter(e=>e.tag==='dialog').length,1);
  s.dialog().close();assert.equal(await first,false);
  const second=s.run("showSiteDialog('Delete?')");
  s.dialog().close('accept');assert.equal(await second,true);
});

test('export errors have one OK button and untrusted titles/messages stay plain text', async () => {
  const s=setup();const pending=s.run("showSiteDialog('<img onerror=bad>', {title:'<script>bad</script>',notice:true})");
  const dialog=s.dialog();
  assert.equal(dialog.children[0].textContent,'<script>bad</script>');
  assert.equal(dialog.children[1].textContent,'<img onerror=bad>');
  const buttons=dialog.children[2].children;
  assert.equal(buttons.length,1);assert.equal(buttons[0].textContent,'OK');
  s.dialog().close('accept');await pending;
});

test('all former browser alerts/confirmations use the shared website dialog, loaded before their callers', () => {
  for(const file of ['auth.js','script.js','labdata.js','account-assessments.js','results.js']) {
    assert.doesNotMatch(fs.readFileSync(require.resolve('../'+file),'utf8'),/\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/);
  }
  for(const [page,script] of [['account.html','auth.js'],['index.html','script.js'],['labdata.html','labdata.js'],['results.html','results.js']]) {
    const html=fs.readFileSync(require.resolve('../'+page),'utf8');
    assert.ok(html.indexOf('src="site-dialog.js')>=0);
    assert.ok(html.indexOf('src="site-dialog.js')<html.indexOf('src="'+script));
  }
});


test('typed deletion confirmation stays disabled unless the complete email address matches exactly', async()=>{
  const s=setup(),pending=s.run("showSiteDialog('Type email',{requiredText:'alice@example.com',danger:true})");
  const form=s.dialog().children[2],label=form.children[0],input=label.children[0],accept=form.children[1];
  assert.equal(accept.disabled,true);
  for(const value of ['alice','Alice@example.com','alice@example.com ']) {
    input.value=value;input.handlers.input();assert.equal(accept.disabled,true);
  }
  let prevented=false;form.handlers.submit({submitter:accept,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  input.value='alice@example.com';input.handlers.input();assert.equal(accept.disabled,false);
  s.dialog().close('accept');assert.equal(await pending,true);
});

test('formatted warnings preserve plain text and both new-assessment buttons can be neutral', async()=>{
  const s=setup(),pending=s.run("showSiteDialog(['This will ',{text:'clear',red:true},' <img onerror=bad>\\n',{text:'This cannot be undone.'}],{neutral:true})");
  const dialog=s.dialog(),parts=dialog.children[1].children;
  assert.deepEqual(parts.map(p=>p.tag),['span','strong','span','strong']);
  assert.equal(parts[1].className,'dialog-warning-text');
  assert.equal(parts[2].textContent,' <img onerror=bad>\n');
  assert.equal(parts[3].textContent,'This cannot be undone.');
  assert.deepEqual(dialog.children[2].children.map(b=>b.className),['secondary-action','secondary-action']);
  dialog.close('cancel');assert.equal(await pending,false);
});

test('unsaved assessment dialog offers green Save, red New assessment and neutral Cancel with distinct decisions',async()=>{
  for(const [action,expected] of [['accept',true],['discard','discard'],['cancel',false],['',false]]) {
    const s=setup(),pending=s.run("showSiteDialog('Unsaved changes',{confirmLabel:'Save',discardLabel:'New assessment',cancelLabel:'Cancel'})");
    const buttons=s.dialog().children[2].children;
    assert.deepEqual(buttons.map(b=>b.textContent),['Save','New assessment','Cancel']);
    assert.deepEqual(buttons.map(b=>b.className),['primary-action','secondary-action dialog-danger-action','secondary-action']);
    assert.equal(buttons[2].autofocus,true);
    s.dialog().close(action);assert.equal(await pending,expected);
  }
});
