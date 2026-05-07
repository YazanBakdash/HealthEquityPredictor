import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  History,
  TrendingUp,
  User,
  Save,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as d3 from 'd3';
import D3Map, { EXCLUDED_TRACTS, tractIdFromProps } from './D3Map';
import { normalizeTractId } from './tractId';
import {
  ALL_TRACT_FEATURES_CSV_URL,
  MAP_LAYER_ORDER,
  layerMeta,
  parseTractFeaturesCsv,
  type MarkerPoint,
  type LayerMeta,
  type MapLayerId,
} from './mapLayers';
import { useAuth } from './auth/AuthProvider';
import {
  getSimulationFeatures,
  getSimulationGeometry,
  recalculate,
} from './simulations/simulationService';
import type { GeometryInput, SimulationFeatureRow } from './simulations/simulationTypes';

const CHICAGO_GEOJSON_URL = '/census_tracts.json';

/** Snap to slider steps so thumb position matches min/max/step and labels. */
function snapRangeValue(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const steps = Math.round((value - min) / step);
  const snapped = min + steps * step;
  return Math.min(max, Math.max(min, snapped));
}

/** Minimum slider upper bound when CSV has no usable values for a layer. */
const ADJUSTABLE_LAYER_SPEC: Partial<
  Record<MapLayerId, { min: number; step: number; unit: string; label: string; fallbackMax: number }>
> = {
  Affordable_Housing: { min: 0, step: 0.5, unit: ' / 1k', label: 'Affordable Housing', fallbackMax: 50 },
  Tree_Canopy: { min: 0, step: 1, unit: '%', label: 'Tree Canopy Coverage', fallbackMax: 100 },
  Parks: { min: 0, step: 5, unit: ' ac/mi²', label: 'Park Acreage', fallbackMax: 500 },
  Small_Business: { min: 0, step: 0.5, unit: ' / 1k', label: 'Small Businesses', fallbackMax: 50 },
  Wifi_Hotspots: { min: 0, step: 0.5, unit: ' / mi²', label: 'Wi-Fi Hotspots', fallbackMax: 20 },
  Food_Access: { min: 0, step: 0.5, unit: ' / 1k', label: 'Food Access', fallbackMax: 20 },
  Transit_Stop: { min: 0, step: 1, unit: ' / 10k', label: 'Transit Stops', fallbackMax: 100 },
};

/** Strictly greater than the largest observed tract value, snapped to the step grid above it. */
function sliderDatasetCeiling(dataMax: number, min: number, step: number, fallbackMax: number): number {
  if (!Number.isFinite(dataMax)) return fallbackMax;
  const clamped = Math.max(dataMax, min);
  const k = Math.floor((clamped - min) / step);
  let ceiling = min + (k + 1) * step;
  if (ceiling <= clamped) ceiling += step;
  return ceiling;
}

function interpolatorFromRamp(ramp: LayerMeta['colorRamp']) {
  switch (ramp) {
    case 'ylgn':
      return d3.interpolateYlGn;
    case 'blues':
      return d3.interpolateBlues;
    case 'viridis':
      return d3.interpolateViridis;
    case 'oranges':
      return d3.interpolateOranges;
    case 'purples':
      return d3.interpolatePurples;
    case 'reds':
      return d3.interpolateReds;
    case 'greens':
      return d3.interpolateGreens;
    case 'greys':
      return d3.interpolateGreys;
    case 'teal':
      return d3.interpolatePuBuGn;
    case 'magma':
      return d3.interpolateMagma;
    default:
      return d3.interpolateBlues;
  }
}

function formatLayerValue(layerId: MapLayerId, v: number): string {
  if (!Number.isFinite(v)) return '-';
  const meta = layerMeta(layerId);
  const decimals = meta?.decimals ?? 1;
  return `${v.toFixed(decimals)}${meta?.unit ?? ''}`;
}

