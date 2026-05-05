import type { MapLayerId, MarkerPoint } from '../mapLayers';

export type ParameterValues = Record<string, number>;
export type TractOverrides = Record<string, Record<string, number>>;
export type BikeMilePoint = { x: number; y: number };
export type LayerAdjustments = Record<string, number>;

export type SimulationSnapshot = {
  title: string;
  notes?: string | null;
  parameterValues: ParameterValues;
  tractOverrides: TractOverrides;
  selectedTractId: string | null;
  mapLayerId: MapLayerId;
  showSatellite: boolean;
  bikeMiles: BikeMilePoint[];
  markers: MarkerPoint[];
  layerAdjustments: LayerAdjustments;
  baseLifeExpectancy: number;
  predictedOutcome: number;
  currentOutcome: number;
  currentOutcomeDiff: number;
  policyModelVersion: string;
};

export type SavedSimulation = SimulationSnapshot & {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type SimulationRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  parameter_values: ParameterValues;
  tract_overrides: TractOverrides;
  selected_tract_id: string | null;
  map_layer_id: MapLayerId;
  show_satellite: boolean;
  bike_miles: BikeMilePoint[] | null;
  markers: MarkerPoint[] | null;
  layer_adjustments: LayerAdjustments | null;
  base_life_expectancy: number | string;
  predicted_outcome: number | string;
  current_outcome: number | string;
  current_outcome_diff: number | string;
  policy_model_version: string;
  created_at: string;
  updated_at: string;
};
