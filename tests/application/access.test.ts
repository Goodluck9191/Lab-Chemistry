import { describe, expect, it } from "vitest";
import {
  canAccessInstructorArea,
  canAccessStudentArea,
  canReadAttemptData,
  canWriteAttemptData,
  dashboardPathForRole,
  isAuthenticated,
} from "@/application/auth/access";

const STUDENT = { id: "11111111-1111-1111-1111-111111111111", role: "student" as const };
const OTHER_STUDENT = { id: "22222222-2222-2222-2222-222222222222", role: "student" as const };
const INSTRUCTOR = { id: "33333333-3333-3333-3333-333333333333", role: "instructor" as const };

describe("area access", () => {
  it("denies both areas to an unauthenticated visitor", () => {
    expect(canAccessStudentArea(null)).toBe(false);
    expect(canAccessStudentArea(undefined)).toBe(false);
    expect(canAccessInstructorArea(null)).toBe(false);
    expect(isAuthenticated(null)).toBe(false);
  });

  it("keeps a student out of the instructor area", () => {
    expect(canAccessStudentArea(STUDENT.role)).toBe(true);
    expect(canAccessInstructorArea(STUDENT.role)).toBe(false);
  });

  it("keeps an instructor out of the student area", () => {
    expect(canAccessInstructorArea(INSTRUCTOR.role)).toBe(true);
    expect(canAccessStudentArea(INSTRUCTOR.role)).toBe(false);
  });

  it("sends each role to its own dashboard and anonymous visitors to login", () => {
    expect(dashboardPathForRole("student")).toBe("/student/dashboard");
    expect(dashboardPathForRole("instructor")).toBe("/instructor/dashboard");
    expect(dashboardPathForRole(null)).toBe("/login");
  });
});

describe("attempt data access", () => {
  const attemptOf = (owner: string) => ({ attemptStudentId: owner });

  it("lets a student read their own attempt", () => {
    expect(
      canReadAttemptData({ role: STUDENT.role, userId: STUDENT.id, ...attemptOf(STUDENT.id) }),
    ).toBe(true);
  });

  it("stops a student reading another student's attempt", () => {
    expect(
      canReadAttemptData({
        role: OTHER_STUDENT.role,
        userId: OTHER_STUDENT.id,
        ...attemptOf(STUDENT.id),
      }),
    ).toBe(false);
  });

  it("lets an instructor read a student's attempt", () => {
    expect(
      canReadAttemptData({
        role: INSTRUCTOR.role,
        userId: INSTRUCTOR.id,
        ...attemptOf(STUDENT.id),
      }),
    ).toBe(true);
  });

  it("never lets an instructor write a student's readings", () => {
    expect(
      canWriteAttemptData({
        role: INSTRUCTOR.role,
        userId: INSTRUCTOR.id,
        attemptStudentId: STUDENT.id,
        status: "in_progress",
      }),
    ).toBe(false);
  });

  it("stops a student writing to another student's attempt", () => {
    expect(
      canWriteAttemptData({
        role: OTHER_STUDENT.role,
        userId: OTHER_STUDENT.id,
        attemptStudentId: STUDENT.id,
        status: "in_progress",
      }),
    ).toBe(false);
  });

  it("freezes writes once the attempt is submitted, graded or abandoned", () => {
    for (const status of ["submitted", "graded", "abandoned"] as const) {
      expect(
        canWriteAttemptData({
          role: STUDENT.role,
          userId: STUDENT.id,
          attemptStudentId: STUDENT.id,
          status,
        }),
      ).toBe(false);
    }
  });

  it("reopens writes when an attempt is returned for revision", () => {
    expect(
      canWriteAttemptData({
        role: STUDENT.role,
        userId: STUDENT.id,
        attemptStudentId: STUDENT.id,
        status: "returned",
      }),
    ).toBe(true);
  });

  it("denies everything to an unauthenticated visitor", () => {
    expect(
      canReadAttemptData({ role: null, userId: null, attemptStudentId: STUDENT.id }),
    ).toBe(false);
    expect(
      canWriteAttemptData({
        role: null,
        userId: null,
        attemptStudentId: STUDENT.id,
        status: "in_progress",
      }),
    ).toBe(false);
  });
});
