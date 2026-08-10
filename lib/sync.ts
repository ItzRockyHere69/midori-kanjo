import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  db,
  type AccountEntry,
  type Category,
  type CountLine,
  type CountSession,
  type Expense,
  type Invoice,
  type Item,
  type Party,
  type PartyItemPrice,
  type Payment,
  type StockMovement,
} from "./db";
import { paymentChannels, roundMoney } from "./billing";
import { reconcileInventoryStock } from "./inventory";
import { sha256Hex } from "./qol";
import { normalizeMergedFestivalTags } from "./festivals";

export type SyncState = "synced" | "pending" | "offline" | "syncing";
export interface CloudConfig {
  url: string;
  key: string;
  syncCode: string;
}

const CLOUD_CONFIG_KEY = "mantu-supabase-config-v1";
const CLOUD_DISABLED_KEY = "mantu-supabase-disabled-v1";
const CLOUD_BUSINESS_META = "cloud-business-fingerprint-v1";
let cloudDisabledForSession = false;

const emptyCloudConfig = (): CloudConfig => ({ url: "", key: "", syncCode: "" });

function storageValue(key: string) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    // Cloud backup is optional. Restricted/private WebViews must still be able
    // to open the offline database when DOM storage is unavailable.
    return null;
  }
}

function restoreStorageKey(
  key: string,
  previousValue: string | null,
  absentFallback: string,
) {
  try {
    if (previousValue == null) localStorage.removeItem(key);
    else localStorage.setItem(key, previousValue);
    return true;
  } catch {
    if (previousValue != null) return false;
    try {
      // Some restricted WebViews allow writes but reject removals. A neutral
      // value preserves the same effective state as an absent key.
      localStorage.setItem(key, absentFallback);
      return true;
    } catch {
      return false;
    }
  }
}

function restoreCloudStorage(
  previousStored: string | null,
  previousDisabled: string | null,
) {
  const configRestored = restoreStorageKey(
    CLOUD_CONFIG_KEY,
    previousStored,
    "null",
  );
  const disabledRestored = restoreStorageKey(
    CLOUD_DISABLED_KEY,
    previousDisabled,
    "false",
  );
  return configRestored && disabledRestored;
}

function environment() {
  const node = typeof process !== "undefined" ? process.env : undefined;
  return {
    // Keep these as direct property reads. Vite can then substitute only the
    // two explicitly public values instead of materializing the full VITE_
    // environment object into the downloadable client bundle.
    url:
      (import.meta as ImportMeta & {
        env?: { VITE_SUPABASE_URL?: string };
      }).env?.VITE_SUPABASE_URL || node?.NEXT_PUBLIC_SUPABASE_URL || "",
    key:
      (import.meta as ImportMeta & {
        env?: { VITE_SUPABASE_ANON_KEY?: string };
      }).env?.VITE_SUPABASE_ANON_KEY ||
      node?.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
    // Never read a tenant credential from client-public build variables. Vite
    // and NEXT_PUBLIC values are embedded in downloadable JavaScript.
    syncCode: "",
  };
}

