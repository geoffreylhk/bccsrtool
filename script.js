const LAND_USE_LABELS = {
  WLN: 'Wildlands Natural',
  WLR: 'Wildlands Reverted',
  AL: 'Agricultural',
  PL: 'Urban Park',
  RLLD: 'Residential Low Density',
  RLHD: 'Residential High Density',
  CL: 'Commercial',
  IL: 'Industrial'
};

const checkbox = document.getElementById('agree');
const beginBtn = document.getElementById('beginBtn');

if (checkbox && beginBtn) {
  checkbox.addEventListener('change', () => {
    beginBtn.disabled = !checkbox.checked;
  });

  beginBtn.addEventListener('click', () => {
    window.location.href = 'assessment.html';
  });
}

const currentLandUse = document.getElementById('currentLandUse');
const proposedLandUse = document.getElementById('proposedLandUse');
const siteNextBtn = document.getElementById('nextBtn');
const waterBodyOptions = document.querySelectorAll('input[name="waterBody"]');

if (currentLandUse && proposedLandUse && siteNextBtn && waterBodyOptions.length) {
  const getWaterBodyValue = () => {
    const selected = document.querySelector('input[name="waterBody"]:checked');
    return selected ? selected.value : '';
  };

  const validateSiteForm = () => {
    const isComplete = Boolean(
      currentLandUse.value &&
      proposedLandUse.value &&
      getWaterBodyValue()
    );

    siteNextBtn.disabled = !isComplete;
  };

  currentLandUse.addEventListener('change', validateSiteForm);
  proposedLandUse.addEventListener('change', validateSiteForm);
  waterBodyOptions.forEach((option) => {
    option.addEventListener('change', validateSiteForm);
  });

  siteNextBtn.addEventListener('click', () => {
    if (siteNextBtn.disabled) {
      return;
    }

    const waterBody = getWaterBodyValue();

    localStorage.setItem('siteInfo', JSON.stringify({
      currentLandUse: currentLandUse.value,
      currentLandUseLabel: LAND_USE_LABELS[currentLandUse.value],
      proposedLandUse: proposedLandUse.value,
      proposedLandUseLabel: LAND_USE_LABELS[proposedLandUse.value],
      thresholdLandUse: proposedLandUse.value,
      thresholdLandUseLabel: LAND_USE_LABELS[proposedLandUse.value],
      waterBody,
      waterBodyLabel: waterBody === 'yes' ? 'Within 500 m' : 'Greater than 500 m'
    }));

    window.location.href = 'contaminants.html';
  });

  validateSiteForm();
}
