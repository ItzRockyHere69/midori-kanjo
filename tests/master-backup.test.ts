import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db";
import { INTERFACE_SCALE_CACHE } from "../lib/interface-scale";
import {
  MASTER_STORE_NAMES,
  MasterBackupError,
  createMasterBackupEnvelope,
  masterBackupText,
  parseMasterBackupBytes,
  previewMasterRestore,
  restoreMasterBackup,
} from "../lib/master-backup";
import { OWNER_PIN_META } from "../lib/qol";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const stamp = "2026-08-10T10:00:00.000Z";
const date = "2026-08-10";
const categoryId = "category-fixture";
const partyId = "party-fixture";
const itemId = "item-fixture";
const invoiceId = "invoice-fixture";
const countSessionId = "count-fixture";
const festivalId = "festival-fixture";

const fixtures: Record<string, Record<string, unknown>[]> = {
  categories: [{
    id: categoryId, name: "Fixture category", festivalSeason: [],
    createdAt: stamp, updatedAt: stamp, isSynced: true,
  }],
  parties: [{
    id: partyId, name: "Fixture customer", codeName: "FIX-1", phone: "9000000001",
    address: "Kolkata", type: "customer", priceTier: "wholesale",
    openingBalance: 0, currentBalance: 0, notes: "", tags: [],
    createdAt: stamp, updatedAt: stamp, isSynced: true,
  }],
  items: [{
    id: itemId, name: "Fixture item", nameHi: "", nameBn: "", skuCode: "FIX-SKU-1",
    categoryId, baseUnit: "piece", conversionRate: 1, purchasePrice: 60,
    priceRetail: 110, priceWholesale: 100, priceBulk: 90, currentStock: 10,
    lowStockAlert: 2, festivalTags: [], gstRate: 0, isActive: true, saleCount: 1,
    lastSoldDate: date, createdAt: stamp, updatedAt: stamp, isSynced: true,
  }],
  partyItemPrices: [{
    id: `${partyId}::${itemId}`, partyId, itemId, lastPrice: 100,
    lastSoldDate: date, timesSold: 1, lockedPrice: false,
    updatedAt: stamp, isSynced: true,
  }],
  invoices: [{
    id: invoiceId, invoiceNumber: "FIXTURE-INV-1", partyId,
    partyName: "Fixture customer", date, type: "sale",
    lineItems: [{
      itemId, itemName: "Fixture item", skuCode: "FIX-SKU-1", hsnCode: "",
      qty: 1, unit: "piece", baseUnit: "piece", rate: 100, discount: 0,
      taxableAmount: 100, gstRate: 0, gstAmount: 0, amount: 100, unitCost: 60,
    }],
    subtotal: 100, discountTotal: 0, gstTotal: 0, roundOff: 0,
    grandTotal: 100, initialAmountPaid: 100, amountPaid: 100, amountDue: 0,
    paymentMode: "cash", paymentReceivedMode: "cash",
    paymentBreakdown: [{ mode: "cash", amount: 100 }], notes: "",
    createdAt: stamp, updatedAt: stamp, isSynced: true,
  }],
  payments: [{
    id: "payment-fixture", partyId, amount: 25, date, mode: "upi",
    reference: "FIX-PAY", allocatedTo: [], createdAt: stamp,
    updatedAt: stamp, isSynced: true,
  }],
  accountEntries: [{
    id: "due-fixture", partyId, kind: "due", amount: 25, date,
    note: "Fixture due", reference: "FIX-DUE", createdAt: stamp,
    updatedAt: stamp, isSynced: true,
  }],
  expenses: [{
    id: "expense-fixture", category: "shop_supplies", amount: 12.34,
    date, description: "Fixture expense", paymentMode: "cash", reference: "",
    createdAt: stamp, updatedAt: stamp, isSynced: true,
  }],
  stockMovements: [{
    id: "movement-fixture", itemId, kind: "baseline", reason: "fixture_baseline",
    note: "Fixture opening stock", qtyChange: null, stockBefore: null, stockAfter: 10,
    applied: true, date, actor: "owner", createdAt: stamp, updatedAt: stamp,
    isSynced: true,
  }],
  countSessions: [{
    id: countSessionId, categoryId, categoryName: "Fixture category",
    status: "in_progress", itemIds: [itemId], startedAt: stamp,
    updatedAt: stamp, isSynced: true,
  }],
  countLines: [{
    id: `${countSessionId}::${itemId}`, sessionId: countSessionId, itemId,
    itemName: "Fixture item", skuCode: "FIX-SKU-1", baseUnit: "piece",
    systemStockAtStart: 10, countedStock: null, createdAt: stamp,
    updatedAt: stamp, isSynced: true,
  }],
  festivalEntries: [{
    id: festivalId, festivalKey: "fixture-festival", year: 2026,
    nameEn: "Fixture festival", nameHi: "परीक्षण", nameBn: "পরীক্ষা",
    startDate: date, endDate: date, leadTimeWeeks: 2, dateStatus: "verified",
    sourceNote: "Fixture", createdAt: stamp, updatedAt: stamp,
  }],
  festivalTasks: [{
    id: `${festivalId}:stock_plan`, festivalId, kind: "stock_plan", updatedAt: stamp,
  }],
  activityLogs: [{
    id: "activity-fixture", action: "invoice.create", entityType: "invoice",
    entityId: invoiceId, description: "Fixture invoice created", actor: "owner",
    metadata: "{}", createdAt: stamp,
  }],
  dailyCloses: [{
    id: `close:${date}`, date, openingCash: 0, expectedCash: -10,
    countedCash: 0, discrepancy: 10, notes: "Fixture negative expected cash",
    closedAt: stamp, updatedAt: stamp,
  }],
  meta: [
    { key: "master-backup-source-id", value: "fixture-dataset" },
    { key: OWNER_PIN_META, value: "source-pin-must-not-export" },
    { key: "cloud-business-fingerprint-v1", value: "source-cloud-must-not-export" },
    { key: "invoice-device-code", value: "SOURCE01" },
  ],
};

