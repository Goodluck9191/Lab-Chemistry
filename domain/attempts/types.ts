/** Attempts are the unit of work: one student, one experiment, one session. */
export const ATTEMPT_STATUSES = [
  "in_progress",
  "submitted",
  "graded",
  "returned",
  "abandoned",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface ExperimentAttempt {
  id: string;
  experimentId: string;
  studentId: string;
  status: AttemptStatus;
  configVersion: number;
  startedAt: string;
  lastActivityAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  finalScore: number | null;
}

export interface AttemptSummary extends ExperimentAttempt {
  experimentTitle: string;
  experimentNumber: number;
}

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  in_progress: "In progress",
  submitted: "Submitted",
  graded: "Graded",
  returned: "Returned for revision",
  abandoned: "Abandoned",
};
