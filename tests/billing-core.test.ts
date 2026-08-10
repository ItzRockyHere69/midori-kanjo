import "fake-indexeddb/auto";
import "./pdf-i18n.test";
import "./festival-planning.test";
import "./due-backup.test";
import "./dues-ledger-archive.test";
import "./master-backup.test";
import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  priceKey,
  type AccountEntry,
  type Expense,
  type Invoice,
  type InvoiceLine,
  type Item,
  type Party,
  type Payment,
} from "../lib/db";
import {
  calculateBill,
  calculateLine,
  convertQuotationToInvoice,
  convertUnitRate,
  convertedInvoiceId,
  createParty,
  createQuickItem,
  createQuickParty,
  customerInvoiceHistory,
  customerPaymentHistory,
  dueCustomerRows,
  formatMoney,
  fuzzyScore,
  invoiceInitialPaymentBreakdown,
  partyDueStatement,
  partyMatchesSearch,
  priceForParty,
  recordDue,
  recordPayment,
  roundMoney,
  saveQuotation,
  saveSale,
  shouldOfferInlineItemCreation,
  softDeleteInvoice,
  restoreInvoice,
} from "../lib/billing";
import {
  buildCashFlowReport,
  recordExpense,
  removeExpense,
  restoreExpense,
} from "../lib/cashflow";
import { cashFlowText, createCashFlowPdf } from "../lib/report-export";
import {
  buildDashboardTrendBuckets,
  buildSalesSettlementReport,
  dashboardPeriodRange,
} from "../lib/report-dashboard";
import {
  createDueStatementPdf,
  dueStatementText,
  partyStatementLabel,
} from "../lib/due-statement-export";
import { invoicePdf } from "../lib/pdf";
import { itemProfitMetrics } from "../lib/item-profit";
import {
  isLanguage,
  labels,
  localeForLanguage,
  localizedInvoicePartyName,
  localizedItemName,
} from "../lib/i18n";
import {
  sampleCategories,
  sampleItems,
  sampleParties,
  samplePrices,
  sampleSuppliers,
  seedIfNeeded,
} from "../lib/seed";
import {
  clearCloudConfig,
  configureCloud,
  generateBusinessSyncCode,
  getCloudConfig,
  pendingCount,
  reconcilePartyBalances,
  supabaseClient,
  syncDiagnostics,
  syncWithClient,
} from "../lib/sync";
import {
  buildDailySalesReport,
  buildDeadStockReport,
  buildItemProfitReport,
  buildMarginByPartyReport,
  buildPartySalesReport,
  buildReceivablesAging,
  buildTopRevenueItems,
} from "../lib/reports";
import {
  buildInventoryValuation,
  commitCountSession,
  lowStockItems,
  reconcileInventoryStock,
  recordInventoryReturn,
  recordStockInward,
  recordStockOutward,
  reviewCountSession,
  saveCountedStock,
  setStockAbsolute,
  startCountSession,
} from "../lib/inventory";
import { cataloguePdf, cataloguePrice } from "../lib/catalogue-pdf";
import {
  canonicalizeMessageTemplates,
  clearBillDraft,
  dailyCashSummary,
  defaultMessageTemplates,
  loadBillDraft,
  isRestorableArchivedItem,
  localizedDefaultMessageTemplates,
  messageTemplatesForLanguage,
  mergeItems,
  mergeParties,
  normalizeWorkspace,
  ownerPinConfigured,
  pbkdf2Sha256Fallback,
  quantityPresets,
  restoreArchivedItem,
  saveBillDraft,
  saveDailyClose,
  setOwnerPin,
  sha256Hex,
  variantFamily,
  verifyOwnerPin,
  withVariantFamily,
} from "../lib/qol";

test("tenant identifiers use the standard SHA-256 hex representation", () => {
  assert.equal(
    sha256Hex("test-business-sync-code-1234567890"),
    "7bdebe348faeda556a3005c310de23f8744f21cd7a0b3c9d8a745ef85695219a",
  );
  const first = generateBusinessSyncCode();
  const second = generateBusinessSyncCode();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("owner item metrics calculate profit and gross margin without inventing unknown costs", () => {
  assert.deepEqual(
    itemProfitMetrics({ purchasePrice: 220, priceWholesale: 280 }),
    {
      costKnown: true,
      purchasePrice: 220,
      sellingPrice: 280,
      profit: 60,
      marginPercent: 21.43,
    },
  );
  assert.deepEqual(
    itemProfitMetrics({ purchasePrice: 0, priceWholesale: 280 }),
    {
      costKnown: false,
      purchasePrice: 0,
      sellingPrice: 280,
      profit: null,
      marginPercent: null,
    },
  );
  assert.equal(
    itemProfitMetrics({ purchasePrice: 300, priceWholesale: 280 }).profit,
    -20,
  );
});

function memorySupabase() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => {
    const existing = tables.get(name);
    if (existing) return existing;
    const created = new Map<string, Record<string, unknown>>();
    tables.set(name, created);
    return created;
  };
  return {
    client: {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: {
                id: "part-a-test",
                user_metadata: {
                  sync_code: "test-business-sync-code-1234567890",
                },
              },
            },
          },
        }),
        signOut: async () => ({ error: null }),
        signInAnonymously: async () => ({
          data: {
            session: {
              user: {
                id: "part-a-test",
                user_metadata: {
                  sync_code: "test-business-sync-code-1234567890",
                },
              },
            },
          },
          error: null,
        }),
      },
      from: (name: string) => ({
        upsert: async (rows: Record<string, unknown>[]) => {
          const destination = table(name);
          for (const row of rows)
            destination.set(String(row.id), structuredClone(row));
          return { data: null, error: null };
        },
        select: async () => ({
          data: [...table(name).values()].map((row) => structuredClone(row)),
          error: null,
        }),
      }),
    } as unknown as Parameters<typeof syncWithClient>[0],
    rows: (name: string) =>
      [...table(name).values()].map((row) => structuredClone(row)),
    setRow: (name: string, row: Record<string, unknown>) =>
      table(name).set(String(row.id), structuredClone(row)),
  };
}

test("the supplied Phase 1 catalogue and party-specific prices are seeded exactly", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();

  assert.equal(
    (await db.items.filter((item) => item.isActive).toArray()).length,
    14,
  );
  assert.equal(await db.parties.count(), 8);
  assert.deepEqual(
    sampleCategories
      .filter((category) => category.id !== "cat-uncategorized")
      .map((category) => category.name),
    [
      "Moti Mala",
      "Puja Decor",
      "Diwali Lights & Torans",
      "Christmas Decor",
      "Birthday Items",
      "Independence Day / Patriotic",
      "Wedding Decor",
      "Balloons & Party Supplies",
    ],
  );
  assert.equal(sampleItems.length, 14);
  assert.equal(sampleParties.length, 6);
  assert.equal(sampleSuppliers.length, 2);
  assert.equal(await db.parties.where("type").equals("supplier").count(), 2);

  const item = await db.items.get("i-mm12-red");
  const ramesh = await db.parties.get("p-ramesh");
  const shubho = await db.parties.get("p-shubho");
  const walkIn = await db.parties.get("p-walk-in");
  assert.ok(item && ramesh && shubho && walkIn);
  assert.deepEqual(
    {
      unit: item.baseUnit,
      purchase: item.purchasePrice,
      wholesale: item.priceWholesale,
      retail: item.priceRetail,
    },
    { unit: "dozen", purchase: 220, wholesale: 280, retail: 350 },
  );
  assert.equal((await priceForParty(item, ramesh)).rate, 275);
  assert.equal((await priceForParty(item, shubho)).rate, 285);
  assert.equal((await priceForParty(item, walkIn)).rate, 350);

  await db.delete();
});

test("inline item creation stays available beside fuzzy suggestions but not for an exact duplicate", async () => {
  await db.open();
  await seedIfNeeded();
  const items = await db.items.toArray();
  assert.equal(
    shouldOfferInlineItemCreation("Moti Mala 12 inch Red", items),
    false,
  );
  assert.equal(shouldOfferInlineItemCreation("MM-12-RED", items), false);
  assert.equal(
    shouldOfferInlineItemCreation("Moti Mala 12 inch Rose Gold", items),
    true,
  );
  assert.equal(
    shouldOfferInlineItemCreation("completely new toran", items),
    true,
  );
  assert.equal(shouldOfferInlineItemCreation("   ", items), false);
  await db.delete();
});

test("Unicode fuzzy search never treats unrelated Hindi or Bengali as a product match", () => {
  const item = sampleItems[0];
  assert.equal(fuzzyScore("बिल्कुल असंबंधित", item), 0);
  assert.equal(fuzzyScore("সম্পূর্ণ অসংলগ্ন", item), 0);
  assert.equal(fuzzyScore("झ", item), 0);
  assert.equal(fuzzyScore("ঙ", item), 0);
  assert.ok(fuzzyScore(item.nameHi, item) >= 5000);
  assert.ok(fuzzyScore(item.nameBn, item) >= 5000);
  assert.ok(fuzzyScore("१२", item) > 0);
  assert.ok(fuzzyScore("১২", item) > 0);
  assert.equal(
    fuzzyScore("মালা", { ...item, name: "", nameHi: "", nameBn: "মেলা" }),
    0,
  );
});

test("modern Hindi and Bengali labels stay complete, safe and business-friendly", () => {
  const englishKeys = Object.keys(labels.en).sort();
  assert.deepEqual(Object.keys(labels.hi).sort(), englishKeys);
  assert.deepEqual(Object.keys(labels.bn).sort(), englishKeys);
  assert.equal(isLanguage("hi"), true);
  assert.equal(isLanguage("bn"), true);
  assert.equal(isLanguage("legacy-language"), false);
  assert.equal(localeForLanguage("hi"), "hi-IN-u-nu-latn");
  assert.equal(localeForLanguage("bn"), "bn-IN-u-nu-latn");
  assert.doesNotMatch(Object.values(labels.hi).join(" "), /निर्यात|शुद्ध नकदी|वास्तविक प्राप्ति|विविध/);
  assert.doesNotMatch(Object.values(labels.bn).join(" "), /রপ্তানি|প্রকৃত প্রাপ্তি|নথিভুক্ত|পুনরুদ্ধার/);
  assert.equal(localizedItemName("hi", sampleItems[0]), sampleItems[0].nameHi);
  assert.equal(localizedItemName("bn", sampleItems[0]), sampleItems[0].nameBn);
  assert.equal(
    localizedInvoicePartyName("hi", { partyName: "Cash customer" }),
    "कैश कस्टमर",
  );
  assert.equal(
    localizedInvoicePartyName("bn", { partyName: "Cash customer" }),
    "ক্যাশ কাস্টমার",
  );
  assert.equal(
    localizedInvoicePartyName("bn", {
      partyId: "party-1",
      partyName: "Owner-entered party name",
    }),
    "Owner-entered party name",
  );
  assert.equal(
    messageTemplatesForLanguage("hi", defaultMessageTemplates).invoice,
    localizedDefaultMessageTemplates.hi.invoice,
  );
  assert.deepEqual(
    canonicalizeMessageTemplates("bn", localizedDefaultMessageTemplates.bn),
    defaultMessageTemplates,
  );
  assert.equal(
    canonicalizeMessageTemplates("hi", {
      ...localizedDefaultMessageTemplates.hi,
      invoice: "Custom {{invoice_number}}",
    }).invoice,
    "Custom {{invoice_number}}",
  );
});

test("cash-flow exports localize system labels but preserve custom descriptions", () => {
  const expense = {
    id: "expense-default-title",
    category: "refreshments",
    amount: 25,
    date: "2026-08-09",
    description: "Tea & coffee",
    paymentMode: "cash",
    reference: "",
    isSynced: false,
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
  } satisfies Expense;
  const reportFor = (description: string) => buildCashFlowReport({
    invoices: [],
    payments: [],
    parties: [],
    accountEntries: [],
    expenses: [{ ...expense, description }],
    fromDate: expense.date,
    toDate: expense.date,
  });
  const business = { name: "Test shop", address: "", phone: "", gstin: "" };

  const hindi = cashFlowText(reportFor("Tea & coffee"), business, "hi");
  assert.match(hindi, /चाय और कॉफ़ी/);
  assert.doesNotMatch(hindi, /Tea & coffee/);

  const bengali = cashFlowText(reportFor("চা ও কফি"), business, "bn");
  assert.match(bengali, /চা ও কফি/);

  const custom = cashFlowText(reportFor("Tea for the night shift"), business, "hi");
  assert.match(custom, /Tea for the night shift/);

  const cashInvoiceReport = reportFor("Tea for the night shift");
  cashInvoiceReport.movements = [{
    id: "invoice-cash-sale",
    date: expense.date,
    createdAt: expense.createdAt,
    direction: "in",
    source: "sale",
    partyId: null,
    title: "Sale CASH-1",
    details: "Cash customer",
    mode: "cash",
    amount: 100,
  }];
  const cashInvoiceHindi = cashFlowText(cashInvoiceReport, business, "hi");
  assert.match(cashInvoiceHindi, /कैश कस्टमर/);
  assert.doesNotMatch(cashInvoiceHindi, /Cash customer/);
});

test("an offline product photo survives the seed-data upgrade", async () => {
  await db.open();
  const imageUrl = "data:image/jpeg;base64,cHJvZHVjdC1waG90bw==";
  await db.items.put({ ...sampleItems[0], imageUrl });
  await db.meta.put({ key: "seeded-v1", value: true });

  await seedIfNeeded();

  assert.equal((await db.items.get(sampleItems[0].id))?.imageUrl, imageUrl);
  assert.equal((await db.items.get(sampleItems[1].id))?.imageUrl, undefined);
  await db.delete();
});

test("seed upgrades add missing defaults without overwriting editable business data", async () => {
  await db.delete();
  await db.open();
  const customItem = {
    ...sampleItems[0],
    name: "Owner renamed product",
    purchasePrice: 777,
    priceWholesale: 999,
    isActive: false,
    imageUrl: "data:image/jpeg;base64,b3duZXItcGhvdG8=",
    updatedAt: "2026-08-09T12:00:00.000Z",
    isSynced: true,
  };
  const customParty = {
    ...sampleParties[0],
    phone: "9999999999",
    address: "Owner-entered address",
    openingBalance: 123,
    currentBalance: 456,
    notes: "Owner-entered customer notes",
    updatedAt: "2026-08-09T12:00:00.000Z",
    isSynced: true,
  };
  const customPrice = {
    ...samplePrices[0],
    lastPrice: 432,
    lockedPrice: true,
    timesSold: 99,
    updatedAt: "2026-08-09T12:00:00.000Z",
    isSynced: true,
  };
  const customCategory = {
    ...sampleCategories[1],
    name: "Owner category name",
  };
  const legacyItem = {
    ...sampleItems[0],
    id: "i-mm12-green",
    name: "Owner legacy item",
    skuCode: "OWNER-LEGACY-ITEM",
  };
  const legacyParty = {
    ...sampleParties[0],
    id: "p-ganesh",
    name: "Owner legacy party",
    codeName: "OWNER-LEGACY-PARTY",
  };
  await db.items.bulkPut([customItem, legacyItem]);
  await db.parties.bulkPut([customParty, legacyParty]);
  await db.partyItemPrices.put(customPrice);
  await db.categories.put(customCategory);
  await db.meta.put({ key: "seeded-v1", value: true });

  await seedIfNeeded();

  assert.deepEqual(
    await db.items.get(customItem.id),
    customItem,
  );
  assert.deepEqual(
    await db.parties.get(customParty.id),
    customParty,
  );
  assert.deepEqual(await db.partyItemPrices.get(customPrice.id), customPrice);
  assert.deepEqual(await db.categories.get(customCategory.id), customCategory);
  assert.equal((await db.items.get(legacyItem.id))?.name, legacyItem.name);
  assert.equal((await db.parties.get(legacyParty.id))?.name, legacyParty.name);
  assert.ok(await db.items.get(sampleItems[1].id));
  assert.ok(await db.parties.get(sampleSuppliers[0].id));
  assert.equal((await db.meta.get("seeded-v3"))?.value, true);
  await db.delete();
});

test("the complete counter flow saves four units, inline records and the negotiated party price", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createQuickParty(
    "Part A Counter Buyer",
    "9000000001",
    "PART-A-BUYER",
    "Burrabazar test counter",
  );
  const quickItem = await createQuickItem("Part A Inline Ribbon", 125);
  const quickParty = await createQuickParty(
    "Part A Inline Party",
    "9000000002",
    "PART-A-INLINE",
    "Ezra Street, Burrabazar",
  );
  const [dozenItem, pieceItem, packetItem, bundleItem] = await Promise.all([
    db.items.get("i-mm12-red"),
    db.items.get("i-toran"),
    db.items.get("i-diya"),
    db.items.get("i-wedding-flower"),
  ]);
  assert.ok(dozenItem && pieceItem && packetItem && bundleItem);
  assert.deepEqual(
    [
      dozenItem.baseUnit,
      pieceItem.baseUnit,
      packetItem.baseUnit,
      bundleItem.baseUnit,
    ],
    ["dozen", "piece", "packet", "bundle"],
  );
  assert.ok(
    [dozenItem, pieceItem, packetItem, bundleItem, quickItem].every(
      (item) => item.currentStock === null,
    ),
  );
  assert.equal(
    (await db.items.get(quickItem.id))?.name,
    "Part A Inline Ribbon",
  );
  assert.equal(
    (await db.parties.get(quickParty.id))?.codeName,
    "PART-A-INLINE",
  );

  const lines: InvoiceLine[] = [
    {
      itemId: dozenItem.id,
      itemName: dozenItem.name,
      skuCode: dozenItem.skuCode,
      hsnCode: "",
      qty: 2,
      unit: "dozen",
      baseUnit: "dozen",
      rate: 333,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: pieceItem.id,
      itemName: pieceItem.name,
      skuCode: pieceItem.skuCode,
      hsnCode: "",
      qty: 3,
      unit: "piece",
      baseUnit: "piece",
      rate: 49,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: packetItem.id,
      itemName: packetItem.name,
      skuCode: packetItem.skuCode,
      hsnCode: "",
      qty: 4,
      unit: "packet",
      baseUnit: "packet",
      rate: 61,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: bundleItem.id,
      itemName: bundleItem.name,
      skuCode: bundleItem.skuCode,
      hsnCode: "",
      qty: 1,
      unit: "bundle",
      baseUnit: "bundle",
      rate: 271,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
  ];
  const invoice = await saveSale({
    party,
    lines,
    paid: 0,
    paymentMode: "credit",
  });
  assert.deepEqual(
    invoice.lineItems.map((line) => line.unit),
    ["dozen", "piece", "packet", "bundle"],
  );
  assert.equal(
    invoice.lineItems.find((line) => line.itemId === pieceItem.id)?.rate,
    49,
  );
  assert.equal((await priceForParty(pieceItem, party)).rate, 49);
  assert.notEqual(
    (await priceForParty(pieceItem, party)).rate,
    pieceItem.priceWholesale,
  );
  assert.equal((await db.invoices.get(invoice.id))?.lineItems.length, 4);
  await db.delete();
});

