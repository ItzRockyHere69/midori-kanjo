import {
  db,
  localDate,
  makeId,
  nowIso,
  priceKey,
  type AccountEntry,
  type BillingCustomerDraft,
  type Invoice,
  type InvoiceCharge,
  type InvoiceLine,
  type InvoicePaymentAllocation,
  type Item,
  type Party,
  type Payment,
  type PaymentChannel,
  type PaymentMode,
  type PriceTier,
  type Unit,
} from "./db";
import { applyRelativeStockMovement, convertQuantity, resolveInventoryItem } from "./inventory";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
export const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const normalizePartyCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g,"-");
export const normalizePartyIdentity = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
export const normalizePhoneDigits = (value: string) =>
  [...value].map((character) => {
    const point = character.codePointAt(0) || 0;
    if (point >= 0x0966 && point <= 0x096f) return String(point - 0x0966);
    if (point >= 0x09e6 && point <= 0x09ef) return String(point - 0x09e6);
    return /[0-9]/.test(character) ? character : "";
  }).join("");
export const paymentChannels = ["cash", "upi", "bank", "cheque"] as const satisfies readonly PaymentChannel[];
const isPaymentChannel = (value: unknown): value is PaymentChannel =>
  typeof value === "string" && paymentChannels.includes(value as PaymentChannel);
export const partyMatchesSearch = (party: Party, query: string) => {
  const needle = normalizePartyIdentity(query);
  const digitNeedle = normalizePhoneDigits(query);
  return !needle ||
    [party.name,party.codeName,party.address,party.phone].some((value)=>normalizePartyIdentity(String(value||"")).includes(needle)) ||
    (digitNeedle.length >= 3 && normalizePhoneDigits(party.phone).includes(digitNeedle));
};

export function invoiceInitialPaymentBreakdown(
  invoice: Invoice,
  laterAllocated = 0,
): InvoicePaymentAllocation[] {
  const initialPaid = roundMoney(Math.max(
    0,
    invoice.initialAmountPaid ?? invoice.amountPaid - laterAllocated,
  ));
  if (initialPaid <= 0) return [];
  const stored = (invoice.paymentBreakdown || [])
    .filter((entry) => isPaymentChannel(entry.mode) && Number.isFinite(entry.amount) && entry.amount > 0)
    .map((entry) => ({
      mode: entry.mode,
      amount: roundMoney(entry.amount),
      ...(entry.reference?.trim() ? { reference: entry.reference.trim() } : {}),
    }));
  const storedTotal = roundMoney(stored.reduce((sum, entry) => sum + entry.amount, 0));
  if (stored.length && Math.abs(storedTotal - initialPaid) < 0.01) return stored;
  const legacyMode = invoice.paymentReceivedMode
    || (isPaymentChannel(invoice.paymentMode) ? invoice.paymentMode : "cash");
  return [{ mode: legacyMode, amount: initialPaid }];
}

export function customerInvoiceHistory(invoices: Invoice[], partyId?: string) {
  return invoices
    .filter((invoice) => invoice.type === "sale" && (partyId ? invoice.partyId === partyId : !invoice.partyId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.invoiceNumber.localeCompare(a.invoiceNumber));
}

export interface DueCustomerRow {
  party: Party;
  lastPayment?: Payment;
  status: "outstanding" | "paid_in_full";
  lastActivityAt: string;
}

function invoicePayments(invoice: Invoice, laterAllocated = 0): Payment[] {
  if (invoice.type !== "sale" || invoice.deletedAt || !invoice.partyId) return [];
  const breakdown = invoiceInitialPaymentBreakdown(invoice, laterAllocated);
  return breakdown.map((entry, index) => ({
    id: `invoice-payment-${invoice.id}-${index}`,
    partyId: invoice.partyId!,
    amount: entry.amount,
    date: invoice.date,
    mode: entry.mode,
    reference: `${invoice.invoiceNumber} · received with bill${entry.reference ? ` · ${entry.reference}` : ""}`,
    allocatedTo: [{ invoiceId: invoice.id, amount: entry.amount }],
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    isSynced: invoice.isSynced
  }));
}

export function dueCustomerRows(
  parties: Party[],
  payments: Payment[],
  query = "",
  invoices: Invoice[] = [],
  accountEntries: AccountEntry[] = [],
  includeSettled = false,
): DueCustomerRow[] {
  const latestPayment = new Map<string, Payment>();
  const laterAllocated = new Map<string, number>();
  const latestActivity = new Map<string, string>();
  const dueHistoryIds = new Set<string>();
  for (const payment of payments) for (const allocation of payment.allocatedTo) {
    laterAllocated.set(allocation.invoiceId, roundMoney((laterAllocated.get(allocation.invoiceId) || 0) + allocation.amount));
  }
  const receivedWithBills = invoices
    .flatMap((invoice) => invoicePayments(invoice, laterAllocated.get(invoice.id) || 0));
  for (const payment of [...payments, ...receivedWithBills].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id))) {
    if (!latestPayment.has(payment.partyId)) latestPayment.set(payment.partyId, payment);
    const previous = latestActivity.get(payment.partyId) || "";
    if (payment.createdAt > previous) latestActivity.set(payment.partyId, payment.createdAt);
  }
  for (const payment of payments) dueHistoryIds.add(payment.partyId);
  for (const entry of accountEntries) {
    if (entry.amount > 0) dueHistoryIds.add(entry.partyId);
    const previous = latestActivity.get(entry.partyId) || "";
    if (entry.createdAt > previous) latestActivity.set(entry.partyId, entry.createdAt);
  }
  for (const invoice of invoices) {
    if (!invoice.partyId || invoice.deletedAt) continue;
    const previous = latestActivity.get(invoice.partyId) || "";
    if (invoice.createdAt > previous) latestActivity.set(invoice.partyId, invoice.createdAt);
    if (invoice.type === "sale") {
      const initialPaid = invoiceInitialPaymentBreakdown(invoice, laterAllocated.get(invoice.id) || 0)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      if (roundMoney(invoice.grandTotal - initialPaid) >= 0.01) dueHistoryIds.add(invoice.partyId);
    }
    if (invoice.type === "sale_return" && (invoice.returnDetails?.balanceApplied || 0) > 0)
      dueHistoryIds.add(invoice.partyId);
  }
  const needle = query.trim().toLowerCase();
  return parties
    .filter((party) => party.type === "customer" && !party.tags.some((tag) => tag.startsWith("mergedInto:")))
    .filter((party) => {
      if (party.currentBalance > 0) return true;
      if (!includeSettled) return false;
      return party.openingBalance > 0 || dueHistoryIds.has(party.id);
    })
    .filter((party) => !needle || party.name.toLowerCase().includes(needle) || party.codeName.toLowerCase().includes(needle))
    .map((party) => ({
      party,
      lastPayment: latestPayment.get(party.id),
      status: party.currentBalance > 0 ? "outstanding" as const : "paid_in_full" as const,
      lastActivityAt: latestActivity.get(party.id) || party.updatedAt,
    }))
    .sort((a, b) =>
      (a.status === b.status ? 0 : a.status === "outstanding" ? -1 : 1) ||
      (a.status === "outstanding"
        ? b.party.currentBalance - a.party.currentBalance
        : b.lastActivityAt.localeCompare(a.lastActivityAt)) ||
      a.party.name.localeCompare(b.party.name),
    );
}

