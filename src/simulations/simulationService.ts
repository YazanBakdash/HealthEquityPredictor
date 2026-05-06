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

const FLASK_URL =
  import.meta.env.VITE_FLASK_API_URL?.trim() || 'http://127.0.0.1:5000';

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
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Recalculation failed (${response.status})`);
  }

  const result = await response.json();
  return result.features as SimulationFeatureRow[];
}
