import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { buildLabViewModel } from "@/components/lab/view-model";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { toPublicJSON } from "@/domain/simulation/titration/engine";
import { projectPath, typeScriptFiles } from "../helpers/project-files";
import { labStateViewFor } from "../helpers/lab-fixture";
import {
  STAGE_A,
  concordantStageASession,
  hiddenTruth,
  overshotStageASession,
  stageBReadySession,
} from "../helpers/titration-fixtures";

/**
 * SECURITY OF THE PHASE 4 SURFACE.
 *
 * The laboratory ships three things to the browser: the public session state, the
 * whitelisted configuration view and the state DTO. This suite asserts — from the
 * outside, over the serialised JSON — that none of them can carry the hidden
 * reality, and that no source file in the laboratory reaches for a privileged
 * module.
 */
/** Patterns that must never appear in code the browser can reach. */
const FORBIDDEN_IN_CLIENT_FILES = [
  /server-only/,
  /supabase/,
  /attempt_secrets/,
  /repositories\//,
  /hiddenRanges/,
  /deriveHiddenState/,
  /endpointBiasMl/,
  /readingNoiseMl/,
  /assessmentWeights/,
  /\.from\(\s*["']/,
  /gradeSession/,
];

function expectNoHiddenValues(serialised: string, forbidden: string[]): void {
  for (const key of HIDDEN_KEY_DENYLIST) {
    expect(serialised).not.toContain(`"${key}"`);
  }
  for (const value of forbidden) {
    expect(serialised).not.toContain(value);
  }
}

describe("phase 4 laboratory exposure", () => {
  it("ships a state DTO with no hidden key and no seed", () => {
    const session = concordantStageASession("lab-exposure-seed");
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session, { notices: ["catalog gap"] });

    // NOTE: the observable endpoint volume is deliberately NOT asserted here.
    // A student who stops at the endpoint records that same volume as their own
    // titre, so its presence would be their measurement, not a leak. What must
    // never appear is the hidden truth itself.
    expectNoHiddenValues(JSON.stringify(state), [
      "lab-exposure-seed",
      truth.trueTitrantMolarityM.toString(),
      truth.trueAnalyteMassG?.toString() ?? "unused",
      truth.analyteMoles.toString(),
      truth.equivalenceMl.toFixed(4),
      "equivalenceMl",
      "observableMl",
      "trueTitrantMolarityM",
      "rubricWeights",
    ]);
  });

  it("keeps the hidden endpoint out of the overshoot message it renders", () => {
    const session = overshotStageASession("lab-overshoot-seed");
    const truth = hiddenTruth(session, STAGE_A);
    const state = labStateViewFor(session);

    const serialised = JSON.stringify(state);
    expect(serialised).toContain("over_titration");
    expect(serialised).not.toContain(truth.observableMl.toFixed(2));
    expect(serialised).not.toContain(truth.equivalenceMl.toFixed(2));
    expect(serialised).not.toContain("observable");
  });

  it("keeps the stage-B answer out of the public state while the student titrates", () => {
    const session = stageBReadySession("lab-stage-b-seed");
    const truth = session.hidden.stages["stage-b-hcl-naoh"];
    const state = labStateViewFor(session);

    expectNoHiddenValues(JSON.stringify(state), [
      truth.trueAnalyteMolarityM?.toString() ?? "unused",
      truth.trueTitrantMolarityM.toString(),
      truth.equivalenceMl.toFixed(2),
    ]);
  });

  it("keeps browser-reachable laboratory code away from privileged modules", () => {
    // The development preview is excluded deliberately, and narrowly: its server
    // files are reached only by a dev-only route that 404s in production, and
    // `tests/security/dev-preview.test.ts` guards that directory directly —
    // including that no client file it ships touches the session at all. Every
    // other file under components/lab stays in scope here.
    const previewPrefix = "components/lab/preview/";
    const allFiles = [...typeScriptFiles("components/lab"), ...typeScriptFiles("app/(lab)")];
    const files = allFiles.filter((file) => !projectPath(file).startsWith(previewPrefix));

    expect(allFiles.length - files.length).toBeLessThan(6);
    expect(files.length).toBeGreaterThan(8);

    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_IN_CLIENT_FILES) {
        if (pattern.test(source)) offenders.push({ file, pattern: String(pattern) });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the shipped transport free of hidden-value references", () => {
    const transport = readFileSync("application/attempts/lab-transport.ts", "utf8");
    expect(transport).not.toMatch(/hiddenRanges|deriveHiddenState|endpointBiasMl|readingNoiseMl/);
    expect(transport).not.toMatch(/attempt_secrets|createAdminSupabaseClient/);
    expect(transport).not.toMatch(/getAttemptSecretsAdmin/);
  });

  it("does not put a server value in a NEXT_PUBLIC_ variable", () => {
    const envExample = readFileSync(".env.example", "utf8");
    const publicLines = envExample
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("NEXT_PUBLIC_"));
    for (const line of publicLines) {
      expect(line).not.toMatch(/SERVICE_ROLE|SECRET|SEED|PASSWORD/i);
    }
  });

  it("keeps the laboratory view model free of hidden keys and of React imports", () => {
    const serialised = JSON.stringify(
      buildLabViewModel({
        config: publicTitrationConfigView(exp02TitrationConfig),
        publicState: toPublicJSON(concordantStageASession("lab-view-seed")),
        chemicalLabels: {},
        apparatusLabels: {},
        selectedStageKey: null,
        canWrite: true,
      }),
    );
    expectNoHiddenValues(serialised, ["lab-view-seed"]);

    const source = readFileSync("components/lab/view-model.ts", "utf8");
    expect(source).not.toMatch(/from\s+["']react["']/);
    expect(source).not.toMatch(/from\s+["'](next|@supabase)/);
    expect(source).not.toMatch(/trueTitrantMolarityM|equivalenceMl|observableMl\.|deriveHiddenState/);
  });

  it("marks the ungraded calculation step as ungraded instead of faking a result", () => {
    const state = labStateViewFor(concordantStageASession());
    // The experiment declares a moles calculation the protocol cannot grade.
    expect(state.ungradedCalculations.map((entry) => entry.key)).toContain("moles_khp");
    // What CAN be graded is the reported concentration, per recorded trial.
    expect(state.calculationPrompts).toHaveLength(3);
    expect(state.calculationPrompts.every((prompt) => prompt.unit === "mol/L")).toBe(true);
    for (const prompt of state.calculationPrompts) {
      expect(prompt.questionKey).toMatch(/__molarity_trial_\d+$/);
    }
  });

  it("carries a config view with no hidden-range values at all", () => {
    const config = publicTitrationConfigView(exp02TitrationConfig);
    const serialised = JSON.stringify(config);
    for (const range of exp02TitrationConfig.hiddenRanges.titrantMolarityM) {
      expect(serialised).not.toContain(String(range));
    }
    expect(serialised).not.toContain(String(exp02TitrationConfig.endpointBiasMl));
    expect(serialised).not.toContain(String(exp02TitrationConfig.assessmentWeights.technique));
  });
});
