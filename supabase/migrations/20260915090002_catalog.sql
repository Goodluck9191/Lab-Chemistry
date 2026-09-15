-- =============================================================================
-- 0002 experiment catalog
--
-- `experiments.config` holds ONLY the public projection of an experiment. Hidden
-- parameter generators (the ranges the true concentration is drawn from) stay in
-- server-side application code, because publishing a range narrows the answer.
-- =============================================================================

create table public.experiments (
  id                text primary key,
  experiment_number integer not null unique,
  slug              text not null unique,
  title             text not null,
  description       text not null default '',
  aim               text not null default '',
  theory            text not null default '',
  safety            text[] not null default '{}',
  type              public.experiment_type not null,
  subtype           public.titration_subtype,
  status            public.experiment_status not null default 'draft',
  order_index       integer not null default 0,
  config            jsonb not null default '{}'::jsonb,
  config_version    integer not null default 1,
  accuracy          text not null default 'assumed',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint experiments_id_format    check (id ~ '^exp-[0-9]{2}$'),
  constraint experiments_number_range check (experiment_number between 1 and 99),
  constraint experiments_title_len    check (length(btrim(title)) between 3 and 300),
  constraint experiments_config_obj   check (jsonb_typeof(config) = 'object'),
  constraint experiments_version_pos  check (config_version >= 1),
  constraint experiments_accuracy_ok  check (accuracy in ('assumed', 'manual-verified')),
  constraint experiments_subtype_ok   check (
    (type = 'titration' and subtype is not null)
    or (type <> 'titration' and subtype is null)
  )
);

alter table public.experiments enable row level security;

create index experiments_status_order_idx on public.experiments (status, order_index);

create trigger experiments_set_updated_at
  before update on public.experiments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.experiment_steps (
  id            uuid primary key default gen_random_uuid(),
  experiment_id text not null references public.experiments (id) on delete cascade,
  step_number   integer not null,
  title         text not null,
  instruction   text not null,
  is_required   boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (experiment_id, step_number),
  constraint experiment_steps_number_pos check (step_number >= 1)
);

alter table public.experiment_steps enable row level security;

-- -----------------------------------------------------------------------------
create table public.experiment_chemicals (
  id                 uuid primary key default gen_random_uuid(),
  experiment_id      text not null references public.experiments (id) on delete cascade,
  chemical_key       text not null,
  name               text not null,
  formula            text,
  role               text not null,
  concentration      numeric(12, 6),
  concentration_unit text,
  hazard_codes       text[] not null default '{}',
  is_required        boolean not null default true,
  unique (experiment_id, chemical_key),
  constraint experiment_chemicals_role_known check (role in (
    'titrant', 'analyte', 'indicator', 'reagent', 'primary_standard',
    'solvent', 'wash', 'drying_agent', 'other')),
  constraint experiment_chemicals_conc_non_negative check (
    concentration is null or concentration >= 0)
);

alter table public.experiment_chemicals enable row level security;

-- -----------------------------------------------------------------------------
create table public.experiment_apparatus (
  id            uuid primary key default gen_random_uuid(),
  experiment_id text not null references public.experiments (id) on delete cascade,
  apparatus_key text not null,
  name          text not null,
  capacity_ml   numeric(10, 2),
  graduation_ml numeric(10, 3),
  is_required   boolean not null default true,
  unique (experiment_id, apparatus_key),
  constraint experiment_apparatus_capacity_pos check (capacity_ml is null or capacity_ml > 0),
  constraint experiment_apparatus_graduation_pos check (graduation_ml is null or graduation_ml > 0)
);

alter table public.experiment_apparatus enable row level security;

-- -----------------------------------------------------------------------------
-- "May I read this experiment?" Used by the child-table policies.
-- -----------------------------------------------------------------------------
create or replace function public.can_read_experiment(p_experiment_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.experiments e
    where e.id = p_experiment_id
      and (e.status = 'published' or public.is_instructor())
  );
$$;

revoke all on function public.can_read_experiment(text) from public;
grant execute on function public.can_read_experiment(text) to authenticated, service_role;
