import type { ReactNode } from "react";
import { requireInstructor } from "@/application/auth/dal";
import { AppShell } from "@/components/layout/app-shell";
import { INSTRUCTOR_NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * Instructor area. The role is read from the `profiles` table through the data
 * access layer on every request - it is never taken from a cookie, a header or a
 * request body, and a student cannot reach these routes.
 */
/**
 * Per-user pages must never be prerendered or cached: a static shell could be
 * served to a different signed-in user. Every route in this segment reads the
 * session and the database on each request.
 */
export const dynamic = "force-dynamic";

export default async function InstructorLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireInstructor();

  return (
    <AppShell
      navItems={INSTRUCTOR_NAV_ITEMS}
      navLabel="Instructor sections"
      user={{ fullName: profile.fullName, email: profile.email, role: profile.role }}
    >
      {children}
    </AppShell>
  );
}
