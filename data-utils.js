const APP_STORAGE_KEY = 'bcCsrToolState';
const ASSESSMENT_CLEARED_KEY = 'bcCsrAssessmentCleared';
const ASSESSMENT_RESUME_READY_KEY = 'bcCsrResumeReady';
const DEFAULT_PROFILE_ID = 'assessment';

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

const LAB_UNITS = [
  { id: 'ug_g', label: 'µg/g', detail: 'micrograms per gram', category: 'soil', factor: 1 },
  { id: 'mg_kg', label: 'mg/kg', detail: 'milligrams per kilogram', category: 'soil', factor: 1 },
  { id: 'mg_g', label: 'mg/g', detail: 'milligrams per gram', category: 'soil', factor: 1000 },
  { id: 'ng_g', label: 'ng/g', detail: 'nanograms per gram', category: 'soil', factor: 0.001 },
  { id: 'ug_L', label: 'µg/L', detail: 'micrograms per litre', category: 'water', factor: 1 },
  { id: 'mg_L', label: 'mg/L', detail: 'milligrams per litre', category: 'water', factor: 1000 },
  { id: 'ng_L', label: 'ng/L', detail: 'nanograms per litre', category: 'water', factor: 0.001 }
];

const DEFAULT_LAB_UNIT = 'ug_g';
const BORDERLINE_RATIO = 0.8;

const CONTAMINANT_INFO_DEFAULTS = {
  'Polycyclic Aromatic Hydrocarbons (PAHs)': {
    healthEffects: 'PAHs are a broad family of compounds. Some PAHs are associated with long-term health concerns, especially when exposure is repeated or prolonged.',
    sources: 'Common sources include incomplete combustion, coal tar, creosote, petroleum impacts, asphalt, and some fire-affected materials.',
    regulatoryNotes: 'PAH standards vary by compound and land use. Some substances have very low screening values because they are used as indicators for risk.'
  },
  'BTEX & Petroleum VOCs': {
    healthEffects: 'BTEX compounds are volatile petroleum-related substances. Exposure concerns depend on concentration, vapour movement, and the exposure pathway.',
    sources: 'Common sources include gasoline, fuel storage, vehicle service areas, spills, and petroleum-impacted soil or groundwater.',
    regulatoryNotes: 'BTEX substances can be mobile and volatile, so soil, vapour, and groundwater pathways may all need review by a qualified professional.'
  },
  'Metals & Metalloids': {
    healthEffects: 'Metals occur naturally in soil and rock, but elevated concentrations can present health or ecological concerns depending on the metal and pathway.',
    sources: 'Potential sources include natural background, fill, treated wood, mining, industry, pigments, batteries, and historical site activities.',
    regulatoryNotes: 'Background concentrations and regional geology matter. Screening exceedances often need professional interpretation before conclusions are drawn.'
  },
  'Chlorinated Compounds': {
    healthEffects: 'Many chlorinated solvents are persistent, mobile, or volatile. Some have carcinogenic or toxicological concerns at low concentrations.',
    sources: 'Common sources include dry cleaning, degreasing, industrial solvents, spills, and historical disposal practices.',
    regulatoryNotes: 'These substances can migrate in groundwater and vapour. Professional review is especially important where buildings or water receptors are nearby.'
  },
  'Other Organics & Emerging Contaminants': {
    healthEffects: 'This group includes different chemical families, so health concerns vary by substance and exposure route.',
    sources: 'Sources may include industrial uses, consumer products, fire-fighting foams, waste handling, and site-specific historical activities.',
    regulatoryNotes: 'Emerging contaminants may have evolving guidance. Always verify current standards and professional practice expectations.'
  }
};

let drawerLastTrigger = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function getStoredArray(key) {
  const state = getAppState();

  if (key === 'selectedContaminants') {
    return getActiveProfile(state).selectedContaminants || [];
  }

  return safeJsonParse(localStorage.getItem(key), []);
}

function getStoredObject(key) {
  const state = getAppState();

  if (key === 'siteInfo') {
    return getStoredSiteInfo(state);
  }

  if (key === 'labValues') {
    return getActiveProfile(state).labValues || {};
  }

  return safeJsonParse(localStorage.getItem(key), {});
}