export interface CustomerPaymentHistoryRow {
  payment: Payment;
  remainingBalance: number;
}

export type PartyDueStatementKind =
  | "opening_balance"
  | "sale_invoice"
  | "return_credit"
  | "return_refund"
  | "manual_due"
  | "payment"
  | "balance_adjustment";

export interface PartyDueStatementRow {
  id: string;
  date: string;
  timestamp: string;
  kind: PartyDueStatementKind;
  activity: string;
  reference: string;
  paymentMode?: Payment["mode"];
  dueAdded: number;
  paymentReceived: number;
  /** Cash refunded for a return; shown for audit but has no due-balance effect. */
  refundPaid?: number;
  runningBalance: number;
  payment?: Payment;
  invoice?: Invoice;
}

export interface PartyDueStatement {
  party: Party;
  rows: PartyDueStatementRow[];
  totalDueAdded: number;
  /** Actual customer receipts only; return credits and repairs are separate. */
  totalPaid: number;
  totalReturnCredits: number;
  totalRefunded: number;
  totalBalanceAdjustments: number;
  totalBalanceReductions: number;
  remainingDue: number;
  lastPayment?: Payment;
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
}

export function partyDueStatement(
  party: Party,
  invoices: Invoice[],
  payments: Payment[],
  accountEntries: AccountEntry[],
): PartyDueStatement {
  const partyPayments = payments.filter((payment) => payment.partyId === party.id);
  const laterAllocated = new Map<string, number>();
  for (const payment of partyPayments) for (const allocation of payment.allocatedTo) {
    laterAllocated.set(allocation.invoiceId, roundMoney((laterAllocated.get(allocation.invoiceId) || 0) + allocation.amount));
  }
  const partyInvoices = invoices.filter((invoice) => invoice.partyId === party.id);
  const partyEntries = accountEntries.filter((entry) => entry.partyId === party.id);
  const receivedWithBills = partyInvoices
    .filter((invoice) => !invoice.deletedAt)
    .flatMap((invoice) => invoicePayments(invoice, laterAllocated.get(invoice.id) || 0));
  type BalanceEvent = Omit<PartyDueStatementRow, "runningBalance"> & { priority: number };
  const events: BalanceEvent[] = [
    ...(party.openingBalance > 0 ? [{
      id: `opening-${party.id}`,
      date: party.createdAt.slice(0, 10),
      timestamp: party.createdAt,
      priority: 0,
      kind: "opening_balance" as const,
      activity: "Opening balance",
      reference: party.codeName,
      dueAdded: roundMoney(party.openingBalance),
      paymentReceived: 0,
    }] : []),
    ...invoices
      .filter((invoice) => invoice.partyId === party.id && invoice.type === "sale" && !invoice.deletedAt)
      .map((invoice) => ({
        id: invoice.id,
        date: invoice.date,
        timestamp: invoice.createdAt,
        priority: 1,
        kind: "sale_invoice" as const,
        activity: "Sales bill",
        reference: invoice.invoiceNumber,
        dueAdded: roundMoney(invoice.grandTotal),
        paymentReceived: 0,
        invoice,
      })),
    ...invoices
      .filter((invoice) =>
        invoice.partyId === party.id &&
        invoice.type === "sale_return" &&
        !invoice.deletedAt &&
        (invoice.returnDetails?.balanceApplied || 0) > 0,
      )
      .map((invoice) => ({
        id: `return-credit-${invoice.id}`,
        date: invoice.date,
        timestamp: invoice.createdAt,
        priority: 2,
        kind: "return_credit" as const,
        activity: "Sales return credit",
        reference: invoice.invoiceNumber,
        dueAdded: 0,
        paymentReceived: roundMoney(invoice.returnDetails?.balanceApplied || 0),
        invoice,
      })),
    ...invoices
      .filter((invoice) =>
        invoice.partyId === party.id &&
        invoice.type === "sale_return" &&
        !invoice.deletedAt &&
        (invoice.returnDetails?.settlementAmount || 0) > 0,
      )
      .map((invoice) => ({
        id: `return-refund-${invoice.id}`,
        date: invoice.date,
        timestamp: invoice.createdAt,
        priority: 2,
        kind: "return_refund" as const,
        activity: "Sales return refund",
        reference: `${invoice.invoiceNumber}${invoice.paymentBreakdown?.[0]?.reference ? ` · ${invoice.paymentBreakdown[0].reference}` : ""}`,
        paymentMode: invoice.paymentReceivedMode || invoice.paymentBreakdown?.[0]?.mode,
        dueAdded: 0,
        paymentReceived: 0,
        refundPaid: roundMoney(invoice.returnDetails?.settlementAmount || 0),
        invoice,
      })),
    ...receivedWithBills.map((payment) => ({
      id: payment.id,
      date: payment.date,
      timestamp: payment.createdAt,
      priority: 2,
      kind: "payment" as const,
      activity: "Payment received with bill",
      reference: payment.reference,
      paymentMode: payment.mode,
      dueAdded: 0,
      paymentReceived: roundMoney(payment.amount),
      payment,
    })),
    ...partyEntries
      .map((entry) => ({
        id: entry.id,
        date: entry.date,
        timestamp: entry.createdAt,
        priority: 1,
        kind: "manual_due" as const,
        activity: entry.note || "Manual due",
        reference: entry.reference,
        dueAdded: roundMoney(entry.amount),
        paymentReceived: 0,
      })),
    ...partyPayments.map((payment) => ({
      id: payment.id,
      date: payment.date,
      timestamp: payment.createdAt,
      priority: 3,
      kind: "payment" as const,
      activity: "Customer payment received",
      reference: payment.reference,
      paymentMode: payment.mode,
      dueAdded: 0,
      paymentReceived: roundMoney(payment.amount),
      payment,
    })),
  ];
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.priority - b.priority || a.id.localeCompare(b.id));
  // Keep the chronological ledger signed internally. This preserves an older
  // receipt that was moved ahead of an opening-balance event by a customer
  // merge, instead of discarding it when the visible balance is clamped at 0.
  let signedBalance = 0;
  const rows: PartyDueStatementRow[] = [];
  for (const event of events) {
    signedBalance = roundMoney(signedBalance + event.dueAdded - event.paymentReceived);
    const { priority: _priority, ...row } = event;
    void _priority;
    rows.push({ ...row, runningBalance: Math.max(0, signedBalance) });
  }

  // A legacy import or an older app version can leave the saved party balance
  // without a matching ledger event. Surface that difference instead of
  // allowing the statement total to silently disagree with the Dues screen.
  const remainingDue = roundMoney(Math.max(0, party.currentBalance));
  const visibleLedgerBalance = roundMoney(Math.max(0, signedBalance));
  const difference = roundMoney(remainingDue - visibleLedgerBalance);
  if (Math.abs(difference) >= 0.01) {
    const date = party.updatedAt.slice(0, 10) || localDate();
    const dueAdded = difference > 0 ? difference : 0;
    const paymentReceived = difference < 0 ? Math.abs(difference) : 0;
    rows.push({
      id: `balance-adjustment-${party.id}`,
      date,
      timestamp: party.updatedAt,
      kind: "balance_adjustment",
      activity: "Account balance reconciliation",
      reference: "Imported / legacy balance",
      dueAdded,
      paymentReceived,
      runningBalance: remainingDue,
    });
  }

  const paymentRows = rows.filter((row) => row.payment);
  return {
    party,
    rows,
    totalDueAdded: roundMoney(rows.reduce((sum, row) => sum + row.dueAdded, 0)),
    totalPaid: roundMoney(rows.filter((row) => row.kind === "payment").reduce((sum, row) => sum + row.paymentReceived, 0)),
    totalReturnCredits: roundMoney(rows.filter((row) => row.kind === "return_credit").reduce((sum, row) => sum + row.paymentReceived, 0)),
    totalRefunded: roundMoney(rows.reduce((sum, row) => sum + (row.refundPaid || 0), 0)),
    totalBalanceAdjustments: roundMoney(rows.filter((row) => row.kind === "balance_adjustment").reduce((sum, row) => sum + row.paymentReceived - row.dueAdded, 0)),
    totalBalanceReductions: roundMoney(rows.reduce((sum, row) => sum + row.paymentReceived, 0)),
    remainingDue,
    lastPayment: paymentRows.at(-1)?.payment,
    invoices: partyInvoices,
    payments: partyPayments,
    accountEntries: partyEntries,
  };
}

