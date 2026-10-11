const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(supabase) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        dataset: {}, value: '', hidden: false,
        button: { disabled: false },
        querySelector() { return this.button; },
        reportValidity() { return true; },
        reset() { this.wasReset = true; },
        addEventListener(event, handler) { this[event] = handler; }
      });
      return elements.get(id);
    }
  };
  const context = vm.createContext({ document, URL, FormData: class {
    constructor(form) { this.fields = form.fields; }
    get(key) { return this.fields[key]; }
  }, window: { location: { href: 'http://127.0.0.1:5500/signin.html' } } });
  const source = fs.readFileSync(require.resolve('../auth.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('initialize().catch')), context);
  context.mockClient = supabase;
  vm.runInContext("supabase = mockClient; user = { id: 'alice', user_metadata: { display_name: 'Alice' } };", context);
  return { context, elements, document };
}

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
