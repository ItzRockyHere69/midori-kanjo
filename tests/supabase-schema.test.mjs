import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const legacyTables = [
  "parties",
  "items",
  "party_item_prices",
  "invoices",
  "payments",
  "account_entries",
  "expenses",
];
const tables = [
  "categories",
  ...legacyTables,
  "count_sessions",
  "count_session_lines",
  "stock_movements",
];

test("migration chain starts with a complete tenant-safe baseline", async () => {
  const names = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(names[0], "202608080000_initial_complete_schema.sql");
  const baseline = await readFile(`supabase/migrations/${names[0]}`, "utf8");
  for (const table of tables) {
    assert.match(baseline, new RegExp(`create table if not exists public\\.${table} \\(`));
  }
  assert.equal((baseline.match(/primary key \(business_id, id\)/g) || []).length, tables.length);
  assert.doesNotMatch(baseline, /id text primary key/i);
  assert.match(baseline, /current_business_id\(\)[\s\S]*extensions\.digest/);
  assert.match(baseline, /initial_amount_paid numeric not null default 0/);
  assert.match(baseline, /payment_breakdown jsonb not null default '\[\]'/);
  assert.match(baseline, /return_details jsonb not null default '\{\}'/);
  assert.match(baseline, /payment_received_mode in \('cash', 'upi', 'bank', 'cheque'\)/);
  assert.match(baseline, /allocated_to jsonb not null default '\[\]'/);
  assert.equal((baseline.match(/drop policy if exists "business /g) || []).length, tables.length);
});

test("Phase 2 inventory migration adds tenant-safe audit tables and deterministic baselines", async () => {
  const migration = await readFile(
    "supabase/migrations/202608101500_phase2_inventory_sync.sql",
    "utf8",
  );
  for (const table of ["categories", "count_sessions", "count_session_lines", "stock_movements"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table} \\(`));
  }
  assert.match(migration, /add column if not exists return_details jsonb/);
  assert.match(migration, /unique \(business_id, session_id, item_id\)/);
  assert.match(migration, /'baseline:' \|\| id/);
  assert.match(migration, /updated_at \+ interval '1 millisecond'/);
  assert.match(migration, /reject_stock_movement_mutation/);
  assert.match(migration, /stock_movements are immutable audit records/);
  assert.match(migration, /supabase_realtime/);
});

test("split-tender migration upgrades existing invoice and payment rows safely", async () => {
  const migration = await readFile(
    "supabase/migrations/202608101200_add_split_invoice_payments.sql",
    "utf8",
  );
  assert.match(migration, /add column if not exists payment_breakdown jsonb/);
  assert.match(migration, /alter column payment_breakdown set not null/);
  assert.match(migration, /drop constraint if exists invoices_payment_received_mode_check/);
  assert.match(migration, /payment_received_mode in \('cash', 'upi', 'bank', 'cheque'\)/);
  assert.match(migration, /mode in \('cash', 'upi', 'bank', 'cheque'\)/);
});

test("tenant hardening rebuilds fresh and legacy constraints safely", async () => {
  const migration = await readFile(
    "supabase/migrations/202608091900_harden_multi_tenant_sync.sql",
    "utf8",
  );
  const dropCompositeForeignKey = migration.indexOf(
    "drop constraint if exists invoices_business_id_party_id_fkey",
  );
  const dropPartyPrimaryKey = migration.indexOf(
    "drop constraint if exists parties_pkey",
  );
  assert.ok(dropCompositeForeignKey >= 0);
  assert.ok(dropCompositeForeignKey < dropPartyPrimaryKey);
  assert.doesNotMatch(migration, /business_id ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /extensions\.digest\(business_id, 'sha256'\)/);
  assert.match(migration, /update public\.payments set allocated_to = '\[\]'::jsonb/);
  assert.match(migration, /alter column allocated_to set not null/);
  assert.equal((migration.match(/add primary key \(business_id, id\)/g) || []).length, legacyTables.length);
  assert.match(migration, /on public\.items \(business_id, sku_code\)/);
  assert.match(migration, /foreign key \(business_id, party_id\)/);
  assert.match(migration, /having count\(distinct reference\.business_id\) = 1/);
  assert.match(migration, /parent\.business_id = 'legacy-unassigned'/);
  assert.equal((migration.match(/references public\.(?:parties|items) \(business_id, id\) not valid/g) || []).length, 5);
  assert.match(migration, /exception when foreign_key_violation/);
  assert.match(migration, /validate constraint %I/);
  assert.match(migration, /business_id = public\.current_business_id\(\)/);
});

test("canonical schema matches the complete baseline", async () => {
  const [schema, baseline] = await Promise.all([
    readFile("supabase/schema.sql", "utf8"),
    readFile("supabase/migrations/202608080000_initial_complete_schema.sql", "utf8"),
  ]);
  assert.equal(schema, baseline);
});
