import { redirect } from "next/navigation";
import { dashboardPathForRole } from "@/application/auth/access";
import { getCurrentProfile } from "@/application/auth/dal";
import { Alert } from "@/components/ui/alert";
import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { ValueStrip } from "@/components/landing/value-strip";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ExperimentCategories } from "@/components/landing/experiment-categories";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { LandingCta } from "@/components/landing/cta";
import { LandingFooter } from "@/components/landing/footer";
import { isSupabaseConfigured } from "@/lib/env";

export default async function HomePage() {
  const configured = isSupabaseConfigured();

  // Signed-in users go straight to the dashboard their role owns.
  if (configured) {
    const profile = await getCurrentProfile();
    if (profile) redirect(dashboardPathForRole(profile.role));
  }

  return (
    <div className="flex min-h-full flex-col">
      <Navbar />
      <main className="flex flex-1 flex-col">
        {!configured && (
          <div className="border-b border-line bg-surface">
            <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
              <Alert tone="warning" title="Supabase is not configured yet">
                <p>
                  Copy <code className="font-mono">.env.example</code> to{" "}
                  <code className="font-mono">.env.local</code> and set{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then
                  apply the migrations in{" "}
                  <code className="font-mono">supabase/migrations</code>. Sign-in is
                  disabled until then.
                </p>
              </Alert>
            </div>
          </div>
        )}
        <Hero />
        <ValueStrip />
        <HowItWorks />
        <ExperimentCategories />
        <FeatureGrid />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
