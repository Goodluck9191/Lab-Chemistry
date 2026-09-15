-- =============================================================================
-- Seed data: exactly one sample experiment.
--
-- Stage 1 needs just enough data to prove the architecture end to end:
--   student -> sees an experiment -> starts an attempt -> the attempt is stored.
-- The other 16 experiments are deliberately NOT seeded yet.
--
-- NOTE ON CONTENT: the canonical, typed definition of this experiment lives in
-- domain/experiments/catalog/exp-02-standardisation.ts. This row is its database
-- projection for Stage 1; a config-to-database seeder in a later stage will
-- generate the SQL from the TypeScript definition so the two cannot drift.
--
-- All chemistry here is a plausible textbook value, not a value from the
-- university practical manual (`accuracy = 'assumed'`).
-- =============================================================================

insert into public.experiments (
  id, experiment_number, slug, title, description, aim, theory, safety,
  type, subtype, status, order_index, config, config_version, accuracy
)
values (
  'exp-02',
  2,
  'standardisation-of-naoh-with-khp',
  'Standardisation of sodium hydroxide solution using potassium hydrogen phthalate',
  'Standardise a sodium hydroxide solution against potassium hydrogen phthalate (KHP), an acid primary standard.',
  'To determine the exact concentration of a sodium hydroxide solution by titration against weighed portions of potassium hydrogen phthalate, and to compare replicate titres for concordance.',
  'Potassium hydrogen phthalate (KHC8H4O4, molar mass approximately 204.22 g/mol) is a monoprotic weak acid and a suitable primary standard: it is pure, stable, non-hygroscopic and of high molar mass, so weighing errors are small. Sodium hydroxide absorbs carbon dioxide from air and cannot be prepared to an exact concentration, so it must be standardised against a primary standard. The neutralisation is 1:1 (KHC8H4O4 + NaOH -> KNaC8H4O4 + H2O), so at the equivalence point the moles of NaOH equal the moles of KHP. Phenolphthalein is colourless in acid and pink in alkali, so a persistent pale pink marks the endpoint.',
  array[
    'Wear safety goggles and a laboratory coat at all times.',
    'Sodium hydroxide is corrosive: rinse skin contact immediately with plenty of water.',
    'Never pipette by mouth; always use a pipette filler.',
    'Handle the burette with care; it is fragile and expensive.',
    'Read every label before dispensing a reagent.'
  ],
  'titration',
  'acid_base',
  'published',
  2,
  -- PUBLIC projection only. Hidden parameter generators stay server-side.
  jsonb_build_object(
    'titrant', 'NaOH',
    'analyte', 'KHP',
    'stoichiometricRatio', 1,
    'indicator', 'phenolphthalein',
    'requiredTrials', 3
  ),
  1,
  'assumed'
)
on conflict (id) do nothing;

insert into public.experiment_steps (experiment_id, step_number, title, instruction, is_required)
values
  ('exp-02', 1, 'Rinse and fill the burette',
   'Rinse the burette with a little of the sodium hydroxide solution, fill it, and expel air bubbles from the tip.', true),
  ('exp-02', 2, 'Record the initial reading',
   'Read the bottom of the meniscus against a light background and record the initial burette reading to two decimal places.', true),
  ('exp-02', 3, 'Weigh the primary standard',
   'Weigh accurately, by difference, between 0.4 g and 0.6 g of dried potassium hydrogen phthalate into a clean conical flask.', true),
  ('exp-02', 4, 'Dissolve the standard',
   'Dissolve the weighed KHP in about 50 mL of distilled water and swirl until the solution is clear.', true),
  ('exp-02', 5, 'Add the indicator',
   'Add two to three drops of phenolphthalein indicator to the flask.', true),
  ('exp-02', 6, 'Titrate to the endpoint',
   'Titrate with sodium hydroxide, swirling continuously, until a pale pink colour persists for 30 seconds.', true),
  ('exp-02', 7, 'Record the final reading and repeat',
   'Record the final burette reading, then repeat the titration until three concordant titres are obtained.', true)
on conflict (experiment_id, step_number) do nothing;

insert into public.experiment_chemicals (
  experiment_id, chemical_key, name, formula, role, concentration, concentration_unit,
  hazard_codes, is_required
)
values
  ('exp-02', 'naoh', 'Sodium hydroxide solution', 'NaOH', 'titrant', 0.1, 'mol/L',
   array['H290', 'H314'], true),
  ('exp-02', 'khp', 'Potassium hydrogen phthalate', 'KHC8H4O4', 'primary_standard', null, null,
   array[]::text[], true),
  ('exp-02', 'phenolphthalein', 'Phenolphthalein indicator', 'C20H14O4', 'indicator', 0.5,
   '% w/v', array[]::text[], true),
  ('exp-02', 'distilled_water', 'Distilled water', 'H2O', 'solvent', null, null,
   array[]::text[], true)
on conflict (experiment_id, chemical_key) do nothing;

insert into public.experiment_apparatus (
  experiment_id, apparatus_key, name, capacity_ml, graduation_ml, is_required
)
values
  ('exp-02', 'burette_50', 'Burette, 50 mL', 50, 0.1, true),
  ('exp-02', 'conical_flask_250', 'Conical flask, 250 mL', 250, null, true),
  ('exp-02', 'weighing_bottle', 'Weighing bottle', null, null, true),
  ('exp-02', 'analytical_balance', 'Analytical balance (0.1 mg)', null, null, true),
  ('exp-02', 'wash_bottle', 'Wash bottle', null, null, true)
on conflict (experiment_id, apparatus_key) do nothing;
