import { isAttemptWritable, type AttemptStatus } from "@/domain/attempts";
import type { UserRole } from "@/domain/profiles";

/**
 * Pure access rules. These are used by the data access layer, the navigation and
 * the tests, and they deliberately mirror the database policies so the UI and the
 * database agree about who may do what.
 *
 * They are NOT the authority: Row Level Security is. A bug here can only make
 * the interface more permissive or more restrictive than the database - it can
 * never grant database access that RLS would deny.
 */
export function canAccessStudentArea(role: UserRole | null | undefined): boolean {
  return role === "student";
}

export function canAccessInstructorArea(role: UserRole | null | undefined): boolean {
  return role === "instructor";
}

export function isAuthenticated(role: UserRole | null | undefined): boolean {
  return role === "student" || role === "instructor";
}

/** Where a signed-in user belongs; unauthenticated users go to the login page. */
export function dashboardPathForRole(role: UserRole | null | undefined): string {
  if (role === "student") return "/student/dashboard";
  if (role === "instructor") return "/instructor/dashboard";
  return "/login";
}

/** Owner or instructor - mirrors the `can_read_attempt()` database function. */
export function canReadAttemptData(input: {
  role: UserRole | null | undefined;
  userId: string | null | undefined;
  attemptStudentId: string;
}): boolean {
  if (!input.userId) return false;
  if (input.userId === input.attemptStudentId) return true;
  return canAccessInstructorArea(input.role);
}

/** Owner AND a writable status - mirrors `can_write_attempt()`. */
export function canWriteAttemptData(input: {
  role: UserRole | null | undefined;
  userId: string | null | undefined;
  attemptStudentId: string;
  status: AttemptStatus;
}): boolean {
  if (!input.userId || input.userId !== input.attemptStudentId) return false;
  if (!canAccessStudentArea(input.role)) return false;
  return isAttemptWritable(input.status);
}