test("three offline bills reconnect idempotently with no duplicates or data loss", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createQuickParty(
    "Offline Sync Buyer",
    "9000000003",
    "OFFLINE-SYNC",
    "Burrabazar",
  );
  const item = await db.items.get("i-mm12-red");
  assert.ok(item);
  const line: InvoiceLine = {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: "",
    qty: 1,
    unit: "dozen",
    baseUnit: "dozen",
    rate: 347,
    discount: 0,
    taxableAmount: 0,
    gstRate: 18,
    gstAmount: 0,
    amount: 0,
  };
  const offlineBills = [];
  for (let index = 0; index < 3; index += 1)
    offlineBills.push(
      await saveSale({
        party: await db.parties.get(party.id),
        lines: [{ ...line, qty: index + 1 }],
        paid: 0,
        paymentMode: "credit",
      }),
    );
  const originalIds = offlineBills.map((invoice) => invoice.id).sort();
  assert.equal(await db.invoices.count(), 3);
  assert.ok((await pendingCount()) > 0);

  const remote = memorySupabase();
  assert.equal(await syncWithClient(remote.client), "synced");
  assert.equal(remote.rows("invoices").length, 3);
  assert.equal(
    (await db.invoices.toArray()).filter((invoice) => !invoice.isSynced).length,
    0,
  );
  assert.equal(await pendingCount(), 0);

  assert.equal(await syncWithClient(remote.client), "synced");
  assert.equal(remote.rows("invoices").length, 3);
  const roundTripped = await db.invoices.toArray();
  assert.deepEqual(
    roundTripped.map((invoice) => invoice.id).sort(),
    originalIds,
  );
  assert.deepEqual(
    roundTripped
      .map((invoice) => invoice.lineItems[0].qty)
      .sort((a, b) => a - b),
    [1, 2, 3],
  );
  assert.equal(
    new Set(roundTripped.map((invoice) => invoice.invoiceNumber)).size,
    3,
  );
  await db.delete();
});

test("bill-level GST supports off, 18 percent and 25 percent totals", () => {
  const line = {
    itemId: "gst-item",
    itemName: "GST item",
    skuCode: "GST-1",
    hsnCode: "",
    qty: 1,
    unit: "piece" as const,
    baseUnit: "piece" as const,
    rate: 100,
    discount: 0,
    taxableAmount: 0,
    gstRate: 0,
    gstAmount: 0,
    amount: 0,
  };
  const withoutGst = calculateBill([line], 0);
  const eighteen = calculateBill([{ ...line, gstRate: 18 }], 0);
  const twentyFive = calculateBill([{ ...line, gstRate: 25 }], 0);
  assert.deepEqual(
    { gst: withoutGst.gstTotal, total: withoutGst.grandTotal },
    { gst: 0, total: 100 },
  );
  assert.deepEqual(
    { gst: eighteen.gstTotal, total: eighteen.grandTotal },
    { gst: 18, total: 118 },
  );
  assert.deepEqual(
    { gst: twentyFive.gstTotal, total: twentyFive.grandTotal },
    { gst: 25, total: 125 },
  );
});

test("A4, A5 and thermal invoices render with stable page sizes and no signature-only page", async () => {
  const drafts: InvoiceLine[] = [
    {
      itemId: "a",
      itemName: "Moti Mala 12 inch Red",
      skuCode: "MM-12-RED",
      hsnCode: "9505",
      qty: 2,
      unit: "dozen",
      baseUnit: "dozen",
      rate: 333,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: "b",
      itemName: "Toran Diwali Standard",
      skuCode: "DL-TOR-STD",
      hsnCode: "9505",
      qty: 3,
      unit: "piece",
      baseUnit: "piece",
      rate: 49,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: "c",
      itemName: "Diya Set (12pc)",
      skuCode: "DL-DIYA-12",
      hsnCode: "6912",
      qty: 4,
      unit: "packet",
      baseUnit: "packet",
      rate: 61,
      discount: 5,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
    {
      itemId: "d",
      itemName: "Wedding Backdrop Flower Strip Premium Long Name",
      skuCode: "WD-FLW-BDL",
      hsnCode: "6702",
      qty: 1,
      unit: "bundle",
      baseUnit: "bundle",
      rate: 271,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    },
  ];
  const lineItems = drafts.map((line) => ({ ...line, ...calculateLine(line) }));
  const charges = [
    {
      code: "carrier" as const,
      label: "Carrier / transport charge",
      amount: 80,
    },
    { code: "packing" as const, label: "Packing charge", amount: 25 },
  ];
  const totals = calculateBill(lineItems, 500, charges);
  const invoice: Invoice = {
    id: "pdf-test",
    invoiceNumber: "MB-2026-27-QA-1",
    partyName: "Burrabazar Quality Assurance Decorators",
    date: "2026-08-08",
    type: "sale",
    lineItems,
    otherCharges: charges,
    ...totals,
    paymentMode: "mixed",
    notes: "",
    isSynced: false,
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:00.000Z",
  };
  const business = {
    name: "Midori Kanjo Decorations",
    address: "18 Rabindra Sarani, Burrabazar, Kolkata",
    phone: "9000000000",
    gstin: "19ABCDE1234F1Z5",
  };
  const [a4, a5, thermal] = await Promise.all([
    invoicePdf(invoice, business, "a4"),
    invoicePdf(invoice, business, "a5"),
    invoicePdf(invoice, business, "thermal"),
  ]);
  assert.ok(Math.abs(a4.internal.pageSize.getWidth() - 210) < 1);
  assert.ok(Math.abs(a5.internal.pageSize.getWidth() - 148) < 1);
  assert.ok(Math.abs(thermal.internal.pageSize.getWidth() - 80) < 1);
  assert.equal(a4.getNumberOfPages(), 1);
  assert.ok(a5.getNumberOfPages() <= 2);
  assert.equal(thermal.getNumberOfPages(), 1);
  assert.ok(thermal.internal.pageSize.getHeight() >= 185);
  assert.ok(
    [a4, a5, thermal].every(
      (doc) => doc.output("arraybuffer").byteLength > 3000,
    ),
  );
});

test("thermal invoices use one measured roll page and split only beyond the safe PDF height", async () => {
  const makeInvoice = (count: number, longNames = false): Invoice => {
    const drafts = Array.from({ length: count }, (_, index): InvoiceLine => ({
      itemId: `thermal-${index}`,
      itemName: longNames
        ? `Premium festival decoration item ${index + 1} with a deliberately long multilingual-ready description `.repeat(5)
        : `Counter item ${index + 1}`,
      skuCode: `TH-${index + 1}`,
      hsnCode: "9505",
      qty: 1,
      unit: "piece",
      baseUnit: "piece",
      rate: 10,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    }));
    const lineItems = drafts.map((line) => ({ ...line, ...calculateLine(line) }));
    const paid = 100;
    const totals = calculateBill(lineItems, paid);
    return {
      id: `thermal-plan-${count}-${longNames}`,
      invoiceNumber: `TH-${count}`,
      partyName: "Thermal Plan Buyer",
      date: "2026-08-10",
      type: "sale",
      lineItems,
      ...totals,
      initialAmountPaid: paid,
      paymentMode: "mixed",
      paymentBreakdown: [
        { mode: "cash", amount: 40 },
        { mode: "upi", amount: 60, reference: "UPI-THERMAL" },
      ],
      notes: "",
      isSynced: false,
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-10T09:00:00.000Z",
    };
  };
  const business = {
    name: "Measured Roll Shop",
    ownerName: "Shopkeeper Name",
    address: "12 Long Market Road, Burrabazar, Kolkata, West Bengal",
    phone: "9000000000",
    alternatePhone: "9000000001",
    email: "shop@example.com",
    gstin: "19ABCDE1234F1Z5",
  };
  const ordinary = await invoicePdf(makeInvoice(40), business, "thermal");
  assert.equal(ordinary.getNumberOfPages(), 1);
  assert.ok(ordinary.internal.pageSize.getHeight() < 1200);

  const extreme = await invoicePdf(makeInvoice(250, true), business, "thermal");
  assert.ok(extreme.getNumberOfPages() >= 2);
  const heights = Array.from({ length: extreme.getNumberOfPages() }, (_, index) => {
    extreme.setPage(index + 1);
    return extreme.internal.pageSize.getHeight();
  });
  assert.ok(heights.every((height) => height >= 190 && height <= 4800));
  assert.ok(heights.at(-1)! < 4800);
});

test("toggleable carrier, packing and big-box charges are included exactly once", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({
    name: "Charge Test Customer",
    codeName: "CHARGE-TEST",
    type: "customer",
  });
  const line: InvoiceLine = {
    itemId: "charge-item",
    itemName: "Charge item",
    skuCode: "CHG-1",
    hsnCode: "",
    qty: 1,
    unit: "piece",
    baseUnit: "piece",
    rate: 100,
    discount: 0,
    taxableAmount: 0,
    gstRate: 18,
    gstAmount: 0,
    amount: 0,
  };
  const charges = [
    {
      code: "carrier" as const,
      label: "Carrier / transport charge",
      amount: 50,
    },
    { code: "packing" as const, label: "Packing charge", amount: 20 },
    { code: "big_box" as const, label: "Big box charge", amount: 30 },
  ];

  const withoutCharges = calculateBill([line], 0, []);
  const withCharges = calculateBill([line], 0, charges);
  assert.deepEqual(
    {
      gst: withCharges.gstTotal,
      charges: withCharges.otherChargesTotal,
      total: withCharges.grandTotal,
    },
    { gst: 18, charges: 100, total: 218 },
  );
  assert.equal(withoutCharges.grandTotal, 118);

  const invoice = await saveSale({
    party,
    lines: [line],
    paid: 0,
    paymentMode: "credit",
    otherCharges: charges,
  });
  assert.equal(invoice.otherCharges?.length, 3);
  assert.equal(invoice.otherChargesTotal, 100);
  assert.equal(invoice.amountDue, 218);
  assert.equal((await db.invoices.get(invoice.id))?.otherChargesTotal, 100);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 218);
  const currentParty = await db.parties.get(party.id);
  await assert.rejects(
    () =>
      saveSale({
        party: currentParty,
        lines: [line],
        paid: 0,
        paymentMode: "credit",
        otherCharges: [
          { code: "packing", label: "Packing charge", amount: -1 },
        ],
      }),
    /valid amount/,
  );
  await db.delete();
});

test("customer receivables and supplier payables add dues and subtract payments", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const customer = await createParty({
    name: "Test Customer",
    codeName: "tc-burra-01",
    address: "Canning Street, Burrabazar",
    type: "customer",
    openingBalance: 200,
  });
  const supplier = await createParty({
    name: "Test Supplier",
    type: "supplier",
    openingBalance: 1000,
  });

  assert.equal(customer.codeName, "TC-BURRA-01");
  assert.equal(partyMatchesSearch(customer, "burra-01"), true);
  assert.equal(partyMatchesSearch(customer, "canning street"), true);
  assert.equal(partyMatchesSearch(customer, "test customer"), true);
  await assert.rejects(
    () =>
      createParty({
        name: "Duplicate Code",
        codeName: "TC-BURRA-01",
        type: "customer",
      }),
    /already used/,
  );

  await recordDue(customer, 300, "Previous delivery", "C-11");
  await recordPayment(
    (await db.parties.get(customer.id)) || customer,
    100,
    "upi",
    "UPI-1",
  );
  await recordDue(supplier, 500, "Diwali stock", "S-22");
  const supplierPayment = await recordPayment(
    (await db.parties.get(supplier.id)) || supplier,
    400,
    "bank",
    "BANK-1",
  );

  assert.equal((await db.parties.get(customer.id))?.currentBalance, 400);
  assert.equal((await db.parties.get(supplier.id))?.currentBalance, 1100);
  assert.deepEqual(supplierPayment.allocatedTo, []);
  assert.equal(await db.accountEntries.count(), 2);
  assert.equal(await db.payments.count(), 2);
  await assert.rejects(
    () =>
      saveSale({
        party: supplier,
        lines: [
          {
            itemId: "x",
            itemName: "x",
            skuCode: "x",
            hsnCode: "",
            qty: 1,
            unit: "piece",
            rate: 10,
            discount: 0,
            taxableAmount: 0,
            gstRate: 0,
            gstAmount: 0,
            amount: 0,
          },
        ],
        paid: 0,
        paymentMode: "credit",
      }),
    /customer/,
  );
  await db.delete();
});

test("payments allocate only to receivable sales or payable purchases and never to quotations", async () => {
  await db.delete();
  await db.open();
  const customer = await createParty({
    name: "Quotation Payment Guard",
    type: "customer",
    openingBalance: 500,
  });
  const quotation = await saveQuotation({
    party: customer,
    lines: [sampleInvoiceLine()],
  });
  const customerPayment = await recordPayment(
    customer,
    100,
    "cash",
    "opening balance payment",
  );
  const storedQuotation = await db.invoices.get(quotation.id);
  assert.deepEqual(customerPayment.allocatedTo, []);
  assert.deepEqual(
    { paid: storedQuotation?.amountPaid, due: storedQuotation?.amountDue },
    { paid: 0, due: quotation.grandTotal },
  );

  const supplier = await createParty({
    name: "Purchase Allocation Supplier",
    type: "supplier",
    openingBalance: 500,
  });
  const stamp = "2026-08-09T10:00:00.000Z";
  const purchase: Invoice = {
    id: "purchase-allocation-only",
    invoiceNumber: "PUR-ALLOCATION-ONLY",
    partyId: supplier.id,
    partyName: supplier.name,
    date: "2026-08-09",
    type: "purchase",
    lineItems: [sampleInvoiceLine()],
    subtotal: 200,
    discountTotal: 0,
    gstTotal: 0,
    otherCharges: [],
    otherChargesTotal: 0,
    roundOff: 0,
    grandTotal: 200,
    amountPaid: 0,
    amountDue: 200,
    paymentMode: "credit",
    notes: "",
    isSynced: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await db.invoices.put(purchase);
  const supplierPayment = await recordPayment(
    supplier,
    125,
    "bank",
    "supplier transfer",
  );
  assert.deepEqual(supplierPayment.allocatedTo, [
    { invoiceId: purchase.id, amount: 125 },
  ]);
  assert.deepEqual(
    {
      paid: (await db.invoices.get(purchase.id))?.amountPaid,
      due: (await db.invoices.get(purchase.id))?.amountDue,
    },
    { paid: 125, due: 75 },
  );
  await db.delete();
});

test("Dues workspace searches customers, adds a manual due and keeps dated cash/online payment balances", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const customer = await createParty({
    name: "Burrabazar Settlement Buyer",
    codeName: "BB-DUE-42",
    type: "customer",
    openingBalance: 1000,
  });
  const otherCustomer = await createParty({
    name: "Another Buyer",
    codeName: "OTHER-11",
    type: "customer",
    openingBalance: 250,
  });
  const zeroBalanceCustomer = await createParty({
    name: "Manual Due Buyer",
    codeName: "MANUAL-DUE-7",
    type: "customer",
    openingBalance: 0,
  });
  await createParty({
    name: "Ignored Supplier",
    codeName: "SUP-DUE-1",
    type: "supplier",
    openingBalance: 900,
  });
  assert.equal(
    dueCustomerRows(await db.parties.toArray(), []).some(
      (row) => row.party.id === zeroBalanceCustomer.id,
    ),
    false,
  );
  const manualDue = await recordDue(
    zeroBalanceCustomer,
    375,
    "Goods supplied without bill",
    "MANUAL-7",
  );
  const cashRecorded = await recordPayment(
    customer,
    200,
    "cash",
    "CASH-RECEIPT",
  );
  const afterCash = await db.parties.get(customer.id);
  assert.ok(afterCash);
  const upiRecorded = await recordPayment(
    afterCash,
    150,
    "upi",
    "UPI-REFERENCE",
  );
  const current = await db.parties.get(customer.id);
  assert.ok(current);
  const cash = {
    ...cashRecorded,
    date: "2099-01-02",
    createdAt: "2099-01-02T10:00:00.000Z",
  };
  const upi = {
    ...upiRecorded,
    date: "2099-01-03",
    createdAt: "2099-01-03T10:00:00.000Z",
  };
  const allParties = await db.parties.toArray();

  const byCode = dueCustomerRows(allParties, [cash, upi], "due-42");
  const byName = dueCustomerRows(allParties, [cash, upi], "settlement buyer");
  assert.equal(byCode.length, 1);
  assert.equal(byName[0]?.party.id, customer.id);
  assert.equal(byCode[0]?.lastPayment?.mode, "upi");
  assert.equal(
    dueCustomerRows(allParties, [cash, upi]).some(
      (row) => row.party.id === otherCustomer.id,
    ),
    true,
  );
  assert.equal(
    dueCustomerRows(allParties, [cash, upi], "manual-due-7")[0]?.party
      .currentBalance,
    375,
  );
  assert.deepEqual(
    {
      amount: manualDue.amount,
      note: manualDue.note,
      reference: manualDue.reference,
    },
    { amount: 375, note: "Goods supplied without bill", reference: "MANUAL-7" },
  );
  assert.equal(
    dueCustomerRows(allParties, [cash, upi]).some(
      (row) => row.party.type === "supplier",
    ),
    false,
  );

  const history = customerPaymentHistory(current, [], [cash, upi], []);
  assert.deepEqual(
    history.map((row) => ({
      mode: row.payment.mode,
      remaining: row.remainingBalance,
    })),
    [
      { mode: "upi", remaining: 650 },
      { mode: "cash", remaining: 800 },
    ],
  );
  await db.delete();
});

