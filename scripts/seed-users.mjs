#!/usr/bin/env node
/**
 * Creates a development student and instructor account (idempotently).
 *
 * DEV ONLY. These are not real people and the passwords are public in this file,
 * so this script must never be pointed at a production project. The instructor
 * role is granted here through the service-role client precisely because no
 * client-side path to it exists - which is the point of the design.
 *
 * Usage:
 *   node scripts/seed-users.mjs                # uses .env.local
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-users.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill them in, then run this script again.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEV_USERS = [
  {
    email: "instructor@example.edu",
    password: "instructor-pass-123",
    fullName: "Dr A. Instructor",
    registrationNumber: null,
    role: "instructor",
  },
  {
    email: "student@example.edu",
    password: "student-pass-123",
    fullName: "Ama Student",
    registrationNumber: "PS/2026/0001",
    role: "student",
  },
];

async function findUserIdByEmail(email) {
  // Paginate: the admin API has no lookup-by-email filter.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureUser(spec) {
  let userId = await findUserIdByEmail(spec.email);

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: {
        full_name: spec.fullName,
        registration_number: spec.registrationNumber,
      },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`created  ${spec.email}`);
  } else {
    console.log(`exists   ${spec.email}`);
  }

  // The signup trigger always creates a STUDENT row. Granting the instructor
  // role is a deliberate privileged action taken here, with the service role.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role: spec.role, full_name: spec.fullName })
    .eq("id", userId);
  if (profileError) throw profileError;

  console.log(`profile  ${spec.email} -> ${spec.role}`);
}

for (const spec of DEV_USERS) {
  await ensureUser(spec);
}

console.log("\nDevelopment accounts ready:");
for (const spec of DEV_USERS) {
  console.log(`  ${spec.role.padEnd(10)} ${spec.email}  password: ${spec.password}`);
}
