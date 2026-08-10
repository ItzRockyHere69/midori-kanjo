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
export type FestivalDateStatus = "verified" | "provisional" | "business_estimate";

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
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
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
  /** Original line position when this row belongs to a linked return. */
  sourceLineIndex?: number;
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

export interface ReturnBalanceAllocation {
  invoiceId: string;
  amount: number;
}

export interface ReturnDetails {
  sourceInvoiceId?: string;
  allocations: ReturnBalanceAllocation[];
  /** Credit used to reduce the party's existing receivable or payable. */
  balanceApplied: number;
  /** Excess refunded to a customer or received from a supplier immediately. */
  settlementAmount: number;
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
  returnDetails?: ReturnDetails;
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

export type StockMovementKind =
  | "baseline"
  | "sale"
  | "sale_void"
  | "sale_restore"
  | "inward"
  | "outward"
  | "sale_return"
  | "purchase_return"
  | "manual_adjustment"
  | "count_adjustment";

export interface StockMovement {
  id: string;
  itemId: string;
  kind: StockMovementKind;
  /** Stable language-neutral reason code. */
  reason: string;
  /** Operator-entered text is preserved verbatim. */
  note: string;
  /** Quantity delta in the item's base unit; null when an unknown stock is set absolutely. */
  qtyChange: number | null;
  stockBefore: number | null;
  stockAfter: number | null;
  /** False when a relative movement was logged while stock remained unknown. */
  applied: boolean;
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
  date: string;
  actor: "owner" | "staff";
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export interface CountSession {
  id: string;
  categoryId: string;
  categoryName: string;
  status: "in_progress" | "completed";
  /** Stable denominator so later category edits do not change progress. */
  itemIds: string[];
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  isSynced: boolean;
}

export interface CountLine {
  id: string;
  sessionId: string;
  itemId: string;
  itemName: string;
  skuCode: string;
  baseUnit: Unit;
  systemStockAtStart: number | null;
  /** null means not counted; zero is a valid completed count. */
  countedStock: number | null;
  countedAt?: string;
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

/**
 * One editable occurrence of a festival. `year` is the year in which the
 * occurrence starts; Wedding Season can therefore end in the following year.
 * These rows deliberately remain device-local and are included in the normal
 * IndexedDB backup rather than the optional Supabase sync path.
 */
export interface FestivalEntry {
  id: string;
  festivalKey: string;
  year: number;
  nameEn: string;
  nameHi: string;
  nameBn: string;
  startDate: string;
  endDate: string;
  leadTimeWeeks: number;
  dateStatus: FestivalDateStatus;
  sourceNote: string;
  createdAt: string;
  updatedAt: string;
}

/** Completion state for the standard stock-planning task of one occurrence. */
export interface FestivalTask {
  id: string;
  festivalId: string;
  kind: "stock_plan";
  completedAt?: string;
  updatedAt: string;
}
export interface ActivityLog {
  id: string;
  action: string;
  entityType: "invoice" | "payment" | "party" | "item" | "expense" | "due" | "settings" | "sync" | "stock" | "count" | "festival";
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
  countLines!: EntityTable<CountLine, "id">;
  festivalEntries!: EntityTable<FestivalEntry, "id">;
  festivalTasks!: EntityTable<FestivalTask, "id">;
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
    this.version(6).stores({
      categories: "&id, name, parentId, *festivalSeason, isSynced, updatedAt",
      stockMovements: "&id, itemId, kind, reason, refInvoiceId, sourceInvoiceId, countSessionId, partyId, date, createdAt, updatedAt, isSynced",
      countSessions: "&id, categoryId, status, startedAt, completedAt, updatedAt, isSynced",
      countLines: "&id, [sessionId+itemId], sessionId, itemId, countedAt, updatedAt, isSynced"
    }).upgrade(async (transaction) => {
      const stamp = new Date().toISOString();
      await transaction.table("categories").toCollection().modify((stored: Partial<Category>) => {
        stored.createdAt = stored.createdAt || stamp;
        stored.updatedAt = stored.updatedAt || stored.createdAt;
        stored.isSynced = false;
      });

      await transaction.table("stockMovements").toCollection().modify((stored: Partial<StockMovement> & { countedBy?: string }) => {
        const occurredAt = stored.createdAt || (stored.date ? `${stored.date}T12:00:00.000Z` : stamp);
        stored.kind = stored.kind || "manual_adjustment";
        stored.reason = stored.reason || "legacy_adjustment";
        stored.note = stored.note || (stored.countedBy ? `Counted by ${stored.countedBy}` : "Imported legacy stock movement");
        stored.qtyChange = typeof stored.qtyChange === "number" && Number.isFinite(stored.qtyChange)
          ? stored.qtyChange
          : null;
        stored.stockBefore = stored.stockBefore ?? null;
        stored.stockAfter = stored.stockAfter ?? null;
        stored.applied = stored.applied ?? true;
        stored.date = stored.date || occurredAt.slice(0, 10);
        stored.actor = stored.actor || "staff";
        stored.createdAt = occurredAt;
        stored.updatedAt = stored.updatedAt || occurredAt;
        stored.isSynced = false;
        delete stored.countedBy;
      });

      const items = await transaction.table("items").toArray() as Item[];
      const itemById = new Map(items.map((item) => [item.id, item]));
      const existingBaselines = new Set(
        (await transaction.table("stockMovements").where("kind").equals("baseline").toArray())
          .map((movement: StockMovement) => movement.itemId),
      );
      const baselines: StockMovement[] = items
        .filter((item) => item.currentStock !== null && !existingBaselines.has(item.id))
        .map((item) => {
          const sourceStamp = item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z";
          const sourceMillis = Date.parse(sourceStamp);
          const baselineStamp = Number.isFinite(sourceMillis)
            ? new Date(sourceMillis + 1).toISOString()
            : "1970-01-01T00:00:00.001Z";
          return {
            id: `baseline:${item.id}`,
            itemId: item.id,
            kind: "baseline" as const,
            reason: "phase2_baseline",
            note: "Opening tracked stock at Phase 2 upgrade",
            qtyChange: null,
            stockBefore: null,
            stockAfter: item.currentStock,
            applied: true,
            date: baselineStamp.slice(0, 10),
            actor: "owner" as const,
            createdAt: baselineStamp,
            updatedAt: baselineStamp,
            isSynced: false,
          };
        });
      if (baselines.length) await transaction.table("stockMovements").bulkPut(baselines);

      const legacySessions = await transaction.table("countSessions").toArray() as Array<Partial<CountSession> & { id: string; categoryId: string; itemsCounted?: string[] }>;
      const legacyLines: CountLine[] = [];
      for (const stored of legacySessions) {
        const itemIds = stored.itemIds || stored.itemsCounted || [];
        const startedAt = stored.startedAt || stamp;
        const category = await transaction.table("categories").get(stored.categoryId) as Category | undefined;
        await transaction.table("countSessions").put({
          id: stored.id,
          categoryId: stored.categoryId,
          categoryName: stored.categoryName || category?.name || "Inventory count",
          status: stored.completedAt ? "completed" : "in_progress",
          itemIds,
          startedAt,
          completedAt: stored.completedAt,
          updatedAt: stored.updatedAt || stored.completedAt || startedAt,
          isSynced: false,
        } satisfies CountSession);
        for (const itemId of itemIds) {
          const item = itemById.get(itemId);
          if (!item) continue;
          legacyLines.push({
            id: `${stored.id}::${item.id}`,
            sessionId: stored.id,
            itemId: item.id,
            itemName: item.name,
            skuCode: item.skuCode,
            baseUnit: item.baseUnit,
            systemStockAtStart: item.currentStock,
            countedStock: null,
            createdAt: startedAt,
            updatedAt: stored.updatedAt || startedAt,
            isSynced: false,
          });
        }
      }
      if (legacyLines.length) await transaction.table("countLines").bulkPut(legacyLines);
    });
    this.version(7).stores({
      festivalEntries: "&id, festivalKey, year, [festivalKey+year], startDate, endDate, updatedAt",
      festivalTasks: "&id, festivalId, kind, completedAt, updatedAt",
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
