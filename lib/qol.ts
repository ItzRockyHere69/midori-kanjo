import {
  db,
  makeId,
  nowIso,
  type ActivityLog,
  type DailyClose,
  type Expense,
  type Invoice,
  type InvoiceCharge,
  type InvoiceLine,
  type Item,
  type Party,
  type Payment,
  type PaymentChannel,
  type Unit,
} from "./db";
import { roundMoney } from "./billing";

export const OWNER_PIN_META = "owner-pin-sha256-v1";
export const BILL_DRAFT_META = "bill-draft-v1";
export const WORKSPACE_META = "workspace-preferences-v1";
export const PRINTER_PROFILES_META = "printer-profiles-v1";
export const MESSAGE_TEMPLATES_META = "message-templates-v1";
export const FAVOURITE_ITEMS_META = "favourite-items-v1";

export type WorkspaceTab = "bill" | "parties" | "dues" | "items" | "misc" | "reports" | "more";
export interface WorkspacePreferences {
  order: WorkspaceTab[];
  hidden: WorkspaceTab[];
  startTab: WorkspaceTab;
}
export interface PrinterProfile {
  id: string;
  name: string;
  format: "a4" | "a5" | "thermal";
  copies: number;
  autoPreview: boolean;
  isDefault: boolean;
}
export type MessageTemplateKind = "invoice" | "quotation" | "due" | "payment" | "catalogue";
export type MessageTemplates = Record<MessageTemplateKind, string>;
export interface BillDraft {
  version: 1;
  draftId: string;
  savedAt: string;
  partyId?: string;
  lines: InvoiceLine[];
  paid: number;
  paymentMode: PaymentChannel;
  paymentPlan: "full" | "partial" | "credit";
  documentType: "sale" | "quotation";
  gstEnabled: boolean;
  gstRate: number;
  otherCharges: Array<InvoiceCharge & { enabled: boolean }>;
}

export const defaultWorkspace: WorkspacePreferences = {
  order: ["bill", "parties", "dues", "items", "misc", "reports", "more"],
  hidden: [],
  startTab: "bill",
};
export const defaultPrinterProfiles: PrinterProfile[] = [
  { id: "office-a4", name: "Office A4", format: "a4", copies: 1, autoPreview: true, isDefault: false },
  { id: "counter-a5", name: "Counter A5", format: "a5", copies: 1, autoPreview: true, isDefault: true },
  { id: "thermal-3", name: "3-inch Thermal", format: "thermal", copies: 1, autoPreview: true, isDefault: false },
];
export const defaultMessageTemplates: MessageTemplates = {
  invoice: "Namaste {{party_name}}, invoice {{invoice_number}} from {{shop_name}} is {{total}}. Paid {{paid}}; due {{due}}.",
  quotation: "Namaste {{party_name}}, quotation {{invoice_number}} from {{shop_name}} is {{total}}.",
  due: "Namaste {{party_name}} ({{party_code}}), your outstanding balance with {{shop_name}} is {{due}}. Please contact us if you need the statement.",
  payment: "Payment of {{paid}} received from {{party_name}} on {{payment_date}}. Remaining balance: {{due}}. Thank you — {{shop_name}}.",
  catalogue: "Sharing the latest {{shop_name}} price catalogue.",
};

export function safeJsonParse<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

export async function readJsonMeta<T>(key: string, fallback: T): Promise<T> {
  return safeJsonParse((await db.meta.get(key))?.value, fallback);
}

export async function writeJsonMeta<T>(key: string, value: T) {
  await db.meta.put({ key, value: JSON.stringify(value) });
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

function sha256Bytes(message: Uint8Array) {
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = paddedView.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const low = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const high = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + low + words[index - 7] + high) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  const output = new Uint8Array(32);
  const view = new DataView(output.buffer);
  state.forEach((value, index) => view.setUint32(index * 4, value, false));
  return output;
}

function concatBytes(...chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function hmacSha256(keyInput: Uint8Array, message: Uint8Array) {
  const key = new Uint8Array(64);
  key.set(keyInput.length > 64 ? sha256Bytes(keyInput) : keyInput);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let index = 0; index < 64; index += 1) { inner[index] = key[index] ^ 0x36; outer[index] = key[index] ^ 0x5c; }
  return sha256Bytes(concatBytes(outer, sha256Bytes(concatBytes(inner, message))));
}

