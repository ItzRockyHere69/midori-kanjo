import {
  db,
  isValidLocalDate,
  localDate,
  makeId,
  nowIso,
  type AccountEntry,
  type ActivityLog,
  type Invoice,
  type Language,
  type Party,
  type Payment,
  type PriceTier,
} from "./db";
import {
  normalizePartyCode,
  normalizePartyIdentity,
  normalizePhoneDigits,
  roundMoney,
} from "./billing";
import type { BusinessSettings } from "./pdf";
import {
  normalizePdfLanguage,
  pdfDateTime,
  pdfMoney,
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";
import { shareNativeBlob } from "./native-files";
import { sha256Hex } from "./qol";

export const DUES_BACKUP_FORMAT = "midori-kanjo-dues-backup" as const;
export const DUES_BACKUP_VERSION = 1 as const;
export const DUES_BACKUP_MARKER = "MKDUES1";
export const DUES_BACKUP_NAMESPACE = "https://midori-kanjo.local/dues-backup/1#";
export const MAX_DUES_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_DUES_BACKUP_RECORDS = 10_000;
const DUES_BACKUP_SOURCE_META = "dues-backup-source-id";
const IMPORTED_DUE_NOTE = "Imported outstanding due backup";
const APP_VERSION = "0.1.2+";
const priceTiers = ["retail", "wholesale", "bulk", "special"] as const;

export type DuesBackupRecord = {
  recordId: string;
  sourcePartyId: string;
  name: string;
  codeName: string;
  phone: string;
  address: string;
  gstin: string;
  priceTier: PriceTier;
  remainingPaise: number;
};

export type DuesBackupPayload = {
  format: typeof DUES_BACKUP_FORMAT;
  version: typeof DUES_BACKUP_VERSION;
  backupId: string;
  exportedAt: string;
  snapshotDate: string;
  currency: "INR";
  source: {
    datasetId: string;
    businessName: string;
    businessAddress: string;
    businessPhone: string;
    businessGstin: string;
    appVersion: string;
  };
  recordCount: number;
  totalPaise: number;
  customers: DuesBackupRecord[];
};

export type DuesBackupEnvelope = {
  payload: DuesBackupPayload;
  checksum: string;
};

export type DuesRestoreStatus =
  | "ready_new"
  | "ready_existing"
  | "already_restored"
  | "already_present"
  | "conflict";

export type DuesRestoreReason =
  | "new_customer"
  | "matched_empty_customer"
  | "same_import_entry"
  | "same_balance_present"
  | "different_import_amount"
  | "existing_balance"
  | "existing_history"
  | "ambiguous_identity"
  | "supplier_collision"
  | "identity_collision"
  | "duplicate_destination";

export type DuesRestorePreviewRow = {
  record: DuesBackupRecord;
  status: DuesRestoreStatus;
  reason: DuesRestoreReason;
  destinationPartyId?: string;
  destinationPartyName?: string;
  currentPaise: number;
};

export type DuesRestorePreview = {
  envelope: DuesBackupEnvelope;
  rows: DuesRestorePreviewRow[];
  readyCount: number;
  readyPaise: number;
  newCount: number;
  matchedCount: number;
  alreadyCount: number;
  conflictCount: number;
};

export type DuesRestoreResult = {
  importedCount: number;
  importedPaise: number;
  createdCustomers: number;
  matchedCustomers: number;
  alreadyCount: number;
};

export type DuesBackupErrorCode =
  | "file_too_large"
  | "not_backup"
  | "duplicate_payload"
  | "invalid_payload"
  | "unsupported_version"
  | "wrong_currency"
  | "checksum_mismatch"
  | "conflict";

export class DuesBackupError extends Error {
  constructor(
    public readonly code: DuesBackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DuesBackupError";
  }
}

const asSingleLine = (value: unknown, max: number) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const paiseFromMoney = (value: number) => Math.round(roundMoney(value) * 100);
export const moneyFromPaise = (value: number) => roundMoney(value / 100);

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new DuesBackupError("invalid_payload", "The restore payload is not valid base64url data.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new DuesBackupError("invalid_payload", "The restore payload could not be decoded.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const canonicalPayload = (payload: DuesBackupPayload) => JSON.stringify(payload);
const markerForEnvelope = (envelope: DuesBackupEnvelope) =>
  `${DUES_BACKUP_MARKER}.${envelope.checksum}.${bytesToBase64Url(new TextEncoder().encode(canonicalPayload(envelope.payload)))}`;

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export function assertDuesBackupExportBudget(
  envelope: DuesBackupEnvelope,
  humanBytes = 0,
) {
  const payloadBytes = utf8ByteLength(canonicalPayload(envelope.payload));
  const encodedPayloadBytes = Math.ceil(payloadBytes / 3) * 4;
  const markerBytes = DUES_BACKUP_MARKER.length + 1 + 64 + 1 + encodedPayloadBytes;
  // Reserve 1 MiB for PDF objects/fonts and count visible text twice. The final
  // Blob is checked exactly too; this conservative pass prevents costly PDF
  // allocation when the result is already certain to exceed the import limit.
  const conservativeBytes = markerBytes + 1024 * 1024 + Math.max(0, humanBytes) * 2;
  if (conservativeBytes > MAX_DUES_BACKUP_BYTES)
    throw new DuesBackupError("file_too_large", "The generated backup is larger than 10 MiB and cannot be restored safely.");
}

export function appendDuesBackupTextPayload(
  humanText: string,
  envelope: DuesBackupEnvelope,
) {
  return `${humanText.trimEnd()}\r\n\r\n----- MIDORI KANJO RESTORE DATA -----\r\n${markerForEnvelope(envelope)}\r\n----- END MIDORI KANJO RESTORE DATA -----\r\n`;
}

export function addDuesBackupPdfMetadata(
  doc: { addMetadata: (metadata: string, namespaceUri?: string) => unknown },
  envelope: DuesBackupEnvelope,
) {
  doc.addMetadata(markerForEnvelope(envelope), DUES_BACKUP_NAMESPACE);
}

async function sourceDatasetId() {
  return db.transaction("rw", db.meta, async () => {
    const existing = await db.meta.get(DUES_BACKUP_SOURCE_META);
    if (typeof existing?.value === "string" && existing.value.trim())
      return existing.value;
    const created = makeId();
    await db.meta.put({ key: DUES_BACKUP_SOURCE_META, value: created });
    return created;
  });
}

function recordId(datasetId: string, sourcePartyId: string) {
  return sha256Hex(`midori-kanjo:dues-record:v1\u0000${datasetId}\u0000${sourcePartyId}`);
}

export async function createDuesBackupEnvelope(
  parties: Party[],
  business: BusinessSettings,
  exportedAt = nowIso(),
) {
  const datasetId = await sourceDatasetId();
  const customers: DuesBackupRecord[] = parties
    .filter((party) => party.type === "customer" && party.currentBalance >= 0.01)
    .map((party) => ({
      recordId: recordId(datasetId, party.id),
      sourcePartyId: party.id,
      name: asSingleLine(party.name, 200),
      codeName: asSingleLine(party.codeName, 80),
      phone: asSingleLine(party.phone, 40),
      address: asSingleLine(party.address, 500),
      gstin: asSingleLine(party.gstin, 40).toUpperCase(),
      priceTier: party.priceTier,
      remainingPaise: paiseFromMoney(party.currentBalance),
    }))
    .filter((record) => record.remainingPaise > 0)
    .sort((left, right) =>
      normalizePartyIdentity(left.name).localeCompare(normalizePartyIdentity(right.name)) ||
      left.codeName.localeCompare(right.codeName) ||
      left.sourcePartyId.localeCompare(right.sourcePartyId),
    );
  if (customers.length > MAX_DUES_BACKUP_RECORDS)
    throw new DuesBackupError("invalid_payload", `A due backup can contain at most ${MAX_DUES_BACKUP_RECORDS} customers.`);
  if (customers.some((record) => !Number.isSafeInteger(record.remainingPaise)))
    throw new DuesBackupError("invalid_payload", "A customer balance is too large to export safely.");
  const totalPaise = customers.reduce((sum, record) => sum + record.remainingPaise, 0);
  if (!Number.isSafeInteger(totalPaise))
    throw new DuesBackupError("invalid_payload", "The total outstanding balance is too large to export safely.");
  const source = {
    datasetId,
    businessName: asSingleLine(business.name || "Burrabazar Festival Decor", 200),
    businessAddress: asSingleLine(business.address, 500),
    businessPhone: asSingleLine(business.phone, 40),
    businessGstin: asSingleLine(business.gstin, 40).toUpperCase(),
    appVersion: APP_VERSION,
  };
  const backupId = sha256Hex(JSON.stringify({
    format: DUES_BACKUP_FORMAT,
    version: DUES_BACKUP_VERSION,
    datasetId,
    customers,
  }));
  const payload: DuesBackupPayload = {
    format: DUES_BACKUP_FORMAT,
    version: DUES_BACKUP_VERSION,
    backupId,
    exportedAt,
    snapshotDate: localDate(),
    currency: "INR",
    source,
    recordCount: customers.length,
    totalPaise,
    customers,
  };
  return { payload, checksum: sha256Hex(canonicalPayload(payload)) } satisfies DuesBackupEnvelope;
}

function visibleCell(value: string) {
  const clean = value.replace(/[\t\r\n]+/g, " ").replaceAll(`${DUES_BACKUP_MARKER}.`, `${DUES_BACKUP_MARKER} .`).trim();
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
}

type BackupCopy = {
  title: string;
  subtitle: string;
  generated: string;
  source: string;
  customers: string;
  total: string;
  name: string;
  code: string;
  phone: string;
  remaining: string;
  noDues: string;
  restoreHelp: string;
  privacy: string;
  dialog: string;
  shareText: (count: number, total: string) => string;
  page: (page: number, pages: number) => string;
};

const backupCopy: Record<Language, BackupCopy> = {
  en: {
    title: "OUTSTANDING DUES BACKUP", subtitle: "Portable customer balance snapshot",
    generated: "Generated", source: "Source business", customers: "Customers",
    total: "Total remaining due", name: "Customer / party", code: "Code", phone: "Phone",
    remaining: "Remaining due", noDues: "No customer has an outstanding balance in this snapshot.",
    restoreHelp: "Restore from Dues > Backup & restore. This recreates brought-forward balances, not old invoices or payment history.",
    privacy: "Private: contains customer contact details and debt balances.",
    dialog: "Save or share outstanding dues backup",
    shareText: (count, total) => `Outstanding dues backup: ${count} customers, ${total}`,
    page: (page, pages) => `Page ${page} of ${pages}`,
  },
  hi: {
    title: "बाकी रकम का बैकअप", subtitle: "कस्टमर बैलेंस का पोर्टेबल स्नैपशॉट",
    generated: "बनाने की तारीख", source: "सोर्स बिज़नेस", customers: "कस्टमर",
    total: "कुल बाकी", name: "कस्टमर / पार्टी", code: "कोड", phone: "फोन",
    remaining: "बाकी रकम", noDues: "इस स्नैपशॉट में किसी कस्टमर की रकम बाकी नहीं है।",
    restoreHelp: "Dues > Backup & restore से वापस लाएँ। इससे शुरुआती बाकी बनती है, पुराने बिल या पेमेंट हिस्ट्री नहीं।",
    privacy: "निजी: इसमें कस्टमर की संपर्क जानकारी और बाकी रकम है।",
    dialog: "बाकी रकम का बैकअप सेव या शेयर करें",
    shareText: (count, total) => `बाकी बैकअप: ${count} कस्टमर, ${total}`,
    page: (page, pages) => `पेज ${page} / ${pages}`,
  },
  bn: {
    title: "বাকি টাকার ব্যাকআপ", subtitle: "ক্রেতার ব্যালেন্সের বহনযোগ্য স্ন্যাপশট",
    generated: "তৈরির তারিখ", source: "উৎস ব্যবসা", customers: "ক্রেতা",
    total: "মোট বাকি", name: "ক্রেতা / পার্টি", code: "কোড", phone: "ফোন",
    remaining: "বাকি টাকা", noDues: "এই স্ন্যাপশটে কোনো ক্রেতার টাকা বাকি নেই।",
    restoreHelp: "Dues > Backup & restore থেকে ফিরিয়ে আনুন। এতে শুরুর বাকি তৈরি হয়, পুরোনো বিল বা পেমেন্ট ইতিহাস নয়।",
    privacy: "ব্যক্তিগত: এতে ক্রেতার যোগাযোগের তথ্য ও বাকি টাকার হিসাব আছে।",
    dialog: "বাকি টাকার ব্যাকআপ সেভ বা শেয়ার করুন",
    shareText: (count, total) => `বাকি ব্যাকআপ: ${count} ক্রেতা, ${total}`,
    page: (page, pages) => `পৃষ্ঠা ${page} / ${pages}`,
  },
};

function duesBackupHumanText(
  envelope: DuesBackupEnvelope,
  language: Language,
) {
  const active = normalizePdfLanguage(language);
  const copy = backupCopy[active];
  const { payload } = envelope;
  return [
    "MIDORI KANJO",
    copy.title,
    copy.subtitle,
    `${copy.generated}\t${pdfDateTime(new Date(payload.exportedAt), active)}`,
    `${copy.source}\t${visibleCell(payload.source.businessName)}`,
    `${copy.customers}\t${payload.recordCount}`,
    `${copy.total}\t${pdfMoney(moneyFromPaise(payload.totalPaise), active)}`,
    "",
    [copy.name, copy.code, copy.phone, copy.remaining].join("\t"),
    ...payload.customers.map((record) => [
      visibleCell(record.name),
      visibleCell(record.codeName),
      visibleCell(record.phone),
      pdfMoney(moneyFromPaise(record.remainingPaise), active),
    ].join("\t")),
    ...(!payload.customers.length ? [copy.noDues] : []),
    "",
    copy.restoreHelp,
    copy.privacy,
  ].join("\r\n");
}

export function duesBackupText(
  envelope: DuesBackupEnvelope,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const human = duesBackupHumanText(envelope, active);
  assertDuesBackupExportBudget(envelope, utf8ByteLength(human));
  return appendDuesBackupTextPayload(human, envelope);
}

export async function createDuesBackupPdf(
  envelope: DuesBackupEnvelope,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = backupCopy[active];
  const { payload } = envelope;
  const human = duesBackupHumanText(envelope, active);
  assertDuesBackupExportBudget(envelope, utf8ByteLength(human));
  const { jsPDF } = await import("jspdf");
  const doc = await registerPdfFont(new jsPDF({
    unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true,
  }));
  addDuesBackupPdfMetadata(doc, envelope);
  doc.setProperties({
    title: copy.title,
    subject: copy.subtitle,
    author: payload.source.businessName || "Midori Kanjo",
    creator: "Midori Kanjo",
    keywords: "Midori Kanjo, outstanding dues, backup, restore",
  });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const forest: [number, number, number] = [1, 73, 33];
  const accent: [number, number, number] = [48, 157, 75];
  const pale: [number, number, number] = [249, 249, 249];
  const ink: [number, number, number] = [33, 31, 29];
  const muted: [number, number, number] = [97, 95, 92];
  const border: [number, number, number] = [226, 226, 219];
  let y = margin;

  const header = () => {
    y = margin;
    doc.setFillColor(...forest);
    doc.roundedRect(margin, y, contentWidth, 32, 2.5, 2.5, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(11.5);
    doc.text(payload.source.businessName || "Midori Kanjo", margin + 5, y + 8, { maxWidth: contentWidth * 0.5, lineHeightFactor: 1.05 });
    setPdfFont(doc);
    doc.setFontSize(6.5);
    doc.text(payload.source.businessAddress || "Burrabazar, Kolkata", margin + 5, y + 21, { maxWidth: contentWidth * 0.5 });
    doc.text(payload.source.businessPhone || "", margin + 5, y + 27, { maxWidth: contentWidth * 0.5 });
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 10.5 : 9);
    doc.text(copy.title, right - 5, y + 10, { align: "right", maxWidth: contentWidth * 0.45 });
    setPdfFont(doc);
    doc.setFontSize(6.5);
    doc.text(copy.subtitle, right - 5, y + 17, { align: "right", maxWidth: contentWidth * 0.45 });
    doc.text(`${copy.generated}: ${pdfDateTime(new Date(payload.exportedAt), active)}`, right - 5, y + 24, { align: "right", maxWidth: contentWidth * 0.45 });
    y += 38;
  };

  const tableHeader = () => {
    doc.setFillColor(...forest);
    doc.rect(margin, y, contentWidth, 9, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 6.2 : 5.6);
    doc.text(copy.name.toUpperCase(), margin + 3, y + 5.8, { maxWidth: 80 });
    doc.text(copy.code.toUpperCase(), margin + 92, y + 5.8, { maxWidth: 36 });
    doc.text(copy.phone.toUpperCase(), margin + 132, y + 5.8, { maxWidth: 28 });
    doc.text(copy.remaining.toUpperCase(), right - 2, y + 5.8, { align: "right", maxWidth: 31 });
    y += 9;
  };

  header();
  const cardGap = 4;
  const cardWidth = (contentWidth - cardGap) / 2;
  [
    { label: copy.customers, value: String(payload.recordCount), color: ink },
    { label: copy.total, value: pdfMoney(moneyFromPaise(payload.totalPaise), active), color: accent },
  ].forEach((card, index) => {
    const x = margin + index * (cardWidth + cardGap);
    doc.setFillColor(...pale);
    doc.setDrawColor(...border);
    doc.roundedRect(x, y, cardWidth, 22, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...muted);
    doc.text(card.label.toUpperCase(), x + 4, y + 7, { maxWidth: cardWidth - 8 });
    doc.setFontSize(12);
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 4, y + 17, { maxWidth: cardWidth - 8 });
  });
  y += 29;
  tableHeader();

  if (!payload.customers.length) {
    setPdfFont(doc);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(copy.noDues, margin + 3, y + 9, { maxWidth: contentWidth - 6 });
    y += 17;
  }

  payload.customers.forEach((record, index) => {
    const rowHeight = 11;
    if (y + rowHeight > height - 24) {
      doc.addPage();
      header();
      tableHeader();
    }
    if (index % 2) {
      doc.setFillColor(...pale);
      doc.rect(margin, y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...border);
    doc.line(margin, y + rowHeight, right, y + rowHeight);
    doc.setTextColor(...ink);
    setPdfFont(doc, "bold");
    doc.setFontSize(6.5);
    doc.text(record.name, margin + 3, y + 4.7, { maxWidth: 84 });
    setPdfFont(doc);
    doc.setFontSize(5.5);
    if (record.address) doc.text(record.address, margin + 3, y + 8.5, { maxWidth: 84 });
    doc.text(record.codeName || "-", margin + 92, y + 5.5, { maxWidth: 36 });
    doc.text(record.phone || "-", margin + 132, y + 5.5, { maxWidth: 28 });
    setPdfFont(doc, "bold");
    doc.setTextColor(...forest);
    doc.setFontSize(6.7);
    doc.text(pdfMoney(moneyFromPaise(record.remainingPaise), active), right - 2, y + 5.5, { align: "right", maxWidth: 31 });
    y += rowHeight;
  });

  if (y + 24 > height - 9) {
    doc.addPage();
    header();
  }
  doc.setFillColor(...pale);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y + 4, contentWidth, 20, 1.5, 1.5, "FD");
  setPdfFont(doc, "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...forest);
  doc.text(copy.restoreHelp, margin + 4, y + 10, { maxWidth: contentWidth - 8 });
  setPdfFont(doc);
  doc.setTextColor(...muted);
  doc.text(copy.privacy, margin + 4, y + 18, { maxWidth: contentWidth - 8 });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...border);
    doc.line(margin, height - 8, right, height - 8);
    setPdfFont(doc);
    doc.setFontSize(6);
    doc.setTextColor(...muted);
    doc.text("Midori Kanjo | Outstanding dues backup", margin, height - 4.5);
    doc.text(copy.page(page, pages), right, height - 4.5, { align: "right" });
  }
  return doc;
}

