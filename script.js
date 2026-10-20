const checkbox = document.getElementById('agree');
const beginBtn = document.getElementById('beginBtn');
const resumeBtn = document.getElementById('resumeBtn');

function setLandingButtonState() {
  const accepted = !checkbox || checkbox.checked;
  const saved = typeof hasSavedProgress === 'function' && hasSavedProgress();

  if (beginBtn) beginBtn.disabled = !accepted;

  if (resumeBtn) {
    resumeBtn.hidden = !saved;
    resumeBtn.disabled = !accepted || !saved;
  }
}

if (checkbox) {
  checkbox.addEventListener('change', setLandingButtonState);
}

if (beginBtn) {
  beginBtn.addEventListener('click', async () => {
    if (beginBtn.disabled) return;

    if (hasSavedProgress() && !await showSiteDialog(['This will ', { text: 'clear', red: true }, ' the working assessment in this browser. Your account saves will remain available.'], { title: 'Start a fresh assessment?', confirmLabel: 'Start new assessment', cancelLabel: 'Cancel', neutral: true })) {
      return;
    }

    clearAssessment();
    markAssessmentStarted();
    window.location.href = 'assessment.html';
  });
}

if (resumeBtn) {
  resumeBtn.addEventListener('click', () => {
    if (resumeBtn.disabled) return;
    window.location.href = 'assessment.html';
  });
}

setLandingButtonState();

const fieldInfoButtons = [...document.querySelectorAll('.field-info[data-tooltip]')];
const fieldInfoHoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

function closeFieldInfoTooltips(exceptButton = null) {
  fieldInfoButtons.forEach((button) => {
    if (button === exceptButton) return;
    button.classList.remove('is-tooltip-open', 'is-tooltip-below');
    button.setAttribute('aria-expanded', 'false');
  });
}

function positionFieldInfoTooltip(button) {
  const rect = button.getBoundingClientRect();
  const mobile = window.matchMedia('(max-width: 560px)').matches;
  const tooltipWidth = Math.min(mobile ? 220 : 280, window.innerWidth - 24);
  const halfWidth = tooltipWidth / 2;
  const centeredLeft = rect.left + (rect.width / 2);
  const left = Math.max(12 + halfWidth, Math.min(window.innerWidth - 12 - halfWidth, centeredLeft));
  const showBelow = rect.top < (mobile ? 175 : 150);

  button.style.setProperty('--tooltip-left', `${left}px`);
  button.style.setProperty('--tooltip-top', `${showBelow ? rect.bottom : rect.top}px`);
  button.style.setProperty('--tooltip-width', `${tooltipWidth}px`);
  button.classList.toggle('is-tooltip-below', showBelow);
}

function openFieldInfoTooltip(button) {
  closeFieldInfoTooltips(button);
  positionFieldInfoTooltip(button);
  button.classList.add('is-tooltip-open');
  button.setAttribute('aria-expanded', 'true');
}

