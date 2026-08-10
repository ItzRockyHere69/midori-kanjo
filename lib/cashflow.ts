import { db, isValidLocalDate, localDate, makeId, nowIso, type AccountEntry, type Expense, type ExpenseCategory, type ExpensePaymentMode, type Invoice, type Party, type Payment } from "./db";
import { invoiceInitialPaymentBreakdown, roundMoney } from "./billing";

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  refreshments: "Tea & coffee",
  customer_food: "Customer food",
  shop_supplies: "Shop supplies",
  transport: "Local transport",
  other: "Other"
};

export interface CashFlowMovement {
  id: string;
  date: string;
  createdAt: string;
  direction: "in" | "out";
  source: "sale" | "purchase" | "sale_return" | "purchase_return" | "customer_payment" | "supplier_payment" | "misc_expense";
  invoiceId?: string;
  paymentId?: string;
  expenseId?: string;
  partyId?: string | null;
  expenseCategory?: ExpenseCategory;
  title: string;
  details: string;
  mode: string;
  amount: number;
}

export interface CashFlowReport {
  fromDate: string;
  toDate: string;
  salesBilled: number;
  supplierBillsRecorded: number;
  receivedWithBills: number;
  customerPayments: number;
  moneyIn: number;
  paidWithPurchases: number;
  supplierPayments: number;
  miscellaneousExpenses: number;
  moneyOut: number;
  netCashFlow: number;
  customerOutstanding: number;
  supplierOutstanding: number;
  expenseBreakdown: { category: ExpenseCategory; label: string; amount: number }[];
  movements: CashFlowMovement[];
}

export function dateRangeLabel(fromDate: string, toDate: string) {
  if (!fromDate && !toDate) return "All recorded dates";
  const pretty = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "First record";
  return fromDate === toDate && fromDate ? pretty(fromDate) : `${pretty(fromDate)} to ${toDate ? pretty(toDate) : "Today"}`;
}

