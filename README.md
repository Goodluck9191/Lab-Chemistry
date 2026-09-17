# Virtual Chemistry Laboratory

A virtual laboratory for university Physical Chemistry practicals. Students work through an
experiment on screen - preparing solutions, reading a burette, judging an endpoint, repeating
trials until they agree, calculating results and submitting a report - and instructors review and
mark the submissions.

**Current status: Phase 4, the interactive laboratory.** Experiment 2 runs on a
server-authoritative titration engine with a 2D SVG bench: the student prepares the solution, fills
and reads the burette, titrates to the endpoint, repeats trials to concordance, records
observations and submits calculations - every interaction travelling through one versioned action
protocol to the server, which owns the hidden reality. See
[Phase 4 boundary](#phase-4-boundary).

---

## What works today

| Area | State |
|---|---|
| Project structure | Four-layer architecture: `domain` → `application` → `infrastructure` → `components`/`app` |
| Authentication | Register, sign in, sign out, session refresh, invalid-session handling |
| Roles | `student` and `instructor`, resolved **server-side** from `profiles.role`; nobody can self-promote |
| Database | 15 tables, foreign keys, constraints, indexes, RLS on every table, one seeded experiment |
| Attempts | A student can start an attempt (or resume the open one) and it is stored with a durable state row |
| Domain model | Experiment, simulation, attempt and secrets contracts - configuration-driven, no per-experiment code |
| Interface | Student and instructor shells, experiment library, briefing page, error/empty/loading states |
| Laboratory | Experiment 2 laboratory at `/lab/exp-02/attempt/<id>`: SVG bench, burette with stopcock and meniscus, flask colour, balance, pipette, reagent tray, procedure checklist, trial table, concordance, observations, calculations, autosave status, resume |
| Simulation | Generic configuration-driven titration engine; hidden per-attempt parameters in `attempt_secrets`; versioned action protocol; revision-guarded autosave; persisted trials, measurements, observations and calculation submissions |
| Tests | 203 offline tests (domain, application, laboratory view model, transport, component tests in jsdom, migration audit, secret hygiene, laboratory exposure) plus live RLS/persistence/laboratory suites that run when credentials are supplied |

### Not built yet

Submission and grading of a completed attempt (the domain lifecycle and the database policies exist,
the use case does not), automatic marking against the rubric, the report editor, instructor marking
screens, PDF export, the remaining experiments, and the manual-verified migration of the Experiment 2
catalog row. The intermediate moles calculation has no submission action, so the laboratory presents
it as unmarked guidance rather than pretending to check it. Three.js is explicitly out of scope:
the bench is SVG.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase values
```

Apply the schema and seed data (requires the Supabase CLI; Docker is needed only for a local stack):

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push           # applies supabase/migrations/*.sql
npx supabase db push --include-seed   # or run supabase/seed.sql in the SQL editor
```

Create the development accounts (a student and an instructor):

```bash
npm run seed:users
```

Then:

```bash
npm run dev        # http://localhost:3000
npm run test       # offline test suite
npm run typecheck
npm run lint
npm run build
```

> **Development credentials.** `scripts/seed-users.mjs` creates
> `student@example.edu` / `student-pass-123` and `instructor@example.edu` /
> `instructor-pass-123`. They are for local use only and must never be created on a
> project that holds real student data.

### Environment variables

| Variable | Exposure | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key; all access is still governed by RLS |
| `NEXT_PUBLIC_SITE_URL` | public | Absolute origin for auth redirects |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Bypasses RLS. Read only by `lib/env.ts` and used only by `infrastructure/supabase/admin.ts` |

Optional, for the live security suite: `SUPABASE_TEST_STUDENT_A_EMAIL`, `..._PASSWORD`,
`SUPABASE_TEST_STUDENT_B_EMAIL`, `..._PASSWORD`, `SUPABASE_TEST_INSTRUCTOR_EMAIL`,
`..._PASSWORD`.

Secrets are never committed: `.env*` is git-ignored and `.env.example` holds placeholders only.

---

## Architecture

```
app/                     routes only: (auth) (student) (instructor) (lab) + error/loading states
proxy.ts                 Next 16 Proxy (formerly middleware): session refresh + coarse redirects
domain/                  PURE TypeScript. No React, no Supabase, no I/O. Testable in milliseconds.
  experiments/           ExperimentType, TitrationSubtype, definition + Zod schema, sample catalog
  simulation/            SimulationState, actions, engine contract, secrets, state schema
  attempts/              AttemptStatus and the lifecycle transition table
  profiles/              UserRole and UserProfile
application/             use cases: load, authorise, delegate, validate. Orchestration only.
  auth/                  access predicates + the Data Access Layer (dal.ts)
  attempts/              start/resume an attempt, load one, boundary schemas, server actions
  experiments/           list and load experiments for the interface
infrastructure/supabase/ browser client, server client, admin (service-role) client, repositories
components/              ui primitives, layout shells, auth forms, laboratory placeholder
supabase/migrations/     the schema and every RLS policy, in reviewable SQL
tests/                   domain, application, security (static audits), integration (live RLS)
```

Five rules the codebase actually follows:

1. **Chemistry and grading are domain logic.** `domain/` is pure and holds no framework imports; a
   test enforces that, along with a test that no domain file outside the catalog names a specific
   experiment.
2. **Simulation state is one document.** `attempt_state.snapshot` is validated on read with Zod, so
   a corrupted or stale snapshot fails loudly instead of half-loading an experiment.
3. **Nothing gradeable is client-trusted.** The client never sends a student id, a role, a score or
   a hidden parameter; the server derives them from the session and the database.
4. **The database is the authority.** RLS, not the interface, decides who may read or write what.
5. **Every abstraction earns its place.** There is no ORM, no global state library, no 3D renderer,
   no PDF toolchain, and no CMS - none of them are needed yet.

## Database

```
profiles ─┬─< experiment_attempts ─┬─< experiment_trials ─< measurements
          │                        ├─< measurements
          │                        ├─< observations
          │                        ├─< calculation_submissions
          │                        ├─< attempts (state)      attempt_state
          │                        ├─  reports (1:1)
          │                        ├─  grades (1:1)
          │                        └─< instructor_feedback
          └─< grades.graded_by, instructor_feedback.author_id

experiments ─┬─< experiment_steps
             ├─< experiment_chemicals
             └─< experiment_apparatus

experiment_attempts ──  attempt_secrets (1:1, RLS on, ZERO policies)
```

Notable design decisions:

- **`numeric`, never `float`**, for anything a student reads or is marked on; bounded `CHECK` ranges
  that also reject `NaN` and `Infinity`.
- **`attempt_secrets` is unreachable through the API.** RLS is enabled with no policies at all and
  every grant is revoked, so only a `SECURITY DEFINER` function or the service role can read the
  true concentrations, the expected endpoint and the rubric weights.
- **The answer key is column-protected.** `calculation_submissions` grants `SELECT` on
  `student_value`, `student_unit` and `is_correct` only - not `expected_value` or `tolerance` - so
  even the student who owns the row cannot read the expected answer or mark their own work.
- **`measurements` is append-only** (no `UPDATE` grant, no `UPDATE` policy): a corrected reading is
  a new row, so an attempt's measurement history cannot be rewritten.
- **Submitted attempts freeze.** The `UPDATE` policy's `USING` clause only matches `in_progress` and
  `returned`, so once submitted the row is read-only to its owner by construction.
- **One live attempt per student per experiment**, enforced by a partial unique index; the
  application turns the resulting unique violation into "resume".
- **`config_version` is stored per attempt**, so editing an experiment later cannot change how an
  old attempt is marked.

## Security model

Authentication is Supabase Auth over `@supabase/ssr` cookies. `proxy.ts` refreshes the token, but
it is **not** the security boundary - it only performs optimistic redirects. Every page, server
action and repository call re-checks through `application/auth/dal.ts`, which validates the token
with `getUser()` (never `getSession()`), then reads the role from `profiles`.

Authorisation happens in three independent layers, so a mistake in one does not expose data:

1. **Data access layer** - `requireStudent()`, `requireInstructor()`, and explicit ownership checks.
2. **Row Level Security** - policies on every table; a student can only ever see their own rows, and
   only instructors can write grades or feedback.
3. **Column-level grants and a trigger** - `role` and `final_score` are not updatable by any client,
   and attempt identity columns (`student_id`, `experiment_id`, `started_at`, `config_version`) are
   immutable for every role.

Two things that are easy to get wrong and are handled explicitly here: the signup trigger hard-codes
`role = 'student'` and never reads role from client-supplied metadata; and every `SECURITY DEFINER`
function pins `search_path = ''` with fully-qualified names.

## Testing

```bash
npm run test        # offline: domain, application, laboratory, security, component tests
```

Component tests opt into jsdom with a `@vitest-environment jsdom` docblock (`tests/ui`), so the rest
of the suite stays fast and dependency-free.

The offline suite includes security suites that need no database: a **static audit of the SQL**
(every table has RLS enabled, every table has its Supabase default grants revoked, `attempt_secrets`
has zero policies, no policy is permissive, `DELETE` is granted nowhere, the answer key and the role
column are excluded from client grants, and every `SECURITY DEFINER` function pins its search path),
and a **secret-hygiene audit of the source tree** (the service-role key is read in exactly one
module, no client component imports a privileged module, and authorisation never trusts
`getSession()`).

an **audit of the laboratory surface** (browser-reachable files touch no privileged module, the
shipped state DTO carries none of the hidden keys, and the endpoint error string contains no volume).

`tests/integration/rls.test.ts` is the suite that actually proves isolation with two signed-in
students and an instructor, alongside `persistence.test.ts` (the autosave write pattern) and
`lab-flow.test.ts` (the laboratory's trial, measurement, observation and calculation rows). They
**skip loudly** when credentials are absent, because "no database configured" must never be mistaken
for "verified secure":

```
[rls.test] SKIPPED: live Supabase credentials are not set, so student data isolation
has NOT been verified against a real database.
```

## Phase 4 boundary

The laboratory is complete for Experiment 2 and deliberately stops there. What the engine and the
configuration already support is wired end to end; what they do not support is stated in the
interface rather than faked:

- **No submission yet.** A student can work and save an attempt, but there is no use case that moves
  it to `submitted`, so the laboratory never claims an attempt was handed in.
- **The balance reading is entered, not generated.** No protocol action returns an instrument
  reading, so the mass the student records is what is stored and checked.
- **The moles step is unmarked.** Only the concentration reported per trial can be graded, because
  that is the only calculation with a protocol action.
- **Catalog gaps are disclosed.** The public Experiment 2 catalog row predates the two-stage
  manual-verified configuration, so the laboratory says which reagents and apparatus it draws from
  the configuration instead.
- **Chemicals stay as they are.** The manual citation (`MUST NSCH 1103, pp.16-21`) is referenced in
  code comments only; no new chemistry facts were added for this phase.
