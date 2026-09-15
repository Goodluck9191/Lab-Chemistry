import { BookOpen, FlaskConical, Play, Calculator, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    num: "01",
    icon: BookOpen,
    title: "Choose an Experiment",
    description: "Browse the library and pick a practical to work on.",
  },
  {
    num: "02",
    icon: FlaskConical,
    title: "Enter the Virtual Laboratory",
    description: "Open your workspace with apparatus and chemicals ready.",
  },
  {
    num: "03",
    icon: Play,
    title: "Perform the Practical",
    description: "Follow the procedure, control equipment and take readings.",
  },
  {
    num: "04",
    icon: Calculator,
    title: "Calculate & Record Results",
    description: "Process your data and check for concordance.",
  },
  {
    num: "05",
    icon: Send,
    title: "Submit for Assessment",
    description: "Submit your report and receive feedback from your instructor.",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="border-b border-line bg-surface-muted" id="how-it-works">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How It Works</h2>
          <p className="mt-3 text-muted">
            From selecting an experiment to receiving your assessment — a complete practical
            workflow.
          </p>
        </div>

        {/* Desktop: horizontal timeline */}
        <div className="relative hidden lg:block">
          {/* Connecting line */}
          <div className="absolute left-0 right-0 top-5 h-px bg-line-strong" />

          <div className="relative grid grid-cols-5 gap-4">
            {STEPS.map((step) => (
              <div key={step.num} className="flex flex-col items-center text-center">
                <div className="relative z-10 mb-4 flex size-10 items-center justify-center rounded-full border-2 border-primary bg-surface">
                  <step.icon aria-hidden="true" className="size-4 text-primary" />
                </div>
                <p className="mb-1 font-mono text-xs font-semibold text-primary">
                  {step.num}
                </p>
                <h3 className="mb-1 text-sm font-semibold">{step.title}</h3>
                <p className="text-xs leading-relaxed text-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: vertical timeline */}
        <div className="relative flex flex-col gap-0 lg:hidden">
          {/* Vertical connecting line */}
          <div className="absolute left-5 top-5 bottom-5 w-px bg-line-strong" />

          {STEPS.map((step, i) => (
            <div
              key={step.num}
              className={cn(
                "relative flex gap-4 py-4",
                i < STEPS.length - 1 && "border-b-0",
              )}
            >
              <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-surface">
                <step.icon aria-hidden="true" className="size-4 text-primary" />
              </div>
              <div className="flex flex-col gap-0.5 pt-1">
                <p className="font-mono text-xs font-semibold text-primary">
                  Step {step.num}
                </p>
                <h3 className="text-sm font-semibold">{step.title}</h3>
                <p className="text-xs leading-relaxed text-muted">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
