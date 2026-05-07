-- Migration: Normalize simulations schema
-- Drops old monolithic JSONB columns, renames title->name,
-- creates simulation_geometry and simulation_features tables.

-- 1. Drop old columns from simulations
alter table public.simulations
  drop column if exists parameter_values,
  drop column if exists tract_overrides,
  drop column if exists selected_tract_id,
  drop column if exists map_layer_id,
  drop column if exists show_satellite,
  drop column if exists bike_miles,
  drop column if exists markers,
  drop column if exists layer_adjustments,
  drop column if exists base_life_expectancy,
  drop column if exists predicted_outcome,
  drop column if exists current_outcome,
  drop column if exists current_outcome_diff,
  drop column if exists policy_model_version,
  drop column if exists notes;

-- 2. Rename title -> name
alter table public.simulations rename column title to name;

-- 3. Create simulation_geometry
create table if not exists public.simulation_geometry (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations(id) on delete cascade,
  feature_type text not null,
  lat double precision,
  lon double precision,
  geometry jsonb,
  created_at timestamptz not null default now(),

  constraint valid_feature_type check (feature_type in ('bike_trail', 'park', 'school', 'library'))
);

-- 4. Create simulation_features
create table if not exists public.simulation_features (
  id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations(id) on delete cascade,
  census_tract text not null,
  tree_canopy double precision,
  affordable_housing double precision,
  parks double precision,
  transit_stop double precision,
  bike_miles double precision,
  wifi_hotspots double precision,
  school_density double precision,
  library_count double precision,
  small_business double precision,
  food_access double precision,
  predicted_adi double precision,

  unique (simulation_id, census_tract)
);

-- 5. RLS on simulation_geometry
alter table public.simulation_geometry enable row level security;

drop policy if exists "geometry belongs to simulation owner" on public.simulation_geometry;
create policy "geometry belongs to simulation owner"
on public.simulation_geometry
for all
using (
  exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
)
with check (
  exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
);

-- 5b. RLS on simulation_features
alter table public.simulation_features enable row level security;

drop policy if exists "features belong to simulation owner" on public.simulation_features;
create policy "features belong to simulation owner"
on public.simulation_features
for all
using (
  exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
)
with check (
  exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
);

-- 6. Grants
grant select, insert, update, delete on public.simulation_geometry to authenticated;
grant select, insert, update, delete on public.simulation_features to authenticated;
grant select, insert, update, delete on public.simulation_geometry to service_role;
grant select, insert, update, delete on public.simulation_features to service_role;

-- Indexes for common lookups
create index if not exists idx_sim_geometry_simulation_id on public.simulation_geometry(simulation_id);
create index if not exists idx_sim_features_simulation_id on public.simulation_features(simulation_id);