test("customer due statement lists every in/out event, reconciles totals and exports text/PDF", async () => {
  const party: Party = {
    id: "statement-party",
    name: "Statement Test Buyer",
    codeName: "CUS-STMT-1",
    phone: "9000000011",
    address: "Burrabazar, Kolkata",
    type: "customer",
    priceTier: "wholesale",
    openingBalance: 0,
    currentBalance: 4000,
    notes: "",
    tags: [],
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-04T11:00:00.000Z",
    isSynced: false,
  };
  const invoice: Invoice = {
    id: "statement-invoice",
    invoiceNumber: "INV-STMT-1",
    partyId: party.id,
    partyName: party.name,
    date: "2026-01-02",
    type: "sale",
    lineItems: [],
    subtotal: 10000,
    discountTotal: 0,
    gstTotal: 0,
    roundOff: 0,
    grandTotal: 10000,
    amountPaid: 7000,
    amountDue: 3000,
    paymentMode: "mixed",
    paymentReceivedMode: "upi",
    notes: "",
    isSynced: false,
    createdAt: "2026-01-02T10:00:00.000Z",
    updatedAt: "2026-01-04T11:00:00.000Z",
  };
  const manualDue: AccountEntry = {
    id: "statement-manual-due",
    partyId: party.id,
    kind: "due",
    amount: 1000,
    date: "2026-01-03",
    note: "Extra packing supplied",
    reference: "PACK-1",
    isSynced: false,
    createdAt: "2026-01-03T09:00:00.000Z",
    updatedAt: "2026-01-03T09:00:00.000Z",
  };
  const laterPayment: Payment = {
    id: "statement-payment",
    partyId: party.id,
    amount: 2000,
    date: "2026-01-04",
    mode: "cash",
    reference: "CASH-2000",
    allocatedTo: [{ invoiceId: invoice.id, amount: 2000 }],
    isSynced: false,
    createdAt: "2026-01-04T11:00:00.000Z",
    updatedAt: "2026-01-04T11:00:00.000Z",
  };

  const statement = partyDueStatement(
    party,
    [invoice],
    [laterPayment],
    [manualDue],
  );
  assert.deepEqual(
    statement.rows.map((row) => ({
      activity: row.activity,
      dueAdded: row.dueAdded,
      paymentReceived: row.paymentReceived,
      balance: row.runningBalance,
    })),
    [
      {
        activity: "Sales bill",
        dueAdded: 10000,
        paymentReceived: 0,
        balance: 10000,
      },
      {
        activity: "Payment received with bill",
        dueAdded: 0,
        paymentReceived: 5000,
        balance: 5000,
      },
      {
        activity: "Extra packing supplied",
        dueAdded: 1000,
        paymentReceived: 0,
        balance: 6000,
      },
      {
        activity: "Customer payment received",
        dueAdded: 0,
        paymentReceived: 2000,
        balance: 4000,
      },
    ],
  );
  assert.equal(statement.totalDueAdded, 11000);
  assert.equal(statement.totalPaid, 7000);
  assert.equal(statement.remainingDue, 4000);
  assert.equal(statement.lastPayment?.reference, "CASH-2000");

  const business = {
    name: "Midori Kanjo Test Shop",
    address: "Burrabazar, Kolkata",
    phone: "9000000000",
    gstin: "",
  };
  const text = dueStatementText(statement, business);
  assert.equal(partyStatementLabel(party), "Statement Test Buyer (CUS-STMT-1)");
  assert.match(text, /Customer \/ Party\tStatement Test Buyer \(CUS-STMT-1\)/);
  assert.match(text, /DETAILED DUE ACTIVITY - Statement Test Buyer \(CUS-STMT-1\)/);
  assert.match(text, /INV-STMT-1/);
  assert.match(text, /CASH-2000/);
  assert.match(text, /AMOUNT TO PAY NEXT \/ TOTAL REMAINING\tRs\. 4,000\.00/);
  assert.match(text, /TOTAL\t\t\t\tRs\. 11,000\.00\tRs\. 7,000\.00\tRs\. 4,000\.00/);
  const pdf = await createDueStatementPdf(statement, business);
  assert.ok(pdf.getNumberOfPages() >= 1);
  assert.ok(pdf.output("arraybuffer").byteLength > 4000);
});

test("miscellaneous expenses and cash-flow reports count real money once and export exact dates", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const customer = await createParty({
    name: "Cash Flow Buyer",
    codeName: "FLOW-BUYER",
    type: "customer",
    openingBalance: 0,
  });
  const supplier = await createParty({
    name: "Cash Flow Supplier",
    codeName: "FLOW-SUP",
    type: "supplier",
    openingBalance: 100,
  });
  const line: InvoiceLine = {
    itemId: "flow-item",
    itemName: "Flow item",
    skuCode: "FLOW-1",
    hsnCode: "",
    qty: 1,
    unit: "piece",
    baseUnit: "piece",
    rate: 100,
    discount: 0,
    taxableAmount: 0,
    gstRate: 18,
    gstAmount: 0,
    amount: 0,
  };
  const invoice = await saveSale({
    party: customer,
    lines: [line],
    paid: 40,
    paymentMode: "mixed",
  });
  const afterSale = await db.parties.get(customer.id);
  assert.ok(afterSale);
  const laterCustomerPayment = await recordPayment(afterSale, 30, "upi", "LATER-UPI");
  // Simulate a stale invoice snapshot from another device. The immutable
  // amount received with the bill must still drive cash flow.
  await db.invoices.update(invoice.id, { amountPaid: 30, amountDue: 88 });
  const [staleInvoice, currentCustomer] = await Promise.all([
    db.invoices.get(invoice.id),
    db.parties.get(customer.id),
  ]);
  assert.ok(staleInvoice && currentCustomer);
  const staleStatement = partyDueStatement(
    currentCustomer,
    [staleInvoice],
    [laterCustomerPayment],
    [],
  );
  assert.equal(staleStatement.totalPaid, 70);
  assert.equal(staleStatement.remainingDue, 48);
  await recordPayment(supplier, 20, "bank", "SUPPLIER-BANK");
  const expense = await recordExpense({
    category: "refreshments",
    amount: 15,
    date: invoice.date,
    description: "Tea for customers",
    paymentMode: "cash",
    reference: "TEA-15",
  });

  const input = {
    invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(),
    parties: await db.parties.toArray(),
    accountEntries: await db.accountEntries.toArray(),
    expenses: await db.expenses.toArray(),
    fromDate: invoice.date,
    toDate: invoice.date,
  };
  const report = buildCashFlowReport(input);
  assert.deepEqual(
    {
      billed: report.salesBilled,
      withBill: report.receivedWithBills,
      later: report.customerPayments,
      in: report.moneyIn,
      supplier: report.supplierPayments,
      misc: report.miscellaneousExpenses,
      out: report.moneyOut,
      net: report.netCashFlow,
    },
    {
      billed: 118,
      withBill: 40,
      later: 30,
      in: 70,
      supplier: 20,
      misc: 15,
      out: 35,
      net: 35,
    },
  );
  assert.equal(report.movements.length, 4);
  assert.equal(
    report.movements.find((movement) => movement.source === "sale")?.invoiceId,
    invoice.id,
  );
  assert.equal(
    report.movements.find((movement) => movement.source === "customer_payment")
      ?.paymentId,
    laterCustomerPayment.id,
  );
  assert.equal(
    report.movements.find((movement) => movement.source === "misc_expense")
      ?.expenseId,
    expense.id,
  );
  assert.equal(report.customerOutstanding, 48);
  assert.equal(report.supplierOutstanding, 80);
  assert.match(
    cashFlowText(report, {
      name: "Midori Kanjo Test Shop",
      address: "Burrabazar",
      phone: "",
      gstin: "",
    }),
    /TOTAL MONEY IN\tRs\. 70\.00/,
  );
  const pdf = await createCashFlowPdf(report, {
    name: "Midori Kanjo Test Shop",
    address: "Burrabazar",
    phone: "",
    gstin: "",
  });
  assert.ok(pdf.output("arraybuffer").byteLength > 3000);
  const pdfOperators = (
    pdf.internal.pages as unknown as Array<Array<string | number>>
  )
    .flat()
    .join("\n");
  assert.match(pdfOperators, /0\.188 0\.616 0\.294 rg/);
  assert.match(pdfOperators, /0\.706 0\.137 0\.094 rg/);
  assert.match(pdfOperators, /0\.569 0\.369 0\. rg/);

  await removeExpense(expense.id);
  const withoutExpense = buildCashFlowReport({
    ...input,
    expenses: await db.expenses.toArray(),
  });
  assert.equal(withoutExpense.miscellaneousExpenses, 0);
  assert.equal(withoutExpense.moneyOut, 20);
  await restoreExpense(expense.id);
  const restored = buildCashFlowReport({
    ...input,
    expenses: await db.expenses.toArray(),
  });
  assert.equal(restored.miscellaneousExpenses, 15);
  const outsideRange = buildCashFlowReport({
    ...input,
    fromDate: "2099-01-01",
    toDate: "2099-01-31",
  });
  assert.deepEqual(
    {
      in: outsideRange.moneyIn,
      out: outsideRange.moneyOut,
      movements: outsideRange.movements.length,
    },
    { in: 0, out: 0, movements: 0 },
  );
  await db.delete();
});

test("report settlement reconciles split tenders, later payments and due", () => {
  const timestamp = "2026-08-10T10:00:00.000Z";
  const sale: Invoice = {
    id: "report-sale",
    invoiceNumber: "MK-R-1",
    partyId: "report-customer",
    partyName: "Report Customer",
    date: "2026-08-10",
    type: "sale",
    lineItems: [],
    subtotal: 1000,
    discountTotal: 0,
    gstTotal: 0,
    roundOff: 0,
    grandTotal: 1000,
    initialAmountPaid: 600,
    amountPaid: 800,
    amountDue: 200,
    paymentMode: "mixed",
    paymentBreakdown: [
      { mode: "cash", amount: 250 },
      { mode: "upi", amount: 200, reference: "UPI-R-1" },
      { mode: "cheque", amount: 150, reference: "CHQ-R-1" },
    ],
    notes: "",
    isSynced: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const later: Payment = {
    id: "report-payment",
    partyId: "report-customer",
    amount: 200,
    date: "2026-08-10",
    mode: "bank",
    reference: "BANK-R-1",
    allocatedTo: [{ invoiceId: sale.id, amount: 200 }],
    isSynced: false,
    createdAt: "2026-08-10T11:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
  };
  const wrongParty: Payment = {
    ...later,
    id: "wrong-party-payment",
    partyId: "another-customer",
    amount: 500,
    allocatedTo: [{ invoiceId: sale.id, amount: 500 }],
  };
  const report = buildSalesSettlementReport([sale], [later, wrongParty]);
  assert.deepEqual(report, {
    totalSales: 1000,
    collected: 800,
    due: 200,
    collectionPercent: 80,
    modes: [
      { mode: "cash", amount: 250 },
      { mode: "upi", amount: 200 },
      { mode: "bank", amount: 200 },
      { mode: "cheque", amount: 150 },
    ],
  });
  assert.equal(
    roundMoney(report.collected + report.due),
    report.totalSales,
  );
  const overAllocated = buildSalesSettlementReport(
    [sale],
    [
      later,
      {
        ...later,
        id: "extra-payment",
        amount: 500,
        allocatedTo: [{ invoiceId: sale.id, amount: 500 }],
      },
    ],
  );
  assert.equal(overAllocated.collected, 1000);
  assert.equal(overAllocated.due, 0);
  assert.equal(overAllocated.collectionPercent, 100);
  const beforeFuturePayment = buildSalesSettlementReport(
    [sale],
    [{ ...later, id: "future-payment", date: "2026-08-11" }],
    "2026-08-10",
  );
  assert.equal(beforeFuturePayment.collected, 600);
  assert.equal(beforeFuturePayment.due, 400);
  const legacySale = {
    ...sale,
    id: "legacy-report-sale",
    initialAmountPaid: undefined,
  };
  const legacyBeforeFuturePayment = buildSalesSettlementReport(
    [legacySale],
    [
      {
        ...later,
        id: "legacy-future-payment",
        date: "2026-08-11",
        allocatedTo: [{ invoiceId: legacySale.id, amount: 200 }],
      },
    ],
    "2026-08-10",
  );
  assert.equal(legacyBeforeFuturePayment.collected, 600);
  assert.equal(legacyBeforeFuturePayment.due, 400);
  const corruptInitial = buildSalesSettlementReport(
    [
      {
        ...sale,
        id: "corrupt-initial-sale",
        initialAmountPaid: 1200,
        amountPaid: 1200,
        amountDue: 0,
        paymentBreakdown: [
          { mode: "cash", amount: 700 },
          { mode: "upi", amount: 500 },
        ],
      },
    ],
    [],
  );
  assert.deepEqual(corruptInitial, {
    totalSales: 1000,
    collected: 1000,
    due: 0,
    collectionPercent: 100,
    modes: [
      { mode: "cash", amount: 700 },
      { mode: "upi", amount: 300 },
    ],
  });
  const historicalBuckets = buildDashboardTrendBuckets(
    [
      { ...sale, id: "july-first", date: "2026-07-01", grandTotal: 100 },
      { ...sale, id: "july-last", date: "2026-07-07", grandTotal: 700 },
    ],
    "2026-07-01",
    "2026-07-07",
    "2026-08-10",
  );
  assert.equal(historicalBuckets.length, 7);
  assert.deepEqual(
    historicalBuckets.map((bucket) => [bucket.labelDate, bucket.value]),
    [
      ["2026-07-01", 100],
      ["2026-07-02", 0],
      ["2026-07-03", 0],
      ["2026-07-04", 0],
      ["2026-07-05", 0],
      ["2026-07-06", 0],
      ["2026-07-07", 700],
    ],
  );
  assert.equal(
    buildDashboardTrendBuckets(
      [{ ...sale, date: "2026-08-10" }],
      "2026-08-10",
      "2026-08-10",
      "2026-08-10",
    ).length,
    1,
  );
  assert.deepEqual(
    buildSalesSettlementReport(
      [
        { ...sale, id: "deleted-sale", deletedAt: timestamp },
        { ...sale, id: "quote", type: "quotation" },
      ],
      [],
    ),
    { totalSales: 0, collected: 0, due: 0, collectionPercent: 0, modes: [] },
  );
  assert.deepEqual(dashboardPeriodRange("30d", "2026-08-10"), {
    fromDate: "2026-07-12",
    toDate: "2026-08-10",
  });
});

test("Phase 1 billing core works offline without duplicate bills", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(party && item);

  const remembered = await priceForParty(item, party);
  assert.equal(remembered.rate, 275);

  const line: InvoiceLine = {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: item.hsnCode || "",
    qty: 1,
    unit: "dozen",
    rate: 350,
    discount: 0,
    taxableAmount: 0,
    gstRate: 5,
    gstAmount: 0,
    amount: 0,
    lockPrice: false,
  };

  const bills = [];
  for (let index = 0; index < 5; index += 1)
    bills.push(
      await saveSale({
        party: await db.parties.get(party.id),
        lines: [line],
        paid: 0,
        paymentMode: "credit",
      }),
    );
  assert.equal(await db.invoices.count(), 5);
  assert.equal(new Set(bills.map((bill) => bill.id)).size, 5);
  assert.equal(new Set(bills.map((bill) => bill.invoiceNumber)).size, 5);
  assert.ok(
    bills.every((bill) =>
      /^MB-\d{4}-\d{2}-[A-Z0-9]{8,}-\d+$/.test(bill.invoiceNumber),
    ),
  );
  assert.match(
    String((await db.meta.get("invoice-device-code"))?.value),
    /^[A-Z0-9]{8,}$/,
  );
  assert.equal(bills.filter((bill) => !bill.isSynced).length, 5);
  const customerHistory = customerInvoiceHistory(
    await db.invoices.toArray(),
    party.id,
  );
  assert.equal(customerHistory.length, 5);
  assert.ok(customerHistory.every((bill) => bill.partyId === party.id));

  const updatedPrice = await db.partyItemPrices.get(
    priceKey(party.id, item.id),
  );
  assert.equal(updatedPrice?.lastPrice, 350);
  assert.equal(updatedPrice?.timesSold, 14);

  const currentParty = await db.parties.get(party.id);
  assert.ok(currentParty);
  await recordPayment(currentParty, 500, "cash", "offline-test");
  const ordered = await db.invoices
    .where("partyId")
    .equals(party.id)
    .sortBy("date");
  assert.equal((await db.invoices.get(bills[0].id))?.amountDue, 0);
  assert.equal(
    ordered.reduce((sum, bill) => sum + bill.amountDue, 0),
    calculateBill([line], 0).grandTotal * 5 - 500,
  );

  await db.delete();
});

test("a locked party price does not auto-update from a negotiated one-off bill", async () => {
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-kolkata-balloon");
  const item = await db.items.get("i-balloon-pack");
  assert.ok(party && item);
  await saveSale({
    party,
    lines: [
      {
        itemId: item.id,
        itemName: item.name,
        skuCode: item.skuCode,
        hsnCode: item.hsnCode || "",
        qty: 1,
        unit: "packet",
        rate: 90,
        discount: 0,
        taxableAmount: 0,
        gstRate: 0,
        gstAmount: 0,
        amount: 0,
        lockPrice: true,
      },
    ],
    paid: 0,
    paymentMode: "credit",
  });
  const price = await db.partyItemPrices.get(priceKey(party.id, item.id));
  assert.equal(price?.lastPrice, 95);
  assert.equal(price?.lockedPrice, true);
  await db.delete();
});

