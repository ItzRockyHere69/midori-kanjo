import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  type Category,
  type FestivalEntry,
  type Invoice,
  type InvoiceLine,
  type Item,
  type StockMovement,
} from "../lib/db";
import {
  buildFestivalPlan,
  buildPostSeasonLeftovers,
  choosePrimaryFestival,
  createFestivalEntry,
  ensureFestivalYear,
  festivalCalendarActivities,
  festivalCalendarMonthDays,
  festivalKeysForItem,
  festivalTaskId,
  itemHasFestivalTag,
  normalizeMergedFestivalTags,
  planningWindowStart,
  saveFestivalEntry,
  setFestivalTaskCompleted,
  setItemsFestivalTag,
} from "../lib/festivals";

const stamp = "2026-08-10T10:00:00.000Z";

const category = (id = "cat-mala", name = "Moti Mala"): Category => ({
  id,
  name,
  festivalSeason: [],
  createdAt: stamp,
  updatedAt: stamp,
  isSynced: false,
});

const item = (id: string, overrides: Partial<Item> = {}): Item => ({
  id,
  name: `Product ${id}`,
  nameHi: "",
  nameBn: "",
  skuCode: id.toUpperCase(),
  categoryId: "cat-mala",
  baseUnit: "piece",
  conversionRate: 1,
  purchasePrice: 10,
  priceRetail: 20,
  priceWholesale: 18,
  priceBulk: 16,
  currentStock: 3,
  lowStockAlert: null,
  festivalTags: ["durga_puja"],
  gstRate: 0,
  isActive: true,
  saleCount: 0,
  createdAt: stamp,
  updatedAt: stamp,
  isSynced: true,
  ...overrides,
});

const line = (product: Item, qty: number, amount = qty * 18): InvoiceLine => ({
  itemId: product.id,
  itemName: product.name,
  skuCode: product.skuCode,
  hsnCode: "",
  qty,
  unit: product.baseUnit,
  baseUnit: product.baseUnit,
  rate: 18,
  discount: 0,
  taxableAmount: amount,
  gstRate: 0,
  gstAmount: 0,
  amount,
});

const invoice = (id: string, date: string, lines: InvoiceLine[]): Invoice => {
  const total = lines.reduce((sum, row) => sum + row.amount, 0);
  return {
    id,
    invoiceNumber: id.toUpperCase(),
    partyName: "Cash customer",
    date,
    type: "sale",
    lineItems: lines,
    subtotal: total,
    discountTotal: 0,
    gstTotal: 0,
    otherCharges: [],
    otherChargesTotal: 0,
    roundOff: 0,
    grandTotal: total,
    initialAmountPaid: total,
    amountPaid: total,
    amountDue: 0,
    paymentMode: "cash",
    paymentReceivedMode: "cash",
    notes: "",
    isSynced: false,
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
  };
};

const saleReturn = (id: string, date: string, sourceInvoiceId: string, lines: InvoiceLine[]): Invoice => ({
  ...invoice(id, date, lines),
  type: "sale_return",
  returnDetails: {
    sourceInvoiceId,
    allocations: [],
    balanceApplied: 0,
    settlementAmount: 0,
  },
});

const manualSaleReturn = (id: string, date: string, lines: InvoiceLine[]): Invoice => ({
  ...invoice(id, date, lines),
  type: "sale_return",
  returnDetails: {
    allocations: [],
    balanceApplied: 0,
    settlementAmount: 0,
  },
});

const movement = (
  id: string,
  itemId: string,
  date: string,
  stockAfter: number,
  overrides: Partial<StockMovement> = {},
): StockMovement => ({
  id,
  itemId,
  kind: "baseline",
  reason: "test_baseline",
  note: "",
  qtyChange: null,
  stockBefore: null,
  stockAfter,
  applied: true,
  date,
  actor: "owner",
  createdAt: `${date}T10:00:00.000Z`,
  updatedAt: `${date}T10:00:00.000Z`,
  isSynced: false,
  ...overrides,
});