export function pbkdf2Sha256Fallback(password: string, salt: string, iterations: number) {
  const encoder = new TextEncoder();
  const key = encoder.encode(password);
  const block = new Uint8Array([0, 0, 0, 1]);
  let current = hmacSha256(key, concatBytes(encoder.encode(salt), block));
  const result = current.slice();
  for (let round = 1; round < iterations; round += 1) {
    current = hmacSha256(key, current);
    for (let index = 0; index < result.length; index += 1) result[index] ^= current[index];
  }
  return result;
}

export function validateOwnerPin(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("Owner PIN must contain 4 to 8 digits.");
}

export async function hashOwnerPin(pin: string, salt = "mantu-owner-v1", iterations = 120_000) {
  validateOwnerPin(pin);
  if (globalThis.crypto?.subtle) {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    return bytesToHex(await globalThis.crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations },
      key,
      256,
    ));
  }
  return Array.from(pbkdf2Sha256Fallback(pin, salt, iterations), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function setOwnerPin(pin: string) {
  validateOwnerPin(pin);
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random PIN storage is unavailable on this device.");
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const iterations = 120_000;
  const hash = await hashOwnerPin(pin, salt, iterations);
  await db.meta.put({ key: OWNER_PIN_META, value: JSON.stringify({ version: 1, salt, iterations, hash }) });
}

export async function ownerPinConfigured() {
  return Boolean((await db.meta.get(OWNER_PIN_META))?.value);
}

export async function verifyOwnerPin(pin: string) {
  const saved = safeJsonParse<{ salt?: string; iterations?: number; hash?: string }>(
    (await db.meta.get(OWNER_PIN_META))?.value,
    {},
  );
  if (!saved.salt || !saved.hash) return false;
  return saved.hash === await hashOwnerPin(pin, saved.salt, saved.iterations || 120_000);
}

export async function saveBillDraft(draft: Omit<BillDraft, "version" | "savedAt">) {
  const value: BillDraft = { ...draft, version: 1, savedAt: nowIso() };
  await writeJsonMeta(BILL_DRAFT_META, value);
  return value;
}

export async function loadBillDraft() {
  const draft = await readJsonMeta<BillDraft | null>(BILL_DRAFT_META, null);
  return draft?.version === 1 && Array.isArray(draft.lines) ? draft : null;
}

export async function clearBillDraft() { await db.meta.delete(BILL_DRAFT_META); }

export function normalizeWorkspace(input?: Partial<WorkspacePreferences> | null): WorkspacePreferences {
  const valid = new Set(defaultWorkspace.order);
  const order = [...new Set((input?.order || []).filter((tab): tab is WorkspaceTab => valid.has(tab)))];
  for (const tab of defaultWorkspace.order) if (!order.includes(tab)) order.push(tab);
  const hidden = [...new Set((input?.hidden || []).filter((tab): tab is WorkspaceTab => valid.has(tab) && tab !== "bill" && tab !== "more"))];
  const startTab = valid.has(input?.startTab as WorkspaceTab) && !hidden.includes(input?.startTab as WorkspaceTab)
    ? input!.startTab as WorkspaceTab
    : "bill";
  return { order, hidden, startTab };
}

export function quantityPresets(unit: Unit) {
  if (unit === "piece") return [1, 2, 5, 10, 12, 24, 144];
  if (unit === "dozen") return [0.5, 1, 2, 5, 6, 12];
  if (unit === "gross") return [0.5, 1, 2, 5];
  return [1, 2, 5, 10];
}

export function variantFamily(item: Item) {
  const tag = item.festivalTags.find((value) => value.startsWith("family:"));
  return tag?.slice(7).trim() || item.name.replace(/\b(red|gold|green|silver|pink|blue|white|orange|black|yellow|\d+\s*(inch|in|ft))\b/gi, "").replace(/\s+/g, " ").trim() || "Other";
}

export function withVariantFamily(tags: string[], family: string) {
  const clean = tags.filter((value) => !value.startsWith("family:"));
  return family.trim() ? [...clean, `family:${family.trim()}`] : clean;
}

const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]/g, "");
export function partyDuplicateCandidates(candidate: Pick<Party, "id" | "name" | "phone" | "codeName">, parties: Party[]) {
  const name = normal(candidate.name);
  const phone = candidate.phone.replace(/\D/g, "");
  return parties.filter((party) => party.id !== candidate.id && !party.tags.some((tag) => tag.startsWith("mergedInto:")) && (
    (name.length > 3 && normal(party.name) === name) ||
    (phone.length >= 8 && party.phone.replace(/\D/g, "") === phone) ||
    (candidate.codeName && party.codeName.toLowerCase() === candidate.codeName.toLowerCase())
  ));
}

