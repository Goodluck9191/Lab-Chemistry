import {
  TestTube,
  Droplets,
  Gauge,
  Repeat,
  Calculator,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: TestTube,
    title: "Prepare Solutions",
    description: "Practice preparing solutions and working with concentrations.",
  },
  {
    icon: Droplets,
    title: "Perform Titrations",
    description: "Control the burette, add solution and identify the endpoint.",
  },
  {
    icon: Gauge,
    title: "Take Measurements",
    description: "Read instruments and record experimental measurements.",
  },
  {
    icon: Repeat,
    title: "Repeat Trials",
    description: "Perform repeated trials and check whether your results are concordant.",
  },
  {
    icon: Calculator,
    title: "Calculate Results",
    description: "Use your experimental data to calculate concentrations, masses and other results.",
  },
  {
    icon: FileCheck,
    title: "Submit Your Report",
    description: "Record observations, calculations and submit your practical work for assessment.",
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="border-b border-line bg-background" id="about">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">More Than Digital Notes</h2>
          <p className="mt-3 text-muted">
            You do not simply read procedures. You perform them — hands-on, step by step, just
            like in a real laboratory.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className={cn(
                "group rounded-xl border border-line bg-surface p-5",
                "transition-shadow hover:shadow-md",
              )}
            >
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                <feature.icon
                  aria-hidden="true"
                  className="size-5 text-primary"
                />
              </div>
              <h3 className="text-sm font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
