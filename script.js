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
  beginBtn.addEventListener('click', () => {
    if (beginBtn.disabled) return;

    if (hasSavedProgress() && !window.confirm('Start a fresh assessment? This will clear the saved local assessment in this browser.')) {
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

const currentLandUse = document.getElementById('currentLandUse');
const proposedLandUse = document.getElementById('proposedLandUse');
const siteNextBtn = document.getElementById('nextBtn');

if (currentLandUse && proposedLandUse && siteNextBtn) {
  const activeProfile = getActiveProfile();

  currentLandUse.value = activeProfile.currentLandUse || '';
  proposedLandUse.value = activeProfile.proposedLandUse || activeProfile.thresholdLandUse || '';

  const validateSiteForm = () => {
    siteNextBtn.disabled = !(currentLandUse.value && proposedLandUse.value);
  };

  const saveSiteInfo = () => {
    updateActiveProfileData({
      currentLandUse: currentLandUse.value,
      currentLandUseLabel: LAND_USE_LABELS[currentLandUse.value] || '',
      proposedLandUse: proposedLandUse.value,
      proposedLandUseLabel: LAND_USE_LABELS[proposedLandUse.value] || ''
    });
    validateSiteForm();
  };

  currentLandUse.addEventListener('change', saveSiteInfo);
  proposedLandUse.addEventListener('change', saveSiteInfo);

  siteNextBtn.addEventListener('click', () => {
    if (siteNextBtn.disabled) return;
    saveSiteInfo();
    window.location.href = 'contaminants.html';
  });

  validateSiteForm();
}
