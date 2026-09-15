import { describe, expect, it } from "vitest";
import { projectPath, read, typeScriptFiles } from "../helpers/project-files";

/**
 * Keeps the service-role key, the admin client and hidden experiment data out of
 * anything the browser can reach. These are static checks over the source tree,
 * so they hold even without a database or a production build.
 */
const appFiles = typeScriptFiles("app");
const componentFiles = typeScriptFiles("components");
const applicationFiles = typeScriptFiles("application");
const infrastructureFiles = typeScriptFiles("infrastructure");
const libFiles = typeScriptFiles("lib");
const clientReachable = [...appFiles, ...componentFiles];

const ALLOWED_SERVICE_KEY_READERS = ["lib/env.ts"];

describe("service-role key containment", () => {
  it("is read in exactly one permitted module", () => {
    const readers = [...applicationFiles, ...infrastructureFiles, ...clientReachable, ...libFiles]
      .filter((file) => read(file).includes("SUPABASE_SERVICE_ROLE_KEY"))
      .map(projectPath);

    expect(readers.sort()).toEqual(ALLOWED_SERVICE_KEY_READERS.sort());
  });

  it("is never read from a client-reachable file", () => {
    const offenders = clientReachable.filter(
      (file) => read(file).includes("SUPABASE_SERVICE_ROLE_KEY") || read(file).includes("service_role"),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches the key only through the validated accessor", () => {
    const admin = read("infrastructure/supabase/admin.ts");
    expect(admin).toContain("requireServiceRoleKey");
    expect(admin).not.toContain("process.env");
  });

  it("marks the admin client and every server-only module as server-only", () => {
    for (const file of [
      "infrastructure/supabase/admin.ts",
      "infrastructure/supabase/server.ts",
      "application/auth/dal.ts",
    ]) {
      expect(read(file), `${file} must import "server-only"`).toMatch(/import "server-only"/);
    }
  });
});

describe("client components stay clean", () => {
  it("imports no admin client, no attempt_secrets and no repository from a client file", () => {
    const clientFiles = clientReachable.filter((file) => /^\s*"use client"/m.test(read(file)));
    expect(clientFiles.length).toBeGreaterThan(0);

    const offenders = clientFiles.filter((file) => {
      const source = read(file);
      return (
        source.includes("supabase/admin") ||
        source.includes("attempt_secrets") ||
        source.includes("repositories/") ||
        source.includes("@/infrastructure/supabase/server")
      );
    });

    expect(offenders).toEqual([]);
  });

  it("uses the public anon client in the browser and never a privileged client", () => {
    const browserClient = read("infrastructure/supabase/client.ts");
    expect(browserClient).toContain("createBrowserClient");
    expect(browserClient).not.toContain("SERVICE_ROLE");
  });
});

describe("authorisation is never derived from the session cookie alone", () => {
  it("validates the user with getUser() rather than trusting getSession()", () => {
    const dal = read("application/auth/dal.ts");
    expect(dal).toContain("auth.getUser()");
    expect(dal).not.toContain("auth.getSession()");
  });

  it("never forwards a role from the signup form", () => {
    const actions = read("application/auth/actions.ts");
    const metadata = /data:\s*\{([\s\S]*?)\}/.exec(actions)?.[1] ?? "";
    expect(metadata).toContain("full_name");
    expect(metadata).not.toMatch(/role/i);
  });
});

describe("hidden experimental parameters", () => {
  it("are described as server-only in the domain contract", () => {
    const secrets = read("domain/simulation/secrets.ts");
    expect(secrets).toContain("attempt_secrets");
    expect(secrets).toContain("SECURITY CONTRACT");
  });

  it("are never required by the experiment configuration sent to the database", () => {
    const seed = read("supabase/seed.sql");
    expect(seed).not.toMatch(/true_values|expected_endpoint|rubric_weights/i);
  });
});