export function assertDuesBackupBlobSize(blob: Pick<Blob, "size">) {
  if (blob.size > MAX_DUES_BACKUP_BYTES)
    throw new DuesBackupError("file_too_large", "The generated backup is larger than 10 MiB and cannot be restored safely.");
}

async function shareOrDownloadBackup(
  blob: Blob,
  fileName: string,
  copy: BackupCopy,
  envelope: DuesBackupEnvelope,
) {
  // This exact final-byte check is deliberately shared with the import limit:
  // the app must never save/share a backup that it would later reject itself.
  assertDuesBackupBlobSize(blob);
  const title = copy.title;
  const text = copy.shareText(
    envelope.payload.recordCount,
    pdfMoney(moneyFromPaise(envelope.payload.totalPaise), "en"),
  );
  if (await shareNativeBlob(blob, { fileName, title, text, dialogTitle: copy.dialog }))
    return "shared" as const;
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

export async function downloadDuesBackup(
  format: "pdf" | "text",
  parties: Party[],
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = backupCopy[active];
  const envelope = await createDuesBackupEnvelope(parties, business);
  const datePart = envelope.payload.snapshotDate;
  if (format === "pdf") {
    const doc = await createDuesBackupPdf(envelope, active);
    return shareOrDownloadBackup(
      doc.output("blob"),
      `Midori-Kanjo-outstanding-dues-backup-${datePart}.pdf`,
      copy,
      envelope,
    );
  }
  const content = `\uFEFF${duesBackupText(envelope, active)}`;
  return shareOrDownloadBackup(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
    `Midori-Kanjo-outstanding-dues-backup-${datePart}.txt`,
    copy,
    envelope,
  );
}

function extractMarker(text: string) {
  const pattern = new RegExp(`${DUES_BACKUP_MARKER}\\.([a-f0-9]{64})\\.([A-Za-z0-9_-]+)`, "g");
  const matches = [...text.matchAll(pattern)];
  if (!matches.length)
    throw new DuesBackupError("not_backup", "Only a Midori Kanjo dues backup PDF or text file can be restored.");
  if (matches.length !== 1)
    throw new DuesBackupError("duplicate_payload", "The file contains more than one restore payload.");
  return { checksum: matches[0][1], encoded: matches[0][2] };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DuesBackupError("invalid_payload", "The backup payload is not an object.");
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, max: number, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new DuesBackupError("invalid_payload", `Invalid ${field}.`);
  return value;
}

function requireSafeInteger(value: unknown, field: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new DuesBackupError("invalid_payload", `Invalid ${field}.`);
  return Number(value);
}

function validatePayload(value: unknown): DuesBackupPayload {
  const payload = requireObject(value);
  if (payload.format !== DUES_BACKUP_FORMAT)
    throw new DuesBackupError("not_backup", "This file is not a Midori Kanjo dues backup.");
  if (payload.version !== DUES_BACKUP_VERSION)
    throw new DuesBackupError("unsupported_version", "This backup version is not supported by the installed app.");
  if (payload.currency !== "INR")
    throw new DuesBackupError("wrong_currency", "Only INR dues backups can be restored.");
  const backupId = requireString(payload.backupId, "backup ID", 64);
  if (!/^[a-f0-9]{64}$/.test(backupId))
    throw new DuesBackupError("invalid_payload", "Invalid backup ID.");
  const exportedAt = requireString(payload.exportedAt, "export date", 40);
  if (!Number.isFinite(Date.parse(exportedAt)))
    throw new DuesBackupError("invalid_payload", "Invalid export date.");
  const snapshotDate = requireString(payload.snapshotDate, "snapshot date", 10);
  if (!isValidLocalDate(snapshotDate))
    throw new DuesBackupError("invalid_payload", "Invalid snapshot date.");
  const sourceRaw = requireObject(payload.source);
  const source = {
    datasetId: requireString(sourceRaw.datasetId, "source dataset ID", 200),
    businessName: requireString(sourceRaw.businessName, "business name", 200),
    businessAddress: requireString(sourceRaw.businessAddress, "business address", 500, true),
    businessPhone: requireString(sourceRaw.businessPhone, "business phone", 40, true),
    businessGstin: requireString(sourceRaw.businessGstin, "business GSTIN", 40, true),
    appVersion: requireString(sourceRaw.appVersion, "app version", 40),
  };
  const recordCount = requireSafeInteger(payload.recordCount, "record count");
  if (recordCount > MAX_DUES_BACKUP_RECORDS)
    throw new DuesBackupError("invalid_payload", "The backup contains too many customer records.");
  if (!Array.isArray(payload.customers) || payload.customers.length !== recordCount)
    throw new DuesBackupError("invalid_payload", "The customer count does not match the backup contents.");
  const seenPartyIds = new Set<string>();
  const seenRecordIds = new Set<string>();
  const customers = payload.customers.map((unknownRecord, index) => {
    const record = requireObject(unknownRecord);
    const sourcePartyId = requireString(record.sourcePartyId, `customer ${index + 1} source ID`, 200);
    const expectedRecordId = recordId(source.datasetId, sourcePartyId);
    const storedRecordId = requireString(record.recordId, `customer ${index + 1} record ID`, 64);
    if (storedRecordId !== expectedRecordId || !/^[a-f0-9]{64}$/.test(storedRecordId))
      throw new DuesBackupError("invalid_payload", `Customer ${index + 1} has an invalid record ID.`);
    if (seenPartyIds.has(sourcePartyId) || seenRecordIds.has(storedRecordId))
      throw new DuesBackupError("invalid_payload", "The backup contains a duplicate customer.");
    seenPartyIds.add(sourcePartyId);
    seenRecordIds.add(storedRecordId);
    const priceTier = requireString(record.priceTier, `customer ${index + 1} price tier`, 20) as PriceTier;
    if (!priceTiers.includes(priceTier))
      throw new DuesBackupError("invalid_payload", `Customer ${index + 1} has an invalid price tier.`);
    return {
      recordId: storedRecordId,
      sourcePartyId,
      name: requireString(record.name, `customer ${index + 1} name`, 200),
      codeName: requireString(record.codeName, `customer ${index + 1} code`, 80, true),
      phone: requireString(record.phone, `customer ${index + 1} phone`, 40, true),
      address: requireString(record.address, `customer ${index + 1} address`, 500, true),
      gstin: requireString(record.gstin, `customer ${index + 1} GSTIN`, 40, true),
      priceTier,
      remainingPaise: requireSafeInteger(record.remainingPaise, `customer ${index + 1} remaining due`, 1),
    } satisfies DuesBackupRecord;
  });
  const totalPaise = requireSafeInteger(payload.totalPaise, "backup total");
  if (customers.reduce((sum, record) => sum + record.remainingPaise, 0) !== totalPaise)
    throw new DuesBackupError("invalid_payload", "The customer balances do not match the backup total.");
  const expectedBackupId = sha256Hex(JSON.stringify({
    format: DUES_BACKUP_FORMAT,
    version: DUES_BACKUP_VERSION,
    datasetId: source.datasetId,
    customers,
  }));
  if (backupId !== expectedBackupId)
    throw new DuesBackupError("invalid_payload", "The backup ID does not match its customer records.");
  return {
    format: DUES_BACKUP_FORMAT,
    version: DUES_BACKUP_VERSION,
    backupId,
    exportedAt,
    snapshotDate,
    currency: "INR",
    source,
    recordCount,
    totalPaise,
    customers,
  };
}

export function parseDuesBackupBytes(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_DUES_BACKUP_BYTES)
    throw new DuesBackupError("file_too_large", "The selected backup is larger than 10 MiB.");
  const rawBytes = new TextDecoder("latin1").decode(bytes);
  const isPdf = rawBytes.startsWith("%PDF-");
  let raw = rawBytes;
  if (!isPdf) {
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DuesBackupError("not_backup", "Only a Midori Kanjo dues backup PDF or UTF-8 text file can be restored.");
    }
    if (
      raw.includes("\u0000") ||
      !raw.includes("----- MIDORI KANJO RESTORE DATA -----") ||
      !raw.includes("----- END MIDORI KANJO RESTORE DATA -----")
    ) {
      throw new DuesBackupError("not_backup", "Only a Midori Kanjo dues backup PDF or text file can be restored.");
    }
  } else if (!raw.includes("/Type /Metadata") || !raw.includes("/Subtype /XML")) {
    throw new DuesBackupError("not_backup", "This PDF does not contain Midori Kanjo restore metadata.");
  }
  const { checksum, encoded } = extractMarker(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded)));
  } catch (cause) {
    if (cause instanceof DuesBackupError) throw cause;
    throw new DuesBackupError("invalid_payload", "The restore payload is not valid UTF-8 JSON.");
  }
  const payload = validatePayload(parsed);
  const expectedChecksum = sha256Hex(canonicalPayload(payload));
  if (checksum !== expectedChecksum)
    throw new DuesBackupError("checksum_mismatch", "The backup checksum does not match. The file may be damaged or edited.");
  return { payload, checksum } satisfies DuesBackupEnvelope;
}

