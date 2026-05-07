import { supabase } from '../lib/supabaseClient';
import type {
  Simulation,
  SimulationRow,
  SimulationGeometry,
  SimulationGeometryRow,
  SimulationFeatureRow,
  GeometryInput,
  SliderOverrides,
} from './simulationTypes';
import { normalizeTractId } from '../tractId';

const FLASK_URL =
  import.meta.env.VITE_FLASK_API_URL?.trim() || 'http://127.0.0.1:5000';

/** PostgREST default row cap per request; simulation_geometry can exceed this. */
const SUPABASE_PAGE_SIZE = 1000;

type FlaskFeatureRow = {
  census_tract: string;
  tree_canopy?: number | null;
  affordable_housing?: number | null;
  parks?: number | null;
  transit_stop?: number | null;
  bike_miles?: number | null;
  wifi_hotspots?: number | null;
  school_density?: number | null;
  library_count?: number | null;
  small_business?: number | null;
  food_access?: number | null;
  predicted_adi?: number | null;
};

type FlaskRecalculateResponse = {
  features: FlaskFeatureRow[];
  geometry?: Record<string, unknown>[];
  partial?: boolean;
};

/**
 * Flask jsonify / Postgres DECIMAL values often arrive as JSON strings; Supabase JS may do the same.
 */
function finiteCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Rows returned by Flask after persisting simulation_geometry */
function mapApiGeometryRow(raw: Record<string, unknown>): GeometryInput {
  const ft = raw.feature_type;
  if (ft !== 'bike_trail' && ft !== 'park' && ft !== 'school' && ft !== 'library') {
    throw new Error(`Unknown feature_type in geometry response: ${String(ft)}`);
  }
  return {
    dbId: typeof raw.id === 'string' ? raw.id : String(raw.id),
    feature_type: ft,
    lat: finiteCoordinate(raw.lat),
    lon: finiteCoordinate(raw.lon),
    geometry: (raw.geometry as GeometryInput['geometry']) ?? undefined,
    userPlaced: false,
  };
}

export function simulationGeometryToInput(g: SimulationGeometry): GeometryInput {
  return {
    dbId: g.id,
    feature_type: g.featureType,
    lat: finiteCoordinate(g.lat),
    lon: finiteCoordinate(g.lon),
    geometry: g.geometry ?? undefined,
    userPlaced: false,
  };
}

function geometryPayloadForApi(items: GeometryInput[]): Omit<GeometryInput, 'dbId' | 'clientKey' | 'userPlaced'>[] {
  return items.map(({ feature_type, lat, lon, geometry }) => ({
    feature_type,
    lat,
    lon,
    geometry,
  }));
}

function toFiniteOrNull(value: unknown): number | null {
  const n = finiteCoordinate(value);
  return n === undefined ? null : n;
}

function mapFlaskFeatureRow(row: FlaskFeatureRow): SimulationFeatureRow {
  return {
    census_tract: normalizeTractId(row.census_tract),
    tree_canopy: toFiniteOrNull(row.tree_canopy),
    affordable_housing: toFiniteOrNull(row.affordable_housing),
    parks: toFiniteOrNull(row.parks),
    transit_stop: toFiniteOrNull(row.transit_stop),
    bike_miles: toFiniteOrNull(row.bike_miles),
    wifi_hotspots: toFiniteOrNull(row.wifi_hotspots),
    school_density: toFiniteOrNull(row.school_density),
    library_count: toFiniteOrNull(row.library_count),
    small_business: toFiniteOrNull(row.small_business),
    food_access: toFiniteOrNull(row.food_access),
    predicted_adi: toFiniteOrNull(row.predicted_adi),
  };
}

