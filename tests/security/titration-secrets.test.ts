import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exp02TitrationConfig } from "@/domain/experiments/catalog/exp-02-titration-config";
import {
  createTitrationSession,
  toPublicJSON,
} from "@/domain/simulation/titration/engine";
import { HIDDEN_KEY_DENYLIST } from "@/domain/simulation/titration/hidden";
import { typeScriptFiles } from "../helpers/project-files";

describe("titration security", () => {
  it("serialised public state contains no hidden keys", () => {
    const session = createTitrationSession(exp02TitrationConfig, "security-seed");
    const serialised = JSON.stringify(toPublicJSON(session));
    for (const key of HIDDEN_KEY_DENYLIST) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain("security-seed");
  });

  it("keeps the titration domain free of React, Next.js and Supabase imports", () => {
    const offenders = typeScriptFiles("domain/simulation/titration").filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["'](react|next|@supabase)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("never imports server-only or admin clients from the titration domain", () => {
    const offenders = typeScriptFiles("domain/simulation/titration").filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']server-only["']|supabase\/admin|from\s+["'].*attempt_secrets["']/.test(
        source,
      );
    });
    expect(offenders).toEqual([]);
  });
});
