import Link from "next/link";
import {
  Droplets,
  Zap,
  CloudRain,
  Binary,
  Scale,
  Atom,
  Activity,
} from "lucide-react";
import { buttonClassName } from "@/components/ui/button";

const CATEGORIES = [
  {
    icon: Droplets,
    title: "Acid-Base Titration",
    description: "Determine concentrations using acid-base reactions and indicators.",
  },
  {
    icon: Zap,
    title: "Redox Titration",
    description: "Perform oxidimetric and iodometric titrations.",
  },
  {
    icon: CloudRain,
    title: "Precipitation",
    description: "Carry out titrations that form insoluble products.",
  },
  {
    icon: Binary,
    title: "Complexometric Analysis",
    description: "Use complex-forming reactions for quantitative analysis.",
  },
  {
    icon: Scale,
    title: "Gravimetric Analysis",
    description: "Determine quantities by measuring mass of a precipitate.",
  },
  {
    icon: Atom,
    title: "Chemical Synthesis",
    description: "Prepare and purify chemical compounds in the virtual lab.",
  },
  {
    icon: Activity,
    title: "Conductometry",
    description: "Track reactions through changes in electrical conductivity.",
  },
] as const;

export function ExperimentCategories() {
  return (
    <section className="border-b border-line bg-background" id="experiments">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Explore the Practical Laboratory
          </h2>
          <p className="mt-3 text-muted">
            A growing library of experiments covering the key areas of physical chemistry
            practical work.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.title}
              className="group rounded-xl border border-line bg-surface p-5 transition-all hover:border-primary/30 hover:shadow-md"
            >
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/15">
                <cat.icon aria-hidden="true" className="size-5 text-primary" />
              </div>
              <h3 className="text-sm font-semibold">{cat.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {cat.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/register"
            className={buttonClassName({ variant: "secondary", size: "lg", className: "rounded-lg" })}
          >
            Explore All Experiments
          </Link>
        </div>
      </div>
    </section>
  );
}