test("payment modes, GST snapshot and Indian money formatting are correct", async () => {
  await db.open();
  await seedIfNeeded();
  await db.parties.update("p-ramesh", { gstin: "19ABCDE1234F1Z5" });
  const party = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(party && item);
  const line: InvoiceLine = {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: item.hsnCode || "",
    qty: 1,
    unit: "dozen",
    baseUnit: "dozen",
    rate: 350,
    discount: 0,
    taxableAmount: 0,
    gstRate: 5,
    gstAmount: 0,
    amount: 0,
  };
  const cash = await saveSale({
    party,
    lines: [line],
    paid: 0,
    paymentMode: "cash",
  });
  assert.equal(cash.amountDue, 0);
  assert.equal(cash.amountPaid, cash.grandTotal);
  assert.equal(cash.paymentMode, "cash");
  assert.equal(cash.partyGstin, "19ABCDE1234F1Z5");
  const partial = await saveSale({
    party: await db.parties.get(party.id),
    lines: [line],
    paid: 100,
    paymentMode: "upi",
  });
  assert.equal(partial.paymentMode, "mixed");
  assert.equal(partial.amountPaid, 100);
  assert.match(formatMoney(125000).replace(/\s/g, ""), /^₹1,25,000(?:\.00)?$/);
  await db.delete();
});

test("a ten-thousand bill with five-thousand received adds exactly five-thousand to customer Dues", async () => {
  await db.open();
  await seedIfNeeded();
  const party = await createQuickParty(
    "Part Payment Test Customer",
    "9000000011",
    "PART-5000",
    "Burrabazar, Kolkata",
  );
  const item = await db.items.get("i-mm12-red");
  assert.ok(item);
  const line: InvoiceLine = {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: item.hsnCode || "",
    qty: 1,
    unit: "dozen",
    baseUnit: "dozen",
    rate: 10000,
    discount: 0,
    taxableAmount: 0,
    gstRate: 0,
    gstAmount: 0,
    amount: 0,
  };
  const invoice = await saveSale({
    party,
    lines: [line],
    paid: 5000,
    paymentMode: "upi",
    paymentPlan: "partial",
  });
  const afterSale = await db.parties.get(party.id);
  assert.equal(invoice.grandTotal, 10000);
  assert.equal(invoice.amountPaid, 5000);
  assert.equal(invoice.amountDue, 5000);
  assert.equal(invoice.paymentMode, "mixed");
  assert.equal(invoice.paymentReceivedMode, "upi");
  assert.equal(afterSale?.currentBalance, 5000);
  const invoicesAfterSale = await db.invoices.toArray();
  const dueAfterSale = dueCustomerRows(
    await db.parties.toArray(),
    await db.payments.toArray(),
    "PART-5000",
    invoicesAfterSale,
  )[0];
  assert.equal(dueAfterSale?.party.id, party.id);
  assert.deepEqual(
    {
      amount: dueAfterSale?.lastPayment?.amount,
      mode: dueAfterSale?.lastPayment?.mode,
    },
    { amount: 5000, mode: "upi" },
  );
  assert.deepEqual(
    customerPaymentHistory(afterSale!, invoicesAfterSale, [], []).map(
      (row) => ({
        amount: row.payment.amount,
        mode: row.payment.mode,
        remaining: row.remainingBalance,
      }),
    ),
    [{ amount: 5000, mode: "upi", remaining: 5000 }],
  );
  await recordPayment(afterSale!, 2000, "cash", "later-payment");
  assert.equal((await db.parties.get(party.id))?.currentBalance, 3000);
  assert.equal((await db.invoices.get(invoice.id))?.amountDue, 3000);
  const currentParty = await db.parties.get(party.id);
  const allPayments = await db.payments.toArray();
  const currentInvoices = await db.invoices.toArray();
  assert.deepEqual(
    customerPaymentHistory(currentParty!, currentInvoices, allPayments, []).map(
      (row) => ({
        amount: row.payment.amount,
        mode: row.payment.mode,
        remaining: row.remainingBalance,
      }),
    ),
    [
      { amount: 2000, mode: "cash", remaining: 3000 },
      { amount: 5000, mode: "upi", remaining: 5000 },
    ],
  );
  assert.equal(
    dueCustomerRows(
      await db.parties.toArray(),
      allPayments,
      "PART-5000",
      currentInvoices,
    )[0]?.lastPayment?.reference,
    "later-payment",
  );
  await assert.rejects(
    () =>
      saveSale({
        party: currentParty,
        lines: [line],
        paid: 0,
        paymentMode: "cash",
        paymentPlan: "partial",
      }),
    /amount received/,
  );
  await assert.rejects(
    () =>
      saveSale({
        party: currentParty,
        lines: [line],
        paid: 10000,
        paymentMode: "cash",
        paymentPlan: "partial",
      }),
    /less than the final total/,
  );
  const cloud = memorySupabase();
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal(
    cloud.rows("invoices").find((row) => row.id === invoice.id)
      ?.payment_received_mode,
    "upi",
  );
  await db.delete();
});

test("unit changes preserve value and remembered party prices stay in the base unit", async () => {
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(party && item);
  assert.equal(convertUnitRate(350, "dozen", "gross"), 4200);
  assert.equal(convertUnitRate(4200, "gross", "dozen"), 350);
  await saveSale({
    party,
    lines: [
      {
        itemId: item.id,
        itemName: item.name,
        skuCode: item.skuCode,
        hsnCode: item.hsnCode || "",
        qty: 1,
        unit: "gross",
        baseUnit: "dozen",
        rate: 4200,
        discount: 0,
        taxableAmount: 0,
        gstRate: 5,
        gstAmount: 0,
        amount: 0,
      },
    ],
    paid: 0,
    paymentMode: "credit",
  });
  const remembered = await db.partyItemPrices.get(priceKey(party.id, item.id));
  assert.equal(remembered?.lastPrice, 350);
  await db.delete();
});

test("payments reject overpayment and invalid manual allocation without changing balances", async () => {
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(party && item);
  const invoice = await saveSale({
    party,
    lines: [
      {
        itemId: item.id,
        itemName: item.name,
        skuCode: item.skuCode,
        hsnCode: item.hsnCode || "",
        qty: 1,
        unit: "dozen",
        baseUnit: "dozen",
        rate: 350,
        discount: 0,
        taxableAmount: 0,
        gstRate: 5,
        gstAmount: 0,
        amount: 0,
      },
    ],
    paid: 0,
    paymentMode: "credit",
  });
  await saveSale({
    party: await db.parties.get(party.id),
    lines: [
      {
        itemId: item.id,
        itemName: item.name,
        skuCode: item.skuCode,
        hsnCode: item.hsnCode || "",
        qty: 1,
        unit: "dozen",
        baseUnit: "dozen",
        rate: 350,
        discount: 0,
        taxableAmount: 0,
        gstRate: 5,
        gstAmount: 0,
        amount: 0,
      },
    ],
    paid: 0,
    paymentMode: "credit",
  });
  const before = await db.parties.get(party.id);
  assert.ok(before);
  await assert.rejects(
    () => recordPayment(before, before.currentBalance + 1, "cash", "too-much"),
    /cannot exceed/,
  );
  await assert.rejects(
    () =>
      recordPayment(before, invoice.amountDue + 1, "cash", "manual", [
        invoice.id,
      ]),
    /Selected bills/,
  );
  assert.equal(
    (await db.parties.get(party.id))?.currentBalance,
    before.currentBalance,
  );
  assert.equal(await db.payments.count(), 0);
  await db.delete();
});

test("payments and expenses reject positive inputs that round below one paisa", async () => {
  await db.delete();
  await db.open();
  const party = await createParty({
    name: "Sub-cent Guard",
    type: "customer",
    openingBalance: 1,
  });
  await assert.rejects(
    () => recordPayment(party, 0.004, "cash", "too small"),
    /at least ₹0\.01/,
  );
  await assert.rejects(
    () =>
      recordExpense({
        category: "other",
        amount: 0.004,
        paymentMode: "cash",
      }),
    /at least ₹0\.01/,
  );
  assert.equal(await db.payments.count(), 0);
  assert.equal(await db.expenses.count(), 0);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 1);
  await db.delete();
});

test("sale and payment balance updates use the latest stored party balance", async () => {
  await db.open();
  await seedIfNeeded();
  const staleParty = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(staleParty && item);
  await db.parties.update(staleParty.id, { currentBalance: 5000 });
  const invoice = await saveSale({
    party: staleParty,
    lines: [
      {
        itemId: item.id,
        itemName: item.name,
        skuCode: item.skuCode,
        hsnCode: item.hsnCode || "",
        qty: 1,
        unit: "dozen",
        baseUnit: "dozen",
        rate: 350,
        discount: 0,
        taxableAmount: 0,
        gstRate: 5,
        gstAmount: 0,
        amount: 0,
      },
    ],
    paid: 0,
    paymentMode: "credit",
  });
  assert.equal(
    (await db.parties.get(staleParty.id))?.currentBalance,
    5000 + invoice.amountDue,
  );
  await db.delete();
});

test("invoice numbering preserves an existing legacy device code", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  await db.meta.put({ key: "invoice-device-code", value: "AB12" });
  const quotation = await saveQuotation({ lines: [sampleInvoiceLine()] });
  assert.match(quotation.invoiceNumber, /^QT-\d{4}-\d{2}-AB12-\d+$/);
  assert.equal((await db.meta.get("invoice-device-code"))?.value, "AB12");
  await db.delete();
});

test("advanced reports calculate daily, party, profit, aging, dead stock, top revenue and low-rate flags", () => {
  const stamp = "2026-08-08T10:00:00.000Z";
  const parties: Party[] = [
    {
      id: "party-a",
      name: "A Decorators",
      codeName: "A-DEC",
      phone: "",
      address: "",
      type: "customer",
      priceTier: "wholesale",
      openingBalance: 0,
      currentBalance: 400,
      notes: "",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: stamp,
      isSynced: false,
    },
    {
      id: "party-b",
      name: "B Traders",
      codeName: "B-TRADE",
      phone: "",
      address: "",
      type: "customer",
      priceTier: "wholesale",
      openingBalance: 0,
      currentBalance: 400,
      notes: "",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: stamp,
      isSynced: false,
    },
  ];
  const item = (id: string, name: string, purchasePrice: number): Item => ({
    id,
    name,
    nameHi: "",
    nameBn: "",
    skuCode: id.toUpperCase(),
    categoryId: "cat",
    baseUnit: "piece",
    conversionRate: 1,
    purchasePrice,
    priceRetail: 0,
    priceWholesale: 0,
    priceBulk: 0,
    currentStock: null,
    lowStockAlert: null,
    festivalTags: [],
    gstRate: 0,
    isActive: true,
    saleCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
    isSynced: false,
  });
  const items = [
    item("item-1", "Moti Mala", 100),
    item("item-2", "Toran", 0),
    item("item-never", "Unsold Stock", 80),
  ];
  const sale = (
    id: string,
    date: string,
    party: Party,
    itemId: string,
    rate: number,
    qty: number,
    due: number,
  ): Invoice => {
    const line: InvoiceLine = {
      itemId,
      itemName: items.find((entry) => entry.id === itemId)!.name,
      skuCode: itemId.toUpperCase(),
      hsnCode: "",
      qty,
      unit: "piece",
      baseUnit: "piece",
      rate,
      discount: 0,
      taxableAmount: rate * qty,
      gstRate: 0,
      gstAmount: 0,
      amount: rate * qty,
    };
    return {
      id,
      invoiceNumber: `INV-${id}`,
      partyId: party.id,
      partyName: party.name,
      date,
      type: "sale",
      lineItems: [line],
      subtotal: rate * qty,
      discountTotal: 0,
      gstTotal: 0,
      otherCharges: [],
      otherChargesTotal: 0,
      roundOff: 0,
      grandTotal: rate * qty,
      amountPaid: rate * qty - due,
      amountDue: due,
      paymentMode: due ? "credit" : "cash",
      notes: "",
      isSynced: false,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: `${date}T10:00:00.000Z`,
    };
  };
  const invoices = [
    sale("a-new", "2026-08-08", parties[0], "item-1", 150, 1, 100),
    sale("b-mid", "2026-07-01", parties[1], "item-1", 200, 2, 400),
    sale("a-old", "2026-05-01", parties[0], "item-2", 50, 1, 0),
  ];
  const manualEntries: AccountEntry[] = [
    {
      id: "manual-a",
      partyId: "party-a",
      kind: "due",
      amount: 300,
      date: "2026-01-01",
      note: "Opening goods",
      reference: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: stamp,
      isSynced: false,
    },
  ];

  assert.deepEqual(
    buildDailySalesReport(invoices).map((row) => [row.date, row.revenue]),
    [
      ["2026-08-08", 150],
      ["2026-07-01", 400],
      ["2026-05-01", 50],
    ],
  );
  assert.deepEqual(
    buildPartySalesReport(invoices, parties).map((row) => [
      row.partyName,
      row.revenue,
    ]),
    [
      ["B Traders", 400],
      ["A Decorators", 200],
    ],
  );
  const profit = buildItemProfitReport(invoices, items);
  assert.deepEqual(
    {
      revenue: profit[0].revenueBeforeGst,
      cost: profit[0].cost,
      profit: profit[0].profit,
    },
    { revenue: 550, cost: 300, profit: 250 },
  );
  assert.equal(profit.find((row) => row.itemId === "item-2")?.profit, null);
  const aging = buildReceivablesAging({
    invoices,
    parties,
    accountEntries: manualEntries,
    asOfDate: "2026-08-08",
  });
  assert.deepEqual(aging.totals, {
    "0-30": 100,
    "30-60": 400,
    "60+": 300,
    total: 800,
  });
  assert.deepEqual(
    buildDeadStockReport(invoices, items, "2026-08-08").map(
      (row) => row.itemId,
    ),
    ["item-never", "item-2", "item-1"],
  );
  assert.ok(buildDeadStockReport(invoices, items, "2026-08-08").every((row) => row.stockState === "unknown"));
  const unknownCostStock = {
    ...item("item-unknown-cost", "Unknown Cost Stock", 0),
    currentStock: 12,
  };
  assert.equal(
    buildDeadStockReport([], [unknownCostStock], "2026-08-08")[0]
      .stockValue,
    null,
  );
  assert.deepEqual(
    buildTopRevenueItems(invoices, items).map((row) => [
      row.itemId,
      row.revenue,
    ]),
    [
      ["item-1", 550],
      ["item-2", 50],
    ],
  );
  const margin = buildMarginByPartyReport(invoices, items, parties, {}, 10);
  assert.equal(margin.length, 1);
  assert.deepEqual(
    {
      party: margin[0].partyId,
      flagged: margin[0].flaggedItems,
      gap: margin[0].comparisons[0].gapPercent,
    },
    { party: "party-a", flagged: 1, gap: 25 },
  );
});

test("a quotation changes no balances until one-tap conversion and conversion is idempotent", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  const item = await db.items.get("i-mm12-red");
  assert.ok(party && item);
  const balanceBefore = party.currentBalance;
  const saleCountBefore = item.saleCount;
  const rememberedBefore = await db.partyItemPrices.get(
    priceKey(party.id, item.id),
  );
  const line: InvoiceLine = {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: item.hsnCode || "",
    qty: 2,
    unit: "dozen",
    baseUnit: "dozen",
    rate: 333,
    discount: 0,
    taxableAmount: 0,
    gstRate: 18,
    gstAmount: 0,
    amount: 0,
  };
  const quotation = await saveQuotation({
    party,
    lines: [line],
    otherCharges: [{ code: "packing", label: "Packing charge", amount: 20 }],
  });
  assert.equal(quotation.type, "quotation");
  assert.match(quotation.invoiceNumber, /^QT-/);
  assert.equal((await db.parties.get(party.id))?.currentBalance, balanceBefore);
  assert.equal((await db.items.get(item.id))?.saleCount, saleCountBefore);
  assert.equal(
    (await db.partyItemPrices.get(priceKey(party.id, item.id)))?.lastPrice,
    rememberedBefore?.lastPrice,
  );

  const counterBefore = Number((await db.meta.get("invoice-counter"))?.value);
  await assert.rejects(
    () => convertQuotationToInvoice("missing-quotation"),
    /no longer available/,
  );
  assert.equal(
    Number((await db.meta.get("invoice-counter"))?.value),
    counterBefore,
  );
  const invoice = await convertQuotationToInvoice(quotation.id);
  const counterAfterConversion = Number(
    (await db.meta.get("invoice-counter"))?.value,
  );
  assert.equal(counterAfterConversion, counterBefore + 1);
  assert.equal(invoice.type, "sale");
  assert.match(invoice.invoiceNumber, /^MB-/);
  assert.equal(invoice.amountDue, invoice.grandTotal);
  assert.equal(
    (await db.parties.get(party.id))?.currentBalance,
    balanceBefore + invoice.amountDue,
  );
  assert.equal((await db.items.get(item.id))?.saleCount, saleCountBefore + 1);
  assert.equal(
    (await db.partyItemPrices.get(priceKey(party.id, item.id)))?.lastPrice,
    333,
  );
  const storedQuotation = await db.invoices.get(quotation.id);
  assert.ok(storedQuotation);
  assert.equal(convertedInvoiceId(storedQuotation), invoice.id);
  const retried = await convertQuotationToInvoice(quotation.id);
  assert.equal(retried.id, invoice.id);
  assert.equal(
    Number((await db.meta.get("invoice-counter"))?.value),
    counterAfterConversion,
  );
  assert.equal(await db.invoices.where("type").equals("sale").count(), 1);
  await db.delete();
});

test("legacy quotations without an initial-payment snapshot remain cloud-syncable", async () => {
  await db.delete();
  await db.open();
  const party = await createParty({ name: "Legacy Quote Buyer", type: "customer" });
  const quotation = await saveQuotation({
    party,
    lines: [{ ...sampleInvoiceLine(), rate: 125, gstRate: 0 }],
  });
  await db.invoices.update(quotation.id, {
    initialAmountPaid: undefined,
    isSynced: false,
  });
  const cloud = memorySupabase();
  assert.equal(await syncWithClient(cloud.client), "synced");
  const remote = cloud.rows("invoices").find((row) => row.id === quotation.id);
  assert.equal(remote?.initial_amount_paid, 0);
  assert.equal(remote?.amount_paid, 0);
  await db.delete();
});

