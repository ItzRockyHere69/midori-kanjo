import { db, localDate, makeId, nowIso, priceKey, type AccountEntry, type Invoice, type InvoiceCharge, type InvoiceLine, type Item, type Party, type Payment, type PaymentMode, type PriceTier, type Unit } from "./db";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
export const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const normalizePartyCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g,"-");
export const partyMatchesSearch = (party: Party, query: string) => {
  const needle = query.trim().toLowerCase();
  return !needle || [party.name,party.codeName,party.address,party.phone].some((value)=>String(value||"").toLowerCase().includes(needle));
};

export function customerInvoiceHistory(invoices: Invoice[], partyId?: string) {
  return invoices
    .filter((invoice) => invoice.type === "sale" && (partyId ? invoice.partyId === partyId : !invoice.partyId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.invoiceNumber.localeCompare(a.invoiceNumber));
}

export interface DueCustomerRow {
  party: Party;
  lastPayment?: Payment;
}

function invoicePayment(invoice: Invoice, laterAllocated = 0): Payment | undefined {
  const amount = roundMoney(Math.max(0, invoice.amountPaid - laterAllocated));
  if (invoice.type !== "sale" || invoice.deletedAt || amount <= 0 || !invoice.partyId) return undefined;
  const mode = invoice.paymentReceivedMode
    || (["cash", "upi", "bank"].includes(invoice.paymentMode) ? invoice.paymentMode as Payment["mode"] : "cash");
  return {
    id: `invoice-payment-${invoice.id}`,
    partyId: invoice.partyId,
    amount,
    date: invoice.date,
    mode,
    reference: `${invoice.invoiceNumber} · received with bill`,
    allocatedTo: [{ invoiceId: invoice.id, amount }],
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    isSynced: invoice.isSynced
  };
}

export function dueCustomerRows(parties: Party[], payments: Payment[], query = "", invoices: Invoice[] = []): DueCustomerRow[] {
  const latestPayment = new Map<string, Payment>();
  const laterAllocated = new Map<string, number>();
  for (const payment of payments) for (const allocation of payment.allocatedTo) {
    laterAllocated.set(allocation.invoiceId, roundMoney((laterAllocated.get(allocation.invoiceId) || 0) + allocation.amount));
  }
  const receivedWithBills = invoices
    .map((invoice) => invoicePayment(invoice, laterAllocated.get(invoice.id) || 0))
    .filter((payment): payment is Payment => Boolean(payment));
  for (const payment of [...payments, ...receivedWithBills].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date) || b.id.localeCompare(a.id))) {
    if (!latestPayment.has(payment.partyId)) latestPayment.set(payment.partyId, payment);
  }
  const needle = query.trim().toLowerCase();
  return parties
    .filter((party) => party.type === "customer" && party.currentBalance > 0)
    .filter((party) => !needle || party.name.toLowerCase().includes(needle) || party.codeName.toLowerCase().includes(needle))
    .map((party) => ({ party, lastPayment: latestPayment.get(party.id) }))
    .sort((a, b) => b.party.currentBalance - a.party.currentBalance || a.party.name.localeCompare(b.party.name));
}

export interface CustomerPaymentHistoryRow {
  payment: Payment;
  remainingBalance: number;
}

export type PartyDueStatementKind =
  | "opening_balance"
  | "sale_invoice"
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
  runningBalance: number;
  payment?: Payment;
}

export interface PartyDueStatement {
  party: Party;
  rows: PartyDueStatementRow[];
  totalDueAdded: number;
  totalPaid: number;
  remainingDue: number;
  lastPayment?: Payment;
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
  const receivedWithBills = invoices
    .filter((invoice) => invoice.partyId === party.id)
    .map((invoice) => invoicePayment(invoice, laterAllocated.get(invoice.id) || 0))
    .filter((payment): payment is Payment => Boolean(payment));
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
    ...accountEntries
      .filter((entry) => entry.partyId === party.id)
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
  let balance = 0;
  const rows: PartyDueStatementRow[] = [];
  for (const event of events) {
    balance = Math.max(0, roundMoney(balance + event.dueAdded - event.paymentReceived));
    const { priority: _priority, ...row } = event;
    void _priority;
    rows.push({ ...row, runningBalance: balance });
  }

