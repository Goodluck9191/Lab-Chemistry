import type { KeyboardEvent } from "react";
import type { BuretteView } from "../view-model";

/**
 * The burette: scale, liquid column, meniscus, tip and stopcock.
 *
 * GEOMETRY IS PRESENTATION ONLY. The liquid surface is drawn from the PUBLIC
 * view model (`readingMl`, derived from the initial reading the student recorded
 * plus the volume the server accepted as delivered). The component performs no
 * arithmetic on chemistry and never receives a hidden value: the drawing is far
 * too coarse to replace actually reading the meniscus, which is why the reading
 * is still entered by the student.
 *
 * `opened` reflects the stopcock the student turned; `flowing` renders the
 * liquid stream while the path is open on a live trial. Both are UI state —
 * the transferred volume is confirmed by the server on every delivery.
 */
export function BuretteSvg({
  view,
  opened,
  flowing = false,
  selected = false,
  x = 0,
  y = 0,
  onToggleStopcock,
  interactive = true,
}: {
  view: BuretteView;
  opened: boolean;
  flowing?: boolean;
  selected?: boolean;
  x?: number;
  y?: number;
  onToggleStopcock?: () => void;
  interactive?: boolean;
}) {
  const tubeTop = 40;
  const tubeBottom = 300;
  const tubeLeft = 30;
  const tubeWidth = 36;
  const tubeRight = tubeLeft + tubeWidth;
  const pxPerMl = (tubeBottom - tubeTop) / view.capacityMl;
  const liquidTop =
    view.readingMl === null ? tubeTop : tubeTop + (view.readingMl / view.capacityMl) * (tubeBottom - tubeTop);
  const hasLiquid = view.readingMl !== null;
  const showStream = flowing && hasLiquid;

  // One graduation per mL; medium ticks every 5 mL; numbered majors every 10 mL.
  // The loop is capped so an unusual capacity cannot flood the drawing.
  const graduations: Array<{ value: number; y: number; kind: "minor" | "mid" | "major" }> = [];
  const stepCount = Math.min(Math.round(view.capacityMl), 100);
  for (let ml = 0; ml <= stepCount; ml += 1) {
    graduations.push({
      value: ml,
      y: tubeTop + ml * pxPerMl,
      kind: ml % 10 === 0 ? "major" : ml % 5 === 0 ? "mid" : "minor",
    });
  }

  const tickLength = (kind: "minor" | "mid" | "major") =>
    kind === "major" ? 20 : kind === "mid" ? 14 : 8;

  return (
    <g transform={`translate(${x}, ${y})`}>
      {selected ? (
        <rect
          x={-50}
          y={18}
          width={140}
          height={tubeBottom + 100}
          rx={14}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="8 6"
          aria-hidden="true"
        />
      ) : null}
      {/* Clamp holding the burette */}
      <rect x={-30} y={64} width={66} height={14} rx={4} fill="var(--line-strong)" />
      <rect x={-44} y={30} width={22} height={112} rx={3} fill="var(--line)" />

      {/* Tube */}
      <rect
        x={tubeLeft}
        y={tubeTop}
        width={tubeWidth}
        height={tubeBottom - tubeTop}
        rx={8}
        fill="var(--lab-glass)"
        stroke="var(--lab-glass-border)"
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />

      {/* Liquid column down to the stopcock */}
      {hasLiquid ? (
        <rect
          x={tubeLeft + 3}
          y={liquidTop}
          width={tubeWidth - 6}
          height={Math.max(0, tubeBottom - liquidTop)}
          fill="var(--lab-liquid)"
          stroke="var(--lab-liquid-border)"
          strokeWidth={1}
          className="lab-liquid-level"
        />
      ) : null}

      {graduations.map((graduation) => (
        <g key={graduation.value}>
          <line
            x1={tubeRight - tickLength(graduation.kind)}
            y1={graduation.y}
            x2={tubeRight}
            y2={graduation.y}
            stroke="var(--lab-scale)"
            strokeWidth={graduation.kind === "minor" ? 1 : 1.6}
            vectorEffect="non-scaling-stroke"
          />
          {graduation.kind === "major" ? (
            <text
              x={tubeLeft - 6}
              y={graduation.y + 4}
              textAnchor="end"
              fontSize={12}
              fill="var(--lab-scale)"
              fontWeight={600}
              className="tabular-nums"
            >
              {graduation.value}
            </text>
          ) : null}
        </g>
      ))}

      {/* Meniscus: the bottom of the curve is what the student reads */}
      {hasLiquid ? (
        <path
          d={`M ${tubeLeft + 3} ${liquidTop - 3.5} Q ${tubeLeft + tubeWidth / 2} ${liquidTop + 5} ${tubeRight - 3} ${liquidTop - 3.5}`}
          fill="none"
          stroke="var(--lab-scale)"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
          className="lab-meniscus"
        />
      ) : null}

      {/* Tip */}
      <path
        d={`M ${tubeLeft + 11} ${tubeBottom} L ${tubeLeft + 11} ${tubeBottom + 28} L ${tubeLeft + tubeWidth - 11} ${tubeBottom} Z`}
        fill="var(--lab-glass)"
        stroke="var(--lab-glass-border)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      {/* Liquid stream while the path is open on a live trial */}
      {showStream ? (
        <g className="lab-stream" aria-hidden="true">
          <rect
            x={tubeLeft + tubeWidth / 2 - 2}
            y={tubeBottom + 28}
            width={4}
            height={44}
            fill="var(--lab-liquid)"
          />
          <circle cx={tubeLeft + tubeWidth / 2} cy={tubeBottom + 80} r={3.5} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={0.75} className="lab-drip" />
        </g>
      ) : null}

      {/* Stopcock */}
      <g
        role={interactive ? "button" : "img"}
        aria-label={
          interactive
            ? `Burette stopcock: ${opened ? "open" : "closed"}. Activate to ${opened ? "close" : "open"}.`
            : `Burette stopcock: ${opened ? "open" : "closed"}`
        }
        {...(interactive
          ? {
              tabIndex: 0,
              onClick: onToggleStopcock,
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleStopcock?.();
                }
              },
              className: "cursor-pointer",
            }
          : {})}
      >
        <rect
          x={tubeLeft - 24}
          y={tubeBottom + 92}
          width={tubeWidth + 48}
          height={22}
          rx={6}
          fill="transparent"
        />
        <rect
          x={tubeLeft - 8}
          y={tubeBottom + 48}
          width={tubeWidth + 16}
          height={20}
          rx={10}
          fill={opened ? "var(--primary)" : "var(--foreground)"}
          stroke="var(--foreground)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={tubeLeft + tubeWidth / 2 - 2.5}
          y={opened ? tubeBottom + 40 : tubeBottom + 50}
          width={5}
          height={opened ? 34 : 16}
          rx={2.5}
          fill={opened ? "var(--primary)" : "var(--muted)"}
          className="lab-stopcock"
        />
      </g>

      {/* State label: never colour-only */}
      <text
        x={tubeLeft + tubeWidth / 2}
        y={tubeBottom + 92}
        textAnchor="middle"
        fontSize={12}
        fill="var(--lab-scale)"
        fontWeight={600}
      >
        {opened ? "stopcock open" : "stopcock closed"}
      </text>
      <title>
        {`Burette, ${view.capacityMl} mL, graduated to ${view.graduationMl} mL. ${
          view.readingMl === null ? "Not yet filled." : `Meniscus near ${view.readingMl.toFixed(2)} mL.`
        }`}
      </title>
    </g>
  );
}
