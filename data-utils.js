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

function getStoredArray(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch (error) {
    return [];
  }
}

function getStoredObject(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (error) {
    return {};
  }
}

function getStoredSiteInfo() {
  const saved = getStoredObject('siteInfo');
  const proposedLandUse = saved.proposedLandUse || saved.thresholdLandUse || '';
  const currentLandUse = saved.currentLandUse || '';
  const nearWater = saved.nearWater === true || saved.waterBody === 'yes';

  return {
    currentLandUse,
    currentLandUseLabel: saved.currentLandUseLabel || LAND_USE_LABELS[currentLandUse] || '',
    proposedLandUse,
    proposedLandUseLabel: saved.proposedLandUseLabel || saved.thresholdLandUseLabel || LAND_USE_LABELS[proposedLandUse] || '',
    nearWater,
    waterBodyLabel: saved.waterBodyLabel || (nearWater ? 'Within 500 m' : 'Greater than 500 m')
  };
}

function getUnitDef(unitId) {
  return LAB_UNITS.find((unit) => unit.id === unitId) || LAB_UNITS.find((unit) => unit.id === DEFAULT_LAB_UNIT);
}

function getAvailableUnits(nearWater) {
  return LAB_UNITS.filter((unit) => nearWater || unit.category === 'soil');
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

function getContaminantBySavedItem(data, item) {
  if (!item) return null;
  const id = item.id || item.contaminantId;
  const name = item.name || item.substance;

  return data.contaminants.find((contaminant) => {
    return contaminant.id === id || contaminant.name === name;
  }) || null;
}

function getSelectedContaminants(data) {
  return getStoredArray('selectedContaminants')
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

  localStorage.setItem('selectedContaminants', JSON.stringify(selected));
}

function getCategoryEntries(data, siteInfo) {
  return Object.entries(data.contaminantCategories).filter(([_, category]) => {
    return !siteInfo.proposedLandUse || category.relevantLandUse.includes(siteInfo.proposedLandUse);
  });
}
