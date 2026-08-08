import type { AccountEntry, Invoice, Item, Party } from "./db";
import { convertUnitRate, roundMoney } from "./billing";

export interface ReportRange { fromDate?: string; toDate?: string }

export interface DailySalesRow {
  date: string;
  bills: number;
  taxable: number;
  gst: number;
  revenue: number;
  paid: number;
  due: number;
}

export interface PartySalesRow {
  partyId?: string;
  partyName: string;
  codeName: string;
  bills: number;
  revenue: number;
  paid: number;
  due: number;
  averageBill: number;
  lastSaleDate: string;
}

export interface ItemProfitRow {
  itemId: string;
  itemName: string;
  skuCode: string;
  revenueBeforeGst: number;
  cost: number | null;
  profit: number | null;
  marginPercent: number | null;
  bills: number;
}

export type AgingBucket = "0-30" | "30-60" | "60+";
export interface ReceivableAgingRow {
  partyId: string;
  partyName: string;
  codeName: string;
  zeroToThirty: number;
  thirtyToSixty: number;
  sixtyPlus: number;
  total: number;
  oldestDays: number;
}

export interface ReceivableAgingReport {
  rows: ReceivableAgingRow[];
  totals: Record<AgingBucket, number> & { total: number };
}

export interface DeadStockRow {
  itemId: string;
  itemName: string;
  skuCode: string;
  lastSaleDate?: string;
  daysWithoutSale: number | null;
  currentStock: number | null;
  stockValue: number | null;
}

export interface TopRevenueItemRow {
  itemId: string;
  itemName: string;
  skuCode: string;
  revenue: number;
  taxable: number;
  bills: number;
}

export interface MarginComparison {
  itemId: string;
  itemName: string;
  partyRate: number;
  comparisonRate: number;
  gapPercent: number;
  estimatedRevenueGap: number;
  marginPercent: number | null;
}

export interface MarginPartyRow {
  partyId: string;
  partyName: string;
  codeName: string;
  flaggedItems: number;
  averageGapPercent: number;
  estimatedRevenueGap: number;
  comparisons: MarginComparison[];
}

const dateTime = (date: string) => new Date(`${date}T00:00:00`).getTime();
const daysBetween = (older: string, newer: string) => Math.max(0, Math.floor((dateTime(newer) - dateTime(older)) / 86_400_000));
const inRange = (date: string, range: ReportRange) => (!range.fromDate || date >= range.fromDate) && (!range.toDate || date <= range.toDate);
const activeSales = (invoices: Invoice[], range: ReportRange = {}) => invoices.filter((invoice) => !invoice.deletedAt && invoice.type === "sale" && inRange(invoice.date, range));
const taxableForLine = (line: Invoice["lineItems"][number]) => roundMoney(line.taxableAmount || line.qty * line.rate * (1 - line.discount / 100));

