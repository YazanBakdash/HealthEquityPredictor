export type Simulation = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type SimulationRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type SimulationGeometry = {
  id: string;
  simulationId: string;
  featureType: 'bike_trail' | 'park' | 'school' | 'library';
  lat: number | null;
  lon: number | null;
  geometry: GeoJSON.LineString | GeoJSON.Polygon | null;
  createdAt: string;
};

export type SimulationGeometryRow = {
  id: string;
  simulation_id: string;
  feature_type: 'bike_trail' | 'park' | 'school' | 'library';
  lat: number | null;
  lon: number | null;
  geometry: GeoJSON.LineString | GeoJSON.Polygon | null;
  created_at: string;
};

export type SimulationFeatureRow = {
  census_tract: string;
  tree_canopy: number | null;
  affordable_housing: number | null;
  parks: number | null;
  transit_stop: number | null;
  bike_miles: number | null;
  wifi_hotspots: number | null;
  school_density: number | null;
  library_count: number | null;
  small_business: number | null;
  food_access: number | null;
  predicted_adi: number | null;
};

export type GeometryInput = {
  feature_type: 'bike_trail' | 'park' | 'school' | 'library';
  lat?: number;
  lon?: number;
  geometry?: GeoJSON.LineString | GeoJSON.Polygon;
};

export type SliderOverrides = Record<string, Record<string, number>>;
