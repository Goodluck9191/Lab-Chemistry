import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { read, sqlFiles } from "../helpers/project-files";

/**
 * Static audit of the SQL migrations.
 *
 * This suite cannot replace running the migrations against a real Postgres - it
 * cannot prove that a policy behaves correctly, only that the shapes that matter
 * are present and that none of the known insecure shortcuts were taken. It runs
 * everywhere, including on a machine with no database, so a regression is caught
 * at the earliest possible moment.
 */
const migrationFiles = sqlFiles("supabase/migrations");
const migrationSql = migrationFiles.map((file) => read(file)).join("\n");
const seedSql = read(join("supabase", "seed.sql"));

const tables = [...migrationSql.matchAll(/create table public\.([a-z_]+)/g)].map(
  (match) => match[1],
);

describe("migrations: structure", () => {
  it("finds the expected tables", () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        "profiles",
        "experiments",
        "experiment_steps",
        "experiment_chemicals",
        "experiment_apparatus",
        "experiment_attempts",
        "attempt_secrets",
        "attempt_state",
        "experiment_trials",
        "measurements",
        "observations",
        "calculation_submissions",
        "reports",
        "grades",
        "instructor_feedback",
      ]),
    );
  });

  it("enables row level security on every single table", () => {
    const withoutRls = tables.filter(
      (table) => !migrationSql.includes(`alter table public.${table} enable row level security;`),
    );
    expect(withoutRls).toEqual([]);
  });

  it("revokes the Supabase default grants before granting anything back", () => {
    const withoutRevoke = tables.filter(
      (table) => !migrationSql.includes(`revoke all on public.${table} from anon, authenticated;`),
    );
    expect(withoutRevoke).toEqual([]);
  });

  it("writes every policy for the authenticated role only", () => {
    const policies = [...migrationSql.matchAll(/create policy [\s\S]*?;/g)].map((match) => match[0]);
    expect(policies.length).toBeGreaterThan(20);

    const wrongRole = policies.filter(
      (policy) => !/to authenticated/.test(policy) || /to[ ]+(anon|public)/.test(policy),
    );
    expect(wrongRole).toEqual([]);
  });
});

describe("migrations: the known insecure shortcuts are absent", () => {
  it("has no permissive policy", () => {
    expect(migrationSql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migrationSql).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });

  it("never grants DELETE (withdrawal is a status change, not a delete)", () => {
    expect(migrationSql).not.toMatch(/grant\s+delete/i);
    expect(migrationSql).not.toMatch(/grant\s+all/i);
  });

  it("uses no `for all` policy, which would silently cover DELETE", () => {
    expect(migrationSql).not.toMatch(/for all to authenticated/i);
  });

  it("hides hidden parameters completely", () => {
    // attempt_secrets: RLS on, zero policies...
    expect(migrationSql).not.toMatch(/create policy [a-z_]*secrets/i);
    expect(migrationSql).toMatch(/alter table public\.attempt_secrets enable row level security;/);
    expect(migrationSql).toMatch(/revoke all on public\.attempt_secrets from anon, authenticated;/);
    // ...and never granted back.
    expect(migrationSql).not.toMatch(/grant (select|insert|update)[^;]*attempt_secrets/i);
  });

  it("keeps the answer key out of the client-visible projection", () => {
    const selectGrant = /grant select \(([^)]*)\)\s+on public\.calculation_submissions/i.exec(
      migrationSql,
    );
    expect(selectGrant, "calculation_submissions should have a column-level SELECT grant").not.toBeNull();
    const columns = selectGrant?.[1] ?? "";
    expect(columns).toContain("student_value");
    expect(columns).not.toContain("expected_value");
    expect(columns).not.toContain("tolerance");
  });

  it("keeps the role column unreachable by any client UPDATE", () => {
    const updateGrant = /grant update \(([^)]*)\)\s+on public\.profiles/i.exec(migrationSql);
    expect(updateGrant, "profiles should have a column-level UPDATE grant").not.toBeNull();
    expect(updateGrant?.[1]).not.toContain("role");
  });

  it("keeps final_score unreachable by any client UPDATE", () => {
    const updateGrant = /grant update \(([^)]*)\)\s+on public\.experiment_attempts/i.exec(
      migrationSql,
    );
    expect(updateGrant?.[1]).not.toContain("final_score");
    expect(updateGrant?.[1]).not.toContain("integrity_hash");
  });

  it("makes submitted attempts read-only through the update policies", () => {
    expect(migrationSql).toMatch(
      /using \(student_id = auth\.uid\(\) and status in \('in_progress', 'returned'\)\)/,
    );
  });

  it("never reads a role from client-supplied signup metadata", () => {
    expect(migrationSql).not.toMatch(/raw_user_meta_data\s*->>\s*'role'/);
    expect(migrationSql).toMatch(/'student'::public\.user_role/);
  });

  it("pins search_path on every SECURITY DEFINER function", () => {
    const definers = [...migrationSql.matchAll(/security definer[\s\S]{0,120}?\$\$/g)].map(
      (match) => match[0],
    );
    expect(definers.length).toBeGreaterThan(0);
    const unpinned = definers.filter((block) => !block.includes("set search_path = ''"));
    expect(unpinned).toEqual([]);
  });
});

describe("seed data", () => {
  it("seeds exactly one published sample experiment and nothing hidden", () => {
    expect(seedSql.match(/insert into public\.experiments/g)).toHaveLength(1);
    expect(seedSql).toContain("'exp-02'");
    expect(seedSql).not.toMatch(/attempt_secrets/);
    expect(seedSql).not.toMatch(/create policy/i);
  });

  it("marks unverified chemistry as assumed rather than presenting it as verified", () => {
    expect(seedSql).toContain("'assumed'");
    expect(seedSql).not.toContain("'manual-verified'");
  });
});
