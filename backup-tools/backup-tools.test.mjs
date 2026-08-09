import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const exportScript = join(toolsDir, "export-supabase-business-data.sh");
const restoreScript = join(toolsDir, "restore-supabase-business-data.sh");
const syncCode = "test-business-sync-code-1234567890";
const expectedBusinessId = "7bdebe348faeda556a3005c310de23f8744f21cd7a0b3c9d8a745ef85695219a";
const databaseUrl = "postgresql://backup_user:do-not-log-this-password@example.invalid:5432/postgres";

const headers = Object.freeze({
  "parties.csv": "business_id,id,name,code_name,phone,address,gstin,type,price_tier,opening_balance,current_balance,notes,tags,created_at,updated_at",
  "items.csv": "business_id,id,name,name_hi,name_bn,sku_code,category_id,base_unit,conversion_rate,purchase_price,price_retail,price_wholesale,price_bulk,current_stock,low_stock_alert,festival_tags,hsn_code,gst_rate,image_url,is_active,sale_count,last_sold_date,created_at,updated_at",
  "party_item_prices.csv": "business_id,id,party_id,item_id,last_price,last_sold_date,times_sold,locked_price,updated_at",
  "invoices.csv": "business_id,id,invoice_number,party_id,party_name,party_gstin,date,type,line_items,subtotal,discount_total,gst_total,other_charges,other_charges_total,round_off,grand_total,initial_amount_paid,amount_paid,amount_due,payment_mode,payment_received_mode,notes,deleted_at,created_at,updated_at",
  "payments.csv": "business_id,id,party_id,amount,date,mode,reference,allocated_to,created_at,updated_at",
  "account_entries.csv": "business_id,id,party_id,kind,amount,date,note,reference,created_at,updated_at",
  "expenses.csv": "business_id,id,user_id,category,amount,date,description,payment_mode,reference,deleted_at,created_at,updated_at",
});

const checkedFiles = [...Object.keys(headers), "SENSITIVE_DATA_MANIFEST.txt"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeContext(t) {
  const root = mkdtempSync(join(tmpdir(), "midori-backup-tools-"));
  const binDir = join(root, "mock-bin");
  const logDir = join(root, "logs");
  const fixturesDir = join(root, "export-fixtures");
  mkdirSync(binDir);
  mkdirSync(logDir);
  mkdirSync(fixturesDir);

  for (const [name, header] of Object.entries(headers)) {
    let content = `${header}\n`;
    if (name === "parties.csv") {
      content += `${sha256("source-sync-code-for-fixture")},party-1,Test Party,T1,,,,customer,wholesale,0,0,,[],2026-08-10T00:00:00Z,2026-08-10T00:00:00Z\n`;
    }
    writeFileSync(join(fixturesDir, name), content, { mode: 0o600 });
  }

  const mockPsql = `#!/usr/bin/env bash
set -euo pipefail
mkdir -p -- "\${MOCK_LOG_DIR}"
count_file="\${MOCK_LOG_DIR}/count"
count=0
if [[ -f "\${count_file}" ]]; then count="$(<"\${count_file}")"; fi
count=$((count + 1))
printf '%s\n' "\${count}" > "\${count_file}"
printf '%s\n' "$@" > "\${MOCK_LOG_DIR}/args.\${count}"
printf '%s\n' "$PWD" > "\${MOCK_LOG_DIR}/cwd.\${count}"
env | LC_ALL=C sort > "\${MOCK_LOG_DIR}/env.\${count}"
cat > "\${MOCK_LOG_DIR}/sql.\${count}"
status="\${MOCK_PSQL_EXIT:-0}"
if [[ "\${status}" != "0" ]]; then exit "\${status}"; fi
if grep -Fq 'REPEATABLE READ READ ONLY' "\${MOCK_LOG_DIR}/sql.\${count}"; then
  cp -- "\${MOCK_EXPORT_FIXTURES}"/*.csv .
fi
`;
  const psqlPath = join(binDir, "psql");
  writeFileSync(psqlPath, mockPsql, { mode: 0o700 });
  chmodSync(psqlPath, 0o700);

  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, binDir, logDir, fixturesDir };
}