export function inDateRange(date: string, fromDate: string, toDate: string) {
  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

export async function recordExpense(input: { category: ExpenseCategory; amount: number; date?: string; description?: string; paymentMode: ExpensePaymentMode; reference?: string }) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a valid expense amount.");
  const amount = roundMoney(input.amount);
  if (amount < 0.01) throw new Error("Expense amount must be at least ₹0.01.");
  const date = input.date || localDate();
  if (!isValidLocalDate(date)) throw new Error("Choose a valid expense date.");
  const timestamp = nowIso();
  const expense: Expense = {
    id: makeId(),
    category: input.category,
    amount,
    date,
    description: input.description?.trim() || expenseCategoryLabels[input.category],
    paymentMode: input.paymentMode,
    reference: input.reference?.trim() || "",
    isSynced: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await db.expenses.add(expense);
  return expense;
}

export async function removeExpense(expenseId: string) {
  const expense = await db.expenses.get(expenseId);
  if (!expense) throw new Error("This expense no longer exists.");
  const timestamp = nowIso();
  await db.expenses.update(expenseId, { deletedAt: timestamp, updatedAt: timestamp, isSynced: false });
}

export async function restoreExpense(expenseId: string) {
  const expense = await db.expenses.get(expenseId);
  if (!expense) throw new Error("This expense no longer exists.");
  const timestamp = nowIso();
  await db.expenses.update(expenseId, { deletedAt: undefined, updatedAt: timestamp, isSynced: false });
}

export function buildCashFlowReport(input: { invoices: Invoice[]; payments: Payment[]; parties: Party[]; accountEntries: AccountEntry[]; expenses: Expense[]; fromDate?: string; toDate?: string }): CashFlowReport {
  const fromDate = input.fromDate || "";
  const toDate = input.toDate || "";
  const partyMap = new Map(input.parties.map((party) => [party.id, party]));
  const allocations = new Map<string, number>();
  for (const payment of input.payments) for (const allocation of payment.allocatedTo) allocations.set(allocation.invoiceId, roundMoney((allocations.get(allocation.invoiceId) || 0) + allocation.amount));

  const activeInvoices = input.invoices.filter((invoice) => !invoice.deletedAt && invoice.type !== "quotation");
  const periodInvoices = activeInvoices.filter((invoice) => inDateRange(invoice.date, fromDate, toDate));
  const salesBilled = roundMoney(periodInvoices.filter((invoice) => invoice.type === "sale").reduce((sum, invoice) => sum + invoice.grandTotal, 0));
  const purchaseInvoices = periodInvoices.filter((invoice) => invoice.type === "purchase");
  const supplierAccountEntries = input.accountEntries.filter((entry) => partyMap.get(entry.partyId)?.type === "supplier" && inDateRange(entry.date, fromDate, toDate));
  const supplierBillsRecorded = roundMoney(purchaseInvoices.reduce((sum, invoice) => sum + invoice.grandTotal, 0) + supplierAccountEntries.reduce((sum, entry) => sum + entry.amount, 0));
  const movements: CashFlowMovement[] = [];

  let receivedWithBills = 0;
  let paidWithPurchases = 0;
  for (const invoice of periodInvoices) {
    const breakdown = invoiceInitialPaymentBreakdown(
      invoice,
      allocations.get(invoice.id) || 0,
    );
    const initialPaid = roundMoney(
      breakdown.reduce((sum, entry) => sum + entry.amount, 0),
    );
    if (!initialPaid) continue;
    if (invoice.type === "sale" || invoice.type === "purchase_return") {
      const source = invoice.type === "sale" ? "sale" : "purchase_return";
      breakdown.forEach((entry, index) => movements.push({ id: `invoice-${invoice.id}-${index}`, invoiceId: invoice.id, date: invoice.date, createdAt: invoice.createdAt, direction: "in", source, partyId: invoice.partyId || null, title: invoice.type === "sale" ? `Sale ${invoice.invoiceNumber}` : `Purchase return ${invoice.invoiceNumber}`, details: [invoice.partyName, entry.reference].filter(Boolean).join(" · "), mode: entry.mode, amount: entry.amount }));
      receivedWithBills = roundMoney(receivedWithBills + initialPaid);
    } else if (invoice.type === "purchase" || invoice.type === "sale_return") {
      const source = invoice.type === "purchase" ? "purchase" : "sale_return";
      breakdown.forEach((entry, index) => movements.push({ id: `invoice-${invoice.id}-${index}`, invoiceId: invoice.id, date: invoice.date, createdAt: invoice.createdAt, direction: "out", source, partyId: invoice.partyId || null, title: invoice.type === "purchase" ? `Purchase ${invoice.invoiceNumber}` : `Sale return ${invoice.invoiceNumber}`, details: [invoice.partyName, entry.reference].filter(Boolean).join(" · "), mode: entry.mode, amount: entry.amount }));
      paidWithPurchases = roundMoney(paidWithPurchases + initialPaid);
    }
  }

  let customerPayments = 0;
  let supplierPayments = 0;
  for (const payment of input.payments.filter((entry) => inDateRange(entry.date, fromDate, toDate))) {
    const party = partyMap.get(payment.partyId);
    if (!party) continue;
    const direction = party.type === "customer" ? "in" : "out";
    movements.push({
      id: `payment-${payment.id}`,
      paymentId: payment.id,
      date: payment.date,
      createdAt: payment.createdAt,
      direction,
      source: party.type === "customer" ? "customer_payment" : "supplier_payment",
      title: party.type === "customer" ? `Payment from ${party.name}` : `Payment to ${party.name}`,
      details: payment.reference || (payment.allocatedTo.length ? `${payment.allocatedTo.length} bill allocation${payment.allocatedTo.length === 1 ? "" : "s"}` : "Account payment"),
      mode: payment.mode,
      amount: payment.amount
    });
    if (party.type === "customer") customerPayments = roundMoney(customerPayments + payment.amount);
    else supplierPayments = roundMoney(supplierPayments + payment.amount);
  }

  const activeExpenses = input.expenses.filter((expense) => !expense.deletedAt && inDateRange(expense.date, fromDate, toDate));
  const expenseMap = new Map<ExpenseCategory, number>();
  for (const expense of activeExpenses) {
    expenseMap.set(expense.category, roundMoney((expenseMap.get(expense.category) || 0) + expense.amount));
    movements.push({ id: `expense-${expense.id}`, expenseId: expense.id, date: expense.date, createdAt: expense.createdAt, direction: "out", source: "misc_expense", expenseCategory: expense.category, title: expense.description, details: expenseCategoryLabels[expense.category] + (expense.reference ? ` · ${expense.reference}` : ""), mode: expense.paymentMode, amount: expense.amount });
  }
  const miscellaneousExpenses = roundMoney(activeExpenses.reduce((sum, expense) => sum + expense.amount, 0));
  const moneyIn = roundMoney(receivedWithBills + customerPayments);
  const moneyOut = roundMoney(paidWithPurchases + supplierPayments + miscellaneousExpenses);
  const expenseBreakdown = (Object.keys(expenseCategoryLabels) as ExpenseCategory[]).map((category) => ({ category, label: expenseCategoryLabels[category], amount: expenseMap.get(category) || 0 })).filter((row) => row.amount > 0);
  movements.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return {
    fromDate,
    toDate,
    salesBilled,
    supplierBillsRecorded,
    receivedWithBills,
    customerPayments,
    moneyIn,
    paidWithPurchases,
    supplierPayments,
    miscellaneousExpenses,
    moneyOut,
    netCashFlow: roundMoney(moneyIn - moneyOut),
    customerOutstanding: roundMoney(input.parties.filter((party) => party.type === "customer").reduce((sum, party) => sum + Math.max(0, party.currentBalance), 0)),
    supplierOutstanding: roundMoney(input.parties.filter((party) => party.type === "supplier").reduce((sum, party) => sum + Math.max(0, party.currentBalance), 0)),
    expenseBreakdown,
    movements
  };
}
