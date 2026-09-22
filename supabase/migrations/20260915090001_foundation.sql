-- =============================================================================
-- 0001 foundation: enums, profiles, helpers
-- =============================================================================

create type public.user_role as enum ('student', 'instructor');

create type public.experiment_type as enum ('titration', 'gravimetric', 'synthesis', 'conductometry');

create type public.titration_subtype as enum ('acid_base', 'redox', 'precipitation', 'complexometric');

create type public.experiment_status as enum ('draft', 'published', 'archived');

create type public.attempt_status as enum ('in_progress', 'submitted', 'graded', 'returned', 'abandoned');

create type public.trial_status as enum ('open', 'recorded', 'rejected');

create type public.measurement_kind as enum
  ('titration_reading', 'mass', 'temperature', 'conductivity', 'volume', 'colour', 'other');

create type public.report_status as enum ('draft', 'submitted', 'reviewed');

create type public.grade_decision as enum ('pending', 'approved', 'returned', 'needs_revision');

-- -----------------------------------------------------------------------------
-- profiles: one row per authenticated user. Role lives here and ONLY here, so
-- the client never supplies it.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  full_name           text not null default '',
  registration_number text,
  role                public.user_role not null default 'student',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_email_plausible check (length(btrim(email)) between 5 and 320),
  constraint profiles_full_name_len   check (length(full_name) <= 200),
  constraint profiles_registration_len check (
    registration_number is null or length(btrim(registration_number)) between 1 and 40)
);

alter table public.profiles enable row level security;

create index profiles_role_idx on public.profiles (role);

-- -----------------------------------------------------------------------------

-- shared trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- New auth user -> profile row.
--
-- SECURITY: the role is hard-coded to 'student'. It is NEVER read from
-- raw_user_meta_data, because that metadata is supplied by the client at signup
-- and reading it would let anybody register themselves as an instructor.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, registration_number, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'registration_number'), ''),
    'student'::public.user_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER + pinned search_path so a policy on `profiles`
-- can ask "what is my role?" without recursing into the profiles policy.
-- -----------------------------------------------------------------------------
create or replace function public.current_role_key()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_instructor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'instructor'::public.user_role
  );
$$;

revoke all on function public.current_role_key() from public;
revoke all on function public.is_instructor() from public;
grant execute on function public.current_role_key() to authenticated, service_role;
grant execute on function public.is_instructor() to authenticated, service_role;
