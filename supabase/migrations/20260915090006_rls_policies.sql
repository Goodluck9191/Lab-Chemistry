-- =============================================================================
-- 0006 Row Level Security: policies and grants
--
-- IMPORTANT: Supabase grants `all` on new tables in `public` to `anon` and
-- `authenticated` by default. Without the explicit `revoke all` below, clients
-- would keep DELETE and UPDATE rights that no policy ever intended to allow.
-- Every table is therefore revoked first and granted back precisely.
--
-- These policies are the security boundary. The proxy and the application's
-- access helpers are convenience layers on top of them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;
-- Column-level grant: `role` is deliberately absent, so no client can promote
-- itself to instructor even with a direct UPDATE.
grant update (full_name, registration_number) on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy profiles_select_instructor
  on public.profiles for select to authenticated
  using (public.is_instructor());

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy: profiles are created by the auth trigger.
-- No DELETE policy: accounts are removed through Supabase Auth, not the API.

-- -----------------------------------------------------------------------------
-- experiment catalog: readable, never client-writable
-- -----------------------------------------------------------------------------
revoke all on public.experiments from anon, authenticated;
revoke all on public.experiment_steps from anon, authenticated;
revoke all on public.experiment_chemicals from anon, authenticated;
revoke all on public.experiment_apparatus from anon, authenticated;

grant select on public.experiments to authenticated;
grant select on public.experiment_steps to authenticated;
grant select on public.experiment_chemicals to authenticated;
grant select on public.experiment_apparatus to authenticated;

create policy experiments_select_published_or_instructor
  on public.experiments for select to authenticated
  using (status = 'published' or public.is_instructor());

create policy experiment_steps_select
  on public.experiment_steps for select to authenticated
  using (public.can_read_experiment(experiment_id));

create policy experiment_chemicals_select
  on public.experiment_chemicals for select to authenticated
  using (public.can_read_experiment(experiment_id));

create policy experiment_apparatus_select
  on public.experiment_apparatus for select to authenticated
  using (public.can_read_experiment(experiment_id));

-- -----------------------------------------------------------------------------
-- experiment_attempts
-- -----------------------------------------------------------------------------
revoke all on public.experiment_attempts from anon, authenticated;

grant select on public.experiment_attempts to authenticated;
grant insert on public.experiment_attempts to authenticated;
-- Column-level grant: `final_score` and `integrity_hash` are excluded, so points
-- can only be awarded by server-side grading (SECURITY DEFINER) or the service role.
grant update (status, last_activity_at, submitted_at) on public.experiment_attempts
  to authenticated;

create policy attempts_select_own_or_instructor
  on public.experiment_attempts for select to authenticated
  using (student_id = auth.uid() or public.is_instructor());

-- A student may only ever create an attempt for themselves, and only in the open
-- state. `submitted_at` is checked to make a pre-submitted insert impossible.
create policy attempts_insert_own
  on public.experiment_attempts for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'in_progress'
    and submitted_at is null
  );

-- The USING clause makes a submitted or graded attempt read-only: it no longer
-- matches, so it cannot be updated by its owner at all. The WITH CHECK allows the
-- single permitted forward transition (in_progress -> submitted).
create policy attempts_update_own_live
  on public.experiment_attempts for update to authenticated
  using (student_id = auth.uid() and status in ('in_progress', 'returned'))
  with check (student_id = auth.uid() and status in ('in_progress', 'submitted'));

create policy attempts_update_instructor
  on public.experiment_attempts for update to authenticated
  using (public.is_instructor())
  with check (public.is_instructor());

-- No DELETE policy anywhere in this schema: withdrawing an attempt is a status
-- change, so the record survives for auditing.

-- -----------------------------------------------------------------------------
-- attempt_state (runtime SimulationState)
-- -----------------------------------------------------------------------------
revoke all on public.attempt_state from anon, authenticated;

grant select on public.attempt_state to authenticated;
grant insert on public.attempt_state to authenticated;
grant update (revision, snapshot, updated_at) on public.attempt_state to authenticated;

create policy attempt_state_select
  on public.attempt_state for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy attempt_state_insert
  on public.attempt_state for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

create policy attempt_state_update
  on public.attempt_state for update to authenticated
  using (public.can_write_attempt(attempt_id))
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- experiment_trials
-- -----------------------------------------------------------------------------
revoke all on public.experiment_trials from anon, authenticated;

grant select on public.experiment_trials to authenticated;
grant insert (attempt_id, trial_number, status, initial_reading, final_reading,
              titre_volume, endpoint_observed, rejection_reason)
  on public.experiment_trials to authenticated;
