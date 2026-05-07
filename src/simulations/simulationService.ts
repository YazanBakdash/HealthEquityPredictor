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
};

function toFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
    lat: row.lat,
    lon: row.lon,
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

export async function deleteSimulation(id: string): Promise<void> {
  const { error } = await supabase.from('simulations').delete().eq('id', id);
  if (error) throw error;
}

export async function getSimulationFeatures(
  simulationId: string,
): Promise<SimulationFeatureRow[]> {
  const { data, error } = await supabase
    .from('simulation_features')
    .select('*')
    .eq('simulation_id', simulationId);

  if (error) throw error;
  return (data ?? []) as SimulationFeatureRow[];
}

export async function getSimulationGeometry(
  simulationId: string,
): Promise<SimulationGeometry[]> {
  const { data, error } = await supabase
    .from('simulation_geometry')
    .select('*')
    .eq('simulation_id', simulationId);

  if (error) throw error;
  return ((data ?? []) as SimulationGeometryRow[]).map(mapGeometryRow);
}

export async function recalculate(
  simulationId: string,
  geometry: GeometryInput[],
  sliderOverrides: SliderOverrides,
): Promise<SimulationFeatureRow[]> {
  const response = await fetch(`${FLASK_URL}/recalculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      geometry,
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
  const rows = Array.isArray(result.features) ? result.features : [];
  return rows.map(mapFlaskFeatureRow);
}
