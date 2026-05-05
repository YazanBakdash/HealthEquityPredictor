import { supabase } from '../lib/supabaseClient';
import type {
  SavedSimulation,
  SimulationRow,
  SimulationSnapshot,
} from './simulationTypes';

function toNumber(value: number | string) {
  return typeof value === 'number' ? value : Number(value);
}

function mapRow(row: SimulationRow): SavedSimulation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    parameterValues: row.parameter_values,
    tractOverrides: row.tract_overrides,
    selectedTractId: row.selected_tract_id,
    mapLayerId: row.map_layer_id,
    showSatellite: row.show_satellite,
    bikeMiles: row.bike_miles ?? [],
    markers: row.markers ?? [],
    layerAdjustments: row.layer_adjustments ?? {},
    baseLifeExpectancy: toNumber(row.base_life_expectancy),
    predictedOutcome: toNumber(row.predicted_outcome),
    currentOutcome: toNumber(row.current_outcome),
    currentOutcomeDiff: toNumber(row.current_outcome_diff),
    policyModelVersion: row.policy_model_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveSimulation(
  userId: string,
  snapshot: SimulationSnapshot,
): Promise<SavedSimulation> {
  const { data, error } = await supabase
    .from('simulations')
    .insert({
      user_id: userId,
      title: snapshot.title,
      notes: snapshot.notes ?? null,
      parameter_values: snapshot.parameterValues,
      tract_overrides: snapshot.tractOverrides,
      selected_tract_id: snapshot.selectedTractId,
      map_layer_id: snapshot.mapLayerId,
      show_satellite: snapshot.showSatellite,
      bike_miles: snapshot.bikeMiles,
      markers: snapshot.markers,
      layer_adjustments: snapshot.layerAdjustments,
      base_life_expectancy: snapshot.baseLifeExpectancy,
      predicted_outcome: snapshot.predictedOutcome,
      current_outcome: snapshot.currentOutcome,
      current_outcome_diff: snapshot.currentOutcomeDiff,
      policy_model_version: snapshot.policyModelVersion,
    })
    .select()
    .single();

  if (error) throw error;
  return mapRow(data as SimulationRow);
}

export async function listSimulations(): Promise<SavedSimulation[]> {
  const { data, error } = await supabase
    .from('simulations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as SimulationRow[]).map(mapRow);
}

export async function getSimulation(id: string): Promise<SavedSimulation> {
  const { data, error } = await supabase
    .from('simulations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return mapRow(data as SimulationRow);
}

export async function deleteSimulation(id: string): Promise<void> {
  const { error } = await supabase.from('simulations').delete().eq('id', id);
  if (error) throw error;
}
