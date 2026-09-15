import type { NextRequest } from "next/server";
import { updateSession } from "@/infrastructure/supabase/proxy";

/**
 * Next.js 16 calls this file "Proxy" (it replaced `middleware.ts` in Next 16).
 * It refreshes the Supabase session cookie before rendering and redirects
 * unauthenticated visitors away from protected areas. Authorisation itself is
 * enforced in the data access layer and in the database via RLS.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next.js internals, the favicon and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
