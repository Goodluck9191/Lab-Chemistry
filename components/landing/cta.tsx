import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";

export function LandingCta() {
  return (
    <section className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
          Ready to Start Your Practical?
        </h2>
        <p className="max-w-xl text-muted">
          Create an account, choose an experiment and work through it step by step —
          then submit your report for assessment.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/register"
            className={buttonClassName({ size: "lg", className: "rounded-lg" })}
          >
            Create an Account
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/login"
            className={buttonClassName({
              variant: "secondary",
              size: "lg",
              className: "rounded-lg",
            })}
          >
            Sign In
          </Link>
        </div>
      </div>
    </section>
  );
}
