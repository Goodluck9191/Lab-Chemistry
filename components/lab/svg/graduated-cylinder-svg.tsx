import type { KeyboardEvent } from "react";

/**
 * Measuring cylinder, the ware Experiment 2's Part III uses to transfer the HCl
 * aliquot ("Using a measuring cylinder, transfer approximately 25.00 mL").
 *
 * `stage` is UI-only progress: the student measures the solution into the
 * cylinder and then delivers it into the flask. WHICH number that is comes from
 * the student's own recorded reading on the server — the drawing never invents a
 * volume, and the meniscus is far too coarse to read instead of the cylinder.
 */
export type AliquotStage = "resting" | "measured" | "delivered";

export function GraduatedCylinderSvg({
  nominalVolumeMl,
  stage,
  selected = false,
  x = 0,
  y = 0,
  onSelect,
}: {
  nominalVolumeMl: number | null;
  stage: AliquotStage;
  selected?: boolean;
  x?: number;
  y?: number;
  onSelect?: () => void;
}) {
  const bodyTop = 12;
  const bodyBottom = 148;
  const bodyLeft = 8;
  const bodyWidth = 40;
  const bodyRight = bodyLeft + bodyWidth;
  // Measured: the liquid stands at the mark. Delivered: it has been poured off.
  const liquidTop = stage === "measured" ? 40 : bodyBottom;
  const hasLiquid = stage === "measured";

  const graduations: Array<{ value: number; y: number; major: boolean }> = [];
  for (let step = 0; step <= 5; step += 1) {
    const value = step * 5;
    graduations.push({
      value,
      y: bodyBottom - (step / 5) * (bodyBottom - bodyTop - 20),
      major: step % 5 === 0,
    });
  }

  const stateLabel =
    stage === "measured"
      ? `measured at the ${nominalVolumeMl ?? ""} mL mark`
      : stage === "delivered"
        ? "delivered into the flask, now empty"
        : "empty";

  return (
    <g transform={`translate(${x}, ${y})`}>
      {selected ? (
        <rect
          x={-6}
          y={0}
          width={bodyWidth + 12}
          height={bodyBottom + 34}
          rx={10}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="7 5"
          aria-hidden="true"
        />
      ) : null}
      <g
        role={onSelect ? "button" : "img"}
        aria-label={
          onSelect
            ? `Measuring cylinder${nominalVolumeMl === null ? "" : `, ${nominalVolumeMl} mL`}. State: ${stateLabel}. Activate to bring its controls into the action panel.`
            : `Measuring cylinder${nominalVolumeMl === null ? "" : `, ${nominalVolumeMl} mL`}. State: ${stateLabel}.`
        }
        {...(onSelect
          ? {
              tabIndex: 0,
              onClick: onSelect,
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect();
                }
              },
              className: "cursor-pointer",
            }
          : {})}
      >
        {/* Body */}
        <rect
          x={bodyLeft}
          y={bodyTop}
          width={bodyWidth}
          height={bodyBottom - bodyTop}
          rx={3}
          fill="var(--lab-glass)"
          stroke="var(--lab-glass-border)"
          strokeWidth={2}
        />
        {/* Pouring lip */}
        <path
          d={`M ${bodyLeft - 4} ${bodyTop} L ${bodyLeft} ${bodyTop + 6} L ${bodyRight} ${bodyTop + 6} L ${bodyRight + 4} ${bodyTop} Z`}
          fill="var(--lab-glass)"
          stroke="var(--lab-glass-border)"
          strokeWidth={1.6}
        />
        {hasLiquid ? (
          <>
            <rect
              x={bodyLeft + 2}
              y={liquidTop}
              width={bodyWidth - 4}
              height={bodyBottom - liquidTop - 1}
              fill="var(--lab-liquid)"
              stroke="var(--lab-liquid-border)"
              strokeWidth={0.6}
              className="lab-liquid-level"
            />
            <line
              x1={bodyLeft + 2}
              y1={liquidTop}
              x2={bodyRight - 2}
              y2={liquidTop}
              stroke="var(--lab-liquid-border)"
              strokeWidth={1.4}
            />
          </>
        ) : null}
        {graduations.map((graduation) => (
          <line
            key={graduation.value}
            x1={bodyRight - (graduation.major ? 18 : 10)}
            y1={graduation.y}
            x2={bodyRight}
            y2={graduation.y}
            stroke="var(--lab-scale)"
            strokeWidth={graduation.major ? 1.6 : 1}
          />
        ))}
        {/* Base */}
        <rect
          x={bodyLeft - 10}
          y={bodyBottom}
          width={bodyWidth + 20}
          height={8}
          rx={3}
          fill="var(--lab-glass)"
          stroke="var(--lab-glass-border)"
          strokeWidth={1.6}
        />
      </g>
      <title>
        {`Measuring cylinder${nominalVolumeMl === null ? "" : `, ${nominalVolumeMl} mL`}. ${stateLabel}.`}
      </title>
      <text
        x={bodyLeft + bodyWidth / 2}
        y={bodyBottom + 26}
        textAnchor="middle"
        fontSize={9}
        fill="var(--lab-scale)"
      >
        cylinder
      </text>
      {stage === "measured" && nominalVolumeMl !== null ? (
        <text
          x={bodyLeft + bodyWidth / 2}
          y={bodyBottom + 38}
          textAnchor="middle"
          fontSize={9}
          fill="var(--lab-scale)"
          fontWeight={600}
        >
          {`${nominalVolumeMl.toFixed(2)} mL`}
        </text>
      ) : null}
    </g>
  );
}
