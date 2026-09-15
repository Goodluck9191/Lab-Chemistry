/**
 * Static visual illustration of a laboratory setup for the hero section.
 * Pure SVG/CSS — no interactivity. The real simulation replaces this later.
 */
export function LabPreview() {
  return (
    <div className="relative flex w-full items-center justify-center" aria-hidden="true">
      <div className="relative w-full max-w-sm">
        {/* Background glow */}
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/10 to-accent/10 blur-2xl" />

        {/* Main illustration card */}
        <div className="relative rounded-2xl border border-line bg-surface p-6 shadow-lg">
          {/* Burette */}
          <div className="mx-auto mb-4 flex flex-col items-center">
            {/* Clamp */}
            <div className="h-2 w-16 rounded-t-sm bg-line-strong" />
            {/* Burette tube */}
            <div className="relative h-28 w-3 overflow-hidden rounded-b-sm border border-line-strong bg-lab-glass">
              {/* Liquid in burette */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-lab-liquid"
                style={{ height: "60%" }}
              >
                <div className="absolute inset-x-0 top-0 h-px bg-lab-liquid/60" />
              </div>
              {/* Graduation marks */}
              {[20, 40, 60, 80].map((top) => (
                <div
                  key={top}
                  className="absolute left-0 h-px w-1.5 bg-line-strong"
                  style={{ top: `${top}%` }}
                />
              ))}
            </div>
            {/* Stopcock */}
            <div className="h-1.5 w-5 rounded-sm bg-line-strong" />
            {/* Drip */}
            <svg width="6" height="10" viewBox="0 0 6 10" className="lab-drip mt-0.5" aria-hidden="true">
              <path d="M3 0 C3 0, 6 6, 3 10 C0 6, 3 0, 3 0Z" fill="var(--lab-liquid)" />
            </svg>
          </div>

          {/* Conical flask */}
          <div className="mx-auto flex justify-center">
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
              {/* Flask body */}
              <path
                d="M26 14 L26 34 L12 62 C10 66, 13 70, 17 70 L55 70 C59 70, 62 66, 60 62 L46 34 L46 14"
                stroke="var(--line-strong)"
                strokeWidth="1.5"
                fill="var(--lab-glass)"
              />
              {/* Liquid in flask */}
              <path
                d="M16 54 L26 36 L46 36 L56 54 C58 58, 57 64, 54 66 L18 66 C15 64, 14 58, 16 54Z"
                fill="var(--lab-liquid)"
                opacity="0.7"
              >
                <animate
                  attributeName="d"
                  dur="3s"
                  repeatCount="indefinite"
                  values="M16 54 L26 36 L46 36 L56 54 C58 58, 57 64, 54 66 L18 66 C15 64, 14 58, 16 54Z;
                          M16 55 L26 36 L46 36 L56 55 C58 59, 57 64, 54 66 L18 66 C15 64, 14 59, 16 55Z;
                          M16 54 L26 36 L46 36 L56 54 C58 58, 57 64, 54 66 L18 66 C15 64, 14 58, 16 54Z"
                />
              </path>
              {/* Neck */}
              <line x1="26" y1="14" x2="26" y2="8" stroke="var(--line-strong)" strokeWidth="1.5" />
              <line x1="46" y1="14" x2="46" y2="8" stroke="var(--line-strong)" strokeWidth="1.5" />
              {/* Lip */}
              <line x1="24" y1="8" x2="48" y2="8" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          {/* Measurement readout */}
          <div className="mt-3 rounded-lg border border-line bg-surface-muted px-4 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted">Volume delivered</p>
            <p className="font-mono text-lg font-semibold tabular-nums text-primary">12.40 mL</p>
          </div>
        </div>

        {/* Floating accent cards */}
        <div className="lab-float absolute -left-6 top-8 rounded-lg border border-line bg-surface px-3 py-2 shadow-md">
          <p className="text-[10px] text-muted">Endpoint</p>
          <p className="text-xs font-semibold text-lab-endpoint">pH 7.0</p>
        </div>

        <div className="lab-float-slow absolute -bottom-2 -right-4 rounded-lg border border-line bg-surface px-3 py-2 shadow-md">
          <p className="text-[10px] text-muted">Trial 3</p>
          <p className="text-xs font-semibold text-success">Concordant ✓</p>
        </div>
      </div>
    </div>
  );
}