function FeatureHistogram({
  tractFeatures,
  layerId,
  extent,
  colorRamp,
  selectedTractId,
}: {
  tractFeatures: Map<string, Record<string, number>>;
  layerId: MapLayerId;
  extent: [number, number];
  colorRamp: LayerMeta['colorRamp'];
  selectedTractId: string | null;
}) {
  const NUM_BINS = 20;
  const W = 220;
  const H = 80;

  const { bins, maxCount, selectedBinIdx } = useMemo(() => {
    const [lo, hi] = extent;
    const binWidth = (hi - lo) / NUM_BINS;
    const counts = new Array(NUM_BINS).fill(0);
    let selIdx = -1;

    const selNorm = selectedTractId ? normalizeTractId(selectedTractId) : null;
    tractFeatures.forEach((row, tractId) => {
      const v = row[layerId];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      let idx = Math.floor((v - lo) / binWidth);
      if (idx >= NUM_BINS) idx = NUM_BINS - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
      if (selNorm != null && normalizeTractId(tractId) === selNorm) selIdx = idx;
    });

    return {
      bins: counts,
      maxCount: Math.max(...counts, 1),
      selectedBinIdx: selIdx,
    };
  }, [tractFeatures, layerId, extent, selectedTractId]);

  const interp = interpolatorFromRamp(colorRamp);
  const barWidth = W / NUM_BINS;

  return (
    <svg width={W} height={H + 16} className="block">
      {bins.map((count, i) => {
        const barH = (count / maxCount) * H;
        const t = i / (NUM_BINS - 1);
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={H - barH}
            width={barWidth - 1}
            height={barH}
            fill={interp(t)}
            opacity={selectedBinIdx === i ? 1 : 0.7}
            stroke={selectedBinIdx === i ? '#002B5C' : 'none'}
            strokeWidth={selectedBinIdx === i ? 1.5 : 0}
            rx={1}
          />
        );
      })}
      <text x={0} y={H + 12} fontSize={9} fill="#505F76">
        {formatLayerValue(layerId, extent[0])}
      </text>
      <text x={W} y={H + 12} fontSize={9} fill="#505F76" textAnchor="end">
        {formatLayerValue(layerId, extent[1])}
      </text>
    </svg>
  );
}

export default function SimulatorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const simulationId = searchParams.get('simulationId');

  const [geoData, setGeoData] = useState<any>(null);
  const [hoveredTract, setHoveredTract] = useState<any>(null);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isLoadingMap, setIsLoadingMap] = useState(true);
  const [mapLayerId, setMapLayerId] = useState<MapLayerId>('adi');
  const [showSatellite, setShowSatellite] = useState(false);
  const [tractFeatures, setTractFeatures] = useState<Map<string, Record<string, number>> | null>(null);
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(true);
  const [bikeMiles, setBikeMiles] = useState<{x: number, y: number}[]>([]);
  const isBikeMilesLayer = mapLayerId === 'Bike_Miles';
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const isSchoolLayer = mapLayerId === 'School_Density';
  const isLibraryLayer = mapLayerId === 'Library_Count';
  const isMarkerLayer = isSchoolLayer || isLibraryLayer;

  const tractSliderCeilings = useMemo(() => {
    const m = new Map<MapLayerId, number>();
    if (!tractFeatures) return m;
    for (const layerId of Object.keys(ADJUSTABLE_LAYER_SPEC) as MapLayerId[]) {
      const spec = ADJUSTABLE_LAYER_SPEC[layerId];
      if (!spec) continue;
      let maxV = -Infinity;
      tractFeatures.forEach((row) => {
        const v = row[layerId];
        if (typeof v === 'number' && Number.isFinite(v)) maxV = Math.max(maxV, v);
      });
      const ceiling =
        maxV === -Infinity
          ? spec.fallbackMax
          : sliderDatasetCeiling(maxV, spec.min, spec.step, spec.fallbackMax);
      m.set(layerId, ceiling);
    }
    return m;
  }, [tractFeatures]);

  const [layerAdjustments, setLayerAdjustments] = useState<Record<string, number>>({});
  const isAdjustableLayer = mapLayerId in ADJUSTABLE_LAYER_SPEC;
  const activeAdjustableSpec = ADJUSTABLE_LAYER_SPEC[mapLayerId];

  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  // Geometry items accumulated for the current simulation (in lat/lon)
  const [geometryItems, setGeometryItems] = useState<GeometryInput[]>([]);

  const selectedTractIdRef = useRef<string | null>(selectedTractId);
  const layerAdjustmentsRef = useRef(layerAdjustments);
  selectedTractIdRef.current = selectedTractId;
  layerAdjustmentsRef.current = layerAdjustments;

  const snapshotSliderOverrides = useCallback((): Record<string, Record<string, number>> => {
    const tid = selectedTractIdRef.current;
    const adj = layerAdjustmentsRef.current;
    if (!tid || Object.keys(adj).length === 0) return {};
    const normalizedTractId = normalizeTractId(tid);
    const cleaned: Record<string, number> = {};
    for (const [featureKey, value] of Object.entries(adj)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        cleaned[featureKey] = value;
      }
    }
    if (Object.keys(cleaned).length === 0) return {};
    return { [normalizedTractId]: cleaned };
  }, []);

  /** Map + histogram use this: baseline/API rows plus pending slider values for the selected tract. */
  const displayTractFeatures = useMemo(() => {
    if (!tractFeatures) return null;
    const tid = selectedTractId ? normalizeTractId(selectedTractId) : null;
    const adjEntries = Object.entries(layerAdjustments).filter(
      ([, v]) => typeof v === 'number' && Number.isFinite(v),
    );
    if (!tid || adjEntries.length === 0) return tractFeatures;

    const next = new Map(tractFeatures);
    const base = next.get(tid);
    if (!base) return tractFeatures;

    const merged: Record<string, number> = { ...base };
    for (const [k, v] of adjEntries) {
      merged[k] = v;
    }
    next.set(tid, merged);
    return next;
  }, [tractFeatures, selectedTractId, layerAdjustments]);

  // Load GeoJSON tract boundaries
  useEffect(() => {
    setIsLoadingMap(true);
    fetch(CHICAGO_GEOJSON_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const filtered = {
          ...data,
          features: Array.isArray(data?.features)
            ? data.features.filter((feature: any) => {
                const tractId = tractIdFromProps(feature?.properties ?? {});
                return !EXCLUDED_TRACTS.has(tractId);
              })
            : [],
        };
        setGeoData(filtered);
        setIsLoadingMap(false);
      })
      .catch((err) => {
        console.error('Failed to load GeoJSON:', err);
        setIsLoadingMap(false);
      });
  }, []);

  // Load baseline tract features CSV
  useEffect(() => {
    setIsLoadingFeatures(true);
    fetch(ALL_TRACT_FEATURES_CSV_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Features CSV: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        setTractFeatures(parseTractFeaturesCsv(text));
        setIsLoadingFeatures(false);
      })
      .catch((err) => {
        console.error('Failed to load tract features:', err);
        setTractFeatures(null);
        setIsLoadingFeatures(false);
      });
  }, []);

