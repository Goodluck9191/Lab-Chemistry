import Link from "next/link";
import { redirect } from "next/navigation";
import { dashboardPathForRole } from "@/application/auth/access";
import { getCurrentProfile } from "@/application/auth/dal";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";

export default async function HomePage() {
  const configured = isSupabaseConfigured();

  // Signed-in users go straight to the dashboard their role owns.
  if (configured) {
    const profile = await getCurrentProfile();
    if (profile) redirect(dashboardPathForRole(profile.role));
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">
          Physical Chemistry Practical I
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Virtual Chemistry Laboratory
        </h1>
        <p className="max-w-2xl text-base text-muted">
          Perform the practicals on screen: prepare solutions, read the burette, judge the
          endpoint, repeat trials until they agree, calculate your results and submit a report
          for assessment.
        </p>
      </div>

      {configured ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-5 text-sm font-medium"
          >
            Create an account
          </Link>
        </div>
      ) : (
        <Alert tone="warning" title="Supabase is not configured yet">
          <p>
            Copy <code className="font-mono">.env.example</code> to{" "}
            <code className="font-mono">.env.local</code> and set{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then apply the
            migrations in <code className="font-mono">supabase/migrations</code>. Sign-in is
            disabled until then.
          </p>
        </Alert>
      )}
    </main>
  );
}
