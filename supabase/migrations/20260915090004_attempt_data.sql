-- =============================================================================
-- 0004 attempt data: trials, measurements, observations, calculations
-- =============================================================================

create table public.experiment_trials (
  id                uuid primary key default gen_random_uuid(),
  attempt_id        uuid not null references public.experiment_attempts (id) on delete cascade,
  trial_number      integer not null,
  status            public.trial_status not null default 'open',
  initial_reading   numeric(8, 3),
  final_reading     numeric(8, 3),
  titre_volume      numeric(8, 3),
  endpoint_observed boolean,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (attempt_id, trial_number),
  constraint trials_number_range check (trial_number between 1 and 20),
  constraint trials_readings_range check (
    (initial_reading is null or initial_reading between 0 and 100)
    and (final_reading is null or final_reading between 0 and 100)),
  constraint trials_titre_range check (titre_volume is null or titre_volume between 0 and 100),
  constraint trials_rejected_needs_reason check (
    status <> 'rejected' or (rejection_reason is not null and length(btrim(rejection_reason)) > 0))
);

alter table public.experiment_trials enable row level security;

create trigger experiment_trials_set_updated_at
  before update on public.experiment_trials
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Measurements are APPEND-ONLY: there is no update policy. A corrected reading
-- is a new row, so an attempt's measurement history cannot be rewritten.
--
-- The bounded range also rejects 'NaN' and 'Infinity', which `numeric` accepts
-- and which would otherwise quietly poison every average downstream.
-- -----------------------------------------------------------------------------
create table public.measurements (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null references public.experiment_attempts (id) on delete cascade,
  trial_id         uuid references public.experiment_trials (id) on delete cascade,
  kind             public.measurement_kind not null,
  label            text not null default '',
  value            numeric(14, 6) not null,
  unit             text not null,
  server_validated boolean not null default false,
  deviation        numeric(14, 6),
  recorded_at      timestamptz not null default now(),
  constraint measurements_value_bounded check (value between -1000000 and 1000000),
  constraint measurements_unit_len check (length(btrim(unit)) between 1 and 24),
  constraint measurements_label_len check (length(label) <= 120),
  constraint measurements_deviation_non_negative check (
    deviation is null or deviation between 0 and 1000000)
);

alter table public.measurements enable row level security;

create index measurements_attempt_kind_idx on public.measurements (attempt_id, kind);
create index measurements_trial_idx on public.measurements (trial_id);

-- -----------------------------------------------------------------------------
create table public.observations (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.experiment_attempts (id) on delete cascade,
  trial_id     uuid references public.experiment_trials (id) on delete cascade,
  step_key     text not null,
  field_key    text not null,
  text_value   text,
  choice_value text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (attempt_id, step_key, field_key),
  constraint observations_has_content check (
    coalesce(btrim(text_value), '') <> '' or coalesce(btrim(choice_value), '') <> ''),
  constraint observations_text_len check (text_value is null or length(text_value) <= 2000)
);

alter table public.observations enable row level security;

create trigger observations_set_updated_at
  before update on public.observations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Student answers. `expected_value` and `tolerance` are the ANSWER KEY: they are
-- stored here for grading, but the client-visible SELECT grant in 0006 excludes
-- them, so even the student who owns the row cannot read the expected answer.
-- `is_correct` is set by server-side grading, never by the student.
-- -----------------------------------------------------------------------------
create table public.calculation_submissions (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.experiment_attempts (id) on delete cascade,
  question_key   text not null,
  student_value  numeric(18, 8),
  student_unit   text,
  expected_value numeric(18, 8),
  tolerance      numeric(18, 8),
  is_correct     boolean,
  attempt_number integer not null default 1,
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (attempt_id, question_key),
  constraint calculation_attempt_number_range check (attempt_number between 1 and 20),
  constraint calculation_student_value_bounded check (
    student_value is null or student_value between -1000000000 and 1000000000),
  constraint calculation_unit_len check (
    student_unit is null or length(btrim(student_unit)) between 1 and 24),
  constraint calculation_correct_needs_values check (
    is_correct is null or (student_value is not null and expected_value is not null))
);

alter table public.calculation_submissions enable row level security;

create trigger calculation_submissions_set_updated_at
  before update on public.calculation_submissions
  for each row execute function public.set_updated_at();
