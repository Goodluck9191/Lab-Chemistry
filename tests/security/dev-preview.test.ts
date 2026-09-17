import { afterEach, describe, expect, it, vi } from "vitest";
import { previewIsEnabled } from "@/components/lab/preview/preview-gate";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { listFiles, read, projectPath, typeScriptFiles } from "../helpers/project-files";

/**
 * The development preview renders the laboratory from scenarios instead of a real
 * attempt. That is useful locally and dangerous in production, so this suite pins
 * the boundaries that keep it a harness:
 *
 *   1. it is switched off in a production build, and BOTH entry points ask;
 *   2. its future server files never reach the database or hidden state through a
 *      privileged client;
 *   3. nothing a student's route imports can reach it;
 *   4. nothing hidden is sent to the browser, because the only projection it uses
 *      is the public one.
 */

const PREVIEW_PREFIX = "components/lab/preview/";
const PREVIEW_FILES = typeScriptFiles("components/lab/preview").map(projectPath);
const PAGE = "app/(dev)/lab-preview/page.tsx";

/**
 * Source with comments removed.
 *
 * The checks below are about what the code DOES. A doc comment that mentions
 * Supabase or hidden state to explain why it is avoided must not read as a
 * violation — and, just as importantly, prose must never be able to satisfy a
 * check either.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the preview is switched off in production", () => {
  it("reports itself unavailable in a production build", () => {
    expect(previewIsEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(previewIsEnabled()).toBe(false);
  });

  it("is asked by the route before it renders anything", () => {
    const source = read(PAGE);
    expect(source).toContain("previewIsEnabled()");
    expect(source).toContain("notFound()");
    // The gate must come before the scenario is built, so a production request
    // never even constructs one.
    expect(source.indexOf("previewIsEnabled()")).toBeLessThan(
      source.indexOf("scenarioStateFor("),
    );
  });

  it("is asked by both server actions, not just the loader", () => {
    const source = read(`${PREVIEW_PREFIX}preview-actions.ts`);
    // One gate per exported action.
    const gates = source.match(/previewIsEnabled\(\)/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('"use server"');
  });

  it("lives outside the lab route group, so no student page can reach it", () => {
    expect(PAGE.startsWith("app/(dev)/")).toBe(true);
    // The laboratory's own route must not reference the harness at all.
    for (const file of [
      "app/(lab)/lab/[experimentId]/attempt/[attemptId]/page.tsx",
      "components/lab/lab-workspace.tsx",
      "components/lab/lab-state-provider.tsx",
    ]) {
      expect(read(file)).not.toContain("preview/");
    }
  });
});

describe("the preview cannot reach the database or hidden storage", () => {
  it("imports no privileged client and no secrets repository", () => {
    expect(PREVIEW_FILES.length).toBeGreaterThan(0);
    const forbidden = [
      /supabase/i,
      /\badmin\b/i,
      /service_role/i,
      /attempt_secrets/i,
      /applyTitrationAction/,
      /loadTitrationAttempt/,
      /initialiseTitrationAttempt/,
    ];
    for (const file of PREVIEW_FILES) {
      const code = codeOnly(read(file));
      for (const pattern of forbidden) expect(code).not.toMatch(pattern);
    }
  });

  it("keeps hidden state out of every client file it ships", () => {
    const clientFiles = PREVIEW_FILES.filter((file) => read(file).includes('"use client"'));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const code = codeOnly(read(file));
      // Every hidden value the engine knows about is named by its denylist, so a
      // leak cannot arrive under a name this suite has not heard of.
      //
      // `seed` is checked at the payload level instead: it is an ordinary English
      // word that legitimately appears in UI copy ("Rebuild this scenario from its
      // seed"), and `tests/security/lab-exposure.test.ts` already asserts no key on
      // the denylist — `seed` included — appears in the serialised view the browser
      // receives. The preview reuses that same payload shape.
      for (const key of HIDDEN_KEY_DENYLIST) {
        if (key === "seed") continue;
        expect(code).not.toContain(key);
      }
      // …and the client never touches the session at all.
      expect(code).not.toMatch(/\bsession\b/);
      expect(code).not.toContain("createTitrationSession");
      expect(code).not.toContain("dispatchTitrationAction");
      // The client must not reach the module that owns the session.
      expect(code).not.toContain('from "./scenarios"');
    }
  });

  it("routes every action through the shared protocol router and the schema", () => {
    const actions = codeOnly(read(`${PREVIEW_PREFIX}preview-actions.ts`));
    // The same parser the real action uses, so a preview action cannot be shaped
    // differently from a persisted one.
    expect(actions).toContain("parseTitrationEnvelope");
    expect(actions).toContain("titrationActionSchema");

    // The envelope is built by the controller on the client and forwarded
    // untouched, exactly as the persisted path forwards it to the server action.
    const canvas = codeOnly(read(`${PREVIEW_PREFIX}preview-canvas.tsx`));
    expect(canvas).toContain("envelope: input");
    expect(canvas).not.toContain("buildActionEnvelope");
  });
});

describe("the preview sends only the public projection", () => {
  it("builds its payload with the same function the real laboratory uses", () => {
    const source = read(`${PREVIEW_PREFIX}scenarios.ts`);
    // One payload shape for both paths: the preview cannot drift into exposing
    // something the real read path does not.
    expect(source).toContain("buildLabStateView");
    expect(source).toContain("toPublicJSON(session)");
    expect(source).not.toContain("session.public");
    expect(source).not.toContain("JSON.stringify(session)");
  });

  it("marks the harness as server-only so a client import fails loudly", () => {
    expect(read(`${PREVIEW_PREFIX}scenarios.ts`)).toContain('import "server-only"');
  });

  it("carries no attempt id that could collide with a real attempt", () => {
    const source = read(`${PREVIEW_PREFIX}scenarios.ts`);
    // A fixed, obviously-synthetic id: nothing is written anywhere, but this also
    // keeps a stray log line from looking like a real student's attempt.
    expect(source).toContain("00000000-0000-4000-8000-000000000002");
  });
});

describe("the preview directory stays small and deliberate", () => {
  it("contains only the harness files", () => {
    const names = listFiles("components/lab/preview", () => true)
      .map(projectPath)
      .map((file) => file.split("/").pop())
      .sort();
    expect(names).toEqual([
      "preview-actions.ts",
      "preview-canvas.tsx",
      "preview-gate.ts",
      "scenarios.ts",
    ]);
  });
});
