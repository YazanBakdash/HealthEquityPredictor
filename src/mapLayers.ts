/**
 * Map choropleth layers: simulated ADI plus each column from public/all_tract_features.csv
 * (same schema as inputs_processed/all_tract_features*.csv).
 */
export const ALL_TRACT_FEATURES_CSV_URL = '/all_tract_features.csv';

export type MapLayerId =
  | 'adi'
  | 'Affordable_Housing'
  | 'Tree_Canopy'
  | 'Parks'
  | 'Transit_Stop'
  | 'Bike_Miles'
  | 'Wifi_Hotspots'
  | 'School_Density'
  | 'Library_Count'
  | 'Small_Business'
  | 'Grocery_Store';

export type LayerMeta = {
  id: MapLayerId;
  label: string;
  /** Short legend subtitle */
  subtitle: string;
  /** d3 sequential interpolator (resolved in App with d3) */
  colorRamp:
    | 'ylgn'
    | 'blues'
    | 'viridis'
    | 'oranges'
    | 'purples'
    | 'reds'
    | 'greens'
    | 'greys'
    | 'teal'
    | 'magma';
  /** Suffix for tooltip / legend max label */
  unit: string;
  decimals: number;
};

export const MAP_LAYER_ORDER: LayerMeta[] = [
  { id: 'adi', label: 'ADI', subtitle: 'Simulated outcome (policy sliders)', colorRamp: 'ylgn', unit: '', decimals: 1 },
  {
    id: 'Affordable_Housing',
    label: 'Affordable housing',
    subtitle: 'Subsidized units per 1,000 residents (0.5 mi buffer)',
    colorRamp: 'blues',
    unit: ' / 1k',
    decimals: 1,
  },
  {
    id: 'Tree_Canopy',
    label: 'Tree canopy',
    subtitle: 'Percentage of tract area covered by tree canopy',
    colorRamp: 'ylgn',
    unit: '%',
    decimals: 1,
  },
  {
    id: 'Parks',
    label: 'Parks',
    subtitle: 'Park acreage per sq mi (0.25 mi buffer)',
    colorRamp: 'greens',
    unit: ' ac/mi\u00B2',
    decimals: 1,
  },
  {
    id: 'Transit_Stop',
    label: 'Transit stops',
    subtitle: 'CTA bus + Metra stops per 10,000 residents (0.5 mi buffer)',
    colorRamp: 'purples',
    unit: ' / 10k',
    decimals: 0,
  },
  {
    id: 'Bike_Miles',
    label: 'Bike miles',
    subtitle: 'Protected bike + trail miles per sq mi (0.25 mi buffer)',
    colorRamp: 'oranges',
    unit: ' mi/mi\u00B2',
    decimals: 1,
  },
  {
    id: 'Wifi_Hotspots',
    label: 'Wi\u2011Fi hotspots',
    subtitle: 'Public Wi-Fi hotspots per sq mi (0.5 mi buffer)',
    colorRamp: 'teal',
    unit: ' / mi\u00B2',
    decimals: 1,
  },
  {
    id: 'School_Density',
    label: 'Schools',
    subtitle: 'Public K-12 schools per 10,000 residents (0.5 mi buffer)',
    colorRamp: 'blues',
    unit: ' / 10k',
    decimals: 0,
  },
  {
    id: 'Library_Count',
    label: 'Libraries',
    subtitle: 'Public library branches per 10,000 residents (1 mi buffer)',
    colorRamp: 'blues',
    unit: ' / 10k',
    decimals: 0,
  },
  {
    id: 'Small_Business',
    label: 'Small business',
    subtitle: 'Active business licenses per 1,000 residents',
    colorRamp: 'viridis',
    unit: ' / 1k',
    decimals: 1,
  },
  {
    id: 'Grocery_Store',
    label: 'Grocery access',
    subtitle: 'Retail food / grocery licenses per 1,000 residents',
    colorRamp: 'reds',
    unit: ' / 1k',
    decimals: 1,
  },
];

/** Parse all_tract_features.csv → tract id → numeric row (NaN for empty cells). */
export function parseTractFeaturesCsv(text: string): Map<string, Record<string, number>> {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return new Map();

  const headers = lines[0].split(',').map((h) => h.trim());
  const tractCol = headers.indexOf('census_tract');
  if (tractCol < 0) return new Map();

  const out = new Map<string, Record<string, number>>();

  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(',');
    if (cols.length < headers.length) continue;
    const tractId = cols[tractCol]?.trim();
    if (!tractId) continue;

    const row: Record<string, number> = {};
    for (let j = 0; j < headers.length; j++) {
      if (j === tractCol) continue;
      const key = headers[j];
      const raw = (cols[j] ?? '').trim();
      row[key] = raw === '' ? Number.NaN : Number(raw);
    }
    out.set(tractId, row);
  }

  return out;
}

export function layerMeta(id: MapLayerId): LayerMeta | undefined {
  return MAP_LAYER_ORDER.find((l) => l.id === id);
}
