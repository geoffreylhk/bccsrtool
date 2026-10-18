import { supabase } from './supabase-client.js';

const saveForm = document.getElementById('accountSaveForm');
const savedList = document.getElementById('savedAssessments');
const savedStatus = document.getElementById('savedAssessmentStatus');
let accountUser;
let busy = false;
let savedRecords = [];
const assessmentSearch = document.getElementById('assessmentSearch');
const assessmentSort = document.getElementById('assessmentSort');

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
    saveAppState({ ...current, cloudAssessment: { id: record.id, userId: owner.id, revision: record.revision, title: record.title, savedSnapshot: payload } });
  }
  return record;
}

async function openAccountAssessment(id, page) {
  const owner = await requireAssessmentUser();
  const record = assessmentData(await supabase.from('saved_assessments').select('*').eq('id', id).eq('user_id', owner.id).single());
  getAssessmentSnapshot(record.payload);
  if (!await showSiteDialog(['Your current assessment ', { text: 'will be replaced', red: true }, '. Save your current section first if needed.'], { title: 'Open this saved assessment?', confirmLabel: 'Open assessment', cancelLabel: 'Cancel' })) return;
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

function assessmentPreview(record) {
  const profile = record.payload?.profiles?.assessment;
  if (!profile) return { site: '', text: 'Preview unavailable. Open this assessment to check its saved data.' };
  const apecs = Array.isArray(profile.apecs) ? profile.apecs : [];
  const count = apecs.reduce((sum, apec) => sum + (Array.isArray(apec.locations) ? apec.locations : []).reduce((total, location) => total + (Array.isArray(location.samples) ? location.samples.length : 0), 0), 0);
  const proposed = profile.assessmentMode === 'proposed';
  const landUse = proposed ? profile.proposedLandUse : profile.currentLandUse;
  const label = LAND_USE_LABELS[landUse] || 'Land use not selected';
  const site = profile.siteName || 'Unnamed site';
  return { site, text: `${site} · ${proposed ? 'Proposed' : 'Current'}: ${label} · ${apecs.length} APEC${apecs.length === 1 ? '' : 's'} · ${count} sample${count === 1 ? '' : 's'}` };
}

function visibleAssessments(records, search = '', sort = 'recent') {
  const term = search.trim().toLocaleLowerCase();
  return records.filter(record => `${record.title} ${assessmentPreview(record).site}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => (sort === 'oldest' ? 1 : -1) * (new Date(a.updated_at) - new Date(b.updated_at)) || a.id.localeCompare(b.id));
}

async function renameAccountAssessment(record, title) {
  const owner = await requireAssessmentUser();
  title = title.trim();
  if (!title || title.length > 100) throw new Error('Enter an assessment name of 1–100 characters.');
  const updated = assessmentData(await supabase.from('saved_assessments').update({ title })
    .eq('id', record.id).eq('user_id', owner.id).eq('revision', record.revision)
    .select('id, user_id, title, revision, updated_at').single());
  await requireAssessmentUser();
  const state = getAppState();
  if (state.cloudAssessment?.id === record.id && state.cloudAssessment.userId === owner.id && state.cloudAssessment.revision === record.revision) {
    saveAppState({ ...state, cloudAssessment: { ...state.cloudAssessment, title: updated.title, revision: updated.revision } });
  }
  Object.assign(record, updated);
}

function renderSavedAssessments() {
  const records = visibleAssessments(savedRecords, assessmentSearch?.value, assessmentSort?.value);
  savedList.replaceChildren();
  if (!records.length) {
    savedList.textContent = savedRecords.length ? 'No assessments match your search.' : 'No saved assessments yet. Complete an assessment and choose Save to account on the Results page.';
  }
  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'saved-assessment-card';
    const heading = document.createElement('h3');
    heading.textContent = record.title;
    const preview = document.createElement('p');
    preview.className = 'assessment-preview';
    preview.textContent = assessmentPreview(record).text;
    const date = document.createElement('p');
    date.className = 'assessment-date';
    date.textContent = `Last updated ${new Date(record.updated_at).toLocaleString()}`;
    const actions = document.createElement('div');
    actions.className = 'saved-assessment-actions';
    for (const [label, page] of [['View results', 'results.html'], ['Edit values', 'labdata.html'], ['Rename', 'rename'], ['Delete saved assessment', null]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = busy;
      button.className = page ? 'secondary-action' : 'secondary-action delete-assessment-action';
      button.textContent = label;
      button.setAttribute('aria-label', `${label}: ${record.title}`);
      if (page === 'rename') {
        button.addEventListener('click', () => {
          if (card.querySelector('form')) return;
          const form = document.createElement('form');
          form.className = 'assessment-rename-form';
          const fieldLabel = document.createElement('label');
          fieldLabel.textContent = 'Assessment name';
          const input = document.createElement('input');
          input.value = record.title;
          input.required = true;
          input.maxLength = 100;
          fieldLabel.append(input);
          const controls = document.createElement('div');
          controls.className = 'saved-assessment-actions';
          const save = document.createElement('button');
          save.type = 'submit'; save.className = 'primary-action'; save.textContent = 'Save name';
          const cancel = document.createElement('button');
          cancel.type = 'button'; cancel.className = 'secondary-action'; cancel.textContent = 'Cancel';
          cancel.addEventListener('click', () => { form.remove(); button.focus(); });
          controls.append(save, cancel); form.append(fieldLabel, controls); card.append(form); input.focus();
          form.addEventListener('submit', event => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            runAssessmentAction(async () => {
              await renameAccountAssessment(record, input.value);
              renderSavedAssessments();
              assessmentStatus('Assessment renamed.');
              document.getElementById(`rename-${record.id}`)?.focus();
            });
          });
        });
        button.id = `rename-${record.id}`;
      } else button.addEventListener('click', () => runAssessmentAction(async () => {
        if (page) return openAccountAssessment(record.id, page);
        if (!await showSiteDialog([`Delete “${record.title}” from your account?\n`, { text: 'This cannot be undone.' }], { title: 'Delete saved assessment?', confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true })) return;
        const currentOwner = await requireAssessmentUser();
        assessmentData(await supabase.from('saved_assessments').delete().eq('id', record.id).eq('user_id', currentOwner.id).eq('revision', record.revision).select('id').single());
        await listAccountAssessments();
        assessmentStatus('Saved assessment deleted.');
      }));
      actions.append(button);
    }
    card.append(heading, preview, date, actions);
    savedList.append(card);
  }
  assessmentStatus(`${records.length} of ${savedRecords.length} saved assessments`);
}

async function fetchAccountAssessments(owner, columns) {
  const records = [];
  for (let offset = 0; ; offset += 100) {
    const page = assessmentData(await supabase.from('saved_assessments')
      .select(columns).eq('user_id', owner.id).order('id').range(offset, offset + 99));
    await requireAssessmentUser();
    records.push(...page);
    if (page.length < 100) break;
  }
  return records;
}

async function listAccountAssessments() {
  const owner = await requireAssessmentUser();
  savedRecords = await fetchAccountAssessments(owner, 'id, title, updated_at, revision, payload');
  renderSavedAssessments();
}

async function collectAccountExport() {
  const owner = await requireAssessmentUser();
  const profile = assessmentData(await supabase.from('profiles').select('*').eq('id', owner.id).maybeSingle());
  if (profile && profile.id !== owner.id) throw new Error('Your sign-in has changed. Reload before downloading.');
  const assessments = await fetchAccountAssessments(owner, '*');
  await requireAssessmentUser();
  return {
    format: 'bccsrtool-account-data', version: 1, exported_at: new Date().toISOString(),
    account: { id: owner.id, email: owner.email, phone: owner.phone, created_at: owner.created_at,
      updated_at: owner.updated_at, email_confirmed_at: owner.email_confirmed_at,
      last_sign_in_at: owner.last_sign_in_at, providers: owner.app_metadata?.providers, metadata: owner.user_metadata },
    profile, saved_assessments: assessments
  };
}


function updateAccountSaveStatus() {
  if (!saveForm || !accountUser || busy) return;
  const state = getAppState();
  const linked = state.cloudAssessment;
  const sameInputs = linked?.savedSnapshot && JSON.stringify(getAssessmentSnapshot(state)) === JSON.stringify(linked.savedSnapshot);
  const sameTitle = linked?.title === document.getElementById('assessmentSaveTitle').value.trim();
  assessmentStatus(linked?.userId === accountUser.id && sameInputs && sameTitle
    ? 'Saved to your account. Changes on another device appear when you reopen the assessment.'
    : 'Changes haven’t been saved to your account. Save below to keep them across devices.');
}

function selectAccountSection() {
  const profile = ['#settings', '#profile'].includes(window.location.hash);
  document.getElementById('profileSection').hidden = !profile;
  document.getElementById('savedSection').hidden = profile;
  document.querySelectorAll('[data-account-section]').forEach(link => {
    if (link.dataset.accountSection === (profile ? 'settings' : 'saved')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function runAssessmentAction(action) {
  if (busy) return;
  busy = true;
  const previousFocus = document.activeElement;
  const previousStatus = savedStatus.textContent;
  const previousError = savedStatus.dataset.error === 'true';
  const actionControls = '[data-account-save] button, #savedAssessments button, #retrySavedAssessments, #assessmentSearch, #assessmentSort, #downloadAccountData';
  const buttons = document.querySelectorAll(actionControls);
  buttons.forEach(button => { button.disabled = true; });
  assessmentStatus('Working…');
  try { await action(); }
  catch (error) { assessmentStatus(error.message, true); }
  finally {
    busy = false;
    document.querySelectorAll(actionControls).forEach(button => { button.disabled = false; });
    if (savedStatus.textContent === 'Working…') assessmentStatus(previousStatus, previousError);
    if (document.activeElement === document.body) previousFocus?.focus();
  }
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
    document.getElementById('assessmentSaveTitle').addEventListener('input', updateAccountSaveStatus);
    window.addEventListener?.('bc-csr-state-saved', updateAccountSaveStatus);
    window.addEventListener?.('storage', updateAccountSaveStatus);
    updateAccountSaveStatus();
  }
  if (savedList) {
    selectAccountSection();
    window.addEventListener?.('hashchange', selectAccountSection);
    assessmentSearch?.addEventListener('input', renderSavedAssessments);
    assessmentSort?.addEventListener('change', renderSavedAssessments);
    document.getElementById('retrySavedAssessments').addEventListener('click', () => runAssessmentAction(listAccountAssessments));
    document.getElementById('downloadAccountData')?.addEventListener('click', () => runAssessmentAction(async () => {
      const data = await collectAccountExport();
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `bccsrtool-account-data-${new Date().toISOString().slice(0, 10)}.json`);
      assessmentStatus('Account data downloaded. Keep this file private; it contains your saved site and assessment data.');
    }));
    await listAccountAssessments();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (accountUser && session?.user?.id !== accountUser.id) {
    saveForm?.setAttribute('hidden', '');
    savedRecords = [];
    savedList?.replaceChildren();
    assessmentStatus('Your sign-in has changed. Reload this page to access the current account.');
  }
});
initializeAccountAssessments().catch(error => assessmentStatus(error.message, true));
