-- =============================================================================
-- 0003 attempts, hidden secrets, runtime state
-- =============================================================================

create table public.experiment_attempts (
  id               uuid primary key default gen_random_uuid(),
  experiment_id    text not null references public.experiments (id) on delete restrict,
  student_id       uuid not null references public.profiles (id) on delete cascade,
  status           public.attempt_status not null default 'in_progress',
  config_version   integer not null,
  started_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  submitted_at     timestamptz,
  completed_at     timestamptz,
  -- Cache of grades.final_score, written only by server-side grading logic.
  -- Column-level grants keep it out of reach of students and instructors.
  final_score      numeric(6, 2),
  integrity_hash   text,
  constraint attempts_version_pos check (config_version >= 1),
  constraint attempts_score_range check (final_score is null or final_score between 0 and 100),
  constraint attempts_submitted_after_start check (
    submitted_at is null or submitted_at >= started_at),
  constraint attempts_terminal_has_submission check (
    (status in ('submitted', 'graded', 'returned') and submitted_at is not null)
    or status in ('in_progress', 'abandoned'))
);

alter table public.experiment_attempts enable row level security;

create index experiment_attempts_student_status_idx
  on public.experiment_attempts (student_id, status);
create index experiment_attempts_status_submitted_idx
  on public.experiment_attempts (status, submitted_at desc);
create index experiment_attempts_experiment_idx
  on public.experiment_attempts (experiment_id);

-- One live attempt per student per experiment. A double-click cannot create two;
-- the application turns the resulting unique violation into "resume".
create unique index experiment_attempts_one_active_idx
  on public.experiment_attempts (student_id, experiment_id)
  where status = 'in_progress';

-- -----------------------------------------------------------------------------
-- HIDDEN PARAMETERS. Row Level Security is ENABLED and there are deliberately
-- ZERO policies, and every grant is revoked: PostgREST cannot read this table
-- with a student's or an instructor's token. Only SECURITY DEFINER functions and
-- the service role can touch it.
-- -----------------------------------------------------------------------------
create table public.attempt_secrets (
  attempt_id        uuid primary key references public.experiment_attempts (id) on delete cascade,
  seed              text not null,
  true_values       jsonb not null default '{}'::jsonb,
  expected_endpoint jsonb not null default '{}'::jsonb,
  rubric_weights    jsonb not null default '{}'::jsonb,
  generated_at      timestamptz not null default now(),
  constraint attempt_secrets_true_values_obj check (jsonb_typeof(true_values) = 'object'),
  constraint attempt_secrets_endpoint_obj    check (jsonb_typeof(expected_endpoint) = 'object'),
  constraint attempt_secrets_weights_obj     check (jsonb_typeof(rubric_weights) = 'object')
);

alter table public.attempt_secrets enable row level security;
revoke all on public.attempt_secrets from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Runtime SimulationState. One jsonb document rather than dozens of columns, so
-- simulation state never leaks into query shapes and can evolve per engine.
-- -----------------------------------------------------------------------------
create table public.attempt_state (
  attempt_id uuid primary key references public.experiment_attempts (id) on delete cascade,
  revision   integer not null default 0,
  snapshot   jsonb not null default '{"schemaVersion":1}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint attempt_state_revision_non_negative check (revision >= 0),
  constraint attempt_state_snapshot_obj check (jsonb_typeof(snapshot) = 'object')
);

alter table public.attempt_state enable row level security;

-- -----------------------------------------------------------------------------
-- Attempt identity columns are immutable for every role, including the service
-- role: grading may change a status or a score, but never who owns an attempt or
-- which experiment it belongs to.
-- -----------------------------------------------------------------------------
create or replace function public.protect_attempt_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.student_id <> old.student_id
     or new.experiment_id <> old.experiment_id
     or new.started_at <> old.started_at
     or new.config_version <> old.config_version then
    raise exception 'Attempt identity columns are immutable';
  end if;
  return new;
end;
$$;

create trigger experiment_attempts_protect_columns
  before update on public.experiment_attempts
  for each row execute function public.protect_attempt_columns();

-- -----------------------------------------------------------------------------
-- Read/write predicates used by every attempt-owned table's policies.
-- -----------------------------------------------------------------------------
create or replace function public.can_read_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.experiment_attempts a
    where a.id = p_attempt_id
      and (a.student_id = auth.uid() or public.is_instructor())
  );
$$;

-- Writable only by the owning student, and only while the attempt is live. Once
-- submitted, the row falls out of these predicates and the readings freeze.
create or replace function public.can_write_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.experiment_attempts a
    where a.id = p_attempt_id
      and a.student_id = auth.uid()
      and a.status in ('in_progress', 'returned')
  );
$$;

revoke all on function public.can_read_attempt(uuid) from public;
revoke all on function public.can_write_attempt(uuid) from public;
grant execute on function public.can_read_attempt(uuid) to authenticated, service_role;
grant execute on function public.can_write_attempt(uuid) to authenticated, service_role;
