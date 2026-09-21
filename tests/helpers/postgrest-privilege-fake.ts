import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A PostgREST test double that ENFORCES the database's column-level grants.
 *
 * WHY IT EXISTS: an offline fake that accepts any write cannot see the
 * constraint that broke production. PostgREST turns an upsert into
 *
 *   INSERT ... ON CONFLICT (<target>) DO UPDATE SET <every payload column>
 *
 * and PostgreSQL requires UPDATE privilege on EVERY column named in that SET
 * list — including the conflict-target identity columns. The RLS migrations
 * grant UPDATE only on the mutable columns (identity is not student data), so
 * `resolution=merge-duplicates` is refused *even when no conflict exists*: the
 * first row of a trial can never be stored.
 *
 * This double reproduces that rule from the migration grant lists in
 * `supabase/migrations/0006_rls_policies.sql` and `..._0007_...support.sql`, so
 * the projection writes are exercised against the privileges production has.
 *
 * It is deliberately not a SQL engine: it checks privileges, honours
 * `ignoreDuplicates` (ON CONFLICT DO NOTHING), applies filtered updates, and
 * keeps rows so a replayed action can be shown to converge.
 */

/** Granted columns per table, copied from the migrations (revoke-all + grants). */
export const COLUMN_GRANTS: Record<string, { insert: string[]; update: string[] }> = {
  experiment_trials: {
    insert: [
      "attempt_id",
      "trial_number",
      "status",
      "initial_reading",
      "final_reading",
      "titre_volume",
      "endpoint_observed",
      "rejection_reason",
      "stage_key",
    ],
    update: [
      "status",
      "initial_reading",
      "final_reading",
      "titre_volume",
      "endpoint_observed",
      "rejection_reason",
      "stage_key",
    ],
  },
  measurements: {
    insert: ["attempt_id", "trial_id", "kind", "label", "value", "unit"],
    // Append-only: no UPDATE grant at all.
    update: [],
  },
  observations: {
    insert: ["attempt_id", "trial_id", "step_key", "field_key", "text_value", "choice_value"],
    update: ["text_value", "choice_value"],
  },
  calculation_submissions: {
    insert: ["attempt_id", "question_key", "student_value", "student_unit", "attempt_number"],
    update: ["student_value", "student_unit", "attempt_number"],
  },
  reports: {
    insert: [
      "attempt_id",
      "status",
      "aim",
      "procedure",
      "results_summary",
      "conclusion",
      "safety_notes",
      "readings_snapshot",
      "submitted_at",
    ],
    update: [
      "status",
      "aim",
      "procedure",
      "results_summary",
      "conclusion",
      "safety_notes",
      "readings_snapshot",
      "submitted_at",
    ],
  },
  attempt_state: {
    insert: ["attempt_id", "revision", "snapshot", "created_at", "updated_at"],
    update: ["revision", "snapshot", "updated_at"],
  },
};

/** Conflict targets the application uses, mirroring the unique constraints. */
const UNIQUE_KEYS: Record<string, string[]> = {
  experiment_trials: ["attempt_id", "trial_number"],
  observations: ["attempt_id", "step_key", "field_key"],
  calculation_submissions: ["attempt_id", "question_key"],
  reports: ["attempt_id"],
  attempt_state: ["attempt_id"],
  measurements: [],
};

/** Tables whose primary key is a generated `id`, exactly as the schema defines. */
const GENERATED_ID_TABLES = new Set([
  "experiment_trials",
  "measurements",
  "observations",
  "calculation_submissions",
  "reports",
]);

type Row = Record<string, unknown>;

export interface RecordedCall {
  table: string;
  op: "insert" | "upsert" | "update" | "select";
  columns: string[];
  mergeDuplicates: boolean;
  filters: Row;
}

export interface PrivilegeCheckingClient {
  client: SupabaseClient;
  rows: (table: string) => Row[];
  calls: RecordedCall[];
  callsFor: (table: string, op: RecordedCall["op"]) => RecordedCall[];
}

function identityMatcher(keys: string[], row: Row): (candidate: Row) => boolean {
  return (candidate) => keys.every((key) => candidate[key] === row[key]);
}