export async function parseDuesBackupFile(file: File) {
  if (file.size > MAX_DUES_BACKUP_BYTES)
    throw new DuesBackupError("file_too_large", "The selected backup is larger than 10 MiB.");
  return parseDuesBackupBytes(new Uint8Array(await file.arrayBuffer()));
}

const importedPartyId = (record: DuesBackupRecord) => `dues-party:${record.recordId}`;
export const importedDueEntryId = (record: DuesBackupRecord) => `dues-import:${record.recordId}`;
const importedDueReference = (payload: DuesBackupPayload, record: DuesBackupRecord) =>
  `${DUES_BACKUP_MARKER}|${payload.source.datasetId}|${record.sourcePartyId}|${payload.backupId}`;

const mergedDestinationId = (party: Party) =>
  party.tags.find((tag) => tag.startsWith("mergedInto:"))?.slice("mergedInto:".length).trim() || "";

function resolveActiveParty(party: Party, partiesById: Map<string, Party>) {
  const seen = new Set<string>();
  let current: Party | undefined = party;
  while (current) {
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    const destinationId = mergedDestinationId(current);
    if (!destinationId) return current;
    current = partiesById.get(destinationId);
  }
  return undefined;
}

const normalizeGstin = (value?: string) =>
  String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function identityEvidence(party: Party, record: DuesBackupRecord) {
  const partyName = normalizePartyIdentity(party.name);
  const recordName = normalizePartyIdentity(record.name);
  const partyCode = normalizePartyCode(party.codeName);
  const recordCode = normalizePartyCode(record.codeName);
  const partyPhone = normalizePhoneDigits(party.phone);
  const recordPhone = normalizePhoneDigits(record.phone);
  const partyGstin = normalizeGstin(party.gstin);
  const recordGstin = normalizeGstin(record.gstin);
  const partyAddress = normalizePartyIdentity(party.address);
  const recordAddress = normalizePartyIdentity(record.address);
  return {
    name: Boolean(partyName && recordName && partyName === recordName),
    code: Boolean(partyCode && recordCode && partyCode === recordCode),
    phone: Boolean(partyPhone.length >= 8 && recordPhone.length >= 8 && partyPhone === recordPhone),
    gstin: Boolean(partyGstin && recordGstin && partyGstin === recordGstin),
    address: Boolean(partyAddress && recordAddress && partyAddress === recordAddress),
    codeConflict: Boolean(partyCode && recordCode && partyCode !== recordCode),
    phoneConflict: Boolean(partyPhone.length >= 8 && recordPhone.length >= 8 && partyPhone !== recordPhone),
    gstinConflict: Boolean(partyGstin && recordGstin && partyGstin !== recordGstin),
  };
}

