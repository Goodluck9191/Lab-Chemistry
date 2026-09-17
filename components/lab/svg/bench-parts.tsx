/**
 * Supporting bench apparatus: reagent bottles, wash bottle, beaker, volumetric
 * flask, weighing bottle, white tile, waste container and the pipette rack.
 *
 * These pieces are deliberately dumb: they draw what they are given. Anything
 * that can be selected exposes a real accessible name and both pointer and
 * keyboard activation, so the bench is usable without a mouse, and every piece
 * carries an SVG `<title>` so hovering or focusing explains it.
 */
import type { KeyboardEvent } from "react";

function selectionRing(selected: boolean): string {
  return selected ? "var(--primary)" : "var(--lab-glass-border)";
}

export function ReagentBottleSvg({
  label,
  sublabel,
  selected = false,
  x = 0,
  y = 0,
  onSelect,
  interactive = true,
}: {
  label: string;
  sublabel?: string;
  selected?: boolean;
  x?: number;
  y?: number;
  onSelect?: () => void;
  interactive?: boolean;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g
        role={interactive && onSelect ? "button" : "img"}
        aria-label={interactive && onSelect ? `Reagent bottle: ${label}. Activate to select.` : `Reagent bottle: ${label}`}
        {...(interactive && onSelect
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
        {/* Cap */}
        <rect x={10} y={0} width={22} height={9} rx={2} fill="var(--foreground)" />
        {/* Neck */}
        <rect x={15} y={9} width={12} height={10} fill="var(--lab-glass)" stroke="var(--lab-glass-border)" strokeWidth={1.4} />
        {/* Bottle */}
        <rect
          x={2}
          y={19}
          width={38}
          height={58}
          rx={5}
          fill="var(--lab-glass)"
          stroke={selectionRing(selected)}
          strokeWidth={selected ? 2.5 : 1.6}
        />
        <rect x={6} y={44} width={30} height={30} rx={3} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={0.4} />
        <text x={21} y={35} textAnchor="middle" fontSize={8} fill="var(--foreground)" fontWeight={500}>
          {label}
        </text>
      </g>
      {sublabel ? (
        <text x={21} y={92} textAnchor="middle" fontSize={8} fill="var(--muted)">
          {sublabel}
        </text>
      ) : null}
      <title>{`${label}${sublabel ? ` — ${sublabel}` : ""}`}</title>
    </g>
  );
}

export function WashBottleSvg({
  label,
  x = 0,
  y = 0,
  onSelect,
  selected = false,
}: {
  label: string;
  x?: number;
  y?: number;
  onSelect?: () => void;
  selected?: boolean;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g
        role={onSelect ? "button" : "img"}
        aria-label={`Wash bottle: ${label}${onSelect ? ". Activate to select." : ""}`}
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
        <path
          d="M 6 22 L 34 22 L 34 78 Q 34 84 28 84 L 12 84 Q 6 84 6 78 Z"
          fill="var(--lab-glass)"
          stroke={selectionRing(selected)}
          strokeWidth={selected ? 2.5 : 1.6}
        />
        <rect x={8} y={46} width={24} height={38} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={0.4} />
        {/* Spout */}
        <path d="M 20 22 L 20 8 L 40 2" fill="none" stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" />
        <text x={20} y={62} textAnchor="middle" fontSize={7} fill="var(--foreground)" fontWeight={500}>
          {label}
        </text>
      </g>
      <title>{`Wash bottle: ${label}`}</title>
    </g>
  );
}

export function BeakerSvg({
  x = 0,
  y = 0,
  fillFraction = 0,
}: {
  x?: number;
  y?: number;
  /** Decorative only: the benchware the configuration does not size. */
  fillFraction?: number;
}) {
  const top = 0;
  const bottom = 56;
  const liquidTop = bottom - Math.max(0, Math.min(1, fillFraction)) * (bottom - top - 6);
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d={`M 0 ${top} L 0 ${bottom - 4} Q 0 ${bottom} 6 ${bottom} L 44 ${bottom} Q 50 ${bottom} 50 ${bottom - 4} L 50 ${top}`}
        fill="var(--lab-glass)"
        stroke="var(--lab-glass-border)"
        strokeWidth={1.6}
      />
      {fillFraction > 0 ? (
        <path d={`M 2 ${liquidTop} L 48 ${liquidTop} L 48 ${bottom - 6} L 2 ${bottom - 6} Z`} fill="var(--lab-liquid)" stroke="var(--lab-liquid-border)" strokeWidth={0.4} />
      ) : null}
      <title>Beaker</title>
      <text x={25} y={bottom + 14} textAnchor="middle" fontSize={9} fill="var(--lab-scale)">
        beaker
      </text>
    </g>
  );
}

export function VolumetricFlaskSvg({
  capacityMl = null,
  x = 0,
  y = 0,
}: {
  /** Rendered only when the configuration sizes it; never assumed. */
  capacityMl?: number | null;
  x?: number;
  y?: number;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path
        d="M 18 0 L 26 0 L 26 34 L 44 92 Q 46 100 38 100 L 6 100 Q -2 100 0 92 L 18 34 Z"
        fill="var(--lab-glass)"
        stroke="var(--lab-glass-border)"
        strokeWidth={1.6}
      />
      <line x1={18} y1={26} x2={26} y2={26} stroke="var(--lab-scale)" strokeWidth={1.2} />
      <title>
        {capacityMl === null ? "Volumetric flask" : `Volumetric flask, ${capacityMl} mL`}
      </title>
      <text x={21} y={114} textAnchor="middle" fontSize={9} fill="var(--lab-scale)">
        {capacityMl === null ? "flask" : `${capacityMl} mL flask`}
      </text>
    </g>
  );
}

export function WeighingBottleSvg({ x = 0, y = 0, filled = true }: { x?: number; y?: number; filled?: boolean }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M 0 16 L 0 40 L 44 40 L 44 16 L 30 16 L 30 10 L 14 10 L 14 16 Z" fill="var(--lab-glass)" stroke="var(--lab-glass-border)" strokeWidth={1.4} />
      {filled ? <path d="M 3 30 L 41 30 L 41 38 L 3 38 Z" fill="var(--lab-precipitate)" stroke="var(--lab-glass-border)" strokeWidth={0.4} /> : null}
      <title>{filled ? "Weighing bottle with the sample" : "Empty weighing bottle"}</title>
    </g>
  );
}