async function clearAll() {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}

async function putFixtures() {
  await db.transaction("rw", db.tables, async () => {
    for (const name of MASTER_STORE_NAMES) await db.table(name).bulkPut(fixtures[name]);
  });
}

async function snapshot() {
  const result: Record<string, unknown[]> = {};
  await db.transaction("r", db.tables, async () => {
    for (const name of MASTER_STORE_NAMES) {
      const key = name === "meta" ? "key" : "id";
      result[name] = (await db.table(name).toArray() as Record<string, unknown>[])
        .sort((left, right) => String(left[key]).localeCompare(String(right[key])));
    }
  });
  return result;
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof MasterBackupError && error.code === code;
}

test("master backup validates, previews and atomically replaces all 16 stores while preserving the destination owner PIN", async () => {
  await db.delete();
  await db.open();
  try {
    assert.deepEqual([...MASTER_STORE_NAMES].sort(), db.tables.map((table) => table.name).sort());
    await putFixtures();

    await db.invoices.update(invoiceId, { subtotal: 999 });
    await assert.rejects(
      createMasterBackupEnvelope({ theme: "dark", interfaceScale: 120 }),
      errorCode("invalid_payload"),
    );
    await db.invoices.update(invoiceId, { subtotal: 100 });
    await db.stockMovements.clear();
    await assert.rejects(
      createMasterBackupEnvelope({ theme: "dark", interfaceScale: 120 }),
      errorCode("invalid_payload"),
    );
    await db.table("stockMovements").bulkPut(fixtures.stockMovements);

    const envelope = await createMasterBackupEnvelope({ theme: "dark", interfaceScale: 120 });
    assert.equal(envelope.payload.summary.totalRecords, 16);
    assert.equal(envelope.payload.summary.settledCustomers, 1);
    assert.deepEqual(envelope.payload.stores.meta, [{ key: "master-backup-source-id", value: "fixture-dataset" }]);
    const parsed = parseMasterBackupBytes(new TextEncoder().encode(`\uFEFF${masterBackupText(envelope)}`));
    assert.deepEqual(parsed, envelope);

    await clearAll();
    const destinationPin = JSON.stringify({ version: 1, salt: "dest", iterations: 120000, hash: "dest-hash" });
    await db.meta.bulkPut([
      { key: OWNER_PIN_META, value: destinationPin },
      { key: "destination-sentinel", value: "unchanged-until-success" },
    ]);
    const preview = await previewMasterRestore(parsed);
    assert.equal(preview.currentRecords, 2);
    assert.equal(preview.willReplaceRecords, 16);

    await db.meta.put({ key: "changed-after-preview", value: true });
    await assert.rejects(
      restoreMasterBackup(parsed, { expectedDestinationFingerprint: preview.destinationFingerprint }),
      errorCode("destination_changed"),
    );
    assert.equal((await db.meta.get("destination-sentinel"))?.value, "unchanged-until-success");

    const currentPreview = await previewMasterRestore(parsed);
    await assert.rejects(
      restoreMasterBackup(parsed, {
        cloudConfigured: true,
        expectedDestinationFingerprint: currentPreview.destinationFingerprint,
      }),
      errorCode("cloud_connected"),
    );

    const beforeFailure = await snapshot();
    const storageBeforeFailure = new MemoryStorage();
    storageBeforeFailure.setItem("mantu-theme", "light");
    storageBeforeFailure.setItem(INTERFACE_SCALE_CACHE, "100");
    const originalAdd = db.activityLogs.add;
    (db.activityLogs as unknown as { add: () => Promise<never> }).add = async () => {
      throw new Error("forced restore failure");
    };
    try {
      await assert.rejects(
        restoreMasterBackup(parsed, {
          expectedDestinationFingerprint: currentPreview.destinationFingerprint,
          storage: storageBeforeFailure,
        }),
        errorCode("restore_failed"),
      );
    } finally {
      (db.activityLogs as unknown as { add: typeof originalAdd }).add = originalAdd;
    }
    assert.deepEqual(await snapshot(), beforeFailure);
    assert.equal(storageBeforeFailure.getItem("mantu-theme"), "light");
    assert.equal(storageBeforeFailure.getItem(INTERFACE_SCALE_CACHE), "100");

    const finalPreview = await previewMasterRestore(parsed);
    const restoredStorage = new MemoryStorage();
    restoredStorage.setItem("mantu-theme", "light");
    restoredStorage.setItem(INTERFACE_SCALE_CACHE, "100");
    const result = await restoreMasterBackup(parsed, {
      expectedDestinationFingerprint: finalPreview.destinationFingerprint,
      storage: restoredStorage,
    });
    assert.deepEqual(result, { restoredRecords: 16, restoredStores: 16, deviceSettingsApplied: true });
    assert.equal(restoredStorage.getItem("mantu-theme"), "dark");
    assert.equal(restoredStorage.getItem(INTERFACE_SCALE_CACHE), "120");

    db.close();
    await db.open();
    const restored = await snapshot();
    for (const name of MASTER_STORE_NAMES) {
      const extra = name === "activityLogs" || name === "meta" ? 1 : 0;
      assert.equal(restored[name].length, envelope.payload.storeCounts[name] + extra, name);
    }
    for (const name of [
      "categories", "parties", "items", "partyItemPrices", "invoices", "payments",
      "accountEntries", "expenses", "stockMovements", "countSessions", "countLines",
    ]) assert.equal((restored[name][0] as Record<string, unknown>).isSynced, false, name);
    assert.equal((await db.meta.get(OWNER_PIN_META))?.value, destinationPin);
    assert.equal(await db.meta.get("destination-sentinel"), undefined);
    assert.equal(await db.meta.get("cloud-business-fingerprint-v1"), undefined);
    assert.equal(await db.meta.get("invoice-device-code"), undefined);
    assert.equal(
      (restored.activityLogs as Record<string, unknown>[]).some((row) => row.action === "master.backup.restore"),
      true,
    );
  } finally {
    await db.delete();
  }
});