test("the selected-tier catalogue produces a readable multi-page A4 PDF", async () => {
  assert.equal(cataloguePrice(sampleItems[0], "wholesale"), 280);
  assert.equal(cataloguePrice(sampleItems[0], "retail"), 350);
  assert.equal(cataloguePrice(sampleItems[0], "bulk"), 280);
  const doc = await cataloguePdf(sampleItems, "wholesale", {
    name: "Midori Kanjo Decorations",
    address: "Burrabazar, Kolkata",
    phone: "9000000000",
    gstin: "19ABCDE1234F1Z5",
  });
  assert.ok(Math.abs(doc.internal.pageSize.getWidth() - 210) < 1);
  assert.ok(doc.getNumberOfPages() >= 2);
  assert.ok(doc.output("arraybuffer").byteLength > 5000);
});

test("owner PIN is PBKDF2-protected, verifies correctly and never stores plaintext", async () => {
  await db.delete();
  await db.open();
  await setOwnerPin("4826");
  assert.equal(await ownerPinConfigured(), true);
  assert.equal(await verifyOwnerPin("4826"), true);
  assert.equal(await verifyOwnerPin("4827"), false);
  const saved = String((await db.meta.get("owner-pin-sha256-v1"))?.value || "");
  assert.doesNotMatch(saved, /4826/);
  assert.match(saved, /"iterations":120000/);
  await db.delete();
});

test("owner PIN lockout survives caller remounts", async () => {
  await db.delete();
  await db.open();
  await setOwnerPin("5931");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await verifyOwnerPin("0000"), false);
  }
  const lockout = JSON.parse(
    String((await db.meta.get("owner-pin-lockout-v1"))?.value || "{}"),
  ) as { failures?: number; lockedUntil?: number };
  assert.equal(lockout.failures, 5);
  assert.ok(Number(lockout.lockedUntil) > Date.now());

  db.close();
  await db.open();
  await assert.rejects(
    () => verifyOwnerPin("5931"),
    /Owner PIN is temporarily locked/,
  );
  await db.delete();
});

test("portable PBKDF2 fallback matches standard SHA-256 vectors", () => {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  assert.equal(hex(pbkdf2Sha256Fallback("password", "salt", 1)), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
  assert.equal(hex(pbkdf2Sha256Fallback("password", "salt", 2)), "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
});

test("automatic bill drafts restore every counter field and tolerate cleanup", async () => {
  await db.delete();
  await db.open();
  const line = { ...sampleInvoiceLine(), qty: 6, rate: 333, gstRate: 18 };
  await saveBillDraft({
    draftId: "draft-crash-test",
    customerDraft: {
      name: "Walk-in Draft Buyer",
      phone: "9000000033",
      address: "New Market",
    },
    lines: [line],
    paid: 500,
    paymentMode: "upi",
    splitPayment: true,
    paymentBreakdown: [
      { mode: "cash", amount: 200 },
      { mode: "upi", amount: 300, reference: "UPI-DRAFT" },
    ],
    paymentPlan: "partial",
    documentType: "sale",
    gstEnabled: true,
    gstRate: 18,
    otherCharges: [{ code: "packing", label: "Packing", amount: 25, enabled: true }],
  });
  const restored = await loadBillDraft();
  assert.equal(restored?.draftId, "draft-crash-test");
  assert.equal(restored?.lines[0].rate, 333);
  assert.equal(restored?.paymentPlan, "partial");
  assert.equal(restored?.customerDraft?.name, "Walk-in Draft Buyer");
  assert.equal(restored?.splitPayment, true);
  assert.equal(restored?.paymentBreakdown?.[1].reference, "UPI-DRAFT");
  assert.equal(restored?.otherCharges[0].amount, 25);

  await db.meta.put({
    key: "bill-draft-v1",
    value: JSON.stringify({
      version: 1,
      draftId: "stale-split-draft",
      savedAt: "2026-08-10T12:00:00.000Z",
      lines: [line],
      paid: 999,
      paymentMode: "wire",
      splitPayment: true,
      paymentBreakdown: [
        { mode: "cash", amount: 33.333 },
        { mode: "upi", amount: 66.667, reference: "  UPI-RESTORED  " },
        { mode: "upi", amount: 1 },
        { mode: "crypto", amount: 25 },
        null,
      ],
      paymentPlan: "full",
      documentType: "sale",
      gstEnabled: true,
      gstRate: 18,
      otherCharges: [],
    }),
  });
  const repaired = await loadBillDraft();
  assert.equal(repaired?.paymentMode, "cash");
  assert.equal(repaired?.paid, 100);
  assert.deepEqual(repaired?.paymentBreakdown, [
    { mode: "cash", amount: 33.33 },
    { mode: "upi", amount: 66.67, reference: "UPI-RESTORED" },
  ]);
  await clearBillDraft();
  assert.equal(await loadBillDraft(), null);
  await db.delete();
});

function sampleInvoiceLine(): InvoiceLine {
  const item = sampleItems[0];
  return {
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    hsnCode: item.hsnCode || "",
    qty: 1,
    unit: item.baseUnit,
    baseUnit: item.baseUnit,
    rate: item.priceWholesale,
    discount: 0,
    taxableAmount: 0,
    gstRate: 18,
    gstAmount: 0,
    amount: 0,
  };
}

test("ordinary sales deduct known stock, allow negatives, and never block unknown stock", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const item = (await db.items.get(sampleItems[0].id))!;
  await db.items.update(item.id, { currentStock: 0, updatedAt: new Date().toISOString(), isSynced: false });
  const knownLines = [{ ...sampleInvoiceLine(), qty: 2 }];
  const knownSale = await saveSale({
    lines: knownLines,
    paid: calculateBill(knownLines, 0).grandTotal,
    paymentMode: "cash",
  });
  assert.equal((await db.items.get(item.id))?.currentStock, -2);
  const knownMovement = await db.stockMovements.get(`sale:${knownSale.id}:0`);
  assert.equal(knownMovement?.applied, true);
  assert.equal(knownMovement?.qtyChange, -2);

  await db.items.update(item.id, { currentStock: null, updatedAt: new Date().toISOString(), isSynced: false });
  const unknownLines = [sampleInvoiceLine()];
  const unknownSale = await saveSale({
    lines: unknownLines,
    paid: calculateBill(unknownLines, 0).grandTotal,
    paymentMode: "cash",
  });
  assert.equal((await db.items.get(item.id))?.currentStock, null);
  const unknownMovement = await db.stockMovements.get(`sale:${unknownSale.id}:0`);
  assert.equal(unknownMovement?.applied, false);
  assert.equal(unknownMovement?.stockAfter, null);
  await db.delete();
});

test("unknown inward stays unknown until an Owner starts from zero", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const item = (await db.items.get(sampleItems[0].id))!;
  await db.items.update(item.id, { currentStock: null, updatedAt: new Date().toISOString(), isSynced: false });
  const logged = await recordStockInward({ itemId: item.id, quantity: 3, unit: item.baseUnit });
  assert.equal(logged.applied, false);
  assert.equal((await db.items.get(item.id))?.currentStock, null);
  await assert.rejects(
    recordStockInward({ itemId: item.id, quantity: 3, unit: item.baseUnit, startFromZero: true, actor: "staff" }),
    /Owner unlock/,
  );
  const initialized = await recordStockInward({ itemId: item.id, quantity: 3, unit: item.baseUnit, startFromZero: true, actor: "owner" });
  assert.equal(initialized.stockBefore, 0);
  assert.equal(initialized.stockAfter, 3);
  assert.equal((await db.items.get(item.id))?.currentStock, 3);
  await db.delete();
});

test("manual inventory commands follow merged aliases and are idempotent", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const source = (await db.items.get("i-mm12-red"))!;
  const target = (await db.items.get("i-mm12-gold"))!;
  await db.items.update(source.id, { currentStock: 4, updatedAt: new Date().toISOString(), isSynced: false });
  await db.items.update(target.id, { currentStock: 6, updatedAt: new Date().toISOString(), isSynced: false });
  await mergeItems(source.id, target.id);

  await recordStockInward({ operationId: "alias-inward", itemId: source.id, quantity: 1, unit: source.baseUnit });
  await recordStockInward({ operationId: "alias-inward", itemId: source.id, quantity: 1, unit: source.baseUnit });
  assert.equal((await db.items.get(target.id))?.currentStock, 11);

  await recordStockOutward({ operationId: "alias-outward", itemId: source.id, quantity: 1, unit: source.baseUnit, reason: "damage" });
  await recordStockOutward({ operationId: "alias-outward", itemId: source.id, quantity: 1, unit: source.baseUnit, reason: "damage" });
  assert.equal((await db.items.get(target.id))?.currentStock, 10);

  await setStockAbsolute({ operationId: "alias-adjust", itemId: source.id, actualStock: 7, reason: "Verified count", actor: "owner" });
  await setStockAbsolute({ operationId: "alias-adjust", itemId: source.id, actualStock: 7, reason: "Verified count", actor: "owner" });
  assert.equal((await db.items.get(source.id))?.currentStock, 4);
  assert.equal((await db.items.get(target.id))?.currentStock, 7);
  assert.equal(await db.stockMovements.where("id").anyOf("alias-inward", "alias-outward", "alias-adjust").count(), 3);
  await reconcileInventoryStock();
  assert.equal((await db.items.get(target.id))?.currentStock, 7);
  await db.delete();
});

test("returns apply outstanding balance first and settle excess immediately without negative balances", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const customer = await createParty({ name: "Return Buyer", type: "customer", openingBalance: 100 });
  const item = (await db.items.get(sampleItems[0].id))!;
  await db.items.update(item.id, { currentStock: 5, updatedAt: new Date().toISOString(), isSynced: false });
  const returned = await recordInventoryReturn({
    type: "sale_return",
    partyId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unit: item.baseUnit, rate: 200, gstRate: 0 }],
    settlementMode: "cash",
    idempotencyKey: "return-excess-test",
  });
  assert.deepEqual(returned.returnDetails, {
    allocations: [],
    balanceApplied: 100,
    settlementAmount: 100,
  });
  assert.equal(returned.initialAmountPaid, 100);
  assert.equal(returned.amountPaid, 100);
  assert.equal(returned.amountDue, 0);
  assert.equal((await db.parties.get(customer.id))?.currentBalance, 0);
  assert.equal((await db.items.get(item.id))?.currentStock, 6);
  assert.equal((await db.payments.where("partyId").equals(customer.id).count()), 0);
  const retried = await recordInventoryReturn({
    type: "sale_return",
    partyId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unit: item.baseUnit, rate: 200, gstRate: 0 }],
    idempotencyKey: "return-excess-test",
  });
  assert.equal(retried.id, returned.id);
  assert.equal((await db.stockMovements.where("refInvoiceId").equals(returned.id).count()), 1);
  await reconcilePartyBalances();
  assert.equal((await db.parties.get(customer.id))?.currentBalance, 0);
  await db.delete();
});

test("inventory operations replay chronologically and preserve backdated entries", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const item = (await db.items.get(sampleItems[0].id))!;
  await setStockAbsolute({ itemId: item.id, actualStock: 10, reason: "Opening count", actor: "owner" });
  await recordStockInward({ itemId: item.id, quantity: 2, unit: item.baseUnit, date: "2025-01-01" });
  await recordStockOutward({ itemId: item.id, quantity: 1, unit: item.baseUnit, reason: "damage", date: "2025-01-02" });
  assert.equal((await db.items.get(item.id))?.currentStock, 11);
  await reconcileInventoryStock();
  assert.equal((await db.items.get(item.id))?.currentStock, 11);
  await db.delete();
});

test("repeated sale delete and restore cycles create fresh compensating stock movements", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const item = (await db.items.get(sampleItems[0].id))!;
  const customer = await createParty({ name: "Lifecycle Buyer", type: "customer" });
  await db.items.update(item.id, { currentStock: 10, updatedAt: new Date().toISOString(), isSynced: false });
  const invoice = await saveSale({ party: customer, lines: [sampleInvoiceLine()], paid: 0, paymentMode: "credit" });
  assert.equal((await db.items.get(item.id))?.currentStock, 9);
  await softDeleteInvoice(invoice.id);
  assert.equal((await db.items.get(item.id))?.currentStock, 10);
  await restoreInvoice(invoice.id);
  assert.equal((await db.items.get(item.id))?.currentStock, 9);
  await softDeleteInvoice(invoice.id);
  assert.equal((await db.items.get(item.id))?.currentStock, 10);
  await restoreInvoice(invoice.id);
  assert.equal((await db.items.get(item.id))?.currentStock, 9);
  const lifecycle = await db.stockMovements.where("refInvoiceId").equals(invoice.id).toArray();
  assert.equal(lifecycle.filter((movement) => movement.kind === "sale_void").length, 2);
  assert.equal(lifecycle.filter((movement) => movement.kind === "sale_restore").length, 2);
  await db.delete();
});

test("physical counts pause, resume, review without writes, and commit zero atomically", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const category = sampleCategories.find((entry) => entry.id === sampleItems[0].categoryId)!;
  const session = await startCountSession(category.id);
  const resumed = await startCountSession(category.id);
  assert.equal(resumed.id, session.id);
  const lines = await db.countLines.where("sessionId").equals(session.id).toArray();
  for (const line of lines) await saveCountedStock(session.id, line.itemId, 0);
  const beforeReview = await db.items.bulkGet(lines.map((line) => line.itemId));
  const reviewed = await reviewCountSession(session.id);
  assert.equal(reviewed.counted, reviewed.total);
  assert.deepEqual(await db.items.bulkGet(lines.map((line) => line.itemId)), beforeReview);
  await commitCountSession(session.id, reviewed.rows.map((row) => ({ itemId: row.line.itemId, systemStock: row.systemStock })), "owner");
  assert.equal((await db.countSessions.get(session.id))?.status, "completed");
  for (const line of lines) assert.equal((await db.items.get(line.itemId))?.currentStock, 0);
  const movementCount = await db.stockMovements.where("countSessionId").equals(session.id).count();
  await commitCountSession(session.id, reviewed.rows.map((row) => ({ itemId: row.line.itemId, systemStock: row.systemStock })), "owner");
  assert.equal(await db.stockMovements.where("countSessionId").equals(session.id).count(), movementCount);
  await db.delete();
});

test("low-stock alerts are opt-in and valuation flags missing cost and unknown stock", () => {
  const base = sampleItems[0];
  const rows: Item[] = [
    { ...base, id: "known-low", currentStock: 2, lowStockAlert: 3, purchasePrice: 10 },
    { ...base, id: "known-off", currentStock: 0, lowStockAlert: null, purchasePrice: 0 },
    { ...base, id: "unknown-alert", currentStock: null, lowStockAlert: 3, purchasePrice: 10 },
    { ...base, id: "missing-cost", currentStock: 4, lowStockAlert: null, purchasePrice: 0 },
  ];
  assert.deepEqual(lowStockItems(rows).map((item) => item.id), ["known-low"]);
  const valuation = buildInventoryValuation(rows);
  assert.equal(valuation.unknownStockCount, 1);
  assert.equal(valuation.missingCostCount, 2);
  assert.equal(valuation.totalValue, 20);
});

test("inventory audit tables and return settlement survive a full cloud round trip with null and zero intact", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const cloud = memorySupabase();
  const item = (await db.items.get(sampleItems[0].id))!;
  await db.items.update(item.id, { currentStock: null, updatedAt: new Date().toISOString(), isSynced: false });
  await recordStockInward({ itemId: item.id, quantity: 3, unit: item.baseUnit, startFromZero: true, actor: "owner" });
  const category = (await db.categories.get(item.categoryId))!;
  const session = await startCountSession(category.id);
  const firstLine = (await db.countLines.where("sessionId").equals(session.id).first())!;
  await saveCountedStock(session.id, firstLine.itemId, 0);
  const customer = await createParty({ name: "Cloud Return Buyer", type: "customer", openingBalance: 10 });
  const returned = await recordInventoryReturn({
    type: "sale_return",
    partyId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unit: item.baseUnit, rate: 20, gstRate: 0 }],
    idempotencyKey: "cloud-return-test",
  });

  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal((await pendingCount()), 0);
  assert.ok(cloud.rows("categories").length >= 1);
  assert.ok(cloud.rows("stock_movements").length >= 2);
  assert.equal(cloud.rows("count_sessions").length, 1);
  assert.equal(cloud.rows("count_session_lines").find((row) => row.id === firstLine.id)?.counted_stock, 0);
  assert.deepEqual(cloud.rows("invoices").find((row) => row.id === returned.id)?.return_details, returned.returnDetails);
  for (const table of ["categories", "stock_movements", "count_sessions", "count_session_lines"]) {
    for (const row of cloud.rows(table)) {
      assert.equal(row.business_id, "7bdebe348faeda556a3005c310de23f8744f21cd7a0b3c9d8a745ef85695219a");
      assert.notEqual(row.business_id, "test-business-sync-code-1234567890");
    }
  }

  await db.transaction("rw", [db.stockMovements, db.countLines, db.countSessions, db.partyItemPrices, db.payments, db.accountEntries, db.expenses, db.invoices, db.items, db.parties, db.categories], async () => {
    await db.stockMovements.clear();
    await db.countLines.clear();
    await db.countSessions.clear();
    await db.partyItemPrices.clear();
    await db.payments.clear();
    await db.accountEntries.clear();
    await db.expenses.clear();
    await db.invoices.clear();
    await db.items.clear();
    await db.parties.clear();
    await db.categories.clear();
  });
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal((await db.countLines.get(firstLine.id))?.countedStock, 0);
  assert.equal((await db.items.get(item.id))?.currentStock, 4);
  assert.deepEqual((await db.invoices.get(returned.id))?.returnDetails, returned.returnDetails);
  assert.equal((await db.parties.get(customer.id))?.currentBalance, 0);
  await db.delete();
});

