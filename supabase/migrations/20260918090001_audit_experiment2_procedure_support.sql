-- =============================================================================
-- 0007 audit: Experiment 2 procedure support (Phase 4.8)
--
-- AUDIT FINDINGS (procedure vs database, verified against the supplied
-- ACID-BASE TITRATION procedure, Parts I-III):
--
--  1. experiment_trials had no stage column. Trial-to-stage mapping lived only
--     in the shared trial_number ranges plus the snapshot, so a grading query
--     could not ask "all Stage B trials of this attempt" from the table.
--     Fixed additively: nullable `stage_key`, written for new rows, NULL for
--     rows written before procedure tracking (no backfill invented).
--
--  2. The exp-02 catalog rows were the Stage-1 sketch (7 steps, 4 chemicals,
--     5 apparatus, accuracy 'assumed'): no Part I dilution, no Part III HCl,
--     cleaning/conditioning/air-bubble/dissolve/transfer/rinses/placement/
--     disposal missing, wrong vessel on weighing, "50 mL" vs ~30 mL, "two to
--     three drops" vs 3-4, "30 seconds" vs 45-60 s, NaOH listed at 0.1 M vs
--     the ~0.2 M working strength. Fixed by replacing the exp-02 catalog rows
--     with the procedure-accurate set. The accuracy flag stays 'assumed': the
--     copy review that promotes it is a separate decision.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (per audit rules):
--  - no per-click tables (repeats live as counters in the snapshot);
--  - no chemistry functions in SQL (domain calculates, database stores);
--  - no hidden-value exposure (no grant touches attempt_secrets or the
--    calculation answer-key columns);
--  - no old-migration rewrites; old snapshots resume via additive defaults.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trial stage attribution (additive, nullable, no backfill invented).
-- -----------------------------------------------------------------------------
alter table public.experiment_trials
  add column if not exists stage_key text;

comment on column public.experiment_trials.stage_key is
  'Stage that ran the trial (e.g. stage-a-khp-naoh). Written for new rows; NULL for rows written before procedure tracking. Stage never feeds back into the engine: resume reads the snapshot.';

-- The RLS insert/update column grants are explicit lists, so the new column
-- must be granted or writes of it are refused. Grants are re-issued whole
-- (GRANT is idempotent); every other column is unchanged.
revoke all on public.experiment_trials from anon, authenticated;

grant select on public.experiment_trials to authenticated;
grant insert (attempt_id, trial_number, status, initial_reading, final_reading,
              titre_volume, endpoint_observed, rejection_reason, stage_key)
  on public.experiment_trials to authenticated;
grant update (status, initial_reading, final_reading, titre_volume,
              endpoint_observed, rejection_reason, stage_key)
  on public.experiment_trials to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Experiment 2 catalog repair.
--
-- Steps are one row per MEANINGFUL procedure step; counted repeats (3x
-- conditioning, 2x rinses, 3-4 trials) stay counters in the snapshot, not rows.
-- Chemicals distinguish stock / working / unknown / solvent / wash, with the
-- unknown HCl concentration deliberately NULL (never stored, never readable).
-- Apparatus lists only procedure-required ware with verified sizes; the
-- graduated cylinder size is unstated in the source, so its capacity is NULL
-- rather than invented. No volumetric flask, no stopper: unused by Parts I-III.
-- -----------------------------------------------------------------------------

-- Steps: replaced wholesale (student attempt data never references these rows:
-- observations carry step_key as free text, so nothing orphans).
delete from public.experiment_steps where experiment_id = 'exp-02';

