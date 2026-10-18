const APP_STORAGE_KEY = 'bcCsrToolState';
const ASSESSMENT_CLEARED_KEY = 'bcCsrAssessmentCleared';
const ASSESSMENT_RESUME_READY_KEY = 'bcCsrResumeReady';
const WORKING_ASSESSMENT_ACCOUNT_KEY = 'bcCsrWorkingAccount';
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
const DEFAULT_SOIL_UNIT = 'µg/g';
const DEFAULT_GW_UNIT = 'µg/L';
const APP_STATE_VERSION = 5;

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

function createDefaultProfile(id, name) {
  return {
    id,
    siteId: newRecordId('site'),
    name,
    currentLandUse: '',
    currentLandUseLabel: '',
    proposedLandUse: '',
    proposedLandUseLabel: '',
    thresholdLandUse: '',
    thresholdLandUseLabel: '',
    selectedContaminants: [],
    labValues: {},
    apecs: [],
    siteName: '',
    assessmentMode: 'current',
    factors: {},
    factorJustifications: {},
    multipleLandUses: false
  };
}

function getDefaultAppState() {
  return {
    version: APP_STATE_VERSION,
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

function getStoredUnitLabel(unit) {
  const unitDef = LAB_UNITS.find((item) => item.id === unit || item.label === unit);
  return unitDef?.label || String(unit || '');
}

function getStoredUnitCategory(unit) {
  const unitDef = LAB_UNITS.find((item) => item.id === unit || item.label === unit);
  return unitDef?.category || '';
}

function normalizeSelectedContaminant(item) {
  if (!item || typeof item !== 'object') return null;

  const normalized = {
    id: item.id || item.contaminantId || '',
    name: item.name || item.substance || '',
    cas: item.cas || '',
    group: item.group || item.category || '',
    soilConc: item.soilConc ?? '',
    soilUnit: item.soilUnit ?? DEFAULT_SOIL_UNIT,
    gwConc: item.gwConc ?? '',
    gwUnit: item.gwUnit ?? DEFAULT_GW_UNIT
  };

  const hasLegacyConcentration =
    item.concentration !== undefined &&
    item.concentration !== null &&
    item.concentration !== '';

  if (hasLegacyConcentration) {
    const legacyUnit = getStoredUnitLabel(item.unit);
    const category = getStoredUnitCategory(item.unit);

    if (category === 'soil') {
      normalized.soilConc = item.concentration;
      normalized.soilUnit = legacyUnit;
      normalized.gwConc = '';
      normalized.gwUnit = '';
    } else if (category === 'water') {
      normalized.soilConc = '';
      normalized.soilUnit = '';
      normalized.gwConc = item.concentration;
      normalized.gwUnit = legacyUnit;
    }
  }

  return normalized;
}

function applyLabValuesToContaminants(contaminants, labValues, clearMissing = false) {
  return contaminants.map((contaminant) => {
    const labValue = normalizeLabValue(labValues?.[contaminant.id]);
    if (!labValue) {
      return clearMissing
        ? {
            ...contaminant,
            soilConc: '',
            soilUnit: DEFAULT_SOIL_UNIT,
            gwConc: '',
            gwUnit: DEFAULT_GW_UNIT
          }
        : contaminant;
    }

    const unitLabel = getStoredUnitLabel(labValue.unit);
    const category = getStoredUnitCategory(labValue.unit);

    if (category === 'water') {
      return {
        ...contaminant,
        soilConc: '',
        soilUnit: '',
        gwConc: labValue.value,
        gwUnit: unitLabel
      };
    }

    return {
      ...contaminant,
      soilConc: labValue.value,
      soilUnit: unitLabel,
      gwConc: '',
      gwUnit: ''
    };
  });
}

function normalizeProfile(profile, fallback) {
  const base = createDefaultProfile(fallback.id, fallback.name);
  const merged = { ...base, ...profile };
  const proposedLandUse = merged.proposedLandUse || merged.thresholdLandUse || '';
  const currentLandUse = merged.currentLandUse || '';
  const labValues = {};
  const savedContaminants = Array.isArray(merged.selectedContaminants) ? merged.selectedContaminants : [];
  const legacyContaminantIds = new Set(
    savedContaminants
      .filter((item) => !['soilConc', 'soilUnit', 'gwConc', 'gwUnit'].some((key) => key in (item || {})))
      .map((item) => item?.id || item?.contaminantId)
  );
  let selectedContaminants = savedContaminants
    .map(normalizeSelectedContaminant)
    .filter(Boolean);

  Object.entries(merged.labValues || {}).forEach(([id, value]) => {
    const normalized = normalizeLabValue(value);
    if (normalized) labValues[id] = normalized;
  });

  const legacyLabValues = Object.fromEntries(
    Object.entries(labValues).filter(([id]) => legacyContaminantIds.has(id))
  );
  selectedContaminants = applyLabValuesToContaminants(selectedContaminants, legacyLabValues);

  return {
    ...merged,
    assessmentMode: profile?.assessmentMode || (currentLandUse && proposedLandUse ? 'both' : proposedLandUse ? 'proposed' : 'current'),
    currentLandUse,
    currentLandUseLabel: merged.currentLandUseLabel || LAND_USE_LABELS[currentLandUse] || '',
    proposedLandUse,
    proposedLandUseLabel: merged.proposedLandUseLabel || merged.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    thresholdLandUse: proposedLandUse,
    thresholdLandUseLabel: merged.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    selectedContaminants,
    apecs: removeSampleDepth(Array.isArray(profile?.apecs) ? profile.apecs : migrateLegacySamples(selectedContaminants)),
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
    active.selectedContaminants = oldSelected
      .map(normalizeSelectedContaminant)
      .filter(Boolean);
    changed = true;
  }

  if (oldLabValues && Object.keys(active.labValues).length === 0) {
    Object.entries(oldLabValues).forEach(([id, value]) => {
      const normalized = normalizeLabValue(value);
      if (normalized) active.labValues[id] = normalized;
    });
    active.selectedContaminants = applyLabValuesToContaminants(active.selectedContaminants, active.labValues);
    changed = true;
  }

  if (changed) {
    state.profiles[DEFAULT_PROFILE_ID] = normalizeProfile(active, active);
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
    version: APP_STATE_VERSION,
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

  if (saved.version !== APP_STATE_VERSION || !preferredProfile?.siteId) {
    if (!localStorage.getItem('bcCsrToolStateBeforeSamples')) localStorage.setItem('bcCsrToolStateBeforeSamples', JSON.stringify(saved));
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
    syncLegacyStorage(state);
  }

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
  localStorage.removeItem('bcCsrToolStateBeforeSamples');
  localStorage.removeItem('bcCsrAssessmentBeforeOpen');
  localStorage.removeItem(ASSESSMENT_RESUME_READY_KEY);
  localStorage.setItem(ASSESSMENT_CLEARED_KEY, 'true');
  window.dispatchEvent(new CustomEvent('bc-csr-state-saved', { detail: fresh }));
  return fresh;
}

function switchAssessmentAccount(userId) {
  const next = userId || 'guest';
  const previous = localStorage.getItem(WORKING_ASSESSMENT_ACCOUNT_KEY);
  const linkedOwner = getAppState().cloudAssessment?.userId;
  const reset = Boolean(
    (previous && previous !== 'guest' && previous !== next) ||
    (linkedOwner && linkedOwner !== next) ||
    (!previous && next !== 'guest' && hasSavedProgress())
  );
  if (reset) clearAssessment();
  localStorage.setItem(WORKING_ASSESSMENT_ACCOUNT_KEY, next);
  return reset;
}

// Only assessment inputs go into account saves; session/UI ownership stays local.
function getAssessmentSnapshot(state = getAppState()) {
  if (!state || state.version !== APP_STATE_VERSION || !state.profiles?.assessment) {
    throw new Error('This saved assessment uses an unsupported format. Your current assessment has not been changed.');
  }
  if (!Array.isArray(state.profiles.assessment.selectedContaminants) || !Array.isArray(state.profiles.assessment.apecs)) {
    throw new Error('This saved assessment is incomplete. Your current assessment has not been changed.');
  }
  const defaults = getDefaultAppState();
  const profile = normalizeProfile(state.profiles.assessment, defaults.profiles.assessment);
  validateSampleData(profile.apecs);
  return JSON.parse(JSON.stringify({
    version: APP_STATE_VERSION, workflowStarted: true,
    activeProfileId: DEFAULT_PROFILE_ID, profiles: { assessment: profile }
  }));
}

function restoreAccountAssessment(record, userId) {
  if (!record || record.user_id !== userId) throw new Error('This assessment is not available for your account.');
  const snapshot = getAssessmentSnapshot(record.payload);
  const previous = getAppState();
  localStorage.setItem('bcCsrAssessmentBeforeOpen', JSON.stringify(previous));
  const restored = saveAppState({ ...getDefaultAppState(), ...snapshot,
    cloudAssessment: { id: record.id, userId, revision: record.revision, title: record.title, savedSnapshot: snapshot }
  });
  localStorage.setItem(ASSESSMENT_RESUME_READY_KEY, 'true');
  return restored;
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

  if (patch.currentLandUse !== undefined) nextProfile.currentLandUseLabel = LAND_USE_LABELS[patch.currentLandUse] || '';
  if (patch.proposedLandUse !== undefined) nextProfile.proposedLandUseLabel = LAND_USE_LABELS[patch.proposedLandUse] || '';

  if (patch.labValues !== undefined) {
    nextProfile.selectedContaminants = applyLabValuesToContaminants(
      profile.selectedContaminants || [],
      patch.labValues,
      true
    );
  }

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
    groundwaterThresholdsShown: false
  };
}

function getUnitDef(unitId) {
  return LAB_UNITS.find((unit) => unit.id === unitId || unit.label === unitId) || null;
}

function hasConcentration(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getMeasurementError(value, unit, matrix) {
  if (value !== undefined && value !== null && !['number', 'string'].includes(typeof value)) {
    return 'Enter a finite, non-negative concentration.';
  }
  if (!hasConcentration(value)) return '';
  if ((typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) ||
      !Number.isFinite(Number(value)) || Number(value) < 0) {
    return 'Enter a finite, non-negative concentration.';
  }
  const unitDef = getUnitDef(unit);
  if (!unitDef || unitDef.category !== (matrix === 'soil' ? 'soil' : 'water')) {
    return 'Choose a supported unit for this matrix.';
  }
  if (!Number.isFinite(Number(value) * unitDef.factor)) {
    return 'The concentration is too large to convert safely.';
  }
  return '';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (Math.abs(number) >= 1e9) return number.toExponential(5).replace(/\.?0+e/, 'e');
  return number.toLocaleString(undefined, { maximumSignificantDigits: 15 });
}

function getAvailableUnits() {
  return LAB_UNITS;
}

function formatThreshold(value) {
  if (value === null || value === undefined) return 'NS';
  if (value === 'unrestricted') return 'Unrestricted';
  if (value === 'pH-dep.') return 'pH-dep.';
  return formatNumber(value);
}

function getNumericThreshold(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function getThreshold(contaminant, landUse, matrix) {
  if (matrix !== 'soil') return null;
  return screenSoil(contaminant, '', DEFAULT_SOIL_UNIT, landUse).threshold;
}

const SOIL_FACTORS = {
  intake: 'Intake of contaminated soil',
  plants: 'Toxicity to soil invertebrates and plants',
  drinking: 'Groundwater used for drinking water',
  livestock: 'Livestock ingesting soil and fodder',
  microbial: 'Major microbial functional impairment',
  aquatic: 'Groundwater flow to surface water used by aquatic life',
  watering: 'Groundwater used for livestock watering',
  irrigation: 'Groundwater used for irrigation'
};

function screenSoil(contaminant, concentration, unit, landUse, options = {}) {
  const uncertainties = [];
  const nonDetect = options.nonDetect === true;
  const value = nonDetect ? options.reportingLimit : concentration;
  const error = getMeasurementError(value, unit, 'soil') || (nonDetect && hasConcentration(value) && Number(value) <= 0 ? 'A non-detect reporting limit must be positive.' : '');
  const present = hasConcentration(value);
  const converted = present && !error ? Number(value) * getUnitDef(unit).factor : null;
  if (!LAND_USE_LABELS[landUse]) uncertainties.push('Choose a valid CSR land use.');
  if (error) uncertainties.push(error);
  if (!present) uncertainties.push(nonDetect ? 'Non-detect requires a reporting limit.' : 'No soil measurement entered.');
  if (options.multipleLandUses) uncertainties.push('Multiple land uses require Protocol 18 review.');
  const comparisons = (contaminant.standards || []).map((record) => {
    const mandatory = ['intake', 'plants'].includes(record.factor);
    const applicability = !record.factor ? 'applicable' : mandatory ? (options.factors?.[record.factor] === 'not_assessed' ? 'not_assessed' : 'applicable') : options.factors?.[record.factor] || 'not_applicable';
    const standard = record.standards[landUse];
    const label = record.factor ? SOIL_FACTORS[record.factor] : `Part ${record.part} generic ${record.part === 2 ? 'human-health' : 'ecological'} standard`;
    const source = `Schedule 3.1 Part ${record.part}${record.matrix ? ` Matrix ${record.matrix}` : ` ${record.source_name}`}; ${label}; column ${Object.keys(LAND_USE_LABELS).indexOf(landUse) + (record.part === 1 ? 2 : 3)}; PDF page(s) ${record.pages.join(', ')}${record.note_refs?.length ? `; note(s) ${record.note_refs.join(', ')}` : ''}`;
    let status = 'Inconclusive';
    let reason = '';
    let numeric = null;
    if (applicability === 'not_applicable') status = 'Not applicable';
    else if (!standard || standard.kind === 'blank') reason = 'Source cell is blank or unavailable; no numerical comparison inferred.';
    else if (applicability !== 'applicable') reason = mandatory ? 'Mandatory factor has not been assessed.' : 'Factor applicability has not been assessed (water-use factors require Protocol 21).';
    else if (standard.kind === 'ns') status = 'No numerical standard';
    else if (standard.kind !== 'numeric' || record.conditions.length) reason = 'Source conditions or non-numerical notation require professional review; automatic treatment is not supported.';
    else {
      numeric = standard.value;
      if (converted !== null) {
        const tolerance = getUnitDef(unit).factor === 1 ? 0 : Number.EPSILON * Math.max(converted, numeric) * 4;
        const exceeds = converted - numeric > tolerance;
        status = nonDetect && exceeds ? 'Inconclusive' : exceeds ? 'Exceeds' : 'Pass';
        if (nonDetect && exceeds) reason = 'Reporting limit is above the standard; the actual concentration is unknown.';
      } else reason = error || 'No valid soil measurement.';
    }
    if (status === 'Inconclusive' && applicability !== 'not_applicable') uncertainties.push(`${label}: ${reason}`);
    return { label, factor: record.factor, part: record.part, applicability, status, reason, sourceLabels: record.source_labels || [],
      threshold: numeric, raw: standard?.raw ?? '', unit: standard?.unit || record.unit, source, pages: record.pages,
      conditions: record.conditions, noteRefs: record.note_refs || [], sourceNotes: record.source_notes || {}, ratio: converted !== null && numeric > 0 ? converted / numeric : null };
  });
  if (contaminant.standards?.[0]?.part !== 1 && contaminant.standards?.length === 1) uncertainties.push('Counterpart generic table has no source row; professional review required.');
  if (!comparisons.length) uncertainties.push('No verified Schedule 3.1 source records available.');
  const numerical = comparisons.filter((row) => row.threshold !== null);
  const threshold = numerical.length ? Math.min(...numerical.map((row) => row.threshold)) : null;
  const controls = numerical.filter((row) => row.threshold === threshold).map((row) => row.label);
  const exceeds = comparisons.some((row) => row.status === 'Exceeds');
  const status = exceeds ? 'Exceeds' : uncertainties.length ? 'Inconclusive' : !numerical.length ? 'No numerical standard' : 'Pass';
  return { status, threshold, controls, comparisons, uncertainties, converted,
    evaluated: numerical.length > 0 && converted !== null, className: exceeds ? 'exceeds' : status === 'Pass' ? 'below' : 'neutral',
    percentLabel: threshold > 0 && converted !== null ? `${formatRatio(converted / threshold)}× lowest resolved standard${nonDetect ? ' (reporting limit)' : ''}` : '—',
    percentValue: null, guidance: uncertainties.join(' ') };
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

function getAssessmentContaminants(data, profileId) {
  const state = getAppState();
  const profile = profileId ? state.profiles[profileId] : getActiveProfile(state);

  return (profile?.selectedContaminants || [])
    .map((item) => {
      const contaminant = getContaminantBySavedItem(data, item);
      const saved = normalizeSelectedContaminant(item);
      if (!contaminant || !saved) return null;

      return {
        ...contaminant,
        ...saved,
        name: contaminant.name,
        cas: contaminant.cas,
        category: contaminant.category,
        group: saved.group || contaminant.category
      };
    })
    .filter(Boolean);
}

function saveAssessmentContaminants(contaminants) {
  const selectedContaminants = contaminants
    .map(normalizeSelectedContaminant)
    .filter(Boolean);

  selectedContaminants.forEach((item) => {
    for (const [matrix, value, unit] of [
      ['soil', item.soilConc, item.soilUnit],
      ['groundwater', item.gwConc, item.gwUnit]
    ]) {
      const error = getMeasurementError(value, unit, matrix);
      if (error) throw new Error(`${item.name || item.id} ${matrix}: ${error}`);
    }
  });

  return updateActiveProfileData({ selectedContaminants });
}

function getSelectedStorageItem(contaminant, savedItem) {
  const existing = normalizeSelectedContaminant(savedItem);

  return {
    id: contaminant.id,
    name: contaminant.name,
    cas: contaminant.cas,
    group: contaminant.group || contaminant.category || '',
    soilConc: existing?.soilConc ?? '',
    soilUnit: existing?.soilUnit ?? DEFAULT_SOIL_UNIT,
    gwConc: existing?.gwConc ?? '',
    gwUnit: existing?.gwUnit ?? DEFAULT_GW_UNIT
  };
}

function saveSelectedContaminants(data, selectedIds) {
  const profile = getActiveProfile();
  const savedById = new Map(
    (profile.selectedContaminants || []).map((item) => [item.id || item.contaminantId, item])
  );
  const selected = data.contaminants
    .filter((contaminant) => selectedIds.has(contaminant.id))
    .map((contaminant) => getSelectedStorageItem(contaminant, savedById.get(contaminant.id)));

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
    groundwaterThresholdsShown: false
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

function getAssessmentScenarios(profile) {
  const mode = profile.assessmentMode || (profile.proposedLandUse ? 'both' : 'current');
  const scenarios = [];
  if (mode !== 'proposed') scenarios.push({ scenario: 'Current', landUse: profile.currentLandUse });
  if (mode !== 'current') scenarios.push({ scenario: 'Proposed', landUse: profile.proposedLandUse });
  return scenarios;
}

function getSiteValidationError(profile) {
  if (!['current', 'proposed', 'both'].includes(profile.assessmentMode)) return 'Select a valid assessment mode.';
  if (profile.assessmentMode !== 'proposed' && !LAND_USE_LABELS[profile.currentLandUse]) return 'Select the current land use.';
  if (profile.assessmentMode !== 'current' && !LAND_USE_LABELS[profile.proposedLandUse]) return 'Select the proposed land use.';
  return '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (inQuotes) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function getColumnIndex(headers, names) {
  const normalizedHeaders = headers.map(normalizeText);
  return normalizedHeaders.findIndex((header) => names.some((name) => header === normalizeText(name)));
}


function newRecordId(prefix) {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
}

function migrateLegacySamples(contaminants) {
  const results = contaminants.filter(c => hasConcentration(c.soilConc)).map(c => ({
    contaminantId: c.id, value: c.soilConc, unit: c.soilUnit || DEFAULT_SOIL_UNIT, qualifier: 'detected', reportingLimit: ''
  }));
  if (!results.length) return [];
  return [{id:'legacy-apec',name:'Legacy assessment',description:'Imported from the earlier single-concentration workflow. Verify sample identity.',locations:[
    {id:'legacy-location',name:'Unassigned location',type:'Unknown',samples:[
      {id:'legacy-sample',name:'Legacy sample',date:'',results}
    ]}
  ]}];
}

function getSoilSamples(profile = getActiveProfile()) {
  return (profile.apecs || []).flatMap(apec => (apec.locations || []).flatMap(location => (location.samples || []).map(sample => ({apec,location,sample}))));
}

function validateSampleData(apecs) {
  if (!Array.isArray(apecs)) throw new Error('APEC data must be a list.');
  const ids = new Set();
  const checkRecords = (records, label) => {
    if (!Array.isArray(records)) throw new Error(`${label} must be a list.`);
    const names = new Set();
    records.forEach(record => {
      if (typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw new Error('Record IDs must be unique and non-empty.');
      ids.add(record.id);
      if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 160) throw new Error(`${label} needs a name of 1–160 characters.`);
      const name = record.name.trim().toLowerCase();
      if (names.has(name)) throw new Error(`Duplicate ${label} name: ${record.name}.`);
      names.add(name);
    });
  };
  checkRecords(apecs, 'APEC');
  apecs.forEach(apec => {
    checkRecords(apec.locations, 'Location');
    apec.locations.forEach(location => {
      checkRecords(location.samples, 'Sample');
      location.samples.forEach(sample => {
        if (sample.date && (!/^\d{4}-\d{2}-\d{2}$/.test(sample.date) || Number.isNaN(Date.parse(sample.date)) || new Date(sample.date).toISOString().slice(0,10) !== sample.date)) throw new Error(`${sample.name}: invalid sample date.`);
        if (!Array.isArray(sample.results)) throw new Error('Sample results must be a list.');
        const substances = new Set();
        sample.results.forEach(result => {
          if (!result.contaminantId || substances.has(result.contaminantId)) throw new Error(`${sample.name}: duplicate or missing contaminant ID.`);
          substances.add(result.contaminantId);
          if (!['detected','non_detect'].includes(result.qualifier)) throw new Error(`${sample.name}: invalid detection qualifier.`);
          if (getUnitDef(result.unit)?.category !== 'soil') throw new Error(`${sample.name}: use soil concentration units.`);
          const value = result.qualifier === 'non_detect' ? result.reportingLimit : result.value;
          const error = getMeasurementError(value, result.unit, 'soil');
          if (error || (result.qualifier === 'non_detect' && hasConcentration(value) && Number(value) <= 0)) throw new Error(`${sample.name}: ${error || 'a non-detect needs a positive reporting limit.'}`);
        });
      });
    });
  });
}

function removeSampleDepth(apecs) {
  const clean=JSON.parse(JSON.stringify(apecs));
  for(const {sample} of getSoilSamples({apecs:clean})) {delete sample.depthFrom;delete sample.depthTo;}
  return clean;
}

function saveSampleData(apecs) {
  apecs=removeSampleDepth(apecs);
  validateSampleData(apecs);
  return updateActiveProfileData({apecs});
}

function changeSampleData(change) {
  const apecs = JSON.parse(JSON.stringify(getActiveProfile().apecs || []));
  change(apecs);
  return saveSampleData(apecs);
}

function findSample(apecs, sampleId) {
  for (const apec of apecs) for (const location of apec.locations) {
    const sample = location.samples.find(sample => sample.id === sampleId);
    if (sample) return sample;
  }
  return null;
}

function getSampleScreeningRows(data, profile) {
  const catalogue = new Map(data.contaminants.map(c => [c.id,c]));
  return getSoilSamples(profile).flatMap(({apec,location,sample}) => sample.results.map(analytical => {
    const contaminant = catalogue.get(analytical.contaminantId);
    if (!contaminant) return {apec,location,sample,analytical,contaminant:{id:analytical.contaminantId,name:'Unknown substance',cas:'',category:'Unresolved',standards:[]}};
    return {apec,location,sample,analytical,contaminant};
  })).map(row => ({...row, matrices:getAssessmentScenarios(profile).map(({scenario,landUse}) => {
    const {analytical,sample,contaminant} = row;
    const unit = analytical.unit;
    const nonDetect = analytical.qualifier === 'non_detect';
    const result = screenSoil(contaminant, analytical.value, unit, landUse, {
      factors:profile.factors, nonDetect, reportingLimit:analytical.reportingLimit,
      multipleLandUses:profile.multipleLandUses
    });
    const value = nonDetect ? analytical.reportingLimit : analytical.value;
    return {key:'soil',label:`${scenario} — ${LAND_USE_LABELS[landUse] || 'Unselected'}`,scenario,landUse,
      concentration:value, unit, unitDef:getUnitDef(unit) || {label:unit}, threshold:result.threshold, thresholdUnit:DEFAULT_SOIL_UNIT,
      hasLabValue:nonDetect || hasConcentration(value), displayConcentration:hasConcentration(value) ? `${nonDetect ? '< ' : ''}${formatNumber(value)}` : nonDetect ? 'No detection' : '—', result,
      qualifier:analytical.qualifier, reportingLimit:analytical.reportingLimit,
      thresholdSource:result.comparisons.map(c=>`${c.label}: ${c.raw || 'blank'} ${c.unit}; ${c.status}; ${c.source}`).join(' | ')};
  })}));
}

function buildSampleImportPreview(data, text, profile = getActiveProfile()) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const column = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
  const valueColumn = column('value','concentration','soil_concentration','entered_concentration');
  const rlColumn = column('reporting_limit','rl');
  if (valueColumn < 0 && rlColumn < 0) throw new Error('CSV needs a value or reporting_limit column.');
  const apecs = JSON.parse(JSON.stringify(profile.apecs || []));
  const selectedIds = new Set((profile.selectedContaminants || []).map(c=>c.id));
  const entries = [], errors = [], duplicates = new Set();
  const get = (row,...names) => String(row[column(...names)] ?? '').trim();
  const resolveRecord = (list,id,name,prefix,defaults) => {
    const existing = id ? list.find(r=>r.id===id) : list.find(r=>r.name.toLowerCase()===name.toLowerCase());
    if (existing) {
      if (name && name !== existing.name) throw new Error(`ID ${id} has a different saved name. Rename it in the editor first.`);
      return existing;
    }
    const record = {id:id || newRecordId(prefix),name:name || id,...defaults};
    list.push(record); return record;
  };
  rows.slice(1).forEach((row,index) => {
    try {
      if (row.length !== headers.length) throw new Error('Column count does not match the header.');
      const rawValue = String(row[valueColumn] ?? '').trim();
      const rawRL = String(row[rlColumn] ?? '').trim();
      if (!rawValue && !rawRL) return;
      if (get(row,'matrix') && !['soil','land'].includes(get(row,'matrix').toLowerCase())) throw new Error('Only soil measurements can be imported.');
      const id=get(row,'contaminant_id','substance_id','id'), name=get(row,'contaminant','contaminant_name','name'), cas=get(row,'cas','cas_number');
      const matches=id ? data.contaminants.filter(c=>c.id===id) : name ? data.contaminants.filter(c=>normalizeText(c.name)===normalizeText(name)) : cas && !['NA','NS'].includes(cas.toUpperCase()) ? data.contaminants.filter(c=>c.cas===cas) : [];
      if (matches.length !== 1) throw new Error('No unique contaminant matched. Use contaminant_id or an exact source name.');
      const contaminant=matches[0];
      const rawUnit=get(row,'unit','units','soil_unit') || DEFAULT_SOIL_UNIT;
      const unit=LAB_UNITS.find(u=>u.category==='soil' && normalizeText(u.label.replace(/[µμ]/g,'u'))===normalizeText(rawUnit.replace(/[µμ]/g,'u'))) || LAB_UNITS.find(u=>u.category==='soil' && u.id===rawUnit);
      if (!unit) throw new Error('Unsupported soil concentration unit.');
      const rawQualifier=get(row,'qualifier','detection_qualifier').toLowerCase();
      if (rawQualifier && !['detected','non_detect','nd','u'].includes(rawQualifier)) throw new Error('Use detected or non_detect as the qualifier.');
      const qualifier=['non_detect','nd','u'].includes(rawQualifier) ? 'non_detect' : 'detected';
      if (qualifier === 'detected' && !rawValue) throw new Error('Detected results need a value.');
      const result={contaminantId:contaminant.id,value:qualifier==='detected' ? rawValue : '',unit:unit.label,qualifier,reportingLimit:qualifier==='non_detect' ? (rawRL || rawValue) : ''};
      const hierarchyColumns = column('sample','sample_name','sample_id') >= 0;
      let apec,location,sample;
      if (!hierarchyColumns) {
        const samples=getSoilSamples({apecs});
        if (samples.length > 1) throw new Error('This CSV has no sample identifier. Add area and sample columns.');
        if (samples.length===1) ({apec,location,sample}=samples[0]);
        else {
          apec=resolveRecord(apecs,'','Imported legacy results','a',{description:'Sample identity not supplied.',locations:[]});
          location=resolveRecord(apec.locations,'','Unassigned location','l',{type:'Unknown',samples:[]});
          sample=resolveRecord(location.samples,'','Imported sample','s',{date:'',results:[]});
        }
      } else {
        const apecId=get(row,'apec_id'),apecName=get(row,'apec','apec_name');
        const locationId=get(row,'location_id'),locationName=get(row,'location','location_name','borehole');
        const sampleId=get(row,'sample_id'),sampleName=get(row,'sample','sample_name');
        if (!(apecId||apecName) || !(sampleId||sampleName)) throw new Error('Each row needs an area and sample identifier.');
        apec=resolveRecord(apecs,apecId,apecName,'a',{description:'',locations:[]});
        if(locationId||locationName) location=resolveRecord(apec.locations,locationId,locationName,'l',{type:get(row,'location_type') || 'Borehole',samples:[]});
        else {
          const matches=apec.locations.filter(l=>l.samples.some(s=>sampleId?s.id===sampleId:s.name.toLowerCase()===sampleName.toLowerCase()));
          if(matches.length>1) throw new Error('Sample name is ambiguous in this area; use its stable sample_id.');
          location=matches[0] || apec.locations[0] || resolveRecord(apec.locations,'','Samples','l',{type:'',samples:[]});
        }
        sample=resolveRecord(location.samples,sampleId,sampleName,'s',{date:'',results:[]});
      }
      for(const [property,names] of [['date',['sample_date']]]) {
        const value=get(row,...names);
        if(value) {
          if(hasConcentration(sample[property]) && (property==='date' ? String(sample[property])!==value : Number(sample[property])!==Number(value))) throw new Error(`Conflicting ${property} for sample ${sample.name}.`);
          sample[property]=value;
        }
      }
      const key=`${sample.id}/${contaminant.id}`;
      if(duplicates.has(key)) throw new Error('Duplicate sample/contaminant row. Import one analytical result per sample and contaminant.');
      duplicates.add(key);
      const prior=sample.results.findIndex(r=>r.contaminantId===contaminant.id);
      if(prior>=0) sample.results[prior]=result; else sample.results.push(result);
      selectedIds.add(contaminant.id);
      entries.push({row:index+2,apec:apec.name,location:location.name,sample:sample.name,contaminant:contaminant.name,value:qualifier==='non_detect' ? `< ${result.reportingLimit}` : rawValue,unit:unit.label});
    } catch(error) { errors.push({row:index+2,message:error.message}); }
  });
  try { validateSampleData(apecs); } catch(error) { errors.push({row:'Data',message:error.message}); }
  return {apecs,selectedIds:[...selectedIds],entries,errors};
}

function applySampleImport(data, preview) {
  if (preview.errors.length || !preview.entries.length) throw new Error('Resolve CSV errors before applying the import.');
  validateSampleData(preview.apecs);
  const profile=getActiveProfile();
  const saved=new Map(profile.selectedContaminants.map(c=>[c.id,c]));
  const selectedContaminants=preview.selectedIds.map(id=>saved.get(id) || normalizeSelectedContaminant(data.contaminants.find(c=>c.id===id)));
  return updateActiveProfileData({apecs:preview.apecs,selectedContaminants});
}

function formatRatio(ratio) { return Number.isFinite(ratio) ? formatNumber(Number(ratio.toPrecision(3))) : "—"; }
