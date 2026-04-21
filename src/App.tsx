import { useState, useMemo, useEffect, useRef } from 'react';
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
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as d3 from 'd3';
import { INITIAL_POLICY_AREAS, BASE_LIFE_EXPECTANCY } from './constants';
import {
  ALL_TRACT_FEATURES_CSV_URL,
  MAP_LAYER_ORDER,
  parseTractFeaturesCsv,
  layerMeta,
  type MapLayerId,
  type LayerMeta,
} from './mapLayers';

const CHICAGO_GEOJSON_URL = '/census_tracts.json';

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
  if (!Number.isFinite(v)) return '—';
  const meta = layerMeta(layerId);
  const d = meta?.decimals ?? 1;
  return `${v.toFixed(d)}${meta?.unit ?? ''}`;
}

const getTractColor = (tractId: string, globalParams: Record<string, number>, overrides: Record<string, Record<string, number>>) => {
  let outcome = BASE_LIFE_EXPECTANCY;
  const tractOverrides = overrides[tractId] || {};
  
  INITIAL_POLICY_AREAS.forEach(area => {
    area.parameters.forEach(p => {
      const currentValue = tractOverrides[p.id] !== undefined ? tractOverrides[p.id] : globalParams[p.id];
      const diff = currentValue - p.value;
      outcome += diff * p.impact;
    });
  });
  
  // Deterministic base variation based on tract ID
  const hash = tractId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const baseVariation = (hash % 16) - 8; // -8 to +8 range
  const finalVal = outcome + baseVariation;

  if (finalVal < 72) return '#BA1A1A';
  if (finalVal < 76) return '#E98D8D';
  if (finalVal < 80) return '#AEC7F7';
  return '#4EDEA3';
};

