import {
  db,
  isValidLocalDate,
  localDate,
  makeId,
  nowIso,
  type CountLine,
  type CountSession,
  type Invoice,
  type InvoiceLine,
  type Item,
  type Party,
  type PaymentChannel,
  type StockMovement,
  type StockMovementKind,
  type Unit,
} from "./db";

const STANDARD_UNIT_FACTOR: Partial<Record<Unit, number>> = {
  piece: 1,
  dozen: 12,
  gross: 144,
};

export const roundQuantity = (value: number) =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function convertQuantity(quantity: number, from: Unit, to: Unit) {
  if (!Number.isFinite(quantity)) throw new Error("Enter a valid stock quantity.");
  if (from === to) return roundQuantity(quantity);
  const fromFactor = STANDARD_UNIT_FACTOR[from];
  const toFactor = STANDARD_UNIT_FACTOR[to];
  if (!fromFactor || !toFactor) {
    throw new Error(`${from} cannot be converted to ${to}. Use the product's base unit.`);
  }
  return roundQuantity(quantity * fromFactor / toFactor);
}

function convertRate(rate: number, from: Unit, to: Unit) {
  if (from === to) return roundMoney(rate);
  const fromFactor = STANDARD_UNIT_FACTOR[from];
  const toFactor = STANDARD_UNIT_FACTOR[to];
  if (!fromFactor || !toFactor) return roundMoney(rate);
  return roundMoney(rate * toFactor / fromFactor);
}

