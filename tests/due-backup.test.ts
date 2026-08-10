import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { db, type Party } from "../lib/db";
import { partyDueStatement, recordPayment } from "../lib/billing";
import {
  assertDuesBackupBlobSize,
  assertDuesBackupExportBudget,
  DuesBackupError,
  MAX_DUES_BACKUP_BYTES,
  createDuesBackupEnvelope,
  createDuesBackupPdf,
  duesBackupText,
  parseDuesBackupBytes,
  previewDuesBackupRestore,
  restoreDuesBackup,
} from "../lib/due-backup";
import {
  createImportableDueStatementPdf,
  createImportableDueStatementText,
} from "../lib/due-statement-export";
import { parseDuesLedgerBytes } from "../lib/dues-ledger-archive";
import { reconcilePartyBalances } from "../lib/sync";

const stamp = "2026-08-10T10:00:00.000Z";
const business = {
  name: "Midori Kanjo Test Shop",
  address: "Burrabazar, Kolkata",
  phone: "+91 90000 00000",
  gstin: "",
};

function customer(id: string, name: string, balance: number, overrides: Partial<Party> = {}): Party {
  return {
    id,
    name,
    codeName: `CUS-${id.toUpperCase()}`,
    phone: "",
    address: "Kolkata, West Bengal",
    type: "customer",
    priceTier: "wholesale",
    openingBalance: 0,
    currentBalance: balance,
    notes: "",
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
    isSynced: false,
    ...overrides,
  };
}

async function clearDestination() {
  await db.transaction(
    "rw",
    [db.parties, db.invoices, db.payments, db.accountEntries, db.activityLogs],
    async () => {
      await Promise.all([
        db.parties.clear(),
        db.invoices.clear(),
        db.payments.clear(),
        db.accountEntries.clear(),
        db.activityLogs.clear(),
      ]);
    },
  );
}

test("outstanding dues TXT and PDF backups round-trip the same checked Unicode payload", async () => {
  await db.delete();
  await db.open();
  try {
    const parties = [
      customer("bangla", "শুভ সাজঘর", 123.45, { codeName: "শুভ-১২", phone: "9876543210" }),
      customer("hindi", "श्री गणेश डेकोर", 678.9, { address: "बड़ाबाज़ार, कोलकाता" }),
      customer("settled", "Settled Customer", 0),
      customer("supplier", "Supplier Due", 900, { type: "supplier" }),
    ];
    const envelope = await createDuesBackupEnvelope(parties, business, stamp);
    assert.equal(envelope.payload.recordCount, 2);
    assert.equal(envelope.payload.totalPaise, 80_235);
    assert.throws(
      () => assertDuesBackupExportBudget(envelope, MAX_DUES_BACKUP_BYTES),
      (error) => error instanceof DuesBackupError && error.code === "file_too_large",
    );
    assert.deepEqual(envelope.payload.customers.map((row) => row.name).sort(), ["श्री गणेश डेकोर", "শুভ সাজঘর"].sort());

    const textBytes = new TextEncoder().encode(`\uFEFF${duesBackupText(envelope, "bn")}`);
    assert.deepEqual(parseDuesBackupBytes(textBytes), envelope);

    const pdf = await createDuesBackupPdf(envelope, "hi");
    const pdfBytes = new Uint8Array(pdf.output("arraybuffer"));
    assert.equal(new TextDecoder("latin1").decode(pdfBytes).startsWith("%PDF-"), true);
    assert.deepEqual(parseDuesBackupBytes(pdfBytes), envelope);

    const marker = duesBackupText(envelope, "en").match(/MKDUES1\.([a-f0-9]{64})\./);
    assert.ok(marker);
    const changed = `${marker[1][0] === "0" ? "1" : "0"}${marker[1].slice(1)}`;
    const tampered = new TextEncoder().encode(duesBackupText(envelope, "en").replace(marker[1], changed));
    assert.throws(
      () => parseDuesBackupBytes(tampered),
      (error) => error instanceof DuesBackupError && error.code === "checksum_mismatch",
    );
    assert.throws(
      () => parseDuesBackupBytes(new TextEncoder().encode("Customer owes Rs 500")),
      (error) => error instanceof DuesBackupError && error.code === "not_backup",
    );
  } finally {
    await db.delete();
  }
});

test("individual statement TXT and PDF files carry the same complete restorable ledger", async () => {
  await db.delete();
  await db.open();
  try {
    const party = customer("statement", "Statement Backup Customer", 321.45, {
      codeName: "STATEMENT-01",
      phone: "9000054321",
      openingBalance: 321.45,
    });
    const statement = partyDueStatement(party, [], [], []);
    const text = await createImportableDueStatementText(statement, business, "en");
    const pdf = await createImportableDueStatementPdf(statement, business, "bn");
    const textEnvelope = parseDuesLedgerBytes(new TextEncoder().encode(text));
    const pdfEnvelope = parseDuesLedgerBytes(new Uint8Array(pdf.output("arraybuffer")));
    assert.equal(pdfEnvelope.payload.backupId, textEnvelope.payload.backupId);
    assert.deepEqual(pdfEnvelope.payload.customers, textEnvelope.payload.customers);
    assert.equal(textEnvelope.payload.customerCount, 1);
    assert.equal(textEnvelope.payload.customers[0].summary.remainingPaise, 32_145);
    assert.equal(textEnvelope.payload.customers[0].events[0].recordedAt, stamp);
  } finally {
    await db.delete();
  }
});