function compatibleDirectIdentity(party: Party, record: DuesBackupRecord) {
  const evidence = identityEvidence(party, record);
  if (evidence.gstinConflict) return false;
  return evidence.name || [evidence.code, evidence.phone, evidence.gstin, evidence.address].filter(Boolean).length >= 2;
}

function compatibleAutomaticIdentity(party: Party, record: DuesBackupRecord) {
  const evidence = identityEvidence(party, record);
  // A unique code, phone or GSTIN is only a candidate finder. We still require
  // the customer name to agree and reject contradictory supplied identifiers.
  return evidence.name && !evidence.codeConflict && !evidence.phoneConflict && !evidence.gstinConflict;
}

type ResolvedIdentityCandidate = {
  party: Party;
  sources: Party[];
};

type PartyIdentityIndexes = {
  code: Map<string, Map<string, ResolvedIdentityCandidate>>;
  phone: Map<string, Map<string, ResolvedIdentityCandidate>>;
  gstin: Map<string, Map<string, ResolvedIdentityCandidate>>;
  nameAddress: Map<string, Map<string, ResolvedIdentityCandidate>>;
};

function addIdentityCandidate(
  index: Map<string, Map<string, ResolvedIdentityCandidate>>,
  key: string,
  source: Party,
  destination: Party,
) {
  if (!key) return;
  let destinations = index.get(key);
  if (!destinations) {
    destinations = new Map();
    index.set(key, destinations);
  }
  const existing = destinations.get(destination.id);
  if (existing) {
    if (!existing.sources.some((party) => party.id === source.id)) existing.sources.push(source);
    return;
  }
  destinations.set(destination.id, { party: destination, sources: [source] });
}