test("same-stock Phase 2 baselines converge across replica-local upgrade clocks", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const cloud = memorySupabase();
  const item = (await db.items.get(sampleItems[0].id))!;
  const localCreatedAt = "2026-08-10T08:00:00.001Z";
  await db.items.update(item.id, { currentStock: 9, updatedAt: localCreatedAt, isSynced: false });
  await db.stockMovements.put({
    id: `baseline:${item.id}`,
    itemId: item.id,
    kind: "baseline",
    reason: "phase2_baseline",
    note: "Opening tracked stock at Phase 2 upgrade",
    qtyChange: null,
    stockBefore: null,
    stockAfter: 9,
    applied: true,
    date: "2026-08-10",
    actor: "owner",
    createdAt: localCreatedAt,
    updatedAt: localCreatedAt,
    isSynced: false,
  });
  assert.equal(await syncWithClient(cloud.client), "synced");

  const remote = cloud.rows("stock_movements").find((row) => row.id === `baseline:${item.id}`)!;
  const remoteCreatedAt = "2026-08-09T22:30:00.001Z";
  cloud.setRow("stock_movements", {
    ...remote,
    date: "2026-08-09",
    created_at: remoteCreatedAt,
    updated_at: remoteCreatedAt,
  });
  await db.stockMovements.update(`baseline:${item.id}`, {
    date: "2026-08-10",
    createdAt: localCreatedAt,
    updatedAt: localCreatedAt,
    isSynced: false,
  });

  assert.equal(await syncWithClient(cloud.client), "synced");
  const converged = await db.stockMovements.get(`baseline:${item.id}`);
  assert.equal(converged?.createdAt, remoteCreatedAt);
  assert.equal(converged?.stockAfter, 9);
  assert.equal(converged?.isSynced, true);
  await db.delete();
});

test("ordinary customers can stay code-less while entered trade codes remain unique", async () => {
  await db.delete();
  await db.open();
  const first = await createParty({ name: "Daily Buyer One", type: "customer" });
  const second = await createParty({ name: "Daily Buyer Two", type: "customer" });
  assert.equal(first.codeName, "");
  assert.equal(second.codeName, "");
  const trade = await createParty({
    name: "Large Trade Buyer",
    codeName: "LARGE-01",
    type: "customer",
  });
  assert.equal(trade.codeName, "LARGE-01");
  await assert.rejects(
    () => createParty({ name: "Duplicate Trade Code", codeName: "large-01", type: "customer" }),
    /already used/,
  );
  assert.equal(await db.parties.count(), 3);
  await db.delete();
});

test("a full bill can be paid half cash and half UPI at checkout with no due", async (t) => {
  await db.delete();
  await db.open();
  t.after(async () => { await db.delete(); });
  await seedIfNeeded();
  const customer = await createParty({
    name: "Half Cash Half Online Buyer",
    type: "customer",
  });
  const line = { ...sampleInvoiceLine(), rate: 1000, gstRate: 0 };
  const total = calculateBill([line], 0).grandTotal;
  const cashAmount = roundMoney(total / 2);
  const upiAmount = roundMoney(total - cashAmount);
  const invoice = await saveSale({
    party: customer,
    lines: [line],
    paid: total,
    paymentMode: "mixed",
    paymentPlan: "full",
    paymentBreakdown: [
      { mode: "cash", amount: cashAmount },
      { mode: "upi", amount: upiAmount, reference: "UPI-HALF-1000" },
    ],
    idempotencyKey: "full-cash-upi-split",
  });
  const storedCustomer = await db.parties.get(customer.id);
  assert.ok(storedCustomer);
  assert.equal(invoice.grandTotal, 1000);
  assert.equal(invoice.initialAmountPaid, 1000);
  assert.equal(invoice.amountPaid, 1000);
  assert.equal(invoice.amountDue, 0);
  assert.equal(invoice.paymentMode, "mixed");
  assert.equal(invoice.paymentReceivedMode, undefined);
  assert.deepEqual(invoice.paymentBreakdown, [
    { mode: "cash", amount: 500 },
    { mode: "upi", amount: 500, reference: "UPI-HALF-1000" },
  ]);
  assert.equal(storedCustomer.currentBalance, 0);

  const statement = partyDueStatement(storedCustomer, [invoice], [], []);
  assert.deepEqual(
    statement.rows
      .filter((row) => row.kind === "payment")
      .map((row) => [row.paymentMode, row.paymentReceived, row.runningBalance]),
    [
      ["cash", 500, 500],
      ["upi", 500, 0],
    ],
  );
  assert.equal(statement.totalPaid, 1000);
  assert.equal(statement.remainingDue, 0);

  const closing = dailyCashSummary(
    invoice.date,
    [invoice],
    [],
    [],
    0,
    [storedCustomer],
  );
  assert.equal(closing.invoiceCash, 500);
  assert.equal(closing.upiIn, 500);
  const cashFlow = buildCashFlowReport({
    invoices: [invoice],
    payments: [],
    parties: [storedCustomer],
    accountEntries: [],
    expenses: [],
  });
  assert.deepEqual(
    Object.fromEntries(
      cashFlow.movements.map((movement) => [movement.mode, movement.amount]),
    ),
    { cash: 500, upi: 500 },
  );

  const cloud = memorySupabase();
  assert.equal(await syncWithClient(cloud.client), "synced");
  const remoteInvoice = cloud
    .rows("invoices")
    .find((row) => row.id === invoice.id);
  assert.deepEqual(remoteInvoice?.payment_breakdown, [
    { mode: "cash", amount: 500 },
    { mode: "upi", amount: 500, reference: "UPI-HALF-1000" },
  ]);
  await db.invoices.delete(invoice.id);
  assert.equal(await db.invoices.get(invoice.id), undefined);
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.deepEqual((await db.invoices.get(invoice.id))?.paymentBreakdown, [
    { mode: "cash", amount: 500 },
    { mode: "upi", amount: 500, reference: "UPI-HALF-1000" },
  ]);

  await assert.rejects(
    () => saveSale({
      party: storedCustomer,
      lines: [line],
      paid: total,
      paymentMode: "mixed",
      paymentPlan: "full",
      paymentBreakdown: [
        { mode: "cash", amount: cashAmount },
        { mode: "upi", amount: upiAmount + 0.01 },
      ],
      idempotencyKey: "invalid-overallocated-split",
    }),
    /add up/,
  );
  assert.equal(await db.invoices.count(), 1);
  assert.equal((await db.parties.get(customer.id))?.currentBalance, 0);
});

test("a typed billing customer and four-way split payment save atomically", async (t) => {
  await db.delete();
  await db.open();
  t.after(async () => { await db.delete(); });
  await seedIfNeeded();
  const line = sampleInvoiceLine();
  const preview = calculateBill([line], 0);
  const paid = 185;
  const invoice = await saveSale({
    customerDraft: {
      name: "রোজকার ক্রেতা",
      phone: "৯০০০০০০০৪৪",
      address: "বড়বাজার",
    },
    lines: [line],
    paid,
    paymentMode: "mixed",
    paymentPlan: "partial",
    paymentBreakdown: [
      { mode: "cash", amount: 40 },
      { mode: "upi", amount: 60, reference: "UPI-44" },
      { mode: "bank", amount: 35, reference: "BANK-44" },
      { mode: "cheque", amount: 50, reference: "CHQ-44" },
    ],
    idempotencyKey: "typed-split-sale",
  });
  const customer = invoice.partyId ? await db.parties.get(invoice.partyId) : undefined;
  assert.ok(customer);
  assert.equal(customer.name, "রোজকার ক্রেতা");
  assert.equal(customer.codeName, "");
  assert.equal(customer.phone, "৯০০০০০০০৪৪");
  assert.equal(customer.address, "বড়বাজার");
  assert.equal(invoice.initialAmountPaid, paid);
  assert.equal(invoice.amountDue, roundMoney(preview.grandTotal - paid));
  assert.equal(invoice.paymentMode, "mixed");
  assert.equal(invoice.paymentReceivedMode, undefined);
  assert.deepEqual(invoice.paymentBreakdown?.map((entry) => [entry.mode, entry.amount, entry.reference || ""]), [
    ["cash", 40, ""],
    ["upi", 60, "UPI-44"],
    ["bank", 35, "BANK-44"],
    ["cheque", 50, "CHQ-44"],
  ]);
  assert.equal(customer.currentBalance, invoice.amountDue);
  assert.equal(
    invoiceInitialPaymentBreakdown(invoice).reduce((sum, entry) => sum + entry.amount, 0),
    paid,
  );
  const summary = dailyCashSummary(invoice.date, [invoice], [], [], 0, [customer]);
  assert.equal(summary.invoiceCash, 40);
  assert.equal(summary.upiIn, 60);
  assert.equal(summary.bankIn, 35);
  assert.equal(summary.chequeIn, 50);
  const cashFlow = buildCashFlowReport({
    invoices: [invoice],
    payments: [],
    parties: [customer],
    accountEntries: [],
    expenses: [],
  });
  assert.deepEqual(
    Object.fromEntries(cashFlow.movements.map((movement) => [movement.mode, movement.amount])),
    { cash: 40, upi: 60, bank: 35, cheque: 50 },
  );
});

test("typed-customer duplicate checks and failed split validation leave no orphan records", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  await createParty({
    name: "ＡＣＭＥ   ट्रेडर्स",
    phone: "9000000055",
    type: "customer",
  });
  const beforeParties = await db.parties.count();
  const beforeInvoices = await db.invoices.count();
  await assert.rejects(
    () => saveSale({
      customerDraft: { name: "ACME ट्रेडर्स" },
      lines: [sampleInvoiceLine()],
      paid: 0,
      paymentMode: "credit",
      paymentPlan: "credit",
      idempotencyKey: "duplicate-name-sale",
    }),
    /already matches/,
  );
  await assert.rejects(
    () => saveSale({
      customerDraft: { name: "Different name", phone: "৯০০০০০০০৫৫" },
      lines: [sampleInvoiceLine()],
      paid: 0,
      paymentMode: "credit",
      paymentPlan: "credit",
      idempotencyKey: "duplicate-phone-sale",
    }),
    /already matches/,
  );
  await assert.rejects(
    () => saveSale({
      customerDraft: { name: "Should Roll Back" },
      lines: [sampleInvoiceLine()],
      paid: 50,
      paymentMode: "mixed",
      paymentPlan: "partial",
      paymentBreakdown: [
        { mode: "cash", amount: 20 },
        { mode: "upi", amount: 20 },
      ],
      idempotencyKey: "bad-split-sale",
    }),
    /add up/,
  );
  assert.equal(await db.parties.count(), beforeParties);
  assert.equal(await db.invoices.count(), beforeInvoices);
  await db.delete();
});

test("the same pending-customer draft ID creates one customer and one invoice", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const input = {
    customerDraft: { name: "One Retry Customer", codeName: "RETRY-01" },
    lines: [sampleInvoiceLine()],
    paid: 0,
    paymentMode: "credit" as const,
    paymentPlan: "credit" as const,
    idempotencyKey: "pending-customer-idempotent",
  };
  const first = await saveSale(input);
  const second = await saveSale(input);
  assert.equal(second.id, first.id);
  assert.equal(await db.invoices.where("id").equals(input.idempotencyKey).count(), 1);
  assert.equal(
    await db.parties.filter((party) => party.name === "One Retry Customer").count(),
    1,
  );
  assert.equal((await db.parties.get(first.partyId!))?.codeName, "RETRY-01");
  await db.delete();
});

test("a restored draft ID saves exactly one invoice and changes the balance once", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  assert.ok(party);
  const before = party.currentBalance;
  const first = await saveSale({ party, lines: [sampleInvoiceLine()], paid: 0, paymentMode: "credit", paymentPlan: "credit", idempotencyKey: "draft-idempotent-1" });
  const second = await saveSale({ party, lines: [sampleInvoiceLine()], paid: 0, paymentMode: "credit", paymentPlan: "credit", idempotencyKey: "draft-idempotent-1" });
  assert.equal(second.id, first.id);
  assert.equal(await db.invoices.where("id").equals("draft-idempotent-1").count(), 1);
  assert.equal((await db.parties.get(party.id))?.currentBalance, before + first.amountDue);
  await db.delete();
});

test("workspace validation, quantity presets and variant families migrate safely", () => {
  const workspace = normalizeWorkspace({ order: ["items", "items", "unknown" as "bill"], hidden: ["bill", "dues"], startTab: "dues" });
  assert.equal(workspace.order.length, 7);
  assert.equal(workspace.hidden.includes("bill"), false);
  assert.equal(workspace.startTab, "bill");
  assert.deepEqual(quantityPresets("gross"), [0.5, 1, 2, 5]);
  assert.ok(quantityPresets("dozen").includes(12));
  const item = { ...sampleItems[0], festivalTags: withVariantFamily([], "Moti Mala 12 inch") };
  assert.equal(variantFamily(item), "Moti Mala 12 inch");
});

test("standalone archived products restore offline without reviving merged aliases", async () => {
  await db.delete();
  await db.open();
  const archived: Item = {
    ...sampleItems[0],
    id: "restore-product-source",
    skuCode: "RESTORE-ONE",
    currentStock: 17,
    imageUrl: "data:image/png;base64,restored-photo",
    festivalTags: ["diwali", "family:Restore family"],
    saleCount: 6,
    lastSoldDate: "2026-08-01",
    isActive: false,
    updatedAt: "2026-08-09T10:00:00.000Z",
    isSynced: true,
  };
  await db.items.put(archived);
  assert.equal(isRestorableArchivedItem(archived), true);
  assert.equal(
    await db.items.filter((item) => item.id === archived.id && item.isActive).count(),
    0,
  );

  const restored = await restoreArchivedItem(archived.id, "staff");
  assert.equal(restored.isActive, true);
  assert.equal(restored.isSynced, false);
  assert.notEqual(restored.updatedAt, archived.updatedAt);
  assert.equal(
    await db.items.filter((item) => item.id === archived.id && item.isActive).count(),
    1,
  );
  assert.deepEqual(
    {
      name: restored.name,
      skuCode: restored.skuCode,
      currentStock: restored.currentStock,
      imageUrl: restored.imageUrl,
      festivalTags: restored.festivalTags,
      saleCount: restored.saleCount,
      lastSoldDate: restored.lastSoldDate,
      createdAt: restored.createdAt,
    },
    {
      name: archived.name,
      skuCode: archived.skuCode,
      currentStock: archived.currentStock,
      imageUrl: archived.imageUrl,
      festivalTags: archived.festivalTags,
      saleCount: archived.saleCount,
      lastSoldDate: archived.lastSoldDate,
      createdAt: archived.createdAt,
    },
  );
  const firstRestoreStamp = restored.updatedAt;
  const second = await restoreArchivedItem(archived.id, "owner");
  assert.equal(second.updatedAt, firstRestoreStamp);
  const restoreLogs = await db.activityLogs
    .filter((entry) => entry.entityId === archived.id && entry.action === "item.restored")
    .toArray();
  assert.equal(restoreLogs.length, 1);
  assert.equal(restoreLogs[0].actor, "staff");

  const mergedSource = {
    ...sampleItems[0],
    id: "restore-merged-source",
    skuCode: "RESTORE-MERGED-A",
    isSynced: false,
  };
  const mergedTarget = {
    ...sampleItems[0],
    id: "restore-merged-target",
    skuCode: "RESTORE-MERGED-B",
    isSynced: false,
  };
  await db.items.bulkPut([mergedSource, mergedTarget]);
  await mergeItems(mergedSource.id, mergedTarget.id);
  const merged = await db.items.get(mergedSource.id);
  assert.ok(merged);
  assert.equal(isRestorableArchivedItem(merged), false);
  await assert.rejects(
    () => restoreArchivedItem(mergedSource.id),
    /merged into another product/,
  );
  await db.delete();
});

test("reviewed party and item merges preserve ledger ownership and archive sources", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const source = await createParty({ name: "Duplicate Buyer", codeName: "DUP-A", phone: "9000000011", address: "A", type: "customer", openingBalance: 100 });
  const target = await createParty({ name: "Duplicate Buyer", codeName: "DUP-B", phone: "9000000011", address: "B", type: "customer", openingBalance: 50 });
  const due = await recordDue(source, 75, "Old notebook due");
  const sourcePartyPrice = {
    ...samplePrices[0],
    id: priceKey(source.id, sampleItems[0].id),
    partyId: source.id,
    itemId: sampleItems[0].id,
    isSynced: true,
  };
  const targetPartyPrice = {
    ...samplePrices[0],
    id: priceKey(target.id, sampleItems[0].id),
    partyId: target.id,
    itemId: sampleItems[0].id,
    lastPrice: 265,
    lastSoldDate: "2026-07-30",
    timesSold: 2,
    updatedAt: "2026-07-30T10:00:00.000Z",
    isSynced: true,
  };
  await db.partyItemPrices.bulkPut([sourcePartyPrice, targetPartyPrice]);
  await mergeParties(source.id, target.id);
  assert.equal((await db.accountEntries.get(due.id))?.partyId, target.id);
  assert.equal((await db.parties.get(target.id))?.currentBalance, 225);
  assert.ok((await db.parties.get(source.id))?.tags.includes(`mergedInto:${target.id}`));
  assert.ok(await db.partyItemPrices.get(sourcePartyPrice.id));
  const mergedPartyPrice = await db.partyItemPrices.get(
    priceKey(target.id, sampleItems[0].id),
  );
  assert.equal(mergedPartyPrice?.timesSold, 11);
  assert.equal(mergedPartyPrice?.lastSoldDate, "2026-08-01");
  assert.equal(mergedPartyPrice?.lastPrice, 275);

  const sourceItem = { ...sampleItems[0], id: "merge-source", skuCode: "MERGE-A", currentStock: 4, saleCount: 2, lastSoldDate: "2026-08-03", isSynced: false };
  const targetItem = { ...sampleItems[0], id: "merge-target", skuCode: "MERGE-B", currentStock: 6, saleCount: 3, lastSoldDate: "2026-08-01", isSynced: false };
  await db.items.bulkPut([sourceItem, targetItem]);
  const sourceItemPrice = {
    ...samplePrices[0],
    id: priceKey(target.id, sourceItem.id),
    partyId: target.id,
    itemId: sourceItem.id,
    isSynced: true,
  };
  await db.partyItemPrices.put(sourceItemPrice);
  await mergeItems(sourceItem.id, targetItem.id);
  assert.equal((await db.items.get(sourceItem.id))?.isActive, false);
  assert.equal((await db.items.get(targetItem.id))?.currentStock, 10);
  assert.equal((await db.items.get(targetItem.id))?.saleCount, 5);
  assert.equal((await db.items.get(targetItem.id))?.lastSoldDate, "2026-08-03");
  assert.ok(await db.partyItemPrices.get(sourceItemPrice.id));
  assert.ok(await db.partyItemPrices.get(priceKey(target.id, targetItem.id)));
  const mergedCount = (await db.items.get(targetItem.id))?.saleCount;
  await assert.rejects(
    () => mergeItems(sourceItem.id, targetItem.id),
    /already been merged or archived/,
  );
  assert.equal((await db.items.get(targetItem.id))?.saleCount, mergedCount);
  await assert.rejects(
    () => mergeParties(source.id, target.id),
    /already been merged/,
  );

  const unknownSource = { ...sampleItems[0], id: "merge-unknown-source", skuCode: "MERGE-UNKNOWN-A", currentStock: null, isSynced: false };
  const knownTarget = { ...sampleItems[0], id: "merge-known-target", skuCode: "MERGE-UNKNOWN-B", currentStock: 5, isSynced: false };
  await db.items.bulkPut([unknownSource, knownTarget]);
  await mergeItems(unknownSource.id, knownTarget.id);
  assert.equal((await db.items.get(knownTarget.id))?.currentStock, null);
  assert.ok((await db.activityLogs.count()) >= 2);
  await db.delete();
});

