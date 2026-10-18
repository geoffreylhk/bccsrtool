import { supabase } from './supabase-client.js';

async function syncAccountChemicalSort(userId) {
  const { data, error } = await supabase.from('profiles').select('chemical_sort').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (data) applyAccountChemicalSort(userId, data.chemical_sort);
}

supabase.auth.onAuthStateChange((_event, session) => {
  const reset = switchAssessmentAccount(session?.user?.id);
  if (session?.user && ['INITIAL_SESSION', 'SIGNED_IN'].includes(_event)) {
    setTimeout(() => syncAccountChemicalSort(session.user.id).catch(() => {
      console.warn('Default chemical sorting could not sync. Existing browser settings were retained.');
    }), 0);
  }
  // Drop stale rendered inputs too, so an old tab cannot write them back.
  if (reset && (!document.getElementById('authStatus') || document.getElementById('accountPanel'))) window.location.reload();
});

window.addEventListener('storage', event => {
  if (event.key === WORKING_ASSESSMENT_ACCOUNT_KEY ||
      (event.key === APP_STORAGE_KEY && event.newValue === null) || event.key === null) {
    window.location.reload();
  }
});
