import {
  db,
  isValidLocalDate,
  makeId,
  nowIso,
  type ActivityLog,
  type AccountEntry,
  type AppMeta,
  type Invoice,
  type Party,
  type Payment,
} from "./db";
import { calculateBill, calculateLine, dueCustomerRows, invoiceInitialPaymentBreakdown, roundMoney } from "./billing";
import { INTERFACE_SCALE_CACHE, parseInterfaceScale } from "./interface-scale";
import { shareNativeBlob } from "./native-files";
import { OWNER_PIN_META, sha256Hex } from "./qol";
import { isCloudConfigured } from "./sync";

export const MASTER_BACKUP_FORMAT = "midori-kanjo-master-backup" as const;
export const MASTER_BACKUP_VERSION = 1 as const;
export const MASTER_BACKUP_MARKER = "MKMASTER1";
export const MAX_MASTER_BACKUP_BYTES = 256 * 1024 * 1024;
export const MASTER_DATABASE_NAME = "BurrabazarBillingDB";
const APP_VERSION = "0.1.2+";
const MASTER_SOURCE_META = "master-backup-source-id";
const MASTER_BEGIN = "----- BEGIN MIDORI KANJO MASTER DATA -----";
const MASTER_END = "----- END MIDORI KANJO MASTER DATA -----";

export const MASTER_STORE_NAMES = [
  "categories",
  "parties",
  "items",
  "partyItemPrices",
  "invoices",
  "payments",
  "accountEntries",
  "expenses",
  "stockMovements",
  "countSessions",
  "countLines",
  "festivalEntries",
  "festivalTasks",
  "activityLogs",
  "dailyCloses",
  "meta",
] as const;

export type MasterStoreName = (typeof MASTER_STORE_NAMES)[number];

const PRIMARY_KEYS: Record<MasterStoreName, string> = {
  categories: "id",
  parties: "id",
  items: "id",
  partyItemPrices: "id",
  invoices: "id",
  payments: "id",
  accountEntries: "id",
  expenses: "id",
  stockMovements: "id",
  countSessions: "id",
  countLines: "id",
  festivalEntries: "id",
  festivalTasks: "id",
  activityLogs: "id",
  dailyCloses: "id",
  meta: "key",
};

const SYNCED_STORES = new Set<MasterStoreName>([
  "categories",
  "parties",
  "items",
  "partyItemPrices",
  "invoices",
  "payments",
  "accountEntries",
  "expenses",
  "stockMovements",
  "countSessions",
  "countLines",
]);

/**
 * Only portable business preferences belong in a master file. Owner PIN
 * verifiers, cloud identity, device identity and transient diagnostics are
 * intentionally excluded so sharing a backup cannot copy access credentials
 * or attach a restored database to the wrong cloud tenant/device.
 */
const PORTABLE_META_KEYS = new Set([
  "language",
  "invoice-format",
  "business-settings",
  "bill-gst-enabled",
  "bill-gst-rate",
  "interface-scale-v1",
  "workspace-preferences-v1",
  "printer-profiles-v1",
  "message-templates-v1",
  "favourite-items-v1",
  "bill-draft-v1",
  "invoice-counter",
  "quotation-counter",
  "dues-backup-source-id",
  MASTER_SOURCE_META,
  "seeded-v1",
  "seeded-v2",
  "seeded-v3",
]);

const isPortableMetaKey = (key: string) =>
  PORTABLE_META_KEYS.has(key) || key.startsWith("dues-ledger-import:");

export type MasterDeviceSettings = {
  theme: "light" | "dark";
  interfaceScale: 100 | 110 | 120 | 130;
};

export type MasterBackupSummary = {
  customers: number;
  suppliers: number;
  settledCustomers: number;
  products: number;
  invoices: number;
  payments: number;
  expenses: number;
  stockMovements: number;
  totalRecords: number;
};

export type MasterBackupPayload = {
  format: typeof MASTER_BACKUP_FORMAT;
  version: typeof MASTER_BACKUP_VERSION;
  appVersion: string;
  exportedAt: string;
  backupId: string;
  currency: "INR";
  database: { name: typeof MASTER_DATABASE_NAME; version: number };
  source: { datasetId: string; businessName: string; businessAddress: string };
  policy: {
    restoreMode: "replace";
    cloudCredentialsIncluded: false;
    ownerPinIncluded: false;
  };
  excluded: string[];
  deviceSettings: MasterDeviceSettings;
  storeCounts: Record<MasterStoreName, number>;
  summary: MasterBackupSummary;
  stores: Record<MasterStoreName, Record<string, unknown>[]>;
};

export type MasterBackupEnvelope = {
  payload: MasterBackupPayload;
  checksum: string;
};

export type MasterRestorePreview = {
  envelope: MasterBackupEnvelope;
  currentRecords: number;
  willReplaceRecords: number;
  destinationFingerprint: string;
};

export type MasterRestoreResult = {
  restoredRecords: number;
  restoredStores: number;
  deviceSettingsApplied: boolean;
};

export type MasterBackupErrorCode =
  | "file_too_large"
  | "not_backup"
  | "invalid_payload"
  | "unsupported_version"
  | "checksum_mismatch"
  | "cloud_connected"
  | "destination_changed"
  | "restore_failed";

