import "server-only";
import { buildLabStateView, type LabStateView } from "@/application/attempts/lab-state";
import { exp02Standardisation } from "@/domain/experiments/catalog/exp-02-standardisation";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import { molesFromMassAndMolarMass } from "@/domain/chemistry/calculations";
import { KHP_MOLAR_MASS_G_PER_MOL } from "@/domain/chemistry/molar-masses";
import { dispatchTitrationAction } from "@/domain/simulation/titration/dispatch";
import {
  createTitrationSession,
  toPublicJSON,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import type { TitrationProtocolAction } from "@/domain/simulation/titration/protocol";
import { publicTitrationConfigView } from "@/domain/simulation/titration/public-view";

/**
 * DEVELOPMENT-ONLY PREVIEW SCENARIOS.
 *
 * The real laboratory cannot render without a database, because `attempt_secrets`
 * has no RLS and the read path needs privileged credentials. This module lets the
 * bench be seen and operated without one — WITHOUT weakening anything:
 *
 *   - it never touches Supabase, an attempt row or another student's data;
 *   - every scenario is built by running the REAL engine and the REAL protocol
 *     router, so there is no second simulation anywhere;
 *   - only `buildLabStateView(...)`'s public projection ever leaves the server.
 *     The session — and therefore the hidden endpoint, seed and true
 *     concentration — stays here, exactly as `getLabState` keeps it.
 *
 * A scenario is a fixed seed plus the ordered list of STUDENT ACTIONS that reach
 * a given state, which is what makes it reproducible: replaying the same script
 * always produces the same bench.
 */

const STAGE_A = exp02TitrationConfig.stages[0].key;
const STAGE_B = exp02TitrationConfig.stages[1].key;
const TITRANT_A = exp02TitrationConfig.stages[0].titrantKey;
const TITRANT_B = exp02TitrationConfig.stages[1].titrantKey;
const WEIGHED_MASS_G = 0.6;

/** A fixed, obviously-synthetic attempt id: this is not a real attempt. */
export const PREVIEW_ATTEMPT_ID = "00000000-0000-4000-8000-000000000002";
export const PREVIEW_BASE_REVISION = 1;

export interface PreviewScenario {
  id: string;
  title: string;
  description: string;
  /** Fixed, so the same script always yields the same bench. */
  seed: string;
  /**
   * The student actions that reach this state. Receives the freshly created
   * session so the endpoint scenarios can be scripted relative to the hidden
   * reality — which is legitimate here because the session never leaves the
   * server and the script itself is never sent to the browser.
   */
  script: (session: TitrationSession) => TitrationProtocolAction[];
}

function stageAObservableMl(session: TitrationSession): number {
  return session.hidden.stages[STAGE_A].observableMl;
}

/**
 * The concentration the engine expects for a stage-A trial, computed the same way
 * the engine computes it (moles of the weighed standard over the titre). Using
 * the formula rather than reaching into the hidden truth means the concordant
 * scenario reports values the laboratory genuinely accepts, and stays honest
 * about what the harness is allowed to know.
 */
function stageAExpectedMolarity(deliveredMl: number): number {
  if (!(deliveredMl > 0)) return 0;
  const moles = molesFromMassAndMolarMass(WEIGHED_MASS_G, KHP_MOLAR_MASS_G_PER_MOL);
  return Math.round((moles / (deliveredMl / 1000)) * 1e6) / 1e6;
}

/** Rinse, fill and clamp; weigh the standard into the flask; add the indicator. */
function prepared(): TitrationProtocolAction[] {
  return [
    { type: "setup_apparatus", stageKey: STAGE_A, titrantKey: TITRANT_A, initialReadingMl: 0 },
    { type: "weigh_analyte", stageKey: STAGE_A, observedMassG: WEIGHED_MASS_G },
    { type: "add_indicator", stageKey: STAGE_A, drops: 3 },
  ];
}

/** One complete stage-A trial titrated to `deliveredMl` and closed. */
function trial(deliveredMl: number, trialNumber: number): TitrationProtocolAction[] {
  return [
    { type: "start_trial", stageKey: STAGE_A, trialNumber, initialReadingMl: 0 },
    { type: "add_titrant", stageKey: STAGE_A, volumeMl: deliveredMl },
    { type: "read_burette", stageKey: STAGE_A, observedFinalMl: deliveredMl },
    { type: "complete_trial", stageKey: STAGE_A },
  ];
}

/** Three stage-A trials taken to the observable endpoint and reported. */
function concordantStageA(session: TitrationSession): TitrationProtocolAction[] {
  const observable = stageAObservableMl(session);
  const molarity = stageAExpectedMolarity(observable);
  const actions: TitrationProtocolAction[] = [];
  for (let trialNumber = 1; trialNumber <= 3; trialNumber += 1) {
    actions.push(...trial(observable, trialNumber));
    actions.push({
      type: "report_molarity",
      stageKey: STAGE_A,
      trialNumber,
      studentMolarityM: molarity,
    });
  }
  return actions;
}

export const PREVIEW_SCENARIOS: PreviewScenario[] = [
  {
    id: "fresh",
    title: "Fresh attempt",
    description: "An untouched attempt: empty bench, every control explained.",
    seed: "preview-fresh",
    script: () => [],
  },
  {
    id: "burette-filled",
    title: "Burette filled",
    description: "Rinsed, filled and clamped, with the initial reading recorded.",
    seed: "preview-filled",
    script: () => [
      { type: "setup_apparatus", stageKey: STAGE_A, titrantKey: TITRANT_A, initialReadingMl: 0 },
    ],
  },
  {
    id: "sample-ready",
    title: "Sample and indicator ready",
    description: "The standard has been weighed and the indicator added.",
    seed: "preview-sample",
    script: () => prepared(),
  },
  {
    id: "mid-trial",
    title: "Titration running",
    description: "Trial 1 open with 10.00 mL delivered: still colourless.",
    seed: "preview-mid",
    script: () => [
      ...prepared(),
      { type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 },
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: 10 },
    ],
  },
  {
    id: "near-endpoint",
    title: "Near the endpoint",
    description: "Half a graduation short of the colour change: still colourless.",
    seed: "preview-near",
    script: (session) => [
      ...prepared(),
      { type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 },
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: Math.max(0.1, stageAObservableMl(session) - 0.2) },
    ],
  },
  {
    id: "endpoint",
    title: "At the endpoint",
    description: "Faint pink that persists: the endpoint the manual describes.",
    seed: "preview-endpoint",
    script: (session) => [
      ...prepared(),
      { type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 },
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: stageAObservableMl(session) },
    ],
  },
  {
    id: "overshot",
    title: "Past the endpoint",
    description: "Deep pink: the trial will be rejected if it is closed now.",
    seed: "preview-overshoot",
    script: (session) => [
      ...prepared(),
      { type: "start_trial", stageKey: STAGE_A, trialNumber: 1, initialReadingMl: 0 },
      { type: "add_titrant", stageKey: STAGE_A, volumeMl: stageAObservableMl(session) + 1 },
    ],
  },
  {
    id: "trial-recorded",
    title: "One trial recorded",
    description: "A closed trial with its titre stored, awaiting a calculation.",
    seed: "preview-recorded",
    script: (session) => [...prepared(), ...trial(stageAObservableMl(session), 1)],
  },
  {
    id: "three-trials",
    title: "Three concordant trials",
    description: "Stage A complete and concordant: the workspace moves on.",
    seed: "preview-concordant",
    script: (session) => [...prepared(), ...concordantStageA(session)],
  },
  {
    id: "stage-b",
    title: "Stage B: pipetted aliquot",
    description: "Stage A concordant, with the HCl aliquot delivered for stage B.",
    seed: "preview-stage-b",
    script: (session) => {
      const portion = exp02TitrationConfig.stages[1].analytePortion;
      return [
        ...prepared(),
        ...concordantStageA(session),
        { type: "setup_apparatus", stageKey: STAGE_B, titrantKey: TITRANT_B, initialReadingMl: 0 },
        {
          type: "pipette_analyte",
          stageKey: STAGE_B,
          observedVolumeMl: portion.kind === "pipetted_volume" ? portion.nominalVolumeMl : 25,
        },
        { type: "add_indicator", stageKey: STAGE_B, drops: 3 },
      ];
    },
  },
];

