/**
 * Analytical balance with a weighing bottle on the pan.
 *
 * IMPORTANT: the readout shows the mass the STUDENT recorded, which the server
 * validated and stored (`analyteMassG` in the public state). It never shows a
 * value generated in the browser: an empty balance reads "—" until a reading has
 * been submitted through the action protocol. That is why the weighing field is
 * an input rather than a button that invents a number.
 */
export function BalanceSvg({
  recordedMassG,
  precisionG,
  selected = false,
  hasBottle = true,
  x = 0,
  y = 0,
  onSelect,
}: {
  recordedMassG: number | null;
  precisionG: number;
  selected?: boolean;
  hasBottle?: boolean;
  x?: number;
  y?: number;
  onSelect?: () => void;
}) {
  const reading = recordedMassG === null ? "—" : recordedMassG.toFixed(2);

  return (
    <g transform={`translate(${x}, ${y})`}>
      {onSelect ? (
        <g
          role="button"
          tabIndex={0}
          aria-label="Analytical balance. Activate to enter the reading you obtained."
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          }}
          className="cursor-pointer"
        >
          <rect x={-6} y={-6} width={212} height={172} rx={10} fill="transparent" />
        </g>
      ) : null}

      {/* Body */}
      <rect
        x={0}
        y={20}
        width={200}
        height={140}
        rx={8}
        fill="var(--surface)"
        stroke={selected ? "var(--primary)" : "var(--foreground)"}
        strokeWidth={selected ? 2.5 : 1.8}
      />
      {/* Draft shield */}
      <rect x={54} y={0} width={92} height={62} rx={4} fill="var(--lab-glass)" fillOpacity={0.5} stroke="var(--lab-glass-border)" strokeWidth={1.4} />
      {/* Pan */}
      <line x1={70} y1={54} x2={130} y2={54} stroke="var(--foreground)" strokeWidth={2.5} />
      {hasBottle ? (
        <g>
          <rect x={86} y={34} width={28} height={20} rx={3} fill="var(--lab-glass)" stroke="var(--lab-glass-border)" strokeWidth={1.4} />
          <rect x={90} y={30} width={20} height={6} rx={2} fill="var(--foreground)" />
        </g>
      ) : null}

      {/* Readout */}
      <rect x={22} y={78} width={156} height={34} rx={4} fill="var(--surface-muted)" stroke="var(--line-strong)" strokeWidth={1} />
      <text
        x={100}
        y={101}
        textAnchor="middle"
        fontSize={17}
        fill="var(--foreground)"
        fontWeight={600}
        className="tabular-nums"
        fontFamily="var(--font-mono), monospace"
      >
        {reading} g
      </text>
      <text x={22} y={128} fontSize={9} fill="var(--lab-scale)">
        weighed to ±{precisionG} g
      </text>
      <text x={22} y={142} fontSize={9} fill="var(--lab-scale)">
        {recordedMassG === null ? "no reading recorded" : "reading recorded"}
      </text>
      <title>
        {`Analytical balance. ${
          recordedMassG === null
            ? "No mass has been recorded yet."
            : `Recorded mass ${recordedMassG} g.`
        }`}
      </title>
      <text x={100} y={176} textAnchor="middle" fontSize={10} fill="var(--lab-scale)" fontWeight={500}>
        Analytical balance
      </text>
    </g>
  );
}