grant update (status, initial_reading, final_reading, titre_volume,
              endpoint_observed, rejection_reason)
  on public.experiment_trials to authenticated;

create policy trials_select
  on public.experiment_trials for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy trials_insert
  on public.experiment_trials for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

create policy trials_update
  on public.experiment_trials for update to authenticated
  using (public.can_write_attempt(attempt_id))
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- measurements: APPEND-ONLY (no UPDATE grant and no UPDATE policy)
-- -----------------------------------------------------------------------------
revoke all on public.measurements from anon, authenticated;

grant select on public.measurements to authenticated;
grant insert (attempt_id, trial_id, kind, label, value, unit) on public.measurements
  to authenticated;

create policy measurements_select
  on public.measurements for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy measurements_insert
  on public.measurements for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- observations
-- -----------------------------------------------------------------------------
revoke all on public.observations from anon, authenticated;

grant select on public.observations to authenticated;
grant insert (attempt_id, trial_id, step_key, field_key, text_value, choice_value)
  on public.observations to authenticated;
grant update (text_value, choice_value) on public.observations to authenticated;

create policy observations_select
  on public.observations for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy observations_insert
  on public.observations for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

create policy observations_update
  on public.observations for update to authenticated
  using (public.can_write_attempt(attempt_id))
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- calculation_submissions
--
-- The SELECT grant omits `expected_value` and `tolerance`, so the answer key is
-- unreadable even by the student who owns the row. INSERT/UPDATE grants omit
-- `expected_value`, `tolerance` and `is_correct`, so a student cannot mark their
-- own work either. Grading writes those through a SECURITY DEFINER function.
-- -----------------------------------------------------------------------------
revoke all on public.calculation_submissions from anon, authenticated;

grant select (id, attempt_id, question_key, student_value, student_unit, is_correct,
              attempt_number, submitted_at)
  on public.calculation_submissions to authenticated;
grant insert (attempt_id, question_key, student_value, student_unit, attempt_number)
  on public.calculation_submissions to authenticated;
grant update (student_value, student_unit, attempt_number)
  on public.calculation_submissions to authenticated;

create policy calculation_submissions_select
  on public.calculation_submissions for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy calculation_submissions_insert
  on public.calculation_submissions for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

create policy calculation_submissions_update
  on public.calculation_submissions for update to authenticated
  using (public.can_write_attempt(attempt_id))
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------
revoke all on public.reports from anon, authenticated;

grant select on public.reports to authenticated;
grant insert (attempt_id, status, aim, procedure, results_summary, conclusion,
              safety_notes, readings_snapshot, submitted_at)
  on public.reports to authenticated;
grant update (status, aim, procedure, results_summary, conclusion, safety_notes,
              readings_snapshot, submitted_at)
  on public.reports to authenticated;

create policy reports_select
  on public.reports for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy reports_insert
  on public.reports for insert to authenticated
  with check (public.can_write_attempt(attempt_id));

create policy reports_update
  on public.reports for update to authenticated
  using (public.can_write_attempt(attempt_id))
  with check (public.can_write_attempt(attempt_id));

-- -----------------------------------------------------------------------------
-- grades
--
-- Students can READ the outcome of their own attempt (useful feedback) but can
-- never write it. Only a signed-in instructor may insert or change a grade, and
-- the row must record that instructor as the grader.
-- -----------------------------------------------------------------------------
revoke all on public.grades from anon, authenticated;

grant select on public.grades to authenticated;
grant insert on public.grades to authenticated;
grant update on public.grades to authenticated;

create policy grades_select
  on public.grades for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy grades_insert_instructor
  on public.grades for insert to authenticated
  with check (public.is_instructor() and graded_by = auth.uid());

create policy grades_update_instructor
  on public.grades for update to authenticated
  using (public.is_instructor())
  with check (public.is_instructor() and graded_by = auth.uid());

-- -----------------------------------------------------------------------------
-- instructor_feedback
-- -----------------------------------------------------------------------------
revoke all on public.instructor_feedback from anon, authenticated;

grant select on public.instructor_feedback to authenticated;
grant insert (attempt_id, author_id, category, body) on public.instructor_feedback
  to authenticated;
grant update (category, body) on public.instructor_feedback to authenticated;

create policy instructor_feedback_select
  on public.instructor_feedback for select to authenticated
  using (public.can_read_attempt(attempt_id));

create policy instructor_feedback_insert_instructor
  on public.instructor_feedback for insert to authenticated
  with check (public.is_instructor() and author_id = auth.uid());

create policy instructor_feedback_update_author
  on public.instructor_feedback for update to authenticated
  using (public.is_instructor() and author_id = auth.uid())
  with check (public.is_instructor() and author_id = auth.uid());
