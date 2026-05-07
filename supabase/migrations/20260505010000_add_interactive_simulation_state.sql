alter table public.simulations
  add column if not exists bike_miles jsonb not null default '[]'::jsonb,
  add column if not exists markers jsonb not null default '[]'::jsonb,
  add column if not exists layer_adjustments jsonb not null default '{}'::jsonb;
