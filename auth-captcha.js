(() => {
  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content.trim();
  const states = new Map();

  function update(state, token = '', message = '') {
    state.token = token;
    state.message.textContent = message;
    state.button.disabled = !token || state.form.dataset.submitting === 'true' || Date.now() < Number(state.form.dataset.cooldownUntil || 0);
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('The security check could not load. Check your connection and reload this page.'));
      };
      const timer = setTimeout(fail, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = fail;
      document.head.append(script);
    });
  }

  window.authCaptcha = {
    async initialize() {
      // Keep the existing flow until the production widget is configured and deployed.
      if (!siteKey) return;
      for (const container of document.querySelectorAll('[data-auth-captcha]')) {
        const form = container.closest('form');
        const state = { form, container, button: form.querySelector('button[type="submit"]'),
          message: container.querySelector('[data-captcha-status]'), token: '', widget: null };
        states.set(form, state);
        container.hidden = false;
        update(state, '', 'Complete the security check before continuing.');
      }
      await loadTurnstile();
      for (const state of states.values()) {
        state.widget = window.turnstile.render(state.container.querySelector('[data-captcha-widget]'), {
          sitekey: siteKey, size: state.container.clientWidth < 300 ? 'compact' : 'flexible',
          theme: document.documentElement?.classList.contains('dark') ? 'dark' : 'light', action: state.form.id,
          'response-field': false,
          callback: token => update(state, token),
          'expired-callback': () => update(state, '', 'The security check expired. Please complete it again.'),
          'error-callback': () => { update(state, '', 'The security check failed. Please retry, or reload this page.'); return true; }
        });
      }
    },
    isReady(form) {
      if (!siteKey || !form.querySelector('[data-auth-captcha]')) return true;
      const state = states.get(form);
      return Boolean(state?.token && window.turnstile?.getResponse(state.widget));
    },
    getToken(form) {
      if (!siteKey || !form.querySelector('[data-auth-captcha]')) return undefined;
      if (!this.isReady(form)) throw new Error('Complete the security check before continuing.');
      return states.get(form).token;
    },
    reset(form) {
      const state = states.get(form);
      if (!state || state.widget === null) return;
      update(state, '', 'Complete the security check before continuing.');
      window.turnstile.reset(state.widget);
    }
  };
})();
