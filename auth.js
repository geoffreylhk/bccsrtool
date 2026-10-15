const status = document.getElementById('authStatus');
let supabase;
let user;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
  const retry = document.getElementById('authRetry');
  if (retry) retry.hidden = !error;
}

function checkResult(result) {
  if (result.error) throw result.error;
  return result.data;
}

function bindForm(id, action) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled || !form.reportValidity()) return;
    button.disabled = true;
    showStatus('Working…');
    try {
      await action(new FormData(form));
    } catch (error) {
      showStatus(error.message || 'The request failed. Please try again.', true);
    } finally {
      button.disabled = false;
    }
  });
}

const redirectUrl = (page) => new URL(page, window.location.href).href;

const googleButton = document.getElementById('googleSigninButton');
googleButton?.addEventListener('click', async () => {
  if (googleButton.disabled) return;
  googleButton.disabled = true;
  showStatus('Redirecting to Google…');
  try {
    checkResult(await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl('account.html'), queryParams: { prompt: 'select_account' } }
    }));
  } catch (error) {
    showStatus(error.message || 'Google sign-in could not start. Please try again.', true);
    googleButton.disabled = false;
  }
});

function getCallbackError(url) {
  const error = new URLSearchParams(url.hash.slice(1)).get('error') || url.searchParams.get('error');
  if (!error) return '';
  return error === 'access_denied'
    ? 'Sign-in was cancelled or access was denied. Return to the sign-in page to try again.'
    : 'Sign-in or email verification could not be completed. Return to the sign-in page to try again or request a new email link.';
}

bindForm('signinForm', async (fields) => {
  checkResult(await supabase.auth.signInWithPassword({
    email: fields.get('email').trim(), password: fields.get('password')
  }));
  switchAssessmentAccount(checkResult(await supabase.auth.getUser()).user.id);
  window.location.replace('account.html');
});

bindForm('signupForm', async (fields) => {
  checkResult(await supabase.auth.signUp({
    email: fields.get('email').trim(),
    password: fields.get('password'),
    options: {
      emailRedirectTo: redirectUrl('account.html'),
      data: { display_name: fields.get('display_name').trim() }
    }
  }));
  document.getElementById('signupForm').reset();
  showStatus('Check your email for a verification link. If you already have an account, sign in or request a password reset.');
});

bindForm('forgotForm', async (fields) => {
  checkResult(await supabase.auth.resetPasswordForEmail(fields.get('email').trim(), {
    redirectTo: redirectUrl('reset-password.html')
  }));
  showStatus('If an account exists for that email, a password-reset link will be sent.');
});

bindForm('profileForm', async (fields) => {
  const profile = checkResult(await supabase.from('profiles')
    .update({ display_name: fields.get('display_name').trim() })
    .eq('id', user.id).select('id').single());
  if (profile.id !== user.id) throw new Error('Your profile could not be saved.');
  showStatus('Profile saved.');
});

bindForm('resetForm', async (fields) => {
  if (fields.get('password') !== fields.get('confirm_password')) {
    throw new Error('The passwords do not match.');
  }
  checkResult(await supabase.auth.updateUser({ password: fields.get('password') }));
  document.getElementById('resetForm').reset();
  document.getElementById('resetForm').hidden = true;
  showStatus('Password updated. You can return to sign in or open your account.');
});

async function loadProfile() {
  let profile = checkResult(await supabase.from('profiles')
    .select('id, display_name').eq('id', user.id).maybeSingle());
  if (!profile) {
    const metadataName = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
    const name = typeof metadataName === 'string' ? metadataName.trim().slice(0, 100) : '';
    const result = await supabase.from('profiles').insert({ id: user.id, display_name: name });
    // Two open account tabs may try to create the same profile.
    if (result.error?.code !== '23505') checkResult(result);
    profile = checkResult(await supabase.from('profiles')
      .select('id, display_name').eq('id', user.id).single());
  }
  document.getElementById('profileName').value = profile.display_name;
}

async function signOutAccount() {
  if (hasSavedProgress() && !window.confirm('Sign out and clear the working assessment in this browser? Save it to your account from Results first if you want to keep it. Account saves will remain available.')) return false;
  checkResult(await supabase.auth.signOut());
  clearAssessment();
  switchAssessmentAccount(null);
  window.location.replace('signin.html');
  return true;
}

async function initialize() {
  const callbackError = getCallbackError(new URL(window.location.href));
  ({ supabase } = await import('./supabase-client.js'));
  const session = checkResult(await supabase.auth.getSession()).session;
  // Clear authentication tokens from the address bar after the SDK consumes them.
  if (window.location.hash || callbackError) history.replaceState(null, '', window.location.pathname);
  if (callbackError) throw new Error(callbackError);
  switchAssessmentAccount(session?.user?.id);

  if (document.getElementById('accountPanel')) {
    if (!session) {
      window.location.replace('signin.html');
      return;
    }
    user = checkResult(await supabase.auth.getUser()).user;
    document.getElementById('accountEmail').textContent = user.email;
    document.getElementById('accountPanel').hidden = false;
    const signout = document.getElementById('signoutButton');
    signout.disabled = false;
    signout.addEventListener('click', async () => {
      signout.disabled = true;
      try {
        await signOutAccount();
        signout.disabled = false;
      } catch (error) {
        showStatus(error.message || 'Could not sign out. Please try again.', true);
        signout.disabled = false;
      }
    });
    await loadProfile();
  }

  if (document.getElementById('resetForm')) {
    if (!session) throw new Error('Open the password-reset link from your email. You can request a new link on the sign-in page.');
    checkResult(await supabase.auth.getUser());
    document.getElementById('resetForm').hidden = false;
  }

  document.querySelectorAll('button[type="submit"]').forEach((button) => {
    button.disabled = false;
  });
  if (googleButton) googleButton.disabled = false;
  showStatus('');
}

initialize().catch((error) => {
  showStatus(error.message || 'Unable to load the account service. Check your connection and reload.', true);
});
