# Experiment 2 — Student-Driven Physical Laboratory

Implementation report for the phase that turns the Experiment 2 bench from an
action-button funnel into a student-driven, physically interactive laboratory.
Phase 8 (instructor dashboard) was deliberately not started.

## 1. Existing architecture audited

The change was made inside the systems that already existed; none were
duplicated.

- **3D engine** — React Three Fiber. `components/lab/3d/Lab3DScene.tsx` (scene),
  `LabEnvironment.tsx`, `LabLighting.tsx`, `LabPhysics.tsx`, `liquids.tsx`,
  `CameraRig.tsx`, and `apparatus/*` (`Burette3D`, `Vessels3D`, `Flask3D`, …).
- **Interaction layer** — `3d/interactions/*` (`carry`, `pour`, `hold`,
  `mounting`, `lookTarget`, `pour-actions`, `drops`) and `3d/simulation/*`
  (`spatial`, `stopcock`, `keymap`, `flow`, `apparatus-state`, `fluidTransfer`),
  plus `3d/interactions.tsx` (selection, placement zones, guide marker).
- **Chemistry domain** — `domain/simulation/titration/*`: `engine`, `hidden`,
  `endpoint`, `reading`, `config`, `protocol`, `dispatch`, `workflow`,
  `snapshot`, `persistence`, `public-view`, `schema`.
- **Application services** — `application/attempts/*`: `apply-simulation-action`,
  `lab-state`, `lab-transport`, `submit-attempt`, `grade-attempt`,
  `report-answers`.
- **Persistence** — Supabase repositories (`attempts`, `experiments`, `grades`),
  RLS migrations under `supabase/migrations`.
- **UI** — the immersive shell (`immersive-lab`, `LabBench3D`,
  `lab-state-provider`, `view-model`), the HUD (`3d/ui/*`), the panels
  (`procedure-panel`, `action-panel`, `preparation-controls`,
  `titration-controls`, `calculation-panel`, `review-submit-panel`), the report
  route and the grading path.

The pre-existing physical model (carry/pour/mount/stopcock/flow) and the
protocol/validation/audit/persistence layers were reused unchanged in spirit.

## 2. What was reused

- The whole titration engine and hidden-truth model — no second chemistry engine.
- The single versioned protocol envelope and the one autosave write path
  (`applyTitrationAction`) — no second persistence path.
- The generic trials/measurements/observations/calculations rows and the report
  and grading systems.
- `HOLD_SPECS` (pourable / mounts / home / role) as the effective capability
  table for objects.
- The existing drag/carry/pour/stopcock simulation modules.

## 3. What was changed

### Domain

- **New `domain/simulation/titration/world.ts`.** The physical world of one
  stage: `StageWorld` (burette mounted, stopcock angle, cylinder level, waste
  volume, spill), the instrument **observation** (`stageWorldObservation`,
  `worldBuretteReadingMl`, `worldBalanceDisplayG`), and `readingDeviationMl`.
  Three layers are kept rigorously apart: WORLD OBSERVATION (what the apparatus
  shows), EXPERIMENTAL RECORD (what the student wrote), ACADEMIC WORK (their
  calculations) — §28/§29.
- **`hidden.ts` / `snapshot.ts`.** Hidden truth gained the beaker tare; the world
  observation is recomputed deterministically on every projection and is never
  persisted as a derived value. Snapshot upcasts an older document to a clean
  bench.
- **`engine.ts`.** New physical actions: `mountBurette`, `addKhp`,
  `placeBeakerOnBalance`, `setStopcockAngle`, `spillTitrant`,
  `recordCylinderVolume`, `submitCalculation`, `applyPhysicalPatch`,
  `setProcedureStep`; fill now requires a mounted burette; adding the standard is
  refused while the beaker is on the pan (weighing **by difference**).
- **`protocol.ts` → v5.** Added `mount_burette`, `add_khp`,
  `place_beaker_on_balance`, `set_stopcock_angle`, `spill_titrant`,
  `record_cylinder_volume`, `submit_calculation`, and an optional bounded
  `physical` patch plus `procedureStep` on the envelope.
- **`dispatch.ts`.** Physical gates live here (mounted before fill, pan loaded
  before weighing, waste discarded before a later trial) plus the
  `submit_calculation` whitelist. **`report_molarity` no longer returns any
  verdict** — there is no field for one.
- **`snapshot.ts` / `persistence.ts`.** Added `readingAccuracyRows`: the
  instrument observation beside the student's recorded value and the deviation
  between them, so `measurements.deviation` / `server_validated` are finally
  populated.

### Application

- `apply-simulation-action`: applies the bounded `physical` patch and the
  persisted procedure step; syncs the student's own `submit_calculation` values
  into `calculation_submissions` as an audit trail (no marking).
- `lab-transport` / `lab-action-controller`: the pre-submission verdict plumbing
  was removed.
- No new tables were required.

### UI

- `lab-state-provider`: the student's procedure step now rides along with every
  action; the unused `helpOpen` / `accessibilityOpen` / `recorder` state is wired
  to real surfaces.
- `view-model` / `calculation-panel`: pre-submission correctness wording removed;
  the panel records values and states plainly that marking happens after
  submission.
- New teaching surfaces: `3d/ui/StepCard.tsx` (§25 one written step at a time),
  `3d/ui/HelpOverlay.tsx` (§26 explains and points, performs nothing),
  `3d/ui/RecorderOverlay.tsx` (§28 one recorder for the reading that is waiting).
- `LabHud`: `Interact / Record / Procedure / Accessible lab / Results / Help`.
  The former "Actions" button is now the **accessible laboratory** (§35): the
  same steps as buttons, hidden by default.

## 4. What was removed

