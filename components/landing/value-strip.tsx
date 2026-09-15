import { FlaskConical, Beaker, Ruler, ClipboardCheck } from "lucide-react";

const VALUES = [
  {
    icon: FlaskConical,
    label: "17+ Practical Experiments",
  },
  {
    icon: Beaker,
    label: "Interactive Simulations",
  },
  {
    icon: Ruler,
    label: "Realistic Measurements",
  },
  {
    icon: ClipboardCheck,
    label: "Automatic Assessment",
  },
] as const;

export function ValueStrip() {
  return (
    <section className="border-b border-line bg-surface-muted" aria-label="Key features">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-8 sm:px-6 lg:grid-cols-4 lg:py-10">
        {VALUES.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <item.icon aria-hidden="true" className="size-5 text-primary" />
            </div>
            <p className="text-sm font-medium">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
