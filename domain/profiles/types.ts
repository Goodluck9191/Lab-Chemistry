/** Exactly two roles exist in this system. Authorisation is always derived
 * server-side from the `profiles.role` column; never from client input. */
export const USER_ROLES = ["student", "instructor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  registrationNumber: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}
