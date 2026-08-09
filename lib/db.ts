import Dexie, { type EntityTable } from "dexie";

export type Language = "en" | "bn" | "hi";
export type PriceTier = "retail" | "wholesale" | "bulk" | "special";
export type Unit = "piece" | "dozen" | "gross" | "bundle" | "box" | "packet";
export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "credit" | "mixed";
export type PaymentChannel = Exclude<PaymentMode, "credit" | "mixed">;
export type InvoiceType = "sale" | "purchase" | "sale_return" | "purchase_return" | "quotation";
export type InvoiceChargeCode = "carrier" | "packing" | "big_box";
export type ExpenseCategory = "refreshments" | "customer_food" | "shop_supplies" | "transport" | "other";
export type ExpensePaymentMode = "cash" | "upi" | "bank";

export interface Party {
  id: string;
  name: string;
  codeName: string;
  phone: string;
  address: string;
  gstin?: string;
  type: "customer" | "supplier";
  priceTier: PriceTier;
  openingBalance: number;
  currentBalance: number;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export interface BillingCustomerDraft {
  name: string;
  codeName?: string;
  phone?: string;
  address?: string;
}

export interface Item {
  id: string;
  name: string;
  nameHi: string;
  nameBn: string;
  skuCode: string;
  categoryId: string;
  baseUnit: Unit;
  conversionRate: number;
  purchasePrice: number;
  priceRetail: number;
  priceWholesale: number;
  priceBulk: number;
  currentStock: number | null;
  lowStockAlert: number | null;
  festivalTags: string[];
  hsnCode?: string;
  gstRate: number;
  imageUrl?: string;
  isActive: boolean;
  saleCount: number;
  lastSoldDate?: string;
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  festivalSeason: string[];
}

export interface PartyItemPrice {
  id: string;
  partyId: string;
  itemId: string;
  lastPrice: number;
  lastSoldDate: string;
  timesSold: number;
  lockedPrice: boolean;
  updatedAt: string;
  isSynced: boolean;
}

export interface InvoiceLine {
  itemId: string;
  itemName: string;
  /** Optional localized snapshots preserve the wording used when the bill was saved. */
  itemNameHi?: string;
  itemNameBn?: string;
  skuCode: string;
  hsnCode: string;
  qty: number;
  unit: Unit;
  baseUnit?: Unit;
  rate: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  amount: number;
  /** Cost captured in the sold unit when the document was created. */
  unitCost?: number;
  lastPriceLabel?: string;
  lockPrice?: boolean;
}

export interface InvoiceCharge {
  code: InvoiceChargeCode;
  label: string;
  amount: number;
}

export interface InvoicePaymentAllocation {
  mode: PaymentChannel;
  amount: number;
  reference?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  partyId?: string;
  partyName: string;
  partyGstin?: string;
  date: string;
  type: InvoiceType;
  lineItems: InvoiceLine[];
  subtotal: number;
  discountTotal: number;
  gstTotal: number;
  otherCharges?: InvoiceCharge[];
  otherChargesTotal?: number;
  roundOff: number;
  grandTotal: number;
  /** Amount received while the invoice itself was created (before later Payment events). */
  initialAmountPaid?: number;
  amountPaid: number;
  amountDue: number;
  paymentMode: PaymentMode;
  paymentReceivedMode?: PaymentChannel;
  /** Exact tender amounts received when the document was created. */
  paymentBreakdown?: InvoicePaymentAllocation[];
  notes: string;
  isSynced: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface PaymentAllocation { invoiceId: string; amount: number }
export interface Payment {
  id: string;
  partyId: string;
  amount: number;
  date: string;
  mode: PaymentChannel;
  reference: string;
  allocatedTo: PaymentAllocation[];
  isSynced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountEntry {
  id: string;
  partyId: string;
  kind: "due";
  amount: number;
  date: string;
  note: string;
  reference: string;
  isSynced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  description: string;
  paymentMode: ExpensePaymentMode;
  reference: string;
  isSynced: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StockMovement {
  id: string; itemId: string; qtyChange: number; reason: string; refInvoiceId?: string; date: string; countedBy?: string;
}
export interface CountSession {
  id: string; categoryId: string; startedAt: string; completedAt?: string; itemsCounted: string[];
}
export interface ActivityLog {
  id: string;
  action: string;
  entityType: "invoice" | "payment" | "party" | "item" | "expense" | "due" | "settings" | "sync";
  entityId?: string;
  description: string;
  actor: "owner" | "staff";
  metadata: string;
  createdAt: string;
}
export interface DailyClose {
  id: string;
  date: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  discrepancy: number;
  notes: string;
  closedAt: string;
  updatedAt: string;
}
export interface AppMeta { key: string; value: string | number | boolean }

class BurrabazarDB extends Dexie {
  parties!: EntityTable<Party, "id">;
  items!: EntityTable<Item, "id">;
  categories!: EntityTable<Category, "id">;
  partyItemPrices!: EntityTable<PartyItemPrice, "id">;
  invoices!: EntityTable<Invoice, "id">;
  payments!: EntityTable<Payment, "id">;
  accountEntries!: EntityTable<AccountEntry, "id">;
  expenses!: EntityTable<Expense, "id">;
  stockMovements!: EntityTable<StockMovement, "id">;
  countSessions!: EntityTable<CountSession, "id">;
  activityLogs!: EntityTable<ActivityLog, "id">;
  dailyCloses!: EntityTable<DailyClose, "id">;
  meta!: EntityTable<AppMeta, "key">;

  constructor() {
    super("BurrabazarBillingDB");
    this.version(1).stores({
      parties: "&id, name, phone, type, priceTier, currentBalance, isSynced, updatedAt",
      items: "&id, name, nameHi, nameBn, skuCode, categoryId, baseUnit, *festivalTags, isActive, saleCount, lastSoldDate, isSynced, updatedAt",
      categories: "&id, name, parentId, *festivalSeason",
      partyItemPrices: "&id, [partyId+itemId], partyId, itemId, lastSoldDate, timesSold, isSynced, updatedAt",
      invoices: "&id, &invoiceNumber, partyId, date, type, isSynced, createdAt, updatedAt, deletedAt",
      payments: "&id, partyId, date, isSynced, createdAt, updatedAt",
      stockMovements: "&id, itemId, reason, refInvoiceId, date",
      countSessions: "&id, categoryId, startedAt, completedAt",
      meta: "&key"
    });
    this.version(2).stores({
      parties: "&id, name, phone, type, priceTier, currentBalance, isSynced, updatedAt",
      items: "&id, name, nameHi, nameBn, skuCode, categoryId, baseUnit, *festivalTags, isActive, saleCount, lastSoldDate, isSynced, updatedAt",
      categories: "&id, name, parentId, *festivalSeason",
      partyItemPrices: "&id, [partyId+itemId], partyId, itemId, lastSoldDate, timesSold, isSynced, updatedAt",
      invoices: "&id, &invoiceNumber, partyId, date, type, isSynced, createdAt, updatedAt, deletedAt",
      payments: "&id, partyId, date, isSynced, createdAt, updatedAt",
      accountEntries: "&id, partyId, kind, date, isSynced, createdAt, updatedAt",
      stockMovements: "&id, itemId, reason, refInvoiceId, date",
      countSessions: "&id, categoryId, startedAt, completedAt",
      meta: "&key"
    });
    this.version(3).stores({
      parties: "&id, name, codeName, phone, address, type, priceTier, currentBalance, isSynced, updatedAt"
    }).upgrade((transaction) => transaction.table("parties").toCollection().modify((stored: Omit<Party,"codeName"> & { codeName?: string }) => {
      if (stored.codeName?.trim()) return;
      stored.codeName = "";
      stored.updatedAt = new Date().toISOString();
      stored.isSynced = false;
    }));
    this.version(4).stores({
      expenses: "&id, category, date, paymentMode, isSynced, createdAt, updatedAt, deletedAt"
    });
    this.version(5).stores({
      activityLogs: "&id, action, entityType, entityId, actor, createdAt",
      dailyCloses: "&id, &date, closedAt, updatedAt"
    });
  }
}

export const db = new BurrabazarDB();

export const nowIso = () => new Date().toISOString();
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const isValidLocalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};
export const makeId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const priceKey = (partyId: string, itemId: string) => `${partyId}::${itemId}`;
