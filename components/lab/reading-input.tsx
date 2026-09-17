"use client";

import { Input, Field } from "@/components/ui/input";

/**
 * Source of truth for what counts as a well-formed reading in the UI.
 *
 * This validates SHAPE ONLY (a finite number, not negative, no more decimal
 * places than the instrument reports). Whether the reading is scientifically
 * acceptable is decided by the server: the domain engine compares it against the
 * volume it actually delivered and records a reading error if it disagrees.
 */
export type ReadingKind = "burette" | "mass" | "volume" | "concentration";

const DECIMALS: Record<ReadingKind, number> = {
  burette: 2,
  mass: 2,
  volume: 2,
  concentration: 6,
};

export const READING_LABELS: Record<ReadingKind, string> = {
  burette: "burette reading",
  mass: "mass",
  volume: "volume",
  concentration: "concentration",
};

export type ParsedReading =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parseReading(raw: string, kind: ReadingKind): ParsedReading {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "Enter the value you read." };
  if (!/^\d*(\.\d*)?$/.test(trimmed)) {
    return { ok: false, error: "Use digits and a decimal point only." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: "That is not a number." };
  if (value < 0) return { ok: false, error: "A negative reading is not possible." };
  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  if (decimals > DECIMALS[kind]) {
    return {
      ok: false,
      error: `Record this to ${DECIMALS[kind]} decimal place${DECIMALS[kind] === 1 ? "" : "s"}.`,
    };
  }
  return { ok: true, value };
}

export function ReadingInput({
  id,
  label,
  kind,
  value,
  onChange,
  disabled = false,
  hint,
  unit = "mL",
  className,
}: {
  id: string;
  label: string;
  kind: ReadingKind;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  hint?: string;
  unit?: string;
  className?: string;
}) {
  const parsed = value.trim().length === 0 ? null : parseReading(value, kind);
  const error = parsed && !parsed.ok ? parsed.error : null;

  return (
    <div className={className}>
      <Field
        label={label}
        htmlFor={id}
        hint={hint ?? `Record to ${DECIMALS[kind]} decimal places, in ${unit}.`}
      >
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="text-sm text-muted" aria-hidden="true">
            {unit}
          </span>
        </div>
      </Field>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** True when the field holds a complete, well-formed reading. */
export function readingIsUsable(value: string, kind: ReadingKind): boolean {
  const parsed = parseReading(value, kind);
  return parsed.ok;
}