function createDefaultProfile(id, name) {
  return {
    id,
    name,
    currentLandUse: '',
    currentLandUseLabel: '',
    proposedLandUse: '',
    proposedLandUseLabel: '',
    thresholdLandUse: '',
    thresholdLandUseLabel: '',
    selectedContaminants: [],
    labValues: {}
  };
}

function getDefaultAppState() {
  return {
    version: 2,
    workflowStarted: false,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {
      assessment: createDefaultProfile(DEFAULT_PROFILE_ID, 'Assessment')
    },
    ui: {
      contaminantsSort: { type: 'category', direction: 'asc' },
      showExceedancesOnly: false,
      resultsMode: 'single'
    },
    updatedAt: ''
  };
}

function normalizeLabValue(value) {
  if (!value || typeof value !== 'object') return null;

  const hasValue = value.value !== undefined && value.value !== null && value.value !== '';
  const normalized = {
    unit: value.unit || DEFAULT_LAB_UNIT
  };

  if (hasValue && !Number.isNaN(Number(value.value))) {
    normalized.value = Number(value.value);
  }

  return normalized.value !== undefined ? normalized : null;
}

function normalizeProfile(profile, fallback) {
  const base = createDefaultProfile(fallback.id, fallback.name);
  const merged = { ...base, ...profile };
  const proposedLandUse = merged.proposedLandUse || merged.thresholdLandUse || '';
  const currentLandUse = merged.currentLandUse || '';
  const labValues = {};

  Object.entries(merged.labValues || {}).forEach(([id, value]) => {
    const normalized = normalizeLabValue(value);
    if (normalized) labValues[id] = normalized;
  });

  return {
    ...merged,
    currentLandUse,
    currentLandUseLabel: merged.currentLandUseLabel || LAND_USE_LABELS[currentLandUse] || '',
    proposedLandUse,
    proposedLandUseLabel: merged.proposedLandUseLabel || merged.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    thresholdLandUse: proposedLandUse,
    thresholdLandUseLabel: merged.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    selectedContaminants: Array.isArray(merged.selectedContaminants) ? merged.selectedContaminants : [],
    labValues
  };
}

function migrateOldStorageIntoState(state) {
  const oldSiteInfo = safeJsonParse(localStorage.getItem('siteInfo'), null);
  const oldSelected = safeJsonParse(localStorage.getItem('selectedContaminants'), null);
  const oldLabValues = safeJsonParse(localStorage.getItem('labValues'), null);
  const active = state.profiles[DEFAULT_PROFILE_ID];
  let changed = false;

  if (oldSiteInfo && !active.currentLandUse && !active.proposedLandUse) {
    const proposedLandUse = oldSiteInfo.proposedLandUse || oldSiteInfo.thresholdLandUse || '';
    active.currentLandUse = oldSiteInfo.currentLandUse || '';
    active.currentLandUseLabel = oldSiteInfo.currentLandUseLabel || LAND_USE_LABELS[active.currentLandUse] || '';
    active.proposedLandUse = proposedLandUse;
    active.proposedLandUseLabel = oldSiteInfo.proposedLandUseLabel || oldSiteInfo.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '';
    active.thresholdLandUse = proposedLandUse;
    active.thresholdLandUseLabel = active.proposedLandUseLabel;
    changed = true;
  }

  if (Array.isArray(oldSelected) && active.selectedContaminants.length === 0) {
    active.selectedContaminants = oldSelected;
    changed = true;
  }

  if (oldLabValues && Object.keys(active.labValues).length === 0) {
    Object.entries(oldLabValues).forEach(([id, value]) => {
      const normalized = normalizeLabValue(value);
      if (normalized) active.labValues[id] = normalized;
    });
    changed = true;
  }

  if (changed) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  }

  return state;
}