export function itemDuplicateCandidates(candidate: Pick<Item, "id" | "name" | "skuCode">, items: Item[]) {
  const name = normal(candidate.name);
  return items.filter((item) => item.id !== candidate.id && item.isActive && (
    (name.length > 3 && normal(item.name) === name) ||
    (candidate.skuCode && item.skuCode.toLowerCase() === candidate.skuCode.toLowerCase())
  ));
}

export async function logActivity(input: Omit<ActivityLog, "id" | "createdAt" | "metadata"> & { metadata?: Record<string, unknown> }) {
  const row: ActivityLog = {
    ...input,
    id: makeId(),
    metadata: JSON.stringify(input.metadata || {}),
    createdAt: nowIso(),
  };
  await db.activityLogs.add(row);
  return row;
}

export async function mergeParties(sourceId: string, targetId: string, actor: ActivityLog["actor"] = "owner") {
  if (sourceId === targetId) throw new Error("Choose two different parties.");
  return db.transaction("rw", [db.parties, db.invoices, db.payments, db.accountEntries, db.partyItemPrices, db.activityLogs], async () => {
    const [source, target] = await Promise.all([db.parties.get(sourceId), db.parties.get(targetId)]);
    if (!source || !target) throw new Error("Party could not be found.");
    if (source.type !== target.type) throw new Error("Customers and suppliers cannot be merged together.");
    const stamp = nowIso();
    const sourcePrices = await db.partyItemPrices.where("partyId").equals(sourceId).toArray();
    for (const price of sourcePrices) {
      const targetKey = `${targetId}::${price.itemId}`;
      const existing = await db.partyItemPrices.get(targetKey);
      const keepSource = !existing || (price.lockedPrice && !existing.lockedPrice) || (!existing.lockedPrice && price.updatedAt > existing.updatedAt);
      if (keepSource) await db.partyItemPrices.put({ ...price, id: targetKey, partyId: targetId, updatedAt: stamp, isSynced: false });
      await db.partyItemPrices.delete(price.id);
    }
    for (const invoice of await db.invoices.where("partyId").equals(sourceId).toArray()) await db.invoices.update(invoice.id, { partyId: targetId, updatedAt: stamp, isSynced: false });
    for (const payment of await db.payments.where("partyId").equals(sourceId).toArray()) await db.payments.update(payment.id, { partyId: targetId, updatedAt: stamp, isSynced: false });
    for (const entry of await db.accountEntries.where("partyId").equals(sourceId).toArray()) await db.accountEntries.update(entry.id, { partyId: targetId, updatedAt: stamp, isSynced: false });
    await db.parties.update(targetId, { currentBalance: roundMoney(target.currentBalance + source.currentBalance), openingBalance: roundMoney(target.openingBalance + source.openingBalance), updatedAt: stamp, isSynced: false });
    await db.parties.update(sourceId, { currentBalance: 0, openingBalance: 0, tags: [...source.tags.filter((tag) => !tag.startsWith("mergedInto:")), `mergedInto:${targetId}`], notes: `${source.notes}${source.notes ? "\n" : ""}Merged into ${target.name} (${target.codeName})`, updatedAt: stamp, isSynced: false });
    await logActivity({ action: "party.merge", entityType: "party", entityId: targetId, description: `Merged ${source.name} into ${target.name}`, actor, metadata: { sourceId } });
    return targetId;
  });
}