// Seed existing school/library markers from baseline CSV
useEffect(() => {
  if (!tractFeatures || !geoData) return;

  const existingMarkers: MarkerPoint[] = [];

  geoData.features.forEach((feature: any) => {
    const tractId = tractIdFromProps(feature?.properties ?? {});
    const row = tractFeatures.get(tractId);
    if (!row) return;

    const geom = feature.geometry;
    const ring =
      geom?.type === 'Polygon'
        ? geom.coordinates[0]
        : geom?.type === 'MultiPolygon'
        ? geom.coordinates[0][0]
        : null;
    if (!ring) return;

    const lons = ring.map((c: number[]) => c[0]);
    const lats = ring.map((c: number[]) => c[1]);
    const cLon = lons.reduce((a: number, b: number) => a + b, 0) / lons.length;
    const cLat = lats.reduce((a: number, b: number) => a + b, 0) / lats.length;

    const schoolCount = Math.max(0, Math.round(Number(row['School_Density']) || 0));
    for (let i = 0; i < schoolCount; i++) {
      existingMarkers.push({
        id: `existing-school-${tractId}-${i}`,
        lat: cLat + (Math.random() - 0.5) * 0.004,
        lon: cLon + (Math.random() - 0.5) * 0.004,
        type: 'school',
        existing: true,
      });
    }

    const libCount = Math.max(0, Math.round(Number(row['Library_Count']) || 0));
    for (let i = 0; i < libCount; i++) {
      existingMarkers.push({
        id: `existing-library-${tractId}-${i}`,
        lat: cLat + (Math.random() - 0.5) * 0.004,
        lon: cLon + (Math.random() - 0.5) * 0.004,
        type: 'library',
        existing: true,
      });
    }
  });

  setMarkers((prev) => [
    ...existingMarkers,
    ...prev.filter((m) => !m.existing), // keep any user-added markers
  ]);
}, [tractFeatures, geoData]);

  // If simulationId present, load existing simulation features to overlay
  useEffect(() => {
    if (!simulationId) return;
    let isMounted = true;

    (async () => {
      try {
        const [features, geoRows] = await Promise.all([
          getSimulationFeatures(simulationId),
          getSimulationGeometry(simulationId),
        ]);

        if (!isMounted) return;

        if (features.length > 0) {
          applySimulationFeatures(features);
        }

        const items: GeometryInput[] = geoRows.map((g) => ({
          feature_type: g.featureType,
          lat: g.lat ?? undefined,
          lon: g.lon ?? undefined,
          geometry: g.geometry ?? undefined,
        }));
        setGeometryItems(items);
      } catch (err) {
        if (isMounted) {
          setRecalcError(err instanceof Error ? err.message : 'Failed to load simulation data.');
        }
      }
    })();

    return () => { isMounted = false; };
  }, [simulationId]);

  // Apply simulation_features rows to the tractFeatures map
  const applySimulationFeatures = useCallback((rows: SimulationFeatureRow[]) => {
    setTractFeatures((prev) => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const row of rows) {
        const tid = normalizeTractId(row.census_tract);
        const existing = next.get(tid) ?? {};
        const updated: Record<string, number> = { ...existing };
        if (row.tree_canopy != null) updated['Tree_Canopy'] = row.tree_canopy;
        if (row.affordable_housing != null) updated['Affordable_Housing'] = row.affordable_housing;
        if (row.parks != null) updated['Parks'] = row.parks;
        if (row.transit_stop != null) updated['Transit_Stop'] = row.transit_stop;
        if (row.bike_miles != null) updated['Bike_Miles'] = row.bike_miles;
        if (row.wifi_hotspots != null) updated['Wifi_Hotspots'] = row.wifi_hotspots;
        if (row.school_density != null) updated['School_Density'] = row.school_density;
        if (row.library_count != null) updated['Library_Count'] = row.library_count;
        if (row.small_business != null) updated['Small_Business'] = row.small_business;
        if (row.food_access != null) updated['Food_Access'] = row.food_access;
        if (row.predicted_adi != null) updated['adi'] = row.predicted_adi;
        next.set(tid, updated);
      }
      return next;
    });
  }, []);

  // Trigger recalculation via Flask API
  const triggerRecalculate = useCallback(async (
    geoItems: GeometryInput[],
    sliderOverrides: Record<string, Record<string, number>>,
  ) => {
    if (!simulationId) {
      setRecalcError('No simulation selected. Create one from My Simulations first.');
      return;
    }

    setIsRecalculating(true);
    setRecalcError(null);

    try {
      const features = await recalculate(simulationId, geoItems, sliderOverrides);
      applySimulationFeatures(features);
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : 'Recalculation failed.');
    } finally {
      setIsRecalculating(false);
    }
  }, [simulationId, applySimulationFeatures]);

  // Callback: marker placed on map (already in lat/lon from D3Map)
  const handleMarkerPlaced = useCallback((lat: number, lon: number, type: 'school' | 'library') => {
    setGeometryItems((prev) => {
      const newItem: GeometryInput = { feature_type: type, lat, lon };
      const updated = [...prev, newItem];
      void triggerRecalculate(updated, snapshotSliderOverrides());
      return updated;
    });
  }, [triggerRecalculate, snapshotSliderOverrides]);

  // Callback: bike trail drawn (coordinates in [lon, lat] format)
  const handleBikeTrailDrawn = useCallback((coordinates: [number, number][]) => {
    setGeometryItems((prev) => {
      const newItem: GeometryInput = {
        feature_type: 'bike_trail',
        geometry: { type: 'LineString', coordinates },
      };
      const updated = [...prev, newItem];
      void triggerRecalculate(updated, snapshotSliderOverrides());
      return updated;
    });
  }, [triggerRecalculate, snapshotSliderOverrides]);

  // When slider changes, trigger recalculate after a debounce
  const sliderTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!selectedTractId || Object.keys(layerAdjustments).length === 0) return;
    if (!simulationId) return;

    if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current);
    sliderTimerRef.current = setTimeout(() => {
      triggerRecalculate(geometryItems, snapshotSliderOverrides());
    }, 350);

    return () => { if (sliderTimerRef.current) clearTimeout(sliderTimerRef.current); };
  }, [
    layerAdjustments,
    selectedTractId,
    simulationId,
    geometryItems,
    triggerRecalculate,
    snapshotSliderOverrides,
  ]);

  // Overrides apply to the selected tract only — clear when selection changes.
  useEffect(() => {
    setLayerAdjustments({});
  }, [selectedTractId]);

  const activeLayerMeta = useMemo(() => layerMeta(mapLayerId), [mapLayerId]);

  const featureExtent = useMemo((): [number, number] | null => {
    if (!displayTractFeatures) return null;
    const vals: number[] = [];
    displayTractFeatures.forEach((row) => {
      const v = row[mapLayerId];
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    });
    if (vals.length === 0) return [0, 1];
    const lo = d3.min(vals) ?? 0;
    vals.sort((a, b) => a - b);
    const p95Idx = Math.floor(vals.length * 0.95);
    const hi = vals[Math.min(p95Idx, vals.length - 1)];
    if (lo === hi) return [lo - 1e-9, hi + 1e-9];
    return [lo, hi];
  }, [mapLayerId, displayTractFeatures]);

  /** City-wide mean for the active adjustable layer (legend text only). */
  const adjustableLayerCityMean = useMemo(() => {
    if (!tractFeatures || !isAdjustableLayer || !activeAdjustableSpec) return null;
    const vals: number[] = [];
    tractFeatures.forEach((row) => {
      const v = row[mapLayerId];
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    });
    const mean = d3.mean(vals);
    return mean != null && Number.isFinite(mean) ? mean : null;
  }, [tractFeatures, isAdjustableLayer, mapLayerId, activeAdjustableSpec]);

  const featureColorScale = useMemo(() => {
    if (!featureExtent || !activeLayerMeta) return null;
    const interp = interpolatorFromRamp(activeLayerMeta.colorRamp);
    return d3.scaleSequential(interp).domain(featureExtent);
  }, [activeLayerMeta, featureExtent, mapLayerId]);

  const fillForTract = useMemo(() => {
    if (!displayTractFeatures || !featureColorScale) {
      return () => '#cbd5e1';
    }
    return (tractId: string) => {
      const row = displayTractFeatures.get(tractId);
      const v = row?.[mapLayerId];
      if (typeof v !== 'number' || !Number.isFinite(v)) return '#cbd5e1';
      return featureColorScale(v);
    };
  }, [featureColorScale, mapLayerId, displayTractFeatures]);

  const ADI_NATIONAL_AVG = 100;

  const getTractAdi = (tractId: string): number | null => {
    const v = tractFeatures?.get(normalizeTractId(tractId))?.['adi'];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const currentAdi = useMemo(() => {
    if (selectedTractId) return getTractAdi(selectedTractId);
    if (!tractFeatures) return null;
    let sum = 0;
    let count = 0;
    tractFeatures.forEach((row) => {
      const v = row['adi'];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }, [selectedTractId, tractFeatures]);

  const currentAdiDiff = useMemo(
    () => (currentAdi != null ? currentAdi - ADI_NATIONAL_AVG : null),
    [currentAdi],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Redirect to My Simulations if no simulationId
  if (!simulationId && !isLoadingMap) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface gap-6">
        <h1 className="text-2xl font-bold text-primary">No simulation selected</h1>
        <p className="text-secondary">Create or open a simulation from the My Simulations page.</p>
        <button
          onClick={() => navigate('/my-simulations')}
          className="px-5 py-3 bg-primary text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
        >
          Go to My Simulations
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <nav className="fixed top-0 w-full flex justify-between items-center px-6 h-16 bg-white/80 backdrop-blur-md border-b border-outline-variant/20 shadow-sm z-50">
        <button
          onClick={() => navigate('/')}
          className="text-xl font-bold tracking-tighter text-primary font-headline hover:opacity-80 transition-opacity"
        >
          Policy Intel Chicago
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/my-simulations')}
            className="text-sm font-semibold text-secondary hover:text-primary transition-colors flex items-center gap-1.5 mr-2"
          >
            <History className="w-4 h-4" />
            My Simulations
          </button>
          <button
            onClick={() => navigate(user ? '/profile' : '/auth')}
            className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors cursor-pointer"
            title={user ? 'Profile' : 'Sign in'}
          >
            <User className="w-4 h-4 text-primary" />
          </button>
        </div>
      </nav>

      <div className="flex flex-1 pt-16">
        {/* Left Sidebar — Feature layer selector */}
        <aside className="fixed left-0 w-56 h-[calc(100vh-64px)] bg-surface-container-low flex flex-col p-4 z-40 border-r border-outline-variant/20">
          <div className="flex-1 overflow-y-auto">
            {/* ADI quick-access button */}
            <button
              type="button"
              onClick={() => setMapLayerId('adi')}
              className={`w-full mb-3 px-3 py-2.5 rounded-lg font-semibold text-sm text-left transition-all duration-200 flex items-center gap-3 ${
                mapLayerId === 'adi'
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${mapLayerId === 'adi' ? 'bg-white' : 'bg-primary'}`} />
              ADI (Output)
            </button>

            <h2 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] opacity-60 px-1 mb-2">
              Input Features
            </h2>
            <div className="flex flex-col gap-0.5">
              {MAP_LAYER_ORDER.filter((l) => l.id !== 'adi').map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => setMapLayerId(layer.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 group text-left ${
                    mapLayerId === layer.id
                      ? 'bg-white text-primary shadow-sm font-semibold'
                      : 'text-secondary hover:bg-white hover:text-primary hover:shadow-sm'
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      mapLayerId === layer.id ? 'ring-2 ring-primary/30' : ''
                    }`}
                    style={{
                      backgroundColor: interpolatorFromRamp(layer.colorRamp)(0.6),
                    }}
                  />
                  <span className="text-sm">{layer.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="ml-56 mr-72 flex-1 p-6 bg-surface">

        {/* Right Panel — ADI output + distribution */}
        <aside className="fixed right-0 top-16 w-72 h-[calc(100vh-64px)] bg-surface-container-low flex flex-col p-4 z-40 border-l border-outline-variant/20 overflow-y-auto">
          {/* ADI Outcome */}
          <button
            type="button"
            onClick={() => setMapLayerId('adi')}
            className={`w-full rounded-xl p-5 shadow-lg transition-all mb-4 ${
              mapLayerId === 'adi'
                ? 'bg-primary text-white ring-2 ring-primary/40'
                : 'bg-primary/90 text-white hover:bg-primary hover:ring-2 hover:ring-primary/30'
            }`}
          >
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-80">
                  {selectedTractId
                    ? `Tract ${selectedTractId} ADI`
                    : 'City-Wide Average ADI'}
                </h3>
                {mapLayerId !== 'adi' && (
                  <span className="text-[8px] font-bold bg-white/20 px-1.5 py-0.5 rounded">
                    View on map
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-4xl font-extrabold font-headline tracking-tighter">
                  {currentAdi != null ? currentAdi.toFixed(1) : '—'}
                </span>
                {currentAdiDiff != null && (
                  <div className="flex items-center gap-1 bg-white/15 px-2.5 py-1 rounded-lg">
                    <TrendingUp
                      className={`w-3.5 h-3.5 ${currentAdiDiff <= 0 ? 'text-success' : 'text-red-300'}`}
                    />
                    <span
                      className={`text-sm font-bold font-headline ${currentAdiDiff <= 0 ? 'text-success' : 'text-red-300'}`}
                    >
                      {currentAdiDiff >= 0 ? '+' : ''}
                      {currentAdiDiff.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[10px] font-medium opacity-60 mt-1.5">
                Area Deprivation Index · vs national avg (100)
              </p>
            </div>
          </button>

          {/* Distribution histogram */}
          {displayTractFeatures && featureExtent && (
            <div className="bg-white rounded-xl p-4 border border-outline-variant/20 shadow-sm mb-4">
              <h3 className="text-[10px] font-bold text-secondary uppercase tracking-[0.15em] mb-3">
                {activeLayerMeta?.label ?? 'Layer'} Distribution
              </h3>
              <FeatureHistogram
                tractFeatures={displayTractFeatures}
                layerId={mapLayerId}
                extent={featureExtent}
                colorRamp={activeLayerMeta?.colorRamp ?? 'blues'}
                selectedTractId={selectedTractId}
              />
              {activeLayerMeta && (
                <p className="text-[10px] text-secondary mt-2 leading-snug">
                  {activeLayerMeta.subtitle}
                </p>
              )}
            </div>
          )}

          {/* Selected tract info + slider */}
          {selectedTractId && (
            <div className="bg-white rounded-xl p-4 border border-outline-variant/20 shadow-sm mb-4">
              <h3 className="text-[10px] font-bold text-secondary uppercase tracking-[0.15em] mb-2">
                Selected Tract
              </h3>
              <p className="text-lg font-bold text-primary font-headline">{selectedTractId}</p>
              {tractFeatures?.get(normalizeTractId(selectedTractId)) && (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-secondary">ADI</span>
                    <span className="font-semibold text-on-surface">
                      {formatLayerValue('adi', tractFeatures.get(normalizeTractId(selectedTractId))!['adi'])}
                    </span>
                  </div>
                  {mapLayerId !== 'adi' && !isAdjustableLayer && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-secondary">{activeLayerMeta?.label ?? mapLayerId}</span>
                      <span className="font-semibold text-on-surface">
                        {formatLayerValue(mapLayerId, tractFeatures.get(normalizeTractId(selectedTractId))![mapLayerId])}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Adjustable slider — max strictly above city-wide tract maximum */}
              {isAdjustableLayer && activeAdjustableSpec && (() => {
                const spec = activeAdjustableSpec;
                const sliderMax =
                  tractSliderCeilings.get(mapLayerId) ?? spec.fallbackMax;
                const tid = normalizeTractId(selectedTractId);
                const row = tractFeatures?.get(tid);
                const tractRaw = row?.[mapLayerId];
                const fallback =
                  adjustableLayerCityMean ?? (spec.min + sliderMax) / 2;
                const baseVal =
                  typeof tractRaw === 'number' && Number.isFinite(tractRaw)
                    ? tractRaw
                    : fallback;
                const rawAdj = layerAdjustments[mapLayerId];
                const adjusted = Number.isFinite(rawAdj) ? rawAdj! : baseVal;
                const sliderValue = snapRangeValue(
                  Math.min(sliderMax, Math.max(spec.min, adjusted)),
                  spec.min,
                  sliderMax,
                  spec.step,
                );
                const dec = spec.step < 1 ? 1 : 0;
                return (
                <div className="mt-4 pt-3 border-t border-outline-variant/20">
                  <div className="flex justify-between mb-1">
                    <label className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                      {spec.label}
                    </label>
                    <span className="text-xs font-bold text-primary">
                      {sliderValue.toFixed(dec)}
                      {spec.unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={spec.min}
                    max={sliderMax}
                    step={spec.step}
                    value={sliderValue}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const snapped = snapRangeValue(v, spec.min, sliderMax, spec.step);
                      setLayerAdjustments((prev) => ({
                        ...prev,
                        [mapLayerId]: snapped,
                      }));
                    }}
                    className="sim-range w-full block"
                  />
                  <div className="flex justify-between text-[9px] text-secondary mt-1">
                    <span>{spec.min}{spec.unit}</span>
                    <span>{sliderMax.toFixed(spec.step < 1 ? 1 : 0)}{spec.unit}</span>
                  </div>
                  {adjustableLayerCityMean != null && (
                    <p className="text-[9px] text-secondary mt-1.5 leading-snug">
                      City average {adjustableLayerCityMean.toFixed(dec)}
                      {spec.unit}
                    </p>
                  )}
                </div>
                );
              })()}

              <button
                onClick={() => setSelectedTractId(null)}
                className="mt-3 text-[10px] font-bold text-secondary hover:text-primary underline"
              >
                Deselect
              </button>
            </div>
          )}

          {/* Recalculation status */}
          {recalcError && (
            <div className="rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs font-semibold text-error mb-4">
              {recalcError}
            </div>
          )}
        </aside>

          <header className="mb-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-primary">
              Simulation
            </h1>
            {!simulationId && (
              <p className="text-sm text-secondary mt-1">
                Create a simulation from My Simulations to enable recalculation.
              </p>
            )}
          </header>

          <div
            ref={containerRef}
            className="h-[calc(100vh-160px)] min-h-[500px] relative rounded-xl overflow-hidden bg-surface-container shadow-inner border border-outline-variant/10"
          >
            {/* D3 SVG Map */}
            <div className="w-full h-full flex items-center justify-center bg-slate-50">
              {geoData && (
                <D3Map
                  data={geoData}
                  width={dimensions.width || 800}
                  height={dimensions.height || 600}
                  hoveredTract={hoveredTract}
                  setHoveredTract={setHoveredTract}
                  selectedTractId={selectedTractId}
                  setSelectedTractId={setSelectedTractId}
                  setMousePos={setMousePos}
                  fillForTract={fillForTract}
                  showSatellite={showSatellite}
                  bikeMiles={bikeMiles}
                  setBikeMiles={setBikeMiles}
                  isBikeMilesLayer={isBikeMilesLayer}
                  isDrawingMode={isDrawingMode}
                  setIsDrawingMode={setIsDrawingMode}
                  markers={markers}
                  setMarkers={setMarkers}
                  isMarkerLayer={isMarkerLayer}
                  showSchoolMarkers={isSchoolLayer}
                  showLibraryMarkers={isLibraryLayer}
                  markerType={isSchoolLayer ? 'school' : isLibraryLayer ? 'library' : null}
                  onMarkerPlaced={handleMarkerPlaced}
                  onBikeTrailDrawn={handleBikeTrailDrawn}
                />
              )}
            </div>

            {/* Map UI Overlays */}
            <div className="absolute inset-0 pointer-events-none flex flex-col">
              <div className="flex-1 relative pointer-events-none">
                {/* Legend */}
                <div className="absolute bottom-6 left-6 glass-panel p-4 rounded-lg shadow-xl border border-white/50 pointer-events-auto max-w-[260px]">
                  {activeLayerMeta && featureExtent ? (
                    <>
                      <h4 className="text-[10px] font-bold text-secondary uppercase mb-1 tracking-widest">
                        {activeLayerMeta.label}
                      </h4>
                      <p className="text-[10px] text-secondary mb-3 leading-snug">
                        {activeLayerMeta.subtitle}
                      </p>
                      <div
                        className="h-3 w-full rounded mb-2 border border-outline-variant/20"
                        style={{
                          background: (() => {
                            const interp = interpolatorFromRamp(activeLayerMeta.colorRamp);
                            const stops = [0, 0.25, 0.5, 0.75, 1]
                              .map((t) => interp(t))
                              .join(', ');
                            return `linear-gradient(to right, ${stops})`;
                          })(),
                        }}
                      />
                      <div className="flex justify-between text-[10px] font-semibold text-on-surface tabular-nums">
                        <span>{formatLayerValue(mapLayerId, featureExtent[0])}</span>
                        <span>{formatLayerValue(mapLayerId, featureExtent[1])}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <div className="w-3 h-3 rounded-sm bg-slate-300 border border-slate-400/50" />
                        <span className="text-[10px] text-secondary">No data</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-secondary">
                      Load tract features CSV to see this layer.
                    </p>
                  )}
                </div>

                {/* Satellite toggle */}
                <button
                  type="button"
                  onClick={() => setShowSatellite((s) => !s)}
                  className={`pointer-events-auto absolute top-4 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors ${
                    showSatellite
                      ? 'bg-slate-800 text-white border-slate-600'
                      : 'bg-white/95 text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {showSatellite ? 'Hide satellite' : 'Satellite'}
                </button>

                {isBikeMilesLayer && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsDrawingMode(s => !s)}
                    className={`pointer-events-auto absolute top-14 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors ${
                      isDrawingMode
                        ? 'bg-green-600 text-white border-green-700'
                        : 'bg-white/95 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {isDrawingMode ? 'Done drawing' : 'Add bike miles'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBikeMiles([]);
                      setGeometryItems((prev) => {
                        const next = prev.filter((g) => g.feature_type !== 'bike_trail');
                        void triggerRecalculate(next, snapshotSliderOverrides());
                        return next;
                      });
                    }}
                    className="pointer-events-auto absolute top-24 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors bg-white/95 text-red-500 border-red-300 hover:bg-red-50"
                  >
                    Clear
                  </button>
                </>
                )}

                {isMarkerLayer && (
                  <>
                    <div className="pointer-events-auto absolute top-14 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border bg-white/95 text-slate-700 border-slate-300">
                      {selectedTractId
                        ? (isSchoolLayer ? '🏫 Click map to add school' : '📚 Click map to add library')
                        : (isSchoolLayer ? '🏫 Select a tract first' : '📚 Select a tract first')
                      }
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const ft = isSchoolLayer ? 'school' : 'library';
                        setMarkers((m) => m.filter((p) => p.type !== ft || p.existing));
                        setGeometryItems((prev) => {
                          const next = prev.filter((g) => g.feature_type !== ft);
                          void triggerRecalculate(next, snapshotSliderOverrides());
                          return next;
                        });
                      }}
                      className="pointer-events-auto absolute top-24 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors bg-white/95 text-red-500 border-red-300 hover:bg-red-50"
                    >
                      Clear {isSchoolLayer ? 'schools' : 'libraries'}
                    </button>
                  </>
                )}

                {/* Floating Tooltip */}
                <AnimatePresence>
                  {hoveredTract && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      style={{
                        position: 'fixed',
                        top: mousePos.y - 10,
                        left: mousePos.x + 20,
                        transform: 'translateY(-100%)',
                      }}
                      className="glass-panel px-4 py-3 rounded-lg shadow-2xl border border-white/40 flex flex-col gap-1 min-w-[180px] pointer-events-none z-[100]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-primary">
                          Tract {tractIdFromProps(hoveredTract)}
                        </span>
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[10px] text-secondary">
                          {activeLayerMeta?.label ?? mapLayerId}
                        </span>
                        <span className="text-sm font-bold text-on-surface">
                          {(() => {
                            const tractId = tractIdFromProps(hoveredTract);
                            const v = displayTractFeatures?.get(tractId)?.[mapLayerId];
                            return formatLayerValue(
                              mapLayerId,
                              typeof v === 'number' ? v : Number.NaN,
                            );
                          })()}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Loading / Recalculating Overlay */}
            <AnimatePresence>
              {(isLoadingMap || isLoadingFeatures || isRecalculating) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-auto"
                >
                  <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      <Activity className="w-12 h-12 text-primary" />
                    </motion.div>
                    <span className="font-bold text-primary">
                      {isLoadingMap
                        ? 'Initializing Geospatial Data...'
                        : isLoadingFeatures
                          ? 'Loading tract feature layers...'
                          : 'Recalculating features...'}
                    </span>
                    {isRecalculating && (
                      <p className="text-xs text-secondary">This may take 5-15 seconds</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