export function findScenario(scenarioId: string): PreviewScenario {
  return PREVIEW_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? PREVIEW_SCENARIOS[0];
}

/**
 * Replay one scenario's script, then a student's own action history, onto a
 * freshly created session. A refused action in a SCRIPT is a programming error
 * in the harness, so it throws rather than rendering a subtly wrong bench.
 */
function replay(scenarioId: string, history: TitrationProtocolAction[]): {
  scenario: PreviewScenario;
  session: TitrationSession;
} {
  const scenario = findScenario(scenarioId);
  const session = createTitrationSession(exp02TitrationConfig, scenario.seed);

  // The script and the recorded history both contain actions the engine already
  // accepted, so a refusal here means the harness or the client has diverged and
  // the bench would be wrong. Fail loudly instead of drawing it.
  for (const action of [...scenario.script(session), ...history]) {
    const outcome = dispatchTitrationAction(session, exp02Standardisation.id, action);
    if (!outcome.accepted) {
      throw new Error(
        `preview replay was refused: ${action.type} (${outcome.code}) in scenario "${scenario.id}"`,
      );
    }
  }

  return { scenario, session };
}

/** What the preview action returns: the engine half of a real action result. */
export interface PreviewActionResult {
  state: LabStateView;
  accepted: boolean;
  code: string | null;
  message: string | null;
  colour: string | null;
  calculationCorrect: boolean | null;
  /** Counts only ACCEPTED actions, exactly like the autosave revision does. */
  revision: number;
}

