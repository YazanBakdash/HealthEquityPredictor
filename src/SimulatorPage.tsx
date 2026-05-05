import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Map as MapIcon,
  Activity,
  School,
  TreePine,
  Bus,
  ChevronRight,
  ArrowLeft,
  Play,
  History,
  TrendingUp,
  Info,
  User,
  Save,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as d3 from 'd3';
import { INITIAL_POLICY_AREAS } from './constants';
import D3Map, { EXCLUDED_TRACTS, tractIdFromProps } from './D3Map';
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
import { getSimulation, saveSimulation } from './simulations/simulationService';

const CHICAGO_GEOJSON_URL = '/census_tracts.json';
const POLICY_MODEL_VERSION = 'initial-policy-areas-v1';

const ADJUSTABLE_LAYERS: Partial<Record<MapLayerId, { min: number; max: number; step: number; unit: string; label: string }>> = {
  Tree_Canopy:   { min: 0,  max: 100, step: 1,   unit: '%',        label: 'Tree Canopy Coverage' },
  Parks:         { min: 0,  max: 500, step: 5,    unit: ' ac/mi²',  label: 'Park Acreage' },
  Small_Business:{ min: 0,  max: 50,  step: 0.5,  unit: ' / 1k',   label: 'Small Businesses' },
  Wifi_Hotspots: { min: 0,  max: 20,  step: 0.5,  unit: ' / mi²',  label: 'Wi-Fi Hotspots' },
  Grocery_Store: { min: 0,  max: 20,  step: 0.5,  unit: ' / 1k',   label: 'Grocery Stores' },
  Transit_Stop:  { min: 0,  max: 100, step: 1,    unit: ' / 10k',  label: 'Transit Stops' },
};

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