test("item merges combine remembered-price histories without losing lock semantics", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const lockedBuyer = await createParty({
    name: "Merged Locked Price Buyer",
    type: "customer",
  });
  const latestBuyer = await createParty({
    name: "Merged Latest Price Buyer",
    type: "customer",
  });
  const source = await createQuickItem("Price History Source", 90);
  const target = await createQuickItem("Price History Target", 80);
  const rememberedPrice = (
    partyId: string,
    itemId: string,
    lastPrice: number,
    lastSoldDate: string,
    timesSold: number,
    lockedPrice: boolean,
  ) => ({
    id: priceKey(partyId, itemId),
    partyId,
    itemId,
    lastPrice,
    lastSoldDate,
    timesSold,
    lockedPrice,
    updatedAt: `${lastSoldDate}T10:00:00.000Z`,
    isSynced: true,
  });
  const lockedTarget = rememberedPrice(
    lockedBuyer.id,
    target.id,
    100,
    "2026-08-01",
    3,
    true,
  );
  const lockedSource = rememberedPrice(
    lockedBuyer.id,
    source.id,
    200,
    "2026-08-03",
    2,
    true,
  );
  const latestTarget = rememberedPrice(
    latestBuyer.id,
    target.id,
    110,
    "2026-08-01",
    4,
    true,
  );
  const latestSource = rememberedPrice(
    latestBuyer.id,
    source.id,
    210,
    "2026-08-04",
    1,
    false,
  );
  await db.partyItemPrices.bulkPut([
    lockedTarget,
    lockedSource,
    latestTarget,
    latestSource,
  ]);

  await mergeItems(source.id, target.id);
  const mergedLocked = await db.partyItemPrices.get(
    priceKey(lockedBuyer.id, target.id),
  );
  const mergedLatest = await db.partyItemPrices.get(
    priceKey(latestBuyer.id, target.id),
  );
  assert.deepEqual(
    {
      count: mergedLocked?.timesSold,
      date: mergedLocked?.lastSoldDate,
      price: mergedLocked?.lastPrice,
      locked: mergedLocked?.lockedPrice,
    },
    { count: 5, date: "2026-08-03", price: 100, locked: true },
  );
  assert.deepEqual(
    {
      count: mergedLatest?.timesSold,
      date: mergedLatest?.lastSoldDate,
      price: mergedLatest?.lastPrice,
      locked: mergedLatest?.lockedPrice,
    },
    { count: 5, date: "2026-08-04", price: 210, locked: false },
  );
  assert.ok(await db.partyItemPrices.get(lockedSource.id));
  assert.ok(await db.partyItemPrices.get(latestSource.id));
  await db.delete();
});

test("paid invoices cannot be deleted and unpaid invoice restore is balance-safe", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({ name: "Delete Safety Buyer", type: "customer" });
  const paidInvoice = await saveSale({
    party,
    lines: [{ ...sampleInvoiceLine(), rate: 100, gstRate: 0 }],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  const afterBill = await db.parties.get(party.id);
  assert.ok(afterBill);
  await recordPayment(afterBill, 40, "cash", "part payment");
  await assert.rejects(
    () => softDeleteInvoice(paidInvoice.id),
    /recorded payment and cannot be deleted/,
  );
  assert.equal((await db.invoices.get(paidInvoice.id))?.deletedAt, undefined);

  const unpaidInvoice = await saveSale({
    party: (await db.parties.get(party.id))!,
    lines: [{ ...sampleInvoiceLine(), rate: 50, gstRate: 0 }],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  assert.equal((await db.parties.get(party.id))?.currentBalance, 110);
  await softDeleteInvoice(unpaidInvoice.id);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 60);
  await restoreInvoice(unpaidInvoice.id);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 110);

  const paidAtSave = await saveSale({
    party: (await db.parties.get(party.id))!,
    lines: [{ ...sampleInvoiceLine(), rate: 100, gstRate: 0 }],
    paid: 40,
    paymentMode: "cash",
    paymentPlan: "partial",
  });
  await assert.rejects(
    () => softDeleteInvoice(paidAtSave.id),
    /recorded payment and cannot be deleted/,
  );
  assert.equal((await db.invoices.get(paidAtSave.id))?.deletedAt, undefined);
  await db.invoices.update(paidAtSave.id, {
    amountPaid: 0,
    amountDue: paidAtSave.grandTotal,
  });
  await assert.rejects(
    () => softDeleteInvoice(paidAtSave.id),
    /recorded payment and cannot be deleted/,
  );
  await db.invoices.update(paidAtSave.id, {
    deletedAt: "2026-08-09T12:00:00.000Z",
    isSynced: true,
  });
  await db.parties.update(party.id, { currentBalance: 110, isSynced: true });
  await reconcilePartyBalances();
  assert.equal((await db.invoices.get(paidAtSave.id))?.deletedAt, undefined);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 170);
  await db.delete();
});

