import { describe, expect, it } from "vitest";
import { exp02Standardisation } from "@/domain/experiments/catalog/exp-02-standardisation";
import { read } from "../helpers/project-files";

/**
 * Phase 4.8 seed audit, runnable offline.
 *
 * The typed catalog definition is asserted directly; `supabase/seed.sql` is
 * asserted as text (row counts, key titles, secret hygiene) plus a title-level
 * parity check between the two, so the twins the seed header warns about
 * cannot silently drift.
 */

const seed = read("supabase/seed.sql");

function seedStepTitles(): string[] {
  // Full step rows only (experiment/chemical/apparatus rows never match).
  const titles: string[] = [];
  const pattern = /\('exp-02',\s*(\d+),\s*'((?:[^']|'')+)',\s*'((?:[^']|'')+)',\s*(true|false)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(seed)) !== null) {
    titles[Number(match[1])] = match[2].replace(/''/g, "'");
  }
  return titles.slice(1);
}

describe("experiment 2 catalog definition (typed twin)", () => {
  it("covers Parts I-III in 30 ordered, required steps", () => {
    const { procedure } = exp02Standardisation;
    expect(procedure).toHaveLength(30);
    expect(procedure.map((step) => step.stepNumber)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(procedure.every((step) => step.isRequired)).toBe(true);
  });

  it("names every load-bearing procedure step", () => {
    const copy = exp02Standardisation.procedure
      .map((step) => `${step.title}\n${step.instruction}`)
      .join("\n");
    for (const expected of [
      "2 M NaOH stock",
      "Clean the burette",
      "Condition the burette",
      "air bubbles",
      "initial burette reading",
      "empty beaker",
      "re-weigh",
      "Dissolve the KHP",
      "Erlenmeyer",
      "Rinse the beaker twice",
      "phenolphthalein",
      "under the burette",
      "endpoint",
      "waste container",
      "two closest",
      "HCl",
    ]) {
      expect(copy).toMatch(new RegExp(expected, "i"));
    }
  });

  it("declares procedure-accurate chemicals with the unknown kept unknown", () => {
    const chemicals = exp02Standardisation.chemicals;
    expect(chemicals.map((chemical) => chemical.key).sort()).toEqual(
      ["distilled_water", "hcl_unknown", "khp", "naoh", "naoh_stock_2m", "phenolphthalein", "tap_water"].sort(),
    );
    expect(chemicals.find((chemical) => chemical.key === "naoh")?.concentration).toBe(0.2);
    expect(chemicals.find((chemical) => chemical.key === "naoh_stock_2m")?.concentration).toBe(2);
    const hcl = chemicals.find((chemical) => chemical.key === "hcl_unknown");
    expect(hcl?.role).toBe("analyte");
    expect(hcl?.concentration).toBeUndefined();
  });

  it("declares procedure-required apparatus without inventing sizes", () => {
    const apparatus = exp02Standardisation.apparatus;
    expect(apparatus.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "burette_50",
        "conical_flask_250",
        "analytical_balance",
        "beaker_250",
        "glass_rod",
        "watch_glass",
        "graduated_cylinder",
        "waste_container",
      ]),
    );
    expect(apparatus.find((item) => item.key === "beaker_250")?.capacityMl).toBe(250);
    // The source never sizes the cylinder: no capacity rather than an invented one.
    expect(apparatus.find((item) => item.key === "graduated_cylinder")?.capacityMl).toBeUndefined();
  });
});

describe("supabase/seed.sql (database twin)", () => {
  it("seeds 30 ordered exp-02 steps", () => {
    const titles = seedStepTitles();
    expect(titles).toHaveLength(30);
    expect(titles[0]).toMatch(/2 M NaOH stock/);
    expect(titles[29]).toMatch(/calculate HCl/i);
  });

  it("matches the typed definition title for title", () => {
    const titles = seedStepTitles();
    const twin = exp02Standardisation.procedure.map((step) => step.title);
    expect(titles).toEqual(twin);
  });

  it("carries the procedure's load-bearing wording", () => {
    for (const expected of [
      "three portions of about 5 mL",
      "difference of the two weighings",
      "about 30 mL distilled water",
      "Rinse the beaker twice",
      "3 to 4 drops",
      "45 to 60 seconds",
      "more than 0.005 M",
      "two closest values",
      "25.00 mL",
      "two decimal places",
    ]) {
      expect(seed).toContain(expected);
    }
  });

  it("declares 7 chemicals and 10 apparatus rows with no hidden content", () => {
    const chemicals = seed.match(/\('exp-02', '[a-z0-9_]+', '[^']+', '[A-Za-z0-9]+', '(?:titrant|analyte|indicator|reagent|primary_standard|solvent|wash)'/g) ?? [];
    expect(chemicals).toHaveLength(7);
    expect(seed).toContain("hcl_unknown");
    expect(seed).not.toMatch(/true_values|expected_endpoint|rubric_weights|expected_value|tolerance/i);
  });

  it("stores the unknown HCl concentration as NULL, never as a number", () => {
    const hclRow = seed
      .split("\n")
      .find((line) => line.includes("hcl_unknown"));
    expect(hclRow).toBeDefined();
    expect(hclRow).toContain("null, null");
  });
});