export function WhiteTileSvg({ x = 0, y = 0, width = 150 }: { x?: number; y?: number; width?: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={0} width={width} height={16} rx={2} fill="var(--surface)" stroke="var(--lab-glass-border)" strokeWidth={1.4} />
      <title>White tile, used to judge the colour change</title>
    </g>
  );
}

export function WasteContainerSvg({
  x = 0,
  y = 0,
  label = "Waste container",
  discardedCount = null,
}: {
  x?: number;
  y?: number;
  label?: string;
  /**
   * Discarded trials across the attempt, or null when unknown. Renders a waste
   * level proportional to the count (capped for drawing) — the count in the
   * title is the honest signal, straight from the persisted trials.
   */
  discardedCount?: number | null;
}) {
  const level = discardedCount === null ? 0 : Math.max(0, Math.min(1, discardedCount / 6));
  const liquidTop = 74 - level * 58;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M 4 8 L 60 8 L 54 74 L 10 74 Z" fill="var(--surface-muted)" stroke="var(--foreground)" strokeWidth={1.4} />
      {level > 0 ? (
        <path
          d={`M 8 ${liquidTop} L 56 ${liquidTop} L 52 70 L 12 70 Z`}
          fill="var(--lab-liquid)"
          stroke="var(--lab-liquid-border)"
          strokeWidth={0.4}
          opacity={0.75}
          className="transition-opacity duration-300"
        />
      ) : null}
      <rect x={0} y={0} width={64} height={10} rx={3} fill="var(--foreground)" />
      <text x={32} y={42} textAnchor="middle" fontSize={8} fill="var(--lab-scale)" fontWeight={500}>
        waste
      </text>
      <title>
        {discardedCount === null || discardedCount === 0
          ? label
          : `${label} — ${discardedCount} discarded trial${discardedCount === 1 ? "" : "s"} so far`}
      </title>
      <text x={32} y={90} textAnchor="middle" fontSize={9} fill="var(--lab-scale)">
        {label}
      </text>
    </g>
  );
}

export function PipetteRackSvg({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={0} y={0} width={56} height={64} rx={4} fill="var(--surface-muted)" stroke="var(--foreground)" strokeWidth={1.4} />
      <line x1={0} y1={16} x2={56} y2={16} stroke="var(--foreground)" strokeWidth={1.5} />
      <line x1={0} y1={42} x2={56} y2={42} stroke="var(--foreground)" strokeWidth={1.5} />
      <title>Pipette rack</title>
    </g>
  );
}

export function DropperBottleSvg({
  label,
  selected = false,
  x = 0,
  y = 0,
  onSelect,
}: {
  label: string;
  selected?: boolean;
  x?: number;
  y?: number;
  onSelect?: () => void;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g
        role={onSelect ? "button" : "img"}
        aria-label={`Indicator bottle: ${label}${onSelect ? ". Activate to add drops." : ""}`}
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
        <rect x={14} y={0} width={10} height={16} rx={2} fill="var(--foreground)" />
        <path
          d="M 6 16 L 32 16 L 32 60 Q 32 66 26 66 L 12 66 Q 6 66 6 60 Z"
          fill="var(--lab-glass)"
          stroke={selectionRing(selected)}
          strokeWidth={selected ? 2.5 : 1.6}
        />
        <rect x={9} y={40} width={20} height={22} rx={2} fill="var(--lab-endpoint)" opacity={0.7} />
      </g>
      <title>{label}</title>
    </g>
  );
}
