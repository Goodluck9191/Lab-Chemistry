import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";

/** Areas that require a signed-in user. This is a COARSE, UX-level check. */
const PROTECTED_PREFIXES = ["/student", "/instructor", "/lab"];
const AUTH_ROUTES = ["/login", "/register"];

/**
 * Refreshes the Supabase session cookie and performs optimistic redirects.
 *
 * This is deliberately NOT the security boundary: the docs are explicit that a
 * proxy "should not be used as a full session management or authorization
 * solution". Every page and server action re-checks through the data access
 * layer (application/auth/dal.ts) and every row is protected by RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = readPublicEnv();
  if (!env) {
    // Supabase has not been configured yet. Send protected areas to the landing
    // page, which explains what is missing, rather than letting them fail deep
    // inside the data access layer with a confusing error.
    const path = request.nextUrl.pathname;
    const isProtected = PROTECTED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Auth cookies must never be cached by a CDN or shared proxy.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ROUTES.includes(path)) {
    // The landing page already resolves the correct dashboard for the role.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