fieldInfoButtons.forEach((button) => {
  button.setAttribute('aria-expanded', 'false');

  button.addEventListener('click', (event) => {
    if (fieldInfoHoverQuery.matches) return;
    event.stopPropagation();
    if (button.classList.contains('is-tooltip-open')) {
      closeFieldInfoTooltips();
      button.blur();
      return;
    }
    openFieldInfoTooltip(button);
  });

  button.addEventListener('mouseenter', () => {
    if (fieldInfoHoverQuery.matches) openFieldInfoTooltip(button);
  });

  button.addEventListener('mouseleave', () => {
    if (fieldInfoHoverQuery.matches) closeFieldInfoTooltips();
  });

  button.addEventListener('focus', () => {
    if (fieldInfoHoverQuery.matches) {
      openFieldInfoTooltip(button);
      return;
    }
    positionFieldInfoTooltip(button);
  });

  button.addEventListener('blur', () => {
    closeFieldInfoTooltips();
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.field-info')) closeFieldInfoTooltips();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFieldInfoTooltips();
});

window.addEventListener('resize', () => {
  const openButton = document.querySelector('.field-info.is-tooltip-open');
  if (openButton) positionFieldInfoTooltip(openButton);
});

window.addEventListener('scroll', () => closeFieldInfoTooltips(), { passive: true });

const currentLandUse = document.getElementById('currentLandUse');
const proposedLandUse = document.getElementById('proposedLandUse');
const siteNextBtn = document.getElementById('nextBtn');

if (currentLandUse && proposedLandUse && siteNextBtn) {
  const activeProfile = getActiveProfile();

  currentLandUse.value = activeProfile.currentLandUse || '';
  proposedLandUse.value = activeProfile.proposedLandUse || activeProfile.thresholdLandUse || '';

  const factorSettings = document.getElementById('factorSettings');
  if (factorSettings) {
    const choices = [['applicable', '✓ Applicable'], ['not_assessed', '✕ Not assessed']];
    const factorRows = Object.entries(SOIL_FACTORS);
    [factorRows[1], factorRows[2]] = [factorRows[2], factorRows[1]];
    const factorMarkup = factorRows.map(([key, label]) => {
      const mandatory = ['intake', 'plants'].includes(key);
      const selected = mandatory ? (activeProfile.factors?.[key] === 'not_assessed' ? 'not_assessed' : 'applicable') : activeProfile.factors?.[key] || 'not_applicable';
      return `<fieldset class="factor-choice"><legend>${escapeHtml(label)}</legend><div class="factor-choice__buttons">${choices.map(([value, text]) => `<label class="factor-option factor-option--${value}"><input type="radio" name="factor-${key}" data-factor="${key}" value="${value}" ${selected === value ? 'checked' : ''}><span>${text}</span></label>`).join('')}</div></fieldset>`;
    });
    factorSettings.innerHTML = `<h2>Applicable soil factors</h2><div class="factor-columns"><div>${factorMarkup.slice(0, 4).join('')}</div><div>${factorMarkup.slice(4).join('')}</div></div>`;
    factorSettings.querySelectorAll('[data-factor]').forEach((input) => {
      input.addEventListener('change', () => {
        const factors = Object.fromEntries([...factorSettings.querySelectorAll('[data-factor]:checked')].map((choice) => [choice.dataset.factor, choice.value]));
        updateActiveProfileData({ factors });
      });
    });
  }

  const siteName = document.getElementById('siteName');
  const assessmentMode = document.getElementById('assessmentMode');
  if (siteName) siteName.value = activeProfile.siteName || '';
  if (assessmentMode) assessmentMode.value = activeProfile.assessmentMode === 'proposed' ? 'proposed' : 'current';
  const readSite = () => ({
    currentLandUse: currentLandUse.value, proposedLandUse: proposedLandUse.value,
    assessmentMode: assessmentMode?.value || 'current', siteName: siteName?.value.trim() || '',
    multipleLandUses: false
  });
  let siteValidationAttempted = false;
  const validateSiteForm = () => {
    const proposed = assessmentMode?.value === 'proposed';
    currentLandUse.required = !proposed;
    proposedLandUse.required = proposed;
    const error = getSiteValidationError(readSite());
    siteNextBtn.disabled = false;
    const invalidField = error ? (error === 'Select a valid assessment mode.' ? assessmentMode : proposed ? proposedLandUse : currentLandUse) : null;
    for (const field of [currentLandUse, proposedLandUse, assessmentMode].filter(Boolean)) {
      if (siteValidationAttempted && field === invalidField) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    const status = document.getElementById('siteStatus');
    if (status) {
      status.textContent = siteValidationAttempted ? error : '';
      if (invalidField) invalidField.parentElement.append(status);
    }
    return error;
  };
  const saveSiteInfo = () => { updateActiveProfileData(readSite()); validateSiteForm(); };
  [currentLandUse, proposedLandUse, assessmentMode].filter(Boolean).forEach(input => input.addEventListener('change', saveSiteInfo));
  siteName?.addEventListener('input', saveSiteInfo);
  siteNextBtn.addEventListener('click', () => {
    siteValidationAttempted = true;
    const error = validateSiteForm();
    if (error) {
      const invalidField = [currentLandUse, proposedLandUse, assessmentMode].filter(Boolean).find(field => field.getAttribute('aria-invalid') === 'true');
      invalidField?.focus();
      return;
    }
    saveSiteInfo();
    window.location.href = 'contaminants.html';
  });
  validateSiteForm();
  if (activeProfile.assessmentMode === 'both' || activeProfile.multipleLandUses) updateActiveProfileData(readSite());
}
