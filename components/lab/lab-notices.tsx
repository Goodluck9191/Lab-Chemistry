"use client";

import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLabServer } from "./lab-state-provider";
import type { LabStateView } from "@/application/attempts/lab-state";

/**
 * Everything the student needs to be told, in one place.
 *
 * Three kinds of message, none of which may leak hidden chemistry:
 *   - the outcome of the last action (accepted, refused by the engine, or not
 *     saved at all) — reported with the server's own student-facing wording;
 *   - the attempt's status (a closed attempt is read-only);
 *   - the gaps between the public catalog and the simulation configuration,
 *     which are derived on the server at load time.
 *
 * A stale revision is handled by the controller, which refreshes the state and
 * reports it here rather than overwriting anything.
 */
export function LabNotices({ initialState }: { initialState: LabStateView }) {
  const { state, clearNotice, pending, refresh, canWrite } = useLabServer();
  const notice = state.notice;

  return (
    <div className="flex flex-col gap-2">
      {!canWrite ? (
        <Alert tone="info" title="This attempt is closed">
          It has been submitted, so nothing further is recorded. You can still read every reading,
          observation and result on this page.
        </Alert>
      ) : null}

      {/*
        ONE message per event. A rejected action used to be reported twice — a
        generic "Save failed" banner plus a notice with the actual wording —
        which buried the only line that said what went wrong.
      */}
      {notice ? (
        <Alert tone={notice.tone} title={notice.title}>
          <div className="flex items-start justify-between gap-3">
            <p>
              {notice.message}
              {state.saveStatus === "failed" && notice.tone === "danger"
                ? " The bench still shows the last state the server confirmed."
                : null}
            </p>
            <Button size="sm" variant="ghost" onClick={clearNotice} aria-label="Dismiss message">
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {notice.detail ? (
            <p className="mt-1 text-xs opacity-80">{`Cause: ${notice.detail}`}</p>
          ) : null}
          {notice.tone === "danger" ? (
            <span className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={pending}>
                Reload saved state
              </Button>
            </span>
          ) : null}
        </Alert>
      ) : null}

      {initialState.notices.map((message) => (
        <Alert key={message} tone="warning" title="Configuration coverage">
          {message}
        </Alert>
      ))}
    </div>
  );
}
