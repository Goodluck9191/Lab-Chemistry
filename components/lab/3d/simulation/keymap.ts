/**
 * The laboratory keybind table.
 *
 * ONE source of truth for two things that must never drift apart:
 *
 *   - the DOM keyboard handler (`ImmersiveLab`), which dispatches commands
 *   - the contextual prompt, which advertises the keys it can act on
 *
 * Pure and DOM-free, so the mapping is unit-tested rather than discovered by
 * pressing keys in a browser.
 */

export type LabCommand = "interact" | "rotate" | "focus" | "confirm" | "cancel";

export interface LabKeybind {
  command: LabCommand;
  /** Key as a student would say it out loud. */
  key: string;
  /** `KeyboardEvent.code`, which is layout-independent. */
  code: string;
  /** Verb shown in the prompt: "E Interact". */
  label: string;
  description: string;
}

export const LAB_KEYBINDS: readonly LabKeybind[] = [
  {
    command: "interact",
    key: "E",
    code: "KeyE",
    label: "Interact",
    description: "Act on the apparatus you are looking at",
  },
  {
    command: "rotate",
    key: "R",
    code: "KeyR",
    label: "Rotate",
    description: "Turn the object you are holding",
  },
  {
    command: "focus",
    key: "F",
    code: "KeyF",
    label: "Inspect",
    description: "Move in close on the apparatus you selected",
  },
  {
    command: "confirm",
    key: "Space",
    code: "Space",
    label: "Confirm",
    description: "Accept the current step",
  },
  {
    command: "cancel",
    key: "Esc",
    code: "Escape",
    label: "Step back",
    description: "Release the pointer, close the prompt, clear the selection",
  },
] as const;

const BY_CODE = new Map<string, LabCommand>(LAB_KEYBINDS.map((bind) => [bind.code, bind.command]));

/** The command a key code issues, or null when the key is not ours. */
export function commandForCode(code: string): LabCommand | null {
  return BY_CODE.get(code) ?? null;
}

export function keybindFor(command: LabCommand): LabKeybind {
  return LAB_KEYBINDS.find((bind) => bind.command === command) ?? LAB_KEYBINDS[0];
}

/**
 * Whether a keystroke is going into a text field. Walking, rotating and
 * interacting must all stand down while the student types a reading — the same
 * rule the camera already applies to WASD.
 */
export function isTextEntryTarget(element: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Rotation applied per press of the rotate key (a visible but calm step). */
export const ROTATE_STEP_RADIANS = Math.PI / 12;

/** Rotation applied per tick of a drag-rotate gesture. */
export const ROTATE_DRAG_RADIANS_PER_PIXEL = 0.01;

export interface HeldRotation {
  /** Y-axis rotation of the carried object, radians. */
  yawRadians: number;
}

export const NO_ROTATION: HeldRotation = { yawRadians: 0 };

/** Normalise into (-π, π] so a long walk of R presses cannot drift unbounded. */
export function normaliseAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((radians + Math.PI) % twoPi + twoPi) % twoPi;
  return wrapped - Math.PI;
}

export function rotateBy(current: HeldRotation, deltaRadians: number): HeldRotation {
  return { yawRadians: normaliseAngle(current.yawRadians + deltaRadians) };
}

/** Human-readable rotation for the HUD, e.g. "45°". */
export function rotationLabel(rotation: HeldRotation): string {
  const degrees = Math.round((normaliseAngle(rotation.yawRadians) * 180) / Math.PI);
  return `${degrees}°`;
}