export function customerPaymentHistory(party: Party, invoices: Invoice[], payments: Payment[], accountEntries: AccountEntry[]): CustomerPaymentHistoryRow[] {
  return partyDueStatement(party, invoices, payments, accountEntries).rows
    .filter((row): row is PartyDueStatementRow & { payment: Payment } => Boolean(row.payment))
    .map((row) => ({ payment: row.payment, remainingBalance: row.runningBalance }))
    .reverse();
}

const standardUnitFactor: Partial<Record<Unit, number>> = { piece: 1, dozen: 12, gross: 144 };

export function allowedSaleUnits(baseUnit: Unit): Unit[] {
  return standardUnitFactor[baseUnit] ? ["piece", "dozen", "gross"] : [baseUnit];
}

export function convertUnitRate(rate: number, from: Unit, to: Unit) {
  if (from === to) return roundMoney(rate);
  const fromFactor = standardUnitFactor[from];
  const toFactor = standardUnitFactor[to];
  if (!fromFactor || !toFactor) return roundMoney(rate);
  return roundMoney(rate * toFactor / fromFactor);
}

export function tierPrice(item: Item, party?: Party) {
  if (!party) return item.priceWholesale;
  if (party.priceTier === "retail") return item.priceRetail;
  if (party.priceTier === "bulk" || party.priceTier === "special") return item.priceBulk;
  return item.priceWholesale;
}

export async function priceForParty(item: Item, party?: Party) {
  if (!party) return { rate: item.priceWholesale, record: undefined };
  const record = await db.partyItemPrices.get(priceKey(party.id, item.id));
  return { rate: record?.lastPrice ?? tierPrice(item, party), record };
}

export function calculateLine(line: Pick<InvoiceLine, "qty" | "rate" | "discount" | "gstRate">) {
  const qty = Number.isFinite(line.qty) ? Math.max(0, line.qty) : 0;
  const rate = Number.isFinite(line.rate) ? Math.max(0, line.rate) : 0;
  const discount = Number.isFinite(line.discount) ? Math.min(100, Math.max(0, line.discount)) : 0;
  const gstRate = Number.isFinite(line.gstRate) ? Math.max(0, line.gstRate) : 0;
  const gross = roundMoney(qty * rate);
  const discountAmount = roundMoney(gross * discount / 100);
  const taxableAmount = roundMoney(gross - discountAmount);
  const gstAmount = roundMoney(taxableAmount * gstRate / 100);
  return { gross, discountAmount, taxableAmount, gstAmount, amount: roundMoney(taxableAmount + gstAmount) };
}

export function calculateBill(lines: InvoiceLine[], paid: number, otherCharges: InvoiceCharge[] = []) {
  const calculated = lines.map(calculateLine);
  const subtotal = roundMoney(calculated.reduce((sum, line) => sum + line.gross, 0));
  const discountTotal = roundMoney(calculated.reduce((sum, line) => sum + line.discountAmount, 0));
  const gstTotal = roundMoney(calculated.reduce((sum, line) => sum + line.gstAmount, 0));
  const otherChargesTotal = roundMoney(otherCharges.reduce((sum, charge) => {
    const amount = Number.isFinite(charge.amount) ? Math.max(0, charge.amount) : 0;
    return sum + amount;
  }, 0));
  const beforeRound = roundMoney(calculated.reduce((sum, line) => sum + line.amount, 0) + otherChargesTotal);
  const grandTotal = Math.round(beforeRound);
  const roundOff = roundMoney(grandTotal - beforeRound);
  const amountPaid = Math.min(grandTotal, Math.max(0, roundMoney(paid)));
  return { subtotal, discountTotal, gstTotal, otherChargesTotal, roundOff, grandTotal, amountPaid, amountDue: roundMoney(grandTotal - amountPaid) };
}

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[\u0966-\u096f]/g, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(/[\u09e6-\u09ef]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));

const compactSearchText = (value: string) =>
  Array.from(normalizeSearchText(value))
    .filter((char) => /[\p{L}\p{M}\p{N}]/u.test(char))
    .join("");

export function fuzzyScore(query: string, item: Item) {
  const q = normalizeSearchText(query.trim());
  if (!q) return item.saleCount;
  const haystacks = [item.name, item.nameHi, item.nameBn, item.skuCode].map(
    normalizeSearchText,
  );
  if (haystacks.some((x) => x === q)) return 10000;
  if (haystacks.some((x) => x.startsWith(q))) return 7000;
  if (haystacks.some((x) => x.includes(q))) return 5000;
  const words = q.split(/\s+/).filter(Boolean);
  const wordHits = words.filter((word) => haystacks.some((x) => x.includes(word))).length;
  if (wordHits) return 2500 + wordHits * 250;
  const needle = compactSearchText(q);
  if (!needle) return 0;
  let bestScore = 0;
  for (const haystack of haystacks) {
    const compact = compactSearchText(haystack);
    if (!compact) continue;
    let misses = 0;
    let cursor = 0;
    for (const char of needle) {
      const at = compact.indexOf(char, cursor);
      if (at < 0) misses += 1;
      else cursor = at + 1;
    }
    const allowedMisses = Math.floor(needle.length / 4);
    if (misses < needle.length && misses <= allowedMisses)
      bestScore = Math.max(bestScore, 900 - misses * 100);
  }
  return bestScore;
}

export function shouldOfferInlineItemCreation(query: string, items: Item[]) {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) return false;
  return !items.some((item) => [item.name, item.nameHi, item.nameBn, item.skuCode]
    .some((value) => normalizeSearchText(value.trim()) === normalizedQuery));
}

