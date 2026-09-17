/**
 * The one switch that keeps the development preview out of a production build.
 *
 * The harness renders the laboratory from scenarios instead of a real attempt, so
 * a student must never be able to reach it. Rather than duplicating a
 * `NODE_ENV` check in each entry point — where one of them would eventually be
 * forgotten — both the route and the replay action ask this function, and
 * `tests/security/dev-preview.test.ts` asserts that they do.
 *
 * Deliberately free of `server-only` and of any framework import, so the rule can
 * be unit-tested directly.
 */
export function previewIsEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export const PREVIEW_DISABLED_MESSAGE =
  "The development preview laboratory is not available in this build.";