export function buildDailySalesReport(invoices: Invoice[], range: ReportRange = {}): DailySalesRow[] {
  const rows = new Map<string, DailySalesRow>();
  for (const invoice of activeSales(invoices, range)) {
    const row = rows.get(invoice.date) || { date: invoice.date, bills: 0, taxable: 0, gst: 0, revenue: 0, paid: 0, due: 0 };
    row.bills += 1;
    row.taxable = roundMoney(row.taxable + invoice.subtotal - invoice.discountTotal);
    row.gst = roundMoney(row.gst + invoice.gstTotal);
    row.revenue = roundMoney(row.revenue + invoice.grandTotal);
    row.paid = roundMoney(row.paid + invoice.amountPaid);
    row.due = roundMoney(row.due + invoice.amountDue);
    rows.set(invoice.date, row);
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildPartySalesReport(invoices: Invoice[], parties: Party[], range: ReportRange = {}): PartySalesRow[] {
  const partyMap = new Map(parties.map((party) => [party.id, party]));
  const rows = new Map<string, PartySalesRow>();
  for (const invoice of activeSales(invoices, range)) {
    const key = invoice.partyId || "__cash__";
    const party = invoice.partyId ? partyMap.get(invoice.partyId) : undefined;
    const row = rows.get(key) || {
      partyId: invoice.partyId,
      partyName: party?.name || invoice.partyName || "Cash customer",
      codeName: party?.codeName || "CASH",
      bills: 0,
      revenue: 0,
      paid: 0,
      due: 0,
      averageBill: 0,
      lastSaleDate: invoice.date
    };
    row.bills += 1;
    row.revenue = roundMoney(row.revenue + invoice.grandTotal);
    row.paid = roundMoney(row.paid + invoice.amountPaid);
    row.due = roundMoney(row.due + invoice.amountDue);
    row.lastSaleDate = row.lastSaleDate > invoice.date ? row.lastSaleDate : invoice.date;
    row.averageBill = roundMoney(row.revenue / row.bills);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || a.partyName.localeCompare(b.partyName));
}

export function buildItemProfitReport(invoices: Invoice[], items: Item[], range: ReportRange = {}): ItemProfitRow[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const rows = new Map<string, { row: ItemProfitRow; invoiceIds: Set<string> }>();
  for (const invoice of activeSales(invoices, range)) {
    for (const line of invoice.lineItems) {
      const item = itemMap.get(line.itemId);
      const existing = rows.get(line.itemId) || {
        row: { itemId: line.itemId, itemName: line.itemName, skuCode: line.skuCode, revenueBeforeGst: 0, cost: 0, profit: 0, marginPercent: 0, bills: 0 },
        invoiceIds: new Set<string>()
      };
      const taxable = taxableForLine(line);
      existing.row.revenueBeforeGst = roundMoney(existing.row.revenueBeforeGst + taxable);
      if (!item || item.purchasePrice <= 0) {
        existing.row.cost = null;
        existing.row.profit = null;
        existing.row.marginPercent = null;
      } else if (existing.row.cost !== null) {
        const cost = roundMoney(convertUnitRate(item.purchasePrice, item.baseUnit, line.unit) * line.qty);
        existing.row.cost = roundMoney(existing.row.cost + cost);
        existing.row.profit = roundMoney(existing.row.revenueBeforeGst - existing.row.cost);
        existing.row.marginPercent = existing.row.revenueBeforeGst > 0 ? roundMoney(existing.row.profit / existing.row.revenueBeforeGst * 100) : 0;
      }
      existing.invoiceIds.add(invoice.id);
      existing.row.bills = existing.invoiceIds.size;
      rows.set(line.itemId, existing);
    }
  }
  return [...rows.values()].map(({ row }) => row).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || b.revenueBeforeGst - a.revenueBeforeGst);
}

function bucketForAge(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "30-60";
  return "60+";
}

export function buildReceivablesAging(input: { invoices: Invoice[]; parties: Party[]; accountEntries: AccountEntry[]; asOfDate: string }): ReceivableAgingReport {
  const rows = new Map<string, ReceivableAgingRow>();
  const partyMap = new Map(input.parties.filter((party) => party.type === "customer").map((party) => [party.id, party]));
  const ensure = (party: Party) => {
    const existing = rows.get(party.id);
    if (existing) return existing;
    const created: ReceivableAgingRow = { partyId: party.id, partyName: party.name, codeName: party.codeName, zeroToThirty: 0, thirtyToSixty: 0, sixtyPlus: 0, total: 0, oldestDays: 0 };
    rows.set(party.id, created);
    return created;
  };
  const add = (party: Party, amount: number, date: string) => {
    if (amount <= 0) return;
    const row = ensure(party);
    const days = daysBetween(date, input.asOfDate);
    const bucket = bucketForAge(days);
    if (bucket === "0-30") row.zeroToThirty = roundMoney(row.zeroToThirty + amount);
    else if (bucket === "30-60") row.thirtyToSixty = roundMoney(row.thirtyToSixty + amount);
    else row.sixtyPlus = roundMoney(row.sixtyPlus + amount);
    row.total = roundMoney(row.total + amount);
    row.oldestDays = Math.max(row.oldestDays, days);
  };

  const invoiceOutstanding = new Map<string, number>();
  for (const invoice of input.invoices.filter((invoice) => !invoice.deletedAt && invoice.type === "sale" && invoice.partyId && invoice.amountDue > 0)) {
    const party = partyMap.get(invoice.partyId!);
    if (!party) continue;
    add(party, invoice.amountDue, invoice.date);
    invoiceOutstanding.set(party.id, roundMoney((invoiceOutstanding.get(party.id) || 0) + invoice.amountDue));
  }

  for (const party of partyMap.values()) {
    let manualOutstanding = roundMoney(Math.max(0, party.currentBalance - (invoiceOutstanding.get(party.id) || 0)));
    if (!manualOutstanding) continue;
    const sources = [
      ...(party.openingBalance > 0 ? [{ amount: party.openingBalance, date: party.createdAt.slice(0, 10) }] : []),
      ...input.accountEntries.filter((entry) => entry.partyId === party.id).map((entry) => ({ amount: entry.amount, date: entry.date }))
    ].sort((a, b) => b.date.localeCompare(a.date));
    for (const source of sources) {
      if (manualOutstanding <= 0) break;
      const amount = Math.min(manualOutstanding, source.amount);
      add(party, amount, source.date || input.asOfDate);
      manualOutstanding = roundMoney(manualOutstanding - amount);
    }
    if (manualOutstanding > 0) add(party, manualOutstanding, party.createdAt.slice(0, 10) || input.asOfDate);
  }

  const resultRows = [...rows.values()].filter((row) => row.total > 0).sort((a, b) => b.total - a.total || b.oldestDays - a.oldestDays);
  return {
    rows: resultRows,
    totals: {
      "0-30": roundMoney(resultRows.reduce((sum, row) => sum + row.zeroToThirty, 0)),
      "30-60": roundMoney(resultRows.reduce((sum, row) => sum + row.thirtyToSixty, 0)),
      "60+": roundMoney(resultRows.reduce((sum, row) => sum + row.sixtyPlus, 0)),
      total: roundMoney(resultRows.reduce((sum, row) => sum + row.total, 0))
    }
  };
}

export function buildDeadStockReport(invoices: Invoice[], items: Item[], asOfDate: string, inactiveDays = 183): DeadStockRow[] {
  const latest = new Map<string, string>();
  for (const invoice of activeSales(invoices)) for (const line of invoice.lineItems) {
    const previous = latest.get(line.itemId);
    if (!previous || invoice.date > previous) latest.set(line.itemId, invoice.date);
  }
  return items.filter((item) => item.isActive).map((item): DeadStockRow => {
    const lastSaleDate = latest.get(item.id) || item.lastSoldDate;
    const daysWithoutSale = lastSaleDate ? daysBetween(lastSaleDate, asOfDate) : null;
    return {
      itemId: item.id,
      itemName: item.name,
      skuCode: item.skuCode,
      lastSaleDate,
      daysWithoutSale,
      currentStock: item.currentStock,
      stockValue: item.currentStock == null ? null : roundMoney(item.currentStock * item.purchasePrice)
    };
  }).filter((row) => row.daysWithoutSale == null || row.daysWithoutSale >= inactiveDays)
    .sort((a, b) => (b.daysWithoutSale ?? Number.MAX_SAFE_INTEGER) - (a.daysWithoutSale ?? Number.MAX_SAFE_INTEGER) || a.itemName.localeCompare(b.itemName));
}

export function buildTopRevenueItems(invoices: Invoice[], items: Item[], range: ReportRange = {}, limit = 20): TopRevenueItemRow[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const rows = new Map<string, { row: TopRevenueItemRow; invoiceIds: Set<string> }>();
  for (const invoice of activeSales(invoices, range)) for (const line of invoice.lineItems) {
    const item = itemMap.get(line.itemId);
    const existing = rows.get(line.itemId) || {
      row: { itemId: line.itemId, itemName: item?.name || line.itemName, skuCode: item?.skuCode || line.skuCode, revenue: 0, taxable: 0, bills: 0 },
      invoiceIds: new Set<string>()
    };
    existing.row.revenue = roundMoney(existing.row.revenue + line.amount);
    existing.row.taxable = roundMoney(existing.row.taxable + taxableForLine(line));
    existing.invoiceIds.add(invoice.id);
    existing.row.bills = existing.invoiceIds.size;
    rows.set(line.itemId, existing);
  }
  return [...rows.values()].map(({ row }) => row).sort((a, b) => b.revenue - a.revenue || a.itemName.localeCompare(b.itemName)).slice(0, limit);
}

export function buildMarginByPartyReport(invoices: Invoice[], items: Item[], parties: Party[], range: ReportRange = {}, thresholdPercent = 10): MarginPartyRow[] {
  type PriceAggregate = { revenue: number; baseQty: number; itemName: string };
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const partyMap = new Map(parties.filter((party) => party.type === "customer").map((party) => [party.id, party]));
  const byItem = new Map<string, Map<string, PriceAggregate>>();
  for (const invoice of activeSales(invoices, range)) {
    if (!invoice.partyId || !partyMap.has(invoice.partyId)) continue;
    for (const line of invoice.lineItems) {
      const item = itemMap.get(line.itemId);
      if (!item) continue;
      const normalizedRate = convertUnitRate(line.rate, line.unit, item.baseUnit);
      const baseQty = normalizedRate > 0 ? line.qty * line.rate / normalizedRate : line.qty;
      const partyRows = byItem.get(line.itemId) || new Map<string, PriceAggregate>();
      const aggregate = partyRows.get(invoice.partyId) || { revenue: 0, baseQty: 0, itemName: line.itemName };
      aggregate.revenue = roundMoney(aggregate.revenue + taxableForLine(line));
      aggregate.baseQty += baseQty;
      partyRows.set(invoice.partyId, aggregate);
      byItem.set(line.itemId, partyRows);
    }
  }

  const partyRows = new Map<string, MarginPartyRow>();
  for (const [itemId, buyers] of byItem) {
    if (buyers.size < 2) continue;
    const item = itemMap.get(itemId);
    if (!item) continue;
    for (const [partyId, aggregate] of buyers) {
      const otherAggregates = [...buyers.entries()].filter(([otherPartyId]) => otherPartyId !== partyId).map(([, value]) => value);
      const otherRevenue = otherAggregates.reduce((sum, value) => sum + value.revenue, 0);
      const otherQty = otherAggregates.reduce((sum, value) => sum + value.baseQty, 0);
      if (!aggregate.baseQty || !otherQty) continue;
      const partyRate = aggregate.revenue / aggregate.baseQty;
      const comparisonRate = otherRevenue / otherQty;
      if (comparisonRate <= 0) continue;
      const gapPercent = (comparisonRate - partyRate) / comparisonRate * 100;
      if (gapPercent < thresholdPercent) continue;
      const party = partyMap.get(partyId);
      if (!party) continue;
      const comparison: MarginComparison = {
        itemId,
        itemName: aggregate.itemName,
        partyRate: roundMoney(partyRate),
        comparisonRate: roundMoney(comparisonRate),
        gapPercent: roundMoney(gapPercent),
        estimatedRevenueGap: roundMoney(Math.max(0, comparisonRate - partyRate) * aggregate.baseQty),
        marginPercent: item.purchasePrice > 0 && partyRate > 0 ? roundMoney((partyRate - item.purchasePrice) / partyRate * 100) : null
      };
      const row = partyRows.get(partyId) || { partyId, partyName: party.name, codeName: party.codeName, flaggedItems: 0, averageGapPercent: 0, estimatedRevenueGap: 0, comparisons: [] };
      row.comparisons.push(comparison);
      row.flaggedItems = row.comparisons.length;
      row.averageGapPercent = roundMoney(row.comparisons.reduce((sum, entry) => sum + entry.gapPercent, 0) / row.comparisons.length);
      row.estimatedRevenueGap = roundMoney(row.comparisons.reduce((sum, entry) => sum + entry.estimatedRevenueGap, 0));
      partyRows.set(partyId, row);
    }
  }
  return [...partyRows.values()].sort((a, b) => b.estimatedRevenueGap - a.estimatedRevenueGap || b.averageGapPercent - a.averageGapPercent);
}
