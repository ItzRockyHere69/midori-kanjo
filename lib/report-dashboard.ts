import { invoiceInitialPaymentBreakdown, roundMoney } from "./billing";
import type { Invoice, Payment, PaymentChannel } from "./db";

export type DashboardPeriod = "7d" | "30d" | "90d" | "all";

export interface DashboardPeriodRange {
  fromDate: string;
  toDate: string;
}

export interface SettlementModeRow {
  mode: PaymentChannel;
  amount: number;
}

export interface SalesSettlementReport {
  totalSales: number;
  collected: number;
  due: number;
  collectionPercent: number;
  modes: SettlementModeRow[];
}

export interface DashboardTrendBucket {
  startDate: string;
  endDate: string;
  labelDate: string;
  value: number;
}

const paymentModeOrder: PaymentChannel[] = ["cash", "upi", "bank", "cheque"];

const localDateFrom = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

const dateDayNumber = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / 86400000 : NaN;
};

const dateFromDayNumber = (value: number) =>
  new Date(value * 86400000).toISOString().slice(0, 10);

/** Inclusive local-date range used by the Reports period switcher. */
export function dashboardPeriodRange(
  period: DashboardPeriod,
  todayDate: string,
): DashboardPeriodRange {
  const [year, month, day] = todayDate.split("-").map(Number);
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
  if (!days) return { fromDate: "", toDate: "" };
  const from = new Date(year, month - 1, day - days + 1);
  return { fromDate: localDateFrom(from), toDate: todayDate };
}

/** Calendar buckets anchored to the selected range, never to the viewing day. */
export function buildDashboardTrendBuckets(
  sales: Invoice[],
  fromDate: string,
  toDate: string,
  todayDate: string,
  maxBuckets = 7,
): DashboardTrendBucket[] {
  const todayDay = dateDayNumber(todayDate);
  const saleDays = sales
    .filter((invoice) => !invoice.deletedAt && invoice.type === "sale")
    .map((invoice) => dateDayNumber(invoice.date))
    .filter(Number.isFinite);
  const earliestSaleDay = saleDays.length ? Math.min(...saleDays) : todayDay;
  const requestedStart = dateDayNumber(fromDate);
  const requestedEnd = dateDayNumber(toDate);
  const startDay = Number.isFinite(requestedStart)
    ? requestedStart
    : Math.min(earliestSaleDay, todayDay - 29);
  const endDay = Number.isFinite(requestedEnd) ? requestedEnd : todayDay;
  const safeStartDay = Math.min(startDay, endDay);
  const totalDays = Math.max(1, endDay - safeStartDay + 1);
  const bucketCount = Math.max(
    1,
    Math.min(Math.floor(maxBuckets) || 1, totalDays),
  );

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStartDay =
      safeStartDay + Math.floor((index * totalDays) / bucketCount);
    const bucketEndDay =
      safeStartDay + Math.floor(((index + 1) * totalDays) / bucketCount);
    return {
      startDate: dateFromDayNumber(bucketStartDay),
      endDate: dateFromDayNumber(bucketEndDay - 1),
      labelDate: dateFromDayNumber(bucketEndDay - 1),
      value: roundMoney(
        sales
          .filter((invoice) => {
            if (invoice.deletedAt || invoice.type !== "sale") return false;
            const invoiceDay = dateDayNumber(invoice.date);
            return invoiceDay >= bucketStartDay && invoiceDay < bucketEndDay;
          })
          .reduce((sum, invoice) => sum + invoice.grandTotal, 0),
      ),
    };
  });
}

/**
 * Reconciles selected sales into money already collected by channel and the
 * balance still due. Initial split tenders and later allocated payments are
 * counted once, capped at each invoice total, and always add back to sales.
 */
export function buildSalesSettlementReport(
  sales: Invoice[],
  payments: Payment[],
  asOfDate = "",
): SalesSettlementReport {
  const allocationsByInvoice = new Map<
    string,
    Array<{
      amount: number;
      mode: PaymentChannel;
      partyId: string;
      date: string;
      timestamp: string;
      paymentId: string;
    }>
  >();

  for (const payment of payments) {
    for (const allocation of payment.allocatedTo || []) {
      if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) continue;
      const allocations = allocationsByInvoice.get(allocation.invoiceId) || [];
      allocations.push({
        amount: roundMoney(allocation.amount),
        mode: payment.mode,
        partyId: payment.partyId,
        date: payment.date,
        timestamp: payment.createdAt,
        paymentId: payment.id,
      });
      allocationsByInvoice.set(allocation.invoiceId, allocations);
    }
  }

  const totals = new Map<PaymentChannel, number>();
  const addCollected = (mode: PaymentChannel, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    totals.set(mode, roundMoney((totals.get(mode) || 0) + amount));
  };
  let due = 0;
  let totalSales = 0;

  for (const invoice of sales) {
    if (invoice.deletedAt || invoice.type !== "sale") continue;
    totalSales = roundMoney(totalSales + invoice.grandTotal);
    const allLaterPayments = (allocationsByInvoice.get(invoice.id) || [])
      .filter(
        (allocation) =>
          !invoice.partyId || allocation.partyId === invoice.partyId,
      )
      .sort(
        (a, b) =>
          a.timestamp.localeCompare(b.timestamp) ||
          a.paymentId.localeCompare(b.paymentId),
      );
    const laterAllocated = roundMoney(
      allLaterPayments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    const laterPayments = allLaterPayments.filter(
      (payment) => !asOfDate || payment.date <= asOfDate,
    );
    const initialBreakdown = invoiceInitialPaymentBreakdown(
      invoice,
      laterAllocated,
    );
    let initialCapacity = Math.max(0, roundMoney(invoice.grandTotal));
    let initialPaid = 0;
    for (const entry of initialBreakdown) {
      const applied = Math.min(initialCapacity, roundMoney(entry.amount));
      addCollected(entry.mode, applied);
      initialPaid = roundMoney(initialPaid + applied);
      initialCapacity = Math.max(0, roundMoney(initialCapacity - applied));
      if (initialCapacity <= 0) break;
    }

    let unsettled = Math.max(
      0,
      roundMoney(invoice.grandTotal - initialPaid),
    );
    for (const payment of laterPayments) {
      const applied = Math.min(unsettled, roundMoney(payment.amount));
      addCollected(payment.mode, applied);
      unsettled = Math.max(0, roundMoney(unsettled - applied));
      if (unsettled <= 0) break;
    }
    due = roundMoney(due + unsettled);
  }

  const modes = paymentModeOrder
    .map((mode) => ({ mode, amount: totals.get(mode) || 0 }))
    .filter((row) => row.amount > 0);
  const collected = roundMoney(
    modes.reduce((sum, row) => sum + row.amount, 0),
  );
  const reconciledDue = Math.max(0, roundMoney(totalSales - collected));
  return {
    totalSales,
    collected,
    due: Math.abs(reconciledDue - due) < 0.02 ? due : reconciledDue,
    collectionPercent: totalSales
      ? Math.min(100, Math.max(0, (collected / totalSales) * 100))
      : 0,
    modes,
  };
}