function getAppState() {
  const defaults = getDefaultAppState();
  const saved = safeJsonParse(localStorage.getItem(APP_STORAGE_KEY), null);

  if (!saved) {
    return migrateOldStorageIntoState(defaults);
  }

  const savedProfiles = saved.profiles || {};
  const preferredProfile =
    savedProfiles[DEFAULT_PROFILE_ID] ||
    savedProfiles[saved.activeProfileId] ||
    savedProfiles.scenarioA ||
    savedProfiles.scenarioB;
  const state = {
    ...defaults,
    ...saved,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: {
      [DEFAULT_PROFILE_ID]: normalizeProfile(preferredProfile, defaults.profiles[DEFAULT_PROFILE_ID])
    },
    ui: {
      ...defaults.ui,
      ...(saved.ui || {}),
      contaminantsSort: {
        ...defaults.ui.contaminantsSort,
        ...(saved.ui?.contaminantsSort || {})
      }
    }
  };

  return state;
}

function syncLegacyStorage(state) {
  const profile = getActiveProfile(state);
  localStorage.setItem('siteInfo', JSON.stringify(getStoredSiteInfo(state)));
  localStorage.setItem('selectedContaminants', JSON.stringify(profile.selectedContaminants || []));
  localStorage.setItem('labValues', JSON.stringify(profile.labValues || {}));
}

function saveAppState(nextState, options = {}) {
  const state = {
    ...getDefaultAppState(),
    ...nextState,
    updatedAt: new Date().toISOString()
  };

  localStorage.removeItem(ASSESSMENT_CLEARED_KEY);
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
  syncLegacyStorage(state);
  window.dispatchEvent(new CustomEvent('bc-csr-state-saved', { detail: state }));

  return state;
}

function clearAssessment() {
  const fresh = getDefaultAppState();
  localStorage.removeItem(APP_STORAGE_KEY);
  localStorage.removeItem('siteInfo');
  localStorage.removeItem('selectedContaminants');
  localStorage.removeItem('labValues');
  localStorage.removeItem(ASSESSMENT_RESUME_READY_KEY);
  localStorage.setItem(ASSESSMENT_CLEARED_KEY, 'true');
  window.dispatchEvent(new CustomEvent('bc-csr-state-saved', { detail: fresh }));
  return fresh;
}

function hasSavedProgress() {
  if (localStorage.getItem(ASSESSMENT_CLEARED_KEY) === 'true') return false;
  if (localStorage.getItem(ASSESSMENT_RESUME_READY_KEY) !== 'true') return false;

  const state = getAppState();
  if (!state.workflowStarted) return false;

  return Object.values(state.profiles).some((profile) => {
    return Boolean(
      profile.currentLandUse ||
      profile.proposedLandUse ||
      profile.selectedContaminants.length ||
      Object.keys(profile.labValues || {}).length
    );
  });
}

function markAssessmentStarted() {
  localStorage.removeItem(ASSESSMENT_CLEARED_KEY);
  const state = getAppState();
  if (state.workflowStarted) return state;

  state.workflowStarted = true;
  return saveAppState(state, { status: false });
}

function getActiveProfile(state = getAppState()) {
  return state.profiles[state.activeProfileId] || state.profiles[DEFAULT_PROFILE_ID];
}

function updateActiveProfileData(patch) {
  localStorage.removeItem(ASSESSMENT_CLEARED_KEY);
  localStorage.setItem(ASSESSMENT_RESUME_READY_KEY, 'true');
  const state = getAppState();
  const profile = getActiveProfile(state);
  const nextProfile = { ...profile, ...patch };

  if (patch.proposedLandUse !== undefined) {
    nextProfile.thresholdLandUse = patch.proposedLandUse;
    nextProfile.thresholdLandUseLabel = LAND_USE_LABELS[patch.proposedLandUse] || '';
  }

  state.profiles[profile.id] = nextProfile;
  state.workflowStarted = true;
  return saveAppState(state);
}

function updateAppUi(patch) {
  const state = getAppState();
  state.ui = {
    ...state.ui,
    ...patch,
    contaminantsSort: {
      ...state.ui.contaminantsSort,
      ...(patch.contaminantsSort || {})
    }
  };
  return saveAppState(state);
}

