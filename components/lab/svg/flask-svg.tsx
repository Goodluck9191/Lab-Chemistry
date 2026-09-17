import type { KeyboardEvent } from "react";
import type { FlaskView } from "../view-model";
import { flaskPinkOpacity } from "../view-model";

/**
 * Conical (Erlenmeyer) flask with its contents.
 *
 * The contents colour comes ONLY from the public view model, which in turn comes
 * from the engine's persisted `flaskColour`. The flask therefore reconstructs
 * itself exactly after a reload, and the component contains no threshold, no pH
 * and no endpoint arithmetic.
 *
 * The colourless solution and the endpoint pink are drawn as two layers whose
 * opacity changes, so the transition is visible without relying on colour-mix
 * support inside SVG.
 */
export function FlaskSvg({
  view,
  swirling = false,
  pouring = false,
  selected = false,
  x = 0,
  y = 0,
  label = true,
  onSelect,
  selectHint = "Activate to swirl.",
}: {
  view: FlaskView;
  swirling?: boolean;
  /** Brief UI-only ripple shown after the server accepts a delivery. */
  pouring?: boolean;
  selected?: boolean;
  x?: number;
  y?: number;
  label?: boolean;
  onSelect?: () => void;
  /**
   * What activating the flask does right now. The bench supplies the honest
   * wording, because swirling is only meaningful once a titration is running.
   */
  selectHint?: string;
}) {
  const neckTop = 0;
  const shoulder = 96;
  const base = 150;
  const neckWidth = 18;
  const bodyHalf = 52;
  const liquidTop = shoulder + (view.hasContents ? 18 : 150);

  // Liquid body path: a trapezoid body with a flat surface at `liquidTop`.
  const liquidPath = [
    `M -14 ${liquidTop}`,
    "L 14 " + liquidTop,
    `L ${bodyHalf} ${base - 6}`,
    `Q ${bodyHalf} ${base} ${bodyHalf - 8} ${base}`,
    `L ${-(bodyHalf - 8)} ${base}`,
    `Q ${-bodyHalf} ${base} ${-bodyHalf} ${base - 6}`,
    "Z",
  ].join(" ");

  return (
    <g transform={`translate(${x}, ${y})`}>
      {selected ? (
        <rect
          x={-bodyHalf - 14}
          y={neckTop - 12}
          width={(bodyHalf + 14) * 2}
          height={base - neckTop + 40}
          rx={12}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="7 5"
          aria-hidden="true"
        />
      ) : null}
      <g
        role={onSelect ? "button" : undefined}
        aria-label={onSelect ? `Conical flask. Contents: ${view.label}. ${selectHint}` : undefined}
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
      <g className={swirling ? "lab-swirl" : undefined}>
        {/* Liquid: colourless phase, then the endpoint phase on top */}
        {view.hasContents ? (
          <>
            <path d={liquidPath} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={1} className="lab-liquid-level" />
            <path
              d={liquidPath}
              fill="var(--lab-endpoint)"
              opacity={flaskPinkOpacity(view.colour)}
              className="lab-flask-colour"
            />
            {pouring ? (
              <ellipse
                cx={0}
                cy={liquidTop}
                rx={16}
                ry={3.5}
                fill="none"
                stroke="var(--lab-liquid-border)"
                strokeWidth={1.5}
                className="lab-ripple"
              />
            ) : null}
          </>
        ) : null}

        {/* Glass */}
        <path
          d={`M ${-neckWidth / 2} ${neckTop} L ${neckWidth / 2} ${neckTop} L ${neckWidth / 2} ${shoulder} L ${bodyHalf} ${base - 6} Q ${bodyHalf} ${base} ${bodyHalf - 8} ${base} L ${-(bodyHalf - 8)} ${base} Q ${-bodyHalf} ${base} ${-bodyHalf} ${base - 6} L ${-neckWidth / 2} ${shoulder} Z`}
          fill="var(--lab-glass)"
          fillOpacity={0.4}
          stroke="var(--lab-glass-border)"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {/* Meniscus of the flask contents */}
        {view.hasContents ? (
          <line
            x1={-14}
            y1={liquidTop}
            x2={14}
            y2={liquidTop}
            stroke="var(--lab-liquid-border)"
            strokeWidth={1.6}
          />
        ) : null}
      </g>
      </g>

      <title>
        {`Conical flask, 250 mL. ${view.label}. ${view.description}`}
      </title>

      {label ? (
        <text x={0} y={base + 18} textAnchor="middle" fontSize={12} fill="var(--lab-scale)" fontWeight={600}>
          {view.label}
        </text>
      ) : null}
    </g>
  );
}
