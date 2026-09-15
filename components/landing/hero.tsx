import Link from "next/link";
import { ArrowRight, Beaker } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { LabPreview } from "./lab-preview";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-surface to-background">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-12 lg:py-24">
        {/* Text */}
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Beaker aria-hidden="true" className="size-3.5" />
            Physical Chemistry Practical I
          </span>

          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Experience Chemistry Beyond the Classroom
          </h1>

          <p className="max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Perform physical chemistry practicals in an interactive virtual laboratory. Prepare
            solutions, perform titrations, take measurements, calculate results and submit your
            practical work.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link href="/register" className={buttonClassName({ size: "lg", className: "rounded-lg" })}>
              Start Your Practical
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="#experiments"
              className={buttonClassName({ variant: "secondary", size: "lg", className: "rounded-lg" })}
            >
              Explore Experiments
            </Link>
          </div>
        </div>

        {/* Visual */}
        <div>
          <LabPreview />
        </div>
      </div>
    </section>
  );
}
