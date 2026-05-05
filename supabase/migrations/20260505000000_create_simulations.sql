create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  parameter_values jsonb not null,
  tract_overrides jsonb not null default '{}'::jsonb,
  selected_tract_id text,
  map_layer_id text not null default 'adi',
  show_satellite boolean not null default false,
  base_life_expectancy numeric not null,
  predicted_outcome numeric not null,
  current_outcome numeric not null,
  current_outcome_diff numeric not null,
  policy_model_version text not null default 'initial-policy-areas-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists simulations_set_updated_at on public.simulations;
create trigger simulations_set_updated_at
before update on public.simulations
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.simulations enable row level security;

drop policy if exists "profiles are self owned" on public.profiles;
create policy "profiles are self owned"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "simulations are user owned" on public.simulations;
create policy "simulations are user owned"
on public.simulations
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.simulations to authenticated;