test("restore creates canonical brought-forward dues, survives reconciliation, and is idempotent", async () => {
  await db.delete();
  await db.open();
  try {
    const source = [
      customer("north", "North Kolkata Decor", 450.25, { codeName: "NORTH-01", phone: "9000011111" }),
      customer("south", "দক্ষিণ সাজঘর", 99.75, { codeName: "SOUTH-02" }),
    ];
    const envelope = await createDuesBackupEnvelope(source, business, stamp);
    await clearDestination();

    const preview = await previewDuesBackupRestore(envelope);
    assert.deepEqual(
      { ready: preview.readyCount, fresh: preview.newCount, conflicts: preview.conflictCount, total: preview.readyPaise },
      { ready: 2, fresh: 2, conflicts: 0, total: 55_000 },
    );
    const result = await restoreDuesBackup(envelope);
    assert.deepEqual(
      { imported: result.importedCount, created: result.createdCustomers, total: result.importedPaise },
      { imported: 2, created: 2, total: 55_000 },
    );
    assert.equal(await db.accountEntries.count(), 2);
    assert.equal(await db.invoices.count(), 0);
    assert.equal(await db.payments.count(), 0);
    assert.equal((await db.accountEntries.toArray()).every((row) => !row.isSynced && row.reference.startsWith("MKDUES1|")), true);

    await reconcilePartyBalances();
    const restoredParties = await db.parties.orderBy("name").toArray();
    assert.equal(restoredParties.reduce((sum, party) => sum + party.currentBalance, 0), 550);
    const entries = await db.accountEntries.toArray();
    for (const party of restoredParties) {
      const statement = partyDueStatement(party, [], [], entries);
      assert.equal(statement.rows.some((row) => row.kind === "balance_adjustment"), false);
    }

    db.close();
    await db.open();
    assert.equal(await db.accountEntries.count(), 2);
    const secondPreview = await previewDuesBackupRestore(envelope);
    assert.equal(secondPreview.readyCount, 0);
    assert.equal(secondPreview.alreadyCount, 2);
    assert.equal((await restoreDuesBackup(envelope)).importedCount, 0);
    assert.equal(await db.accountEntries.count(), 2);

    const paidParty = (await db.parties.toArray()).find((party) => party.name === "North Kolkata Decor")!;
    await recordPayment(paidParty, 50.25, "cash", "after restore");
    await reconcilePartyBalances();
    assert.equal((await db.parties.get(paidParty.id))?.currentBalance, 400);
    assert.equal((await previewDuesBackupRestore(envelope)).alreadyCount, 2);
    assert.equal(await db.accountEntries.count(), 2);
  } finally {
    await db.delete();
  }
});

test("restore blocks supplier collisions and rolls the whole import back", async () => {
  await db.delete();
  await db.open();
  try {
    const source = [
      customer("safe", "Safe Customer", 100, { codeName: "SAFE-01" }),
      customer("collision", "Collision Customer", 250, { codeName: "MATCH-ME", phone: "9876501234" }),
    ];
    const envelope = await createDuesBackupEnvelope(source, business, stamp);
    await clearDestination();
    await db.parties.put(customer("supplier-match", "Existing Supplier", 0, {
      type: "supplier",
      codeName: "MATCH-ME",
    }));

    const preview = await previewDuesBackupRestore(envelope);
    assert.equal(preview.readyCount, 1);
    assert.equal(preview.conflictCount, 1);
    assert.equal(preview.rows.find((row) => row.record.sourcePartyId === "collision")?.reason, "supplier_collision");
    await assert.rejects(
      restoreDuesBackup(envelope),
      (error) => error instanceof DuesBackupError && error.code === "conflict",
    );
    assert.equal(await db.accountEntries.count(), 0);
    assert.equal((await db.parties.toArray()).some((party) => party.name === "Safe Customer"), false);
  } finally {
    await db.delete();
  }
});