const occurrence = (year: number, startDate: string, endDate = startDate): FestivalEntry => ({
  ...createFestivalEntry("durga_puja", year, stamp),
  startDate,
  endDate,
  leadTimeWeeks: 0,
});

test("calendar helpers build a stable six-week month and order overlapping phases", () => {
  const august = festivalCalendarMonthDays(2026, 7);
  assert.equal(august.length, 42);
  assert.equal(august[0].date, "2026-07-26");
  assert.equal(august.at(-1)?.date, "2026-09-05");
  assert.equal(august.filter((day) => day.inMonth).length, 31);
  assert.equal(august.findIndex((day) => day.date === "2026-08-01"), 6);
  assert.throws(() => festivalCalendarMonthDays(2026, 12), /valid calendar month/);
  assert.throws(() => festivalCalendarMonthDays(Number.NaN, 7), /valid calendar month/);

  const durga = createFestivalEntry("durga_puja", 2026, stamp);
  const kali = createFestivalEntry("kali_puja", 2026, stamp);
  assert.deepEqual(festivalCalendarActivities([durga], "2026-09-18"), []);
  assert.deepEqual(festivalCalendarActivities([durga], "2026-09-19").map((row) => row.phase), ["planning"]);
  assert.deepEqual(festivalCalendarActivities([durga], "2026-10-17").map((row) => row.phase), ["festival"]);
  assert.deepEqual(festivalCalendarActivities([durga], "2026-10-21").map((row) => row.phase), ["festival"]);
  assert.deepEqual(festivalCalendarActivities([durga], "2026-10-22"), []);
  assert.equal(planningWindowStart(kali), "2026-10-11");
  assert.deepEqual(
    festivalCalendarActivities([kali, durga], "2026-10-17").map((row) => [row.entry.festivalKey, row.phase]),
    [["durga_puja", "festival"], ["kali_puja", "planning"]],
  );
});

test("calendar activities include cross-year planning and react immediately to edited dates", () => {
  const newYear = createFestivalEntry("new_year", 2027, stamp);
  const wedding = createFestivalEntry("wedding", 2026, stamp);
  assert.deepEqual(
    festivalCalendarActivities([newYear], "2026-12-04").map((row) => row.phase),
    ["planning"],
  );
  assert.deepEqual(
    festivalCalendarActivities([wedding], "2027-02-28").map((row) => row.phase),
    ["festival"],
  );
  const edited = { ...newYear, startDate: "2027-01-10", endDate: "2027-01-10", leadTimeWeeks: 1 };
  assert.deepEqual(festivalCalendarActivities([edited], "2026-12-04"), []);
  assert.deepEqual(festivalCalendarActivities([edited], "2027-01-03").map((row) => row.phase), ["planning"]);
  assert.deepEqual(festivalCalendarActivities([edited], "2027-01-10").map((row) => row.phase), ["festival"]);
});

test("concurrent calendar navigation seeds one complete year without duplicate rows", async () => {
  await db.delete();
  await db.open();
  try {
    await Promise.all([
      ensureFestivalYear(2028),
      ensureFestivalYear(2028),
      ensureFestivalYear(2028),
    ]);
    const rows = await db.festivalEntries.where("year").equals(2028).toArray();
    assert.equal(rows.length, 15);
    assert.equal(new Set(rows.map((row) => row.id)).size, 15);
  } finally {
    await db.delete();
  }
});