  // A legacy import or an older app version can leave the saved party balance
  // without a matching ledger event. Surface that difference instead of
  // allowing the statement total to silently disagree with the Dues screen.
  const remainingDue = roundMoney(Math.max(0, party.currentBalance));
  const difference = roundMoney(remainingDue - balance);
  if (Math.abs(difference) >= 0.01) {
    const date = party.updatedAt.slice(0, 10) || localDate();
    const dueAdded = difference > 0 ? difference : 0;
    const paymentReceived = difference < 0 ? Math.abs(difference) : 0;
    balance = remainingDue;
    rows.push({
      id: `balance-adjustment-${party.id}`,
      date,
      timestamp: party.updatedAt,
      kind: "balance_adjustment",
      activity: "Account balance reconciliation",
      reference: "Imported / legacy balance",
      dueAdded,
      paymentReceived,
      runningBalance: balance,
    });
  }

  const paymentRows = rows.filter((row) => row.payment);
  return {
    party,
    rows,
    totalDueAdded: roundMoney(rows.reduce((sum, row) => sum + row.dueAdded, 0)),
    totalPaid: roundMoney(rows.reduce((sum, row) => sum + row.paymentReceived, 0)),
    remainingDue,
    lastPayment: paymentRows.at(-1)?.payment,
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

export function fuzzyScore(query: string, item: Item) {
  const q = query.trim().toLowerCase();
  if (!q) return item.saleCount;
  const haystacks = [item.name, item.nameHi, item.nameBn, item.skuCode].map((x) => x.toLowerCase());
  if (haystacks.some((x) => x === q)) return 10000;
  if (haystacks.some((x) => x.startsWith(q))) return 7000;
  if (haystacks.some((x) => x.includes(q))) return 5000;
  const words = q.split(/\s+/).filter(Boolean);
  const wordHits = words.filter((word) => haystacks.some((x) => x.includes(word))).length;
  if (wordHits) return 2500 + wordHits * 250;
  const compact = haystacks[0].replace(/[^a-z0-9]/g, "");
  const needle = q.replace(/[^a-z0-9]/g, "");
  let misses = 0, cursor = 0;
  for (const char of needle) { const at = compact.indexOf(char, cursor); if (at < 0) misses += 1; else cursor = at + 1; }
  return misses <= Math.max(1, Math.floor(needle.length / 4)) ? 900 - misses * 100 : 0;
}

export function shouldOfferInlineItemCreation(query: string, items: Item[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;
  return !items.some((item) => [item.name, item.nameHi, item.nameBn, item.skuCode]
    .some((value) => value.trim().toLowerCase() === normalizedQuery));
}

async function nextInvoiceNumber() {
  return db.transaction("rw", db.meta, async () => {
    const row = await db.meta.get("invoice-counter");
    const next = Number(row?.value || 1001);
    const storedDevice = await db.meta.get("invoice-device-code");
    const deviceCode = String(storedDevice?.value || makeId().replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase());
    if (!storedDevice) await db.meta.put({ key: "invoice-device-code", value: deviceCode });
    await db.meta.put({ key: "invoice-counter", value: next + 1 });
    const d = new Date();
    const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `MB-${fyStart}-${String(fyStart + 1).slice(-2)}-${deviceCode}-${next}`;
  });
}

async function nextQuotationNumber() {
  return db.transaction("rw", db.meta, async () => {
    const row = await db.meta.get("quotation-counter");
    const next = Number(row?.value || 1001);
    const storedDevice = await db.meta.get("invoice-device-code");
    const deviceCode = String(storedDevice?.value || makeId().replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase());
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

export type SalePaymentPlan = "full" | "partial" | "credit";

export async function saveSale(input: { party?: Party; lines: InvoiceLine[]; paid: number; paymentMode: PaymentMode; paymentPlan?: SalePaymentPlan; otherCharges?: InvoiceCharge[]; notes?: string; idempotencyKey?: string }) {
  if (input.idempotencyKey) {
    const existing = await db.invoices.get(input.idempotencyKey);
    if (existing) {
      if (existing.type !== "sale") throw new Error("This saved draft ID already belongs to another document.");
      return existing;
    }
  }
  validateDocumentLines(input.lines, input.otherCharges);
  if (input.party?.type === "supplier") throw new Error("Choose a customer for a sales bill.");
  if (!Number.isFinite(input.paid) || input.paid < 0) throw new Error("Enter a valid amount received.");
  if (input.paymentMode === "mixed" && input.paid <= 0) throw new Error("Enter the amount received for a mixed payment.");
  const otherCharges = (input.otherCharges || []).filter((charge) => charge.amount > 0).map((charge) => ({ ...charge, amount: roundMoney(charge.amount) }));
  const preview = calculateBill(input.lines, 0, otherCharges);
  const paymentPlan = input.paymentPlan || (input.paymentMode === "credit" ? "credit" : input.paymentMode === "mixed" || (input.paid > 0 && input.paid < preview.grandTotal) ? "partial" : "full");
  if (paymentPlan === "partial" && input.paid <= 0) throw new Error("Enter the amount received for this part payment.");
  if (paymentPlan === "partial" && input.paid >= preview.grandTotal) throw new Error("Part payment must be less than the final total. Choose Full payment instead.");
  const effectivePaid = paymentPlan === "credit" ? 0 : paymentPlan === "full" ? preview.grandTotal : input.paid;
  const totals = calculateBill(input.lines, effectivePaid, otherCharges);
  if (!input.party && totals.amountDue > 0) throw new Error("Choose a party for an udhaar bill.");
  const finalPaymentMode: PaymentMode = totals.amountDue > 0 ? (totals.amountPaid > 0 ? "mixed" : "credit") : (input.paymentMode === "credit" ? "cash" : input.paymentMode);
  const paymentReceivedMode = totals.amountPaid > 0 && ["cash", "upi", "bank"].includes(input.paymentMode) ? input.paymentMode as "cash" | "upi" | "bank" : undefined;
  const timestamp = nowIso();
  const invoice: Invoice = {
    id: input.idempotencyKey || makeId(), invoiceNumber: await nextInvoiceNumber(), partyId: input.party?.id, partyName: input.party?.name || "Cash customer", partyGstin: input.party?.gstin,
    date: localDate(), type: "sale", lineItems: input.lines.map((line) => ({ ...line, ...calculateLine(line) })), otherCharges, ...totals,
    paymentMode: finalPaymentMode, paymentReceivedMode, notes: input.notes || "", isSynced: false, createdAt: timestamp, updatedAt: timestamp
  };
  await db.transaction("rw", [db.invoices, db.parties, db.items, db.partyItemPrices], async () => {
    await db.invoices.add(invoice);
    if (input.party && invoice.amountDue) {
      const currentParty = await db.parties.get(input.party.id);
      if (!currentParty) throw new Error("The selected party no longer exists.");
      await db.parties.update(input.party.id, { currentBalance: roundMoney(currentParty.currentBalance + invoice.amountDue), updatedAt: timestamp, isSynced: false });
    }
    for (const line of invoice.lineItems) {
      const existing = input.party ? await db.partyItemPrices.get(priceKey(input.party.id, line.itemId)) : undefined;
      const soldItem = await db.items.get(line.itemId);
      const normalizedRate = soldItem ? convertUnitRate(line.rate, line.unit, soldItem.baseUnit) : line.rate;
      if (input.party) await db.partyItemPrices.put({
        id: priceKey(input.party.id, line.itemId), partyId: input.party.id, itemId: line.itemId,
        lastPrice: existing?.lockedPrice && line.lockPrice ? existing.lastPrice : normalizedRate,
        lastSoldDate: invoice.date, timesSold: (existing?.timesSold || 0) + 1, lockedPrice: Boolean(line.lockPrice), updatedAt: timestamp, isSynced: false
      });
      if (soldItem) await db.items.update(line.itemId, { saleCount: soldItem.saleCount + 1, lastSoldDate: invoice.date, updatedAt: timestamp, isSynced: false });
    }
  });
  return invoice;
}

export async function saveQuotation(input: { party?: Party; lines: InvoiceLine[]; otherCharges?: InvoiceCharge[]; notes?: string; idempotencyKey?: string }) {
  if (input.idempotencyKey) {
    const existing = await db.invoices.get(input.idempotencyKey);
    if (existing) {
      if (existing.type !== "quotation") throw new Error("This saved draft ID already belongs to another document.");
      return existing;
    }
  }
  validateDocumentLines(input.lines, input.otherCharges);
  if (input.party?.type === "supplier") throw new Error("Choose a customer for a quotation.");
  const otherCharges = (input.otherCharges || []).filter((charge) => charge.amount > 0).map((charge) => ({ ...charge, amount: roundMoney(charge.amount) }));
  const totals = calculateBill(input.lines, 0, otherCharges);
  const timestamp = nowIso();
  const quotation: Invoice = {
    id: input.idempotencyKey || makeId(), invoiceNumber: await nextQuotationNumber(), partyId: input.party?.id, partyName: input.party?.name || "Cash customer", partyGstin: input.party?.gstin,
    date: localDate(), type: "quotation", lineItems: input.lines.map((line) => ({ ...line, ...calculateLine(line) })), otherCharges, ...totals,
    amountPaid: 0, amountDue: totals.grandTotal, paymentMode: "credit", notes: input.notes || "", isSynced: false, createdAt: timestamp, updatedAt: timestamp
  };
  await db.invoices.add(quotation);
  return quotation;
}

const quotationOriginMarker = (quotationId: string) => `[mantu:quotation:${quotationId}]`;
const quotationConvertedMarker = (invoiceId: string) => `[mantu:converted:${invoiceId}]`;

export function convertedInvoiceId(quotation: Invoice) {
  return quotation.notes.match(/\[mantu:converted:([^\]]+)\]/)?.[1];
}

export async function convertQuotationToInvoice(quotationId: string) {
  const invoiceNumber = await nextInvoiceNumber();
  return db.transaction("rw", [db.invoices, db.parties, db.items, db.partyItemPrices], async () => {
    const quotation = await db.invoices.get(quotationId);
    if (!quotation || quotation.type !== "quotation" || quotation.deletedAt) throw new Error("This quotation is no longer available.");
    const marker = quotationOriginMarker(quotation.id);
    const existing = await db.invoices.filter((invoice) => invoice.type === "sale" && invoice.notes.includes(marker)).first();
    if (existing) return existing;
    const timestamp = nowIso();
    const date = localDate();
    const otherCharges = quotation.otherCharges || [];
    const preview = calculateBill(quotation.lineItems, 0, otherCharges);
    const paid = quotation.partyId ? 0 : preview.grandTotal;
    const totals = calculateBill(quotation.lineItems, paid, otherCharges);
    const invoice: Invoice = {
      ...quotation,
      id: makeId(), invoiceNumber, date, type: "sale", lineItems: quotation.lineItems.map((line) => ({ ...line, ...calculateLine(line) })), ...totals,
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
    for (const line of invoice.lineItems) {
      const soldItem = await db.items.get(line.itemId);
      const existingPrice = quotation.partyId ? await db.partyItemPrices.get(priceKey(quotation.partyId, line.itemId)) : undefined;
      const normalizedRate = soldItem ? convertUnitRate(line.rate, line.unit, soldItem.baseUnit) : line.rate;
      if (quotation.partyId) await db.partyItemPrices.put({
        id: priceKey(quotation.partyId, line.itemId), partyId: quotation.partyId, itemId: line.itemId,
        lastPrice: existingPrice?.lockedPrice && line.lockPrice ? existingPrice.lastPrice : normalizedRate,
        lastSoldDate: date, timesSold: (existingPrice?.timesSold || 0) + 1, lockedPrice: Boolean(line.lockPrice), updatedAt: timestamp, isSynced: false
      });
      if (soldItem) await db.items.update(line.itemId, { saleCount: soldItem.saleCount + 1, lastSoldDate: date, updatedAt: timestamp, isSynced: false });
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
  const fallbackName = input.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,8) || "PARTY";
  const codeName = normalizePartyCode(input.codeName || `${input.type === "supplier" ? "SUP" : "CUS"}-${fallbackName}-${id.replace(/[^a-z0-9]/gi,"").slice(-4).toUpperCase()}`);
  const duplicateCode = await db.parties.filter((party)=>party.codeName.toLowerCase()===codeName.toLowerCase()).first();
  if (duplicateCode) throw new Error(`Code name ${codeName} is already used by ${duplicateCode.name}.`);
  const party: Party = { id, name: input.name.trim(), codeName, phone: input.phone?.trim() || "", address: input.address?.trim() || "", gstin: input.gstin?.trim().toUpperCase() || undefined, type: input.type, priceTier: input.priceTier || "wholesale", openingBalance, currentBalance: openingBalance, notes: input.notes?.trim() || "", tags: [], createdAt: timestamp, updatedAt: timestamp, isSynced: false };
  await db.parties.add(party); return party;
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
    if (roundedAmount > currentParty.currentBalance) throw new Error(`Payment cannot exceed ${formatMoney(currentParty.currentBalance)} outstanding.`);
    const outstanding = await db.invoices.where("partyId").equals(party.id).filter((x) => !x.deletedAt && x.amountDue > 0).toArray();
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

export const unitShort = (unit: Unit) => ({ piece: "pc", dozen: "dz", gross: "gross", bundle: "bundle", box: "box", packet: "pkt" }[unit]);
