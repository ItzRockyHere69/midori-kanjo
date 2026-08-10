import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dues backup uses strict checksummed payloads for shareable TXT and PDF files", async () => {
  const [backup, ledger, statement, packageJson] = await Promise.all([
    read("lib/due-backup.ts"),
    read("lib/dues-ledger-archive.ts"),
    read("lib/due-statement-export.ts"),
    read("package.json"),
  ]);
  assert.match(backup, /DUES_BACKUP_FORMAT = "midori-kanjo-dues-backup"/);
  assert.match(backup, /DUES_BACKUP_VERSION = 1/);
  assert.match(backup, /DUES_BACKUP_MARKER = "MKDUES1"/);
  assert.match(backup, /MAX_DUES_BACKUP_BYTES = 10 \* 1024 \* 1024/);
  assert.match(backup, /MAX_DUES_BACKUP_RECORDS = 10_000/);
  assert.match(backup, /assertDuesBackupExportBudget/);
  assert.match(backup, /assertDuesBackupBlobSize\(blob\)/);
  assert.match(backup, /remainingPaise/);
  assert.match(backup, /sha256Hex\(canonicalPayload\(payload\)\)/);
  assert.match(backup, /doc\.addMetadata\(markerForEnvelope\(envelope\), DUES_BACKUP_NAMESPACE\)/);
  assert.match(backup, /MIDORI KANJO RESTORE DATA/);
  assert.match(ledger, /DUES_LEDGER_MARKER = "MKDUES2"/);
  assert.match(ledger, /addDuesLedgerPdfMetadata/);
  assert.match(ledger, /downloadCurrentDuesLedgerBackup/);
  assert.match(ledger, /readDuesLedgerSource/);
  assert.match(ledger, /\[db\.parties, db\.invoices, db\.payments, db\.accountEntries\]/);
  assert.match(statement, /createImportableDueStatementPdf/);
  assert.match(statement, /createImportableDueStatementText/);
  assert.match(statement, /downloadCurrentDuesLedgerBackup/);
  assert.doesNotMatch(backup, /pdfjs|pdf-lib|OCR|tesseract/i);
  const dependencies = JSON.parse(packageJson).dependencies;
  assert.equal(dependencies["pdfjs-dist"], undefined);
  assert.equal(dependencies["pdf-lib"], undefined);
});

test("restore is reviewed, owner-gated, canonical, atomic and idempotent", async () => {
  const [backup, ledger, sheet, app, copy] = await Promise.all([
    read("lib/due-backup.ts"),
    read("lib/dues-ledger-archive.ts"),
    read("app/DueBackupSheet.tsx"),
    read("app/BillingApp.tsx"),
    read("app/due-backup-copy.ts"),
  ]);
  assert.match(sheet, /<AccessibleSheet/);
  assert.match(sheet, /accept="\.txt,\.pdf,text\/plain,application\/pdf"/);
  assert.match(sheet, /previewDuesBackupRestore/);
  assert.match(sheet, /previewDuesLedgerRestore/);
  assert.match(sheet, /onConfirm\(previewSession\)/);
  assert.match(sheet, /mode: "complete"/);
  assert.match(sheet, /mode: "legacy"/);
  assert.match(sheet, /closeDisabled=\{restoring\}/);
  assert.match(sheet, /copy\.destination/);
  assert.match(app, /confirmDuesBackupRestore/);
  assert.match(app, /requestInventoryOwner\(\(\) => void execute\(\)\)/);
  assert.match(app, /sheet === "dueBackup"/);
  assert.match(app, /sheet === "dueBackup" && dueBackupRestoringRef\.current/);
  assert.match(app, /restoreDuesLedger/);
  assert.match(ledger, /\[db\.parties, db\.invoices, db\.payments, db\.accountEntries, db\.meta, db\.activityLogs\]/);
  assert.match(backup, /db\.transaction\("rw", \[db\.parties, db\.invoices, db\.payments, db\.accountEntries, db\.activityLogs\]/);
  assert.match(backup, /const entryWrites: AccountEntry\[\]/);
  assert.match(backup, /entryWrites\.push\(\{[\s\S]*?kind: "due"[\s\S]*?isSynced: false/);
  assert.match(backup, /db\.parties\.bulkPut\(partyWrites\)/);
  assert.match(backup, /db\.accountEntries\.bulkAdd\(entryWrites\)/);
  assert.match(backup, /importedDueEntryId/);
  assert.match(backup, /if \(preview\.conflictCount\)[\s\S]*?throw new DuesBackupError\("conflict"/);
  assert.match(backup, /supplier_collision/);
  assert.match(backup, /mergedDestinationId/);
  assert.match(backup, /resolveActiveParty/);
  assert.match(backup, /compatibleAutomaticIdentity/);
  assert.match(backup, /normalizeGstin/);
  assert.match(backup, /buildPartyIdentityIndexes/);
  assert.match(copy, /Backup & restore dues/);
  assert.match(copy, /बाकी रकम/);
  assert.match(copy, /বাকি টাকা/);
  assert.match(copy, /integrity-checked/);
  assert.doesNotMatch(copy, /Only an original Midori Kanjo/);
});

test("browser file import does not broaden Tauri or Android storage permissions", async () => {
  const [capability, androidManifest, paths] = await Promise.all([
    read("src-tauri/capabilities/default.json"),
    read("android/app/src/main/AndroidManifest.xml"),
    read("android/app/src/main/res/xml/file_paths.xml"),
  ]);
  const permissions = JSON.stringify(JSON.parse(capability).permissions);
  assert.doesNotMatch(permissions, /dialog:allow-open|fs:allow-read|fs:read-all/);
  assert.doesNotMatch(androidManifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
  assert.deepEqual([...paths.matchAll(/<([a-z-]*path)\b/g)].map((match) => match[1]), ["cache-path"]);
});