export class MasterBackupError extends Error {
  constructor(
    public readonly code: MasterBackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MasterBackupError";
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const masterStorage = (): StorageLike | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

function readDeviceSettings(storage = masterStorage()): MasterDeviceSettings {
  let theme: MasterDeviceSettings["theme"] = "light";
  let interfaceScale: MasterDeviceSettings["interfaceScale"] = 100;
  try {
    if (storage?.getItem("mantu-theme") === "dark") theme = "dark";
    interfaceScale = parseInterfaceScale(storage?.getItem(INTERFACE_SCALE_CACHE)) || 100;
  } catch {}
  return { theme, interfaceScale };
}

const canonicalPayload = (payload: MasterBackupPayload) => JSON.stringify(payload);

function backupContentId(payload: Omit<MasterBackupPayload, "backupId">) {
  return sha256Hex(JSON.stringify(payload));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeJson(value: unknown, path: string, depth = 0): void {
  if (depth > 32)
    throw new MasterBackupError("invalid_payload", `${path} is nested too deeply.`);
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > 24 * 1024 * 1024)
      throw new MasterBackupError("invalid_payload", `${path} contains an oversized value.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new MasterBackupError("invalid_payload", `${path} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      assertSafeJson(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  if (!plainObject(value))
    throw new MasterBackupError("invalid_payload", `${path} is not JSON data.`);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new MasterBackupError("invalid_payload", `${path} contains a forbidden key.`);
    assertSafeJson(child, `${path}.${key}`, depth + 1);
  }
}

function sanitizeSingleLine(value: unknown, max: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function sortRecords(name: MasterStoreName, rows: Record<string, unknown>[]) {
  const key = PRIMARY_KEYS[name];
  return [...rows].sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

function portableMetaRows(rows: Record<string, unknown>[]) {
  return rows.filter((row) => isPortableMetaKey(String(row.key || "")));
}

async function ensureSourceDatasetId() {
  return db.transaction("rw", db.meta, async () => {
    const existing = await db.meta.get(MASTER_SOURCE_META);
    if (typeof existing?.value === "string" && existing.value.trim()) return existing.value;
    const created = globalThis.crypto?.randomUUID?.() || `master-${Date.now().toString(36)}`;
    await db.meta.put({ key: MASTER_SOURCE_META, value: created });
    return created;
  });
}

function payloadSummary(stores: MasterBackupPayload["stores"]): MasterBackupSummary {
  const parties = stores.parties as Array<{ type?: unknown; currentBalance?: unknown }>;
  const customers = parties.filter((row) => row.type === "customer");
  const dueRows = dueCustomerRows(
    stores.parties as unknown as Party[],
    stores.payments as unknown as Payment[],
    "",
    stores.invoices as unknown as Invoice[],
    stores.accountEntries as unknown as AccountEntry[],
    true,
  );
  return {
    customers: customers.length,
    suppliers: parties.filter((row) => row.type === "supplier").length,
    settledCustomers: dueRows.filter((row) => row.status === "paid_in_full").length,
    products: stores.items.length,
    invoices: stores.invoices.length,
    payments: stores.payments.length,
    expenses: stores.expenses.length,
    stockMovements: stores.stockMovements.length,
    totalRecords: MASTER_STORE_NAMES.reduce((sum, name) => sum + stores[name].length, 0),
  };
}

export async function createMasterBackupEnvelope(
  deviceSettings = readDeviceSettings(),
): Promise<MasterBackupEnvelope> {
  const datasetId = await ensureSourceDatasetId();
  const stores = {} as MasterBackupPayload["stores"];
  await db.transaction("r", db.tables, async () => {
    for (const name of MASTER_STORE_NAMES) {
      const table = db.table(name);
      const raw = await table.toArray() as Record<string, unknown>[];
      stores[name] = sortRecords(name, name === "meta" ? portableMetaRows(raw) : raw);
    }
  });
  const businessMeta = stores.meta.find((row) => row.key === "business-settings");
  let business: Record<string, unknown> = {};
  try {
    business = plainObject(businessMeta) && typeof businessMeta.value === "string"
      ? JSON.parse(businessMeta.value) as Record<string, unknown>
      : {};
  } catch {}
  const storeCounts = Object.fromEntries(
    MASTER_STORE_NAMES.map((name) => [name, stores[name].length]),
  ) as Record<MasterStoreName, number>;
  const withoutId: Omit<MasterBackupPayload, "backupId"> = {
    format: MASTER_BACKUP_FORMAT,
    version: MASTER_BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    currency: "INR",
    database: { name: MASTER_DATABASE_NAME, version: db.verno },
    source: {
      datasetId,
      businessName: sanitizeSingleLine(business.name || "Midori Kanjo", 200),
      businessAddress: sanitizeSingleLine(business.address || "", 500),
    },
    policy: {
      restoreMode: "replace",
      cloudCredentialsIncluded: false,
      ownerPinIncluded: false,
    },
    excluded: [
      "Owner PIN verifier and lockout",
      "Supabase URL, key, private sync code and authentication state",
      "Cloud tenant fingerprint and sync diagnostics",
      "Device-specific invoice code",
    ],
    deviceSettings,
    storeCounts,
    summary: payloadSummary(stores),
    stores,
  };
  const payload: MasterBackupPayload = {
    ...withoutId,
    backupId: backupContentId(withoutId),
  };
  const validated = validateMasterPayload(payload);
  const envelope = { payload: validated, checksum: sha256Hex(canonicalPayload(validated)) } satisfies MasterBackupEnvelope;
  assertMasterBackupSize(new Blob([masterBackupText(envelope)], { type: "text/plain;charset=utf-8" }));
  return envelope;
}

export function masterBackupText(envelope: MasterBackupEnvelope) {
  const { payload } = envelope;
  return [
    "MIDORI KANJO - COMPLETE MASTER BACKUP",
    `Created: ${payload.exportedAt}`,
    `Business: ${payload.source.businessName}`,
    `Database: ${payload.database.name} v${payload.database.version}`,
    `Records: ${payload.summary.totalRecords}`,
    `Customers: ${payload.summary.customers} (${payload.summary.settledCustomers} paid in full)`,
    `Products: ${payload.summary.products}`,
    `Invoices: ${payload.summary.invoices}`,
    `Payments: ${payload.summary.payments}`,
    `Expenses: ${payload.summary.expenses}`,
    "",
    "CONFIDENTIAL: this unencrypted file contains complete business and customer data.",
    "Restore replaces all current local app data. Keep an unchanged copy for importing.",
    "The checksum detects damage or editing; it does not prove who created the file.",
    "",
    MASTER_BEGIN,
    JSON.stringify(payload, null, 2),
    MASTER_END,
    `${MASTER_BACKUP_MARKER}-SHA256: ${envelope.checksum}`,
    "",
  ].join("\r\n");
}

export function assertMasterBackupSize(file: Pick<Blob, "size">) {
  if (file.size > MAX_MASTER_BACKUP_BYTES)
    throw new MasterBackupError("file_too_large", "The master backup is larger than 256 MiB.");
}

function asObject(value: unknown, label: string) {
  if (!plainObject(value))
    throw new MasterBackupError("invalid_payload", `${label} is not an object.`);
  return value;
}

function asString(value: unknown, label: string, max = 500, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()))
    throw new MasterBackupError("invalid_payload", `${label} is invalid.`);
  return value;
}

function asSafeInteger(value: unknown, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new MasterBackupError("invalid_payload", `${label} is invalid.`);
  return Number(value);
}

const units = new Set(["piece", "dozen", "gross", "bundle", "box", "packet"]);
const priceTiers = new Set(["retail", "wholesale", "bulk", "special"]);
const invoiceTypes = new Set(["sale", "purchase", "sale_return", "purchase_return", "quotation"]);
const paymentModes = new Set(["cash", "upi", "bank", "cheque", "credit", "mixed"]);
const paymentChannels = new Set(["cash", "upi", "bank", "cheque"]);
const expenseCategories = new Set(["refreshments", "customer_food", "shop_supplies", "transport", "other"]);
const expenseModes = new Set(["cash", "upi", "bank"]);
const movementKinds = new Set(["baseline", "sale", "sale_void", "sale_restore", "inward", "outward", "sale_return", "purchase_return", "manual_adjustment", "count_adjustment"]);
const activityEntities = new Set(["invoice", "payment", "party", "item", "expense", "due", "settings", "sync", "stock", "count", "festival"]);

function fieldString(
  row: Record<string, unknown>,
  key: string,
  label: string,
  max = 2_000,
  options: { optional?: boolean; allowEmpty?: boolean } = {},
) {
  const value = row[key];
  if (options.optional && (value == null || value === "")) return "";
  return asString(value, `${label}.${key}`, max, options.allowEmpty);
}

function fieldBoolean(row: Record<string, unknown>, key: string, label: string) {
  if (typeof row[key] !== "boolean")
    throw new MasterBackupError("invalid_payload", `${label}.${key} is invalid.`);
}

function fieldNumber(
  row: Record<string, unknown>,
  key: string,
  label: string,
  options: { minimum?: number; maximum?: number; nullable?: boolean; integer?: boolean } = {},
) {
  const value = row[key];
  if (options.nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) ||
      (options.minimum != null && value < options.minimum) ||
      (options.maximum != null && value > options.maximum) ||
      (options.integer && !Number.isSafeInteger(value)))
    throw new MasterBackupError("invalid_payload", `${label}.${key} is invalid.`);
  return value;
}

function fieldEnum(
  row: Record<string, unknown>,
  key: string,
  label: string,
  allowed: Set<string>,
) {
  const value = fieldString(row, key, label, 80);
  if (!allowed.has(value))
    throw new MasterBackupError("invalid_payload", `${label}.${key} is invalid.`);
  return value;
}

function fieldTimestamp(
  row: Record<string, unknown>,
  key: string,
  label: string,
  optional = false,
) {
  const value = fieldString(row, key, label, 50, { optional });
  if (value && !Number.isFinite(Date.parse(value)))
    throw new MasterBackupError("invalid_payload", `${label}.${key} is invalid.`);
  return value;
}

function fieldDate(
  row: Record<string, unknown>,
  key: string,
  label: string,
  optional = false,
) {
  const value = fieldString(row, key, label, 10, { optional });
  if (value && !isValidLocalDate(value))
    throw new MasterBackupError("invalid_payload", `${label}.${key} is invalid.`);
  return value;
}

function stringList(value: unknown, label: string, maxItems = 20_000) {
  if (!Array.isArray(value) || value.length > maxItems)
    throw new MasterBackupError("invalid_payload", `${label} is invalid.`);
  return value.map((entry, index) => asString(entry, `${label}[${index}]`, 500, true));
}

function objectList(value: unknown, label: string, maxItems = 100_000) {
  if (!Array.isArray(value) || value.length > maxItems)
    throw new MasterBackupError("invalid_payload", `${label} is invalid.`);
  return value.map((entry, index) => asObject(entry, `${label}[${index}]`));
}

function validateSyncedRecord(row: Record<string, unknown>, label: string) {
  fieldBoolean(row, "isSynced", label);
  fieldTimestamp(row, "updatedAt", label);
}

function validateMasterStoreSchemas(stores: MasterBackupPayload["stores"]) {
  stores.categories.forEach((row, index) => {
    const label = `categories[${index}]`;
    fieldString(row, "name", label, 500);
    fieldString(row, "parentId", label, 200, { optional: true });
    stringList(row.festivalSeason, `${label}.festivalSeason`);
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.parties.forEach((row, index) => {
    const label = `parties[${index}]`;
    fieldString(row, "name", label, 500);
    fieldString(row, "codeName", label, 200, { allowEmpty: true });
    fieldString(row, "phone", label, 80, { allowEmpty: true });
    fieldString(row, "address", label, 2_000, { allowEmpty: true });
    fieldString(row, "gstin", label, 80, { optional: true });
    fieldEnum(row, "type", label, new Set(["customer", "supplier"]));
    fieldEnum(row, "priceTier", label, priceTiers);
    fieldNumber(row, "openingBalance", label, { minimum: 0 });
    fieldNumber(row, "currentBalance", label, { minimum: 0 });
    fieldString(row, "notes", label, 50_000, { allowEmpty: true });
    stringList(row.tags, `${label}.tags`);
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.items.forEach((row, index) => {
    const label = `items[${index}]`;
    for (const key of ["name", "nameHi", "nameBn"])
      fieldString(row, key, label, 500, { allowEmpty: key !== "name" });
    fieldString(row, "skuCode", label, 200);
    fieldString(row, "categoryId", label, 200);
    fieldEnum(row, "baseUnit", label, units);
    fieldNumber(row, "conversionRate", label, { minimum: Number.EPSILON });
    for (const key of ["purchasePrice", "priceRetail", "priceWholesale", "priceBulk"])
      fieldNumber(row, key, label, { minimum: 0 });
    fieldNumber(row, "currentStock", label, { nullable: true });
    fieldNumber(row, "lowStockAlert", label, { nullable: true, minimum: 0 });
    stringList(row.festivalTags, `${label}.festivalTags`);
    fieldString(row, "hsnCode", label, 100, { optional: true });
    fieldNumber(row, "gstRate", label, { minimum: 0, maximum: 100 });
    if (row.imageUrl != null && row.imageUrl !== "") {
      const image = fieldString(row, "imageUrl", label, 24 * 1024 * 1024);
      if (!/^(data:image\/(?:png|jpe?g|webp);base64,|https:\/\/|\/)/i.test(image))
        throw new MasterBackupError("invalid_payload", `${label}.imageUrl uses an unsafe format.`);
    }
    fieldBoolean(row, "isActive", label);
    fieldNumber(row, "saleCount", label, { minimum: 0, integer: true });
    fieldDate(row, "lastSoldDate", label, true);
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.partyItemPrices.forEach((row, index) => {
    const label = `partyItemPrices[${index}]`;
    fieldString(row, "partyId", label, 200);
    fieldString(row, "itemId", label, 200);
    fieldNumber(row, "lastPrice", label, { minimum: 0 });
    fieldDate(row, "lastSoldDate", label);
    fieldNumber(row, "timesSold", label, { minimum: 0, integer: true });
    fieldBoolean(row, "lockedPrice", label);
    validateSyncedRecord(row, label);
  });
  stores.invoices.forEach((row, index) => {
    const label = `invoices[${index}]`;
    fieldString(row, "invoiceNumber", label, 300);
    fieldString(row, "partyId", label, 200, { optional: true });
    fieldString(row, "partyName", label, 500);
    fieldString(row, "partyGstin", label, 80, { optional: true });
    fieldDate(row, "date", label);
    const type = fieldEnum(row, "type", label, invoiceTypes);
    const lines = objectList(row.lineItems, `${label}.lineItems`, 25_000);
    if (!lines.length)
      throw new MasterBackupError("invalid_payload", `${label} has no line items.`);
    lines.forEach((line, lineIndex) => {
      const lineLabel = `${label}.lineItems[${lineIndex}]`;
      fieldString(line, "itemId", lineLabel, 200);
      fieldString(line, "itemName", lineLabel, 500);
      fieldString(line, "skuCode", lineLabel, 200, { allowEmpty: true });
      fieldString(line, "hsnCode", lineLabel, 100, { allowEmpty: true });
      fieldEnum(line, "unit", lineLabel, units);
      if (line.baseUnit != null) fieldEnum(line, "baseUnit", lineLabel, units);
      fieldNumber(line, "qty", lineLabel, { minimum: Number.EPSILON });
      for (const key of ["rate", "taxableAmount", "gstAmount", "amount"])
        fieldNumber(line, key, lineLabel, { minimum: 0 });
      fieldNumber(line, "discount", lineLabel, { minimum: 0, maximum: 100 });
      fieldNumber(line, "gstRate", lineLabel, { minimum: 0, maximum: 100 });
      if (line.unitCost != null) fieldNumber(line, "unitCost", lineLabel, { minimum: 0 });
      const calculated = calculateLine(line as unknown as Parameters<typeof calculateLine>[0]);
      for (const key of ["taxableAmount", "gstAmount", "amount"] as const) {
        if (Math.abs(roundMoney(Number(line[key])) - calculated[key]) >= 0.01)
          throw new MasterBackupError("invalid_payload", `${lineLabel}.${key} does not reconcile.`);
      }
    });
    for (const key of ["subtotal", "discountTotal", "gstTotal", "grandTotal", "amountPaid", "amountDue"])
      fieldNumber(row, key, label, { minimum: 0 });
    fieldNumber(row, "roundOff", label);
    if (row.initialAmountPaid != null) fieldNumber(row, "initialAmountPaid", label, { minimum: 0 });
    if (row.otherChargesTotal != null) fieldNumber(row, "otherChargesTotal", label, { minimum: 0 });
    const charges = row.otherCharges == null ? [] : objectList(row.otherCharges, `${label}.otherCharges`, 50);
    charges.forEach((charge, chargeIndex) => {
      const chargeLabel = `${label}.otherCharges[${chargeIndex}]`;
      fieldEnum(charge, "code", chargeLabel, new Set(["carrier", "packing", "big_box"]));
      fieldString(charge, "label", chargeLabel, 200);
      fieldNumber(charge, "amount", chargeLabel, { minimum: 0 });
    });
    const calculatedBill = calculateBill(
      lines as unknown as Invoice["lineItems"],
      0,
      charges as unknown as NonNullable<Invoice["otherCharges"]>,
    );
    for (const key of ["subtotal", "discountTotal", "gstTotal", "roundOff", "grandTotal"] as const) {
      if (Math.abs(roundMoney(Number(row[key])) - calculatedBill[key]) >= 0.01)
        throw new MasterBackupError("invalid_payload", `${label}.${key} does not reconcile.`);
    }
    if (row.otherChargesTotal != null && Math.abs(roundMoney(Number(row.otherChargesTotal)) - calculatedBill.otherChargesTotal) >= 0.01)
      throw new MasterBackupError("invalid_payload", `${label}.otherChargesTotal does not reconcile.`);
    fieldEnum(row, "paymentMode", label, paymentModes);
    if (row.paymentReceivedMode != null) fieldEnum(row, "paymentReceivedMode", label, paymentChannels);
    const paymentBreakdown = row.paymentBreakdown == null ? [] : objectList(row.paymentBreakdown, `${label}.paymentBreakdown`, 20);
    paymentBreakdown.forEach((part, partIndex) => {
      const partLabel = `${label}.paymentBreakdown[${partIndex}]`;
      fieldEnum(part, "mode", partLabel, paymentChannels);
      fieldNumber(part, "amount", partLabel, { minimum: 0 });
      fieldString(part, "reference", partLabel, 2_000, { optional: true });
    });
    if (paymentBreakdown.length && row.initialAmountPaid != null) {
      const tenderTotal = roundMoney(paymentBreakdown.reduce((sum, part) => sum + Number(part.amount), 0));
      if (Math.abs(tenderTotal - roundMoney(Number(row.initialAmountPaid))) >= 0.01)
        throw new MasterBackupError("invalid_payload", `${label}.paymentBreakdown does not reconcile.`);
    }
    if (row.returnDetails != null) {
      const details = asObject(row.returnDetails, `${label}.returnDetails`);
      fieldString(details, "sourceInvoiceId", `${label}.returnDetails`, 200, { optional: true });
      objectList(details.allocations, `${label}.returnDetails.allocations`, 25_000).forEach((allocation, allocationIndex) => {
        const allocationLabel = `${label}.returnDetails.allocations[${allocationIndex}]`;
        fieldString(allocation, "invoiceId", allocationLabel, 200);
        fieldNumber(allocation, "amount", allocationLabel, { minimum: 0 });
      });
      fieldNumber(details, "balanceApplied", `${label}.returnDetails`, { minimum: 0 });
      fieldNumber(details, "settlementAmount", `${label}.returnDetails`, { minimum: 0 });
      if (type !== "sale_return" && type !== "purchase_return")
        throw new MasterBackupError("invalid_payload", `${label} has return details on a non-return document.`);
    }
    fieldString(row, "notes", label, 50_000, { allowEmpty: true });
    fieldBoolean(row, "isSynced", label);
    fieldTimestamp(row, "createdAt", label);
    fieldTimestamp(row, "updatedAt", label);
    fieldTimestamp(row, "deletedAt", label, true);
  });
  stores.payments.forEach((row, index) => {
    const label = `payments[${index}]`;
    fieldString(row, "partyId", label, 200);
    fieldNumber(row, "amount", label, { minimum: 0.01 });
    fieldDate(row, "date", label);
    fieldEnum(row, "mode", label, paymentChannels);
    fieldString(row, "reference", label, 2_000, { allowEmpty: true });
    objectList(row.allocatedTo, `${label}.allocatedTo`, 25_000).forEach((allocation, allocationIndex) => {
      const allocationLabel = `${label}.allocatedTo[${allocationIndex}]`;
      fieldString(allocation, "invoiceId", allocationLabel, 200);
      fieldNumber(allocation, "amount", allocationLabel, { minimum: 0 });
    });
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.accountEntries.forEach((row, index) => {
    const label = `accountEntries[${index}]`;
    fieldString(row, "partyId", label, 200);
    if (row.kind !== "due") throw new MasterBackupError("invalid_payload", `${label}.kind is invalid.`);
    fieldNumber(row, "amount", label, { minimum: 0.01 });
    fieldDate(row, "date", label);
    fieldString(row, "note", label, 20_000, { allowEmpty: true });
    fieldString(row, "reference", label, 2_000, { allowEmpty: true });
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.expenses.forEach((row, index) => {
    const label = `expenses[${index}]`;
    fieldEnum(row, "category", label, expenseCategories);
    fieldNumber(row, "amount", label, { minimum: 0.01 });
    fieldDate(row, "date", label);
    fieldString(row, "description", label, 20_000, { allowEmpty: true });
    fieldEnum(row, "paymentMode", label, expenseModes);
    fieldString(row, "reference", label, 2_000, { allowEmpty: true });
    fieldTimestamp(row, "createdAt", label);
    fieldTimestamp(row, "deletedAt", label, true);
    validateSyncedRecord(row, label);
  });
  stores.stockMovements.forEach((row, index) => {
    const label = `stockMovements[${index}]`;
    fieldString(row, "itemId", label, 200);
    fieldEnum(row, "kind", label, movementKinds);
    fieldString(row, "reason", label, 500);
    fieldString(row, "note", label, 20_000, { allowEmpty: true });
    for (const key of ["qtyChange", "stockBefore", "stockAfter"])
      fieldNumber(row, key, label, { nullable: true });
    fieldBoolean(row, "applied", label);
    for (const key of ["entryQty", "packCount", "unitsPerPack"])
      if (row[key] != null) fieldNumber(row, key, label, { minimum: 0 });
    for (const key of ["entryUnit", "containedUnit"])
      if (row[key] != null) fieldEnum(row, key, label, units);
    for (const key of ["refInvoiceId", "sourceInvoiceId", "countSessionId", "partyId", "supplierReference"])
      fieldString(row, key, label, 2_000, { optional: true });
    fieldDate(row, "date", label);
    fieldEnum(row, "actor", label, new Set(["owner", "staff"]));
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.countSessions.forEach((row, index) => {
    const label = `countSessions[${index}]`;
    fieldString(row, "categoryId", label, 200);
    fieldString(row, "categoryName", label, 500);
    fieldEnum(row, "status", label, new Set(["in_progress", "completed"]));
    stringList(row.itemIds, `${label}.itemIds`, 100_000);
    fieldTimestamp(row, "startedAt", label);
    fieldTimestamp(row, "completedAt", label, true);
    validateSyncedRecord(row, label);
  });
  stores.countLines.forEach((row, index) => {
    const label = `countLines[${index}]`;
    fieldString(row, "sessionId", label, 200);
    fieldString(row, "itemId", label, 200);
    fieldString(row, "itemName", label, 500);
    fieldString(row, "skuCode", label, 200, { allowEmpty: true });
    fieldEnum(row, "baseUnit", label, units);
    fieldNumber(row, "systemStockAtStart", label, { nullable: true });
    fieldNumber(row, "countedStock", label, { nullable: true, minimum: 0 });
    fieldTimestamp(row, "countedAt", label, true);
    fieldTimestamp(row, "createdAt", label);
    validateSyncedRecord(row, label);
  });
  stores.festivalEntries.forEach((row, index) => {
    const label = `festivalEntries[${index}]`;
    fieldString(row, "festivalKey", label, 200);
    fieldNumber(row, "year", label, { minimum: 2000, maximum: 2200, integer: true });
    for (const key of ["nameEn", "nameHi", "nameBn"])
      fieldString(row, key, label, 500);
    const start = fieldDate(row, "startDate", label);
    const end = fieldDate(row, "endDate", label);
    if (end < start) throw new MasterBackupError("invalid_payload", `${label} has an invalid date range.`);
    fieldNumber(row, "leadTimeWeeks", label, { minimum: 0, maximum: 104, integer: true });
    fieldEnum(row, "dateStatus", label, new Set(["verified", "provisional", "business_estimate"]));
    fieldString(row, "sourceNote", label, 20_000, { allowEmpty: true });
    fieldTimestamp(row, "createdAt", label);
    fieldTimestamp(row, "updatedAt", label);
  });
  stores.festivalTasks.forEach((row, index) => {
    const label = `festivalTasks[${index}]`;
    fieldString(row, "festivalId", label, 200);
    if (row.kind !== "stock_plan") throw new MasterBackupError("invalid_payload", `${label}.kind is invalid.`);
    fieldTimestamp(row, "completedAt", label, true);
    fieldTimestamp(row, "updatedAt", label);
  });
  stores.activityLogs.forEach((row, index) => {
    const label = `activityLogs[${index}]`;
    fieldString(row, "action", label, 500);
    fieldEnum(row, "entityType", label, activityEntities);
    fieldString(row, "entityId", label, 200, { optional: true });
    fieldString(row, "description", label, 50_000);
    fieldEnum(row, "actor", label, new Set(["owner", "staff"]));
    fieldString(row, "metadata", label, 2_000_000, { allowEmpty: true });
    fieldTimestamp(row, "createdAt", label);
  });
  stores.dailyCloses.forEach((row, index) => {
    const label = `dailyCloses[${index}]`;
    fieldDate(row, "date", label);
    fieldNumber(row, "openingCash", label, { minimum: 0 });
    fieldNumber(row, "expectedCash", label);
    fieldNumber(row, "countedCash", label, { minimum: 0 });
    fieldNumber(row, "discrepancy", label);
    if (Math.abs(roundMoney(Number(row.countedCash) - Number(row.expectedCash)) - roundMoney(Number(row.discrepancy))) >= 0.01)
      throw new MasterBackupError("invalid_payload", `${label}.discrepancy does not match the cash count.`);
    fieldString(row, "notes", label, 50_000, { allowEmpty: true });
    fieldTimestamp(row, "closedAt", label);
    fieldTimestamp(row, "updatedAt", label);
  });
  stores.meta.forEach((row, index) => {
    const key = String(row.key);
    const value = row.value;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      throw new MasterBackupError("invalid_payload", `meta[${index}].value is invalid.`);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new MasterBackupError("invalid_payload", `meta[${index}].value is invalid.`);
    const parseJsonValue = (expected: "object" | "array") => {
      if (typeof value !== "string")
        throw new MasterBackupError("invalid_payload", `meta[${index}] ${key} must be JSON text.`);
      let parsed: unknown;
      try { parsed = JSON.parse(value); }
      catch { throw new MasterBackupError("invalid_payload", `meta[${index}] ${key} contains malformed JSON.`); }
      assertSafeJson(parsed, `meta[${index}].value`);
      if ((expected === "array" && !Array.isArray(parsed)) || (expected === "object" && !plainObject(parsed)))
        throw new MasterBackupError("invalid_payload", `meta[${index}] ${key} has the wrong JSON shape.`);
      return parsed;
    };
    if (key === "language" && (typeof value !== "string" || !["en", "hi", "bn"].includes(value)))
      throw new MasterBackupError("invalid_payload", `meta[${index}] language is invalid.`);
    if (key === "invoice-format" && (typeof value !== "string" || !["a4", "a5", "thermal"].includes(value)))
      throw new MasterBackupError("invalid_payload", `meta[${index}] invoice format is invalid.`);
    if (key === "bill-gst-enabled" && typeof value !== "boolean")
      throw new MasterBackupError("invalid_payload", `meta[${index}] GST flag is invalid.`);
    if (key === "bill-gst-rate") {
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100)
        throw new MasterBackupError("invalid_payload", `meta[${index}] GST rate is invalid.`);
    }
    if (key === "interface-scale-v1" && !parseInterfaceScale(value))
      throw new MasterBackupError("invalid_payload", `meta[${index}] interface scale is invalid.`);
    if (["invoice-counter", "quotation-counter"].includes(key) && (!Number.isSafeInteger(value) || Number(value) < 0))
      throw new MasterBackupError("invalid_payload", `meta[${index}] counter is invalid.`);
    if (["dues-backup-source-id", MASTER_SOURCE_META].includes(key) && (typeof value !== "string" || !value.trim() || value.length > 500))
      throw new MasterBackupError("invalid_payload", `meta[${index}] source ID is invalid.`);
    if (["seeded-v1", "seeded-v2", "seeded-v3"].includes(key) && typeof value !== "boolean")
      throw new MasterBackupError("invalid_payload", `meta[${index}] seed marker is invalid.`);
    if (["business-settings", "workspace-preferences-v1", "message-templates-v1", "bill-draft-v1"].includes(key))
      parseJsonValue("object");
    if (["printer-profiles-v1", "favourite-items-v1"].includes(key))
      parseJsonValue("array");
    if (key.startsWith("dues-ledger-import:")) {
      const marker = parseJsonValue("object") as Record<string, unknown>;
      if (typeof marker.destinationPartyId !== "string" || !marker.destinationPartyId.trim() ||
          (marker.checksum != null && (typeof marker.checksum !== "string" || !/^[a-f0-9]{64}$/.test(marker.checksum))))
        throw new MasterBackupError("invalid_payload", `meta[${index}] dues restore marker is invalid.`);
    }
  });
}

function validateNoCycles(
  links: Map<string, string>,
  label: string,
) {
  for (const start of links.keys()) {
    const seen = new Set<string>();
    let current = start;
    while (links.has(current)) {
      if (seen.has(current))
        throw new MasterBackupError("invalid_payload", `${label} contains a cycle.`);
      seen.add(current);
      current = links.get(current)!;
    }
  }
}

function validateMasterRelationships(stores: MasterBackupPayload["stores"]) {
  const ids = (name: MasterStoreName) => new Set(stores[name].map((row) => String(row[PRIMARY_KEYS[name]])));
  const categoryIds = ids("categories");
  const partyIds = ids("parties");
  const itemIds = ids("items");
  const invoiceIds = ids("invoices");
  const countSessionIds = ids("countSessions");
  const festivalIds = ids("festivalEntries");
  const invoiceById = new Map(stores.invoices.map((row) => [String(row.id), row]));
  const partyById = new Map(stores.parties.map((row) => [String(row.id), row]));
  const itemById = new Map(stores.items.map((row) => [String(row.id), row]));
  const requireRef = (set: Set<string>, value: unknown, label: string) => {
    if (!set.has(String(value || "")))
      throw new MasterBackupError("invalid_payload", `${label} points to a missing record.`);
  };
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length)
      throw new MasterBackupError("invalid_payload", `${label} contains duplicates.`);
  };

  const categoryParents = new Map<string, string>();
  stores.categories.forEach((row, index) => {
    if (row.parentId) {
      requireRef(categoryIds, row.parentId, `categories[${index}].parentId`);
      categoryParents.set(String(row.id), String(row.parentId));
    }
  });
  validateNoCycles(categoryParents, "Category hierarchy");

  const mergedParties = new Map<string, string>();
  stores.parties.forEach((row, index) => {
    for (const tag of row.tags as string[]) {
      if (!tag.startsWith("mergedInto:")) continue;
      const target = tag.slice("mergedInto:".length).trim();
      requireRef(partyIds, target, `parties[${index}] merged target`);
      mergedParties.set(String(row.id), target);
    }
  });
  validateNoCycles(mergedParties, "Merged customer aliases");

  const aliasItems = new Map<string, string>();
  const normalizedSkus: string[] = [];
  stores.items.forEach((row, index) => {
    requireRef(categoryIds, row.categoryId, `items[${index}].categoryId`);
    normalizedSkus.push(String(row.skuCode).trim().toUpperCase());
    for (const tag of row.festivalTags as string[]) {
      if (!tag.startsWith("aliasOf:")) continue;
      const target = tag.slice("aliasOf:".length).trim();
      requireRef(itemIds, target, `items[${index}] alias target`);
      aliasItems.set(String(row.id), target);
    }
  });
  unique(normalizedSkus, "Product SKU codes");
  validateNoCycles(aliasItems, "Merged product aliases");

  const pricePairs: string[] = [];
  stores.partyItemPrices.forEach((row, index) => {
    requireRef(partyIds, row.partyId, `partyItemPrices[${index}].partyId`);
    requireRef(itemIds, row.itemId, `partyItemPrices[${index}].itemId`);
    if (row.id !== `${row.partyId}::${row.itemId}`)
      throw new MasterBackupError("invalid_payload", `partyItemPrices[${index}] does not use its canonical ID.`);
    pricePairs.push(`${row.partyId}\u0000${row.itemId}`);
  });
  unique(pricePairs, "Party-product price pairs");

  unique(stores.invoices.map((row) => String(row.invoiceNumber)), "Invoice numbers");
  const returnCreditsByInvoice = new Map<string, number>();
  stores.invoices.forEach((row, index) => {
    if (row.partyId) requireRef(partyIds, row.partyId, `invoices[${index}].partyId`);
    (row.lineItems as Record<string, unknown>[]).forEach((line, lineIndex) =>
      requireRef(itemIds, line.itemId, `invoices[${index}].lineItems[${lineIndex}].itemId`),
    );
    const details = row.returnDetails as Record<string, unknown> | undefined;
    if (!details) {
      if (row.type === "sale_return" || row.type === "purchase_return")
        throw new MasterBackupError("invalid_payload", `invoices[${index}] is missing return details.`);
      return;
    }
    const sourceId = String(details.sourceInvoiceId || "");
    if (sourceId) {
      requireRef(invoiceIds, sourceId, `invoices[${index}].returnDetails.sourceInvoiceId`);
      const source = invoiceById.get(sourceId)!;
      if (source.deletedAt || source.partyId !== row.partyId ||
          (row.type === "sale_return" && source.type !== "sale") ||
          (row.type === "purchase_return" && source.type !== "purchase"))
        throw new MasterBackupError("invalid_payload", `invoices[${index}] has a mismatched return source.`);
    }
    const allocations = details.allocations as Record<string, unknown>[];
    let allocated = 0;
    const allocationIds: string[] = [];
    allocations.forEach((allocation, allocationIndex) => {
      const targetId = String(allocation.invoiceId);
      allocationIds.push(targetId);
      requireRef(invoiceIds, targetId, `invoices[${index}].returnDetails.allocations[${allocationIndex}]`);
      const target = invoiceById.get(targetId)!;
      if (target.deletedAt || target.partyId !== row.partyId ||
          (row.type === "sale_return" && target.type !== "sale") ||
          (row.type === "purchase_return" && target.type !== "purchase"))
        throw new MasterBackupError("invalid_payload", `invoices[${index}] has a cross-account return allocation.`);
      allocated = roundMoney(allocated + Number(allocation.amount));
      returnCreditsByInvoice.set(targetId, roundMoney((returnCreditsByInvoice.get(targetId) || 0) + Number(allocation.amount)));
    });
    unique(allocationIds, `invoices[${index}] return allocation targets`);
    const balanceApplied = Number(details.balanceApplied);
    const settlementAmount = Number(details.settlementAmount);
    if (allocated > roundMoney(balanceApplied) ||
        Math.abs(roundMoney(balanceApplied + settlementAmount) - roundMoney(Number(row.grandTotal))) >= 0.01)
      throw new MasterBackupError("invalid_payload", `invoices[${index}] return amounts do not reconcile.`);
  });

  const laterAllocatedByInvoice = new Map<string, number>();
  stores.payments.forEach((row, index) => {
    requireRef(partyIds, row.partyId, `payments[${index}].partyId`);
    let allocated = 0;
    const allocationIds: string[] = [];
    (row.allocatedTo as Record<string, unknown>[]).forEach((allocation, allocationIndex) => {
      const invoiceId = String(allocation.invoiceId);
      allocationIds.push(invoiceId);
      requireRef(invoiceIds, invoiceId, `payments[${index}].allocatedTo[${allocationIndex}]`);
      const invoice = invoiceById.get(invoiceId)!;
      if (invoice.deletedAt || invoice.partyId !== row.partyId || (invoice.type !== "sale" && invoice.type !== "purchase"))
        throw new MasterBackupError("invalid_payload", `payments[${index}] has a cross-account allocation.`);
      const amount = Number(allocation.amount);
      allocated = roundMoney(allocated + amount);
      laterAllocatedByInvoice.set(invoiceId, roundMoney((laterAllocatedByInvoice.get(invoiceId) || 0) + amount));
    });
    unique(allocationIds, `payments[${index}] allocation targets`);
    if (allocated > roundMoney(Number(row.amount)))
      throw new MasterBackupError("invalid_payload", `payments[${index}] allocations exceed the payment.`);
  });
  stores.invoices.forEach((row, index) => {
    const type = String(row.type);
    const grandTotal = roundMoney(Number(row.grandTotal));
    const later = laterAllocatedByInvoice.get(String(row.id)) || 0;
    if (type === "quotation") {
      if (roundMoney(Number(row.initialAmountPaid || 0)) !== 0 || roundMoney(Number(row.amountPaid)) !== 0 || Math.abs(roundMoney(Number(row.amountDue)) - grandTotal) >= 0.01)
        throw new MasterBackupError("invalid_payload", `invoices[${index}] quotation totals are stale.`);
      return;
    }
    if (type === "sale_return" || type === "purchase_return") {
      if (row.deletedAt) return;
      const details = row.returnDetails as Record<string, unknown>;
      const settlement = roundMoney(Number(details.settlementAmount));
      if (row.initialAmountPaid == null ||
          Math.abs(roundMoney(Number(row.initialAmountPaid)) - settlement) >= 0.01 ||
          Math.abs(roundMoney(Number(row.amountPaid)) - settlement) >= 0.01 ||
          Math.abs(roundMoney(Number(row.amountDue))) >= 0.01)
        throw new MasterBackupError("invalid_payload", `invoices[${index}] return settlement totals are stale.`);
      return;
    }
    const initial = invoiceInitialPaymentBreakdown(
      row as unknown as Parameters<typeof invoiceInitialPaymentBreakdown>[0],
      later,
    ).reduce((sum, allocation) => roundMoney(sum + allocation.amount), 0);
    if (row.deletedAt) {
      if (roundMoney(initial + later) >= 0.01)
        throw new MasterBackupError("invalid_payload", `invoices[${index}] is a voided bill with receipts and is not restart-stable.`);
      return;
    }
    if (row.initialAmountPaid == null)
      throw new MasterBackupError("invalid_payload", `invoices[${index}] is missing its canonical initial payment.`);
    const credits = returnCreditsByInvoice.get(String(row.id)) || 0;
    if (roundMoney(initial + later + credits) > grandTotal)
      throw new MasterBackupError("invalid_payload", `invoices[${index}] receipts and credits exceed its total.`);
    const expectedPaid = roundMoney(initial + later);
    const expectedDue = roundMoney(grandTotal - expectedPaid - credits);
    if (Math.abs(roundMoney(Number(row.amountPaid)) - expectedPaid) >= 0.01 ||
        Math.abs(roundMoney(Number(row.amountDue)) - expectedDue) >= 0.01)
      throw new MasterBackupError("invalid_payload", `invoices[${index}] paid or due totals are stale.`);
  });
  stores.accountEntries.forEach((row, index) =>
    requireRef(partyIds, row.partyId, `accountEntries[${index}].partyId`),
  );

  stores.stockMovements.forEach((row, index) => {
    requireRef(itemIds, row.itemId, `stockMovements[${index}].itemId`);
    if (row.refInvoiceId) requireRef(invoiceIds, row.refInvoiceId, `stockMovements[${index}].refInvoiceId`);
    if (row.sourceInvoiceId) requireRef(invoiceIds, row.sourceInvoiceId, `stockMovements[${index}].sourceInvoiceId`);
    if (row.countSessionId) requireRef(countSessionIds, row.countSessionId, `stockMovements[${index}].countSessionId`);
    if (row.partyId) requireRef(partyIds, row.partyId, `stockMovements[${index}].partyId`);
  });

  const countPairs: string[] = [];
  const linesBySession = new Map<string, Set<string>>();
  stores.countSessions.forEach((row, index) => {
    requireRef(categoryIds, row.categoryId, `countSessions[${index}].categoryId`);
    const sessionItems = row.itemIds as string[];
    unique(sessionItems, `countSessions[${index}].itemIds`);
    sessionItems.forEach((itemId) => requireRef(itemIds, itemId, `countSessions[${index}].itemIds`));
  });
  stores.countLines.forEach((row, index) => {
    requireRef(countSessionIds, row.sessionId, `countLines[${index}].sessionId`);
    requireRef(itemIds, row.itemId, `countLines[${index}].itemId`);
    if (row.id !== `${row.sessionId}::${row.itemId}`)
      throw new MasterBackupError("invalid_payload", `countLines[${index}] does not use its canonical ID.`);
    const pair = `${row.sessionId}\u0000${row.itemId}`;
    countPairs.push(pair);
    const sessionItems = linesBySession.get(String(row.sessionId)) || new Set<string>();
    sessionItems.add(String(row.itemId));
    linesBySession.set(String(row.sessionId), sessionItems);
  });
  unique(countPairs, "Count-session item pairs");
  stores.countSessions.forEach((session, index) => {
    const expected = new Set(session.itemIds as string[]);
    const actual = linesBySession.get(String(session.id)) || new Set<string>();
    if (expected.size !== actual.size || [...expected].some((itemId) => !actual.has(itemId)))
      throw new MasterBackupError("invalid_payload", `countSessions[${index}] does not match its count lines.`);
  });

  unique(stores.festivalEntries.map((row) => `${row.festivalKey}\u0000${row.year}`), "Festival occurrence years");
  stores.festivalTasks.forEach((row, index) => {
    requireRef(festivalIds, row.festivalId, `festivalTasks[${index}].festivalId`);
    if (row.id !== `${row.festivalId}:stock_plan`)
      throw new MasterBackupError("invalid_payload", `festivalTasks[${index}] does not use its canonical ID.`);
  });
  unique(stores.festivalTasks.map((row) => `${row.festivalId}\u0000${row.kind}`), "Festival task pairs");
  unique(stores.dailyCloses.map((row) => String(row.date)), "Daily-close dates");
  stores.dailyCloses.forEach((row, index) => {
    if (row.id !== `close:${row.date}`)
      throw new MasterBackupError("invalid_payload", `dailyCloses[${index}] does not use its canonical ID.`);
  });

  // Derived party balances are part of the business snapshot. Reject a stale
  // cache instead of restoring a screen total that disagrees with its ledger.
  const duesByParty = new Map<string, number>();
  stores.accountEntries.forEach((row) => duesByParty.set(String(row.partyId), roundMoney((duesByParty.get(String(row.partyId)) || 0) + Number(row.amount))));
  const paymentsByParty = new Map<string, number>();
  stores.payments.forEach((row) => paymentsByParty.set(String(row.partyId), roundMoney((paymentsByParty.get(String(row.partyId)) || 0) + Number(row.amount))));
  for (const party of stores.parties) {
    let balance = Number(party.openingBalance) + (duesByParty.get(String(party.id)) || 0) - (paymentsByParty.get(String(party.id)) || 0);
    for (const row of stores.invoices) {
      if (row.partyId !== party.id || row.deletedAt) continue;
      if (row.type === "sale" || row.type === "purchase") {
        const initialPaid = invoiceInitialPaymentBreakdown(
          row as unknown as Parameters<typeof invoiceInitialPaymentBreakdown>[0],
          laterAllocatedByInvoice.get(String(row.id)) || 0,
        ).reduce((sum, allocation) => sum + allocation.amount, 0);
        balance += Number(row.grandTotal) - initialPaid;
      } else if (row.type === "sale_return" || row.type === "purchase_return") {
        const details = row.returnDetails as Record<string, unknown> | undefined;
        balance -= Number(details?.balanceApplied || 0);
      }
    }
    const expected = roundMoney(Math.max(0, balance));
    if (Math.abs(expected - Number(party.currentBalance)) >= 0.01)
      throw new MasterBackupError("invalid_payload", `Party ${party.name} has a balance that does not match its ledger.`);
  }

  // The cached item stock must agree with the immutable movement trail.
  const movementByItem = new Map<string, Record<string, unknown>[]>();
  for (const row of stores.stockMovements) {
    const list = movementByItem.get(String(row.itemId)) || [];
    list.push(row);
    movementByItem.set(String(row.itemId), list);
  }
  for (const item of stores.items) {
    if (item.currentStock !== null && !movementByItem.has(String(item.id)))
      throw new MasterBackupError("invalid_payload", `Item ${item.name || item.id} has tracked stock without a movement trail.`);
  }
  const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  for (const [itemId, movements] of movementByItem) {
    let stock: number | null = null;
    movements.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
    for (const movement of movements) {
      if (!movement.applied) continue;
      const absolute = movement.kind === "baseline" || movement.kind === "manual_adjustment" || movement.kind === "count_adjustment";
      if (absolute) stock = movement.stockAfter as number | null;
      else if (stock !== null && movement.qtyChange !== null) stock = roundQuantity(stock + Number(movement.qtyChange));
      else if (movement.stockBefore !== null && movement.qtyChange !== null) stock = roundQuantity(Number(movement.stockBefore) + Number(movement.qtyChange));
      else if (movement.stockAfter !== null) stock = Number(movement.stockAfter);
    }
    if (stock !== itemById.get(itemId)?.currentStock)
      throw new MasterBackupError("invalid_payload", `Item ${itemById.get(itemId)?.name || itemId} has stock that does not match its movement history.`);
  }

  // Keep the maps live in validation so accidental ID coercion cannot hide a
  // missing party or item in future schema edits.
  void partyById;
}

function validateMasterPayload(value: unknown): MasterBackupPayload {
  assertSafeJson(value, "payload");
  const raw = asObject(value, "Master payload");
  if (raw.format !== MASTER_BACKUP_FORMAT)
    throw new MasterBackupError("not_backup", "This is not a Midori Kanjo master backup.");
  if (raw.version !== MASTER_BACKUP_VERSION)
    throw new MasterBackupError("unsupported_version", "This master backup version is not supported.");
  if (raw.currency !== "INR")
    throw new MasterBackupError("invalid_payload", "The master backup currency is invalid.");
  const database = asObject(raw.database, "Database descriptor");
  if (database.name !== MASTER_DATABASE_NAME)
    throw new MasterBackupError("invalid_payload", "The backup belongs to another database.");
  const databaseVersion = asSafeInteger(database.version, "Database version", 1);
  if (databaseVersion !== db.verno)
    throw new MasterBackupError("unsupported_version", "This master backup uses a different database schema version.");
  const source = asObject(raw.source, "Source");
  const policy = asObject(raw.policy, "Restore policy");
  if (policy.restoreMode !== "replace" || policy.cloudCredentialsIncluded !== false || policy.ownerPinIncluded !== false)
    throw new MasterBackupError("invalid_payload", "The master backup safety policy is invalid.");
  const exportedAt = asString(raw.exportedAt, "Export timestamp", 40);
  if (!Number.isFinite(Date.parse(exportedAt)))
    throw new MasterBackupError("invalid_payload", "The export timestamp is invalid.");
  const settings = asObject(raw.deviceSettings, "Device settings");
  const scale = parseInterfaceScale(settings.interfaceScale);
  if ((settings.theme !== "light" && settings.theme !== "dark") || !scale)
    throw new MasterBackupError("invalid_payload", "The device settings are invalid.");
  const storesRaw = asObject(raw.stores, "Stores");
  const storeCountsRaw = asObject(raw.storeCounts, "Store counts");
  const storeKeys = Object.keys(storesRaw).sort();
  const expectedKeys = [...MASTER_STORE_NAMES].sort();
  if (JSON.stringify(storeKeys) !== JSON.stringify(expectedKeys))
    throw new MasterBackupError("invalid_payload", "The backup must contain every current app store exactly once.");
  const stores = {} as MasterBackupPayload["stores"];
  let totalRecords = 0;
  for (const name of MASTER_STORE_NAMES) {
    const rows = storesRaw[name];
    if (!Array.isArray(rows))
      throw new MasterBackupError("invalid_payload", `Store ${name} is not an array.`);
    if (rows.length !== asSafeInteger(storeCountsRaw[name], `${name} count`))
      throw new MasterBackupError("invalid_payload", `Store ${name} count does not match.`);
    totalRecords += rows.length;
    if (totalRecords > 1_000_000)
      throw new MasterBackupError("invalid_payload", "The backup contains too many records.");
    const primaryKey = PRIMARY_KEYS[name];
    const seen = new Set<string>();
    const parsedRows = rows.map((row, index) => {
      const parsed = asObject(row, `${name}[${index}]`);
      const key = asString(parsed[primaryKey], `${name}[${index}].${primaryKey}`, 500);
      if (seen.has(key))
        throw new MasterBackupError("invalid_payload", `Store ${name} contains a duplicate primary key.`);
      seen.add(key);
      if (name === "meta" && !isPortableMetaKey(key))
        throw new MasterBackupError("invalid_payload", `Store meta contains a non-portable setting (${key}).`);
      return parsed;
    });
    stores[name] = sortRecords(name, parsedRows);
  }
  validateMasterStoreSchemas(stores);
  validateMasterRelationships(stores);
  const summary = payloadSummary(stores);
  const summaryRaw = asObject(raw.summary, "Summary");
  for (const [key, value] of Object.entries(summary)) {
    if (summaryRaw[key] !== value)
      throw new MasterBackupError("invalid_payload", `Summary field ${key} does not match the stores.`);
  }
  const sourceValue = {
    datasetId: asString(source.datasetId, "Dataset ID", 200),
    businessName: asString(source.businessName, "Business name", 200),
    businessAddress: asString(source.businessAddress, "Business address", 500, true),
  };
  const policyValue = {
    restoreMode: "replace" as const,
    cloudCredentialsIncluded: false as const,
    ownerPinIncluded: false as const,
  };
  const withoutId: Omit<MasterBackupPayload, "backupId"> = {
    format: MASTER_BACKUP_FORMAT,
    version: MASTER_BACKUP_VERSION,
    appVersion: asString(raw.appVersion, "App version", 40),
    exportedAt,
    currency: "INR",
    database: { name: MASTER_DATABASE_NAME, version: databaseVersion },
    source: sourceValue,
    policy: policyValue,
    excluded: Array.isArray(raw.excluded) ? raw.excluded.map((entry, index) => asString(entry, `Excluded item ${index + 1}`, 500)) : [],
    deviceSettings: { theme: settings.theme as "light" | "dark", interfaceScale: scale },
    storeCounts: Object.fromEntries(MASTER_STORE_NAMES.map((name) => [name, stores[name].length])) as Record<MasterStoreName, number>,
    summary,
    stores,
  };
  const backupId = asString(raw.backupId, "Backup ID", 64);
  if (!/^[a-f0-9]{64}$/.test(backupId) || backupId !== backupContentId(withoutId))
    throw new MasterBackupError("invalid_payload", "The backup ID does not match its contents.");
  return { ...withoutId, backupId };
}

export function parseMasterBackupBytes(bytes: Uint8Array): MasterBackupEnvelope {
  if (bytes.byteLength > MAX_MASTER_BACKUP_BYTES)
    throw new MasterBackupError("file_too_large", "The selected master backup is larger than 256 MiB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  } catch {
    throw new MasterBackupError("not_backup", "Choose an unchanged Midori Kanjo master text backup.");
  }
  const beginToken = `${MASTER_BEGIN}\n`;
  const endToken = `\n${MASTER_END}\n`;
  const begin = text.indexOf(beginToken);
  const end = text.indexOf(endToken, begin + beginToken.length);
  if (begin < 0 || end < 0 || text.indexOf(beginToken, begin + 1) >= 0 || text.indexOf(endToken, end + 1) >= 0)
    throw new MasterBackupError("not_backup", "Choose an unchanged Midori Kanjo master text backup.");
  const checksumText = text.slice(end + endToken.length);
  const checksumMatch = new RegExp(`^${MASTER_BACKUP_MARKER}-SHA256: ([a-f0-9]{64})\\n?$`).exec(checksumText);
  if (!checksumMatch)
    throw new MasterBackupError("invalid_payload", "The master backup checksum is missing or malformed.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(begin + beginToken.length, end));
  } catch {
    throw new MasterBackupError("invalid_payload", "The master backup JSON is invalid.");
  }
  const payload = validateMasterPayload(parsed);
  const checksum = sha256Hex(canonicalPayload(payload));
  if (checksum !== checksumMatch[1])
    throw new MasterBackupError("checksum_mismatch", "The master backup is damaged or has been edited.");
  return { payload, checksum };
}

export async function parseMasterBackupFile(file: File) {
  if (file.size > MAX_MASTER_BACKUP_BYTES)
    throw new MasterBackupError("file_too_large", "The selected master backup is larger than 256 MiB.");
  return parseMasterBackupBytes(new Uint8Array(await file.arrayBuffer()));
}

export async function previewMasterRestore(envelope: MasterBackupEnvelope): Promise<MasterRestorePreview> {
  const payload = validateMasterPayload(envelope.payload);
  if (sha256Hex(canonicalPayload(payload)) !== envelope.checksum)
    throw new MasterBackupError("checksum_mismatch", "The master backup changed after it was opened.");
  const state = await db.transaction("r", db.tables, readDestinationState);
  return {
    envelope: { payload, checksum: envelope.checksum },
    currentRecords: state.count,
    willReplaceRecords: payload.summary.totalRecords,
    destinationFingerprint: state.fingerprint,
  };
}

async function readDestinationState() {
  let count = 0;
  const signatures: Array<[MasterStoreName, Array<[string, unknown]>]> = [];
  for (const name of MASTER_STORE_NAMES) {
    const primaryKey = PRIMARY_KEYS[name];
    const rows = await db.table(name).toArray() as Record<string, unknown>[];
    count += rows.length;
    signatures.push([
      name,
      rows
        .map((row): [string, unknown] => [
          String(row[primaryKey]),
          JSON.stringify(row),
        ])
        .sort((left, right) => left[0].localeCompare(right[0])),
    ]);
  }
  return { count, fingerprint: sha256Hex(JSON.stringify(signatures)) };
}

function syncedForRestore(name: MasterStoreName, row: Record<string, unknown>) {
  return SYNCED_STORES.has(name) ? { ...row, isSynced: false } : row;
}

function applyDeviceSettings(settings: MasterDeviceSettings, storage: StorageLike | undefined) {
  if (!storage) return false;
  const previousTheme = storage.getItem("mantu-theme");
  const previousScale = storage.getItem(INTERFACE_SCALE_CACHE);
  try {
    storage.setItem("mantu-theme", settings.theme);
    storage.setItem(INTERFACE_SCALE_CACHE, String(settings.interfaceScale));
    return true;
  } catch {
    try {
      if (previousTheme == null) storage.removeItem("mantu-theme");
      else storage.setItem("mantu-theme", previousTheme);
      if (previousScale == null) storage.removeItem(INTERFACE_SCALE_CACHE);
      else storage.setItem(INTERFACE_SCALE_CACHE, previousScale);
    } catch {}
    return false;
  }
}

export async function restoreMasterBackup(
  envelope: MasterBackupEnvelope,
  options: {
    cloudConfigured?: boolean;
    storage?: StorageLike;
    expectedDestinationFingerprint?: string;
  } = {},
): Promise<MasterRestoreResult> {
  if (options.cloudConfigured || isCloudConfigured())
    throw new MasterBackupError("cloud_connected", "Disconnect cloud sync before replacing the local database.");
  const payload = validateMasterPayload(envelope.payload);
  if (sha256Hex(canonicalPayload(payload)) !== envelope.checksum)
    throw new MasterBackupError("checksum_mismatch", "The master backup changed after review.");
  const storage = options.storage || masterStorage();
  try {
    await db.transaction("rw", db.tables, async () => {
      const currentState = await readDestinationState();
      if (options.expectedDestinationFingerprint && currentState.fingerprint !== options.expectedDestinationFingerprint)
        throw new MasterBackupError("destination_changed", "Local data changed after the restore preview was opened.");
      if (isCloudConfigured())
        throw new MasterBackupError("cloud_connected", "Cloud sync was reconnected during restore review.");
      const destinationPin = await db.meta.get(OWNER_PIN_META);
      for (const name of MASTER_STORE_NAMES) await db.table(name).clear();
      for (const name of MASTER_STORE_NAMES) {
        const rows = payload.stores[name].map((row) => syncedForRestore(name, row));
        if (rows.length) await db.table(name).bulkPut(rows);
      }
      if (destinationPin) await db.meta.put(destinationPin as AppMeta);
      const restoredAt = nowIso();
      const restoreLog: ActivityLog = {
        id: makeId(),
        action: "master.backup.restore",
        entityType: "settings",
        description: `Restored complete master backup from ${payload.source.businessName}`,
        actor: "owner",
        metadata: JSON.stringify({ backupId: payload.backupId, exportedAt: payload.exportedAt }),
        createdAt: restoredAt,
      };
      await db.activityLogs.add(restoreLog);
      for (const name of MASTER_STORE_NAMES) {
        const expected = payload.storeCounts[name]
          + (name === "meta" && destinationPin ? 1 : 0)
          + (name === "activityLogs" ? 1 : 0);
        const actual = await db.table(name).count();
        if (actual !== expected)
          throw new MasterBackupError("restore_failed", `Store ${name} did not restore completely.`);
      }
    });
  } catch (cause) {
    if (cause instanceof MasterBackupError) throw cause;
    throw new MasterBackupError("restore_failed", "The master restore was rolled back. Existing data was not replaced.");
  }
  let deviceSettingsApplied = false;
  try {
    deviceSettingsApplied = applyDeviceSettings(payload.deviceSettings, storage);
  } catch {
    deviceSettingsApplied = false;
  }
  return {
    restoredRecords: payload.summary.totalRecords,
    restoredStores: MASTER_STORE_NAMES.length,
    deviceSettingsApplied,
  };
}

async function shareOrDownloadMaster(blob: Blob, fileName: string) {
  assertMasterBackupSize(blob);
  const nativeResult = await shareNativeBlob(blob, {
    fileName,
    title: "Midori Kanjo complete master backup",
    text: "Complete confidential Midori Kanjo business backup",
    dialogTitle: "Save complete master backup",
  });
  if (nativeResult === "cancelled") return "cancelled" as const;
  if (nativeResult) return "shared" as const;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded" as const;
}

export async function downloadMasterBackup() {
  const envelope = await createMasterBackupEnvelope();
  const blob = new Blob([`\uFEFF${masterBackupText(envelope)}`], { type: "text/plain;charset=utf-8" });
  const date = envelope.payload.exportedAt.slice(0, 10);
  return shareOrDownloadMaster(blob, `Midori-Kanjo-complete-master-backup-${date}.txt`);
}
