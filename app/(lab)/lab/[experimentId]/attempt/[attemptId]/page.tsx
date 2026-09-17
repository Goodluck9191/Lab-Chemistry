import { notFound } from "next/navigation";
import { requireStudent } from "@/application/auth/dal";
import { getLabState } from "@/application/attempts/lab-state";
import { attemptIdSchema } from "@/application/attempts/schemas";
import { LabWorkspace } from "@/components/lab/lab-workspace";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Virtual laboratory" };

/**
 * The laboratory.
 *
 * This page is a thin server component: it authorises the student, loads the
 * attempt's public laboratory state (ownership + writability + hidden-state
 * resumption all happen inside `getLabState`) and hands that state to the client
 * workspace. No chemistry runs here, and nothing hidden crosses the boundary —
 * `LabStateView` is assembled field by field from public projections.
 *
 * Because the state arrives with the HTML, resuming an attempt is a normal page
 * load: the bench, the procedure highlight, the trial table and the recorded
 * observations all reconstruct from what was persisted, and no reset happens.
 */
export default async function LaboratoryPage({
  params,
}: {
  params: Promise<{ experimentId: string; attemptId: string }>;
}) {
  const { experimentId, attemptId } = await params;

  // Validate before touching the database: a malformed id is a 404, not a query.
  if (!attemptIdSchema.safeParse(attemptId).success) notFound();

  await requireStudent(`/lab/${experimentId}/attempt/${attemptId}`);

  let state;
  try {
    state = await getLabState(attemptId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    // Privileged server-side credentials are required to load hidden experiment
    // parameters. In a dev environment without real database credentials this
    // will fail on every load; surface the root cause rather than a raw stack
    // trace.
    if (
      message.includes("key") ||
      message.includes("not set") ||
      message.includes("Invalid")
    ) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
          <Alert tone="danger">
            <p className="font-medium">Database credentials not configured</p>
            <p className="text-sm mt-1">
              The laboratory requires privileged server-side credentials to load
              experiment state. Set the required environment variables in
              <code className="bg-muted px-1 rounded">.env.local</code> and
              restart the dev server.
            </p>
          </Alert>
        </div>
      );
    }

    // Rethrow unexpected errors so they surface as 500.
    throw error;
  }

  // The attempt must belong to the experiment in the URL, whether or not the
  // ids are individually valid.
  if (state.experimentId !== experimentId) notFound();

  return (
    <LabWorkspace initialState={state} />
  );
}
