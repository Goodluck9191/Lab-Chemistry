import { notFound } from "next/navigation";
import { PreviewCanvas } from "@/components/lab/preview/preview-canvas";
import { previewIsEnabled } from "@/components/lab/preview/preview-gate";
import { PREVIEW_SCENARIOS, previewScenarioOptions, scenarioStateFor } from "@/components/lab/preview/scenarios";

export const metadata = {
  title: "Laboratory preview",
  // A development harness must never be indexed, even by accident.
  robots: { index: false, follow: false },
};

/**
 * The laboratory without a database.
 *
 * WHY THIS EXISTS: `attempt_secrets` has no RLS, so the real laboratory route
 * needs privileged server-side credentials that a local checkout does not have.
 * This route renders the SAME bench from scripted scenarios built by the same
 * engine, so the apparatus, the interaction states and the responsive layout can
 * be seen and operated locally.
 *
 * SAFETY: gated on `previewIsEnabled()`, which is false in a production build —
 * so this returns a 404 in production. Scenarios carry no student data, reach no
 * attempt row, and send only the public projection to the browser.
 *
 * `force-dynamic` because the payload is derived per request and must never be
 * prerendered into a static asset.
 */
export const dynamic = "force-dynamic";

export default function LabPreviewPage() {
  if (!previewIsEnabled()) notFound();

  const initial = PREVIEW_SCENARIOS[0];
  if (!initial) notFound();

  return (
    <PreviewCanvas
      scenarios={previewScenarioOptions()}
      initialScenarioId={initial.id}
      initialState={scenarioStateFor(initial.id)}
    />
  );
}