test("festival dates, lead windows and completed tasks persist across an offline close and reopen", async () => {
  await db.delete();
  await db.open();
  const existingFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("Network must not be used by festival planning");
  }) as typeof fetch;
  try {
    await ensureFestivalYear(2026);
    await ensureFestivalYear(2024);
    assert.equal((await db.festivalEntries.get("durga_puja:2024"))?.startDate, "2024-10-09");
    const staleDurga = (await db.festivalEntries.get("durga_puja:2024"))!;
    await db.festivalEntries.put({
      ...staleDurga,
      startDate: "2024-09-28",
      endDate: "2024-10-02",
      dateStatus: "provisional",
      sourceNote: "Provisional rollover; review this lunar/regional date before planning",
    });
    await ensureFestivalYear(2024);
    assert.deepEqual(
      {
        startDate: (await db.festivalEntries.get("durga_puja:2024"))?.startDate,
        endDate: (await db.festivalEntries.get("durga_puja:2024"))?.endDate,
        dateStatus: (await db.festivalEntries.get("durga_puja:2024"))?.dateStatus,
      },
      { startDate: "2024-10-09", endDate: "2024-10-12", dateStatus: "verified" },
    );
    const durga = (await db.festivalEntries.get("durga_puja:2026"))!;
    await assert.rejects(
      saveFestivalEntry({ ...durga, startDate: "2027-09-10", endDate: "2027-09-14" }),
      /calendar year/,
    );
    const edited = await saveFestivalEntry({
      ...durga,
      startDate: "2026-09-10",
      endDate: "2026-09-14",
      leadTimeWeeks: 4,
      dateStatus: "business_estimate",
    });
    await setFestivalTaskCompleted(edited.id, true);
    assert.equal(planningWindowStart(edited), "2026-08-13");
    assert.equal(choosePrimaryFestival([edited], "2026-08-10")?.startDate, "2026-09-10");
    db.close();
    await db.open();
    assert.equal((await db.festivalEntries.get(edited.id))?.startDate, "2026-09-10");
    assert.ok((await db.festivalTasks.get(festivalTaskId(edited.id)))?.completedAt);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = existingFetch;
    await db.delete();
  }
});

test("bulk category tagging updates every selected active product while preserving reserved and legacy tags", async () => {
  await db.delete();
  await db.open();
  try {
    const rows = [
      item("mala-a", { festivalTags: ["family:Moti 12", "diwali"] }),
      item("mala-b", { festivalTags: ["aliasOf:live-target", "christmas"] }),
      item("other", { categoryId: "cat-other", festivalTags: [] }),
    ];
    await db.items.bulkPut(rows);
    const filteredIds = rows.filter((row) => row.categoryId === "cat-mala").map((row) => row.id);
    await setItemsFestivalTag(filteredIds, "durga_puja", true);
    const updated = (await db.items.bulkGet(filteredIds)) as Item[];
    assert.equal(updated.every((row) => itemHasFestivalTag(row, "durga_puja")), true);
    assert.equal(updated[0].festivalTags.includes("family:Moti 12"), true);
    assert.equal(updated[0].festivalTags.includes("diwali"), true);
    assert.equal(updated[1].festivalTags.includes("aliasOf:live-target"), true);
    assert.equal(updated.every((row) => new Set(row.festivalTags).size === row.festivalTags.length), true);
    assert.equal(updated.every((row) => row.isSynced === false), true);
    assert.deepEqual(festivalKeysForItem(updated[0]).sort(), ["durga_puja", "kali_puja"]);
    assert.equal((await db.items.get("other"))?.festivalTags.length, 0);
  } finally {
    await db.delete();
  }
});

test("legacy merged festival tags move to the editable active target exactly once", async () => {
  await db.delete();
  await db.open();
  try {
    const target = item("merged-target", { festivalTags: [] });
    const source = item("merged-source", {
      isActive: false,
      festivalTags: ["family:Legacy", "durga_puja", "diwali", `aliasOf:${target.id}`],
    });
    await db.items.bulkPut([target, source]);
    await normalizeMergedFestivalTags();
    const movedTarget = (await db.items.get(target.id))!;
    const cleanedSource = (await db.items.get(source.id))!;
    assert.equal(itemHasFestivalTag(movedTarget, "durga_puja"), true);
    assert.equal(itemHasFestivalTag(movedTarget, "kali_puja"), true);
    assert.equal(movedTarget.festivalTags.includes("diwali"), true);
    assert.equal(festivalKeysForItem(cleanedSource).length, 0);
    assert.equal(cleanedSource.festivalTags.includes("family:Legacy"), true);
    assert.equal(cleanedSource.festivalTags.includes(`aliasOf:${target.id}`), true);
    await setItemsFestivalTag([target.id], "durga_puja", false);
    await normalizeMergedFestivalTags();
    assert.equal(itemHasFestivalTag((await db.items.get(target.id))!, "durga_puja"), false);
  } finally {
    await db.delete();
  }
});

