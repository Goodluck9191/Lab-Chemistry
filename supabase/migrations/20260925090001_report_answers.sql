-- =============================================================================
-- Phase 6: report answers storage for the student report workflow
--
-- WHAT: a single `answers` jsonb column on `public.reports` holding the
-- student's report-question answers (keyed by question key) and selected
-- sources of error. No new table: answers belong to the report row's
-- lifecycle (draft -> submitted -> reviewed) and inherit its RLS.
--
-- WHAT THIS DOES NOT DO:
-- - no chemistry functions in SQL (assessment runs in the application layer);
-- - no answer key storage (expected values stay in attempt_secrets / code);
-- - no grade writes (grades remain instructor-or-service-role only);
-- - no RLS policy changes beyond the column grants below (same policies).
-- =============================================================================

alter table public.reports
  add column if not exists answers jsonb not null default '{}'::jsonb;

alter table public.reports
  drop constraint if exists reports_answers_obj;

alter table public.reports
  add constraint reports_answers_obj check (jsonb_typeof(answers) = 'object');

-- The student owns their answers exactly like the other report sections:
-- writable on draft rows, frozen once the attempt is submitted (the existing
-- can_write_attempt() policies already enforce the lifecycle).
grant insert (answers) on public.reports to authenticated;
grant update (answers) on public.reports to authenticated;