function buildPartyIdentityIndexes(
  parties: Party[],
  partiesById: Map<string, Party>,
  type: Party["type"],
): PartyIdentityIndexes {
  const indexes: PartyIdentityIndexes = {
    code: new Map(),
    phone: new Map(),
    gstin: new Map(),
    nameAddress: new Map(),
  };
  parties.filter((party) => party.type === type).forEach((source) => {
    const destination = resolveActiveParty(source, partiesById);
    if (!destination || destination.type !== type) return;
    const code = normalizePartyCode(source.codeName);
    const phone = normalizePhoneDigits(source.phone);
    const gstin = normalizeGstin(source.gstin);
    const name = normalizePartyIdentity(source.name);
    const address = normalizePartyIdentity(source.address);
    addIdentityCandidate(indexes.code, code, source, destination);
    if (phone.length >= 8) addIdentityCandidate(indexes.phone, phone, source, destination);
    addIdentityCandidate(indexes.gstin, gstin, source, destination);
    if (name && address) addIdentityCandidate(indexes.nameAddress, `${name}\u0000${address}`, source, destination);
  });
  return indexes;
}

function identityCandidates(
  index: Map<string, Map<string, ResolvedIdentityCandidate>>,
  key: string,
) {
  return key ? [...(index.get(key)?.values() || [])] : [];
}

