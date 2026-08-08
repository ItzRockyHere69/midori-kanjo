import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  db,
  type AccountEntry,
  type Expense,
  type Invoice,
  type Item,
  type Party,
  type PartyItemPrice,
  type Payment,
} from "./db";
import { roundMoney } from "./billing";

export type SyncState = "synced" | "pending" | "offline" | "syncing";
export interface CloudConfig {
  url: string;
  key: string;
  syncCode: string;
}

const CLOUD_CONFIG_KEY = "mantu-supabase-config-v1";

function environment() {
  const vite = (import.meta as ImportMeta & { env?: Record<string, string> })
    .env;
  const node = typeof process !== "undefined" ? process.env : undefined;
  return {
    url: vite?.VITE_SUPABASE_URL || node?.NEXT_PUBLIC_SUPABASE_URL || "",
    key:
      vite?.VITE_SUPABASE_ANON_KEY || node?.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    syncCode:
      vite?.VITE_SUPABASE_SYNC_CODE ||
      node?.NEXT_PUBLIC_SUPABASE_SYNC_CODE ||
      "",
  };
}

function storedCloudConfig(): CloudConfig | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(CLOUD_CONFIG_KEY) || "null",
    ) as Partial<CloudConfig> | null;
    if (!value?.url || !value.key || !value.syncCode) return null;
    return {
      url: String(value.url).trim(),
      key: String(value.key).trim(),
      syncCode: String(value.syncCode).trim(),
    };
  } catch {
    return null;
  }
}

export function getCloudConfig(): CloudConfig {
  return storedCloudConfig() || environment();
}

let client: SupabaseClient | null = null;
let clientSignature = "";

export function configureCloud(config: CloudConfig) {
  const url = config.url.trim().replace(/\/$/, "");
  const key = config.key.trim();
  const syncCode = config.syncCode.trim();
  if (!url || !key || !syncCode)
    throw new Error(
      "Enter the Supabase URL, anon public key and business sync code.",
    );
  if (syncCode.length < 20)
    throw new Error("Use a business sync code of at least 20 characters.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid Supabase project URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("Supabase sync requires an HTTPS project URL.");
  if (typeof localStorage === "undefined")
    throw new Error("Cloud settings are unavailable in this environment.");
  const saved = { url, key, syncCode };
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(saved));
  client = null;
  clientSignature = "";
  return saved;
}

export function clearCloudConfig() {
  if (typeof localStorage !== "undefined")
    localStorage.removeItem(CLOUD_CONFIG_KEY);
  client = null;
  clientSignature = "";
}

export function supabaseClient() {
  const config = getCloudConfig();
  if (!config.url || !config.key) return null;
  const signature = `${config.url}\n${config.key}`;
  if (!client || clientSignature !== signature) {
    client = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    clientSignature = signature;
  }
  return client;
}

export function isCloudConfigured() {
  return Boolean(supabaseClient());
}