function mapSimulationRow(row: SimulationRow): Simulation {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGeometryRow(row: SimulationGeometryRow): SimulationGeometry {
  return {
    id: row.id,
    simulationId: row.simulation_id,
    featureType: row.feature_type,
    lat: finiteCoordinate(row.lat) ?? null,
    lon: finiteCoordinate(row.lon) ?? null,
    geometry: row.geometry,
    createdAt: row.created_at,
  };
}

export async function createSimulation(
  userId: string,
  name: string,
): Promise<Simulation> {
  const { data, error } = await supabase
    .from('simulations')
    .insert({ user_id: userId, name })
    .select()
    .single();

  if (error) throw error;
  return mapSimulationRow(data as SimulationRow);
}

export async function listSimulations(): Promise<Simulation[]> {
  const { data, error } = await supabase
    .from('simulations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as SimulationRow[]).map(mapSimulationRow);
}

export async function getSimulation(id: string): Promise<Simulation | null> {
  const { data, error } = await supabase
    .from('simulations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapSimulationRow(data as SimulationRow);
}

export async function updateSimulationName(id: string, name: string): Promise<Simulation> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name cannot be empty.');

  const { data, error } = await supabase
    .from('simulations')
    .update({ name: trimmed })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return mapSimulationRow(data as SimulationRow);
}

export async function deleteSimulation(id: string): Promise<void> {
  const { error } = await supabase.from('simulations').delete().eq('id', id);
  if (error) throw error;
}

export async function getSimulationFeatures(
  simulationId: string,
): Promise<SimulationFeatureRow[]> {
  const all: SimulationFeatureRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('simulation_features')
      .select('*')
      .eq('simulation_id', simulationId)
      .order('id', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    const batch = (data ?? []) as SimulationFeatureRow[];
    all.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

export async function getSimulationGeometry(
  simulationId: string,
): Promise<SimulationGeometry[]> {
  const all: SimulationGeometryRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('simulation_geometry')
      .select('*')
      .eq('simulation_id', simulationId)
      .order('id', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    const batch = (data ?? []) as SimulationGeometryRow[];
    all.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all.map(mapGeometryRow);
}

/** Slider tweaks only: does not send geometry; server returns rows for overridden tracts only. */
export async function recalculateSliders(
  simulationId: string,
  sliderOverrides: SliderOverrides,
): Promise<{ features: SimulationFeatureRow[]; partial: true }> {
  const response = await fetch(`${FLASK_URL}/recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      slider_overrides: sliderOverrides,
    }),
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(async () => ({ error: await response.text().catch(() => '') }));
    throw new Error(err.error || `Recalculation failed (${response.status})`);
  }

  const result = (await response.json()) as FlaskRecalculateResponse;
  const featRows = Array.isArray(result.features) ? result.features : [];
  return {
    features: featRows.map(mapFlaskFeatureRow),
    partial: true,
  };
}

/** Geometry changed (markers, bike trails, etc.): sends full geometry payload + optional sliders. */
export async function recalculateWithGeometry(
  simulationId: string,
  geometry: GeometryInput[],
  sliderOverrides: SliderOverrides,
): Promise<{ features: SimulationFeatureRow[]; geometry: GeometryInput[]; partial: false }> {
  const response = await fetch(`${FLASK_URL}/recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      geometry: geometryPayloadForApi(geometry),
      slider_overrides: sliderOverrides,
    }),
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(async () => ({ error: await response.text().catch(() => '') }));
    throw new Error(err.error || `Recalculation failed (${response.status})`);
  }

  const result = (await response.json()) as FlaskRecalculateResponse;
  const featRows = Array.isArray(result.features) ? result.features : [];
  const geoRows = Array.isArray(result.geometry)
    ? result.geometry.map((r) => mapApiGeometryRow(r))
    : [];
  return {
    features: featRows.map(mapFlaskFeatureRow),
    geometry: geoRows,
    partial: false,
  };
}

export async function addGeometryPoint(
  simulationId: string,
  payload: { feature_type: 'library' | 'school'; lat: number; lon: number },
  sliderOverrides: SliderOverrides,
): Promise<{ features: SimulationFeatureRow[]; geometry: GeometryInput[]; partial: true }> {
  const response = await fetch(`${FLASK_URL}/geometry_point`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      feature_type: payload.feature_type,
      lat: payload.lat,
      lon: payload.lon,
      slider_overrides: sliderOverrides,
    }),
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(async () => ({ error: await response.text().catch(() => '') }));
    throw new Error(err.error || `Add point failed (${response.status})`);
  }

  const result = (await response.json()) as FlaskRecalculateResponse;
  const featRows = Array.isArray(result.features) ? result.features : [];
  const geoRows = Array.isArray(result.geometry)
    ? result.geometry.map((r) => mapApiGeometryRow(r))
    : [];
  return {
    features: featRows.map(mapFlaskFeatureRow),
    geometry: geoRows,
    partial: true,
  };
}

export async function removeGeometryPoint(
  simulationId: string,
  geometryRowId: string,
  sliderOverrides: SliderOverrides,
): Promise<{ features: SimulationFeatureRow[]; partial: true }> {
  const response = await fetch(`${FLASK_URL}/geometry_point/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      id: geometryRowId,
      slider_overrides: sliderOverrides,
    }),
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(async () => ({ error: await response.text().catch(() => '') }));
    throw new Error(err.error || `Remove point failed (${response.status})`);
  }

  const result = (await response.json()) as FlaskRecalculateResponse;
  const featRows = Array.isArray(result.features) ? result.features : [];
  return {
    features: featRows.map(mapFlaskFeatureRow),
    partial: true,
  };
}

export async function seedSchoolLibraryGeometry(
  simulationId: string,
): Promise<{ features: SimulationFeatureRow[]; geometry: GeometryInput[] }> {
  const response = await fetch(`${FLASK_URL}/seed_school_library_geometry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simulation_id: simulationId }),
  });

  if (!response.ok) {
    const err = await response
      .json()
      .catch(async () => ({ error: await response.text().catch(() => '') }));
    throw new Error(err.error || `Seed geometry failed (${response.status})`);
  }

  const result = (await response.json()) as FlaskRecalculateResponse;
  const featRows = Array.isArray(result.features) ? result.features : [];
  const geoRows = Array.isArray(result.geometry)
    ? result.geometry.map((r) => mapApiGeometryRow(r))
    : [];
  return {
    features: featRows.map(mapFlaskFeatureRow),
    geometry: geoRows,
  };
}