function uniqueCandidate(candidates: ResolvedIdentityCandidate[]) {
  return candidates.length === 1 ? candidates[0] : undefined;
}

function previewRows(
  envelope: DuesBackupEnvelope,
  parties: Party[],
  invoices: Invoice[],
  payments: Payment[],
  entries: AccountEntry[],
) {
  const partiesById = new Map(parties.map((party) => [party.id, party]));
  const customerIndexes = buildPartyIdentityIndexes(parties, partiesById, "customer");
  const supplierIndexes = buildPartyIdentityIndexes(parties, partiesById, "supplier");
  const historyIds = new Set<string>([
    ...invoices.flatMap((invoice) => invoice.partyId ? [invoice.partyId] : []),
    ...payments.map((payment) => payment.partyId),
    ...entries.map((entry) => entry.partyId),
  ]);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const claimed = new Map<string, number>();
  const rows: DuesRestorePreviewRow[] = envelope.payload.customers.map((record) => {
    const exactEntry = entryById.get(importedDueEntryId(record));
    if (exactEntry) {
      const storedParty = partiesById.get(exactEntry.partyId);
      const exactParty = storedParty && !mergedDestinationId(storedParty) ? storedParty : undefined;
      if (!exactParty || exactParty.type !== "customer") {
        return {
          record,
          status: "conflict",
          reason: "identity_collision",
          destinationPartyId: storedParty?.id,
          destinationPartyName: storedParty?.name,
          currentPaise: paiseFromMoney(storedParty?.currentBalance || 0),
        };
      }
      const sameAmount = paiseFromMoney(exactEntry.amount) === record.remainingPaise;
      return {
        record,
        status: sameAmount ? "already_restored" : "conflict",
        reason: sameAmount ? "same_import_entry" : "different_import_amount",
        destinationPartyId: exactParty.id,
        destinationPartyName: exactParty.name,
        currentPaise: paiseFromMoney(exactParty.currentBalance),
      };
    }

    const storedDirect = partiesById.get(record.sourcePartyId) || partiesById.get(importedPartyId(record));
    const direct = storedDirect ? resolveActiveParty(storedDirect, partiesById) : undefined;
    if (storedDirect && !direct) {
      return { record, status: "conflict", reason: "identity_collision", destinationPartyId: storedDirect.id, destinationPartyName: storedDirect.name, currentPaise: paiseFromMoney(storedDirect.currentBalance) };
    }
    if (direct?.type === "supplier") {
      return { record, status: "conflict", reason: "supplier_collision", destinationPartyId: direct.id, destinationPartyName: direct.name, currentPaise: paiseFromMoney(direct.currentBalance) };
    }
    const directWasMerged = Boolean(storedDirect && direct && storedDirect.id !== direct.id);
    if (storedDirect && directWasMerged && !compatibleDirectIdentity(storedDirect, record)) {
      return { record, status: "conflict", reason: "identity_collision", destinationPartyId: direct?.id, destinationPartyName: direct?.name, currentPaise: paiseFromMoney(direct?.currentBalance || 0) };
    }
    if (direct && !directWasMerged && !compatibleDirectIdentity(direct, record)) {
      return { record, status: "conflict", reason: "identity_collision", destinationPartyId: direct.id, destinationPartyName: direct.name, currentPaise: paiseFromMoney(direct.currentBalance) };
    }

    const code = normalizePartyCode(record.codeName);
    const phone = normalizePhoneDigits(record.phone);
    const gstin = normalizeGstin(record.gstin);
    const name = normalizePartyIdentity(record.name);
    const address = normalizePartyIdentity(record.address);
    const nameAddressKey = name && address ? `${name}\u0000${address}` : "";
    const supplierCandidates = [
      ...identityCandidates(supplierIndexes.code, code),
      ...identityCandidates(supplierIndexes.phone, phone.length >= 8 ? phone : ""),
      ...identityCandidates(supplierIndexes.gstin, gstin),
      ...identityCandidates(supplierIndexes.nameAddress, nameAddressKey),
    ];
    const supplierMatch = supplierCandidates[0]?.party;
    if (supplierMatch) {
      return {
        record,
        status: "conflict",
        reason: "supplier_collision",
        destinationPartyId: supplierMatch.id,
        destinationPartyName: supplierMatch.name,
        currentPaise: paiseFromMoney(supplierMatch.currentBalance),
      };
    }
    const codeMatches = identityCandidates(customerIndexes.code, code);
    const phoneMatches = identityCandidates(customerIndexes.phone, phone.length >= 8 ? phone : "");
    const gstinMatches = identityCandidates(customerIndexes.gstin, gstin);
    const addressMatches = identityCandidates(customerIndexes.nameAddress, nameAddressKey);
    const directCandidate = direct ? { party: direct, sources: storedDirect ? [storedDirect] : [direct] } : undefined;
    const autoCandidates = [directCandidate, uniqueCandidate(codeMatches), uniqueCandidate(phoneMatches), uniqueCandidate(gstinMatches), uniqueCandidate(addressMatches)].filter((candidate): candidate is ResolvedIdentityCandidate => Boolean(candidate));
    const candidateIds = new Set(autoCandidates.map((candidate) => candidate.party.id));
    const ambiguous = codeMatches.length > 1 || phoneMatches.length > 1 || gstinMatches.length > 1 || addressMatches.length > 1 || candidateIds.size > 1;
    if (ambiguous) {
      return { record, status: "conflict", reason: "ambiguous_identity", currentPaise: 0 };
    }
    const candidateMatch = autoCandidates[0];
    if (!candidateMatch) {
      return { record, status: "ready_new", reason: "new_customer", destinationPartyId: importedPartyId(record), destinationPartyName: record.name, currentPaise: 0 };
    }
    const candidate = candidateMatch.party;
    const matchingSources = [
      ...codeMatches,
      ...phoneMatches,
      ...gstinMatches,
      ...addressMatches,
    ]
      .filter((match) => match.party.id === candidate.id)
      .flatMap((match) => match.sources);
    if (candidate.id !== direct?.id && !matchingSources.some((source) => compatibleAutomaticIdentity(source, record))) {
      return { record, status: "conflict", reason: "identity_collision", destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise: paiseFromMoney(candidate.currentBalance) };
    }
    const currentPaise = paiseFromMoney(candidate.currentBalance);
    if (currentPaise === record.remainingPaise) {
      return { record, status: "already_present", reason: "same_balance_present", destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise };
    }
    if (currentPaise !== 0) {
      return { record, status: "conflict", reason: "existing_balance", destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise };
    }
    if (historyIds.has(candidate.id)) {
      return { record, status: "conflict", reason: "existing_history", destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise };
    }
    return { record, status: "ready_existing", reason: "matched_empty_customer", destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise };
  });

  rows.forEach((row, index) => {
    if (!row.destinationPartyId || !row.status.startsWith("ready_")) return;
    const previous = claimed.get(row.destinationPartyId);
    if (previous === undefined) claimed.set(row.destinationPartyId, index);
    else {
      rows[index] = { ...row, status: "conflict", reason: "duplicate_destination" };
      rows[previous] = { ...rows[previous], status: "conflict", reason: "duplicate_destination" };
    }
  });
  return rows;
}