async function reserveInvoiceNumber() {
  const row = await db.meta.get("invoice-counter");
  const next = Number(row?.value || 1001);
  const storedDevice = await db.meta.get("invoice-device-code");
  const deviceCode = String(storedDevice?.value || makeId().replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase().padStart(8, "0"));
  if (!storedDevice) await db.meta.put({ key: "invoice-device-code", value: deviceCode });
  await db.meta.put({ key: "invoice-counter", value: next + 1 });
  const d = new Date();
  const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `MB-${fyStart}-${String(fyStart + 1).slice(-2)}-${deviceCode}-${next}`;
}

async function nextInvoiceNumber() {
  return db.transaction("rw", db.meta, reserveInvoiceNumber);
}

async function nextQuotationNumber() {
  return db.transaction("rw", db.meta, async () => {
    const row = await db.meta.get("quotation-counter");
    const next = Number(row?.value || 1001);
    const storedDevice = await db.meta.get("invoice-device-code");
    const deviceCode = String(storedDevice?.value || makeId().replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase().padStart(8, "0"));
    if (!storedDevice) await db.meta.put({ key: "invoice-device-code", value: deviceCode });
    await db.meta.put({ key: "quotation-counter", value: next + 1 });
    const d = new Date();
    const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `QT-${fyStart}-${String(fyStart + 1).slice(-2)}-${deviceCode}-${next}`;
  });
}

function validateDocumentLines(lines: InvoiceLine[], otherCharges: InvoiceCharge[] = []) {
  if (!lines.length) throw new Error("Add at least one item.");
  for (const line of lines) {
    if (!Number.isFinite(line.qty) || line.qty <= 0) throw new Error(`Enter a valid quantity for ${line.itemName}.`);
    if (!Number.isFinite(line.rate) || line.rate < 0) throw new Error(`Enter a valid rate for ${line.itemName}.`);
    if (!Number.isFinite(line.discount) || line.discount < 0 || line.discount > 100) throw new Error(`Enter a discount from 0 to 100 for ${line.itemName}.`);
  }
  for (const charge of otherCharges) {
    if (!charge.label.trim()) throw new Error("Enter a name for every other charge.");
    if (!Number.isFinite(charge.amount) || charge.amount < 0) throw new Error(`Enter a valid amount for ${charge.label}.`);
  }
}

async function snapshotLineCosts(lines: InvoiceLine[]) {
  const items = await db.items.bulkGet(lines.map((line) => line.itemId));
  return lines.map((line, index) => {
    const item = items[index];
    const unitCost = item
      ? convertUnitRate(item.purchasePrice, item.baseUnit, line.unit)
      : line.unitCost;
    return {
      ...line,
      ...calculateLine(line),
      ...(unitCost == null ? {} : { unitCost: roundMoney(unitCost) }),
    };
  });
}

export type SalePaymentPlan = "full" | "partial" | "credit";

async function resolveBillingCustomer(
  selected: Party | undefined,
  draft: BillingCustomerDraft | undefined,
  timestamp: string,
) {
  if (selected && draft) throw new Error("Choose either an existing customer or a new customer, not both.");
  if (selected) {
    const current = await db.parties.get(selected.id);
    if (!current) throw new Error("The selected party no longer exists.");
    if (current.type !== "customer") throw new Error("Choose a customer for this document.");
    return current;
  }
  const name = draft?.name.normalize("NFKC").trim().replace(/\s+/g, " ") || "";
  if (!name) return undefined;
  const identity = normalizePartyIdentity(name);
  const phone = draft?.phone?.trim() || "";
  const phoneDigits = normalizePhoneDigits(phone);
  const codeName = normalizePartyCode(draft?.codeName || "");
  const duplicateCode = codeName
    ? await db.parties
        .filter((party) => party.codeName.toLowerCase() === codeName.toLowerCase())
        .first()
    : undefined;
  if (duplicateCode) {
    throw new Error(`Code name ${codeName} is already used by ${duplicateCode.name}.`);
  }
  const duplicate = await db.parties
    .filter((party) =>
      party.type === "customer" &&
      !party.tags.some((tag) => tag.startsWith("mergedInto:")) &&
      (normalizePartyIdentity(party.name) === identity ||
        (phoneDigits.length >= 8 && normalizePhoneDigits(party.phone) === phoneDigits)),
    )
    .first();
  if (duplicate) {
    throw new Error(`${duplicate.name} already matches this customer. Choose the saved customer from the list.`);
  }
  const party: Party = {
    id: makeId(),
    name,
    codeName,
    phone,
    address: draft?.address?.trim() || "",
    type: "customer",
    priceTier: "retail",
    openingBalance: 0,
    currentBalance: 0,
    notes: "",
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    isSynced: false,
  };
  await db.parties.add(party);
  return party;
}

function normalizedPaymentBreakdown(
  entries: InvoicePaymentAllocation[] | undefined,
  fallbackMode: PaymentMode,
  expectedPaid: number,
) {
  const normalized: InvoicePaymentAllocation[] = [];
  const seen = new Set<PaymentChannel>();
  for (const entry of entries || []) {
    if (!isPaymentChannel(entry.mode)) throw new Error("Choose a valid payment method.");
    if (!Number.isFinite(entry.amount) || entry.amount < 0) throw new Error("Enter valid split-payment amounts.");
    const amount = roundMoney(entry.amount);
    if (!amount) continue;
    if (seen.has(entry.mode)) throw new Error("Use each split-payment method only once.");
    seen.add(entry.mode);
    normalized.push({
      mode: entry.mode,
      amount,
      ...(entry.reference?.trim() ? { reference: entry.reference.trim() } : {}),
    });
  }
  if (!normalized.length && expectedPaid > 0 && entries === undefined) {
    normalized.push({
      mode: isPaymentChannel(fallbackMode) ? fallbackMode : "cash",
      amount: expectedPaid,
    });
  }
  if (!normalized.length && expectedPaid > 0) {
    throw new Error("Enter at least one payment amount.");
  }
  const allocated = roundMoney(normalized.reduce((sum, entry) => sum + entry.amount, 0));
  if (Math.abs(roundMoney(allocated - expectedPaid)) >= 0.01) {
    throw new Error(`Split payment must add up to ${formatMoney(expectedPaid)}.`);
  }
  return normalized;
}