export async function mergeItems(sourceId: string, targetId: string, actor: ActivityLog["actor"] = "owner") {
  if (sourceId === targetId) throw new Error("Choose two different products.");
  return db.transaction("rw", [db.items, db.partyItemPrices, db.activityLogs], async () => {
    const [source, target] = await Promise.all([db.items.get(sourceId), db.items.get(targetId)]);
    if (!source || !target) throw new Error("Product could not be found.");
    if (source.baseUnit !== target.baseUnit) throw new Error("Products with different base units cannot be merged.");
    const stamp = nowIso();
    for (const price of await db.partyItemPrices.where("itemId").equals(sourceId).toArray()) {
      const targetKey = `${price.partyId}::${targetId}`;
      const existing = await db.partyItemPrices.get(targetKey);
      const keepSource = !existing || (price.lockedPrice && !existing.lockedPrice) || (!existing.lockedPrice && price.updatedAt > existing.updatedAt);
      if (keepSource) await db.partyItemPrices.put({ ...price, id: targetKey, itemId: targetId, updatedAt: stamp, isSynced: false });
      await db.partyItemPrices.delete(price.id);
    }
    const stock = source.currentStock == null && target.currentStock == null
      ? null
      : roundMoney((source.currentStock || 0) + (target.currentStock || 0));
    await db.items.update(targetId, { currentStock: stock, saleCount: target.saleCount + source.saleCount, updatedAt: stamp, isSynced: false });
    await db.items.update(sourceId, { isActive: false, festivalTags: [...source.festivalTags.filter((tag) => !tag.startsWith("aliasOf:")), `aliasOf:${targetId}`], updatedAt: stamp, isSynced: false });
    await logActivity({ action: "item.merge", entityType: "item", entityId: targetId, description: `Merged ${source.name} into ${target.name}`, actor, metadata: { sourceId } });
    return targetId;
  });
}

export function renderMessageTemplate(template: string, values: Record<string, string | number | undefined>) {
  return template.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key: string) => values[key] == null ? "" : String(values[key]));
}

export interface DailyCashSummary {
  date: string;
  sales: number;
  invoiceCash: number;
  customerCash: number;
  supplierCash: number;
  expensesCash: number;
  upiIn: number;
  bankIn: number;
  expectedCash: number;
}

export function dailyCashSummary(date: string, invoices: Invoice[], payments: Payment[], expenses: Expense[], openingCash = 0, parties: Party[] = []): DailyCashSummary {
  const partyType = new Map(parties.map((party) => [party.id, party.type]));
  const sales = invoices.filter((x) => x.type === "sale" && !x.deletedAt && x.date === date).reduce((sum, x) => sum + x.grandTotal, 0);
  const invoiceCash = invoices.filter((x) => x.type === "sale" && !x.deletedAt && x.date === date && x.paymentReceivedMode === "cash").reduce((sum, x) => sum + x.amountPaid, 0);
  const customerCash = payments.filter((x) => x.date === date && x.mode === "cash" && partyType.get(x.partyId) !== "supplier").reduce((sum, x) => sum + x.amount, 0);
  const supplierCash = payments.filter((x) => x.date === date && x.mode === "cash" && partyType.get(x.partyId) === "supplier").reduce((sum, x) => sum + x.amount, 0);
  const expensesCash = expenses.filter((x) => x.date === date && !x.deletedAt && x.paymentMode === "cash").reduce((sum, x) => sum + x.amount, 0);
  const upiIn = invoices.filter((x) => x.type === "sale" && !x.deletedAt && x.date === date && x.paymentReceivedMode === "upi").reduce((sum, x) => sum + x.amountPaid, 0) + payments.filter((x) => x.date === date && x.mode === "upi" && partyType.get(x.partyId) !== "supplier").reduce((sum, x) => sum + x.amount, 0);
  const bankIn = invoices.filter((x) => x.type === "sale" && !x.deletedAt && x.date === date && x.paymentReceivedMode === "bank").reduce((sum, x) => sum + x.amountPaid, 0) + payments.filter((x) => x.date === date && x.mode === "bank" && partyType.get(x.partyId) !== "supplier").reduce((sum, x) => sum + x.amount, 0);
  return { date, sales: roundMoney(sales), invoiceCash: roundMoney(invoiceCash), customerCash: roundMoney(customerCash), supplierCash, expensesCash: roundMoney(expensesCash), upiIn: roundMoney(upiIn), bankIn: roundMoney(bankIn), expectedCash: roundMoney(openingCash + invoiceCash + customerCash - supplierCash - expensesCash) };
}

export async function saveDailyClose(input: Omit<DailyClose, "id" | "closedAt" | "updatedAt" | "discrepancy">) {
  const existing = await db.dailyCloses.get(`close:${input.date}`);
  const stamp = nowIso();
  const row: DailyClose = {
    ...input,
    id: `close:${input.date}`,
    discrepancy: roundMoney(input.countedCash - input.expectedCash),
    closedAt: existing?.closedAt || stamp,
    updatedAt: stamp,
  };
  await db.dailyCloses.put(row);
  await logActivity({ action: existing ? "daily-close.update" : "daily-close.create", entityType: "settings", entityId: row.id, description: `Closed counter for ${input.date}`, actor: "owner", metadata: { discrepancy: row.discrepancy } });
  return row;
}
