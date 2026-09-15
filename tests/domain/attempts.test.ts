import { describe, expect, it } from "vitest";
import {
  ATTEMPT_STATUSES,
  InvalidAttemptTransitionError,
  assertTransition,
  canTransition,
  isAttemptReadOnly,
  isAttemptStatus,
  isAttemptTerminal,
  isAttemptWritable,
  nextStatuses,
} from "@/domain/attempts";

describe("attempt lifecycle", () => {
  it("allows exactly the documented transitions", () => {
    expect(canTransition("in_progress", "submitted")).toBe(true);
    expect(canTransition("in_progress", "abandoned")).toBe(true);
    expect(canTransition("submitted", "graded")).toBe(true);
    expect(canTransition("submitted", "returned")).toBe(true);
    expect(canTransition("returned", "in_progress")).toBe(true);
  });

  it("refuses transitions that would rewrite history", () => {
    expect(canTransition("in_progress", "graded")).toBe(false);
    expect(canTransition("graded", "in_progress")).toBe(false);
    expect(canTransition("graded", "returned")).toBe(false);
    expect(canTransition("abandoned", "in_progress")).toBe(false);
    expect(canTransition("submitted", "in_progress")).toBe(false);
  });

  it("treats graded and abandoned as terminal", () => {
    expect(isAttemptTerminal("graded")).toBe(true);
    expect(isAttemptTerminal("abandoned")).toBe(true);
    expect(isAttemptTerminal("in_progress")).toBe(false);
    expect(isAttemptTerminal("returned")).toBe(false);
  });

  it("throws a typed error for an invalid transition", () => {
    expect(() => assertTransition("graded", "in_progress")).toThrow(InvalidAttemptTransitionError);
    expect(() => assertTransition("in_progress", "submitted")).not.toThrow();
  });

  it("lets a student write only while the attempt is live", () => {
    expect(isAttemptWritable("in_progress")).toBe(true);
    expect(isAttemptWritable("returned")).toBe(true);
    expect(isAttemptWritable("submitted")).toBe(false);
    expect(isAttemptWritable("graded")).toBe(false);
    expect(isAttemptReadOnly("submitted")).toBe(true);
  });

  it("covers every status in the transition table", () => {
    for (const status of ATTEMPT_STATUSES) {
      expect(Array.isArray(nextStatuses(status))).toBe(true);
    }
  });

  it("validates untrusted status values", () => {
    expect(isAttemptStatus("in_progress")).toBe(true);
    expect(isAttemptStatus("deleted")).toBe(false);
    expect(isAttemptStatus(42)).toBe(false);
  });
});