function getStoredSiteInfo(state = getAppState()) {
  const profile = getActiveProfile(state);
  const proposedLandUse = profile.proposedLandUse || profile.thresholdLandUse || '';
  const currentLandUse = profile.currentLandUse || '';

  return {
    currentLandUse,
    currentLandUseLabel: profile.currentLandUseLabel || LAND_USE_LABELS[currentLandUse] || '',
    proposedLandUse,
    proposedLandUseLabel: profile.proposedLandUseLabel || profile.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    thresholdLandUse: proposedLandUse,
    thresholdLandUseLabel: profile.thresholdLandUseLabel || profile.proposedLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    groundwaterThresholdsShown: true
  };
}

function getUnitDef(unitId) {
  return LAB_UNITS.find((unit) => unit.id === unitId) || LAB_UNITS.find((unit) => unit.id === DEFAULT_LAB_UNIT);
}

function getAvailableUnits() {
  return LAB_UNITS;
}

function isWaterUnit(unitId) {
  return getUnitDef(unitId).category === 'water';
}

function formatThreshold(value) {
  if (value === null || value === undefined) return 'NS';
  if (value === 'unrestricted') return 'Unrestricted';
  if (value === 'pH-dep.') return 'pH-dep.';
  return Number(value).toLocaleString();
}

function getNumericThreshold(value) {
  return typeof value === 'number' ? value : null;
}

function getThreshold(contaminant, landUse, matrix) {
  const standards = contaminant.thresholds?.[landUse];
  if (!standards) return null;
  return matrix === 'water' ? standards.gw : standards.soil;
}

function getComparisonThreshold(contaminant, siteInfo, unitId) {
  return getThreshold(contaminant, siteInfo.proposedLandUse, isWaterUnit(unitId) ? 'water' : 'soil');
}

function getDisplayConcentration(labValue) {
  if (!labValue) return '—';
  const hasValue = labValue.value !== undefined && labValue.value !== null && labValue.value !== '';

  return hasValue ? Number(labValue.value).toLocaleString() : '—';
}

function getResultForLabValue(contaminant, labValue, siteInfo) {
  const unitDef = getUnitDef(labValue?.unit || DEFAULT_LAB_UNIT);
  const hasValue = labValue?.value !== undefined && labValue?.value !== null && labValue?.value !== '';
  const standard = getComparisonThreshold(contaminant, siteInfo, unitDef.id);
  const numericStandard = getNumericThreshold(standard);

  if (!hasValue) {
    return {
      status: 'Threshold only',
      className: 'neutral',
      confidence: 'Threshold only',
      converted: null,
      ratio: null,
      standard,
      unitDef
    };
  }

  const converted = Number(labValue.value) * unitDef.factor;

  if (numericStandard === null) {
    return {
      status: 'Review',
      className: 'review',
      confidence: 'Review',
      converted,
      ratio: null,
      standard,
      unitDef
    };
  }

  const ratio = converted / numericStandard;

  if (ratio > 1) {
    return {
      status: 'Exceeds',
      className: 'exceeds',
      confidence: 'Exceeds',
      converted,
      ratio,
      standard,
      unitDef
    };
  }

  if (ratio >= BORDERLINE_RATIO) {
    return {
      status: 'Borderline',
      className: 'borderline',
      confidence: 'Borderline',
      converted,
      ratio,
      standard,
      unitDef
    };
  }

  return {
    status: 'Below',
    className: 'below',
    confidence: 'Below',
    converted,
    ratio,
    standard,
    unitDef
  };
}

function getContaminantBySavedItem(data, item) {
  if (!item) return null;
  const id = item.id || item.contaminantId;
  const name = item.name || item.substance;

  return data.contaminants.find((contaminant) => {
    return contaminant.id === id || contaminant.name === name;
  }) || null;
}

function getSelectedContaminants(data, profileId) {
  const state = getAppState();
  const profile = profileId ? state.profiles[profileId] : getActiveProfile(state);

  return (profile?.selectedContaminants || [])
    .map((item) => getContaminantBySavedItem(data, item))
    .filter(Boolean);
}

function getSelectedStorageItem(contaminant) {
  return {
    id: contaminant.id,
    name: contaminant.name,
    cas: contaminant.cas,
    category: contaminant.category
  };
}

function saveSelectedContaminants(data, selectedIds) {
  const selected = data.contaminants
    .filter((contaminant) => selectedIds.has(contaminant.id))
    .map(getSelectedStorageItem);

  return updateActiveProfileData({ selectedContaminants: selected });
}