export async function saveSale(input: { party?: Party; customerDraft?: BillingCustomerDraft; lines: InvoiceLine[]; paid: number; paymentMode: PaymentMode; paymentBreakdown?: InvoicePaymentAllocation[]; paymentPlan?: SalePaymentPlan; otherCharges?: InvoiceCharge[]; notes?: string; idempotencyKey?: string }) {
  if (input.idempotencyKey) {
    const existing = await db.invoices.get(input.idempotencyKey);
    if (existing) {
      if (existing.type !== "sale") throw new Error("This saved draft ID already belongs to another document.");
      return existing;
    }
  }
  validateDocumentLines(input.lines, input.otherCharges);
  if (input.party?.type === "supplier") throw new Error("Choose a customer for a sales bill.");
  if (input.party && input.customerDraft) throw new Error("Choose either an existing customer or a new customer, not both.");
  if (!Number.isFinite(input.paid) || input.paid < 0) throw new Error("Enter a valid amount received.");
  if (input.paymentMode === "mixed" && input.paid <= 0) throw new Error("Enter the amount received for a mixed payment.");
  const otherCharges = (input.otherCharges || []).filter((charge) => charge.amount > 0).map((charge) => ({ ...charge, amount: roundMoney(charge.amount) }));
  const preview = calculateBill(input.lines, 0, otherCharges);
  if (roundMoney(input.paid - preview.grandTotal) >= 0.01) throw new Error("Amount received cannot be more than the final total.");
  const paymentPlan = input.paymentPlan || (input.paymentMode === "credit" ? "credit" : input.paymentMode === "mixed" || (input.paid > 0 && input.paid < preview.grandTotal) ? "partial" : "full");
  if (paymentPlan === "partial" && input.paid <= 0) throw new Error("Enter the amount received for this part payment.");
  if (paymentPlan === "partial" && input.paid >= preview.grandTotal) throw new Error("Part payment must be less than the final total. Choose Full payment instead.");
  const effectivePaid = paymentPlan === "credit" ? 0 : paymentPlan === "full" ? preview.grandTotal : input.paid;
  const totals = calculateBill(input.lines, effectivePaid, otherCharges);
  const hasCustomer = Boolean(input.party || input.customerDraft?.name.trim());
  if (!hasCustomer && totals.amountDue > 0) throw new Error("Choose a party for an udhaar bill.");
  const paymentBreakdown = normalizedPaymentBreakdown(
    input.paymentBreakdown,
    input.paymentMode,
    totals.amountPaid,
  );
  const finalPaymentMode: PaymentMode = totals.amountDue > 0
    ? (totals.amountPaid > 0 ? "mixed" : "credit")
    : paymentBreakdown.length > 1
      ? "mixed"
      : paymentBreakdown[0]?.mode || "cash";
  const paymentReceivedMode = paymentBreakdown.length === 1
    ? paymentBreakdown[0].mode
    : undefined;
  const timestamp = nowIso();
  const lineItems = await snapshotLineCosts(input.lines);
  const id = input.idempotencyKey || makeId();
  const invoiceNumber = await nextInvoiceNumber();
  return db.transaction("rw", [db.invoices, db.parties, db.items, db.partyItemPrices, db.stockMovements], async () => {
    const alreadySaved = await db.invoices.get(id);
    if (alreadySaved) {
      if (alreadySaved.type !== "sale") throw new Error("This saved draft ID already belongs to another document.");
      return alreadySaved;
    }
    const customer = await resolveBillingCustomer(input.party, input.customerDraft, timestamp);
    const invoice: Invoice = {
      id,
      invoiceNumber,
      partyId: customer?.id,
      partyName: customer?.name || "Cash customer",
      partyGstin: customer?.gstin,
      date: localDate(), type: "sale", lineItems, otherCharges, ...totals,
      initialAmountPaid: totals.amountPaid,
      paymentMode: finalPaymentMode,
      paymentReceivedMode,
      paymentBreakdown,
      notes: input.notes || "", isSynced: false, createdAt: timestamp, updatedAt: timestamp
    };
    await db.invoices.add(invoice);
    if (customer && invoice.amountDue) {
      await db.parties.update(customer.id, { currentBalance: roundMoney(customer.currentBalance + invoice.amountDue), updatedAt: timestamp, isSynced: false });
    }
    for (const [lineIndex, line] of invoice.lineItems.entries()) {
      const soldItem = await resolveInventoryItem(line.itemId);
      const existing = customer && soldItem ? await db.partyItemPrices.get(priceKey(customer.id, soldItem.id)) : undefined;
      const normalizedRate = soldItem ? convertUnitRate(line.rate, line.unit, soldItem.baseUnit) : line.rate;
      if (customer && soldItem) await db.partyItemPrices.put({
        id: priceKey(customer.id, soldItem.id), partyId: customer.id, itemId: soldItem.id,
        lastPrice: existing?.lockedPrice && line.lockPrice ? existing.lastPrice : normalizedRate,
        lastSoldDate: invoice.date, timesSold: (existing?.timesSold || 0) + 1, lockedPrice: Boolean(line.lockPrice), updatedAt: timestamp, isSynced: false
      });
      if (soldItem) await db.items.update(soldItem.id, { saleCount: soldItem.saleCount + 1, lastSoldDate: invoice.date, updatedAt: timestamp, isSynced: false });
      if (soldItem) await applyRelativeStockMovement({
        id: `sale:${invoice.id}:${lineIndex}`,
        itemId: soldItem.id,
        kind: "sale",
        reason: "sale",
        qtyChange: -convertQuantity(line.qty, line.unit, soldItem.baseUnit),
        entryQty: line.qty,
        entryUnit: line.unit,
        refInvoiceId: invoice.id,
        partyId: invoice.partyId,
        date: invoice.date,
        actor: "staff",
      });
    }
    return invoice;
  });
}

export async function saveQuotation(input: { party?: Party; customerDraft?: BillingCustomerDraft; lines: InvoiceLine[]; otherCharges?: InvoiceCharge[]; notes?: string; idempotencyKey?: string }) {
  if (input.idempotencyKey) {
    const existing = await db.invoices.get(input.idempotencyKey);
    if (existing) {
      if (existing.type !== "quotation") throw new Error("This saved draft ID already belongs to another document.");
      return existing;
    }
  }
  validateDocumentLines(input.lines, input.otherCharges);
  if (input.party?.type === "supplier") throw new Error("Choose a customer for a quotation.");
  if (input.party && input.customerDraft) throw new Error("Choose either an existing customer or a new customer, not both.");
  const otherCharges = (input.otherCharges || []).filter((charge) => charge.amount > 0).map((charge) => ({ ...charge, amount: roundMoney(charge.amount) }));
  const totals = calculateBill(input.lines, 0, otherCharges);
  const timestamp = nowIso();
  const id = input.idempotencyKey || makeId();
  const invoiceNumber = await nextQuotationNumber();
  return db.transaction("rw", [db.invoices, db.parties], async () => {
    const alreadySaved = await db.invoices.get(id);
    if (alreadySaved) {
      if (alreadySaved.type !== "quotation") throw new Error("This saved draft ID already belongs to another document.");
      return alreadySaved;
    }
    const customer = await resolveBillingCustomer(input.party, input.customerDraft, timestamp);
    const quotation: Invoice = {
      id,
      invoiceNumber,
      partyId: customer?.id,
      partyName: customer?.name || "Cash customer",
      partyGstin: customer?.gstin,
      date: localDate(), type: "quotation", lineItems: input.lines.map((line) => ({ ...line, ...calculateLine(line) })), otherCharges, ...totals,
      initialAmountPaid: 0, amountPaid: 0, amountDue: totals.grandTotal, paymentMode: "credit", paymentBreakdown: [], notes: input.notes || "", isSynced: false, createdAt: timestamp, updatedAt: timestamp
    };
    await db.invoices.add(quotation);
    return quotation;
  });
}

const quotationOriginMarker = (quotationId: string) => `[mantu:quotation:${quotationId}]`;
const quotationConvertedMarker = (invoiceId: string) => `[mantu:converted:${invoiceId}]`;

