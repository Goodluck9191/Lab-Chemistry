import { describe, expect, it } from "vitest";
import { read } from "../helpers/project-files";

/**
 * Phase 4.8 migration audit, runnable offline.
 *
 * Without live credentials the migration cannot be applied here, so this suite
 * pins its structural properties as text: additive change only, grants
 * re-issued for the new column, no new tables, no chemistry in SQL, no hidden
 * exposure, and a self-verifying catalog repair.
 */

const migration = read(
  "supabase/migrations/20260918090001_audit_experiment2_procedure_support.sql",
);

/**
 * Source with comments removed, mirroring tests/security/dev-preview.test.ts:
 * the checks below are about what the migration DOES. A doc comment that names
 * attempt_secrets to explain why it is avoided must not read as a violation.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const code = codeOnly(migration);

describe("procedure-support migration (offline audit)", () => {
  it("adds trial stage attribution additively, without touching secrets", () => {
    expect(code).toContain("add column if not exists stage_key");
    expect(code).toContain("stage_key");
    expect(code).not.toMatch(/attempt_secrets/i);
    expect(code).not.toMatch(/expected_value|tolerance|is_correct|final_score/i);
  });

  it("re-issues the trial grants with the new column and nothing else", () => {
    expect(code).toMatch(/grant insert \([^)]*stage_key[^)]*\)/i);
    expect(code).toMatch(/grant update \([^)]*stage_key[^)]*\)/i);
    expect(code).not.toMatch(/grant\s+(delete|truncate)/i);
  });

  it("creates no tables, functions, or chemistry computation in SQL", () => {
    // Catalog copy legitimately names molarities; what is forbidden is
    // computation: function definitions, plpgsql assignment, and chemistry
    // identifiers. The verification DO block only counts and raises.
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/create\s+(or replace\s+)?function/i);
    expect(code).not.toMatch(/:=/);
    expect(code).not.toMatch(/molar_mass|equivalence_ml|stoichiometry/i);
  });

  it("repairs the exp-02 catalog without inventing unknowns", () => {
    const steps = migration.match(/\('exp-02',\s*\d+,/g) ?? [];
    expect(steps).toHaveLength(30);
    expect(migration).toContain("hcl_unknown");
    // The unknown stays unknown: asserted in SQL and never given a number.
    expect(migration).toMatch(/unknown HCl concentration must never be stored/);
    expect(migration).not.toMatch(/on conflict \(experiment_id, step_number\) do nothing/i);
  });

  it("fails loudly instead of half-applying", () => {
    expect(migration).toMatch(/raise exception/i);
    expect(migration).toMatch(/expected 30 steps/);
    expect(migration).toMatch(/expected 7 chemicals/);
    expect(migration).toMatch(/expected 10 apparatus/);
  });

  it("documents what it refuses to do", () => {
    expect(migration).toMatch(/DOES NOT DO/i);
    expect(migration).toMatch(/no chemistry functions in SQL/i);
  });
});
