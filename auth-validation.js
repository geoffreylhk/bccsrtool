(() => {
  const states = new WeakMap();
  const checklists = new WeakMap();
  function passwordChecks(value) {
    return [
      ['8 characters', [...value].length >= 8],
      ['1 number', /[0-9]/.test(value)],
      ['1 special character, e.g., $, !, @, %, &', /[^\p{L}\p{N}\s]/u.test(value)],
      ['No leading or trailing whitespace', value === value.trim()]
    ];
  }
  function updateChecklist(field, reveal = false) {
    const panel = checklists.get(field);
    if (!panel) return;
    const checks = passwordChecks(field.value);
    if (reveal && checks.some(([, met]) => !met)) panel.hidden = false;
    if (panel.hidden) return;
    const rows = panel.querySelectorAll('li');
    checks.forEach(([label, met], index) => {
      rows[index].dataset.met = String(met);
      rows[index].setAttribute('aria-label', `${met ? 'Met' : 'Still needed'}: ${label}`);
    });
  }
  function setError(field, message) {
    const note = states.get(field);
    note.textContent = message;
    note.hidden = !message;
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }
  function getError(field, form) {
    if (field.required && !field.value) {
      if (field.name === 'email') return 'Enter your email address.';
      if (field.name === 'confirm_password') return 'Please retype your password.';
      return 'Enter your password.';
    }
    if (field.dataset.passwordPolicy === 'signup' && passwordChecks(field.value).some(([, met]) => !met)) return 'Your password must meet all the requirements below.';
    if (field.validity.typeMismatch) return 'Enter a valid email address, such as name@example.com.';
    if (field.minLength > 0 && field.value.length < field.minLength) return `Use at least ${field.minLength} characters for your password.`;
    if (field.maxLength > 0 && field.value.length > field.maxLength) return `Use no more than ${field.maxLength} characters.`;
    if (field.name === 'confirm_password' && field.value !== form.elements.namedItem('password').value) return 'The passwords do not match.';
    return '';
  }
  window.authValidation = {
    bind(form) {
      const fields = [...form.querySelectorAll('input:not([type="hidden"])')];
      if (!fields.length) return;
      // Native browser bubbles are replaced by accessible messages next to each input.
      form.noValidate = true;
      for (const field of fields) {
        const note = document.createElement('p');
        note.id = `${field.id}-error`;
        note.className = 'auth-field-error';
        note.hidden = true;
        note.setAttribute?.('aria-live', 'polite');
        field.closest('.form-group').append(note);
        field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' '));
        states.set(field, note);
        if (field.dataset.passwordPolicy === 'signup') {
          const panel = form.querySelector('[data-password-rules]');
          checklists.set(field, panel);
          field.setAttribute('aria-describedby', `${field.getAttribute('aria-describedby')} ${panel.id}`);
          field.addEventListener('blur', () => {
            updateChecklist(field, true);
            setError(field, getError(field, form));
          });
        }
        field.addEventListener('input', () => {
          updateChecklist(field);
          for (const input of fields) {
            if (input.getAttribute('aria-invalid') === 'true' || (input.name === 'confirm_password' && input.value)) {
              setError(input, getError(input, form));
            }
          }
        });
      }
    },
    validate(form) {
      let firstInvalid;
      for (const field of form.querySelectorAll('input:not([type="hidden"])')) {
        updateChecklist(field, true);
        const message = getError(field, form);
        setError(field, message);
        if (message && !firstInvalid) firstInvalid = field;
      }
      firstInvalid?.focus();
      return !firstInvalid;
    },
    showServerError(form, error) {
      let names, message;
      if (error.code === 'invalid_credentials') {
        names = ['email', 'password'];
        message = 'The email or password is incorrect. Check both and try again.';
      } else if (error.code === 'weak_password') {
        names = ['password'];
        message = 'The account service rejected this password. Try a longer or less common password.';
      } else if (error.code === 'email_address_invalid') {
        names = ['email'];
        message = 'Enter a valid email address.';
      } else return false;
      const fields = names.map(name => form.elements.namedItem(name)).filter(Boolean);
      for (const field of fields) setError(field, message);
      fields[0]?.focus();
      return fields.length > 0;
    }
  };
})();