insert into public.experiment_steps (experiment_id, step_number, title, instruction, is_required)
values
  ('exp-02', 1, 'Measure the 2 M NaOH stock',
   'Using a measuring cylinder, measure out the 2 M NaOH stock solution for dilution to approximately 0.2 M.', true),
  ('exp-02', 2, 'Dilute to approximately 0.2 M NaOH',
   'Transfer the measured stock to a clean flask and add distilled water to complete the dilution.', true),
  ('exp-02', 3, 'Swirl to mix',
   'Stopper the flask as much as possible and swirl to mix the contents thoroughly.', true),
  ('exp-02', 4, 'Clean the burette',
   'Rinse the burette with several portions of about 10 mL tap water and drain.', true),
  ('exp-02', 5, 'Obtain NaOH in a beaker',
   'Obtain about 120 mL of the prepared NaOH solution in a clean, dry 250 mL beaker and cover with a watch glass.', true),
  ('exp-02', 6, 'Condition the burette',
   'Rinse the burette with three portions of about 5 mL of the NaOH solution, draining each portion.', true),
  ('exp-02', 7, 'Fill the burette',
   'Fill the burette with the prepared NaOH to slightly above the zero mark and clamp the burette vertically.', true),
  ('exp-02', 8, 'Remove air bubbles',
   'Drain NaOH through the tip into a small beaker until no air bubbles remain.', true),
  ('exp-02', 9, 'Record the initial burette reading',
   'Read the bottom of the meniscus to within ±0.02 mL and record the initial reading to two decimal places.', true),
  ('exp-02', 10, 'Weigh the empty beaker',
   'Weigh a clean and dry 250 mL beaker on the analytical balance to ±0.01 g and record the mass.', true),
  ('exp-02', 11, 'Add KHP and re-weigh',
   'Add about 0.6 g of dried KHP to the beaker and re-weigh to ±0.01 g. The sample mass is the difference of the two weighings.', true),
  ('exp-02', 12, 'Dissolve the KHP',
   'Add about 30 mL distilled water to the beaker and stir with a glass rod until the solution is clear.', true),
  ('exp-02', 13, 'Transfer to the Erlenmeyer flask',
   'Transfer the KHP solution into a clean 250 mL Erlenmeyer flask.', true),
  ('exp-02', 14, 'Rinse the beaker twice',
   'Rinse the beaker twice with about 5 mL distilled water, transferring each rinse into the flask.', true),
  ('exp-02', 15, 'Add phenolphthalein',
   'Add 3 to 4 drops of phenolphthalein indicator to the flask.', true),
  ('exp-02', 16, 'Place the flask under the burette',
   'Place the flask on the white tile, aligned under the burette tip.', true),
  ('exp-02', 17, 'Titrate with swirling',
   'Add NaOH from the burette with continuous swirling until a faint pink colour appears.', true),
  ('exp-02', 18, 'Observe the endpoint',
   'The faint pink must persist 45 to 60 seconds, with a one-drop difference between colourless and pink. An overshot endpoint is discarded and repeated.', true),
  ('exp-02', 19, 'Record the final burette reading',
   'Read the bottom of the meniscus to within ±0.02 mL and record the final reading to two decimal places.', true),
  ('exp-02', 20, 'Discard into the waste container',
   'Discard the flask contents into the waste container so the next trial starts clean.', true),
  ('exp-02', 21, 'Repeat the titration',
   'Repeat for three trials. Perform a fourth titration if the calculated molarities vary by more than 0.005 M.', true),
  ('exp-02', 22, 'Calculate the NaOH molarity',
   'Calculate the NaOH molarity for each valid trial and average the two closest values.', true),
  ('exp-02', 23, 'Refill and zero the burette',
   'Refill the burette with the standardized NaOH and prepare it for the HCl determination.', true),
  ('exp-02', 24, 'Record the initial NaOH reading',
   'Read the bottom of the meniscus to within ±0.02 mL and record to two decimal places.', true),
  ('exp-02', 25, 'Measure the HCl aliquot',
   'Using the measuring cylinder, transfer approximately 25.00 mL of the unknown HCl solution into a clean, dry flask.', true),
  ('exp-02', 26, 'Record the HCl volume',
   'Record the actual delivered HCl volume, known to two decimal places.', true),
  ('exp-02', 27, 'Add phenolphthalein to the HCl',
   'Add 3 to 4 drops of phenolphthalein indicator to the flask.', true),
  ('exp-02', 28, 'Titrate the HCl to the endpoint',
   'Place the flask under the NaOH burette and titrate with swirling to the faint pink endpoint.', true),
  ('exp-02', 29, 'Record the final NaOH reading',
   'Read the bottom of the meniscus to within ±0.02 mL and record to two decimal places.', true),
  ('exp-02', 30, 'Discard, repeat and calculate HCl',
   'Discard into waste. Repeat for three trials (a fourth if the spread exceeds 0.005 M), average the two closest HCl molarities, and note the measurement uncertainties.', true);