function summarizePreview(envelope: DuesBackupEnvelope, rows: DuesRestorePreviewRow[]): DuesRestorePreview {
  const ready = rows.filter((row) => row.status === "ready_new" || row.status === "ready_existing");
  return {
    envelope,
    rows,
    readyCount: ready.length,
    readyPaise: ready.reduce((sum, row) => sum + row.record.remainingPaise, 0),
    newCount: rows.filter((row) => row.status === "ready_new").length,
    matchedCount: rows.filter((row) => row.status === "ready_existing").length,
    alreadyCount: rows.filter((row) => row.status === "already_restored" || row.status === "already_present").length,
    conflictCount: rows.filter((row) => row.status === "conflict").length,
  };
}

export async function previewDuesBackupRestore(envelope: DuesBackupEnvelope) {
  const [parties, invoices, payments, entries] = await Promise.all([
    db.parties.toArray(),
    db.invoices.toArray(),
    db.payments.toArray(),
    db.accountEntries.toArray(),
  ]);
  return summarizePreview(envelope, previewRows(envelope, parties, invoices, payments, entries));
}

export async function restoreDuesBackup(envelope: DuesBackupEnvelope) {
  return db.transaction("rw", [db.parties, db.invoices, db.payments, db.accountEntries, db.activityLogs], async () => {
    const [parties, invoices, payments, entries] = await Promise.all([
      db.parties.toArray(),
      db.invoices.toArray(),
      db.payments.toArray(),
      db.accountEntries.toArray(),
    ]);
    const preview = summarizePreview(envelope, previewRows(envelope, parties, invoices, payments, entries));
    if (preview.conflictCount)
      throw new DuesBackupError("conflict", "The destination changed or contains unresolved customer conflicts. Review the backup again.");
    if (!preview.readyCount) {
      return { importedCount: 0, importedPaise: 0, createdCustomers: 0, matchedCustomers: 0, alreadyCount: preview.alreadyCount } satisfies DuesRestoreResult;
    }
    const timestamp = nowIso();
    const snapshotDate = envelope.payload.snapshotDate;
    const partiesById = new Map(parties.map((party) => [party.id, party]));
    const partyWrites: Party[] = [];
    const entryWrites: AccountEntry[] = [];
    let createdCustomers = 0;
    let matchedCustomers = 0;
    for (const row of preview.rows) {
      if (row.status !== "ready_new" && row.status !== "ready_existing") continue;
      const partyId = row.destinationPartyId!;
      const amount = moneyFromPaise(row.record.remainingPaise);
      if (row.status === "ready_new") {
        const record = row.record;
        partyWrites.push({
          id: partyId,
          name: record.name,
          codeName: normalizePartyCode(record.codeName),
          phone: record.phone,
          address: record.address,
          gstin: record.gstin || undefined,
          type: "customer",
          priceTier: record.priceTier,
          openingBalance: 0,
          currentBalance: amount,
          notes: "",
          tags: [],
          createdAt: timestamp,
          updatedAt: timestamp,
          isSynced: false,
        });
        createdCustomers += 1;
      } else {
        const current = partiesById.get(partyId);
        if (!current || current.type !== "customer" || mergedDestinationId(current))
          throw new DuesBackupError("conflict", "A destination customer disappeared during restore.");
        partyWrites.push({
          ...current,
          currentBalance: roundMoney(current.currentBalance + amount),
          updatedAt: timestamp,
          isSynced: false,
        });
        matchedCustomers += 1;
      }
      entryWrites.push({
        id: importedDueEntryId(row.record),
        partyId,
        kind: "due",
        amount,
        date: snapshotDate,
        note: IMPORTED_DUE_NOTE,
        reference: importedDueReference(envelope.payload, row.record),
        isSynced: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    await db.parties.bulkPut(partyWrites);
    await db.accountEntries.bulkAdd(entryWrites);
    const log: ActivityLog = {
      id: makeId(),
      action: "dues.backup.import",
      entityType: "due",
      description: `Restored ${preview.readyCount} outstanding customer balances`,
      actor: "owner",
      metadata: JSON.stringify({ backupId: envelope.payload.backupId, totalPaise: preview.readyPaise }),
      createdAt: timestamp,
    };
    await db.activityLogs.add(log);
    return {
      importedCount: preview.readyCount,
      importedPaise: preview.readyPaise,
      createdCustomers,
      matchedCustomers,
      alreadyCount: preview.alreadyCount,
    } satisfies DuesRestoreResult;
  });
}

export function isImportedDueEntry(entry: Pick<AccountEntry, "note" | "reference">) {
  return entry.note === IMPORTED_DUE_NOTE || entry.reference.startsWith(`${DUES_BACKUP_MARKER}|`);
}

export const importedDueActivityLabel = (language: Language) =>
  language === "hi"
    ? "बैकअप से लाई गई बाकी रकम"
    : language === "bn"
      ? "ব্যাকআপ থেকে আনা বাকি টাকা"
      : "Imported outstanding due backup";
