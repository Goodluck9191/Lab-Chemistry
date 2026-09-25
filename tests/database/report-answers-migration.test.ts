import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260925090001_report_answers.sql"),
  "utf8",
);

/**
 * Offline audit of the report-answers migration: student answers need a
 * home that follows the report lifecycle without duplicating tables or
 * weakening the grading boundary.
 */
describe("report answers migration (offline audit)", () => {
  it("adds a answers object column with a safe default", () => {
    expect(migration).toMatch(/alter table public\.reports\s+add column if not exists answers jsonb not null default '\{\}'::jsonb/i);
    expect(migration).toMatch(/reports_answers_obj/);
    expect(migration).toMatch(/jsonb_typeof\(answers\) = 'object'/);
  });

  it("grants the student answers writes and nothing else", () => {
    expect(migration).toMatch(/grant insert \(answers\) on public\.reports to authenticated/i);
    expect(migration).toMatch(/grant update \(answers\) on public\.reports to authenticated/i);
    const code = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/grades/);
    expect(code).not.toMatch(/calculation_submissions/);
    expect(code).not.toMatch(/expected_value/);
  });

  it("keeps chemistry and grading out of SQL", () => {
    expect(migration).not.toMatch(/create (or replace )?function/i);
    expect(migration).not.toMatch(/molarity|endpoint|titration/i);
  });
});