test("festival analysis distinguishes zero, one and multiple covered seasons and suggests reorder from counted stock", () => {
  const tracked = item("tracked", { currentStock: 3, festivalTags: ["durga_puja"] });
  const bookend = item("bookend", { categoryId: "cat-other", festivalTags: [] });
  const categories = [category(), category("cat-other", "Other")];
  const entries = [
    occurrence(2024, "2024-01-01", "2024-01-07"),
    occurrence(2025, "2025-01-01", "2025-01-07"),
    occurrence(2026, "2026-01-01", "2026-01-07"),
  ];

  const zero = buildFestivalPlan(entries[2], entries, [tracked, bookend], categories, [], "2025-12-01");
  assert.deepEqual(zero.historyYears, []);
  assert.equal(zero.products[0].reorderState, "no_history");
  assert.equal(zero.comparison, null);

  const sourceSale = invoice("y25-start", "2025-01-01", [line(tracked, 10)]);
  const oneYearInvoices = [
    sourceSale,
    invoice("y25-end", "2025-01-07", [line(bookend, 1)]),
    saleReturn("y25-late-return", "2026-02-01", sourceSale.id, [line(tracked, 2)]),
    manualSaleReturn("unattributed-return", "2025-01-03", [line(tracked, 4)]),
  ];
  const one = buildFestivalPlan(entries[2], entries, [tracked, bookend], categories, oneYearInvoices, "2025-12-01");
  assert.deepEqual(one.historyYears, [2025]);
  assert.equal(one.products[0].lastSeasonQuantity, 8);
  assert.equal(one.products[0].reorderSuggestion, 5);
  assert.equal(one.comparison, null);

  const multiple = buildFestivalPlan(entries[2], entries, [tracked, bookend], categories, [
    invoice("y24-start", "2024-01-01", [line(tracked, 6)]),
    invoice("y24-end", "2024-01-07", [line(bookend, 1)]),
    ...oneYearInvoices,
  ], "2025-12-01");
  assert.deepEqual(multiple.historyYears, [2024, 2025]);
  assert.equal(multiple.comparison?.current.year, 2025);
  assert.equal(multiple.comparison?.previous.year, 2024);
  assert.equal(multiple.comparison?.itemRows.find((row) => row.itemId === tracked.id)?.currentQuantity, 8);
});

test("merged source invoice lines feed its tagged active target reorder plan", () => {
  const target = item("target", { currentStock: 2, festivalTags: ["durga_puja"] });
  const source = item("source", { isActive: false, festivalTags: ["aliasOf:target"] });
  const bookend = item("coverage", { categoryId: "cat-other", festivalTags: [] });
  const entries = [
    occurrence(2025, "2025-01-01", "2025-01-07"),
    occurrence(2026, "2026-01-01", "2026-01-07"),
  ];
  const plan = buildFestivalPlan(entries[1], entries, [target, source, bookend], [category(), category("cat-other", "Other")], [
    invoice("source-sale", "2025-01-01", [line(source, 5)]),
    invoice("coverage-end", "2025-01-07", [line(bookend, 1)]),
  ], "2025-12-01");
  assert.deepEqual(plan.products.map((row) => row.item.id), [target.id]);
  assert.equal(plan.products[0].lastSeasonQuantity, 5);
  assert.equal(plan.products[0].reorderSuggestion, 3);
});

