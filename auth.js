const status = document.getElementById('authStatus');
let supabase;
let user;
let accountSettingsReady = false;
let verificationEmail = '';
let verificationTimer;

function updateResendButton() {
  const form = document.getElementById('resendVerificationForm');
  const button = form.querySelector('button[type="submit"]');
  const seconds = Math.max(0, Math.ceil((Number(form.dataset.cooldownUntil || 0) - Date.now()) / 1000));
  button.textContent = seconds ? `Resend email in ${seconds}s` : 'Resend verification email';
  button.disabled = seconds > 0 || form.dataset.submitting === 'true' || Boolean(window.authCaptcha && !window.authCaptcha.isReady(form));
  if (!seconds) clearInterval(verificationTimer);
}

function startResendCooldown() {
  document.getElementById('resendVerificationForm').dataset.cooldownUntil = String(Date.now() + 60000);
  clearInterval(verificationTimer);
  updateResendButton();
  verificationTimer = setInterval(updateResendButton, 1000);
}

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
  const validation = form.classList?.contains('auth-entry-form') ? window.authValidation : null;
  validation?.bind(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled || Date.now() < Number(form.dataset.cooldownUntil || 0)) return;
    if (validation ? !validation.validate(form) : !form.reportValidity()) {
      showStatus('');
      return;
    }
    button.disabled = true;
    form.dataset.submitting = 'true';
    showStatus('Working…');
    try {
      const captchaToken = window.authCaptcha?.getToken(form);
      await action(new FormData(form), captchaToken);
    } catch (error) {
      if (validation?.showServerError(form, error)) showStatus('');
      else showStatus(error.message || 'The request failed. Please try again.', true);
    } finally {
      form.dataset.submitting = 'false';
      window.authCaptcha?.reset(form);
      button.disabled = Date.now() < Number(form.dataset.cooldownUntil || 0) || Boolean(window.authCaptcha && !window.authCaptcha.isReady(form));
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

bindForm('signinForm', async (fields, captchaToken) => {
  checkResult(await supabase.auth.signInWithPassword({
    email: fields.get('email').trim(), password: fields.get('password'), options: { captchaToken }
  }));
  switchAssessmentAccount(checkResult(await supabase.auth.getUser()).user.id);
  window.location.replace('account.html');
});

bindForm('signupForm', async (fields, captchaToken) => {
  if (!fields.get('confirm_password')) throw new Error('Please retype your password.');
  if (fields.get('password') !== fields.get('confirm_password')) throw new Error('The passwords do not match.');
  checkResult(await supabase.auth.signUp({
    email: fields.get('email').trim(),
    password: fields.get('password'),
    options: {
      captchaToken,
      emailRedirectTo: redirectUrl('account.html'),
      data: { display_name: fields.get('display_name').trim() }
    }
  }));
  document.getElementById('signupForm').reset();
  verificationEmail = fields.get('email').trim();
  document.getElementById('signupForm').hidden = true;
  document.getElementById('authHeading').hidden = true;
  document.getElementById('signupSigninLink').hidden = true;
  document.getElementById('verificationEmail').textContent = verificationEmail;
  document.getElementById('signupConfirmation').hidden = false;
  showStatus('');
  startResendCooldown();
  document.getElementById('verificationHeading').focus();
});

bindForm('resendVerificationForm', async (fields, captchaToken) => {
  if (!verificationEmail || document.getElementById('signupConfirmation').hidden) return;
  // Limit retries after both success and failure; Supabase also enforces its own limits.
  startResendCooldown();
  checkResult(await supabase.auth.resend({
    type: 'signup', email: verificationEmail,
    options: { captchaToken, emailRedirectTo: redirectUrl('account.html') }
  }));
  showStatus('If your email is awaiting verification, a new link has been sent. Check your inbox and spam folder.');
});

document.getElementById('correctSignupEmail')?.addEventListener('click', () => {
  if (document.getElementById('resendVerificationForm').dataset.submitting === 'true') return;
  clearInterval(verificationTimer);
  document.getElementById('signupConfirmation').hidden = true;
  document.getElementById('authHeading').hidden = false;
  document.getElementById('signupSigninLink').hidden = false;
  document.getElementById('signupForm').hidden = false;
  document.getElementById('signupEmail').value = verificationEmail;
  document.getElementById('signupPasswordRules').hidden = true;
  showStatus('Correct your email address and re-enter your password to create an account with that address.');
  document.getElementById('signupEmail').focus();
});

bindForm('forgotForm', async (fields, captchaToken) => {
  checkResult(await supabase.auth.resetPasswordForEmail(fields.get('email').trim(), {
    captchaToken,
    redirectTo: redirectUrl('reset-password.html')
  }));
  showStatus('If an account exists for that email, a password-reset link will be sent.');
});

bindForm('profileForm', async (fields) => {
  const sort = fields.get('chemical_sort');
  if (accountSettingsReady && !['category', 'default', 'alpha'].includes(sort)) throw new Error('Choose a valid chemical sorting option.');
  const owner = await requireAccountOwner();
  const profile = checkResult(await supabase.from('profiles')
    .update({ display_name: fields.get('display_name').trim(), ...(accountSettingsReady ? { chemical_sort: sort } : {}) })
    .eq('id', owner.id).select('id').single());
  if (profile.id !== owner.id) throw new Error('Your profile could not be saved.');
  if (accountSettingsReady) applyAccountChemicalSort(owner.id, sort);
  showStatus('Settings saved.');
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
    .select('*').eq('id', user.id).maybeSingle());
  if (!profile) {
    const metadataName = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
    const name = typeof metadataName === 'string' ? metadataName.trim().slice(0, 100) : '';
    const result = await supabase.from('profiles').insert({ id: user.id, display_name: name });
    // Two open account tabs may try to create the same profile.
    if (result.error?.code !== '23505') checkResult(result);
    profile = checkResult(await supabase.from('profiles')
      .select('*').eq('id', user.id).single());
  }
  document.getElementById('profileName').value = profile.display_name;
  accountSettingsReady = ['category', 'default', 'alpha'].includes(profile.chemical_sort);
  document.getElementById('defaultChemicalSort').disabled = !accountSettingsReady;
  document.getElementById('accountSettingsPending').hidden = accountSettingsReady;
  document.getElementById('defaultChemicalSort').value = profile.chemical_sort || 'category';
  applyAccountChemicalSort(user.id, profile.chemical_sort || 'category');
}

async function requireAccountOwner() {
  const current = checkResult(await supabase.auth.getUser()).user;
  if (!current || current.id !== user?.id) throw new Error('Your sign-in has changed. Reload the page before changing your account.');
  return current;
}

async function deleteAccount() {
  if (!await showSiteDialog('This permanently deletes your account, profile, and all saved assessments.', { title: 'Are you sure?', danger: true })) return false;
  const owner = await requireAccountOwner();
  const expected = owner.email;
  if (!expected) throw new Error('This account does not have a sign-in email address. Contact support to request deletion.');
  if (!await showSiteDialog(`Type your sign-in email address exactly: “${expected}”. This deletion cannot be undone.`, {
    title: 'Confirm account deletion', confirmLabel: 'Delete account', cancelLabel: 'Cancel', danger: true, requiredText: expected
  })) return false;
  await requireAccountOwner();
  const result = await supabase.rpc('delete_own_account', { confirmation_name: expected });
  if (result.error) {
    if (result.error.code === '22023') throw new Error('Your sign-in email address has changed. Reload Settings and try again.');
    throw new Error('Account deletion could not be completed. Sign in again and retry.');
  }
  clearAssessment();
  switchAssessmentAccount(null);
  // The server has deleted the user and revoked refresh sessions; remove this browser session too.
  await supabase.auth.signOut({ scope: 'local' });
  window.location.replace('signin.html');
  return true;
}

function confirmSignOut() {
  return showSiteDialog('Signing out clears your unsaved changes!', {
    title: 'Have you saved your changes yet?'
  });
}

async function signOutAccount() {
  if (!await confirmSignOut()) return false;
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
  const accountSection = document.getElementById('accountPanel') && ['#saved', '#settings', '#profile'].includes(window.location.hash);
  if ((window.location.hash && !accountSection) || callbackError) history.replaceState(null, '', window.location.pathname);
  if (callbackError) throw new Error(callbackError);
  switchAssessmentAccount(session?.user?.id);

  if (document.getElementById('signinForm') && session) {
    const currentUser = checkResult(await supabase.auth.getUser()).user;
    if (!currentUser) throw new Error('Your session has expired. Sign in again.');
    window.location.replace('account.html');
    return;
  }

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
      } catch (error) {
        showStatus(error.message || 'Could not sign out. Please try again.', true);
      } finally {
        signout.disabled = false;
        signout.focus();
      }
    });
    await loadProfile();
    const deleteButton = document.getElementById('deleteAccountButton');
    deleteButton.disabled = !accountSettingsReady;
    deleteButton.addEventListener('click', async () => {
      if (deleteButton.disabled) return;
      deleteButton.disabled = true;
      try { await deleteAccount(); }
      catch (error) { showStatus(error.message || 'Account deletion could not be completed. Try again.', true); }
      finally { deleteButton.disabled = !accountSettingsReady; deleteButton.focus(); }
    });
  }

  if (document.getElementById('resetForm')) {
    if (!session) throw new Error('Open the password-reset link from your email. You can request a new link on the sign-in page.');
    checkResult(await supabase.auth.getUser());
    document.getElementById('resetForm').hidden = false;
  }

  if (googleButton) googleButton.disabled = false;
  if (document.querySelector?.('meta[name="turnstile-site-key"]')?.content?.trim() && !window.authCaptcha) {
    throw new Error('The security check could not load. Check your connection and reload this page.');
  }
  await window.authCaptcha?.initialize();
  document.querySelectorAll('button[type="submit"]').forEach((button) => {
    button.disabled = window.authCaptcha ? !window.authCaptcha.isReady(button.closest('form')) : false;
  });
  showStatus('');
}

initialize().catch((error) => {
  showStatus(error.message || 'Unable to load the account service. Check your connection and reload.', true);
});