export function convertedInvoiceId(quotation: Invoice) {
  return quotation.notes.match(/\[mantu:converted:([^\]]+)\]/)?.[1];
}

export async function convertQuotationToInvoice(quotationId: string) {
  return db.transaction("rw", [db.invoices, db.parties, db.items, db.partyItemPrices, db.stockMovements, db.meta], async () => {
    const quotation = await db.invoices.get(quotationId);
    if (!quotation || quotation.type !== "quotation" || quotation.deletedAt) throw new Error("This quotation is no longer available.");
    const marker = quotationOriginMarker(quotation.id);
    const existing = await db.invoices.filter((invoice) => invoice.type === "sale" && invoice.notes.includes(marker)).first();
    if (existing) return existing;
    const invoiceNumber = await reserveInvoiceNumber();
    const timestamp = nowIso();
    const date = localDate();
    const otherCharges = quotation.otherCharges || [];
    const preview = calculateBill(quotation.lineItems, 0, otherCharges);
    const paid = quotation.partyId ? 0 : preview.grandTotal;
    const totals = calculateBill(quotation.lineItems, paid, otherCharges);
    const lineItems = await snapshotLineCosts(quotation.lineItems);
    const invoice: Invoice = {
      ...quotation,
      id: makeId(), invoiceNumber, date, type: "sale", lineItems, ...totals,
      initialAmountPaid: totals.amountPaid,
      paymentMode: quotation.partyId ? "credit" : "cash",
      notes: `${quotation.notes.replace(/\s*\[mantu:converted:[^\]]+\]/g, "").trim()} ${marker}`.trim(),
      isSynced: false, createdAt: timestamp, updatedAt: timestamp, deletedAt: undefined
    };
    await db.invoices.add(invoice);
    if (quotation.partyId && invoice.amountDue) {
      const party = await db.parties.get(quotation.partyId);
      if (!party) throw new Error("The quotation customer no longer exists.");
      await db.parties.update(party.id, { currentBalance: roundMoney(party.currentBalance + invoice.amountDue), updatedAt: timestamp, isSynced: false });
    }
    for (const [lineIndex, line] of invoice.lineItems.entries()) {
      const soldItem = await resolveInventoryItem(line.itemId);
      const existingPrice = quotation.partyId && soldItem ? await db.partyItemPrices.get(priceKey(quotation.partyId, soldItem.id)) : undefined;
      const normalizedRate = soldItem ? convertUnitRate(line.rate, line.unit, soldItem.baseUnit) : line.rate;
      if (quotation.partyId && soldItem) await db.partyItemPrices.put({
        id: priceKey(quotation.partyId, soldItem.id), partyId: quotation.partyId, itemId: soldItem.id,
        lastPrice: existingPrice?.lockedPrice && line.lockPrice ? existingPrice.lastPrice : normalizedRate,
        lastSoldDate: date, timesSold: (existingPrice?.timesSold || 0) + 1, lockedPrice: Boolean(line.lockPrice), updatedAt: timestamp, isSynced: false
      });
      if (soldItem) await db.items.update(soldItem.id, { saleCount: soldItem.saleCount + 1, lastSoldDate: date, updatedAt: timestamp, isSynced: false });
      if (soldItem) await applyRelativeStockMovement({
        id: `sale:${invoice.id}:${lineIndex}`,
        itemId: soldItem.id,
        kind: "sale",
        reason: "quotation_conversion",
        qtyChange: -convertQuantity(line.qty, line.unit, soldItem.baseUnit),
        entryQty: line.qty,
        entryUnit: line.unit,
        refInvoiceId: invoice.id,
        partyId: invoice.partyId,
        date,
        actor: "staff",
      });
    }
    await db.invoices.update(quotation.id, { notes: `${quotation.notes} ${quotationConvertedMarker(invoice.id)}`.trim(), updatedAt: timestamp, isSynced: false });
    return invoice;
  });
}

export async function createQuickParty(name: string, phone: string, codeName = "", address = "") {
  return createParty({ name, phone, codeName, address, type: "customer", priceTier: "wholesale", openingBalance: 0 });
}

export async function createParty(input: { name: string; codeName?: string; phone?: string; address?: string; gstin?: string; type: Party["type"]; priceTier?: PriceTier; openingBalance?: number; notes?: string }) {
  if (!input.name.trim()) throw new Error("Enter a party name.");
  const openingBalance = roundMoney(Number(input.openingBalance || 0));
  if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new Error("Opening due cannot be negative.");
  const timestamp = nowIso();
  const id = makeId();
  const codeName = normalizePartyCode(input.codeName || "");
  const party: Party = { id, name: input.name.trim(), codeName, phone: input.phone?.trim() || "", address: input.address?.trim() || "", gstin: input.gstin?.trim().toUpperCase() || undefined, type: input.type, priceTier: input.priceTier || "wholesale", openingBalance, currentBalance: openingBalance, notes: input.notes?.trim() || "", tags: [], createdAt: timestamp, updatedAt: timestamp, isSynced: false };
  return db.transaction("rw", db.parties, async () => {
    const duplicateCode = codeName
      ? await db.parties
          .filter((entry) => entry.codeName.toLowerCase() === codeName.toLowerCase())
          .first()
      : undefined;
    if (duplicateCode) throw new Error(`Code name ${codeName} is already used by ${duplicateCode.name}.`);
    await db.parties.add(party);
    return party;
  });
}

export async function createQuickItem(name: string, rate: number) {
  if (!name.trim()) throw new Error("Enter an item name.");
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Enter a valid rate.");
  const timestamp = nowIso();
  const id=makeId();
  const skuSuffix=id.replace(/[^a-z0-9]/gi,"").slice(-8).toUpperCase();
  const item: Item = { id, name: name.trim(), nameHi: "", nameBn: "", skuCode: `NEW-${skuSuffix}`, categoryId: "cat-uncategorized", baseUnit: "dozen", conversionRate: 1, purchasePrice: 0, priceRetail: rate, priceWholesale: rate, priceBulk: rate, currentStock: null, lowStockAlert: null, festivalTags: [], gstRate: 0, isActive: true, saleCount: 0, createdAt: timestamp, updatedAt: timestamp, isSynced: false };
  await db.items.add(item); return item;
}