- Student-facing pre-submission correctness verdicts and their copy.
- The "Actions" rail as the primary way to perform the experiment (it is now the
  labelled accessible fallback inside a drawer).

## 5. New 3D interaction architecture

The bench is the primary interface. Interactions are physical: pick up, carry,
rotate, tip to pour, clamp the burette, turn the stopcock handle, set vessels
down over zones. Capabilities are object-specific (`HOLD_SPECS`, `PLACEMENT_ZONES`,
`holdReleaseFor`), invalid placements are explained rather than silently refused,
and the accessible surfaces reuse the same domain actions.

## 6. Physical interaction system

- Carry/hold with a pose (yaw + tilt); tilt crosses a threshold to pour.
- Pour flow reuses the stopcock rate curve, so "slow" has one definition.
- Placement zones (under-burette / balance / waste / transfer) drive validity and
  snapping; releases map to `discard_to_waste`, `place_beaker_on_balance`, etc.

## 7. Burette implementation

Grabbable and mountable on the clamp; a charged burette cannot be lifted off.
The stopcock is dragged through its quarter turn (closed → slow → medium → fast);
flow is continuous (`flow.ts`), the glass level decreases and the flask
increases, and titrant run out with no trial open is recorded as a spill.

## 8. Balance implementation

The pan is an instrument: `placeBeakerOnBalance` sets the world fact and the
display is derived (`worldBalanceDisplayG`). The student reads two masses and
subtracts; `add_khp` is refused while the beaker is on the pan.

## 9. Flask implementation

Pickable, movable, placeable under the burette, swirlable; disposal over the
waste zone is wired to `discard_to_waste`.

## 10. Measuring cylinder implementation

Pickable, pourable, measurable; its level is a world fact
(`cylinderVolumeMl`), and the aliquot/stock volumes remain the student's own
recorded numbers.

## 11. Liquid transfer implementation

Deterministic, state-driven (`deliveredSoFarMl`, cylinder level, spill) rather
than a fluid solver — §34.

## 12. Procedure integration

`StepCard` shows one written step with Previous/Next and links to the full
procedure; the step is UI-first and persisted with the student's next action, so
a resume opens where they left off.

## 13. Raw-data recording

Measurements are appended with server validation, and each instrument reading is
paired with the student's own value and their deviation — the accuracy signal
used for assessment without correcting the student.

## 14. Student calculation workflow

The student types their own value (`report_molarity` for the per-trial
concentration, `submit_calculation` for the other declared calculations). Both
are stored; no verdict is returned while the practical is live.

## 15. Student question workflow

Unchanged: report questions are answered on the report page and gate submission.

## 16. Report integration

Sections (aim, procedure, results, conclusion, safety) plus answers, saved as a
draft and frozen on submission; the report distinguishes raw observations from
the student's own academic work.

## 17. Security

Hidden truth stays in `attempt_secrets`; the client receives only the public
projection. No expected value, seed, endpoint truth or rubric detail crosses to
the browser, and no verdict is returned before submission. Grade writes remain
service-role only.

## 18. Database changes

None. The new state lives in the existing snapshot document, hidden-truth keys
and the existing measurement/calculation rows.

## 19. Persistence / resume

The world reconstructs from meaningful state (mounted, valve angle, cylinder
level, waste, spill, recorded readings, procedure step). High-frequency render
state is deliberately not persisted.

## 20. Testing results

- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npx vitest run` — **545 passed, 12 skipped** across 65 files.
- `npm run build` — compiled successfully.
- New: `tests/ui/lab-teaching-surfaces.test.tsx` (step card + persistence of the
  step, help that performs nothing, the recorder, and the pure recorder spec).
- **Skipped (not verified):** `tests/integration/lab-flow.test.ts` (2),
  `persistence.test.ts` (4), `rls.test.ts` (6) — live Supabase credentials are
  not set. Production RLS and the live write path are **not** claimed as
  verified.

## 21. Known limitations

- Only the per-trial concentration is auto-marked after submission; the other
  `submit_calculation` values are recorded but not marked (no declared expected
  value exists for them yet).
- `concordance.averageMolarityM` (derived from the student's **own** reported
  values, never hidden truth) is still shown in the Part III working as the
  standardised NaOH to carry forward — it is not an answer key, but §20's
  preference for the student to compute their own average is only partly met.
- Accessibility beyond the accessible-lab drawer (full keyboard-only operation
  of every 3D gesture) is partially covered.
- The chemistry provenance remains `accuracy: "assumed"`; it was **not**
  promoted to verified.

## 22. Remaining work

- Declare expected values (server-side only) for the intermediate calculations
  so they can be graded at submission.
- Optionally remove the server-computed average from the live UI entirely.
- Extend the keyboard/assistive path over the remaining gestures.
- (Out of scope this phase.) Phase 8 instructor dashboard.

## Acceptance table

| Requirement | Status |
|---|---|
| Full-screen 3D laboratory | PASS |
| Physical object pickup | PASS |
| Physical object movement | PASS |
| Physical object placement | PASS |
| Physical pouring | PASS |
| Burette manipulation | PASS |
| Physical stopcock | PASS |
| Liquid flow | PASS |
| Meniscus reading | PASS |
| Balance interaction | PASS |
| KHP weighing | PASS |
| Flask manipulation | PASS |
| Swirling | PASS |
| Measuring cylinder | PASS |
| HCl transfer | PASS |
| Waste disposal | PASS |
| Raw data recording | PASS |
| Student calculations | PASS (recorded; only concentration auto-marked) |
| Student questions | PASS |
| Server-side grading | PASS |
| Hidden answer security | PASS |
| Persistence/resume | PASS |
| RLS/security | SKIPPED — live Supabase not available, not verified |
| Experiment 2 end-to-end | PASS in component/domain tests; live DB path not verified |