function runScript(script, args, context, extraEnv = {}) {
  return spawnSync("bash", [script, ...args], {
    cwd: context.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${context.binDir}:${process.env.PATH}`,
      MOCK_LOG_DIR: context.logDir,
      MOCK_EXPORT_FIXTURES: context.fixturesDir,
      SUPABASE_DB_URL: databaseUrl,
      ...extraEnv,
    },
  });
}

function invocationCount(context) {
  const path = join(context.logDir, "count");
  return existsSync(path) ? Number(readFileSync(path, "utf8").trim()) : 0;
}

function captured(context, kind, invocation = 1) {
  return readFileSync(join(context.logDir, `${kind}.${invocation}`), "utf8");
}

function writeChecksums(dataDir) {
  const lines = checkedFiles.map((name) => {
    const content = readFileSync(join(dataDir, name));
    return `${sha256(content)}  ${name}`;
  });
  writeFileSync(join(dataDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, { mode: 0o600 });
}

function makeRestoreArchive(context, name = "restore data ' [safe]") {
  const dataDir = join(context.root, name);
  mkdirSync(dataDir, { mode: 0o700 });
  for (const file of Object.keys(headers)) copyFileSync(join(context.fixturesDir, file), join(dataDir, file));
  writeFileSync(
    join(dataDir, "SENSITIVE_DATA_MANIFEST.txt"),
    "MIDORI KANJO SENSITIVE BUSINESS DATA EXPORT\nFormat: midori-kanjo-supabase-business-data-v2\n",
    { mode: 0o600 },
  );
  writeChecksums(dataDir);
  return dataDir;
}

function assertStrictChecksums(dataDir) {
  const lines = readFileSync(join(dataDir, "SHA256SUMS.txt"), "utf8").trimEnd().split("\n");
  assert.equal(lines.length, checkedFiles.length);
  assert.deepEqual(lines.map((line) => line.slice(66)), checkedFiles);
  for (const line of lines) {
    assert.match(line, /^[0-9a-f]{64}  [A-Za-z0-9._-]+$/);
    const name = line.slice(66);
    assert.equal(line.slice(0, 64), sha256(readFileSync(join(dataDir, name))));
  }
}

test("export hashes the tenant, uses one repeatable-read snapshot, and checksums every artifact", (t) => {
  const context = makeContext(t);
  const outputDir = join(context.root, "export data ' [safe]");
  const result = runScript(exportScript, [outputDir], context, { MIDORI_BUSINESS_ID: syncCode });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocationCount(context), 1);
  assert.ok(existsSync(outputDir));
  assertStrictChecksums(outputDir);

  const args = captured(context, "args");
  const sql = captured(context, "sql");
  const environment = captured(context, "env");
  assert.match(args, new RegExp(`--set=business_id=${expectedBusinessId}`));
  assert.doesNotMatch(args, new RegExp(syncCode));
  assert.doesNotMatch(sql, new RegExp(syncCode));
  assert.doesNotMatch(environment, /MIDORI_BUSINESS_ID=/);
  assert.doesNotMatch(args, /do-not-log-this-password/);
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(sql, /AS tenant_has_rows \\gset/);
  assert.ok(sql.indexOf("AS tenant_has_rows") < sql.indexOf("\\copy (SELECT"));
  assert.equal((sql.match(/^\\copy \(SELECT/gm) || []).length, 7);
  assert.equal((sql.match(/current_setting\('midori\.export_business_id'\)/g) || []).length >= 14, true);
  assert.doesNotMatch(sql, /SELECT \*/);
  assert.doesNotMatch(readFileSync(join(outputDir, "SENSITIVE_DATA_MANIFEST.txt"), "utf8"), new RegExp(syncCode));
});

test("failed or empty export removes every partial artifact", (t) => {
  const context = makeContext(t);
  const outputDir = join(context.root, "failed export");
  const result = runScript(exportScript, [outputDir], context, {
    MIDORI_BUSINESS_ID: syncCode,
    MOCK_PSQL_EXIT: "65",
  });

  assert.notEqual(result.status, 0);
  assert.equal(invocationCount(context), 1);
  assert.equal(existsSync(outputDir), false);
});

test("restore verifies first, then stages and rebinds in one locked serializable transaction", (t) => {
  const context = makeContext(t);
  const dataDir = makeRestoreArchive(context);
  const result = runScript(restoreScript, [dataDir], context, { NEW_MIDORI_BUSINESS_ID: syncCode });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocationCount(context), 1);
  const args = captured(context, "args");
  const sql = captured(context, "sql");
  const environment = captured(context, "env");
  assert.equal(captured(context, "cwd").trim(), realpathSync(dataDir));
  assert.match(args, new RegExp(`--set=new_business_id=${expectedBusinessId}`));
  assert.doesNotMatch(args, new RegExp(syncCode));
  assert.doesNotMatch(sql, new RegExp(syncCode));
  assert.doesNotMatch(environment, /NEW_MIDORI_BUSINESS_ID=/);
  assert.doesNotMatch(args, /do-not-log-this-password/);
  assert.doesNotMatch(sql, new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const beginAt = sql.indexOf("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;");
  const lockAt = sql.indexOf("LOCK TABLE");
  const emptyAt = sql.indexOf("AS destination_empty");
  const copyAt = sql.indexOf("\\copy pg_temp.restore_parties");
  const insertAt = sql.indexOf("INSERT INTO public.parties");
  assert.ok(beginAt >= 0 && beginAt < lockAt && lockAt < emptyAt && emptyAt < copyAt && copyAt < insertAt);
  assert.match(sql, /IN SHARE ROW EXCLUSIVE MODE;/);
  assert.equal((sql.match(/CREATE TEMP TABLE restore_/g) || []).length, 7);
  assert.equal((sql.match(/^\\copy pg_temp\.restore_/gm) || []).length, 7);
  assert.equal((sql.match(/INSERT INTO public\./g) || []).length, 7);
  assert.equal((sql.match(/current_setting\('midori\.restore_business_id'\)/g) || []).length, 7);
  assert.match(sql, /count\(DISTINCT business_id\) = 1/);
  assert.match(sql, /AS counts_match \\gset/);
  assert.doesNotMatch(sql, /UPDATE public\.[a-z_]+ SET business_id/i);
});

test("restore rejects incomplete, corrupt, unsafe, or schema-drifted archives before psql", async (t) => {
  const cases = [
    ["missing checksum", (dir) => unlinkSync(join(dir, "SHA256SUMS.txt"))],
    ["corrupt data", (dir) => appendFileSync(join(dir, "items.csv"), "tampered\n")],
    ["missing coverage", (dir) => {
      const path = join(dir, "SHA256SUMS.txt");
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      writeFileSync(path, `${lines.slice(0, -1).join("\n")}\n`);
    }],
    ["duplicate coverage", (dir) => {
      const path = join(dir, "SHA256SUMS.txt");
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      lines[lines.length - 1] = lines[0];
      writeFileSync(path, `${lines.join("\n")}\n`);
    }],
    ["path traversal", (dir) => {
      const path = join(dir, "SHA256SUMS.txt");
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      lines[lines.length - 1] = `${"0".repeat(64)}  ../outside`;
      writeFileSync(path, `${lines.join("\n")}\n`);
    }],
    ["symlinked input", (dir) => {
      const path = join(dir, "items.csv");
      unlinkSync(path);
      symlinkSync("parties.csv", path);
      writeChecksums(dir);
    }],
    ["wrong CSV header with valid checksum", (dir) => {
      writeFileSync(join(dir, "items.csv"), "business_id,id,wrong_column\n");
      writeChecksums(dir);
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, (subtest) => {
      const context = makeContext(subtest);
      const dataDir = makeRestoreArchive(context, `archive-${name}`);
      mutate(dataDir);
      const result = runScript(restoreScript, [dataDir], context, { NEW_MIDORI_BUSINESS_ID: syncCode });
      assert.notEqual(result.status, 0);
      assert.equal(invocationCount(context), 0, result.stderr);
    });
  }
});

test("database failure cannot be reported as a successful restore", (t) => {
  const context = makeContext(t);
  const dataDir = makeRestoreArchive(context, "rollback fixture");
  const result = runScript(restoreScript, [dataDir], context, {
    NEW_MIDORI_BUSINESS_ID: syncCode,
    MOCK_PSQL_EXIT: "42",
  });

  assert.notEqual(result.status, 0);
  assert.equal(invocationCount(context), 1);
  assert.doesNotMatch(result.stdout, /restored into the empty destination schema/i);
});

test("invalid sync codes are rejected before psql", async (t) => {
  const invalidCodes = ["too-short", `${"x".repeat(20)}\r`, `${"x".repeat(20)}\n`];
  for (const [index, code] of invalidCodes.entries()) {
    await t.test(`invalid code ${index + 1}`, (subtest) => {
      const context = makeContext(subtest);
      const outputDir = join(context.root, `invalid-${index}`);
      const result = runScript(exportScript, [outputDir], context, { MIDORI_BUSINESS_ID: code });
      assert.notEqual(result.status, 0);
      assert.equal(invocationCount(context), 0);
      assert.equal(existsSync(outputDir), false);
    });
  }
});
