import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  priceKey,
  type AccountEntry,
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
  partyDueStatement,
  partyMatchesSearch,
  priceForParty,
  recordDue,
  recordPayment,
  saveQuotation,
  saveSale,
  shouldOfferInlineItemCreation,
} from "../lib/billing";
import {
  buildCashFlowReport,
  recordExpense,
  removeExpense,
  restoreExpense,
} from "../lib/cashflow";
import { cashFlowText, createCashFlowPdf } from "../lib/report-export";
import {
  createDueStatementPdf,
  dueStatementText,
  partyStatementLabel,
} from "../lib/due-statement-export";
import { invoicePdf } from "../lib/pdf";
import { itemProfitMetrics } from "../lib/item-profit";
import {
  sampleCategories,
  sampleItems,
  sampleParties,
  sampleSuppliers,
  seedIfNeeded,
} from "../lib/seed";
import { pendingCount, reconcilePartyBalances, syncDiagnostics, syncWithClient } from "../lib/sync";
import {
  buildDailySalesReport,
  buildDeadStockReport,
  buildItemProfitReport,
  buildMarginByPartyReport,
  buildPartySalesReport,
  buildReceivablesAging,
  buildTopRevenueItems,
} from "../lib/reports";
import { cataloguePdf, cataloguePrice } from "../lib/catalogue-pdf";
import {
  clearBillDraft,
  dailyCashSummary,
  loadBillDraft,
  mergeItems,
  mergeParties,
  normalizeWorkspace,
  ownerPinConfigured,
  pbkdf2Sha256Fallback,
  quantityPresets,
  saveBillDraft,
  saveDailyClose,
  setOwnerPin,
  variantFamily,
  verifyOwnerPin,
  withVariantFamily,
} from "../lib/qol";

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
  assert.match(text, /TOTAL\t\t\tRs\. 11,000\.00\tRs\. 7,000\.00\tRs\. 4,000\.00/);
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
  await recordPayment(afterSale, 30, "upi", "LATER-UPI");
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
      /^MB-\d{4}-\d{2}-[A-Z0-9]{4}-\d+$/.test(bill.invoiceNumber),
    ),
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
    ["item-never"],
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

  const invoice = await convertQuotationToInvoice(quotation.id);
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
  assert.equal(await db.invoices.where("type").equals("sale").count(), 1);
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
    partyId: "p-ramesh",
    lines: [line],
    paid: 500,
    paymentMode: "upi",
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
  assert.equal(restored?.otherCharges[0].amount, 25);
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

test("reviewed party and item merges preserve ledger ownership and archive sources", async () => {
  await db.delete();
  await db.open();
  await seedIfNeeded();
  const source = await createParty({ name: "Duplicate Buyer", codeName: "DUP-A", phone: "9000000011", address: "A", type: "customer", openingBalance: 100 });
  const target = await createParty({ name: "Duplicate Buyer", codeName: "DUP-B", phone: "9000000011", address: "B", type: "customer", openingBalance: 50 });
  const due = await recordDue(source, 75, "Old notebook due");
  await mergeParties(source.id, target.id);
  assert.equal((await db.accountEntries.get(due.id))?.partyId, target.id);
  assert.equal((await db.parties.get(target.id))?.currentBalance, 225);
  assert.ok((await db.parties.get(source.id))?.tags.includes(`mergedInto:${target.id}`));

  const sourceItem = { ...sampleItems[0], id: "merge-source", skuCode: "MERGE-A", currentStock: 4, saleCount: 2, isSynced: false };
  const targetItem = { ...sampleItems[0], id: "merge-target", skuCode: "MERGE-B", currentStock: 6, saleCount: 3, isSynced: false };
  await db.items.bulkPut([sourceItem, targetItem]);
  await mergeItems(sourceItem.id, targetItem.id);
  assert.equal((await db.items.get(sourceItem.id))?.isActive, false);
  assert.equal((await db.items.get(targetItem.id))?.currentStock, 10);
  assert.equal((await db.items.get(targetItem.id))?.saleCount, 5);
  assert.ok((await db.activityLogs.count()) >= 2);
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

function pagedSupabase(initial: Record<string, Record<string, unknown>[]>) {
  const tables = new Map(Object.entries(initial).map(([name, rows]) => [name, new Map(rows.map((row) => [String(row.id), structuredClone(row)]))]));
  const ranges: Record<string, number> = {};
  const batches: Record<string, number[]> = {};
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name)!; };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "paged", user_metadata: { sync_code: "test-business-sync-code-1234567890" } } } } }),
      signOut: async () => ({ error: null }),
      signInAnonymously: async () => ({ data: { session: null }, error: null }),
    },
    from: (name: string) => ({
      upsert: async (rows: Record<string, unknown>[]) => { batches[name] ||= []; batches[name].push(rows.length); for (const row of rows) table(name).set(String(row.id), structuredClone(row)); return { data: null, error: null }; },
      select: () => ({
        range: async (from: number, to: number) => { ranges[name] = (ranges[name] || 0) + 1; const rows = [...table(name).values()].slice(from, to + 1).map((row) => structuredClone(row)); return { data: rows, error: null }; },
      }),
    }),
  } as unknown as Parameters<typeof syncWithClient>[0];
  return { client, ranges, batches, rows: (name: string) => [...table(name).values()] };
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

test("sync downloads 2,501 products by page and uploads large changes in bounded batches", async () => {
  await db.delete();
  await db.open();
  const cloud = pagedSupabase({ items: Array.from({ length: 2501 }, (_, index) => remoteItem(index)) });
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.equal(await db.items.count(), 2501);
  assert.equal(cloud.ranges.items, 6);
  const changed = (await db.items.limit(205).toArray()).map((item, index) => ({ ...item, priceWholesale: 100 + index, updatedAt: "2026-12-01T00:00:00.000Z", isSynced: false }));
  await db.items.bulkPut(changed);
  assert.equal(await syncWithClient(cloud.client), "synced");
  assert.deepEqual(cloud.batches.items, [100, 100, 5]);
  assert.equal(await pendingCount(), 0);
  const info = await syncDiagnostics();
  assert.equal(info.totalPending, 0);
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