test("post-season leftovers apply the threshold rule and carry multi-season products forward", () => {
  const past = {
    ...createFestivalEntry("durga_puja", 2026, stamp),
    startDate: "2026-10-17",
    endDate: "2026-10-21",
    leadTimeWeeks: 4,
  };
  const upcoming = {
    ...createFestivalEntry("kali_puja", 2026, stamp),
    startDate: "2026-11-08",
    endDate: "2026-11-08",
    leadTimeWeeks: 4,
  };
  const carry = item("carry", { currentStock: 5, lowStockAlert: 3, festivalTags: ["durga_puja", "diwali"] });
  const equal = item("equal", { currentStock: 3, lowStockAlert: 3 });
  const positive = item("positive", { currentStock: 1, lowStockAlert: null });
  const unknown = item("unknown", { currentStock: null, lowStockAlert: null });
  const negative = item("negative", { currentStock: -2, lowStockAlert: null });
  const laterInward = item("later-inward", { currentStock: 10, lowStockAlert: 3 });
  const backdatedInward = item("backdated-inward", { currentStock: 10, lowStockAlert: 3 });
  const depletedThenRestocked = item("depleted", { currentStock: 10, lowStockAlert: null });
  const returnedAfterSeason = item("returned", { currentStock: 2, lowStockAlert: null });
  const voidedAfterSeason = item("voided", { currentStock: 1, lowStockAlert: null });
  const returnSource = invoice("return-source", "2026-10-01", [line(returnedAfterSeason, 2)]);
  const voidSource = invoice("void-source", "2026-10-02", [line(voidedAfterSeason, 1)]);
  const rows = buildPostSeasonLeftovers([past, upcoming], [
    carry,
    equal,
    positive,
    unknown,
    negative,
    laterInward,
    backdatedInward,
    depletedThenRestocked,
    returnedAfterSeason,
    voidedAfterSeason,
  ], [
    movement("carry-end", carry.id, past.endDate, 5),
    movement("equal-end", equal.id, past.endDate, 3),
    movement("positive-end", positive.id, past.endDate, 1),
    movement("later-end", laterInward.id, past.endDate, 2),
    movement("later-receipt", laterInward.id, "2026-10-22", 10, { kind: "inward", stockBefore: 2, qtyChange: 8 }),
    movement("backdated-end", backdatedInward.id, past.endDate, 2, { createdAt: "2026-10-21T10:00:00.000Z" }),
    movement("backdated-receipt", backdatedInward.id, "2026-10-20", 10, { kind: "inward", stockBefore: 2, qtyChange: 8, createdAt: "2026-10-22T10:00:00.000Z" }),
    movement("depleted-end", depletedThenRestocked.id, past.endDate, 5),
    movement("depleted-sale", depletedThenRestocked.id, "2026-10-22", 0, { kind: "sale", stockBefore: 5, qtyChange: -5, createdAt: "2026-10-22T09:00:00.000Z" }),
    movement("depleted-receipt", depletedThenRestocked.id, "2026-10-22", 10, { kind: "inward", stockBefore: 0, qtyChange: 10, createdAt: "2026-10-22T11:00:00.000Z" }),
    movement("returned-end", returnedAfterSeason.id, past.endDate, 0),
    movement("returned-stock", returnedAfterSeason.id, "2026-10-22", 2, { kind: "sale_return", stockBefore: 0, qtyChange: 2, sourceInvoiceId: returnSource.id }),
    movement("voided-end", voidedAfterSeason.id, past.endDate, 0),
    movement("voided-stock", voidedAfterSeason.id, "2026-10-22", 1, { kind: "sale_void", stockBefore: 0, qtyChange: 1, refInvoiceId: voidSource.id }),
  ], [returnSource, voidSource], "2026-10-22");
  assert.deepEqual(rows.map((row) => row.item.id).sort(), ["carry", "positive", "returned", "voided"]);
  assert.equal(rows.find((row) => row.item.id === "carry")?.carryTo?.festivalKey, "kali_puja");
  assert.equal(rows.find((row) => row.item.id === "positive")?.carryTo, undefined);
  assert.equal(rows.find((row) => row.item.id === "positive")?.remainingStock, 1);

  const nextYearSameFestival = createFestivalEntry("durga_puja", 2027, stamp);
  const putAway = item("put-away", { currentStock: 2, lowStockAlert: null, festivalTags: ["durga_puja"] });
  const sameFestivalOnly = buildPostSeasonLeftovers([past, nextYearSameFestival], [putAway], [
    movement("put-away-end", putAway.id, past.endDate, 2),
  ], [], "2026-10-22");
  assert.equal(sameFestivalOnly[0]?.carryTo, undefined);
});
