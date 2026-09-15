import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The laboratory uses a deliberately reduced chrome so the bench owns the
 * viewport, which matters on a phone. Access control is per page, not here.
 */
/**
 * Per-user pages must never be prerendered or cached: a static shell could be
 * served to a different signed-in user. Every route in this segment reads the
 * session and the database on each request.
 */
export const dynamic = "force-dynamic";

export default function LabLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="border-b border-line bg-surface px-4 py-3 sm:px-6">
        <Link
          href="/student/experiments"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span>Back to experiment library</span>
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