export async function recordPayment(party: Party, amount: number, mode: Payment["mode"], reference: string, manualInvoiceIds?: string[]) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid payment amount.");
  return db.transaction("rw", [db.payments, db.invoices, db.parties], async () => {
    const currentParty = await db.parties.get(party.id);
    if (!currentParty) throw new Error("This party no longer exists.");
    const roundedAmount = roundMoney(amount);
    if (roundedAmount < 0.01) throw new Error("Payment amount must be at least ₹0.01.");
    if (roundedAmount > currentParty.currentBalance) throw new Error(`Payment cannot exceed ${formatMoney(currentParty.currentBalance)} outstanding.`);
    const payableType: Invoice["type"] = currentParty.type === "supplier" ? "purchase" : "sale";
    const outstanding = await db.invoices.where("partyId").equals(party.id).filter((x) => !x.deletedAt && x.type === payableType && x.amountDue > 0).toArray();
    outstanding.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.invoiceNumber.localeCompare(b.invoiceNumber));
    if (manualInvoiceIds && !manualInvoiceIds.length) throw new Error("Choose at least one bill for manual allocation.");
    const candidates = manualInvoiceIds ? outstanding.filter((x) => manualInvoiceIds.includes(x.id)) : outstanding;
    const selectedDue = roundMoney(candidates.reduce((sum, invoice) => sum + invoice.amountDue, 0));
    if (manualInvoiceIds && roundedAmount > selectedDue) throw new Error(`Selected bills have only ${formatMoney(selectedDue)} due.`);
    let remaining = roundedAmount; const allocatedTo: { invoiceId: string; amount: number }[] = [];
    for (const invoice of candidates) {
      if (remaining <= 0) break;
      const used = Math.min(remaining, invoice.amountDue); allocatedTo.push({ invoiceId: invoice.id, amount: used }); remaining = roundMoney(remaining - used);
    }
    const timestamp = nowIso();
    const payment: Payment = { id: makeId(), partyId: party.id, amount: roundedAmount, date: localDate(), mode, reference: reference.trim(), allocatedTo, isSynced: false, createdAt: timestamp, updatedAt: timestamp };
    await db.payments.add(payment);
    for (const allocation of allocatedTo) { const invoice = await db.invoices.get(allocation.invoiceId); if (invoice) await db.invoices.update(invoice.id, { amountPaid: roundMoney(invoice.amountPaid + allocation.amount), amountDue: roundMoney(invoice.amountDue - allocation.amount), updatedAt: timestamp, isSynced: false }); }
    await db.parties.update(party.id, { currentBalance: Math.max(0, roundMoney(currentParty.currentBalance - roundedAmount)), updatedAt: timestamp, isSynced: false });
    return payment;
  });
}

export async function recordDue(party: Party, amount: number, note: string, reference = "") {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid due amount.");
  return db.transaction("rw", [db.accountEntries, db.parties], async () => {
    const currentParty = await db.parties.get(party.id);
    if (!currentParty) throw new Error("This party no longer exists.");
    const roundedAmount = roundMoney(amount);
    if (roundedAmount < 0.01) throw new Error("Due amount must be at least ₹0.01.");
    const timestamp = nowIso();
    const entry: AccountEntry = {
      id: makeId(), partyId: party.id, kind: "due", amount: roundedAmount, date: localDate(),
      note: note.trim() || (currentParty.type === "supplier" ? "Supplier bill" : "Manual due"),
      reference: reference.trim(), isSynced: false, createdAt: timestamp, updatedAt: timestamp
    };
    await db.accountEntries.add(entry);
    await db.parties.update(party.id, { currentBalance: roundMoney(currentParty.currentBalance + roundedAmount), updatedAt: timestamp, isSynced: false });
    return entry;
  });
}

type SaleLineOccurrence = {
  invoice: Invoice;
  line: InvoiceLine;
  lineIndex: number;
  canonicalItemId: string;
};

function saleLineOrder(left: SaleLineOccurrence, right: SaleLineOccurrence) {
  return left.invoice.date.localeCompare(right.invoice.date)
    || left.invoice.createdAt.localeCompare(right.invoice.createdAt)
    || (Number(left.invoice.invoiceNumber.match(/-(\d+)$/)?.[1] || 0)
      - Number(right.invoice.invoiceNumber.match(/-(\d+)$/)?.[1] || 0))
    || left.invoice.invoiceNumber.localeCompare(right.invoice.invoiceNumber)
    || left.invoice.id.localeCompare(right.invoice.id)
    || left.lineIndex - right.lineIndex;
}

function canonicalItemResolver(items: Map<string, Item>) {
  const cache = new Map<string, string>();
  return (startId: string) => {
    const cached = cache.get(startId);
    if (cached) return cached;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let currentId = startId;
    let resolvedId = startId;
    while (true) {
      const resolved = cache.get(currentId);
      if (resolved) {
        resolvedId = resolved;
        break;
      }
      const cycleStart = positions.get(currentId);
      if (cycleStart != null) {
        // Corrupted alias cycles must terminate deterministically for every
        // starting point instead of looping or splitting one product's stats.
        resolvedId = [...path.slice(cycleStart)].sort()[0] || startId;
        break;
      }
      positions.set(currentId, path.length);
      path.push(currentId);
      const item = items.get(currentId);
      const aliasId = item?.festivalTags
        .find((tag) => tag.startsWith("aliasOf:"))
        ?.slice("aliasOf:".length)
        .trim();
      if (!aliasId || !items.has(aliasId)) {
        resolvedId = currentId;
        break;
      }
      currentId = aliasId;
    }
    for (const itemId of path) cache.set(itemId, resolvedId);
    return resolvedId;
  };
}

function saleLineOccurrences(
  invoices: Invoice[],
  canonicalize: (itemId: string) => string,
) {
  const occurrences: SaleLineOccurrence[] = [];
  for (const invoice of invoices) {
    invoice.lineItems.forEach((line, lineIndex) => {
      occurrences.push({
        invoice,
        line,
        lineIndex,
        canonicalItemId: canonicalize(line.itemId),
      });
    });
  }
  return occurrences.sort(saleLineOrder);
}

async function refreshInvoiceSaleStats(
  invoice: Invoice,
  counterDirection: -1 | 1,
  stamp: string,
) {
  if (invoice.type !== "sale") return;
  const allItems = await db.items.toArray();
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const canonicalize = canonicalItemResolver(itemsById);
  const occurrences = new Map<string, number>();
  for (const line of invoice.lineItems) {
    const canonicalItemId = canonicalize(line.itemId);
    occurrences.set(
      canonicalItemId,
      (occurrences.get(canonicalItemId) || 0) + 1,
    );
  }
  const activeSales = await db.invoices
    .filter((candidate) => candidate.type === "sale" && !candidate.deletedAt)
    .toArray();
  const activeOccurrences = saleLineOccurrences(activeSales, canonicalize);

  for (const [itemId, occurrenceCount] of occurrences) {
    const item = itemsById.get(itemId);
    if (!item) continue;
    const itemSales = activeOccurrences.filter(
      (occurrence) => occurrence.canonicalItemId === itemId,
    );
    const latestItemSale = itemSales.at(-1);
    const itemActiveBefore = Math.max(
      0,
      itemSales.length - counterDirection * occurrenceCount,
    );
    const itemAggregateHistory = Math.max(0, item.saleCount - itemActiveBefore);
    const nextSaleCount = itemAggregateHistory + itemSales.length;
    await db.items.update(itemId, {
      saleCount: nextSaleCount,
      // Older databases may contain aggregate history without all source
      // invoices. Preserve that date while an aggregate count remains.
      lastSoldDate: latestItemSale?.invoice.date
        || (nextSaleCount > 0 ? item.lastSoldDate : undefined),
      updatedAt: stamp,
      isSynced: false,
    });

    if (!invoice.partyId) continue;
    const party = await db.parties.get(invoice.partyId);
    if (!party) continue;
    const id = priceKey(invoice.partyId, itemId);
    const existing = await db.partyItemPrices.get(id);
    const partySales = itemSales.filter(
      (occurrence) => occurrence.invoice.partyId === invoice.partyId,
    );
    const latestPartySale = partySales.at(-1);
    const partyActiveBefore = Math.max(
      0,
      partySales.length - counterDirection * occurrenceCount,
    );
    const partyAggregateHistory = Math.max(
      0,
      (existing?.timesSold || 0) - partyActiveBefore,
    );
    const nextTimesSold = partyAggregateHistory + partySales.length;
    const hasAggregateHistory = nextTimesSold > partySales.length;
    let rememberedPrice = hasAggregateHistory && existing
      ? existing.lastPrice
      : tierPrice(item, party);
    let rememberedLocked = hasAggregateHistory
      ? Boolean(existing?.lockedPrice)
      : false;
    for (const occurrence of partySales) {
      const lineLocksPrice = Boolean(occurrence.line.lockPrice);
      if (!(rememberedLocked && lineLocksPrice)) {
        rememberedPrice = convertUnitRate(
          occurrence.line.rate,
          occurrence.line.unit,
          item.baseUnit,
        );
      }
      rememberedLocked = lineLocksPrice;
    }
    await db.partyItemPrices.put({
      id,
      partyId: invoice.partyId,
      itemId,
      lastPrice: latestPartySale
        ? rememberedPrice
        : nextTimesSold > 0 && existing
          ? existing.lastPrice
          : tierPrice(item, party),
      lastSoldDate: latestPartySale?.invoice.date
        || (nextTimesSold > 0 ? existing?.lastSoldDate || "" : ""),
      timesSold: nextTimesSold,
      lockedPrice: latestPartySale
        ? rememberedLocked
        : nextTimesSold > 0
          ? Boolean(existing?.lockedPrice)
          : false,
      updatedAt: stamp,
      isSynced: false,
    });
  }
}

