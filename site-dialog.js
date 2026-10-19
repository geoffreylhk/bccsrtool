let activeSiteDialog = null;

function showSiteDialog(message, { title = 'Please confirm', confirmLabel = 'Yes', cancelLabel = 'No', discardLabel, danger = false, notice = false, neutral = false, requiredText } = {}) {
  // Ignore duplicate actions while the current decision is still open.
  if (activeSiteDialog) return Promise.resolve(false);
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'site-dialog';
  dialog.setAttribute('aria-labelledby', 'siteDialogHeading');
  dialog.setAttribute('aria-describedby', 'siteDialogMessage');
  const heading = document.createElement('h2');
  heading.id = 'siteDialogHeading';
  heading.textContent = title;
  const description = document.createElement('p');
  description.id = 'siteDialogMessage';
  if (Array.isArray(message)) {
    for (const part of message) {
      const text = document.createElement(typeof part === 'string' ? 'span' : 'strong');
      text.textContent = typeof part === 'string' ? part : part.text;
      if (part.red) text.className = 'dialog-warning-text';
      description.append(text);
    }
  } else description.textContent = message;
  const actions = document.createElement('form');
  actions.method = 'dialog';
  actions.className = 'site-dialog-actions';
  const accept = document.createElement('button');
  accept.type = 'submit';
  accept.value = 'accept';
  accept.className = danger ? 'secondary-action dialog-danger-action' : neutral ? 'secondary-action' : 'primary-action';
  accept.textContent = notice ? 'OK' : confirmLabel;
  actions.append(accept);
  if (!notice) {
    if (discardLabel) {
      const discard = document.createElement('button');
      discard.type = 'submit';
      discard.value = 'discard';
      discard.className = 'secondary-action dialog-danger-action';
      discard.textContent = discardLabel;
      actions.append(discard);
    }
    const cancel = document.createElement('button');
    cancel.type = 'submit';
    cancel.value = 'cancel';
    cancel.className = 'secondary-action';
    cancel.textContent = cancelLabel;
    cancel.autofocus = true;
    actions.append(cancel);
  } else accept.autofocus = true;
  if (requiredText !== undefined) {
    const label = document.createElement('label');
    label.className = 'dialog-confirm-label';
    label.textContent = 'Email address';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'email';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.maxLength = 320;
    input.autofocus = true;
    for (const button of actions.children) button.autofocus = false;
    accept.disabled = true;
    input.addEventListener('input', () => { accept.disabled = input.value !== requiredText; });
    actions.addEventListener('submit', event => {
      if (event.submitter === accept && input.value !== requiredText) event.preventDefault();
    });
    label.append(input);
    actions.prepend(label);
    dialog.append(heading, description, actions);
  } else dialog.append(heading, description, actions);
  document.body.append(dialog);
  activeSiteDialog = dialog;
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const accepted = discardLabel && dialog.returnValue === 'discard' ? 'discard' : dialog.returnValue === 'accept';
      dialog.remove();
      activeSiteDialog = null;
      previousFocus?.focus();
      resolve(accepted);
    }, { once: true });
    dialog.showModal();
  });
}