export function generateBusinessSyncCode() {
  if (typeof crypto === "undefined" || !crypto.getRandomValues)
    throw new Error(
      "Secure random generation is unavailable. Update this browser before creating a cloud sync code.",
    );
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storedCloudConfig(): CloudConfig | null {
  try {
    const value = JSON.parse(
      storageValue(CLOUD_CONFIG_KEY) || "null",
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
  if (cloudDisabledForSession) return emptyCloudConfig();
  if (storageValue(CLOUD_DISABLED_KEY) === "true")
    return emptyCloudConfig();
  return storedCloudConfig() || environment();
}

let client: SupabaseClient | null = null;
let clientSignature = "";
let syncInFlight: Promise<SyncState> | null = null;

async function disposeSupabaseClient(current: SupabaseClient | null) {
  if (!current) return;
  try {
    await current.removeAllChannels();
  } catch {}
  try {
    await current.auth.stopAutoRefresh();
  } catch {}
  try {
    await current.auth.signOut({ scope: "local" });
  } catch {}
}

function validateCloudConfig(config: CloudConfig): CloudConfig {
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
  if (parsed.protocol !== "https:")
    throw new Error("Supabase sync requires an HTTPS project URL.");
  return { url, key, syncCode };
}

async function cloudBusinessFingerprint(url: string, syncCode: string) {
  return `sha256:${sha256Hex(`${url}\n${syncCode}`)}`;
}

async function hasBusinessData() {
  const counts = await Promise.all([
    db.parties.count(),
    db.items.count(),
    db.partyItemPrices.count(),
    db.invoices.count(),
    db.payments.count(),
    db.accountEntries.count(),
    db.expenses.count(),
    db.categories.count(),
    db.stockMovements.count(),
    db.countSessions.count(),
    db.countLines.count(),
  ]);
  return counts.some(Boolean);
}

async function bindActiveCloudBusiness(config: CloudConfig) {
  const validated = validateCloudConfig(config);
  const desiredFingerprint = await cloudBusinessFingerprint(
    validated.url,
    validated.syncCode,
  );
  const boundFingerprint = String(
    (await db.meta.get(CLOUD_BUSINESS_META))?.value || "",
  );
  if (
    boundFingerprint &&
    boundFingerprint !== desiredFingerprint &&
    (await hasBusinessData())
  ) {
    throw new Error(
      "This device already contains data for another cloud business. Export or clear that local business before changing the project or sync code.",
    );
  }
  if (boundFingerprint !== desiredFingerprint)
    await db.meta.put({
      key: CLOUD_BUSINESS_META,
      value: desiredFingerprint,
    });
}

export async function configureCloud(config: CloudConfig) {
  // A completed request cannot be cancelled reliably by disposing the client.
  // Finish any authorized pull/push first, then re-check the now-current local
  // data and tenant binding before permitting a switch.
  if (syncInFlight) await syncInFlight;
  const saved = validateCloudConfig(config);
  if (typeof localStorage === "undefined")
    throw new Error("Cloud settings are unavailable in this environment.");
  const desiredFingerprint = await cloudBusinessFingerprint(
    saved.url,
    saved.syncCode,
  );
  const boundFingerprint = String(
    (await db.meta.get(CLOUD_BUSINESS_META))?.value || "",
  );
  const previous = getCloudConfig();
  const previousFingerprint =
    previous.url && previous.syncCode
      ? await cloudBusinessFingerprint(
          previous.url.trim().replace(/\/$/, ""),
          previous.syncCode.trim(),
        )
      : "";
  const isSwitch =
    (boundFingerprint && boundFingerprint !== desiredFingerprint) ||
    (!boundFingerprint &&
      previousFingerprint &&
      previousFingerprint !== desiredFingerprint);
  if (isSwitch && (await hasBusinessData())) {
    throw new Error(
      "This device already contains data for another cloud business. Export or clear that local business before changing the project or sync code.",
    );
  }
  let previousStored: string | null;
  let previousDisabled: string | null;
  const previousSessionDisabled = cloudDisabledForSession;
  try {
    previousStored = localStorage.getItem(CLOUD_CONFIG_KEY);
    previousDisabled = localStorage.getItem(CLOUD_DISABLED_KEY);
  } catch {
    throw new Error("Cloud settings could not be saved on this device.");
  }
  let configWriteSucceeded = false;
  const rollBackStorage = () => {
    const restored = restoreCloudStorage(previousStored, previousDisabled);
    cloudDisabledForSession =
      restored || !configWriteSucceeded ? previousSessionDisabled : true;
  };
  try {
    // Persist the validated credentials before changing the database binding.
    // Every later failure restores both storage keys so the two sources cannot
    // point at different businesses.
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(saved));
    configWriteSucceeded = true;
    localStorage.removeItem(CLOUD_DISABLED_KEY);
  } catch {
    rollBackStorage();
    throw new Error("Cloud settings could not be saved on this device.");
  }
  try {
    await db.meta.put({ key: CLOUD_BUSINESS_META, value: desiredFingerprint });
  } catch (error) {
    rollBackStorage();
    throw error;
  }
  cloudDisabledForSession = false;
  const previousClient = client;
  client = null;
  clientSignature = "";
  await disposeSupabaseClient(previousClient);
  return saved;
}

export async function clearCloudConfig() {
  if (syncInFlight) await syncInFlight;
  // Capture an environment-managed tenant before the disabled tombstone hides
  // it. Otherwise disconnecting and then entering a different manual code can
  // mix the existing offline database into another business.
  try {
    await bindActiveCloudBusiness(getCloudConfig());
  } catch {
    // Invalid/partial environment settings should not block local disconnect.
  }
  let tombstoneSaved = false;
  let configRemoved = false;
  if (typeof localStorage !== "undefined") {
    try {
      // Write the tombstone first so an environment or a failed remove cannot
      // silently re-enable cloud access after the client is torn down.
      localStorage.setItem(CLOUD_DISABLED_KEY, "true");
      tombstoneSaved = true;
    } catch {}
    try {
      localStorage.removeItem(CLOUD_CONFIG_KEY);
      configRemoved = true;
    } catch {}
  }
  const disconnectPersisted = tombstoneSaved || configRemoved;
  cloudDisabledForSession = !disconnectPersisted;
  const current = client;
  client = null;
  clientSignature = "";
  await disposeSupabaseClient(current);
  if (!disconnectPersisted)
    throw new Error("Cloud was stopped for this session, but this device could not remember the disconnect setting.");
}

export function supabaseClient() {
  let config: CloudConfig;
  try {
    config = validateCloudConfig(getCloudConfig());
  } catch {
    return null;
  }
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
  code_name: x.codeName || "",
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
const categoryToRow = (x: Category) => ({
  id: x.id,
  name: x.name,
  parent_id: x.parentId || null,
  festival_season: x.festivalSeason,
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
  // Cloud schema is NOT NULL. Legacy quotations predate the local snapshot
  // field and represent no receipt, so their compatible value is zero.
  initial_amount_paid: x.initialAmountPaid ?? 0,
  amount_paid: x.amountPaid,
  amount_due: x.amountDue,
  payment_mode: x.paymentMode,
  payment_received_mode: x.paymentReceivedMode || null,
  payment_breakdown: x.paymentBreakdown || [],
  return_details: x.returnDetails || {},
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
  allocated_to: x.allocatedTo || [],
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
const countSessionToRow = (x: CountSession) => ({
  id: x.id,
  category_id: x.categoryId,
  category_name: x.categoryName,
  status: x.status,
  item_ids: x.itemIds,
  started_at: x.startedAt,
  completed_at: x.completedAt || null,
  updated_at: x.updatedAt,
});
const countLineToRow = (x: CountLine) => ({
  id: x.id,
  session_id: x.sessionId,
  item_id: x.itemId,
  item_name: x.itemName,
  sku_code: x.skuCode,
  base_unit: x.baseUnit,
  system_stock_at_start: x.systemStockAtStart,
  counted_stock: x.countedStock,
  counted_at: x.countedAt || null,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const stockMovementToRow = (x: StockMovement) => ({
  id: x.id,
  item_id: x.itemId,
  kind: x.kind,
  reason: x.reason,
  note: x.note,
  qty_change: x.qtyChange,
  stock_before: x.stockBefore,
  stock_after: x.stockAfter,
  applied: x.applied,
  entry_qty: x.entryQty ?? null,
  entry_unit: x.entryUnit || null,
  pack_count: x.packCount ?? null,
  units_per_pack: x.unitsPerPack ?? null,
  contained_unit: x.containedUnit || null,
  ref_invoice_id: x.refInvoiceId || null,
  source_invoice_id: x.sourceInvoiceId || null,
  count_session_id: x.countSessionId || null,
  party_id: x.partyId || null,
  supplier_reference: x.supplierReference || null,
  date: x.date,
  actor: x.actor,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
});
const sameStockMovement = (left: StockMovement, right: StockMovement) => {
  const normalize = (movement: StockMovement) => ({
    ...stockMovementToRow(movement),
    created_at: Number.isNaN(Date.parse(movement.createdAt)) ? movement.createdAt : new Date(movement.createdAt).toISOString(),
    updated_at: Number.isNaN(Date.parse(movement.updatedAt)) ? movement.updatedAt : new Date(movement.updatedAt).toISOString(),
  });
  const leftRow = normalize(left);
  const rightRow = normalize(right);
  if (left.kind === "baseline" && right.kind === "baseline") {
    const withoutReplicaClock = (row: ReturnType<typeof normalize>) => {
      const stable: Record<string, unknown> = { ...row };
      delete stable.date;
      delete stable.created_at;
      delete stable.updated_at;
      return stable;
    };
    return JSON.stringify(withoutReplicaClock(leftRow)) === JSON.stringify(withoutReplicaClock(rightRow));
  }
  return JSON.stringify(leftRow) === JSON.stringify(rightRow);
};

async function ensureSession(
  supabase: SupabaseClient,
  configuredSyncCode = "",
) {
  const { data } = await supabase.auth.getSession();
  const sessionCode = String(data.session?.user.user_metadata?.sync_code || "");
  const syncCode = configuredSyncCode || sessionCode;
  if (!syncCode) throw new Error("A business sync code is required.");
  if (sessionCode === syncCode) return syncCode;
  if (data.session) await supabase.auth.signOut();
  const result = await supabase.auth.signInAnonymously({
    options: { data: { sync_code: syncCode } },
  });
  if (result.error) throw result.error;
  return syncCode;
}

async function pushTable<T extends { id: string }>(
  supabase: SupabaseClient,
  table: string,
  local: T[],
  mapper: (row: T) => Record<string, unknown>,
  businessId: string,
) {
  if (!local.length) return;
  const rows = local.map((row) => ({
    ...mapper(row),
    id: row.id,
    business_id: businessId,
  }));
  const batches: Array<Array<Record<string, unknown>>> = [];
  let batch: Array<Record<string, unknown>> = [];
  let batchBytes = 2;
  const maxBatchRows = 100;
  const maxBatchBytes = 900_000;
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (rowBytes > maxBatchBytes) {
      throw new Error(
        `${table} record ${String(row.id || "unknown")} is too large for cloud sync. Reduce or remove its product image, then retry.`,
      );
    }
    if (
      batch.length &&
      (batch.length >= maxBatchRows || batchBytes + rowBytes > maxBatchBytes)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 2;
    }
    batch.push(row);
    batchBytes += rowBytes;
  }
  if (batch.length) batches.push(batch);
  for (const rowsToPush of batches) {
    const { error } = await supabase
      .from(table)
      .upsert(rowsToPush, { onConflict: "business_id,id" });
    if (error) throw error;
  }
}

type RemoteRow = Record<string, unknown>;
const text = (value: unknown) => (value == null ? "" : String(value));
const number = (value: unknown) => Number(value || 0);
const nullableNumber = (value: unknown) =>
  value == null || value === "" ? null : Number(value);
const list = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];
const invoicePaymentBreakdown = (value: unknown): NonNullable<Invoice["paymentBreakdown"]> =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        const mode = text(row.mode);
        const amount = number(row.amount);
        if (!paymentChannels.some((channel) => channel === mode) || !Number.isFinite(amount) || amount <= 0) return [];
        const reference = text(row.reference).trim();
        return [{
          mode: mode as NonNullable<Invoice["paymentReceivedMode"]>,
          amount: roundMoney(amount),
          ...(reference ? { reference } : {}),
        }];
      })
    : [];
const invoiceReturnDetails = (value: unknown): Invoice["returnDetails"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const sourceInvoiceId = text(row.sourceInvoiceId || row.source_invoice_id).trim();
  const allocations = Array.isArray(row.allocations)
    ? row.allocations.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const allocation = entry as Record<string, unknown>;
        const invoiceId = text(allocation.invoiceId || allocation.invoice_id).trim();
        const amount = roundMoney(number(allocation.amount));
        return invoiceId && amount > 0 ? [{ invoiceId, amount }] : [];
      })
    : [];
  const balanceApplied = roundMoney(Math.max(0, number(row.balanceApplied ?? row.balance_applied)));
  const settlementAmount = roundMoney(Math.max(0, number(row.settlementAmount ?? row.settlement_amount)));
  if (!sourceInvoiceId && !allocations.length && balanceApplied === 0 && settlementAmount === 0) return undefined;
  return {
    ...(sourceInvoiceId ? { sourceInvoiceId } : {}),
    allocations,
    balanceApplied,
    settlementAmount,
  };
};

async function selectAll(supabase: SupabaseClient, table: string) {
  const rows: RemoteRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const unordered = supabase.from(table).select("*");
    const order = (
      unordered as unknown as {
        order?: (
          column: string,
          options: { ascending: boolean },
        ) => typeof unordered;
      }
    ).order;
    const selection = order
      ? order.call(unordered, "id", { ascending: true })
      : unordered;
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
    categoriesResult,
    partiesResult,
    itemsResult,
    pricesResult,
    invoicesResult,
    paymentsResult,
    accountEntriesResult,
    expensesResult,
    countSessionsResult,
    countLinesResult,
    stockMovementsResult,
  ] = await Promise.all([
    selectAll(supabase, "categories"),
    selectAll(supabase, "parties"),
    selectAll(supabase, "items"),
    selectAll(supabase, "party_item_prices"),
    selectAll(supabase, "invoices"),
    selectAll(supabase, "payments"),
    selectAll(supabase, "account_entries"),
    selectAll(supabase, "expenses"),
    selectAll(supabase, "count_sessions"),
    selectAll(supabase, "count_session_lines"),
    selectAll(supabase, "stock_movements"),
  ]);
  const categories = categoriesResult.map(
    (r): Category => ({
      id: text(r.id),
      name: text(r.name),
      parentId: text(r.parent_id) || undefined,
      festivalSeason: list(r.festival_season),
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const parties = partiesResult.map(
    (r): Party => ({
      id: text(r.id),
      name: text(r.name),
      codeName: text(r.code_name),
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
      initialAmountPaid:
        r.initial_amount_paid == null
          ? undefined
          : number(r.initial_amount_paid),
      amountPaid: number(r.amount_paid),
      amountDue: number(r.amount_due),
      paymentMode: r.payment_mode as Invoice["paymentMode"],
      paymentReceivedMode: paymentChannels.some(
        (mode) => mode === text(r.payment_received_mode),
      )
        ? (text(r.payment_received_mode) as Invoice["paymentReceivedMode"])
        : undefined,
      paymentBreakdown: invoicePaymentBreakdown(r.payment_breakdown),
      returnDetails: invoiceReturnDetails(r.return_details),
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
      allocatedTo: Array.isArray(r.allocated_to)
        ? (r.allocated_to as Payment["allocatedTo"])
        : [],
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
  const countSessions = countSessionsResult.map(
    (r): CountSession => ({
      id: text(r.id),
      categoryId: text(r.category_id),
      categoryName: text(r.category_name),
      status: r.status === "completed" ? "completed" : "in_progress",
      itemIds: list(r.item_ids),
      startedAt: text(r.started_at),
      completedAt: text(r.completed_at) || undefined,
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const countLines = countLinesResult.map(
    (r): CountLine => ({
      id: text(r.id),
      sessionId: text(r.session_id),
      itemId: text(r.item_id),
      itemName: text(r.item_name),
      skuCode: text(r.sku_code),
      baseUnit: r.base_unit as CountLine["baseUnit"],
      systemStockAtStart: nullableNumber(r.system_stock_at_start),
      countedStock: nullableNumber(r.counted_stock),
      countedAt: text(r.counted_at) || undefined,
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const stockMovements = stockMovementsResult.map(
    (r): StockMovement => ({
      id: text(r.id),
      itemId: text(r.item_id),
      kind: r.kind as StockMovement["kind"],
      reason: text(r.reason),
      note: text(r.note),
      qtyChange: nullableNumber(r.qty_change),
      stockBefore: nullableNumber(r.stock_before),
      stockAfter: nullableNumber(r.stock_after),
      applied: Boolean(r.applied),
      ...(nullableNumber(r.entry_qty) === null ? {} : { entryQty: nullableNumber(r.entry_qty)! }),
      ...(text(r.entry_unit) ? { entryUnit: r.entry_unit as StockMovement["entryUnit"] } : {}),
      ...(nullableNumber(r.pack_count) === null ? {} : { packCount: nullableNumber(r.pack_count)! }),
      ...(nullableNumber(r.units_per_pack) === null ? {} : { unitsPerPack: nullableNumber(r.units_per_pack)! }),
      ...(text(r.contained_unit) ? { containedUnit: r.contained_unit as StockMovement["containedUnit"] } : {}),
      ...(text(r.ref_invoice_id) ? { refInvoiceId: text(r.ref_invoice_id) } : {}),
      ...(text(r.source_invoice_id) ? { sourceInvoiceId: text(r.source_invoice_id) } : {}),
      ...(text(r.count_session_id) ? { countSessionId: text(r.count_session_id) } : {}),
      ...(text(r.party_id) ? { partyId: text(r.party_id) } : {}),
      ...(text(r.supplier_reference) ? { supplierReference: text(r.supplier_reference) } : {}),
      date: text(r.date),
      actor: r.actor === "owner" ? "owner" : "staff",
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      isSynced: true,
    }),
  );
  const conflicts: Array<{ table: string; id: string; localUpdatedAt: string; remoteUpdatedAt: string; detectedAt: string }> = [];
  await db.transaction(
    "rw",
    [
      db.categories,
      db.parties,
      db.items,
      db.partyItemPrices,
      db.invoices,
      db.payments,
      db.accountEntries,
      db.expenses,
      db.countSessions,
      db.countLines,
      db.stockMovements,
    ],
    async () => {
      const [
        localCategories,
        localParties,
        localItems,
        localPrices,
        localInvoices,
        localPayments,
        localAccountEntries,
        localExpenses,
        localCountSessions,
        localCountLines,
        localStockMovements,
      ] = await Promise.all([
        db.categories.bulkGet(categories.map((x) => x.id)),
        db.parties.bulkGet(parties.map((x) => x.id)),
        db.items.bulkGet(items.map((x) => x.id)),
        db.partyItemPrices.bulkGet(prices.map((x) => x.id)),
        db.invoices.bulkGet(invoices.map((x) => x.id)),
        db.payments.bulkGet(payments.map((x) => x.id)),
        db.accountEntries.bulkGet(accountEntries.map((x) => x.id)),
        db.expenses.bulkGet(expenses.map((x) => x.id)),
        db.countSessions.bulkGet(countSessions.map((x) => x.id)),
        db.countLines.bulkGet(countLines.map((x) => x.id)),
        db.stockMovements.bulkGet(stockMovements.map((x) => x.id)),
      ]);
      const collectConflicts = <T extends { id: string; updatedAt: string; isSynced: boolean }>(table: string, remote: T[], local: Array<T | undefined>) => {
        remote.forEach((row, index) => {
          const stored = local[index];
          if (stored && !stored.isSynced && row.updatedAt > stored.updatedAt) conflicts.push({ table, id: row.id, localUpdatedAt: stored.updatedAt, remoteUpdatedAt: row.updatedAt, detectedAt: new Date().toISOString() });
        });
      };
      collectConflicts("categories", categories, localCategories);
      collectConflicts("parties", parties, localParties);
      collectConflicts("items", items, localItems);
      collectConflicts("party_item_prices", prices, localPrices);
      collectConflicts("invoices", invoices, localInvoices);
      collectConflicts("payments", payments, localPayments);
      collectConflicts("account_entries", accountEntries, localAccountEntries);
      collectConflicts("expenses", expenses, localExpenses);
      collectConflicts("count_sessions", countSessions, localCountSessions);
      collectConflicts("count_session_lines", countLines, localCountLines);
      stockMovements.forEach((remote, index) => {
        const stored = localStockMovements[index];
        if (
          stored &&
          !stored.isSynced &&
          !sameStockMovement(stored, remote)
        ) {
          conflicts.push({
            table: "stock_movements",
            id: remote.id,
            localUpdatedAt: stored.updatedAt,
            remoteUpdatedAt: remote.updatedAt,
            detectedAt: new Date().toISOString(),
          });
        }
      });
      await db.categories.bulkPut(
        categories.filter(
          (remote, index) =>
            !localCategories[index] ||
            localCategories[index]!.isSynced ||
            remote.updatedAt >= localCategories[index]!.updatedAt,
        ),
      );
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
      await db.countSessions.bulkPut(
        countSessions.filter(
          (remote, index) =>
            !localCountSessions[index] ||
            localCountSessions[index]!.isSynced ||
            remote.updatedAt >= localCountSessions[index]!.updatedAt,
        ),
      );
      await db.countLines.bulkPut(
        countLines.filter(
          (remote, index) =>
            !localCountLines[index] ||
            localCountLines[index]!.isSynced ||
            remote.updatedAt >= localCountLines[index]!.updatedAt,
        ),
      );
      await db.stockMovements.bulkPut(
        stockMovements.filter((remote, index) => {
          const stored = localStockMovements[index];
          return !stored || stored.isSynced || sameStockMovement(stored, remote);
        }),
      );
    },
  );
  if (conflicts.length) {
    let previous: unknown[] = [];
    try { previous = JSON.parse(String((await db.meta.get("sync-conflicts-v1"))?.value || "[]")) as unknown[]; } catch {}
    await db.meta.put({ key: "sync-conflicts-v1", value: JSON.stringify([...previous, ...conflicts].slice(-100)) });
  }
  if (conflicts.some((conflict) => conflict.table === "stock_movements")) {
    throw new Error("A stock audit record conflicts with the cloud copy. No inventory rows were uploaded; review Sync Center before retrying.");
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
    for (const payment of payments)
      for (const allocation of payment.allocatedTo || []) {
        const amount = roundMoney(Number(allocation.amount || 0));
        if (!allocation.invoiceId || amount <= 0) continue;
        allocatedByInvoice.set(
          allocation.invoiceId,
          roundMoney(
            (allocatedByInvoice.get(allocation.invoiceId) || 0) + amount,
          ),
        );
      }
    const returnCreditsByInvoice = new Map<string, number>();
    for (const invoice of invoices) {
      if (
        invoice.deletedAt ||
        (invoice.type !== "sale_return" && invoice.type !== "purchase_return")
      ) continue;
      for (const allocation of invoice.returnDetails?.allocations || []) {
        const amount = roundMoney(Number(allocation.amount || 0));
        if (!allocation.invoiceId || amount <= 0) continue;
        returnCreditsByInvoice.set(
          allocation.invoiceId,
          roundMoney((returnCreditsByInvoice.get(allocation.invoiceId) || 0) + amount),
        );
      }
    }
    const stamp = new Date().toISOString();
    const canonicalInvoices = new Map<string, Invoice>();
    for (const invoice of invoices) {
      if (invoice.type === "quotation") {
        const canonical = {
          ...invoice,
          initialAmountPaid: 0,
          amountPaid: 0,
          amountDue: invoice.grandTotal,
        };
        canonicalInvoices.set(invoice.id, canonical);
        if (
          invoice.initialAmountPaid == null ||
          invoice.amountPaid !== 0 ||
          invoice.amountDue !== invoice.grandTotal
        )
          await db.invoices.update(invoice.id, {
            initialAmountPaid: 0,
            amountPaid: 0,
            amountDue: invoice.grandTotal,
            updatedAt: stamp,
            isSynced: false,
          });
        continue;
      }
      if (invoice.type === "sale_return" || invoice.type === "purchase_return") {
        if (invoice.deletedAt) {
          canonicalInvoices.set(invoice.id, invoice);
          continue;
        }
        const settlementAmount = Math.min(
          invoice.grandTotal,
          Math.max(
            0,
            roundMoney(
              invoice.returnDetails?.settlementAmount ??
              invoice.initialAmountPaid ??
              invoice.amountPaid,
            ),
          ),
        );
        const canonical = {
          ...invoice,
          initialAmountPaid: settlementAmount,
          amountPaid: settlementAmount,
          amountDue: 0,
        };
        canonicalInvoices.set(invoice.id, canonical);
        if (
          invoice.initialAmountPaid == null ||
          Math.abs(invoice.amountPaid - settlementAmount) >= 0.01 ||
          Math.abs(invoice.amountDue) >= 0.01
        ) {
          await db.invoices.update(invoice.id, {
            initialAmountPaid: settlementAmount,
            amountPaid: settlementAmount,
            amountDue: 0,
            updatedAt: stamp,
            isSynced: false,
          });
        }
        continue;
      }
      const laterPaid = allocatedByInvoice.get(invoice.id) || 0;
      const inferredInitial = Math.max(
        0,
        roundMoney(invoice.amountPaid - laterPaid),
      );
      const initialAmountPaid = Math.min(
        invoice.grandTotal,
        Math.max(
          0,
          roundMoney(invoice.initialAmountPaid ?? inferredInitial),
        ),
      );
      // Older app versions allowed a paid invoice to be deleted while leaving
      // either its initial receipt or an immutable later payment behind. Restore
      // that audit record instead of losing one side of the ledger.
      const restorePaidInvoice = Boolean(
        invoice.deletedAt && (laterPaid > 0 || initialAmountPaid >= 0.01),
      );
      if (invoice.deletedAt && !restorePaidInvoice) {
        canonicalInvoices.set(invoice.id, invoice);
        continue;
      }
      const amountPaid = Math.min(
        invoice.grandTotal,
        roundMoney(initialAmountPaid + laterPaid),
      );
      const returnCredit = returnCreditsByInvoice.get(invoice.id) || 0;
      const amountDue = Math.max(
        0,
        roundMoney(invoice.grandTotal - amountPaid - returnCredit),
      );
      const canonical = {
        ...invoice,
        ...(restorePaidInvoice ? { deletedAt: undefined } : {}),
        initialAmountPaid,
        amountPaid,
        amountDue,
      };
      canonicalInvoices.set(invoice.id, canonical);
      if (
        restorePaidInvoice ||
        invoice.initialAmountPaid == null ||
        Math.abs(invoice.amountPaid - amountPaid) >= 0.01 ||
        Math.abs(invoice.amountDue - amountDue) >= 0.01
      ) {
        await db.invoices.update(invoice.id, {
          initialAmountPaid,
          amountPaid,
          amountDue,
          ...(restorePaidInvoice ? { deletedAt: undefined } : {}),
          updatedAt: stamp,
          isSynced: false,
        });
      }
    }
    for (const party of parties) {
      let balance = party.openingBalance;
      for (const invoice of canonicalInvoices.values()) {
        if (invoice.partyId !== party.id || invoice.deletedAt || !["sale", "purchase"].includes(invoice.type)) continue;
        const receivedWithBill = Math.max(
          0,
          roundMoney(invoice.initialAmountPaid || 0),
        );
        balance += invoice.grandTotal - receivedWithBill;
      }
      for (const due of dues) if (due.partyId === party.id) balance += due.amount;
      for (const payment of payments) if (payment.partyId === party.id) balance -= payment.amount;
      for (const invoice of canonicalInvoices.values()) {
        if (
          invoice.partyId === party.id &&
          !invoice.deletedAt &&
          (invoice.type === "sale_return" || invoice.type === "purchase_return")
        ) balance -= Math.max(0, roundMoney(invoice.returnDetails?.balanceApplied || 0));
      }
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
  categories: number;
  parties: number;
  items: number;
  prices: number;
  invoices: number;
  payments: number;
  dues: number;
  expenses: number;
  countSessions: number;
  countLines: number;
  stockMovements: number;
}

export async function pendingBreakdown(): Promise<PendingBreakdown> {
  const [categories, parties, items, prices, invoices, payments, dues, expenses, countSessions, countLines, stockMovements] =
    await Promise.all([
      db.categories.filter((x) => !x.isSynced).count(),
      db.parties.filter((x) => !x.isSynced).count(),
      db.items.filter((x) => !x.isSynced).count(),
      db.partyItemPrices.filter((x) => !x.isSynced).count(),
      db.invoices.filter((x) => !x.isSynced).count(),
      db.payments.filter((x) => !x.isSynced).count(),
      db.accountEntries.filter((x) => !x.isSynced).count(),
      db.expenses.filter((x) => !x.isSynced).count(),
      db.countSessions.filter((x) => !x.isSynced).count(),
      db.countLines.filter((x) => !x.isSynced).count(),
      db.stockMovements.filter((x) => !x.isSynced).count(),
    ]);
  return { categories, parties, items, prices, invoices, payments, dues, expenses, countSessions, countLines, stockMovements };
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

async function performSyncWithClient(
  supabase: SupabaseClient,
  onState?: (state: SyncState) => void,
): Promise<SyncState> {
  onState?.("syncing");
  try {
    await db.meta.put({ key: "last-cloud-sync-attempt", value: new Date().toISOString() });
    const activeConfig = getCloudConfig();
    let configuredSyncCode = "";
    if (activeConfig.url || activeConfig.key || activeConfig.syncCode) {
      const validatedConfig = validateCloudConfig(activeConfig);
      await bindActiveCloudBusiness(validatedConfig);
      configuredSyncCode = validatedConfig.syncCode;
    }
    const syncCode = await ensureSession(supabase, configuredSyncCode);
    const businessId = sha256Hex(syncCode);
    // Pull-first resolves the common case before upload. It is not a server-side
    // compare-and-swap: Sync Center still records conflicts for review, and a
    // future schema revision should replace client-clock LWW with server versions.
    await pullRemote(supabase);
    // Older synced databases can still contain festival membership on an
    // inactive merged source. Move it to the editable active product before
    // collecting this sync's upload batch so a cloud-first device is repaired
    // immediately, without waiting for an app restart or a second sync.
    await normalizeMergedFestivalTags();
    await reconcileInventoryStock();
    await reconcilePartyBalances();
    const [
      categories,
      parties,
      items,
      prices,
      invoices,
      payments,
      accountEntries,
      expenses,
      countSessions,
      countLines,
      stockMovements,
    ] = await Promise.all([
      db.categories.filter((x) => !x.isSynced).toArray(),
      db.parties.filter((x) => !x.isSynced).toArray(),
      db.items.filter((x) => !x.isSynced).toArray(),
      db.partyItemPrices.filter((x) => !x.isSynced).toArray(),
      db.invoices.filter((x) => !x.isSynced).toArray(),
      db.payments.filter((x) => !x.isSynced).toArray(),
      db.accountEntries.filter((x) => !x.isSynced).toArray(),
      db.expenses.filter((x) => !x.isSynced).toArray(),
      db.countSessions.filter((x) => !x.isSynced).toArray(),
      db.countLines.filter((x) => !x.isSynced).toArray(),
      db.stockMovements.filter((x) => !x.isSynced).toArray(),
    ]);
    await pushTable(supabase, "categories", categories, categoryToRow, businessId);
    await pushTable(supabase, "parties", parties, partyToRow, businessId);
    await pushTable(supabase, "items", items, itemToRow, businessId);
    await pushTable(supabase, "party_item_prices", prices, priceToRow, businessId);
    await pushTable(supabase, "invoices", invoices, invoiceToRow, businessId);
    await pushTable(supabase, "payments", payments, paymentToRow, businessId);
    await pushTable(
      supabase,
      "account_entries",
      accountEntries,
      accountEntryToRow,
      businessId,
    );
    await pushTable(supabase, "expenses", expenses, expenseToRow, businessId);
    await pushTable(supabase, "count_sessions", countSessions, countSessionToRow, businessId);
    await pushTable(supabase, "count_session_lines", countLines, countLineToRow, businessId);
    await pushTable(supabase, "stock_movements", stockMovements, stockMovementToRow, businessId);
    await db.transaction(
      "rw",
      [
        db.categories,
        db.parties,
        db.items,
        db.partyItemPrices,
        db.invoices,
        db.payments,
        db.accountEntries,
        db.expenses,
        db.countSessions,
        db.countLines,
        db.stockMovements,
      ],
      async () => {
        await Promise.all(
          categories.map(async (x) => {
            const current = await db.categories.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.categories.update(x.id, { isSynced: true });
          }),
        );
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
        await Promise.all(
          countSessions.map(async (x) => {
            const current = await db.countSessions.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.countSessions.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          countLines.map(async (x) => {
            const current = await db.countLines.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.countLines.update(x.id, { isSynced: true });
          }),
        );
        await Promise.all(
          stockMovements.map(async (x) => {
            const current = await db.stockMovements.get(x.id);
            if (current?.updatedAt === x.updatedAt)
              await db.stockMovements.update(x.id, { isSynced: true });
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
