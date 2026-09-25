import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  declaredQuestionsFor,
  experimentDefinitionFor,
  type DeclaredQuestion,
} from "@/domain/experiments/catalog/catalog-registry";
import {
  gradedTrialCalculations,
  gradeSession,
  type TitrationSession,
} from "@/domain/simulation/titration/engine";
import type { TitrationExperimentConfig } from "@/domain/simulation/titration/config";
import type { ReportSections } from "@/infrastructure/supabase/repositories/attempts";
import {
  markCalculationsGradedAdmin,
  upsertAutoGradeAdmin,
  type GradedCalculation,
} from "@/infrastructure/supabase/repositories/grades";

/**
 * Automatic assessment for a submitted Experiment 2 attempt.
 *
 * ARCHITECTURE: everything here is deterministic and server-side. The
 * per-stage titration scores come from the existing `gradeSession` domain
 * foundation (hidden truth + student actions); process categories count the
 * session's recorded error events; questions use the catalog's keyword
 * rubrics; observations use the catalog's expected keywords. Nothing is
 * invented at runtime, and no expected value ever leaves this module except
 * into the privileged grade-write path.
 *
 * The awarded points follow the catalog `gradingRules` (100 total):
 * technique 15, endpoint 20, concordance 10, calculations 15 (each scaled
 * from the mean per-stage `gradeSession` line), apparatus 10, chemicals 5,
 * safety 10, sequence 10, observations 3, report 2. Question results
 * (6 questions x 2 = 12) are scored alongside and stored in the breakdown
 * for instructor review; they gate submission but sit outside the 100-point
 * rubric, which the catalog fixes.
 */

export interface QuestionScore {
  key: string;
  awarded: number;
  max: number;
  matchedKeywords: number;
}

export interface QuestionScoring {
  total: number;
  max: number;
  perQuestion: QuestionScore[];
}

/** Count case-insensitive keyword hits in a free-text answer. */
export function countKeywordMatches(answer: string, keywords: string[]): number {
  const normalized = answer.toLowerCase();
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase())).length;
}

/** Score one answer against its declared rubric: full, half, or zero. */
export function scoreAnswer(
  question: Pick<DeclaredQuestion, "keywords" | "fullMarksAt" | "halfMarksAt" | "points">,
  answer: string,
): { awarded: number; matched: number } {
  const matched = countKeywordMatches(answer, question.keywords);
  if (matched >= question.fullMarksAt) return { awarded: question.points, matched };
  if (matched >= question.halfMarksAt) return { awarded: question.points / 2, matched };
  return { awarded: 0, matched };
}

/** Score every declared question from the student's saved answers. */
export function scoreReportAnswers(
  questions: DeclaredQuestion[],
  answers: Record<string, unknown>,
): QuestionScoring {
  const perQuestion = questions.map((question) => {
    const raw = answers[question.key];
    const { awarded, matched } =
      typeof raw === "string" && raw.trim().length > 0
        ? scoreAnswer(question, raw)
        : { awarded: 0, matched: 0 };
    return { key: question.key, awarded, max: question.points, matchedKeywords: matched };
  });
  return {
    total: perQuestion.reduce((sum, entry) => sum + entry.awarded, 0),
    max: perQuestion.reduce((sum, entry) => sum + entry.max, 0),
    perQuestion,
  };
}

/** Required question keys with no saved answer. Empty means answerable. */
export function missingRequiredAnswers(
  questions: DeclaredQuestion[],
  answers: Record<string, unknown>,
): string[] {
  return questions
    .filter((question) => question.isRequired)
    .filter((question) => {
      const raw = answers[question.key];
      return typeof raw !== "string" || raw.trim().length === 0;
    })
    .map((question) => question.key);
}

export interface CategoryScore {
  key: string;
  awarded: number;
  max: number;
  note: string;
}