export function createPrivilegeCheckingClient(): PrivilegeCheckingClient {
  const tables = new Map<string, Row[]>();
  const calls: RecordedCall[] = [];
  let nextId = 1;
  const rowsFor = (table: string): Row[] => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table) as Row[];
  };

  const privilegeError = (table: string, op: "insert" | "update", denied: string[]) =>
    new Error(
      `permission denied for table ${table} (${op} on ${denied.join(", ")})`,
    );

  function from(table: string) {
    const grants = COLUMN_GRANTS[table];
    let op: RecordedCall["op"] | null = null;
    let payload: Row[] | Row | null = null;
    let filters: Row = {};
    let mergeDuplicates = false;

    function execute(): { data: Row[]; error: null } {
      if (!grants || op === null) throw new Error(`unmodelled operation on ${table}`);
      const rows = rowsFor(table);

      if (op === "insert" || op === "upsert") {
        const incoming = Array.isArray(payload) ? payload : [payload as Row];
        const columns = Object.keys(incoming[0] ?? {});
        const deniedInsert = columns.filter((column) => !grants.insert.includes(column));
        if (deniedInsert.length > 0) throw privilegeError(table, "insert", deniedInsert);
        if (op === "upsert" && mergeDuplicates) {
          // ON CONFLICT DO UPDATE SET <every payload column>: the identity
          // columns are named, and they are not updatable.
          const deniedUpdate = columns.filter((column) => !grants.update.includes(column));
          if (deniedUpdate.length > 0) throw privilegeError(table, "update", deniedUpdate);
        }
        const keys = UNIQUE_KEYS[table] ?? [];
        for (const row of incoming) {
          const existing = keys.length
            ? rows.findIndex(identityMatcher(keys, row))
            : -1;
          if (existing >= 0) {
            if (op === "upsert" && mergeDuplicates) rows[existing] = { ...rows[existing], ...row };
            // ignoreDuplicates (ON CONFLICT DO NOTHING) leaves the row as-is.
            continue;
          }
          const generated = GENERATED_ID_TABLES.has(table) ? { id: `${table}-${nextId++}` } : {};
          rows.push({ ...generated, ...row });
        }
        return { data: [], error: null };
      }

      if (op === "update") {
        const patch = payload as Row;
        const deniedUpdate = Object.keys(patch).filter((column) => !grants.update.includes(column));
        if (deniedUpdate.length > 0) throw privilegeError(table, "update", deniedUpdate);
        const matching = rows.filter((row) =>
          Object.entries(filters).every(([column, value]) => row[column] === value),
        );
        for (const row of matching) Object.assign(row, patch);
        return { data: matching.map((row) => ({ ...row })), error: null };
      }

      const selected = rows.filter((row) =>
        Object.entries(filters).every(([column, value]) => row[column] === value),
      );
      return { data: selected.map((row) => ({ ...row })), error: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      insert: (value: Row | Row[]) => {
        op = "insert";
        payload = value;
        calls.push({ table, op: "insert", columns: Object.keys(Array.isArray(value) ? (value[0] ?? {}) : value), mergeDuplicates: false, filters });
        return builder;
      },
      upsert: (value: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = "upsert";
        payload = value;
        mergeDuplicates = options?.ignoreDuplicates !== true;
        calls.push({
          table,
          op: "upsert",
          columns: Object.keys(Array.isArray(value) ? (value[0] ?? {}) : value),
          mergeDuplicates,
          filters,
        });
        return builder;
      },
      update: (value: Row) => {
        op = "update";
        payload = value;
        calls.push({ table, op: "update", columns: Object.keys(value), mergeDuplicates: false, filters });
        return builder;
      },
      select: () => {
        if (op === null) {
          op = "select";
          calls.push({ table, op: "select", columns: [], mergeDuplicates: false, filters });
        }
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters = { ...filters, [column]: value };
        const last = calls[calls.length - 1];
        if (last && last.table === table) last.filters = filters;
        return builder;
      },
      maybeSingle: () => {
        try {
          const result = execute();
          return Promise.resolve({ data: result.data[0] ?? null, error: null });
        } catch (error) {
          return Promise.reject(error);
        }
      },
      single: () => builder.maybeSingle(),
      then: (onFulfilled: unknown, onRejected: unknown) => {
        let settled: Promise<{ data: Row[]; error: null }>;
        try {
          settled = Promise.resolve(execute());
        } catch (error) {
          settled = Promise.reject(error);
        }
        return settled.then(
          onFulfilled as (value: unknown) => unknown,
          onRejected as (reason: unknown) => unknown,
        );
      },
    };
    return builder;
  }

  return {
    client: { from } as unknown as SupabaseClient,
    rows: rowsFor,
    calls,
    callsFor: (table, op) => calls.filter((call) => call.table === table && call.op === op),
  };
}