// D3 Map Component moved outside App to prevent zoom reset on re-render
const D3Map = ({ 
  data, 
  width, 
  height, 
  hoveredTract, 
  setHoveredTract, 
  selectedTractId,
  setSelectedTractId,
  setMousePos,
  fillForTract,
}: { 
  data: any, 
  width: number, 
  height: number,
  hoveredTract: any,
  setHoveredTract: (t: any) => void,
  selectedTractId: string | null,
  setSelectedTractId: (id: string | null) => void,
  setMousePos: (p: { x: number, y: number }) => void,
  fillForTract: (tractId: string) => string,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState(d3.zoomIdentity);

  const projection = useMemo(() => {
    // The GeoJSON uses projected coordinates (State Plane Illinois East)
    // We use geoIdentity with reflectY to fit it into our SVG
    try {
      return d3.geoIdentity()
        .reflectY(true)
        .fitSize([width - 40, height - 40], data);
    } catch (e) {
      console.error('Projection error:', e);
      return d3.geoMercator();
    }
  }, [data, width, height]);

  const pathGenerator = useMemo(() => {
    return d3.geoPath().projection(projection);
  }, [projection]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event) => {
        setTransform(event.transform);
      });

    svg.call(zoomBehavior);
    
    // Reset zoom only when dimensions change
    svg.call(zoomBehavior.transform, d3.zoomIdentity);
  }, [width, height]);

  if (!data || !data.features || data.features.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        No map data available
      </div>
    );
  }

  return (
    <svg 
      ref={svgRef}
      width={width} 
      height={height} 
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full cursor-move touch-none"
      onClick={(e) => {
        // Clear selection if clicking on background
        if (e.target === svgRef.current) {
          setSelectedTractId(null);
        }
      }}
    >
      <g transform={transform.toString()}>
        <g transform="translate(20, 20)">
          {data.features.map((feature: any, i: number) => {
            const props = feature.properties;
            // Use CENSUS_T_1 or CENSUS_TRA from the new GeoJSON
            const tractId = String(props.CENSUS_T_1 || props.CENSUS_TRA || i);
            const color = fillForTract(tractId);
            const isHovered = hoveredTract && (
              (hoveredTract.CENSUS_T_1 && hoveredTract.CENSUS_T_1 === props.CENSUS_T_1) || 
              (hoveredTract.CENSUS_TRA && hoveredTract.CENSUS_TRA === props.CENSUS_TRA)
            );
            const isSelected = selectedTractId === tractId;

            const d = pathGenerator(feature);
            if (!d) return null;

            return (
              <path
                key={i}
                d={d}
                fill={color}
                stroke={isSelected ? "#4F46E5" : "white"}
                strokeWidth={isSelected ? 3 / transform.k : isHovered ? 2 / transform.k : 0.5 / transform.k}
                fillOpacity={isSelected || isHovered ? 1 : 0.8}
                className="transition-colors duration-200 cursor-pointer hover:stroke-primary"
                onMouseEnter={() => setHoveredTract(props)}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredTract(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTractId(tractId);
                }}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
};

export default function App() {
  const [currentAreaId, setCurrentAreaId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    INITIAL_POLICY_AREAS.forEach(area => {
      area.parameters.forEach(p => {
        initial[p.id] = p.value;
      });
    });
    return initial;
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const [geoData, setGeoData] = useState<any>(null);
  const [hoveredTract, setHoveredTract] = useState<any>(null);
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null);
  const [tractOverrides, setTractOverrides] = useState<Record<string, Record<string, number>>>({});
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isLoadingMap, setIsLoadingMap] = useState(true);
  const [mapLayerId, setMapLayerId] = useState<MapLayerId>('adi');
  const [tractFeatures, setTractFeatures] = useState<Map<string, Record<string, number>> | null>(null);
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(true);

  useEffect(() => {
    setIsLoadingMap(true);
    fetch(CHICAGO_GEOJSON_URL)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setGeoData(data);
        setIsLoadingMap(false);
      })
      .catch(err => {
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
    if (mapLayerId === 'adi' || !tractFeatures) return null;
    const vals: number[] = [];
    tractFeatures.forEach((row) => {
      const v = row[mapLayerId];
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    });
    if (vals.length === 0) return [0, 1];
    const lo = d3.min(vals) ?? 0;
    const hi = d3.max(vals) ?? 1;
    if (lo === hi) return [lo - 1e-9, hi + 1e-9];
    return [lo, hi];
  }, [mapLayerId, tractFeatures]);

  const featureColorScale = useMemo(() => {
    if (mapLayerId === 'adi' || !featureExtent || !activeLayerMeta) return null;
    const interp = interpolatorFromRamp(activeLayerMeta.colorRamp);
    return d3.scaleSequential(interp).domain(featureExtent);
  }, [mapLayerId, featureExtent, activeLayerMeta]);

  const fillForTract = useMemo(() => {
    if (mapLayerId === 'adi') {
      return (tractId: string) => getTractColor(tractId, parameterValues, tractOverrides);
    }
    if (!tractFeatures || !featureColorScale) {
      return () => '#cbd5e1';
    }
    return (tractId: string) => {
      const row = tractFeatures.get(tractId);
      const v = row?.[mapLayerId];
      if (typeof v !== 'number' || !Number.isFinite(v)) return '#cbd5e1';
      return featureColorScale(v);
    };
  }, [mapLayerId, tractFeatures, featureColorScale, parameterValues, tractOverrides]);

  const currentArea = useMemo(() => 
    INITIAL_POLICY_AREAS.find(a => a.id === currentAreaId) || null
  , [currentAreaId]);

  const predictedOutcome = useMemo(() => {
    let outcome = BASE_LIFE_EXPECTANCY;
    INITIAL_POLICY_AREAS.forEach(area => {
      area.parameters.forEach(p => {
        const currentValue = parameterValues[p.id];
        const diff = currentValue - p.value;
        outcome += diff * p.impact;
      });
    });
    return outcome;
  }, [parameterValues]);

  const outcomeDiff = useMemo(() => 
    predictedOutcome - BASE_LIFE_EXPECTANCY
  , [predictedOutcome]);

  const handleParamChange = (id: string, value: number) => {
    if (selectedTractId) {
      setTractOverrides(prev => ({
        ...prev,
        [selectedTractId]: {
          ...(prev[selectedTractId] || {}),
          [id]: value
        }
      }));
    } else {
      setParameterValues(prev => ({ ...prev, [id]: value }));
    }
  };

  const getTractOutcomeValue = (tractId: string) => {
    let outcome = BASE_LIFE_EXPECTANCY;
    const overrides = tractOverrides[tractId] || {};
    
    INITIAL_POLICY_AREAS.forEach(area => {
      area.parameters.forEach(p => {
        const currentValue = overrides[p.id] !== undefined ? overrides[p.id] : parameterValues[p.id];
        const diff = currentValue - p.value;
        outcome += diff * p.impact;
      });
    });
    
    const hash = tractId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const baseVariation = (hash % 16) - 8;
    return outcome + baseVariation;
  };

  const currentOutcome = useMemo(() => {
    if (selectedTractId) {
      return getTractOutcomeValue(selectedTractId);
    }
    return predictedOutcome;
  }, [selectedTractId, tractOverrides, parameterValues, predictedOutcome]);

  const currentOutcomeDiff = useMemo(() => 
    currentOutcome - BASE_LIFE_EXPECTANCY
  , [currentOutcome]);

  const handleRunSimulation = () => {
    setIsSimulating(true);
    setTimeout(() => setIsSimulating(false), 1500);
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
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tighter text-primary font-headline">
            Policy Intel Chicago
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-sm font-semibold text-secondary hover:text-primary transition-colors flex items-center gap-1.5 mr-2">
            <History className="w-4 h-4" />
            My Simulations
          </button>
          <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-primary/10">
            <img 
              alt="User Profile" 
              className="w-full h-full object-cover" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCI8HS98aCUhoCgKzqOOmuUeISpwAMPDVpKwTg9bjBClJYDvmmo-VQEH1pQz5wmFknnhwKtVUNu3tJT9O9nyV8VARbu7LqoEYXB62qRt14iWAc30xGADQ5pquXjCBimPAs9Oroq3hMzk57xdZSOck1lA0B3qbMtG6WVBLmcN7_RilE2T1OOXuyA0MhfrkiomPiaLOJ_ZwEvWt8UTes0Zs0d-oynwS4cGppsD0Q31eydZyH3igehtNMg7esFHxbqnOiN2A-rC4YjFbQi"
              referrerPolicy="no-referrer"
            />
          </div>
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
                  {INITIAL_POLICY_AREAS.map(area => (
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
                    {currentArea?.parameters.map(param => {
                      const value = (selectedTractId && tractOverrides[selectedTractId]?.[param.id] !== undefined)
                        ? tractOverrides[selectedTractId][param.id]
                        : parameterValues[param.id];
                      
                      return (
                        <div key={param.id} className="policy-item">
                          <div className="flex justify-between mb-2">
                            <label className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                              {param.name}
                            </label>
                            <span className="text-xs font-bold text-primary">
                              {value}{param.unit}
                            </span>
                          </div>
                          <input 
                            type="range" 
                            min={param.min} 
                            max={param.max} 
                            value={value}
                            onChange={(e) => handleParamChange(param.id, parseInt(e.target.value))}
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
                        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
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
            <div className="bg-primary rounded-lg text-white p-4 shadow-lg border border-primary/20 py-6">
              <div className="flex flex-col">
                <h3 className="text-[8px] font-bold uppercase tracking-[0.2em] mb-1 opacity-70">
                  {selectedTractId ? `Tract ${selectedTractId} Outcome` : 'City-Wide Outcome'}
                </h3>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold font-headline tracking-tighter">
                    {currentOutcome.toFixed(1)}
                  </span>
                  <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded">
                    <TrendingUp className={`w-3 h-3 ${currentOutcomeDiff >= 0 ? 'text-success' : 'text-error'}`} />
                    <span className={`text-xs font-bold font-headline ${currentOutcomeDiff >= 0 ? 'text-success' : 'text-error'}`}>
                      {currentOutcomeDiff >= 0 ? '+' : ''}{currentOutcomeDiff.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-[9px] font-medium opacity-60 mt-1">
                  Average ADI
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
                />
              )}
            </div>
            
            {/* Map UI Overlays */}
            <div className="absolute inset-0 pointer-events-none flex flex-col">
              {/* Feature tabs — one per column in all_tract_features.csv + ADI */}
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
                {mapLayerId === 'adi' ? (
                  <>
                    <h4 className="text-[10px] font-bold text-secondary uppercase mb-3 tracking-widest">
                      ADI (Area Deprivation Index)
                    </h4>
                    <div className="flex flex-col gap-2">
                      {[
                        { color: 'bg-error', label: '68 - 72' },
                        { color: 'bg-[#E98D8D]', label: '72 - 76' },
                        { color: 'bg-[#AEC7F7]', label: '76 - 80' },
                        { color: 'bg-success', label: '80 - 84+' },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-sm ${item.color}`} />
                          <span className="text-[11px] font-semibold text-on-surface">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : activeLayerMeta && featureExtent ? (
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
                          const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => interp(t)).join(', ');
                          return `linear-gradient(to right, ${stops})`;
                        })(),
                      }}
                    />
                    <div className="flex justify-between text-[10px] font-semibold text-on-surface tabular-nums">
                      <span>
                        {formatLayerValue(mapLayerId, featureExtent[0])}
                      </span>
                      <span>
                        {formatLayerValue(mapLayerId, featureExtent[1])}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <div className="w-3 h-3 rounded-sm bg-slate-300 border border-slate-400/50" />
                      <span className="text-[10px] text-secondary">No data</span>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-secondary">Load tract features CSV to see this layer.</p>
                )}
              </div>

              {/* Floating Tooltip (Hover State) */}
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
                      transform: 'translateY(-100%)'
                    }}
                    className="glass-panel px-4 py-3 rounded-lg shadow-2xl border border-white/40 flex flex-col gap-1 min-w-[180px] pointer-events-none z-[100]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">Tract {hoveredTract.CENSUS_TRA || hoveredTract.CENSUS_T_1}</span>
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] text-secondary">
                        {activeLayerMeta?.label ?? mapLayerId}
                      </span>
                      <span className="text-sm font-bold text-on-surface">
                        {(() => {
                          const tid = String(hoveredTract.CENSUS_T_1 || hoveredTract.CENSUS_TRA || '');
                          if (mapLayerId === 'adi') {
                            return getTractOutcomeValue(tid).toFixed(1);
                          }
                          const v = tractFeatures?.get(tid)?.[mapLayerId];
                          return formatLayerValue(mapLayerId, typeof v === 'number' ? v : Number.NaN);
                        })()}
                      </span>
                    </div>
                    {mapLayerId === 'adi' && (
                      <div className="w-full bg-surface-container h-1 rounded-full mt-1 overflow-hidden">
                        <motion.div 
                          initial={{ width: "40%" }}
                          animate={{ width: "60%" }}
                          className="bg-primary h-full" 
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </div>

            {/* Simulation Overlay */}
            <AnimatePresence>
              {(isSimulating || isLoadingMap || isLoadingFeatures) && (
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