export default function SimulatorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const simulationId = searchParams.get('simulationId');

  const [currentAreaId, setCurrentAreaId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    INITIAL_POLICY_AREAS.forEach((area) => {
      area.parameters.forEach((p) => {
        initial[p.id] = p.value;
      });
    });
    return initial;
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const [geoData, setGeoData] = useState<any>(null);
  const [hoveredTract, setHoveredTract] = useState<any>(null);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null);
  const [tractOverrides, setTractOverrides] = useState<
    Record<string, Record<string, number>>
  >({});
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isLoadingMap, setIsLoadingMap] = useState(true);
  const [mapLayerId, setMapLayerId] = useState<MapLayerId>('adi');
  const [showSatellite, setShowSatellite] = useState(false);
  const [tractFeatures, setTractFeatures] = useState<Map<
    string,
    Record<string, number>
  > | null>(null);
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(true);
  const [bikeMiles, setBikeMiles] = useState<{x: number, y: number}[]>([]);
  const isBikeMilesLayer = mapLayerId === 'Bike_Miles'; 
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  const [markers, setMarkers] = useState<MarkerPoint[]>([]);
  const isSchoolLayer = mapLayerId === 'School_Density';
  const isLibraryLayer = mapLayerId === 'Library_Count';
  const isMarkerLayer = isSchoolLayer || isLibraryLayer;

  const [layerAdjustments, setLayerAdjustments] = useState<Record<string, number>>({});
  const isAdjustableLayer = mapLayerId in ADJUSTABLE_LAYERS;
  const activeAdjustable = ADJUSTABLE_LAYERS[mapLayerId];
  const [isSavingSimulation, setIsSavingSimulation] = useState(false);
  const [isLoadingSavedSimulation, setIsLoadingSavedSimulation] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

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

  const activeLayerMeta = useMemo(() => layerMeta(mapLayerId), [mapLayerId]);

  const featureExtent = useMemo((): [number, number] | null => {
    if (!tractFeatures) return null;
    const vals: number[] = [];
    tractFeatures.forEach((row) => {
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
  }, [mapLayerId, tractFeatures]);

  const featureColorScale = useMemo(() => {
    if (!featureExtent || !activeLayerMeta) return null;
    const interp = interpolatorFromRamp(activeLayerMeta.colorRamp);
    return d3.scaleSequential(interp).domain(featureExtent);
  }, [activeLayerMeta, featureExtent, mapLayerId]);

  const fillForTract = useMemo(() => {
    if (!tractFeatures || !featureColorScale) {
      return () => '#cbd5e1';
    }
    return (tractId: string) => {
      const row = tractFeatures.get(tractId);
      const v = row?.[mapLayerId];
      if (typeof v !== 'number' || !Number.isFinite(v)) return '#cbd5e1';
      return featureColorScale(v);
    };
  }, [featureColorScale, mapLayerId, tractFeatures]);

  const currentArea = useMemo(
    () => INITIAL_POLICY_AREAS.find((a) => a.id === currentAreaId) || null,
    [currentAreaId],
  );

  const handleParamChange = (id: string, value: number) => {
    if (selectedTractId) {
      setTractOverrides((prev) => ({
        ...prev,
        [selectedTractId]: { ...(prev[selectedTractId] || {}), [id]: value },
      }));
    } else {
      setParameterValues((prev) => ({ ...prev, [id]: value }));
    }
  };

  const ADI_NATIONAL_AVG = 100;

  const getTractAdi = (tractId: string): number | null => {
    const v = tractFeatures?.get(tractId)?.['adi'];
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
  const persistedOutcome = currentAdi ?? ADI_NATIONAL_AVG;
  const persistedOutcomeDiff = currentAdiDiff ?? 0;

  useEffect(() => {
    if (!simulationId) return;

    let isMounted = true;
    setIsLoadingSavedSimulation(true);
    setSimulationError(null);

    getSimulation(simulationId)
      .then((simulation) => {
        if (!isMounted) return;
        setParameterValues(simulation.parameterValues);
        setTractOverrides(simulation.tractOverrides);
        setSelectedTractId(simulation.selectedTractId);
        setMapLayerId(simulation.mapLayerId);
        setShowSatellite(simulation.showSatellite);
        setBikeMiles(simulation.bikeMiles);
        setMarkers(simulation.markers);
        setLayerAdjustments(simulation.layerAdjustments);
        setCurrentAreaId(null);
        setSaveMessage(`Loaded "${simulation.title}".`);
      })
      .catch((err) => {
        if (!isMounted) return;
        setSimulationError(
          err instanceof Error ? err.message : 'Failed to load saved simulation.',
        );
      })
      .finally(() => {
        if (isMounted) setIsLoadingSavedSimulation(false);
      });

    return () => {
      isMounted = false;
    };
  }, [simulationId]);

  const handleRunSimulation = () => {
    setIsSimulating(true);
    setTimeout(() => setIsSimulating(false), 1500);
  };

  const handleSaveSimulation = async () => {
    setSaveMessage(null);
    setSimulationError(null);

    if (!user) {
      const redirectTo = `${location.pathname}${location.search}`;
      navigate(`/auth?redirectTo=${encodeURIComponent(redirectTo)}`);
      return;
    }

    const defaultTitle = selectedTractId
      ? `Tract ${selectedTractId} simulation`
      : 'Citywide simulation';
    const title = window.prompt('Name this simulation', defaultTitle);
    if (title === null) return;

    setIsSavingSimulation(true);

    try {
      const saved = await saveSimulation(user.id, {
        title: title.trim() || defaultTitle,
        parameterValues,
        tractOverrides,
        selectedTractId,
        mapLayerId,
        showSatellite,
        bikeMiles,
        markers,
        layerAdjustments,
        baseLifeExpectancy: ADI_NATIONAL_AVG,
        predictedOutcome: persistedOutcome,
        currentOutcome: persistedOutcome,
        currentOutcomeDiff: persistedOutcomeDiff,
        policyModelVersion: POLICY_MODEL_VERSION,
      });
      setSaveMessage(`Saved "${saved.title}".`);
    } catch (err) {
      setSimulationError(err instanceof Error ? err.message : 'Failed to save simulation.');
    } finally {
      setIsSavingSimulation(false);
    }
  };

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Map': return <MapIcon className="w-5 h-5" />;
      case 'MedicalServices': return <Activity className="w-5 h-5" />;
      case 'School': return <School className="w-5 h-5" />;
      case 'Forest': return <TreePine className="w-5 h-5" />;
      case 'Bus': return <Bus className="w-5 h-5" />;
      default: return <Info className="w-5 h-5" />;
    }
  };

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
        {/* Sidebar */}
        <aside className="fixed left-0 w-64 h-[calc(100vh-64px)] bg-surface-container-low flex flex-col p-4 z-40 border-r border-outline-variant/20">
          <div className="flex-1 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {!selectedTractId ? (
                <motion.div
                  key="no-selection"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center justify-center h-full text-center px-4"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center mb-4">
                    <MapIcon className="w-6 h-6 text-primary/40" />
                  </div>
                  <h3 className="text-sm font-bold text-on-surface mb-2">No Tract Selected</h3>
                  <p className="text-xs text-secondary leading-relaxed">
                    Select a census tract on the map to adjust its specific policy parameters and see local impacts.
                  </p>
                </motion.div>
              ) : !currentAreaId ? (
                <motion.div
                  key="categories"
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  className="flex flex-col gap-1"
                >
                  
                  <div className="flex items-center justify-between px-3 mb-4">
                    <h2 className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] opacity-60">
                      Policy Areas
                    </h2>
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      Tract {selectedTractId}
                    </span>
                  </div>
                  {INITIAL_POLICY_AREAS.map((area) => (
                    <button
                      key={area.id}
                      onClick={() => setCurrentAreaId(area.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-secondary hover:bg-white hover:text-primary hover:shadow-sm rounded-lg cursor-pointer transition-all duration-200 group"
                    >
                      <span className="text-secondary group-hover:text-primary transition-colors">
                        {getIcon(area.icon)}
                      </span>
                      <span className="text-sm font-medium">{area.name}</span>
                      <ChevronRight className="w-4 h-4 ml-auto opacity-40 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                  <button
                    onClick={() => setSelectedTractId(null)}
                    className="mt-4 text-[10px] font-bold text-secondary hover:text-primary underline text-center"
                  >
                    Deselect Tract
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="parameters"
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 20, opacity: 0 }}
                  className="flex flex-col h-full"
                >
                  <button
                    onClick={() => setCurrentAreaId(null)}
                    className="flex items-center gap-2 mb-6 text-xs font-bold text-primary hover:opacity-70 transition-opacity"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back to Categories
                  </button>
                  <div className="flex items-center justify-between mb-6 px-1">
                    <h3 className="font-headline font-bold text-on-surface text-lg">
                      {currentArea?.name}
                    </h3>
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      Tract {selectedTractId}
                    </span>
                  </div>

                  <div className="space-y-6 px-1 flex-1 overflow-y-auto pb-4">
                    {currentArea?.parameters.map((param) => {
                      const value =
                        selectedTractId &&
                        tractOverrides[selectedTractId]?.[param.id] !== undefined
                          ? tractOverrides[selectedTractId][param.id]
                          : parameterValues[param.id];

                      return (
                        <div key={param.id} className="policy-item">
                          <div className="flex justify-between mb-2">
                            <label className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                              {param.name}
                            </label>
                            <span className="text-xs font-bold text-primary">
                              {value}
                              {param.unit}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={param.min}
                            max={param.max}
                            value={value}
                            onChange={(e) =>
                              handleParamChange(param.id, parseInt(e.target.value))
                            }
                            className="w-full h-1 bg-surface-container-high rounded-full appearance-none cursor-pointer accent-primary"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleRunSimulation}
                    disabled={isSimulating}
                    className="w-full mt-4 py-3 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:scale-100"
                  >
                    {isSimulating ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      >
                        <Activity className="w-4 h-4" />
                      </motion.div>
                    ) : (
                      <Play className="w-4 h-4 fill-current" />
                    )}
                    {isSimulating ? 'Processing...' : 'Run Simulation'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Persistent Outcome Card */}
          <div className="mt-auto pt-4 border-t border-outline-variant/20">

          {isAdjustableLayer && activeAdjustable && (
            <div className="mb-3 p-3 bg-white rounded-lg border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between mb-1">
                <label className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                  {activeAdjustable.label}
                  {selectedTractId && (
                    <span className="ml-1 text-primary normal-case font-normal">· 0.25mi</span>
                  )}
                </label>
                <span className="text-xs font-bold text-primary">
                  {(layerAdjustments[mapLayerId] ?? featureExtent?.[0] ?? 0).toFixed(
                    activeAdjustable.step < 1 ? 1 : 0
                  )}
                  {activeAdjustable.unit}
                </span>
              </div>
              <input
                type="range"
                min={activeAdjustable.min}
                max={activeAdjustable.max}
                step={activeAdjustable.step}
                value={layerAdjustments[mapLayerId] ?? featureExtent?.[0] ?? activeAdjustable.min}
                onChange={(e) =>
                  setLayerAdjustments(prev => ({
                    ...prev,
                    [mapLayerId]: parseFloat(e.target.value),
                  }))
                }
                className="w-full h-1 bg-surface-container-high rounded-full appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-[9px] text-secondary mt-1">
                <span>{activeAdjustable.min}{activeAdjustable.unit}</span>
                <span>{activeAdjustable.max}{activeAdjustable.unit}</span>
              </div>
            </div>
          )}
            <button
              onClick={handleRunSimulation}
              disabled={isSimulating}
              className="w-full mb-3 py-3 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:scale-100"
            >
              {isSimulating ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                >
                  <Activity className="w-4 h-4" />
                </motion.div>
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              {isSimulating ? 'Processing...' : 'Run Simulation'}
            </button>

            <div className="bg-primary rounded-lg text-white p-4 shadow-lg border border-primary/20 py-6">
              <div className="flex flex-col">
                <h3 className="text-[8px] font-bold uppercase tracking-[0.2em] mb-1 opacity-70">
                  {selectedTractId
                    ? `Tract ${selectedTractId} ADI`
                    : 'City-Wide Average ADI'}
                </h3>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold font-headline tracking-tighter">
                    {currentAdi != null ? currentAdi.toFixed(1) : '—'}
                  </span>
                  {currentAdiDiff != null && (
                    <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded">
                      <TrendingUp
                        className={`w-3 h-3 ${currentAdiDiff <= 0 ? 'text-success' : 'text-error'}`}
                      />
                      <span
                        className={`text-xs font-bold font-headline ${currentAdiDiff <= 0 ? 'text-success' : 'text-error'}`}
                      >
                        {currentAdiDiff >= 0 ? '+' : ''}
                        {currentAdiDiff.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[9px] font-medium opacity-60 mt-1">
                  vs national avg (100)
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="ml-64 flex-1 p-8 bg-surface">
          <header className="mb-8 flex justify-between items-end">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-primary">
                F2025 Plan
              </h1>
              {saveMessage && (
                <p className="text-sm font-semibold text-primary mt-2">{saveMessage}</p>
              )}
              {simulationError && (
                <p className="text-sm font-semibold text-error mt-2">{simulationError}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveSimulation}
                disabled={isSavingSimulation || isLoadingSavedSimulation}
                className="px-4 py-2.5 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 text-sm disabled:opacity-60 disabled:hover:scale-100"
              >
                <Save className="w-4 h-4" />
                {isSavingSimulation ? 'Saving...' : 'Save Simulation'}
              </button>
            </div>
          </header>

          <div
            ref={containerRef}
            className="h-[calc(100vh-200px)] min-h-[600px] relative rounded-xl overflow-hidden bg-surface-container shadow-inner border border-outline-variant/10"
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
                  markerType={isSchoolLayer ? 'school' : isLibraryLayer ? 'library' : null}
                />
              )}
            </div>

            {/* Map UI Overlays */}
            <div className="absolute inset-0 pointer-events-none flex flex-col">
              <div className="pointer-events-auto shrink-0 px-3 pt-3">
                <div className="flex gap-1 overflow-x-auto pb-1 rounded-lg border border-outline-variant/20 bg-white/95 shadow-sm backdrop-blur-sm max-w-full">
                  {MAP_LAYER_ORDER.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setMapLayerId(layer.id)}
                      className={`shrink-0 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap rounded-md transition-colors ${
                        mapLayerId === layer.id
                          ? layer.id === 'adi'
                            ? 'bg-primary text-white'
                            : 'bg-emerald-800 text-white'
                          : 'text-secondary hover:bg-slate-100'
                      }`}
                    >
                      {layer.id === 'Tree_Canopy' ? (
                        <span className="inline-flex items-center gap-1">
                          <TreePine className="w-3 h-3" />
                          {layer.label}
                        </span>
                      ) : (
                        layer.label
                      )}
                    </button>
                  ))}
                </div>
              </div>

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
                  className={`pointer-events-auto absolute top-14 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors ${
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
                    className={`pointer-events-auto absolute top-24 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors ${
                      isDrawingMode
                        ? 'bg-green-600 text-white border-green-700'
                        : 'bg-white/95 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {isDrawingMode ? 'Done drawing' : 'Add bike miles'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBikeMiles([])}
                    className="pointer-events-auto absolute top-36 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors bg-white/95 text-red-500 border-red-300 hover:bg-red-50"
                  >
                    Clear
                  </button>
                </>
                )}

                {isMarkerLayer && (
                  <>
                    <div className="pointer-events-auto absolute top-24 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border bg-white/95 text-slate-700 border-slate-300">
                      {selectedTractId
                        ? (isSchoolLayer ? '🏫 Click map to add school' : '📚 Click map to add library')
                        : (isSchoolLayer ? '🏫 Select a tract first' : '📚 Select a tract first')
                      }
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setMarkers(m => m.filter(p => p.type !== (isSchoolLayer ? 'school' : 'library')))
                      }
                      className="pointer-events-auto absolute top-36 right-4 z-20 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-md border transition-colors bg-white/95 text-red-500 border-red-300 hover:bg-red-50"
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
                            const v = tractFeatures?.get(tractId)?.[mapLayerId];
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

            {/* Simulation Overlay */}
            <AnimatePresence>
              {(isSimulating ||
                isLoadingMap ||
                isLoadingFeatures ||
                isLoadingSavedSimulation) && (
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
                          : isLoadingSavedSimulation
                            ? 'Loading saved simulation...'
                            : 'Recalculating Geospatial Data...'}
                    </span>
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