function validatePositiveQuantity(value: number, label = "quantity") {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Enter a valid ${label}.`);
}

function validateDate(value: string) {
  if (!isValidLocalDate(value)) throw new Error("Choose a valid stock date.");
}

// `date` is the operator's business date; creation time is the causal clock
// used for replay and sync. Backdated entries must still sort after entries
// that were recorded earlier.
function movementTimestamp() {
  return nowIso();
}

export async function resolveInventoryItem(itemId: string) {
  const seen = new Set<string>();
  let item = await db.items.get(itemId);
  while (item && !item.isActive) {
    if (seen.has(item.id)) break;
    seen.add(item.id);
    const aliasId = item.festivalTags
      .find((tag) => tag.startsWith("aliasOf:"))
      ?.slice("aliasOf:".length)
      .trim();
    if (!aliasId) break;
    const next = await db.items.get(aliasId);
    if (!next) break;
    item = next;
  }
  return item;
}

type RelativeMovementInput = {
  id?: string;
  itemId: string;
  kind: Exclude<StockMovementKind, "baseline" | "manual_adjustment" | "count_adjustment">;
  reason: string;
  note?: string;
  qtyChange: number;
  date?: string;
  actor?: StockMovement["actor"];
  entryQty?: number;
  entryUnit?: Unit;
  packCount?: number;
  unitsPerPack?: number;
  containedUnit?: Unit;
  refInvoiceId?: string;
  sourceInvoiceId?: string;
  countSessionId?: string;
  partyId?: string;
  supplierReference?: string;
};

/**
 * Records one relative event. Callers may include this helper in a wider Dexie
 * transaction; a deterministic id makes retries safe.
 */
export async function applyRelativeStockMovement(
  input: RelativeMovementInput,
): Promise<StockMovement> {
  const item = await resolveInventoryItem(input.itemId);
  if (!item) throw new Error("This product no longer exists.");
  const existing = input.id ? await db.stockMovements.get(input.id) : undefined;
  if (existing) {
    const requested = roundQuantity(input.qtyChange);
    if (
      existing.itemId !== item.id ||
      existing.kind !== input.kind ||
      existing.qtyChange !== requested ||
      (existing.refInvoiceId || "") !== (input.refInvoiceId || "")
    ) throw new Error("A stock operation ID was already used for a different movement.");
    return existing;
  }
  const qtyChange = roundQuantity(input.qtyChange);
  if (!Number.isFinite(qtyChange) || qtyChange === 0) {
    throw new Error("Stock movement must change the quantity.");
  }
  const date = input.date || localDate();
  validateDate(date);
  const createdAt = movementTimestamp();
  const stockBefore = item.currentStock;
  const applied = stockBefore !== null;
  const stockAfter = applied ? roundQuantity(stockBefore + qtyChange) : null;
  const movement: StockMovement = {
    id: input.id || makeId(),
    itemId: item.id,
    kind: input.kind,
    reason: input.reason,
    note: input.note?.trim() || "",
    qtyChange,
    stockBefore,
    stockAfter,
    applied,
    ...(input.entryQty == null ? {} : { entryQty: roundQuantity(input.entryQty) }),
    ...(input.entryUnit ? { entryUnit: input.entryUnit } : {}),
    ...(input.packCount == null ? {} : { packCount: roundQuantity(input.packCount) }),
    ...(input.unitsPerPack == null ? {} : { unitsPerPack: roundQuantity(input.unitsPerPack) }),
    ...(input.containedUnit ? { containedUnit: input.containedUnit } : {}),
    ...(input.refInvoiceId ? { refInvoiceId: input.refInvoiceId } : {}),
    ...(input.sourceInvoiceId ? { sourceInvoiceId: input.sourceInvoiceId } : {}),
    ...(input.countSessionId ? { countSessionId: input.countSessionId } : {}),
    ...(input.partyId ? { partyId: input.partyId } : {}),
    ...(input.supplierReference?.trim() ? { supplierReference: input.supplierReference.trim() } : {}),
    date,
    actor: input.actor || "staff",
    createdAt,
    updatedAt: createdAt,
    isSynced: false,
  };
  await db.stockMovements.add(movement);
  if (applied) {
    await db.items.update(item.id, {
      currentStock: stockAfter,
      updatedAt: createdAt,
      isSynced: false,
    });
  }
  return movement;
}

export type StockReceiptInput = {
  operationId?: string;
  itemId: string;
  quantity?: number;
  unit?: Unit;
  packCount?: number;
  unitsPerPack?: number;
  containedUnit?: Unit;
  supplierId?: string;
  supplierReference?: string;
  purchasePrice?: number;
  date?: string;
  note?: string;
  startFromZero?: boolean;
  actor?: StockMovement["actor"];
};

function receiptBaseQuantity(item: Item, input: StockReceiptInput) {
  if (input.packCount != null || input.unitsPerPack != null) {
    validatePositiveQuantity(Number(input.packCount), "pack count");
    validatePositiveQuantity(Number(input.unitsPerPack), "quantity per pack");
    if (!input.containedUnit) throw new Error("Choose the unit contained in each pack.");
    return convertQuantity(
      Number(input.packCount) * Number(input.unitsPerPack),
      input.containedUnit,
      item.baseUnit,
    );
  }
  validatePositiveQuantity(Number(input.quantity));
  return convertQuantity(Number(input.quantity), input.unit || item.baseUnit, item.baseUnit);
}

export async function recordStockInward(input: StockReceiptInput) {
  const date = input.date || localDate();
  validateDate(date);
  if (input.startFromZero && input.actor !== "owner") {
    throw new Error("Owner unlock is required to start unknown stock from zero.");
  }
  if (input.purchasePrice != null) {
    if (input.actor !== "owner") throw new Error("Owner unlock is required to update purchase cost.");
    if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) {
      throw new Error("Enter a valid purchase cost.");
    }
  }
  return db.transaction("rw", [db.items, db.stockMovements, db.parties], async () => {
    const item = await resolveInventoryItem(input.itemId);
    if (!item) throw new Error("This product no longer exists.");
    const supplier = input.supplierId ? await db.parties.get(input.supplierId) : undefined;
    if (input.supplierId && (!supplier || supplier.type !== "supplier")) {
      throw new Error("Choose a valid supplier.");
    }
    const baseQuantity = receiptBaseQuantity(item, input);
    const movementId = input.operationId || makeId();
    const existing = await db.stockMovements.get(movementId);
    if (existing) {
      if (
        existing.itemId !== item.id ||
        existing.kind !== "inward" ||
        existing.qtyChange !== baseQuantity ||
        (existing.partyId || "") !== (supplier?.id || "") ||
        (existing.supplierReference || "") !== (input.supplierReference?.trim() || "")
      ) throw new Error("A stock operation ID was already used for a different receipt.");
      return existing;
    }
    const createdAt = movementTimestamp();
    const stockWasUnknown = item.currentStock === null;
    const initialize = stockWasUnknown && Boolean(input.startFromZero);
    const stockBefore = initialize ? 0 : item.currentStock;
    const applied = stockBefore !== null;
    const stockAfter = applied ? roundQuantity(stockBefore + baseQuantity) : null;
    const movement: StockMovement = {
      id: movementId,
      itemId: item.id,
      kind: "inward",
      reason: supplier || input.supplierReference?.trim() ? "purchase_receipt" : "inward",
      note: [input.note?.trim(), initialize ? "Owner started unknown stock from zero." : ""].filter(Boolean).join(" "),
      qtyChange: baseQuantity,
      stockBefore,
      stockAfter,
      applied,
      ...(input.quantity == null ? {} : { entryQty: roundQuantity(input.quantity) }),
      ...(input.unit ? { entryUnit: input.unit } : {}),
      ...(input.packCount == null ? {} : { packCount: roundQuantity(input.packCount) }),
      ...(input.unitsPerPack == null ? {} : { unitsPerPack: roundQuantity(input.unitsPerPack) }),
      ...(input.containedUnit ? { containedUnit: input.containedUnit } : {}),
      ...(supplier ? { partyId: supplier.id } : {}),
      ...(input.supplierReference?.trim() ? { supplierReference: input.supplierReference.trim() } : {}),
      date,
      actor: input.actor || "staff",
      createdAt,
      updatedAt: createdAt,
      isSynced: false,
    };
    await db.stockMovements.add(movement);
    const itemPatch: Partial<Item> = {
      ...(applied ? { currentStock: stockAfter } : {}),
      ...(input.purchasePrice == null ? {} : { purchasePrice: roundMoney(input.purchasePrice) }),
    };
    if (applied || input.purchasePrice != null) {
      await db.items.update(item.id, { ...itemPatch, updatedAt: createdAt, isSynced: false });
    }
    return movement;
  });
}

export type StockOutReason = "damage" | "sample" | "internal_use" | "other";

export async function recordStockOutward(input: {
  operationId?: string;
  itemId: string;
  quantity: number;
  unit: Unit;
  reason: StockOutReason;
  note?: string;
  date?: string;
  actor?: StockMovement["actor"];
}) {
  validatePositiveQuantity(input.quantity);
  if (!(["damage", "sample", "internal_use", "other"] as const).includes(input.reason)) {
    throw new Error("Choose a valid stock-out reason.");
  }
  if (input.reason === "other" && !input.note?.trim()) {
    throw new Error("Enter a note for the other stock-out reason.");
  }
  const date = input.date || localDate();
  validateDate(date);
  return db.transaction("rw", [db.items, db.stockMovements], async () => {
    const item = await resolveInventoryItem(input.itemId);
    if (!item) throw new Error("This product no longer exists.");
    const baseQuantity = convertQuantity(input.quantity, input.unit, item.baseUnit);
    return applyRelativeStockMovement({
      id: input.operationId,
      itemId: item.id,
      kind: "outward",
      reason: input.reason,
      note: input.note,
      qtyChange: -baseQuantity,
      entryQty: input.quantity,
      entryUnit: input.unit,
      date,
      actor: input.actor,
    });
  });
}

export async function setStockAbsolute(input: {
  operationId?: string;
  itemId: string;
  actualStock: number;
  reason: string;
  date?: string;
  actor: "owner";
}) {
  if (input.actor !== "owner") throw new Error("Owner unlock is required to adjust stock.");
  if (!input.reason.trim()) throw new Error("Enter a reason for this stock adjustment.");
  if (!Number.isFinite(input.actualStock) || input.actualStock < 0) {
    throw new Error("Enter a valid non-negative actual stock quantity.");
  }
  const date = input.date || localDate();
  validateDate(date);
  return db.transaction("rw", [db.items, db.stockMovements], async () => {
    const item = await resolveInventoryItem(input.itemId);
    if (!item) throw new Error("This product no longer exists.");
    const createdAt = movementTimestamp();
    const stockAfter = roundQuantity(input.actualStock);
    const movementId = input.operationId || makeId();
    const existing = await db.stockMovements.get(movementId);
    if (existing) {
      if (
        existing.itemId !== item.id ||
        existing.kind !== "manual_adjustment" ||
        existing.stockAfter !== stockAfter
      ) throw new Error("A stock operation ID was already used for a different adjustment.");
      return existing;
    }
    const movement: StockMovement = {
      id: movementId,
      itemId: item.id,
      kind: "manual_adjustment",
      reason: "manual_adjustment",
      note: input.reason.trim(),
      qtyChange: item.currentStock === null ? null : roundQuantity(stockAfter - item.currentStock),
      stockBefore: item.currentStock,
      stockAfter,
      applied: true,
      date,
      actor: "owner",
      createdAt,
      updatedAt: createdAt,
      isSynced: false,
    };
    await db.stockMovements.add(movement);
    await db.items.update(item.id, {
      currentStock: stockAfter,
      updatedAt: createdAt,
      isSynced: false,
    });
    return movement;
  });
}

export interface InventoryReturnLineInput {
  sourceLineIndex?: number;
  itemId?: string;
  qty: number;
  unit?: Unit;
  rate?: number;
  discount?: number;
  gstRate?: number;
}

function calculateReturnLine(line: Pick<InvoiceLine, "qty" | "rate" | "discount" | "gstRate">) {
  const gross = roundMoney(line.qty * line.rate);
  const discountAmount = roundMoney(gross * line.discount / 100);
  const taxableAmount = roundMoney(gross - discountAmount);
  const gstAmount = roundMoney(taxableAmount * line.gstRate / 100);
  return { taxableAmount, gstAmount, amount: roundMoney(taxableAmount + gstAmount) };
}

function returnPrimaryType(type: "sale_return" | "purchase_return") {
  return type === "sale_return" ? "sale" as const : "purchase" as const;
}

async function reserveReturnInvoiceNumber() {
  const row = await db.meta.get("invoice-counter");
  const next = Number(row?.value || 1001);
  const storedDevice = await db.meta.get("invoice-device-code");
  const deviceCode = String(
    storedDevice?.value || makeId().replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase().padStart(8, "0"),
  );
  if (!storedDevice) await db.meta.put({ key: "invoice-device-code", value: deviceCode });
  await db.meta.put({ key: "invoice-counter", value: next + 1 });
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `MB-${fyStart}-${String(fyStart + 1).slice(-2)}-${deviceCode}-${next}`;
}

async function buildReturnLines(
  returnType: "sale_return" | "purchase_return",
  source: Invoice | undefined,
  inputLines: InventoryReturnLineInput[],
) {
  if (!inputLines.length) throw new Error("Add at least one returned product.");
  const items = new Map<string, Item>();
  for (const input of inputLines) {
    const sourceLine = input.sourceLineIndex == null ? undefined : source?.lineItems[input.sourceLineIndex];
    const itemId = sourceLine?.itemId || input.itemId;
    if (!itemId) throw new Error("Choose a returned product.");
    const item = await db.items.get(itemId);
    if (!item) throw new Error("A returned product no longer exists.");
    items.set(item.id, item);
  }

  const previousReturns = source
    ? await db.invoices
        .filter((invoice) =>
          !invoice.deletedAt &&
          invoice.type === returnType &&
          invoice.returnDetails?.sourceInvoiceId === source.id,
        )
        .toArray()
    : [];
  const alreadyReturned = new Map<number, number>();
  for (const previous of previousReturns) {
    for (const line of previous.lineItems) {
      if (line.sourceLineIndex == null) continue;
      const sourceLine = source!.lineItems[line.sourceLineIndex];
      if (!sourceLine) continue;
      const item = items.get(line.itemId) || await db.items.get(line.itemId);
      const baseUnit = item?.baseUnit || sourceLine.baseUnit || sourceLine.unit;
      alreadyReturned.set(
        line.sourceLineIndex,
        roundQuantity((alreadyReturned.get(line.sourceLineIndex) || 0) + convertQuantity(line.qty, line.unit, baseUnit)),
      );
    }
  }

  const requestedBySourceLine = new Map<number, number>();
  const lines: InvoiceLine[] = [];
  for (const input of inputLines) {
    validatePositiveQuantity(input.qty);
    const sourceLine = input.sourceLineIndex == null ? undefined : source?.lineItems[input.sourceLineIndex];
    if (input.sourceLineIndex != null && !sourceLine) throw new Error("The original invoice line is unavailable.");
    const item = items.get(sourceLine?.itemId || input.itemId!);
    if (!item) throw new Error("A returned product no longer exists.");
    const unit = input.unit || sourceLine?.unit || item.baseUnit;
    const rate = sourceLine
      ? convertRate(sourceLine.rate, sourceLine.unit, unit)
      : Number(input.rate);
    const discount = sourceLine?.discount ?? Number(input.discount || 0);
    const gstRate = sourceLine?.gstRate ?? Number(input.gstRate ?? item.gstRate);
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`Enter a valid return rate for ${item.name}.`);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error(`Enter a valid discount for ${item.name}.`);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error(`Enter a valid GST rate for ${item.name}.`);
    if (sourceLine && input.sourceLineIndex != null) {
      const sourceBase = convertQuantity(sourceLine.qty, sourceLine.unit, item.baseUnit);
      const requestedBase = convertQuantity(input.qty, unit, item.baseUnit);
      const cumulativeRequested = roundQuantity((requestedBySourceLine.get(input.sourceLineIndex) || 0) + requestedBase);
      requestedBySourceLine.set(input.sourceLineIndex, cumulativeRequested);
      const used = alreadyReturned.get(input.sourceLineIndex) || 0;
      if (roundQuantity(used + cumulativeRequested) - sourceBase > 0.000001) {
        throw new Error(`${item.name} return quantity exceeds the original invoice quantity.`);
      }
    }
    const calculated = calculateReturnLine({ qty: input.qty, rate, discount, gstRate });
    lines.push({
      itemId: item.id,
      itemName: sourceLine?.itemName || item.name,
      itemNameHi: sourceLine?.itemNameHi || item.nameHi,
      itemNameBn: sourceLine?.itemNameBn || item.nameBn,
      skuCode: sourceLine?.skuCode || item.skuCode,
      hsnCode: sourceLine?.hsnCode || item.hsnCode || "",
      qty: roundQuantity(input.qty),
      unit,
      baseUnit: item.baseUnit,
      rate,
      discount,
      ...calculated,
      gstRate,
      unitCost: sourceLine?.unitCost,
      ...(input.sourceLineIndex == null ? {} : { sourceLineIndex: input.sourceLineIndex }),
    });
  }
  return lines;
}

export async function recordInventoryReturn(input: {
  type: "sale_return" | "purchase_return";
  partyId?: string;
  sourceInvoiceId?: string;
  lines: InventoryReturnLineInput[];
  settlementMode?: PaymentChannel;
  settlementReference?: string;
  notes?: string;
  date?: string;
  actor?: StockMovement["actor"];
  idempotencyKey?: string;
}) {
  const date = input.date || localDate();
  validateDate(date);
  return db.transaction(
    "rw",
    [db.invoices, db.parties, db.items, db.stockMovements, db.meta],
    async () => {
      const existing = input.idempotencyKey
        ? await db.invoices.get(input.idempotencyKey)
        : undefined;
      if (existing) {
        if (existing.type !== input.type) throw new Error("This return ID already belongs to another document.");
        return existing;
      }
      const party = input.partyId ? await db.parties.get(input.partyId) : undefined;
      if (input.partyId && !party) throw new Error("Choose a valid party for this return.");
      const expectedPartyType: Party["type"] = input.type === "sale_return" ? "customer" : "supplier";
      if (input.type === "purchase_return" && !party) throw new Error("Choose a supplier for a purchase return.");
      if (party && party.type !== expectedPartyType) {
        throw new Error(input.type === "sale_return" ? "Choose a customer for a sales return." : "Choose a supplier for a purchase return.");
      }
      const source = input.sourceInvoiceId ? await db.invoices.get(input.sourceInvoiceId) : undefined;
      if (input.sourceInvoiceId && (!source || source.deletedAt)) throw new Error("The original invoice is unavailable.");
      if (source && source.type !== returnPrimaryType(input.type)) throw new Error("Choose the matching original invoice type.");
      if (source && source.partyId !== party?.id) throw new Error("The original invoice belongs to another party.");
      if (source && input.lines.some((line) => line.sourceLineIndex == null)) {
        throw new Error("Choose each returned line from the original invoice.");
      }
      if (!(["cash", "upi", "bank", "cheque"] as const).includes(input.settlementMode || "cash")) {
        throw new Error("Choose a valid return settlement method.");
      }

      const lines = await buildReturnLines(input.type, source, input.lines);
      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.qty * line.rate, 0));
      const discountTotal = roundMoney(lines.reduce((sum, line) => sum + (line.qty * line.rate - line.taxableAmount), 0));
      const gstTotal = roundMoney(lines.reduce((sum, line) => sum + line.gstAmount, 0));
      const grandTotal = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
      if (grandTotal <= 0) throw new Error("Return total must be greater than zero.");
      const balanceApplied = roundMoney(Math.min(grandTotal, Math.max(0, party?.currentBalance || 0)));
      const settlementAmount = roundMoney(grandTotal - balanceApplied);
      const settlementMode = input.settlementMode || "cash";
      const createdAt = movementTimestamp();
      const invoiceNumber = await reserveReturnInvoiceNumber();

      const primaryType = returnPrimaryType(input.type);
      const openInvoices = await db.invoices
        .where("partyId")
        .equals(party?.id || "")
        .filter((invoice) => !invoice.deletedAt && invoice.type === primaryType && invoice.amountDue > 0)
        .toArray();
      openInvoices.sort((left, right) => {
        if (source && left.id === source.id) return -1;
        if (source && right.id === source.id) return 1;
        return left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
      });
      let remainingCredit = balanceApplied;
      const allocations: Array<{ invoiceId: string; amount: number }> = [];
      for (const invoice of openInvoices) {
        if (remainingCredit <= 0) break;
        const amount = roundMoney(Math.min(remainingCredit, invoice.amountDue));
        if (amount <= 0) continue;
        allocations.push({ invoiceId: invoice.id, amount });
        await db.invoices.update(invoice.id, {
          amountDue: roundMoney(Math.max(0, invoice.amountDue - amount)),
          updatedAt: createdAt,
          isSynced: false,
        });
        remainingCredit = roundMoney(remainingCredit - amount);
      }

      const returnInvoice: Invoice = {
        id: input.idempotencyKey || makeId(),
        invoiceNumber,
        partyId: party?.id,
        partyName: party?.name || "Cash customer",
        partyGstin: party?.gstin,
        date,
        type: input.type,
        lineItems: lines,
        subtotal,
        discountTotal,
        gstTotal,
        otherCharges: [],
        otherChargesTotal: 0,
        roundOff: 0,
        grandTotal,
        initialAmountPaid: settlementAmount,
        amountPaid: settlementAmount,
        amountDue: 0,
        paymentMode: settlementAmount > 0 ? settlementMode : "credit",
        paymentReceivedMode: settlementAmount > 0 ? settlementMode : undefined,
        paymentBreakdown: settlementAmount > 0
          ? [{ mode: settlementMode, amount: settlementAmount, ...(input.settlementReference?.trim() ? { reference: input.settlementReference.trim() } : {}) }]
          : [],
        returnDetails: {
          ...(source ? { sourceInvoiceId: source.id } : {}),
          allocations,
          balanceApplied,
          settlementAmount,
        },
        notes: input.notes?.trim() || "",
        isSynced: false,
        createdAt,
        updatedAt: createdAt,
      };
      await db.invoices.add(returnInvoice);
      if (party) await db.parties.update(party.id, {
          currentBalance: roundMoney(Math.max(0, party.currentBalance - balanceApplied)),
          updatedAt: createdAt,
          isSynced: false,
        });

      for (const [index, line] of lines.entries()) {
        const item = await resolveInventoryItem(line.itemId);
        if (!item) continue;
        const baseQuantity = convertQuantity(line.qty, line.unit, item.baseUnit);
        await applyRelativeStockMovement({
          id: `${input.type}:${returnInvoice.id}:${index}`,
          itemId: item.id,
          kind: input.type,
          reason: input.type,
          note: input.notes,
          qtyChange: input.type === "sale_return" ? baseQuantity : -baseQuantity,
          entryQty: line.qty,
          entryUnit: line.unit,
          refInvoiceId: returnInvoice.id,
          sourceInvoiceId: source?.id,
          partyId: party?.id,
          date,
          actor: input.actor,
        });
      }
      return returnInvoice;
    },
  );
}

export async function startCountSession(categoryId: string) {
  return db.transaction("rw", [db.categories, db.items, db.countSessions, db.countLines], async () => {
    const category = await db.categories.get(categoryId);
    if (!category) throw new Error("Choose a valid category.");
    const existing = await db.countSessions
      .where("categoryId")
      .equals(categoryId)
      .filter((session) => session.status === "in_progress")
      .first();
    if (existing) return existing;
    const items = await db.items.where("categoryId").equals(categoryId).filter((item) => item.isActive).sortBy("name");
    if (!items.length) throw new Error("This category has no active products to count.");
    const stamp = nowIso();
    const session: CountSession = {
      id: makeId(),
      categoryId: category.id,
      categoryName: category.name,
      status: "in_progress",
      itemIds: items.map((item) => item.id),
      startedAt: stamp,
      updatedAt: stamp,
      isSynced: false,
    };
    const lines: CountLine[] = items.map((item) => ({
      id: `${session.id}::${item.id}`,
      sessionId: session.id,
      itemId: item.id,
      itemName: item.name,
      skuCode: item.skuCode,
      baseUnit: item.baseUnit,
      systemStockAtStart: item.currentStock,
      countedStock: null,
      createdAt: stamp,
      updatedAt: stamp,
      isSynced: false,
    }));
    await db.countSessions.add(session);
    await db.countLines.bulkAdd(lines);
    return session;
  });
}

export async function saveCountedStock(sessionId: string, itemId: string, countedStock: number | null) {
  if (countedStock !== null && (!Number.isFinite(countedStock) || countedStock < 0)) {
    throw new Error("Enter a valid non-negative count.");
  }
  return db.transaction("rw", [db.countSessions, db.countLines], async () => {
    const session = await db.countSessions.get(sessionId);
    if (!session || session.status !== "in_progress") throw new Error("This count session is no longer open.");
    const line = await db.countLines.get(`${sessionId}::${itemId}`);
    if (!line) throw new Error("This product is not part of the count session.");
    const stamp = nowIso();
    const normalized = countedStock === null ? null : roundQuantity(countedStock);
    await db.countLines.update(line.id, {
      countedStock: normalized,
      ...(normalized === null ? { countedAt: undefined } : { countedAt: stamp }),
      updatedAt: stamp,
      isSynced: false,
    });
    await db.countSessions.update(session.id, { updatedAt: stamp, isSynced: false });
    return { ...line, countedStock: normalized, countedAt: normalized === null ? undefined : stamp, updatedAt: stamp, isSynced: false };
  });
}

export interface CountReviewRow {
  line: CountLine;
  systemStock: number | null;
  difference: number | null;
}

export async function reviewCountSession(sessionId: string): Promise<{
  session: CountSession;
  rows: CountReviewRow[];
  counted: number;
  total: number;
}> {
  const session = await db.countSessions.get(sessionId);
  if (!session) throw new Error("This count session no longer exists.");
  const lines = await db.countLines.where("sessionId").equals(sessionId).toArray();
  const items = await db.items.bulkGet(lines.map((line) => line.itemId));
  const rows = lines.map((line, index) => {
    const systemStock = items[index]?.currentStock ?? null;
    return {
      line,
      systemStock,
      difference: line.countedStock === null || systemStock === null
        ? null
        : roundQuantity(line.countedStock - systemStock),
    };
  });
  return {
    session,
    rows,
    counted: rows.filter((row) => row.line.countedStock !== null).length,
    total: rows.length,
  };
}

export async function commitCountSession(
  sessionId: string,
  reviewedRows: Array<{ itemId: string; systemStock: number | null }>,
  actor: "owner",
) {
  if (actor !== "owner") throw new Error("Owner unlock is required to commit a stock count.");
  return db.transaction(
    "rw",
    [db.countSessions, db.countLines, db.items, db.stockMovements],
    async () => {
      const session = await db.countSessions.get(sessionId);
      if (!session) throw new Error("This count session no longer exists.");
      if (session.status === "completed") return session;
      const lines = await db.countLines.where("sessionId").equals(sessionId).toArray();
      if (lines.some((line) => line.countedStock === null)) {
        throw new Error("Count every product before committing this session.");
      }
      const reviewed = new Map(reviewedRows.map((row) => [row.itemId, row.systemStock]));
      if (reviewed.size !== lines.length) throw new Error("Review every counted product before committing.");
      const items = await db.items.bulkGet(lines.map((line) => line.itemId));
      for (const item of items) {
        if (!item) throw new Error("A counted product no longer exists.");
        if (!reviewed.has(item.id) || reviewed.get(item.id) !== item.currentStock) {
          throw new Error("Stock changed after review. Review the discrepancies again before committing.");
        }
      }
      const stamp = nowIso();
      const date = localDate();
      for (const [index, line] of lines.entries()) {
        const item = items[index]!;
        if (line.baseUnit !== item.baseUnit) {
          throw new Error(`${item.name}'s base unit changed after counting started. Start a new count.`);
        }
        const stockAfter = roundQuantity(line.countedStock!);
        if (item.currentStock === stockAfter) continue;
        const movement: StockMovement = {
          id: `count:${session.id}:${item.id}`,
          itemId: item.id,
          kind: "count_adjustment",
          reason: "count_adjustment",
          note: `${session.categoryName} physical count`,
          qtyChange: item.currentStock === null ? null : roundQuantity(stockAfter - item.currentStock),
          stockBefore: item.currentStock,
          stockAfter,
          applied: true,
          countSessionId: session.id,
          date,
          actor: "owner",
          createdAt: stamp,
          updatedAt: stamp,
          isSynced: false,
        };
        const existingMovement = await db.stockMovements.get(movement.id);
        if (existingMovement) {
          if (
            existingMovement.itemId !== movement.itemId ||
            existingMovement.stockAfter !== movement.stockAfter ||
            existingMovement.countSessionId !== movement.countSessionId
          ) throw new Error("This count operation conflicts with an existing stock movement.");
        } else {
          await db.stockMovements.add(movement);
        }
        await db.items.update(item.id, {
          currentStock: stockAfter,
          updatedAt: stamp,
          isSynced: false,
        });
      }
      await db.countSessions.update(session.id, {
        status: "completed",
        completedAt: stamp,
        updatedAt: stamp,
        isSynced: false,
      });
      return { ...session, status: "completed" as const, completedAt: stamp, updatedAt: stamp, isSynced: false };
    },
  );
}

