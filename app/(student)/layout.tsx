import type { ReactNode } from "react";
import { requireStudent } from "@/application/auth/dal";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Student area. `requireStudent()` runs on every request; a layout is not a
 * security boundary on its own, so each page repeats the check through the DAL.
 */
/**
 * Per-user pages must never be prerendered or cached: a static shell could be
 * served to a different signed-in user. Every route in this segment reads the
 * session and the database on each request.
 */
export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireStudent();

  return (
    <AppShell
      navKey="student"
      navLabel="Student sections"
      user={{ fullName: profile.fullName, email: profile.email, role: profile.role }}
    >
      {children}
    </AppShell>
  );
}
