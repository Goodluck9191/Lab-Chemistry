-- =============================================================================
-- 0005 outcomes: reports, grades, instructor feedback
-- =============================================================================

create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  attempt_id        uuid not null unique references public.experiment_attempts (id) on delete cascade,
  status            public.report_status not null default 'draft',
  aim               text not null default '',
  procedure         text not null default '',
  results_summary   text not null default '',
  conclusion        text not null default '',
  safety_notes      text not null default '',
  -- Frozen copy of the readings used in the submitted report, so a later edit to
  -- the attempt cannot silently change what was marked.
  readings_snapshot jsonb not null default '{}'::jsonb,
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reports_submitted_has_time check (status = 'draft' or submitted_at is not null),
  constraint reports_snapshot_obj check (jsonb_typeof(readings_snapshot) = 'object'),
  constraint reports_text_lengths check (
    length(aim) <= 20000
    and length(procedure) <= 40000
    and length(results_summary) <= 20000
    and length(conclusion) <= 20000
    and length(safety_notes) <= 10000)
);

alter table public.reports enable row level security;

create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- One grade row per attempt. `auto_score` is what the assessment engine awarded;
-- `instructor_score` is the examiner's adjustment; `final_score` is what counts.
-- The instructor's decision is recorded with who made it and when.
-- -----------------------------------------------------------------------------
create table public.grades (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null unique references public.experiment_attempts (id) on delete cascade,
  auto_score       numeric(6, 2),
  instructor_score numeric(6, 2),
  final_score      numeric(6, 2),
  rubric_breakdown jsonb not null default '{}'::jsonb,
  decision         public.grade_decision not null default 'pending',
  graded_by        uuid references public.profiles (id) on delete set null,
  graded_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint grades_auto_range       check (auto_score is null or auto_score between 0 and 100),
  constraint grades_instructor_range check (
    instructor_score is null or instructor_score between 0 and 100),
  constraint grades_final_range      check (final_score is null or final_score between 0 and 100),
  constraint grades_breakdown_obj    check (jsonb_typeof(rubric_breakdown) = 'object'),
  constraint grades_final_needs_decision check (final_score is null or decision <> 'pending'),
  constraint grades_decision_needs_grader check (
    decision = 'pending' or graded_by is not null)
);

alter table public.grades enable row level security;

create trigger grades_set_updated_at
  before update on public.grades
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
create table public.instructor_feedback (
  id         uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.experiment_attempts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  category   text not null default 'general',
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_feedback_category_known check (category in (
    'general', 'technique', 'calculation', 'safety', 'report', 'observation')),
  constraint instructor_feedback_body_len check (length(btrim(body)) between 1 and 5000)
);

alter table public.instructor_feedback enable row level security;

create index instructor_feedback_attempt_idx
  on public.instructor_feedback (attempt_id, created_at desc);

create trigger instructor_feedback_set_updated_at
  before update on public.instructor_feedback
  for each row execute function public.set_updated_at();