test("deleting and restoring sales reverses item and remembered-price statistics", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({
    name: "Sale Statistics Buyer",
    type: "customer",
  });
  const item = await createQuickItem("Sale Statistics Item", 80);
  const line = (rate: number): InvoiceLine => ({
    ...sampleInvoiceLine(),
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    unit: item.baseUnit,
    baseUnit: item.baseUnit,
    rate,
    gstRate: 0,
  });

  const first = await saveSale({
    party,
    lines: [line(123)],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  assert.deepEqual(
    {
      count: (await db.items.get(item.id))?.saleCount,
      date: (await db.items.get(item.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.timesSold,
      partyPrice: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastPrice,
    },
    { count: 1, date: first.date, partyCount: 1, partyPrice: 123 },
  );

  await softDeleteInvoice(first.id);
  assert.deepEqual(
    {
      count: (await db.items.get(item.id))?.saleCount,
      date: (await db.items.get(item.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.timesSold,
      partyDate: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastSoldDate,
      partyPrice: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastPrice,
    },
    {
      count: 0,
      date: undefined,
      partyCount: 0,
      partyDate: "",
      partyPrice: item.priceWholesale,
    },
  );

  await restoreInvoice(first.id);
  assert.equal((await db.items.get(item.id))?.saleCount, 1);
  assert.equal((await db.items.get(item.id))?.lastSoldDate, first.date);
  assert.equal(
    (await db.partyItemPrices.get(priceKey(party.id, item.id)))?.lastPrice,
    123,
  );
  await db.invoices.update(first.id, {
    date: "2026-08-01",
    createdAt: "2026-08-01T10:00:00.000Z",
  });

  const second = await saveSale({
    party: (await db.parties.get(party.id))!,
    lines: [line(175)],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  await softDeleteInvoice(second.id);
  assert.deepEqual(
    {
      count: (await db.items.get(item.id))?.saleCount,
      date: (await db.items.get(item.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.timesSold,
      partyDate: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastSoldDate,
      partyPrice: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastPrice,
    },
    {
      count: 1,
      date: "2026-08-01",
      partyCount: 1,
      partyDate: "2026-08-01",
      partyPrice: 123,
    },
  );
  await restoreInvoice(second.id);
  assert.deepEqual(
    {
      count: (await db.items.get(item.id))?.saleCount,
      date: (await db.items.get(item.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.timesSold,
      partyPrice: (await db.partyItemPrices.get(priceKey(party.id, item.id)))
        ?.lastPrice,
    },
    { count: 2, date: second.date, partyCount: 2, partyPrice: 175 },
  );
  await db.delete();
});

test("remembered prices replay consecutive locked sales chronologically", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({
    name: "Locked Price Replay Buyer",
    type: "customer",
  });
  const item = await createQuickItem("Locked Price Replay Item", 80);
  const lockedLine = (rate: number): InvoiceLine => ({
    ...sampleInvoiceLine(),
    itemId: item.id,
    itemName: item.name,
    skuCode: item.skuCode,
    unit: item.baseUnit,
    baseUnit: item.baseUnit,
    rate,
    gstRate: 0,
    lockPrice: true,
  });
  await saveSale({
    party,
    lines: [lockedLine(100)],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  const laterLockedSale = await saveSale({
    party: (await db.parties.get(party.id))!,
    lines: [lockedLine(200)],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  const rememberedId = priceKey(party.id, item.id);
  assert.deepEqual(
    {
      price: (await db.partyItemPrices.get(rememberedId))?.lastPrice,
      locked: (await db.partyItemPrices.get(rememberedId))?.lockedPrice,
      count: (await db.partyItemPrices.get(rememberedId))?.timesSold,
    },
    { price: 100, locked: true, count: 2 },
  );
  await softDeleteInvoice(laterLockedSale.id);
  assert.deepEqual(
    {
      price: (await db.partyItemPrices.get(rememberedId))?.lastPrice,
      locked: (await db.partyItemPrices.get(rememberedId))?.lockedPrice,
      count: (await db.partyItemPrices.get(rememberedId))?.timesSold,
    },
    { price: 100, locked: true, count: 1 },
  );
  await restoreInvoice(laterLockedSale.id);
  assert.deepEqual(
    {
      price: (await db.partyItemPrices.get(rememberedId))?.lastPrice,
      locked: (await db.partyItemPrices.get(rememberedId))?.lockedPrice,
      count: (await db.partyItemPrices.get(rememberedId))?.timesSold,
    },
    { price: 100, locked: true, count: 2 },
  );
  await db.delete();
});

test("sale deletion follows merged-item alias chains to the active product", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({
    name: "Merged Product Buyer",
    type: "customer",
  });
  const source = await createQuickItem("Merged Source Item", 90);
  const middle = await createQuickItem("Merged Middle Item", 80);
  const target = await createQuickItem("Merged Target Item", 70);
  const invoice = await saveSale({
    party,
    lines: [{
      ...sampleInvoiceLine(),
      itemId: source.id,
      itemName: source.name,
      skuCode: source.skuCode,
      unit: source.baseUnit,
      baseUnit: source.baseUnit,
      rate: 155,
      gstRate: 0,
    }],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  await mergeItems(source.id, middle.id);
  await mergeItems(middle.id, target.id);
  const targetPriceId = priceKey(party.id, target.id);
  assert.equal((await db.items.get(target.id))?.saleCount, 1);
  assert.equal((await db.partyItemPrices.get(targetPriceId))?.lastPrice, 155);

  await softDeleteInvoice(invoice.id);
  assert.deepEqual(
    {
      count: (await db.items.get(target.id))?.saleCount,
      date: (await db.items.get(target.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(targetPriceId))?.timesSold,
      partyDate: (await db.partyItemPrices.get(targetPriceId))?.lastSoldDate,
      partyPrice: (await db.partyItemPrices.get(targetPriceId))?.lastPrice,
    },
    {
      count: 0,
      date: undefined,
      partyCount: 0,
      partyDate: "",
      partyPrice: target.priceWholesale,
    },
  );

  await restoreInvoice(invoice.id);
  assert.deepEqual(
    {
      count: (await db.items.get(target.id))?.saleCount,
      date: (await db.items.get(target.id))?.lastSoldDate,
      partyCount: (await db.partyItemPrices.get(targetPriceId))?.timesSold,
      partyDate: (await db.partyItemPrices.get(targetPriceId))?.lastSoldDate,
      partyPrice: (await db.partyItemPrices.get(targetPriceId))?.lastPrice,
    },
    {
      count: 1,
      date: invoice.date,
      partyCount: 1,
      partyDate: invoice.date,
      partyPrice: 155,
    },
  );
  await db.delete();
});

test("invoice cost snapshots keep historical profit stable after a product edit", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({ name: "Historical Cost Buyer", type: "customer" });
  const item = await db.items.get(sampleItems[0].id);
  assert.ok(item);
  const invoice = await saveSale({
    party,
    lines: [{ ...sampleInvoiceLine(), qty: 2, gstRate: 0 }],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  const snapshottedCost = invoice.lineItems[0].unitCost;
  assert.equal(snapshottedCost, item.purchasePrice);
  await db.items.update(item.id, { purchasePrice: item.purchasePrice + 500 });
  const report = buildItemProfitReport(
    [invoice],
    await db.items.toArray(),
  );
  assert.equal(report[0].cost, snapshottedCost! * 2);
  await db.delete();
});

test("daily closing separates customer cash, supplier cash and expenses", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const customer = await db.parties.get("p-ramesh");
  const supplier = (await db.parties.where("type").equals("supplier").first()) || await createParty({ name: "Supplier", type: "supplier" });
  assert.ok(customer && supplier);
  await db.parties.update(customer.id, { currentBalance: 500 });
  await db.parties.update(supplier.id, { currentBalance: 300 });
  const received = await recordPayment({ ...customer, currentBalance: 500 }, 200, "cash", "cash received");
  const paid = await recordPayment({ ...supplier, currentBalance: 300 }, 100, "cash", "cash paid");
  await recordExpense({ category: "refreshments", amount: 50, date: received.date, description: "Tea", paymentMode: "cash", reference: "" });
  const summary = dailyCashSummary(received.date, [], [received, paid], await db.expenses.toArray(), 1000, [customer, supplier]);
  assert.equal(summary.customerCash, 200);
  assert.equal(summary.supplierCash, 100);
  assert.equal(summary.expensesCash, 50);
  assert.equal(summary.expectedCash, 1050);
  const close = await saveDailyClose({ date: received.date, openingCash: 1000, expectedCash: 1050, countedCash: 1040, notes: "Ten short" });
  assert.equal(close.discrepancy, -10);
  await db.delete();
});

test("expense and daily-close validation reject impossible dates and non-finite cash", async () => {
  await db.delete();
  await db.open();
  await assert.rejects(
    () => recordExpense({
      category: "other",
      amount: 10,
      date: "2026-02-31",
      description: "Impossible date",
      paymentMode: "cash",
    }),
    /valid expense date/,
  );
  await assert.rejects(
    () => saveDailyClose({
      date: "2026-02-31",
      openingCash: 0,
      expectedCash: 0,
      countedCash: 0,
      notes: "",
    }),
    /valid closing date/,
  );
  for (const input of [
    { openingCash: Number.POSITIVE_INFINITY, expectedCash: 0, countedCash: 0 },
    { openingCash: 0, expectedCash: Number.NaN, countedCash: 0 },
    { openingCash: 0, expectedCash: 0, countedCash: Number.POSITIVE_INFINITY },
  ]) {
    await assert.rejects(
      () => saveDailyClose({ date: "2026-08-09", ...input, notes: "" }),
      /finite|could not be calculated/,
    );
  }
  const negativeExpected = await saveDailyClose({
    date: "2026-08-09",
    openingCash: 0,
    expectedCash: -25,
    countedCash: 0,
    notes: "Cash source needs review",
  });
  assert.equal(negativeExpected.expectedCash, -25);
  assert.equal(negativeExpected.discrepancy, 25);
  assert.equal(await db.expenses.count(), 0);
  await db.delete();
});

test("daily closing counts initial invoice money once and keeps later payment channels", async () => {
  await db.delete();
  await db.open();
  const customer = await createParty({
    name: "Daily Channel Buyer",
    type: "customer",
  });
  const invoice = await saveSale({
    party: customer,
    lines: [{ ...sampleInvoiceLine(), rate: 100, gstRate: 0 }],
    paid: 40,
    paymentMode: "cash",
    paymentPlan: "partial",
  });
  const afterSale = await db.parties.get(customer.id);
  assert.ok(afterSale);
  const laterUpi = await recordPayment(
    afterSale,
    30,
    "upi",
    "later online payment",
  );
  const storedInvoice = await db.invoices.get(invoice.id);
  assert.ok(storedInvoice);
  assert.equal(storedInvoice.amountPaid, 70);

  const summary = dailyCashSummary(
    invoice.date,
    [storedInvoice],
    [laterUpi],
    [],
    0,
    await db.parties.toArray(),
  );
  assert.deepEqual(
    {
      invoiceCash: summary.invoiceCash,
      customerCash: summary.customerCash,
      upiIn: summary.upiIn,
      bankIn: summary.bankIn,
      expectedCash: summary.expectedCash,
    },
    {
      invoiceCash: 40,
      customerCash: 0,
      upiIn: 30,
      bankIn: 0,
      expectedCash: 40,
    },
  );
  const legacyMixedSummary = dailyCashSummary(
    invoice.date,
    [{
      ...storedInvoice,
      paymentMode: "mixed",
      paymentReceivedMode: undefined,
    }],
    [laterUpi],
    [],
    0,
    await db.parties.toArray(),
  );
  assert.equal(legacyMixedSummary.invoiceCash, 40);
  assert.equal(legacyMixedSummary.expectedCash, 40);
  await db.delete();
});

test("daily closing includes cash purchases and returns in drawer cash", () => {
  const stamp = "2026-08-09T12:00:00.000Z";
  const invoice = (id: string, type: Invoice["type"], amount: number): Invoice => ({
    id,
    invoiceNumber: id.toUpperCase(),
    partyName: "Counterparty",
    date: "2026-08-09",
    type,
    lineItems: [],
    subtotal: amount,
    discountTotal: 0,
    gstTotal: 0,
    otherCharges: [],
    otherChargesTotal: 0,
    roundOff: 0,
    grandTotal: amount,
    initialAmountPaid: amount,
    amountPaid: amount,
    amountDue: 0,
    paymentMode: "cash",
    paymentReceivedMode: "cash",
    notes: "",
    isSynced: false,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const summary = dailyCashSummary(
    "2026-08-09",
    [
      invoice("sale-cash", "sale", 100),
      invoice("purchase-cash", "purchase", 40),
      invoice("sale-return-cash", "sale_return", 10),
      invoice("purchase-return-cash", "purchase_return", 15),
    ],
    [],
    [],
    50,
  );
  assert.equal(summary.invoiceCash, 115);
  assert.equal(summary.invoiceCashOut, 50);
  assert.equal(summary.expectedCash, 115);
});

function pagedSupabase(initial: Record<string, Record<string, unknown>[]>) {
  const tables = new Map(Object.entries(initial).map(([name, rows]) => [name, new Map(rows.map((row) => [String(row.id), structuredClone(row)]))]));
  const ranges: Record<string, number> = {};
  const batches: Record<string, number[]> = {};
  const batchBytes: Record<string, number[]> = {};
  const orders: Record<string, string[]> = {};
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name)!; };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "paged", user_metadata: { sync_code: "test-business-sync-code-1234567890" } } } } }),
      signOut: async () => ({ error: null }),
      signInAnonymously: async () => ({ data: { session: null }, error: null }),
    },
    from: (name: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        batches[name] ||= [];
        batchBytes[name] ||= [];
        batches[name].push(rows.length);
        batchBytes[name].push(Buffer.byteLength(JSON.stringify(rows)));
        for (const row of rows) table(name).set(String(row.id), structuredClone(row));
        return { data: null, error: null };
      },
      select: () => {
        const query = {
          order(column: string) {
            orders[name] ||= [];
            orders[name].push(column);
            return query;
          },
          async range(from: number, to: number) {
            ranges[name] = (ranges[name] || 0) + 1;
            const rows = [...table(name).values()]
              .sort((left, right) => String(left.id).localeCompare(String(right.id)))
              .slice(from, to + 1)
              .map((row) => structuredClone(row));
            return { data: rows, error: null };
          },
        };
        return query;
      },
    }),
  } as unknown as Parameters<typeof syncWithClient>[0];
  return { client, ranges, batches, batchBytes, orders, rows: (name: string) => [...table(name).values()] };
}

const remoteItem = (index: number): Record<string, unknown> => ({
  id: `stress-item-${index}`,
  name: `Moti Mala Stress ${index}`,
  name_hi: "",
  name_bn: "",
  sku_code: `STRESS-${index}`,
  category_id: "cat-mala",
  base_unit: "dozen",
  conversion_rate: 1,
  purchase_price: 10,
  price_retail: 20,
  price_wholesale: 18,
  price_bulk: 15,
  current_stock: null,
  low_stock_alert: null,
  festival_tags: [],
  hsn_code: null,
  gst_rate: 18,
  image_url: null,
  is_active: true,
  sale_count: 0,
  last_sold_date: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

test("a restored product uploads its active state and returns cleanly", async () => {
  await db.delete();
  await db.open();
  const archived: Item = {
    ...sampleItems[0],
    id: "restore-sync-item",
    skuCode: "RESTORE-SYNC",
    isActive: false,
    updatedAt: "2026-08-09T10:00:00.000Z",
    isSynced: true,
  };
  await db.items.put(archived);
  await restoreArchivedItem(archived.id);
  const cloud = pagedSupabase({});
  assert.equal(await syncWithClient(cloud.client), "synced");
  const uploaded = cloud.rows("items").find((row) => row.id === archived.id);
  assert.ok(uploaded);
  assert.equal(uploaded.is_active, true);
  assert.equal((await db.items.get(archived.id))?.isActive, true);
  assert.equal((await db.items.get(archived.id))?.isSynced, true);
  await db.delete();
});

test("sync downloads 2,501 products by page and uploads large changes in bounded batches", async () => {
  await db.delete();
  await db.open();
  const cloud = pagedSupabase({ items: Array.from({ length: 2501 }, (_, index) => remoteItem(index)) });
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal(await db.items.count(), 2501);
  assert.equal(cloud.ranges.items, 6);
  assert.deepEqual(cloud.orders.items, Array(6).fill("id"));
  const changed = (await db.items.limit(205).toArray()).map((item, index) => ({ ...item, priceWholesale: 100 + index, updatedAt: "2026-12-01T00:00:00.000Z", isSynced: false }));
  await db.items.bulkPut(changed);
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.deepEqual(cloud.batches.items, [100, 100, 5]);
  const pushed = cloud.rows("items").filter((row) => changed.some((item) => item.id === row.id));
  assert.ok(pushed.every((row) => row.business_id === "7bdebe348faeda556a3005c310de23f8744f21cd7a0b3c9d8a745ef85695219a"));
  assert.ok(pushed.every((row) => row.business_id !== "test-business-sync-code-1234567890"));

  const imageChanged = changed.slice(0, 20).map((item, index) => ({
    ...item,
    imageUrl: `data:image/jpeg;base64,${"a".repeat(96_000)}`,
    updatedAt: `2026-12-02T00:00:${String(index).padStart(2, "0")}.000Z`,
    isSynced: false,
  }));
  await db.items.bulkPut(imageChanged);
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal(cloud.batches.items.slice(3).reduce((sum, value) => sum + value, 0), 20);
  assert.ok(cloud.batches.items.slice(3).every((size) => size < 100));
  assert.ok(cloud.batchBytes.items.every((size) => size <= 900_000));
  assert.equal(await pendingCount(), 0);
  const info = await syncDiagnostics();
  assert.equal(info.totalPending, 0);

  const oversized = {
    ...(await db.items.get(imageChanged[0].id))!,
    imageUrl: `data:image/jpeg;base64,${"b".repeat(950_000)}`,
    updatedAt: "2026-12-03T00:00:00.000Z",
    isSynced: false,
  };
  await db.items.put(oversized);
  const batchesBeforeOversized = cloud.batches.items.length;
  assert.equal(await syncWithClient(cloud.client), "pending");
  assert.equal(cloud.batches.items.length, batchesBeforeOversized);
  assert.equal((await db.items.get(oversized.id))?.isSynced, false);
  await db.delete();
});

test("cloud payments with a legacy null allocation list normalize safely", async () => {
  await db.delete();
  await db.open();
  const stamp = "2026-08-09T12:00:00.000Z";
  const cloud = pagedSupabase({
    payments: [{
      id: "legacy-null-allocation",
      party_id: "legacy-party",
      amount: 10,
      date: "2026-08-09",
      mode: "cash",
      reference: "legacy",
      allocated_to: null,
      created_at: stamp,
      updated_at: stamp,
    }],
  });
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.deepEqual(
    (await db.payments.get("legacy-null-allocation"))?.allocatedTo,
    [],
  );
  await db.delete();
});

test("ledger reconciliation repairs a corrupted party balance from canonical events", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await db.parties.get("p-ramesh");
  assert.ok(party);
  const invoice = await saveSale({ party, lines: [sampleInvoiceLine()], paid: 0, paymentMode: "credit", paymentPlan: "credit" });
  const current = await db.parties.get(party.id);
  assert.ok(current);
  await recordPayment(current, Math.min(100, current.currentBalance), "upi", "repair test");
  await db.parties.update(party.id, { currentBalance: 999999, isSynced: true });
  await reconcilePartyBalances();
  const repaired = await db.parties.get(party.id);
  assert.ok(repaired);
  assert.notEqual(repaired.currentBalance, 999999);
  assert.equal(repaired.currentBalance, party.openingBalance + invoice.amountDue - Math.min(100, party.openingBalance + invoice.amountDue));
  await db.delete();
});

test("ledger reconciliation merges concurrent payment events and restores legacy paid deletions", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const party = await createParty({ name: "Concurrent Payment Buyer", type: "customer" });
  const invoice = await saveSale({
    party,
    lines: [{ ...sampleInvoiceLine(), rate: 100, gstRate: 0 }],
    paid: 0,
    paymentMode: "credit",
    paymentPlan: "credit",
  });
  const firstStamp = "2026-08-09T10:00:00.000Z";
  const secondStamp = "2026-08-09T10:01:00.000Z";
  const payments: Payment[] = [
    {
      id: "device-a-payment",
      partyId: party.id,
      amount: 30,
      date: invoice.date,
      mode: "cash",
      reference: "device A",
      allocatedTo: [{ invoiceId: invoice.id, amount: 30 }],
      createdAt: firstStamp,
      updatedAt: firstStamp,
      isSynced: true,
    },
    {
      id: "device-b-payment",
      partyId: party.id,
      amount: 40,
      date: invoice.date,
      mode: "upi",
      reference: "device B",
      allocatedTo: [{ invoiceId: invoice.id, amount: 40 }],
      createdAt: secondStamp,
      updatedAt: secondStamp,
      isSynced: true,
    },
  ];
  await db.payments.bulkPut(payments);
  await db.invoices.update(invoice.id, {
    amountPaid: 40,
    amountDue: 60,
    deletedAt: secondStamp,
    isSynced: true,
  });
  await db.parties.update(party.id, { currentBalance: 999, isSynced: true });
  await reconcilePartyBalances();
  const repairedInvoice = await db.invoices.get(invoice.id);
  assert.equal(repairedInvoice?.deletedAt, undefined);
  assert.equal(repairedInvoice?.amountPaid, 70);
  assert.equal(repairedInvoice?.amountDue, 30);
  assert.equal((await db.parties.get(party.id))?.currentBalance, 30);
  await db.delete();
});

test("cloud configuration is device-bound and disconnect overrides stored settings", async () => {
  await db.delete();
  await db.open();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const existing = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const original = {
      url: "https://example.supabase.co",
      key: "public-anon-key",
      syncCode: "first-business-code-1234567890",
    };
    await configureCloud(original);
    assert.deepEqual(getCloudConfig(), original);
    await db.items.put({ ...sampleItems[0], id: "cloud-bound-item" });
    await assert.rejects(
      () => configureCloud({ ...original, syncCode: "second-business-code-1234567890" }),
      /another cloud business/,
    );
    const activeClient = supabaseClient();
    assert.ok(activeClient);
    let stopped = 0;
    let signedOut = 0;
    activeClient.removeAllChannels = async () => { throw new Error("channel cleanup failed"); };
    activeClient.auth.stopAutoRefresh = async () => { stopped += 1; };
    activeClient.auth.signOut = async () => { signedOut += 1; return { error: null }; };
    await clearCloudConfig();
    assert.equal(stopped, 1);
    assert.equal(signedOut, 1);
    assert.deepEqual(getCloudConfig(), { url: "", key: "", syncCode: "" });
  } finally {
    if (existing) Object.defineProperty(globalThis, "localStorage", existing);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("restricted DOM storage cannot crash offline startup or half-bind a cloud business", async () => {
  await db.delete();
  await db.open();
  const existingStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  const deniedStorage = {
    getItem: () => { throw new DOMException("storage denied", "SecurityError"); },
    setItem: () => { throw new DOMException("storage denied", "SecurityError"); },
    removeItem: () => { throw new DOMException("storage denied", "SecurityError"); },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: deniedStorage,
  });
  try {
    assert.deepEqual(getCloudConfig(), { url: "", key: "", syncCode: "" });
    await assert.rejects(
      () => configureCloud({
        url: "https://restricted.supabase.co",
        key: "public-anon-key",
        syncCode: "restricted-storage-code-1234567890",
      }),
      /could not be saved/,
    );
    assert.equal(
      await db.meta.get("cloud-business-fingerprint-v1"),
      undefined,
    );
  } finally {
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (existingStorage)
      Object.defineProperty(globalThis, "localStorage", existingStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("cloud configuration rolls back when writing succeeds but clearing the disconnect tombstone fails", async () => {
  await db.delete();
  await db.open();
  const configKey = "mantu-supabase-config-v1";
  const disabledKey = "mantu-supabase-disabled-v1";
  const original = {
    url: "https://original.supabase.co",
    key: "original-public-key",
    syncCode: "original-business-code-1234567890",
  };
  const replacement = {
    url: "https://replacement.supabase.co",
    key: "replacement-public-key",
    syncCode: "replacement-business-code-1234567890",
  };
  const values = new Map<string, string>([
    [configKey, JSON.stringify(original)],
    [disabledKey, "true"],
  ]);
  let rejectRemovals = true;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      if (rejectRemovals)
        throw new DOMException("remove denied", "SecurityError");
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  const existing = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    assert.deepEqual(getCloudConfig(), { url: "", key: "", syncCode: "" });
    await assert.rejects(
      () => configureCloud(replacement),
      /could not be saved/,
    );
    assert.equal(values.get(configKey), JSON.stringify(original));
    assert.equal(values.get(disabledKey), "true");
    assert.equal(
      await db.meta.get("cloud-business-fingerprint-v1"),
      undefined,
    );

    rejectRemovals = false;
    await configureCloud(replacement);
    assert.deepEqual(getCloudConfig(), replacement);
    await clearCloudConfig();
  } finally {
    if (existing) Object.defineProperty(globalThis, "localStorage", existing);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("a disconnect that cannot persist remains disabled for the current session", async () => {
  await db.delete();
  await db.open();
  const values = new Map<string, string>();
  let rejectWrites = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (rejectWrites)
        throw new DOMException("write denied", "SecurityError");
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      if (rejectWrites)
        throw new DOMException("remove denied", "SecurityError");
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  const existing = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const config = {
    url: "https://disconnect.supabase.co",
    key: "disconnect-public-key",
    syncCode: "disconnect-business-code-1234567890",
  };
  try {
    await configureCloud(config);
    assert.ok(supabaseClient());
    rejectWrites = true;
    await assert.rejects(
      () => clearCloudConfig(),
      /stopped for this session/,
    );
    assert.deepEqual(getCloudConfig(), { url: "", key: "", syncCode: "" });
    assert.equal(supabaseClient(), null);

    // Reset the module-level fail-closed state for following tests after the
    // simulated device storage becomes writable again.
    rejectWrites = false;
    await configureCloud(config);
    await clearCloudConfig();
  } finally {
    if (existing) Object.defineProperty(globalThis, "localStorage", existing);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("client-public environment variables cannot embed a tenant credential", async () => {
  await db.delete();
  await db.open();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const existingStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const envKeys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_SYNC_CODE",
  ] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://env-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "env-public-anon-key";
  process.env.NEXT_PUBLIC_SUPABASE_SYNC_CODE = "sentinel-private-code-must-be-ignored";
  try {
    assert.deepEqual(getCloudConfig(), {
      url: "https://env-project.supabase.co",
      key: "env-public-anon-key",
      syncCode: "",
    });
    assert.equal(supabaseClient(), null);
  } finally {
    for (const key of envKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (existingStorage) Object.defineProperty(globalThis, "localStorage", existingStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("cloud tenant changes wait for an active sync and recheck downloaded data", async () => {
  await db.delete();
  await db.open();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const existingStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const codeA = "tenant-a-business-code-1234567890";
  const configA = {
    url: "https://tenant-a.supabase.co",
    key: "tenant-a-public-key",
    syncCode: codeA,
  };
  let releasePull!: () => void;
  const pullGate = new Promise<void>((resolve) => { releasePull = resolve; });
  let signalPullStarted!: () => void;
  const pullStarted = new Promise<void>((resolve) => { signalPullStarted = resolve; });
  let signaled = false;
  const stamp = "2026-08-09T12:00:00.000Z";
  const delayedClient = {
    auth: {
      getSession: async () => ({ data: { session: { user: { user_metadata: { sync_code: codeA } } } } }),
      signOut: async () => ({ error: null }),
      signInAnonymously: async () => ({ data: { session: null }, error: null }),
    },
    from: (table: string) => ({
      upsert: async () => ({ data: null, error: null }),
      select: async () => {
        if (!signaled) { signaled = true; signalPullStarted(); }
        await pullGate;
        return {
          data: table === "parties" ? [{
            id: "tenant-a-party",
            name: "Tenant A Buyer",
            code_name: "TENANT-A",
            phone: "",
            address: "",
            type: "customer",
            price_tier: "wholesale",
            opening_balance: 0,
            current_balance: 0,
            notes: "",
            tags: [],
            created_at: stamp,
            updated_at: stamp,
          }] : [],
          error: null,
        };
      },
    }),
  } as unknown as Parameters<typeof syncWithClient>[0];
  try {
    await configureCloud(configA);
    const syncing = syncWithClient(delayedClient);
    await pullStarted;
    let switchSettled = false;
    const switching = configureCloud({
      url: "https://tenant-b.supabase.co",
      key: "tenant-b-public-key",
      syncCode: "tenant-b-business-code-1234567890",
    }).finally(() => { switchSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(switchSettled, false);
    releasePull();
    assert.equal(await syncing, "synced");
    await assert.rejects(switching, /another cloud business/);
    assert.equal((await db.parties.get("tenant-a-party"))?.name, "Tenant A Buyer");
    assert.deepEqual(getCloudConfig(), configA);
  } finally {
    if (existingStorage) Object.defineProperty(globalThis, "localStorage", existingStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    await db.delete();
  }
});

test("ledger reconciliation also rebuilds supplier purchase payables", async () => {
  await db.delete();
  await db.open();
  const stamp = "2026-08-08T12:00:00.000Z";
  const supplier = { ...sampleSuppliers[0], currentBalance: 500, openingBalance: 0, createdAt: stamp, updatedAt: stamp, isSynced: true };
  const purchase: Invoice = {
    id: "purchase-reconcile",
    invoiceNumber: "PUR-RECONCILE",
    partyId: supplier.id,
    partyName: supplier.name,
    date: "2026-08-08",
    type: "purchase",
    lineItems: [sampleInvoiceLine()],
    subtotal: 500,
    discountTotal: 0,
    gstTotal: 0,
    otherCharges: [],
    otherChargesTotal: 0,
    roundOff: 0,
    grandTotal: 500,
    amountPaid: 0,
    amountDue: 500,
    paymentMode: "credit",
    notes: "",
    isSynced: true,
    createdAt: stamp,
    updatedAt: stamp,
  };
  await db.parties.put(supplier);
  await db.invoices.put(purchase);
  await recordPayment(supplier, 100, "bank", "supplier transfer");
  await db.parties.update(supplier.id, { currentBalance: 999999, isSynced: true });
  await reconcilePartyBalances();
  assert.equal((await db.parties.get(supplier.id))?.currentBalance, 400);
  await db.delete();
});
