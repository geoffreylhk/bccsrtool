import { supabase } from './supabase-client.js';

const saveForm = document.getElementById('accountSaveForm');
const savedList = document.getElementById('savedAssessments');
const savedStatus = document.getElementById('savedAssessmentStatus');
let accountUser;
let busy = false;

function assessmentStatus(message, error = false) {
  savedStatus.textContent = message;
  savedStatus.dataset.error = String(error);
}

function assessmentData(result) {
  if (result.error) {
    if (['42P01', 'PGRST205'].includes(result.error.code)) {
      throw new Error('Account saving is not available yet. Your assessment is still saved in this browser.');
    }
    if (result.error.code === 'PGRST116') {
      throw new Error('This saved assessment has changed or is no longer available. Reopen it from your account before saving again.');
    }
    throw new Error('Unable to access saved assessments. Check your connection and try again. Your browser assessment is unchanged.');
  }
  return result.data;
}

async function requireAssessmentUser() {
  const result = await supabase.auth.getUser();
  if (result.error || !result.data?.user || result.data.user.id !== accountUser?.id) {
    throw new Error('Your sign-in has changed or expired. Sign in again before accessing saved assessments.');
  }
  if (switchAssessmentAccount(result.data.user.id)) {
    throw new Error('The previous account’s working assessment was cleared. Open one of your saved assessments or start a new assessment.');
  }
  return result.data.user;
}

async function saveAccountAssessment(title, asCopy = false) {
  const owner = await requireAssessmentUser();
  title = title.trim();
  if (!title || title.length > 100) throw new Error('Enter an assessment name of 1–100 characters.');
  const state = getAppState();
  const payload = getAssessmentSnapshot(state);
  if (!getActiveProfile(state).selectedContaminants.length) throw new Error('Choose contaminants before saving an assessment.');
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 250000) {
    throw new Error('This assessment is too large to save to your account. Your browser copy is unchanged.');
  }
  const linked = state.cloudAssessment;
  const update = !asCopy && linked?.userId === owner.id;
  const query = update
    ? supabase.from('saved_assessments').update({ title, payload }).eq('id', linked.id).eq('user_id', owner.id).eq('revision', linked.revision)
    : supabase.from('saved_assessments').insert({ user_id: owner.id, title, payload });
  const record = assessmentData(await query.select('id, user_id, title, revision').single());
  const current = getAppState();
  // Don't attach a save to a different assessment started in another tab.
  if (localStorage.getItem(WORKING_ASSESSMENT_ACCOUNT_KEY) === owner.id && getActiveProfile(current).siteId === getActiveProfile(state).siteId) {
    saveAppState({ ...current, cloudAssessment: { id: record.id, userId: owner.id, revision: record.revision, title: record.title } });
  }
  return record;
}

async function openAccountAssessment(id, page) {
  const owner = await requireAssessmentUser();
  const record = assessmentData(await supabase.from('saved_assessments').select('*').eq('id', id).eq('user_id', owner.id).single());
  getAssessmentSnapshot(record.payload);
  if (!window.confirm('Open this saved assessment? It will replace the working assessment in this browser. Account saves remain unchanged until you save again.')) return;
  await requireAssessmentUser();
  restoreAccountAssessment(record, owner.id);
  window.location.href = page;
}

async function nextAssessmentName() {
  const owner = await requireAssessmentUser();
  let highest = 0;
  for (let offset = 0; ; offset += 100) {
    const records = assessmentData(await supabase.from('saved_assessments')
      .select('title').eq('user_id', owner.id).order('id').range(offset, offset + 99));
    await requireAssessmentUser();
    for (const record of records) {
      const match = /^Assessment ([1-9]\d*)$/.exec(record.title);
      const number = match ? Number(match[1]) : 0;
      if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER) highest = Math.max(highest, number);
    }
    if (records.length < 100) return `Assessment ${highest + 1}`;
  }
}