const partyToRow = (x: Party) => ({
  id: x.id,
  name: x.name,
  code_name: x.codeName,
  phone: x.phone,
  address: x.address,
  gstin: x.gstin || null,
  type: x.type,
  price_tier: x.priceTier,
  opening_balance: x.openingBalance,
  current_balance: x.currentBalance,
  notes: x.notes,
  tags: x.tags,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const itemToRow = (x: Item) => ({
  id: x.id,
  name: x.name,
  name_hi: x.nameHi,
  name_bn: x.nameBn,
  sku_code: x.skuCode,
  category_id: x.categoryId,
  base_unit: x.baseUnit,
  conversion_rate: x.conversionRate,
  purchase_price: x.purchasePrice,
  price_retail: x.priceRetail,
  price_wholesale: x.priceWholesale,
  price_bulk: x.priceBulk,
  current_stock: x.currentStock,
  low_stock_alert: x.lowStockAlert,
  festival_tags: x.festivalTags,
  hsn_code: x.hsnCode || null,
  gst_rate: x.gstRate,
  image_url: x.imageUrl || null,
  is_active: x.isActive,
  sale_count: x.saleCount,
  last_sold_date: x.lastSoldDate || null,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const priceToRow = (x: PartyItemPrice) => ({
  id: x.id,
  party_id: x.partyId,
  item_id: x.itemId,
  last_price: x.lastPrice,
  last_sold_date: x.lastSoldDate,
  times_sold: x.timesSold,
  locked_price: x.lockedPrice,
  updated_at: x.updatedAt,
});
const invoiceToRow = (x: Invoice) => ({
  id: x.id,
  invoice_number: x.invoiceNumber,
  party_id: x.partyId || null,
  party_name: x.partyName,
  party_gstin: x.partyGstin || null,
  date: x.date,
  type: x.type,
  line_items: x.lineItems,
  subtotal: x.subtotal,
  discount_total: x.discountTotal,
  gst_total: x.gstTotal,
  other_charges: x.otherCharges || [],
  other_charges_total: x.otherChargesTotal || 0,
  round_off: x.roundOff,
  grand_total: x.grandTotal,
  amount_paid: x.amountPaid,
  amount_due: x.amountDue,
  payment_mode: x.paymentMode,
  payment_received_mode: x.paymentReceivedMode || null,
  notes: x.notes,
  deleted_at: x.deletedAt || null,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const paymentToRow = (x: Payment) => ({
  id: x.id,
  party_id: x.partyId,
  amount: x.amount,
  date: x.date,
  mode: x.mode,
  reference: x.reference,
  allocated_to: x.allocatedTo,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const accountEntryToRow = (x: AccountEntry) => ({
  id: x.id,
  party_id: x.partyId,
  kind: x.kind,
  amount: x.amount,
  date: x.date,
  note: x.note,
  reference: x.reference,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const expenseToRow = (x: Expense) => ({
  id: x.id,
  category: x.category,
  amount: x.amount,
  date: x.date,
  description: x.description,
  payment_mode: x.paymentMode,
  reference: x.reference,
  deleted_at: x.deletedAt || null,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});

async function ensureSession(supabase: SupabaseClient) {
  const { data } = await supabase.auth.getSession();
  const sessionCode = String(data.session?.user.user_metadata?.sync_code || "");
  const syncCode = getCloudConfig().syncCode || sessionCode;
  if (!syncCode) throw new Error("A business sync code is required.");
  if (sessionCode === syncCode) return;
  if (data.session) await supabase.auth.signOut();
  const result = await supabase.auth.signInAnonymously({
    options: { data: { sync_code: syncCode } },
  });
  if (result.error) throw result.error;
}

async function pushTable<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  local: T[],
  mapper: (row: T) => Record<string, unknown>,
) {
  if (!local.length) return;
  const batchSize = 100;
  for (let offset = 0; offset < local.length; offset += batchSize) {
    const { error } = await supabase
      .from(table)
      .upsert(local.slice(offset, offset + batchSize).map(mapper), { onConflict: "id" });
    if (error) throw error;
  }
}

type RemoteRow = Record<string, unknown>;
const text = (value: unknown) => (value == null ? "" : String(value));
const number = (value: unknown) => Number(value || 0);
const list = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

async function selectAll(supabase: SupabaseClient, table: string) {
  const rows: RemoteRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const selection = supabase.from(table).select("*");
    const range = (selection as unknown as { range?: (from: number, to: number) => Promise<{ data: unknown; error: unknown }> }).range;
    const result = range
      ? await range.call(selection, from, from + pageSize - 1)
      : await selection;
    if (result.error) throw result.error;
    const page = (result.data as RemoteRow[]) || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function pullRemote(supabase: SupabaseClient) {
  const [
    partiesResult,
    itemsResult,
    pricesResult,
    invoicesResult,
    paymentsResult,
    accountEntriesResult,
    expensesResult,
  ] = await Promise.all([
    selectAll(supabase, "parties"),
    selectAll(supabase, "items"),
    selectAll(supabase, "party_item_prices"),
    selectAll(supabase, "invoices"),
    selectAll(supabase, "payments"),
    selectAll(supabase, "account_entries"),
    selectAll(supabase, "expenses"),
  ]);
  const parties = partiesResult.map(
    (r): Party => ({
      id: text(r.id),
      name: text(r.name),
      codeName:
        text(r.code_name) ||
        `${r.type === "supplier" ? "SUP" : "CUS"}-${text(r.id)
          .replace(/[^a-z0-9]/gi, "")
          .slice(-6)
          .toUpperCase()}`,
      phone: text(r.phone),
      address: text(r.address),
      gstin: text(r.gstin) || undefined,
      type: r.type === "supplier" ? "supplier" : "customer",
      priceTier: (r.price_tier as Party["priceTier"]) || "wholesale",
      openingBalance: number(r.opening_balance),
      currentBalance: number(r.current_balance),
      notes: text(r.notes),
      tags: list(r.tags),
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const items = itemsResult.map(
    (r): Item => ({
      id: text(r.id),
      name: text(r.name),
      nameHi: text(r.name_hi),
      nameBn: text(r.name_bn),
      skuCode: text(r.sku_code),
      categoryId: text(r.category_id),
      baseUnit: r.base_unit as Item["baseUnit"],
      conversionRate: number(r.conversion_rate),
      purchasePrice: number(r.purchase_price),
      priceRetail: number(r.price_retail),
      priceWholesale: number(r.price_wholesale),
      priceBulk: number(r.price_bulk),
      currentStock: r.current_stock == null ? null : number(r.current_stock),
      lowStockAlert:
        r.low_stock_alert == null ? null : number(r.low_stock_alert),
      festivalTags: list(r.festival_tags),
      hsnCode: text(r.hsn_code) || undefined,
      gstRate: number(r.gst_rate),
      imageUrl: text(r.image_url) || undefined,
      isActive: r.is_active !== false,
      saleCount: number(r.sale_count),
      lastSoldDate: text(r.last_sold_date) || undefined,
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const prices = pricesResult.map(
    (r): PartyItemPrice => ({
      id: text(r.id),
      partyId: text(r.party_id),
      itemId: text(r.item_id),
      lastPrice: number(r.last_price),
      lastSoldDate: text(r.last_sold_date),
      timesSold: number(r.times_sold),
      lockedPrice: Boolean(r.locked_price),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const invoices = invoicesResult.map(
    (r): Invoice => ({
      id: text(r.id),
      invoiceNumber: text(r.invoice_number),
      partyId: text(r.party_id) || undefined,
      partyName: text(r.party_name),
      partyGstin: text(r.party_gstin) || undefined,
      date: text(r.date),
      type: r.type as Invoice["type"],
      lineItems: r.line_items as Invoice["lineItems"],
      subtotal: number(r.subtotal),
      discountTotal: number(r.discount_total),
      gstTotal: number(r.gst_total),
      otherCharges: Array.isArray(r.other_charges)
        ? (r.other_charges as Invoice["otherCharges"])
        : [],
      otherChargesTotal: number(r.other_charges_total),
      roundOff: number(r.round_off),
      grandTotal: number(r.grand_total),
      amountPaid: number(r.amount_paid),
      amountDue: number(r.amount_due),
      paymentMode: r.payment_mode as Invoice["paymentMode"],
      paymentReceivedMode: ["cash", "upi", "bank"].includes(
        text(r.payment_received_mode),
      )
        ? (text(r.payment_received_mode) as Invoice["paymentReceivedMode"])
        : undefined,
      notes: text(r.notes),
      deletedAt: text(r.deleted_at) || undefined,
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const payments = paymentsResult.map(
    (r): Payment => ({
      id: text(r.id),
      partyId: text(r.party_id),
      amount: number(r.amount),
      date: text(r.date),
      mode: r.mode as Payment["mode"],
      reference: text(r.reference),
      allocatedTo: r.allocated_to as Payment["allocatedTo"],
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const accountEntries = accountEntriesResult.map(
    (r): AccountEntry => ({
      id: text(r.id),
      partyId: text(r.party_id),
      kind: "due",
      amount: number(r.amount),
      date: text(r.date),
      note: text(r.note),
      reference: text(r.reference),
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const expenses = expensesResult.map(
    (r): Expense => ({
      id: text(r.id),
      category: r.category as Expense["category"],
      amount: number(r.amount),
      date: text(r.date),
      description: text(r.description),
      paymentMode: r.payment_mode as Expense["paymentMode"],
      reference: text(r.reference),
      deletedAt: text(r.deleted_at) || undefined,
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const conflicts: Array<{ table: string; id: string; localUpdatedAt: string; remoteUpdatedAt: string; detectedAt: string }> = [];
  await db.transaction(
    "rw",
    [
      db.parties,
      db.items,
      db.partyItemPrices,
      db.invoices,
      db.payments,
      db.accountEntries,
      db.expenses,
    ],
    async () => {
      const [
        localParties,
        localItems,
        localPrices,
        localInvoices,
        localPayments,
        localAccountEntries,
        localExpenses,
      ] = await Promise.all([
        db.parties.bulkGet(parties.map((x) => x.id)),
        db.items.bulkGet(items.map((x) => x.id)),
        db.partyItemPrices.bulkGet(prices.map((x) => x.id)),
        db.invoices.bulkGet(invoices.map((x) => x.id)),
        db.payments.bulkGet(payments.map((x) => x.id)),
        db.accountEntries.bulkGet(accountEntries.map((x) => x.id)),
        db.expenses.bulkGet(expenses.map((x) => x.id)),
      ]);
      const collectConflicts = <T extends { id: string; updatedAt: string; isSynced: boolean }>(table: string, remote: T[], local: Array<T | undefined>) => {
        remote.forEach((row, index) => {
          const stored = local[index];
          if (stored && !stored.isSynced && row.updatedAt > stored.updatedAt) conflicts.push({ table, id: row.id, localUpdatedAt: stored.updatedAt, remoteUpdatedAt: row.updatedAt, detectedAt: new Date().toISOString() });
        });
      };
      collectConflicts("parties", parties, localParties);
      collectConflicts("items", items, localItems);
      collectConflicts("party_item_prices", prices, localPrices);
      collectConflicts("invoices", invoices, localInvoices);
      collectConflicts("payments", payments, localPayments);
      collectConflicts("account_entries", accountEntries, localAccountEntries);
      collectConflicts("expenses", expenses, localExpenses);
      await db.parties.bulkPut(
        parties.filter(
          (remote, index) =>
            !localParties[index] ||
            localParties[index]!.isSynced ||
            remote.updatedAt >= localParties[index]!.updatedAt,
        ),
      );
      await db.items.bulkPut(
        items.filter(
          (remote, index) =>
            !localItems[index] ||
            localItems[index]!.isSynced ||
            remote.updatedAt >= localItems[index]!.updatedAt,
        ),
      );
      await db.partyItemPrices.bulkPut(
        prices.filter(
          (remote, index) =>
            !localPrices[index] ||
            localPrices[index]!.isSynced ||
            remote.updatedAt >= localPrices[index]!.updatedAt,
        ),
      );
      await db.invoices.bulkPut(
        invoices.filter(
          (remote, index) =>
            !localInvoices[index] ||
            localInvoices[index]!.isSynced ||
            remote.updatedAt >= localInvoices[index]!.updatedAt,
        ),
      );
      await db.payments.bulkPut(
        payments.filter(
          (remote, index) =>
            !localPayments[index] ||
            localPayments[index]!.isSynced ||
            remote.updatedAt >= localPayments[index]!.updatedAt,
        ),
      );
      await db.accountEntries.bulkPut(
        accountEntries.filter(
          (remote, index) =>
            !localAccountEntries[index] ||
            localAccountEntries[index]!.isSynced ||
            remote.updatedAt >= localAccountEntries[index]!.updatedAt,
        ),
      );
      await db.expenses.bulkPut(
        expenses.filter(
          (remote, index) =>
            !localExpenses[index] ||
            localExpenses[index]!.isSynced ||
            remote.updatedAt >= localExpenses[index]!.updatedAt,
        ),
      );
    },
  );
  if (conflicts.length) {
    let previous: unknown[] = [];
    try { previous = JSON.parse(String((await db.meta.get("sync-conflicts-v1"))?.value || "[]")) as unknown[]; } catch {}
    await db.meta.put({ key: "sync-conflicts-v1", value: JSON.stringify([...previous, ...conflicts].slice(-100)) });
  }
}

export async function reconcilePartyBalances() {
  await db.transaction("rw", [db.parties, db.invoices, db.payments, db.accountEntries], async () => {
    const [parties, invoices, payments, dues] = await Promise.all([
      db.parties.toArray(),
      db.invoices.toArray(),
      db.payments.toArray(),
      db.accountEntries.toArray(),
    ]);
    const allocatedByInvoice = new Map<string, number>();
    for (const payment of payments) for (const allocation of payment.allocatedTo) {
      allocatedByInvoice.set(allocation.invoiceId, roundMoney((allocatedByInvoice.get(allocation.invoiceId) || 0) + allocation.amount));
    }
    const stamp = new Date().toISOString();
    for (const party of parties) {
      let balance = party.openingBalance;
      for (const invoice of invoices) {
        if (invoice.partyId !== party.id || invoice.deletedAt || !["sale", "purchase"].includes(invoice.type)) continue;
        const laterPaid = allocatedByInvoice.get(invoice.id) || 0;
        const receivedWithBill = Math.max(0, roundMoney(invoice.amountPaid - laterPaid));
        balance += invoice.grandTotal - receivedWithBill;
      }
      for (const due of dues) if (due.partyId === party.id) balance += due.amount;
      for (const payment of payments) if (payment.partyId === party.id) balance -= payment.amount;
      balance = roundMoney(Math.max(0, balance));
      if (Math.abs(balance - party.currentBalance) >= 0.01) {
        await db.parties.update(party.id, { currentBalance: balance, updatedAt: stamp, isSynced: false });
      }
    }
  });
}

export async function pendingCount() {
  const breakdown = await pendingBreakdown();
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
}

export interface PendingBreakdown {
  parties: number;
  items: number;
  prices: number;
  invoices: number;
  payments: number;
  dues: number;
  expenses: number;
}

export async function pendingBreakdown(): Promise<PendingBreakdown> {
  const [parties, items, prices, invoices, payments, dues, expenses] =
    await Promise.all([
      db.parties.filter((x) => !x.isSynced).count(),
      db.items.filter((x) => !x.isSynced).count(),
      db.partyItemPrices.filter((x) => !x.isSynced).count(),
      db.invoices.filter((x) => !x.isSynced).count(),
      db.payments.filter((x) => !x.isSynced).count(),
      db.accountEntries.filter((x) => !x.isSynced).count(),
      db.expenses.filter((x) => !x.isSynced).count(),
    ]);
  return { parties, items, prices, invoices, payments, dues, expenses };
}

export interface SyncDiagnostics {
  pending: PendingBreakdown;
  totalPending: number;
  lastSuccess?: string;
  lastAttempt?: string;
  lastError?: string;
  conflictCount: number;
}

export async function syncDiagnostics(): Promise<SyncDiagnostics> {
  const [pending, success, attempt, error, conflicts] = await Promise.all([
    pendingBreakdown(),
    db.meta.get("last-cloud-sync"),
    db.meta.get("last-cloud-sync-attempt"),
    db.meta.get("last-cloud-sync-error"),
    db.meta.get("sync-conflicts-v1"),
  ]);
  let conflictCount = 0;
  try { conflictCount = conflicts?.value ? (JSON.parse(String(conflicts.value)) as unknown[]).length : 0; } catch {}
  return {
    pending,
    totalPending: Object.values(pending).reduce((sum, value) => sum + value, 0),
    lastSuccess: success?.value ? String(success.value) : undefined,
    lastAttempt: attempt?.value ? String(attempt.value) : undefined,
    lastError: error?.value ? String(error.value) : undefined,
    conflictCount,
  };
}

function syncErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Cloud backup failed");
  return message.replace(/(eyJ[a-zA-Z0-9._-]{20,}|sync[_ -]?code\s*[:=]\s*\S+)/gi, "[redacted]").slice(0, 240);
}

let syncInFlight: Promise<SyncState> | null = null;

async function performSyncWithClient(
  supabase: SupabaseClient,
  onState?: (state: SyncState) => void,
): Promise<SyncState> {
  onState?.("syncing");
  try {
    await db.meta.put({ key: "last-cloud-sync-attempt", value: new Date().toISOString() });
    await ensureSession(supabase);
    // Pull first so a stale offline edit cannot silently overwrite a newer
    // remote row. Locally newer unsynced rows are preserved by pullRemote.
    await pullRemote(supabase);
    await reconcilePartyBalances();
    const [
      parties,
      items,
      prices,
      invoices,
      payments,
      accountEntries,
      expenses,
    ] = await Promise.all([
      db.parties.filter((x) => !x.isSynced).toArray(),
      db.items.filter((x) => !x.isSynced).toArray(),
      db.partyItemPrices.filter((x) => !x.isSynced).toArray(),
      db.invoices.filter((x) => !x.isSynced).toArray(),
      db.payments.filter((x) => !x.isSynced).toArray(),
      db.accountEntries.filter((x) => !x.isSynced).toArray(),
      db.expenses.filter((x) => !x.isSynced).toArray(),
    ]);
    await pushTable(supabase, "parties", parties, partyToRow);
    await pushTable(supabase, "items", items, itemToRow);
    await pushTable(supabase, "party_item_prices", prices, priceToRow);
    await pushTable(supabase, "invoices", invoices, invoiceToRow);
    await pushTable(supabase, "payments", payments, paymentToRow);
    await pushTable(
      supabase,
      "account_entries",
      accountEntries,
      accountEntryToRow,
    );
    await pushTable(supabase, "expenses", expenses, expenseToRow);
    await db.transaction(
      "rw",
      [
        db.parties,
        db.items,
        db.partyItemPrices,
        db.invoices,
        db.payments,
        db.accountEntries,
        db.expenses,
      ],
      async () => {
        await Promise.all(
          parties.map(async (x) => {
            const current = await db.parties.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.parties.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          items.map(async (x) => {
            const current = await db.items.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.items.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          prices.map(async (x) => {
            const current = await db.partyItemPrices.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.partyItemPrices.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          invoices.map(async (x) => {
            const current = await db.invoices.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.invoices.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          payments.map(async (x) => {
            const current = await db.payments.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.payments.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          accountEntries.map(async (x) => {
            const current = await db.accountEntries.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.accountEntries.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          expenses.map(async (x) => {
            const current = await db.expenses.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.expenses.update(x.id, { isSynced: true });
          }),
        );
      },
    );
    await db.meta.put({
      key: "last-cloud-sync",
      value: new Date().toISOString(),
    });
    await db.meta.delete("last-cloud-sync-error");
    const state: SyncState = (await pendingCount()) ? "pending" : "synced";
    onState?.(state);
    return state;
  } catch (error) {
    console.warn("Cloud sync deferred", error);
    await db.meta.put({ key: "last-cloud-sync-error", value: syncErrorMessage(error) });
    onState?.("pending");
    return "pending";
  }
}

export async function syncWithClient(
  supabase: SupabaseClient,
  onState?: (state: SyncState) => void,
): Promise<SyncState> {
  if (syncInFlight) {
    onState?.("syncing");
    const state = await syncInFlight;
    onState?.(state);
    return state;
  }
  syncInFlight = performSyncWithClient(supabase, onState);
  try { return await syncInFlight; }
  finally { syncInFlight = null; }
}

export async function syncNow(
  onState?: (state: SyncState) => void,
): Promise<SyncState> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    onState?.("offline");
    return "offline";
  }
  const supabase = supabaseClient();
  if (!supabase) {
    onState?.("offline");
    return "offline";
  }
  return syncWithClient(supabase, onState);
}

export function startRealtimeSync(onState?: (state: SyncState) => void) {
  const supabase = supabaseClient();
  if (!supabase) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = supabase
    .channel("mantu-billing-live-sync")
    .on("postgres_changes", { event: "*", schema: "public" }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => syncNow(onState), 400);
    })
    .subscribe();
  return () => {
    clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}