export function lowStockItems(items: Item[]) {
  return items
    .filter((item) =>
      item.isActive &&
      item.lowStockAlert !== null &&
      item.currentStock !== null &&
      item.currentStock < item.lowStockAlert,
    )
    .sort((left, right) =>
      (left.currentStock! - left.lowStockAlert!) - (right.currentStock! - right.lowStockAlert!) ||
      left.name.localeCompare(right.name),
    );
}

export interface InventoryValuationRow {
  item: Item;
  value: number | null;
  state: "valued" | "unknown_stock" | "missing_cost" | "negative_stock";
}

export function buildInventoryValuation(items: Item[]) {
  const rows: InventoryValuationRow[] = items
    .filter((item) => item.isActive)
    .map((item) => {
      if (item.currentStock === null) return { item, value: null, state: "unknown_stock" as const };
      if (item.currentStock < 0) return { item, value: item.purchasePrice > 0 ? roundMoney(item.currentStock * item.purchasePrice) : null, state: "negative_stock" as const };
      if (item.purchasePrice <= 0) return { item, value: null, state: "missing_cost" as const };
      return { item, value: roundMoney(item.currentStock * item.purchasePrice), state: "valued" as const };
    });
  return {
    rows,
    totalValue: roundMoney(rows.filter((row) => row.state === "valued").reduce((sum, row) => sum + (row.value || 0), 0)),
    valuedCount: rows.filter((row) => row.state === "valued").length,
    unknownStockCount: rows.filter((row) => row.state === "unknown_stock").length,
    missingCostCount: rows.filter((row) => row.state === "missing_cost").length,
    negativeStockCount: rows.filter((row) => row.state === "negative_stock").length,
  };
}

