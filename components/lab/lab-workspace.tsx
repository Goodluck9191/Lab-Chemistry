"use client";

import type { LabStateView } from "@/application/attempts/lab-state";
import { LabStateProvider } from "./lab-state-provider";
import type { LabActionSender, LabStateLoader } from "./lab-action-controller";
import { LabNotices } from "./lab-notices";
import { ImmersiveLab } from "./immersive-lab";

/**
 * The laboratory workspace: the immersive full-screen 3D laboratory.
 *
 * There is no dashboard layout anymore — no permanent procedure sidebar, no
 * action sidebar, and no 2D bench to fall back to: the SVG bench and its
 * apparatus were deleted, not merely hidden. The 3D world owns the viewport;
 * procedure, actions and results live in transient HUD drawers inside
 * `ImmersiveLab`, and engine notices overlay the scene.
 *
 * The transport is injectable (`send`/`loadState`) so the development preview can
 * drive this exact workspace from scenarios. The real route passes neither, and
 * the controller then uses the persisted server actions.
 */
export function LabWorkspace({
  initialState,
  send,
  loadState,
  heightClassName = "h-[100dvh]",
}: {
  initialState: LabStateView;
  /** Test/preview seam. Omitted in the real laboratory. */
  send?: LabActionSender;
  loadState?: LabStateLoader;
  /** The real route owns the viewport; an embedding shell supplies its own. */
  heightClassName?: string;
}) {
  return (
    <LabStateProvider initialState={initialState} send={send} loadState={loadState}>
      <div className={`relative ${heightClassName}`}>
        <ImmersiveLab initialState={initialState} />
        {/* Engine notices overlay the world instead of owning a dashboard row. */}
        <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-xl">
            <LabNotices initialState={initialState} />
          </div>
        </div>
      </div>
    </LabStateProvider>
  );
}