test("restore resolves a differently-IDed merged customer alias to the visible destination", async () => {
  await db.delete();
  await db.open();
  try {
    const source = customer("remote-source", "Original Customer", 175, {
      codeName: "ORIGINAL-01",
      phone: "9000012345",
    });
    const envelope = await createDuesBackupEnvelope([source], business, stamp);
    await clearDestination();
    await db.parties.bulkPut([
      customer("local-merged-alias", "Original Customer", 0, {
        codeName: "ORIGINAL-01",
        phone: "9000012345",
        tags: ["mergedInto:visible-target"],
      }),
      customer("visible-target", "Canonical Customer", 0, {
        codeName: "CANONICAL-01",
        phone: "9000099999",
      }),
    ]);

    const preview = await previewDuesBackupRestore(envelope);
    assert.equal(preview.conflictCount, 0);
    assert.equal(preview.rows[0].status, "ready_existing");
    assert.equal(preview.rows[0].destinationPartyId, "visible-target");
    assert.equal(preview.rows[0].destinationPartyName, "Canonical Customer");
    await restoreDuesBackup(envelope);
    assert.equal((await db.parties.get("visible-target"))?.currentBalance, 175);
    assert.equal((await db.parties.get("local-merged-alias"))?.currentBalance, 0);
    assert.equal((await db.accountEntries.toArray())[0].partyId, "visible-target");
  } finally {
    await db.delete();
  }
});

test("unique identifiers never auto-match a contradictory customer and GSTIN catches suppliers", async () => {
  await db.delete();
  await db.open();
  try {
    const source = [
      customer("alice", "Alice Decor", 100, { codeName: "SHARED-01", phone: "9000011111" }),
      customer("legal", "Legal Customer", 200, { codeName: "LEGAL-01", gstin: "19ABCDE1234F1Z5" }),
    ];
    const envelope = await createDuesBackupEnvelope(source, business, stamp);
    await clearDestination();
    await db.parties.bulkPut([
      customer("bob", "Bob Traders", 0, { codeName: "SHARED-01", phone: "9000099999" }),
      customer("gst-supplier", "Legal Supplier", 0, {
        type: "supplier",
        codeName: "SUP-LEGAL",
        gstin: "19 ABCDE 1234 F1Z5",
      }),
    ]);

    const preview = await previewDuesBackupRestore(envelope);
    assert.equal(preview.conflictCount, 2);
    const alice = preview.rows.find((row) => row.record.sourcePartyId === "alice")!;
    assert.equal(alice.reason, "identity_collision");
    assert.equal(alice.destinationPartyName, "Bob Traders");
    const legal = preview.rows.find((row) => row.record.sourcePartyId === "legal")!;
    assert.equal(legal.reason, "supplier_collision");
    assert.equal(legal.destinationPartyName, "Legal Supplier");
    await assert.rejects(restoreDuesBackup(envelope), /conflict/i);
    assert.equal(await db.accountEntries.count(), 0);
  } finally {
    await db.delete();
  }
});

test("export refuses a final file that would exceed the import byte limit", () => {
  assert.doesNotThrow(() => assertDuesBackupBlobSize({ size: MAX_DUES_BACKUP_BYTES }));
  assert.throws(
    () => assertDuesBackupBlobSize({ size: MAX_DUES_BACKUP_BYTES + 1 }),
    (error) => error instanceof DuesBackupError && error.code === "file_too_large",
  );
});

test("preview and restore use indexed identity matching and bulk writes at migration scale", async () => {
  await db.delete();
  await db.open();
  try {
    const count = 2_000;
    const source = Array.from({ length: count }, (_, index) => customer(
      `remote-${index}`,
      `Migration Customer ${index}`,
      1,
      { codeName: `MIG-${index}` },
    ));
    const envelope = await createDuesBackupEnvelope(source, business, stamp);
    assert.doesNotThrow(() => assertDuesBackupExportBudget(envelope, 250_000));
    await clearDestination();
    await db.parties.bulkPut(source.map((party, index) => ({
      ...party,
      id: `local-${index}`,
      currentBalance: 0,
    })));

    const preview = await previewDuesBackupRestore(envelope);
    assert.equal(preview.readyCount, count);
    assert.equal(preview.matchedCount, count);
    assert.equal(preview.conflictCount, 0);
    const result = await restoreDuesBackup(envelope);
    assert.equal(result.importedCount, count);
    assert.equal(result.matchedCustomers, count);
    assert.equal(await db.accountEntries.count(), count);
    assert.equal((await db.parties.toArray()).reduce((sum, party) => sum + party.currentBalance, 0), count);
  } finally {
    await db.delete();
  }
});

test("a changed snapshot cannot replace an earlier imported due", async () => {
  await db.delete();
  await db.open();
  try {
    const original = customer("changing", "Changing Balance", 100, { codeName: "CHANGE-01" });
    const first = await createDuesBackupEnvelope([original], business, stamp);
    const changed = await createDuesBackupEnvelope([{ ...original, currentBalance: 125 }], business, "2026-08-11T10:00:00.000Z");
    await clearDestination();
    await restoreDuesBackup(first);
    const preview = await previewDuesBackupRestore(changed);
    assert.equal(preview.conflictCount, 1);
    assert.equal(preview.rows[0].reason, "different_import_amount");
    await assert.rejects(restoreDuesBackup(changed), /conflict/i);
    assert.equal((await db.parties.toArray())[0].currentBalance, 100);
    assert.equal(await db.accountEntries.count(), 1);
  } finally {
    await db.delete();
  }
});