export interface AttemptAutoGrade {
  autoScore: number;
  categories: CategoryScore[];
  questions: QuestionScoring;
  calculations: GradedCalculation[];
  stageTotals: Array<{ stageKey: string; total: number }>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compose the automatic grade from a fully-loaded session. PURE: hidden
 * truth is read, nothing is mutated, nothing is returned that the student
 * must not see (the caller strips `calculations[].expectedValue` before any
 * client boundary — only `correct` booleans travel).
 */
export function gradeAttemptOnSubmit(args: {
  session: TitrationSession;
  config: TitrationExperimentConfig;
  experimentId: string;
  answers: Record<string, unknown>;
  sections: ReportSections;
}): AttemptAutoGrade {
  const { session, experimentId, answers, sections } = args;
  const stageKeys = Object.keys(session.public.stages);
  const grades = stageKeys.map((stageKey) => ({
    stageKey,
    grade: gradeSession(session, stageKey),
  }));
  const mean = (pick: (index: number) => number): number =>
    grades.length === 0 ? 0 : grades.reduce((sum, entry, i) => sum + pick(i), 0) / grades.length;

  const errorEvents = session.public.errorEvents;
  const countCode = (code: string): number => errorEvents.filter((event) => event.code === code).length;
  const severeCount = errorEvents.filter((event) => event.severe).length;

  const technique = round2(mean((i) => grades[i].grade.lines[0].awarded) * (15 / 30));
  const endpoint = round2(mean((i) => grades[i].grade.lines[1].awarded) * (20 / 30));
  const concordance = round2(mean((i) => grades[i].grade.lines[2].awarded) * (10 / 20));
  const calculations = round2(mean((i) => grades[i].grade.lines[3].awarded) * (15 / 20));

  const apparatus = Math.max(0, 10 - 2 * countCode("wrong_reagent"));
  const indicatorInRange = stageKeys
    .map((key) => session.public.stages[key].indicatorDrops)
    .filter((drops): drops is number => drops !== null);
  const chemicals =
    indicatorInRange.length > 0 && indicatorInRange.every((drops) => drops >= 3 && drops <= 4) ? 5 : 0;
  const safety = Math.max(0, 10 - 2 * severeCount);
  const sequence = Math.max(0, 10 - countCode("invalid_sequence"));

  const colourObservation = session.public.observations.find(
    (observation) => observation.fieldKey === "colour_change",
  );
  const observationText = colourObservation !== undefined ? colourObservation.textValue.toLowerCase() : null;
  const expectedKeywords =
    experimentDefinitionFor(experimentId)?.observations.find((field) => field.fieldKey === "colour_change")
      ?.expectKeywords ?? [];
  const observations =
    (observationText !== null && observationText.trim().length > 0 ? 1.5 : 0) +
    (observationText !== null && expectedKeywords.every((keyword) => observationText.includes(keyword)) ? 1.5 : 0);

  const conclusionDone = sections.conclusion.trim().length > 0 ? 1 : 0;
  const allSectionsDone = [sections.aim, sections.procedure, sections.resultsSummary, sections.conclusion, sections.safetyNotes].every(
    (section) => section.trim().length > 0,
  )
    ? 1
    : 0;
  const report = conclusionDone + allSectionsDone;

  const questions = scoreReportAnswers(declaredQuestionsFor(experimentId), answers);

  const categories: CategoryScore[] = [
    { key: "technique", awarded: technique, max: 15, note: "Mean per-stage titration technique, scaled." },
    { key: "endpoint", awarded: endpoint, max: 20, note: "Mean per-stage endpoint stops, scaled." },
    { key: "concordance", awarded: concordance, max: 10, note: "Mean per-stage concordance, scaled." },
    { key: "calculations", awarded: calculations, max: 15, note: "Mean per-stage calculation accuracy, scaled." },
    { key: "apparatus_selection", awarded: apparatus, max: 10, note: `${countCode("wrong_reagent")} wrong-reagent event(s).` },
    { key: "chemical_selection", awarded: chemicals, max: 5, note: "Indicator within the 3–4 drop range on every stage." },
    { key: "safety_compliance", awarded: safety, max: 10, note: `${severeCount} severe event(s).` },
    { key: "sequence", awarded: sequence, max: 10, note: `${countCode("invalid_sequence")} out-of-sequence event(s).` },
    { key: "observations", awarded: observations, max: 3, note: "Endpoint colour change recorded with expected keywords." },
    { key: "report", awarded: report, max: 2, note: "Conclusion plus complete draft sections." },
  ];
  const autoScore = round2(categories.reduce((sum, entry) => sum + entry.awarded, 0));

  const calculationsGrades: GradedCalculation[] = stageKeys.flatMap((stageKey) =>
    gradedTrialCalculations(session, stageKey).map((graded) => ({
      questionKey: `${stageKey}__molarity_trial_${graded.trialNumber}`,
      expectedValue: graded.expectedMolarityM,
      tolerance: graded.toleranceM,
      correct: graded.correct,
    })),
  );

  return {
    autoScore,
    categories,
    questions,
    calculations: calculationsGrades,
    stageTotals: grades.map((entry) => ({ stageKey: entry.stageKey, total: entry.grade.total })),
  };
}

/**
 * Persist the automatic grade with the service-role client (RLS bypass).
 * Only called during submission, after the report is frozen. The `grades`
 * row stays `decision = 'pending'` with no grader until an instructor
 * reviews it; `calculation_submissions` receives the key verdicts the
 * student SELECT grant can never read. The client is a parameter so tests
 * can observe the exact privileged writes.
 */
export async function persistAutoGrade(
  adminClient: SupabaseClient,
  attemptId: string,
  graded: AttemptAutoGrade,
): Promise<void> {
  await upsertAutoGradeAdmin(adminClient, attemptId, {
    autoScore: graded.autoScore,
    breakdown: {
      categories: graded.categories,
      questions: graded.questions,
      stageTotals: graded.stageTotals,
    },
  });
  await markCalculationsGradedAdmin(adminClient, attemptId, graded.calculations);
}
