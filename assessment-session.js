import { supabase } from './supabase-client.js';

supabase.auth.onAuthStateChange((_event, session) => {
  const reset = switchAssessmentAccount(session?.user?.id);
  // Drop stale rendered inputs too, so an old tab cannot write them back.
  if (reset && (!document.getElementById('authStatus') || document.getElementById('accountPanel'))) window.location.reload();
});

window.addEventListener('storage', event => {
  if (event.key === WORKING_ASSESSMENT_ACCOUNT_KEY ||
      (event.key === APP_STORAGE_KEY && event.newValue === null) || event.key === null) {
    window.location.reload();
  }
});