/**
 * Replay `prior` accepted actions, then optionally `action`, and project the
 * result. The revision advances only when the engine accepted the action, so a
 * refusal leaves the client's base revision untouched — the same guarantee the
 * persisted laboratory gives.
 */
export function buildPreviewState(
  scenarioId: string,
  prior: TitrationProtocolAction[],
  action: TitrationProtocolAction | null,
): PreviewActionResult {
  const { session } = replay(scenarioId, prior);

  let accepted = true;
  let code: string | null = null;
  let message: string | null = null;
  let colour: string | null = null;
  let calculationCorrect: boolean | null = null;
  let revision = PREVIEW_BASE_REVISION + prior.length;

  if (action) {
    const outcome = dispatchTitrationAction(session, exp02Standardisation.id, action);
    accepted = outcome.accepted;
    code = outcome.code;
    message = outcome.message;
    colour = outcome.colour;
    calculationCorrect = outcome.calculationCorrect;
    if (accepted) revision += 1;
  }

  return {
    state: buildLabStateView({
      attemptId: PREVIEW_ATTEMPT_ID,
      experimentId: exp02Standardisation.id,
      status: "in_progress",
      canWrite: true,
      revision,
      config: publicTitrationConfigView(exp02TitrationConfig),
      publicState: toPublicJSON(session),
      briefing: exp02Standardisation,
    }),
    accepted,
    code,
    message,
    colour,
    calculationCorrect,
    revision,
  };
}

/** The public payload for a scenario at its starting revision. */
export function scenarioStateFor(scenarioId: string): LabStateView {
  return buildPreviewState(scenarioId, [], null).state;
}

/** Metadata for the scenario switcher: no state, so it is cheap to render. */
export function previewScenarioOptions(): Array<{
  id: string;
  title: string;
  description: string;
}> {
  return PREVIEW_SCENARIOS.map(({ id, title, description }) => ({ id, title, description }));
}