function isAbsoluteMovement(movement: StockMovement) {
  return movement.kind === "baseline" || movement.kind === "manual_adjustment" || movement.kind === "count_adjustment";
}

/** Rebuilds the denormalized item cache after immutable movement rows merge. */
export async function reconcileInventoryStock() {
  return db.transaction("rw", [db.items, db.stockMovements], async () => {
    const [items, movements] = await Promise.all([db.items.toArray(), db.stockMovements.toArray()]);
    const byItem = new Map<string, StockMovement[]>();
    for (const movement of movements) {
      const rows = byItem.get(movement.itemId) || [];
      rows.push(movement);
      byItem.set(movement.itemId, rows);
    }
    const stamp = nowIso();
    let changed = 0;
    for (const item of items) {
      const rows = (byItem.get(item.id) || []).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      if (!rows.length) continue;
      let stock: number | null = null;
      for (const movement of rows) {
        if (!movement.applied) continue;
        if (isAbsoluteMovement(movement)) {
          stock = movement.stockAfter;
        } else if (stock !== null && movement.qtyChange !== null) {
          stock = roundQuantity(stock + movement.qtyChange);
        } else if (movement.stockBefore !== null && movement.qtyChange !== null) {
          stock = roundQuantity(movement.stockBefore + movement.qtyChange);
        } else if (movement.stockAfter !== null) {
          stock = movement.stockAfter;
        }
      }
      if (stock !== item.currentStock) {
        await db.items.update(item.id, { currentStock: stock, updatedAt: stamp, isSynced: false });
        changed += 1;
      }
    }
    return changed;
  });
}

export async function itemMovementHistory(itemId: string) {
  const items = await db.items.toArray();
  const related = new Set([itemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      const alias = item.festivalTags.find((tag) => tag.startsWith("aliasOf:"))?.slice("aliasOf:".length).trim();
      if (alias && related.has(alias) && !related.has(item.id)) {
        related.add(item.id);
        changed = true;
      }
    }
  }
  return (await db.stockMovements.where("itemId").anyOf([...related]).toArray())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}