async function listAccountAssessments() {
  const owner = await requireAssessmentUser();
  const records = assessmentData(await supabase.from('saved_assessments')
    .select('id, title, updated_at, revision').eq('user_id', owner.id).order('updated_at', { ascending: false }).limit(100));
  await requireAssessmentUser();
  savedList.replaceChildren();
  if (!records.length) {
    savedList.textContent = 'No saved assessments yet. Complete an assessment and choose Save to account on the Results page.';
  }
  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'card saved-assessment-card';
    const heading = document.createElement('h3');
    heading.textContent = record.title;
    const date = document.createElement('p');
    date.textContent = `Saved ${new Date(record.updated_at).toLocaleString()}`;
    const actions = document.createElement('div');
    actions.className = 'saved-assessment-actions';
    for (const [label, page] of [['View results', 'results.html'], ['Edit values', 'labdata.html'], ['Delete saved assessment', null]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = page ? 'secondary-action' : 'secondary-action delete-assessment-action';
      button.textContent = label;
      button.setAttribute('aria-label', `${label}: ${record.title}`);
      button.addEventListener('click', () => runAssessmentAction(async () => {
        if (page) return openAccountAssessment(record.id, page);
        if (!window.confirm(`Delete “${record.title}” from your account? This cannot be undone. The working browser copy will remain.`)) return;
        const currentOwner = await requireAssessmentUser();
        assessmentData(await supabase.from('saved_assessments').delete().eq('id', record.id).eq('user_id', currentOwner.id).eq('revision', record.revision).select('id').single());
        await listAccountAssessments();
        assessmentStatus('Saved assessment deleted.');
      }));
      actions.append(button);
    }
    card.append(heading, date, actions);
    savedList.append(card);
  }
  assessmentStatus(records.length === 100 ? 'Showing your 100 most recently saved assessments.' : 'Account saves are private to you.');
}

async function runAssessmentAction(action) {
  if (busy) return;
  busy = true;
  const buttons = document.querySelectorAll('[data-account-save] button, #savedAssessments button, #retrySavedAssessments');
  buttons.forEach(button => { button.disabled = true; });
  assessmentStatus('Working…');
  try { await action(); }
  catch (error) { assessmentStatus(error.message, true); }
  finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
}

async function initializeAccountAssessments() {
  const result = await supabase.auth.getUser();
  if (result.error || !result.data?.user) {
    assessmentStatus('Sign in to save assessments to your account. Your working assessment stays in this browser.');
    document.getElementById('assessmentSignin')?.removeAttribute('hidden');
    return;
  }
  accountUser = result.data.user;
  switchAssessmentAccount(accountUser.id);
  if (saveForm) {
    const linked = getAppState().cloudAssessment;
    const ownSave = linked?.userId === accountUser.id;
    document.getElementById('assessmentSaveTitle').value = ownSave ? linked.title : await nextAssessmentName();
    saveForm.hidden = false;
    document.getElementById('saveAssessmentButton').textContent = ownSave ? 'Save changes to account' : 'Save to account';
    document.getElementById('saveAssessmentCopy').hidden = !ownSave;
    saveForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!saveForm.reportValidity()) return;
      runAssessmentAction(async () => {
        await saveAccountAssessment(document.getElementById('assessmentSaveTitle').value);
        document.getElementById('saveAssessmentButton').textContent = 'Save changes to account';
        document.getElementById('saveAssessmentCopy').hidden = false;
        assessmentStatus('Saved to your account. You can reopen it from Saved assessments.');
      });
    });
    document.getElementById('saveAssessmentCopy').addEventListener('click', () => runAssessmentAction(async () => {
      const input = document.getElementById('assessmentSaveTitle');
      const title = /^Assessment [1-9]\d*$/.test(input.value.trim()) ? await nextAssessmentName() : input.value;
      const record = await saveAccountAssessment(title, true);
      input.value = record.title;
      assessmentStatus('A separate copy was saved to your account.');
    }));
    assessmentStatus(`Save to the account signed in as ${accountUser.email}. Changes stay in this browser until you save to your account.`);
  }
  if (savedList) {
    document.getElementById('retrySavedAssessments').addEventListener('click', () => runAssessmentAction(listAccountAssessments));
    await listAccountAssessments();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (accountUser && session?.user?.id !== accountUser.id) {
    saveForm?.setAttribute('hidden', '');
    savedList?.replaceChildren();
    assessmentStatus('Your sign-in has changed. Reload this page to access the current account.');
  }
});
initializeAccountAssessments().catch(error => assessmentStatus(error.message, true));