export async function softDeleteInvoice(invoiceId: string) {
  return db.transaction("rw", [db.invoices, db.payments, db.parties, db.items, db.partyItemPrices, db.stockMovements], async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) throw new Error("This invoice no longer exists.");
    if (invoice.deletedAt) return invoice;
    if (invoice.type === "sale_return" || invoice.type === "purchase_return") {
      throw new Error("Returns cannot be deleted because they settle stock and party balances.");
    }
    const linkedReturn = await db.invoices
      .filter((candidate) =>
        !candidate.deletedAt &&
        (candidate.type === "sale_return" || candidate.type === "purchase_return") &&
        (candidate.returnDetails?.sourceInvoiceId === invoice.id ||
          (candidate.returnDetails?.allocations || []).some((allocation) => allocation.invoiceId === invoice.id)),
      )
      .first();
    if (linkedReturn) {
      throw new Error("This bill has a linked return and cannot be deleted.");
    }
    if (
      invoice.amountPaid >= 0.01 ||
      (invoice.initialAmountPaid ?? 0) >= 0.01
    ) {
      throw new Error(
        "This bill has a recorded payment and cannot be deleted. Keep it for an accurate account history.",
      );
    }
    const allocatedPayment = await db.payments
      .filter((payment) =>
        (payment.allocatedTo || []).some(
          (allocation) =>
            allocation.invoiceId === invoice.id && allocation.amount > 0,
        ),
      )
      .first();
    if (allocatedPayment) {
      throw new Error(
        "This bill has a recorded payment and cannot be deleted. Keep it for an accurate account history.",
      );
    }
    const stamp = nowIso();
    await db.invoices.update(invoice.id, {
      deletedAt: stamp,
      updatedAt: stamp,
      isSynced: false,
    });
    await refreshInvoiceSaleStats(invoice, -1, stamp);
    if (invoice.type === "sale") {
      for (const [lineIndex, line] of invoice.lineItems.entries()) {
        const original = await db.stockMovements.get(`sale:${invoice.id}:${lineIndex}`);
        const item = original?.applied ? await resolveInventoryItem(line.itemId) : undefined;
        if (!item) continue;
        await applyRelativeStockMovement({
          id: `sale_void:${invoice.id}:${lineIndex}:${makeId()}`,
          itemId: item.id,
          kind: "sale_void",
          reason: "sale_deleted",
          qtyChange: convertQuantity(line.qty, line.unit, item.baseUnit),
          entryQty: line.qty,
          entryUnit: line.unit,
          refInvoiceId: invoice.id,
          partyId: invoice.partyId,
          date: localDate(),
          actor: "staff",
        });
      }
    }
    if (
      invoice.partyId &&
      ["sale", "purchase"].includes(invoice.type) &&
      invoice.amountDue > 0
    ) {
      const party = await db.parties.get(invoice.partyId);
      if (party)
        await db.parties.update(party.id, {
          currentBalance: Math.max(
            0,
            roundMoney(party.currentBalance - invoice.amountDue),
          ),
          updatedAt: stamp,
          isSynced: false,
        });
    }
    return { ...invoice, deletedAt: stamp, updatedAt: stamp, isSynced: false };
  });
}

export async function restoreInvoice(invoiceId: string) {
  return db.transaction("rw", [db.invoices, db.parties, db.items, db.partyItemPrices, db.stockMovements], async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) throw new Error("This invoice no longer exists.");
    if (!invoice.deletedAt) return invoice;
    const stamp = nowIso();
    await db.invoices.update(invoice.id, {
      deletedAt: undefined,
      updatedAt: stamp,
      isSynced: false,
    });
    await refreshInvoiceSaleStats(invoice, 1, stamp);
    if (invoice.type === "sale") {
      for (const [lineIndex, line] of invoice.lineItems.entries()) {
        const original = await db.stockMovements.get(`sale:${invoice.id}:${lineIndex}`);
        const voidMovement = (await db.stockMovements
          .where("refInvoiceId")
          .equals(invoice.id)
          .filter((movement) =>
            movement.kind === "sale_void" &&
            movement.id.startsWith(`sale_void:${invoice.id}:${lineIndex}`),
          )
          .toArray())
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
          .at(-1);
        const item = original?.applied && voidMovement?.applied ? await resolveInventoryItem(line.itemId) : undefined;
        if (!item) continue;
        await applyRelativeStockMovement({
          id: `sale_restore:${invoice.id}:${lineIndex}:${makeId()}`,
          itemId: item.id,
          kind: "sale_restore",
          reason: "sale_restored",
          qtyChange: -convertQuantity(line.qty, line.unit, item.baseUnit),
          entryQty: line.qty,
          entryUnit: line.unit,
          refInvoiceId: invoice.id,
          partyId: invoice.partyId,
          date: localDate(),
          actor: "staff",
        });
      }
    }
    if (
      invoice.partyId &&
      ["sale", "purchase"].includes(invoice.type) &&
      invoice.amountDue > 0
    ) {
      const party = await db.parties.get(invoice.partyId);
      if (party)
        await db.parties.update(party.id, {
          currentBalance: roundMoney(party.currentBalance + invoice.amountDue),
          updatedAt: stamp,
          isSynced: false,
        });
    }
    return {
      ...invoice,
      deletedAt: undefined,
      updatedAt: stamp,
      isSynced: false,
    };
  });
}

export const unitShort = (unit: Unit) => ({ piece: "pc", dozen: "dz", gross: "gross", bundle: "bundle", box: "box", packet: "pkt" }[unit]);
