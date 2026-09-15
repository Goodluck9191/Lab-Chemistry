import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_TYPES,
  TITRATION_SUBTYPES,
  experimentDefinitionSchema,
  exp02Standardisation,
} from "@/domain/experiments";
import { projectPath, typeScriptFiles } from "../helpers/project-files";

const validTitration = {
  id: "exp-99",
  number: 99,
  slug: "example-titration",
  title: "An example titration",
  description: "",
  aim: "To check the schema.",
  theory: "Some theory.",
  safety: ["Wear goggles."],
  status: "draft" as const,
  orderIndex: 99,
  type: "titration" as const,
  subtype: "acid_base" as const,
  engine: { kind: "titration" as const, family: "acid_base_strong_strong", parameters: {} },
  procedure: [{ stepNumber: 1, title: "Step", instruction: "Do it.", isRequired: true }],
  chemicals: [
    { key: "a", name: "A", role: "titrant" as const, hazardCodes: [], isRequired: true },
  ],
  apparatus: [{ key: "b", name: "B", isRequired: true }],
  calculations: [
    {
      key: "c",
      prompt: "Compute.",
      unit: "mol/L",
      decimalPlaces: 4,
      tolerance: { kind: "relative" as const, value: 0.01 },
    },
  ],
  observations: [],
  gradingRules: [
    { key: "g", category: "technique" as const, points: 100, description: "Technique." },
  ],
  configVersion: 1,
  accuracy: "assumed" as const,
};

describe("experiment domain types", () => {
  it("exposes the four experiment runtimes and four titration subtypes", () => {
    expect(EXPERIMENT_TYPES).toEqual(["titration", "gravimetric", "synthesis", "conductometry"]);
    expect(TITRATION_SUBTYPES).toEqual([
      "acid_base",
      "redox",
      "precipitation",
      "complexometric",
    ]);
  });

  it("accepts a well-formed titration definition", () => {
    expect(experimentDefinitionSchema.safeParse(validTitration).success).toBe(true);
  });

  it("parses the seeded sample experiment", () => {
    expect(exp02Standardisation.id).toBe("exp-02");
    expect(exp02Standardisation.type).toBe("titration");
    expect(exp02Standardisation.subtype).toBe("acid_base");
    expect(exp02Standardisation.accuracy).toBe("assumed");
  });

  it("rejects a non-titration definition that carries a titration subtype", () => {
    const invalid = {
      ...validTitration,
      type: "gravimetric",
      subtype: "acid_base",
      engine: { kind: "gravimetric", family: "constant_mass", parameters: {} },
    };
    expect(experimentDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects grading rules that do not total 100 points", () => {
    const invalid = {
      ...validTitration,
      gradingRules: [
        { key: "g", category: "technique" as const, points: 60, description: "Technique." },
      ],
    };
    expect(experimentDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an engine kind that does not match the experiment type", () => {
    const invalid = {
      ...validTitration,
      engine: { kind: "conductometry" as const, family: "x", parameters: {} },
    };
    expect(experimentDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects duplicate procedure step numbers", () => {
    const invalid = {
      ...validTitration,
      procedure: [
        { stepNumber: 1, title: "A", instruction: "a", isRequired: true },
        { stepNumber: 1, title: "B", instruction: "b", isRequired: true },
      ],
    };
    expect(experimentDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects malformed experiment ids", () => {
    expect(
      experimentDefinitionSchema.safeParse({ ...validTitration, id: "experiment-2" }).success,
    ).toBe(false);
  });
});

describe("architecture: experiments stay configuration-driven", () => {
  const domainFiles = typeScriptFiles("domain");

  it("keeps the domain layer free of React, Next.js and Supabase imports", () => {
    const offenders = domainFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'](react|next|@supabase)/.test(source);
    });

    expect(offenders.map(projectPath)).toEqual([]);
  });

  it("never hard-codes a numbered experiment in the domain outside the catalog", () => {
    const offenders = domainFiles
      .filter((file) => !file.includes("catalog"))
      .filter((file) => /(["'])exp-[0-9]{2}/.test(readFileSync(file, "utf8")));

    expect(offenders.map(projectPath)).toEqual([]);
  });
});
