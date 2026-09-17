/**
 * Pipette with its filler.
 *
 * `stage` is UI-only progress: "resting" (in the rack), "filled" (solution drawn
 * up) and "delivered" (emptied into the flask). The volume shown is the
 * configured aliquot size, and the value that reaches the server is still the
 * reading the student enters — the drawing never becomes the source of truth.
 */
export type PipetteStage = "resting" | "filled" | "delivered";

export function PipetteSvg({
  nominalVolumeMl,
  stage,
  selected = false,
  x = 0,
  y = 0,
  onSelect,
}: {
  /**
   * The aliquot size from the configuration, or null on a stage that weighs its
   * analyte. A null is rendered as "no volume labelled" rather than as a number
   * invented in the drawing.
   */
  nominalVolumeMl: number | null;
  stage: PipetteStage;
  selected?: boolean;
  x?: number;
  y?: number;
  onSelect?: () => void;
}) {
  const bodyTop = 54;
  const bodyBottom = 168;
  const bulbTop = 0;
  const liquidTop = bodyTop + 10;

  return (
    <g transform={`translate(${x}, ${y})`}>
      {onSelect ? (
        <g
          role="button"
          tabIndex={0}
          aria-label="Pipette and filler. Activate to fill the pipette."
          onClick={onSelect}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          }}
          className="cursor-pointer"
        >
          <rect x={-14} y={-8} width={54} height={210} rx={8} fill="transparent" />
        </g>
      ) : null}

      {/* Filler bulb */}
      <ellipse
        cx={12}
        cy={bulbTop + 24}
        rx={14}
        ry={24}
        fill={selected ? "var(--primary)" : "var(--foreground)"}
        opacity={0.9}
      />
      <rect x={8} y={bulbTop + 46} width={8} height={10} fill="var(--foreground)" />

      {/* Pipette tube */}
      <rect
        x={6}
        y={bodyTop}
        width={12}
        height={bodyBottom - bodyTop}
        rx={4}
        fill="var(--lab-glass)"
        stroke="var(--lab-glass-border)"
        strokeWidth={1.6}
      />
      {/* Solution drawn up */}
      {stage === "filled" ? (
        <rect x={8} y={liquidTop} width={8} height={bodyBottom - liquidTop - 2} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={0.4} />
      ) : null}
      {/* Bulb of the pipette (bulb pipette) */}
      <ellipse cx={12} cy={118} rx={11} ry={20} fill="var(--lab-glass)" stroke="var(--lab-glass-border)" strokeWidth={1.4} />
      <text x={12} y={178} textAnchor="middle" fontSize={9} fill="var(--lab-scale)" fontWeight={500} className="tabular-nums">
        {nominalVolumeMl === null ? "pipette" : `${nominalVolumeMl} mL`}
      </text>
      <title>
        {nominalVolumeMl === null
          ? `Pipette with pipette filler. State: ${stage}. This stage does not pipette its analyte.`
          : `Pipette, ${nominalVolumeMl} mL, with pipette filler. State: ${stage}.`}
      </title>
    </g>
  );
}