-- Chemicals: corrected strength (0.1 -> ~0.2 M working NaOH) plus the missing
-- stock, unknown, and wash rows. The unknown HCl concentration stays NULL.
insert into public.experiment_chemicals (
  experiment_id, chemical_key, name, formula, role, concentration, concentration_unit,
  hazard_codes, is_required
)
values
  ('exp-02', 'naoh', 'Sodium hydroxide working solution (~0.2 M)', 'NaOH', 'titrant', 0.2, 'mol/L',
   array['H290', 'H314'], true),
  ('exp-02', 'naoh_stock_2m', 'Sodium hydroxide stock solution (2 M)', 'NaOH', 'reagent', 2, 'mol/L',
   array['H290', 'H314'], true),
  ('exp-02', 'khp', 'Potassium hydrogen phthalate', 'KHC8H4O4', 'primary_standard', null, null,
   array[]::text[], true),
  ('exp-02', 'phenolphthalein', 'Phenolphthalein indicator', 'C20H14O4', 'indicator', 0.5,
   '% w/v', array[]::text[], true),
  ('exp-02', 'hcl_unknown', 'Unknown hydrochloric acid solution', 'HCl', 'analyte', null, null,
   array[]::text[], true),
  ('exp-02', 'distilled_water', 'Distilled water', 'H2O', 'solvent', null, null,
   array[]::text[], true),
  ('exp-02', 'tap_water', 'Tap water', 'H2O', 'wash', null, null,
   array[]::text[], true)
on conflict (experiment_id, chemical_key) do update set
  name = excluded.name,
  formula = excluded.formula,
  role = excluded.role,
  concentration = excluded.concentration,
  concentration_unit = excluded.concentration_unit,
  hazard_codes = excluded.hazard_codes,
  is_required = excluded.is_required;

-- Apparatus: the existing five rows are untouched; only procedure-required ware
-- is added. Capacities the source does not state are NULL, not invented.
insert into public.experiment_apparatus (
  experiment_id, apparatus_key, name, capacity_ml, graduation_ml, is_required
)
values
  ('exp-02', 'beaker_250', 'Beaker, 250 mL', 250, null, true),
  ('exp-02', 'glass_rod', 'Glass stirring rod', null, null, true),
  ('exp-02', 'watch_glass', 'Watch glass', null, null, true),
  ('exp-02', 'graduated_cylinder', 'Graduated cylinder', null, null, true),
  ('exp-02', 'waste_container', 'Waste container', null, null, true)
on conflict (experiment_id, apparatus_key) do nothing;

-- -----------------------------------------------------------------------------
-- Self-verification: the migration fails loudly (rather than half-applying)
-- if the catalog repair did not land exactly as audited.
-- -----------------------------------------------------------------------------
do $$
declare
  step_count integer;
  chemical_count integer;
  apparatus_count integer;
begin
  select count(*) into step_count
    from public.experiment_steps where experiment_id = 'exp-02';
  if step_count <> 30 then
    raise exception 'exp-02 procedure repair expected 30 steps, found %', step_count;
  end if;

  select count(*) into chemical_count
    from public.experiment_chemicals where experiment_id = 'exp-02';
  if chemical_count <> 7 then
    raise exception 'exp-02 procedure repair expected 7 chemicals, found %', chemical_count;
  end if;

  select count(*) into apparatus_count
    from public.experiment_apparatus where experiment_id = 'exp-02';
  if apparatus_count <> 10 then
    raise exception 'exp-02 procedure repair expected 10 apparatus rows, found %', apparatus_count;
  end if;

  if exists (
    select 1 from public.experiment_chemicals
    where experiment_id = 'exp-02' and chemical_key = 'hcl_unknown'
      and concentration is not null
  ) then
    raise exception 'unknown HCl concentration must never be stored';
  end if;
end;
$$;