function getCategoryEntries(data, siteInfo) {
  return Object.entries(data.contaminantCategories).filter(([_, category]) => {
    return !siteInfo.proposedLandUse || category.relevantLandUse.includes(siteInfo.proposedLandUse);
  });
}

function getProfileSiteInfo(profile) {
  const proposedLandUse = profile.proposedLandUse || profile.thresholdLandUse || '';
  const currentLandUse = profile.currentLandUse || '';

  return {
    currentLandUse,
    currentLandUseLabel: profile.currentLandUseLabel || LAND_USE_LABELS[currentLandUse] || '',
    proposedLandUse,
    proposedLandUseLabel: profile.proposedLandUseLabel || profile.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    thresholdLandUse: proposedLandUse,
    thresholdLandUseLabel: profile.thresholdLandUseLabel || profile.proposedLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    groundwaterThresholdsShown: true
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function getExtraContaminantInfo(contaminant) {
  return CONTAMINANT_INFO_DEFAULTS[contaminant.category] || {
    healthEffects: 'Health considerations vary by substance, concentration, exposure pathway, and site use.',
    sources: 'Common sources depend on site history, fill material, nearby activities, and product use.',
    regulatoryNotes: 'Use this as general educational context only. Verify current BC CSR standards before relying on the result.'
  };
}

function ensureContaminantDrawer() {
  let drawer = document.getElementById('contaminantDrawer');

  if (drawer) return drawer;

  drawer = document.createElement('aside');
  drawer.id = 'contaminantDrawer';
  drawer.className = 'info-drawer';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="drawer-scrim" data-close-drawer></div>
    <div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" tabindex="-1">
      <button class="drawer-close" type="button" aria-label="Close substance information" data-close-drawer>×</button>
      <p class="eyebrow">Substance profile</p>
      <h2 id="drawerTitle"></h2>
      <div id="drawerBody"></div>
    </div>
  `;
  document.body.appendChild(drawer);

  drawer.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-drawer]')) {
      closeContaminantDrawer();
    }
  });

  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContaminantDrawer();
    }
  });

  return drawer;
}

function openContaminantDrawer(contaminant, trigger) {
  if (!contaminant) return;

  const drawer = ensureContaminantDrawer();
  const body = drawer.querySelector('#drawerBody');
  const title = drawer.querySelector('#drawerTitle');
  const info = getExtraContaminantInfo(contaminant);

  drawerLastTrigger = trigger || document.activeElement;
  title.textContent = contaminant.name;
  body.innerHTML = `
    <dl class="drawer-meta">
      <div><dt>CAS</dt><dd>${escapeHtml(contaminant.cas || 'NS')}</dd></div>
      <div><dt>Category</dt><dd>${escapeHtml(contaminant.category)}</dd></div>
    </dl>
    <section>
      <h3>Description</h3>
      <p>${escapeHtml(contaminant.description || 'General contaminant information only.')}</p>
    </section>
    <section>
      <h3>Health Effects</h3>
      <p>${escapeHtml(info.healthEffects)}</p>
    </section>
    <section>
      <h3>Common Sources</h3>
      <p>${escapeHtml(info.sources)}</p>
    </section>
    <section>
      <h3>Regulatory Notes</h3>
      <p>${escapeHtml(info.regulatoryNotes)}</p>
    </section>
    <p class="drawer-disclaimer">General educational information only. Verify current standards and consult a qualified professional for site-specific work.</p>
  `;

  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.querySelector('.drawer-panel').focus();
}

function closeContaminantDrawer() {
  const drawer = document.getElementById('contaminantDrawer');
  if (!drawer) return;

  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');

  if (drawerLastTrigger && typeof drawerLastTrigger.focus === 'function') {
    drawerLastTrigger.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  getAppState();

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContaminantDrawer();
      document.querySelector('.command-palette.is-open')?.dispatchEvent(new CustomEvent('palette-close'));
      document.querySelector('.csv-modal.is-open')?.dispatchEvent(new CustomEvent('csv-close'));
    }
  });
});
