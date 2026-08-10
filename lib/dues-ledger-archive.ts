import {
  db,
  isValidLocalDate,
  makeId,
  nowIso,
  type AccountEntry,
  type ActivityLog,
  type Invoice,
  type Language,
  type Party,
  type Payment,
  type PaymentChannel,
  type PriceTier,
} from "./db";
import {
  dueCustomerRows,
  invoiceInitialPaymentBreakdown,
  normalizePartyCode,
  normalizePartyIdentity,
  normalizePhoneDigits,
  partyDueStatement,
  roundMoney,
  type PartyDueStatement,
  type PartyDueStatementRow,
} from "./billing";
import type { BusinessSettings } from "./pdf";
import {
  normalizePdfLanguage,
  pdfDate,
  pdfDateTime,
  pdfMoney,
  pdfPaymentMode,
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";
import { shareNativeBlob } from "./native-files";
import { sha256Hex } from "./qol";

export const DUES_LEDGER_FORMAT = "midori-kanjo-dues-ledger-backup" as const;
export const DUES_LEDGER_VERSION = 2 as const;
export const DUES_LEDGER_MARKER = "MKDUES2";
export const DUES_LEDGER_NAMESPACE = "https://midori-kanjo.local/dues-backup/2#";
export const MAX_DUES_LEDGER_BYTES = 64 * 1024 * 1024;
export const MAX_DUES_LEDGER_CUSTOMERS = 10_000;
export const MAX_DUES_LEDGER_TRANSACTIONS = 250_000;
const SOURCE_META = "dues-backup-source-id";
const APP_VERSION = "0.1.2+";
const priceTiers = ["retail", "wholesale", "bulk", "special"] as const;
const paymentChannels = ["cash", "upi", "bank", "cheque"] as const;
const paymentModes = [...paymentChannels, "credit", "mixed"] as const;
const invoiceUnits = ["piece", "dozen", "gross", "bundle", "box", "packet"] as const;

export type DuesLedgerEvent = {
  id: string;
  businessDate: string;
  recordedAt: string;
  kind: PartyDueStatementRow["kind"];
  activity: string;
  reference: string;
  paymentMode?: PaymentChannel;
  dueAddedPaise: number;
  paymentReceivedPaise: number;
  refundPaidPaise: number;
  runningBalancePaise: number;
};

export type DuesLedgerCustomer = {
  recordId: string;
  sourcePartyId: string;
  party: Party;
  status: "outstanding" | "paid_in_full";
  summary: {
    totalDueAddedPaise: number;
    actualPaymentsPaise: number;
    returnCreditsPaise: number;
    refundsPaidPaise: number;
    balanceAdjustmentsPaise: number;
    remainingPaise: number;
  };
  events: DuesLedgerEvent[];
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
};

export type DuesLedgerPayload = {
  format: typeof DUES_LEDGER_FORMAT;
  version: typeof DUES_LEDGER_VERSION;
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
  customerCount: number;
  outstandingCount: number;
  settledCount: number;
  transactionCount: number;
  totalRemainingPaise: number;
  customers: DuesLedgerCustomer[];
};

export type DuesLedgerEnvelope = { payload: DuesLedgerPayload; checksum: string };

export type DuesLedgerRestoreStatus =
  | "ready_new"
  | "ready_existing"
  | "already_restored"
  | "already_present"
  | "conflict";

export type DuesLedgerRestoreReason =
  | "new_customer"
  | "matched_empty_customer"
  | "same_archive_imported"
  | "same_history_present"
  | "existing_history"
  | "ambiguous_identity"
  | "supplier_collision"
  | "identity_collision"
  | "record_collision"
  | "invoice_number_collision"
  | "duplicate_destination";

export type DuesLedgerRestoreRow = {
  record: DuesLedgerCustomer;
  status: DuesLedgerRestoreStatus;
  reason: DuesLedgerRestoreReason;
  destinationPartyId?: string;
  destinationPartyName?: string;
  currentPaise: number;
};

export type DuesLedgerRestorePreview = {
  envelope: DuesLedgerEnvelope;
  rows: DuesLedgerRestoreRow[];
  readyCount: number;
  readyPaise: number;
  readyTransactions: number;
  newCount: number;
  matchedCount: number;
  alreadyCount: number;
  conflictCount: number;
};

export type DuesLedgerRestoreResult = {
  importedCount: number;
  importedPaise: number;
  importedTransactions: number;
  createdCustomers: number;
  matchedCustomers: number;
  alreadyCount: number;
};

export type DuesLedgerErrorCode =
  | "file_too_large"
  | "not_backup"
  | "duplicate_payload"
  | "invalid_payload"
  | "unsupported_version"
  | "wrong_currency"
  | "checksum_mismatch"
  | "conflict";

export class DuesLedgerError extends Error {
  constructor(public readonly code: DuesLedgerErrorCode, message: string) {
    super(message);
    this.name = "DuesLedgerError";
  }
}

export type DuesLedgerSource = {
  parties: Party[];
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
};

export async function readDuesLedgerSource(): Promise<DuesLedgerSource> {
  return db.transaction(
    "r",
    [db.parties, db.invoices, db.payments, db.accountEntries],
    async () => {
      const [parties, invoices, payments, accountEntries] = await Promise.all([
        db.parties.toArray(),
        db.invoices.toArray(),
        db.payments.toArray(),
        db.accountEntries.toArray(),
      ]);
      return { parties, invoices, payments, accountEntries };
    },
  );
}

const paise = (value: number) => Math.round(roundMoney(value) * 100);
export const ledgerMoney = (value: number) => roundMoney(value / 100);

const oneLine = (value: unknown, max: number) => String(value || "")
  .replace(/[\u0000-\u001f\u007f]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const completeLine = (value: unknown) => String(value || "")
  .replace(/[\u0000-\u001f\u007f]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const humanCell = (value: unknown) => {
  const cleaned = completeLine(value);
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
};

const invoiceByNumber = (invoices: Invoice[], invoiceId: string) =>
  invoices.find((invoice) => invoice.id === invoiceId)?.invoiceNumber || invoiceId;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function sourceDatasetId() {
  return db.transaction("rw", db.meta, async () => {
    const existing = await db.meta.get(SOURCE_META);
    if (typeof existing?.value === "string" && existing.value.trim()) return existing.value;
    const created = makeId();
    await db.meta.put({ key: SOURCE_META, value: created });
    return created;
  });
}

const recordId = (datasetId: string, partyId: string) =>
  sha256Hex(`midori-kanjo:dues-ledger:v2\u0000${datasetId}\u0000${partyId}`);

function eventReference(row: PartyDueStatementRow, invoices: Invoice[]) {
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const details: string[] = [row.reference];
  if (row.payment?.allocatedTo.length) {
    const allocations = row.payment.allocatedTo.map((allocation) => {
      const invoice = invoiceById.get(allocation.invoiceId);
      return `${invoice?.invoiceNumber || allocation.invoiceId}: ${roundMoney(allocation.amount).toFixed(2)}`;
    });
    const allocated = roundMoney(row.payment.allocatedTo.reduce((sum, allocation) => sum + allocation.amount, 0));
    const unallocated = roundMoney(row.payment.amount - allocated);
    details.push(`Allocated ${allocations.join(", ")}${unallocated > 0 ? `; account ${unallocated.toFixed(2)}` : ""}`);
  }
  if (row.invoice?.type === "sale_return") {
    const source = row.invoice.returnDetails?.sourceInvoiceId
      ? invoiceById.get(row.invoice.returnDetails.sourceInvoiceId)?.invoiceNumber || row.invoice.returnDetails.sourceInvoiceId
      : "account return";
    details.push(`Return source ${source}`);
    if (row.invoice.returnDetails?.allocations.length) {
      details.push(`Credited ${row.invoice.returnDetails.allocations.map((allocation) => {
        const invoice = invoiceById.get(allocation.invoiceId);
        return `${invoice?.invoiceNumber || allocation.invoiceId}: ${roundMoney(allocation.amount).toFixed(2)}`;
      }).join(", ")}`);
    }
    const settlementReference = row.invoice.paymentBreakdown
      ?.map((part) => part.reference?.trim())
      .filter(Boolean)
      .join(", ");
    if (settlementReference) details.push(`Settlement reference ${settlementReference}`);
  }
  return details.filter(Boolean).join(" | ");
}

function archiveEvent(row: PartyDueStatementRow, invoices: Invoice[]): DuesLedgerEvent {
  return {
    id: row.id,
    businessDate: row.date,
    recordedAt: row.timestamp,
    kind: row.kind,
    activity: completeLine(row.activity),
    reference: completeLine(eventReference(row, invoices)),
    ...(row.paymentMode ? { paymentMode: row.paymentMode } : {}),
    dueAddedPaise: paise(row.dueAdded),
    paymentReceivedPaise: paise(row.paymentReceived),
    refundPaidPaise: paise(row.refundPaid || 0),
    runningBalancePaise: paise(row.runningBalance),
  };
}

function customerFromStatement(
  datasetId: string,
  statement: PartyDueStatement,
): DuesLedgerCustomer {
  const party = cloneJson(statement.party);
  const laterAllocated = new Map<string, number>();
  for (const payment of statement.payments) for (const allocation of payment.allocatedTo) {
    laterAllocated.set(
      allocation.invoiceId,
      roundMoney((laterAllocated.get(allocation.invoiceId) || 0) + allocation.amount),
    );
  }
  const invoices = cloneJson(statement.invoices)
    .filter((invoice) => invoice.type === "sale" || invoice.type === "sale_return")
    .map((invoice) => {
      const paymentBreakdown = invoiceInitialPaymentBreakdown(invoice, laterAllocated.get(invoice.id) || 0);
      const initialAmountPaid = invoice.type === "sale_return"
        ? roundMoney(invoice.returnDetails?.settlementAmount || 0)
        : roundMoney(paymentBreakdown.reduce((sum, allocation) => sum + allocation.amount, 0));
      return { ...invoice, initialAmountPaid, paymentBreakdown };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const payments = cloneJson(statement.payments)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const accountEntries = cloneJson(statement.accountEntries)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return {
    recordId: recordId(datasetId, party.id),
    sourcePartyId: party.id,
    party,
    status: statement.remainingDue > 0 ? "outstanding" : "paid_in_full",
    summary: {
      totalDueAddedPaise: paise(statement.totalDueAdded),
      actualPaymentsPaise: paise(statement.totalPaid),
      returnCreditsPaise: paise(statement.totalReturnCredits),
      refundsPaidPaise: paise(statement.totalRefunded),
      balanceAdjustmentsPaise: paise(statement.totalBalanceAdjustments),
      remainingPaise: paise(statement.remainingDue),
    },
    events: statement.rows.map((row) => archiveEvent(row, invoices)),
    invoices,
    payments,
    accountEntries,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return child;
    return Object.keys(child as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = (child as Record<string, unknown>)[key];
        return sorted;
      }, {});
  });
}

const canonicalPayload = (payload: DuesLedgerPayload) => canonicalJson(payload);

export async function createDuesLedgerEnvelope(
  source: DuesLedgerSource,
  business: BusinessSettings,
  options: { selectedPartyIds?: string[]; exportedAt?: string } = {},
): Promise<DuesLedgerEnvelope> {
  const datasetId = await sourceDatasetId();
  const explicit = options.selectedPartyIds ? new Set(options.selectedPartyIds) : null;
  const eligibleIds = explicit || new Set(
    dueCustomerRows(source.parties, source.payments, "", source.invoices, source.accountEntries, true)
      .map((row) => row.party.id),
  );
  const selected = source.parties
    .filter((party) => party.type === "customer" && !party.tags.some((tag) => tag.startsWith("mergedInto:")) && eligibleIds.has(party.id))
    .sort((a, b) => normalizePartyIdentity(a.name).localeCompare(normalizePartyIdentity(b.name)) || a.id.localeCompare(b.id));
  if (selected.length > MAX_DUES_LEDGER_CUSTOMERS)
    throw new DuesLedgerError("invalid_payload", `A ledger backup can contain at most ${MAX_DUES_LEDGER_CUSTOMERS} customers.`);
  const customers = selected.map((party) => customerFromStatement(
    datasetId,
    partyDueStatement(party, source.invoices, source.payments, source.accountEntries),
  ));
  const transactionCount = customers.reduce(
    (sum, customer) => sum + customer.invoices.length + customer.payments.length + customer.accountEntries.length,
    0,
  );
  if (transactionCount > MAX_DUES_LEDGER_TRANSACTIONS)
    throw new DuesLedgerError("invalid_payload", "The ledger backup contains too many transaction records.");
  const exportedAt = options.exportedAt || nowIso();
  const withoutId: Omit<DuesLedgerPayload, "backupId"> = {
    format: DUES_LEDGER_FORMAT,
    version: DUES_LEDGER_VERSION,
    exportedAt,
    snapshotDate: exportedAt.slice(0, 10),
    currency: "INR",
    source: {
      datasetId,
      businessName: oneLine(business.name || "Midori Kanjo", 200),
      businessAddress: oneLine(business.address, 500),
      businessPhone: oneLine(business.phone, 40),
      businessGstin: oneLine(business.gstin, 40).toUpperCase(),
      appVersion: APP_VERSION,
    },
    customerCount: customers.length,
    outstandingCount: customers.filter((customer) => customer.status === "outstanding").length,
    settledCount: customers.filter((customer) => customer.status === "paid_in_full").length,
    transactionCount,
    totalRemainingPaise: customers.reduce((sum, customer) => sum + customer.summary.remainingPaise, 0),
    customers,
  };
  const backupId = sha256Hex(canonicalJson({
    format: DUES_LEDGER_FORMAT,
    version: DUES_LEDGER_VERSION,
    datasetId,
    customers,
  }));
  const payload: DuesLedgerPayload = { ...withoutId, backupId };
  const validated = validatePayload(payload);
  return { payload: validated, checksum: sha256Hex(canonicalPayload(validated)) };
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new DuesLedgerError("invalid_payload", "The ledger restore payload is not valid base64url data.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary: string;
  try { binary = atob(padded); }
  catch { throw new DuesLedgerError("invalid_payload", "The ledger restore payload could not be decoded."); }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const markerFor = (envelope: DuesLedgerEnvelope) =>
  `${DUES_LEDGER_MARKER}.${envelope.checksum}.${bytesToBase64Url(new TextEncoder().encode(canonicalPayload(envelope.payload)))}`;

export function addDuesLedgerPdfMetadata(
  doc: { addMetadata: (metadata: string, namespaceUri?: string) => unknown },
  envelope: DuesLedgerEnvelope,
) {
  doc.addMetadata(markerFor(envelope), DUES_LEDGER_NAMESPACE);
}

const t = (language: Language, en: string, hi: string, bn: string) =>
  language === "hi" ? hi : language === "bn" ? bn : en;

function eventLabel(event: DuesLedgerEvent, language: Language) {
  const labels: Record<DuesLedgerEvent["kind"], [string, string, string]> = {
    opening_balance: ["Opening balance", "शुरुआती बैलेंस", "শুরুর ব্যালেন্স"],
    sale_invoice: ["Sales bill", "सेल बिल", "সেল বিল"],
    return_credit: ["Sales return credit", "बिक्री वापसी क्रेडिट", "বিক্রি ফেরত ক্রেডিট"],
    return_refund: ["Immediate return refund", "तुरंत वापसी रिफंड", "তাৎক্ষণিক ফেরত রিফান্ড"],
    manual_due: ["Manual due", "हाथ से जोड़ा बाकी", "হাতে যোগ করা বাকি"],
    payment: ["Customer payment", "कस्टमर पेमेंट", "ক্রেতার পেমেন্ট"],
    balance_adjustment: ["Legacy balance repair", "पुराने बैलेंस का मिलान", "পুরোনো ব্যালেন্স মেলানো"],
  };
  const label = labels[event.kind];
  return t(language, label[0], label[1], label[2]);
}

function eventActivityLabel(event: DuesLedgerEvent, language: Language) {
  const label = eventLabel(event, language);
  const activity = humanCell(event.activity);
  return activity && activity.toLocaleLowerCase("und") !== eventLabel(event, "en").toLocaleLowerCase("und")
    ? `${label}: ${activity}`
    : label;
}

function ledgerHumanText(envelope: DuesLedgerEnvelope, language: Language) {
  const active = normalizePdfLanguage(language);
  const money = (value: number) => pdfMoney(ledgerMoney(value), active);
  const lines = [
    "MIDORI KANJO - COMPLETE CUSTOMER DUES LEDGER",
    `${t(active, "Generated", "बनाने की तारीख", "তৈরির তারিখ")}\t${pdfDateTime(new Date(envelope.payload.exportedAt), active)}`,
    `${t(active, "Source business", "सोर्स बिज़नेस", "উৎস ব্যবসা")}\t${envelope.payload.source.businessName}`,
    `${t(active, "Customer accounts", "कस्टमर खाते", "ক্রেতার হিসাব")}\t${envelope.payload.customerCount}`,
    `${t(active, "Outstanding", "बाकी", "বাকি")}\t${envelope.payload.outstandingCount}`,
    `${t(active, "Paid in full", "पूरा भुगतान", "সম্পূর্ণ পরিশোধ")}\t${envelope.payload.settledCount}`,
    `${t(active, "Total remaining", "कुल बाकी", "মোট বাকি")}\t${money(envelope.payload.totalRemainingPaise)}`,
    "",
  ];
  envelope.payload.customers.forEach((customer, customerIndex) => {
    const status = customer.status === "paid_in_full"
      ? t(active, "PAID IN FULL", "पूरा भुगतान", "সম্পূর্ণ পরিশোধ")
      : t(active, "OUTSTANDING", "बाकी", "বাকি");
    lines.push(
      `===== ${customerIndex + 1}. ${humanCell(customer.party.name)}${customer.party.codeName ? ` (${humanCell(customer.party.codeName)})` : ""} - ${status} =====`,
      `${t(active, "Phone", "फ़ोन", "ফোন")}\t${humanCell(customer.party.phone) || "-"}`,
      `${t(active, "Address", "पता", "ঠিকানা")}\t${humanCell(customer.party.address) || "-"}`,
      `GSTIN\t${humanCell(customer.party.gstin) || "-"}`,
      `${t(active, "Price tier", "मूल्य स्तर", "মূল্য স্তর")}\t${humanCell(customer.party.priceTier)}`,
      `${t(active, "Customer notes", "कस्टमर नोट", "ক্রেতার নোট")}\t${humanCell(customer.party.notes) || "-"}`,
      `${t(active, "Tags", "टैग", "ট্যাগ")}\t${customer.party.tags.map(humanCell).join(", ") || "-"}`,
      `${t(active, "Due added", "जोड़ा गया बाकी", "যোগ হওয়া বাকি")}\t${money(customer.summary.totalDueAddedPaise)}`,
      `${t(active, "Customer payments", "कस्टमर पेमेंट", "ক্রেতার পেমেন্ট")}\t${money(customer.summary.actualPaymentsPaise)}`,
      `${t(active, "Return credits", "वापसी क्रेडिट", "ফেরত ক্রেডিট")}\t${money(customer.summary.returnCreditsPaise)}`,
      `${t(active, "Cash refunded", "कैश रिफंड", "নগদ ফেরত")}\t${money(customer.summary.refundsPaidPaise)}`,
      `${t(active, "Remaining due", "बाकी रकम", "বাকি টাকা")}\t${money(customer.summary.remainingPaise)}`,
      "",
      [
        t(active, "Business date", "बिज़नेस तारीख", "ব্যবসার তারিখ"),
        t(active, "Recorded date & time", "रिकॉर्ड की तारीख और समय", "রেকর্ডের তারিখ ও সময়"),
        t(active, "Activity", "लेन-देन", "লেনদেন"),
        t(active, "Reference / mode / allocation", "रेफरेंस / तरीका / बँटवारा", "রেফারেন্স / মাধ্যম / বণ্টন"),
        t(active, "Due added", "बाकी जोड़ी", "বাকি যোগ"),
        t(active, "Paid / credit", "पेमेंट / क्रेडिट", "পেমেন্ট / ক্রেডিট"),
        t(active, "Refund", "रिफंड", "রিফান্ড"),
        t(active, "Running balance", "चलता बैलेंस", "চলতি ব্যালেন্স"),
      ].join("\t"),
      ...customer.events.map((event) => [
        pdfDate(event.businessDate, active),
        pdfDateTime(new Date(event.recordedAt), active),
        eventActivityLabel(event, active),
        [humanCell(event.reference), event.paymentMode ? pdfPaymentMode(event.paymentMode, active) : ""].filter(Boolean).join(" | "),
        event.dueAddedPaise ? money(event.dueAddedPaise) : "-",
        event.paymentReceivedPaise ? money(event.paymentReceivedPaise) : "-",
        event.refundPaidPaise ? money(event.refundPaidPaise) : "-",
        money(event.runningBalancePaise),
      ].join("\t")),
      "",
      t(active, "INVOICE & RETURN DETAILS", "बिल और वापसी का पूरा विवरण", "বিল ও ফেরতের সম্পূর্ণ বিবরণ"),
    );
    customer.invoices.forEach((invoice) => {
      const charges = (invoice.otherCharges || []).map((charge) => `${humanCell(charge.label)} ${pdfMoney(charge.amount, active)}`).join("; ") || "-";
      const tenders = (invoice.paymentBreakdown || []).map((part) => `${pdfPaymentMode(part.mode, active)} ${pdfMoney(part.amount, active)}${part.reference ? ` (${humanCell(part.reference)})` : ""}`).join("; ") || "-";
      lines.push(
        `${invoice.deletedAt ? "VOIDED | " : ""}${humanCell(invoice.invoiceNumber)}\t${pdfDate(invoice.date, active)}\t${pdfDateTime(new Date(invoice.createdAt), active)}\t${invoice.type}\t${money(paise(invoice.grandTotal))}`,
        ...(invoice.deletedAt ? [`${t(active, "Voided at", "रद्द करने का समय", "বাতিলের সময়")}\t${pdfDateTime(new Date(invoice.deletedAt), active)}`] : []),
        ...invoice.lineItems.map((line, index) =>
          `${index + 1}. ${humanCell(line.itemName)} [${humanCell(line.skuCode) || "-"}]\tHSN ${humanCell(line.hsnCode) || "-"}\t${line.qty} ${line.unit}\t@ ${pdfMoney(line.rate, active)}\t${t(active, "Discount", "छूट", "ছাড়")} ${pdfMoney(line.discount, active)}\t${t(active, "Taxable", "टैक्स योग्य", "করযোগ্য")} ${pdfMoney(line.taxableAmount, active)}\tGST ${line.gstRate}% ${pdfMoney(line.gstAmount, active)}\t${t(active, "Line total", "लाइन कुल", "লাইনের মোট")} ${pdfMoney(line.amount, active)}`,
        ),
        `${t(active, "Subtotal", "सबटोटल", "উপমোট")}\t${pdfMoney(invoice.subtotal, active)}\t${t(active, "Discount", "छूट", "ছাড়")}\t${pdfMoney(invoice.discountTotal, active)}\tGST\t${pdfMoney(invoice.gstTotal, active)}`,
        `${t(active, "Other charges", "दूसरे चार्ज", "অন্যান্য চার্জ")}\t${charges}\t${t(active, "Round-off", "राउंड-ऑफ", "রাউন্ড-অফ")}\t${pdfMoney(invoice.roundOff, active)}\t${t(active, "Grand total", "कुल", "সর্বমোট")}\t${pdfMoney(invoice.grandTotal, active)}`,
        `${t(active, "Tender / reference", "पेमेंट तरीका / रेफरेंस", "পেমেন্ট মাধ্যম / রেফারেন্স")}\t${tenders}`,
        `${t(active, "Invoice paid", "बिल पर मिला", "বিলে পাওয়া")}\t${pdfMoney(invoice.amountPaid, active)}\t${t(active, "Invoice due", "बिल बाकी", "বিল বাকি")}\t${pdfMoney(invoice.amountDue, active)}`,
        ...(invoice.returnDetails ? [
          `${t(active, "Return balance credit", "वापसी बैलेंस क्रेडिट", "ফেরত ব্যালেন্স ক্রেডিট")}\t${pdfMoney(invoice.returnDetails.balanceApplied, active)}\t${t(active, "Immediate refund", "तुरंत रिफंड", "তাৎক্ষণিক রিফান্ড")}\t${pdfMoney(invoice.returnDetails.settlementAmount, active)}`,
          `${t(active, "Return allocations", "वापसी बँटवारा", "ফেরত বণ্টন")}\t${invoice.returnDetails.allocations.map((allocation) => `${humanCell(invoiceByNumber(customer.invoices, allocation.invoiceId))}: ${pdfMoney(allocation.amount, active)}`).join("; ") || "-"}`,
        ] : []),
        `${t(active, "Invoice notes", "बिल नोट", "বিলের নোট")}\t${humanCell(invoice.notes) || "-"}`,
        "",
      );
    });
    lines.push("");
  });
  lines.push(
    t(active, "This file contains private customer and accounting data. Keep it unchanged for restore.", "इस फाइल में निजी कस्टमर और अकाउंट डेटा है। रिस्टोर के लिए इसे बिना बदले रखें।", "এই ফাইলে ব্যক্তিগত ক্রেতা ও হিসাবের তথ্য আছে। ফিরিয়ে আনার জন্য এটি অপরিবর্তিত রাখুন।"),
    t(active, "The checksum detects damage or editing; it is not proof of authorship.", "चेकसम खराबी या बदलाव पकड़ता है; यह बनाने वाले की पहचान का प्रमाण नहीं है।", "চেকসম ক্ষতি বা পরিবর্তন শনাক্ত করে; এটি নির্মাতার পরিচয়ের প্রমাণ নয়।"),
  );
  return lines.join("\r\n");
}

export function duesLedgerText(envelope: DuesLedgerEnvelope, language: Language = "en") {
  const human = ledgerHumanText(envelope, normalizePdfLanguage(language));
  return `${human}\r\n\r\n----- MIDORI KANJO RESTORE DATA -----\r\n${markerFor(envelope)}\r\n----- END MIDORI KANJO RESTORE DATA -----\r\n`;
}

export function assertDuesLedgerSize(blob: Pick<Blob, "size">) {
  if (blob.size > MAX_DUES_LEDGER_BYTES)
    throw new DuesLedgerError("file_too_large", "The complete dues ledger is larger than 64 MiB.");
}

export async function createDuesLedgerPdf(
  envelope: DuesLedgerEnvelope,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const money = (value: number) => pdfMoney(ledgerMoney(value), active);
  const { jsPDF } = await import("jspdf");
  const doc = await registerPdfFont(new jsPDF({
    unit: "mm", format: "a4", orientation: "landscape", compress: true, putOnlyUsedFonts: true,
  }));
  addDuesLedgerPdfMetadata(doc, envelope);
  doc.setProperties({
    title: t(active, "Complete customer dues ledger", "पूरा कस्टमर बाकी खाता", "সম্পূর্ণ ক্রেতা বাকি খাতা"),
    subject: "Detailed customer invoices, payments, returns and running balances",
    author: envelope.payload.source.businessName,
    creator: "Midori Kanjo",
  });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 10;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const forest: [number, number, number] = [1, 73, 33];
  const green: [number, number, number] = [11, 111, 56];
  const orange: [number, number, number] = [183, 91, 43];
  const pale: [number, number, number] = [249, 249, 249];
  const ink: [number, number, number] = [33, 31, 29];
  const muted: [number, number, number] = [97, 95, 92];
  const border: [number, number, number] = [226, 226, 219];
  let y = margin;

  const pageHeader = (label: string) => {
    y = margin;
    doc.setFillColor(...forest);
    doc.roundedRect(margin, y, contentWidth, 22, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(12);
    doc.text(envelope.payload.source.businessName || "Midori Kanjo", margin + 5, y + 8, { maxWidth: contentWidth * 0.45 });
    setPdfFont(doc);
    doc.setFontSize(7);
    doc.text(envelope.payload.source.businessAddress || "Kolkata", margin + 5, y + 15, { maxWidth: contentWidth * 0.45 });
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 10 : 8.6);
    doc.text(label, right - 5, y + 8, { align: "right", maxWidth: contentWidth * 0.5 });
    setPdfFont(doc);
    doc.setFontSize(6.8);
    doc.text(`${t(active, "Generated", "बनाया", "তৈরি")} ${pdfDateTime(new Date(envelope.payload.exportedAt), active)}`, right - 5, y + 15, { align: "right" });
    y += 28;
  };

  const addPage = (label: string) => {
    doc.addPage("a4", "landscape");
    pageHeader(label);
  };

  const ensure = (heightNeeded: number, label: string) => {
    if (y + heightNeeded > height - 13) addPage(label);
  };

  const writeWrappedDetail = (
    value: string,
    label: string,
    options: {
      bold?: boolean;
      color?: [number, number, number];
      fontSize?: number;
      left?: number;
      width?: number;
      gapAfter?: number;
    } = {},
  ) => {
    setPdfFont(doc, options.bold ? "bold" : undefined);
    doc.setFontSize(options.fontSize || 7.2);
    doc.setTextColor(...(options.color || ink));
    const left = options.left ?? margin + 3;
    const wrapWidth = options.width ?? contentWidth - 6;
    const lineHeight = (options.fontSize || 7.2) >= 8 ? 4 : 3.7;
    const wrapped = doc.splitTextToSize(value || "-", wrapWidth) as string[];
    let offset = 0;
    while (offset < wrapped.length) {
      if (y + lineHeight > height - 13) addPage(label);
      const capacity = Math.max(1, Math.floor((height - 13 - y) / lineHeight));
      const chunk = wrapped.slice(offset, offset + capacity);
      doc.text(chunk, left, y + lineHeight - 0.8);
      y += chunk.length * lineHeight;
      offset += chunk.length;
    }
    y += options.gapAfter ?? 1.5;
  };

  pageHeader(t(active, "COMPLETE CUSTOMER DUES LEDGER", "पूरा कस्टमर बाकी खाता", "সম্পূর্ণ ক্রেতা বাকি খাতা"));
  const summaryCards: Array<[string, string, [number, number, number]]> = [
    [t(active, "Accounts", "खाते", "হিসাব"), String(envelope.payload.customerCount), ink],
    [t(active, "Outstanding", "बाकी", "বাকি"), String(envelope.payload.outstandingCount), orange],
    [t(active, "Paid in full", "पूरा भुगतान", "সম্পূর্ণ পরিশোধ"), String(envelope.payload.settledCount), green],
    [t(active, "Total remaining", "कुल बाकी", "মোট বাকি"), money(envelope.payload.totalRemainingPaise), forest],
  ];
  const gap = 3;
  const summaryCardWidth = (contentWidth - gap * 3) / 4;
  summaryCards.forEach(([label, value, color], index) => {
    const x = margin + index * (summaryCardWidth + gap);
    doc.setFillColor(...pale);
    doc.setDrawColor(...border);
    doc.roundedRect(x, y, summaryCardWidth, 22, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 7.2 : 7);
    doc.setTextColor(...muted);
    doc.text(label, x + 4, y + 7, { maxWidth: summaryCardWidth - 8 });
    doc.setFontSize(11);
    doc.setTextColor(...color);
    doc.text(value, x + 4, y + 17, { maxWidth: summaryCardWidth - 8 });
  });
  y += 30;
  setPdfFont(doc);
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(t(active, "Each customer section contains the complete due timeline and invoice appendix. Paid accounts are marked green.", "हर कस्टमर सेक्शन में पूरा बाकी टाइमलाइन और बिल विवरण है। चुकाए खाते हरे हैं।", "প্রতিটি ক্রেতা বিভাগে সম্পূর্ণ বাকি সময়রেখা ও বিলের বিবরণ আছে। পরিশোধিত হিসাব সবুজ।"), margin, y, { maxWidth: contentWidth });

  envelope.payload.customers.forEach((customer, customerIndex) => {
    addPage(`${customerIndex + 1}/${envelope.payload.customerCount} · ${customer.party.name}`);
    const settled = customer.status === "paid_in_full";
    setPdfFont(doc, "bold");
    doc.setFontSize(11);
    const nameLines = doc.splitTextToSize(customer.party.name, contentWidth - 86) as string[];
    const bannerHeight = Math.max(18, nameLines.length * 4.5 + 8);
    doc.setFillColor(...(settled ? green : orange));
    doc.roundedRect(margin, y, contentWidth, bannerHeight, 1.5, 1.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(nameLines, margin + 4, y + 7);
    setPdfFont(doc, "bold");
    doc.setFontSize(9);
    doc.text(
      settled
        ? t(active, "PAID IN FULL", "पूरा भुगतान", "সম্পূর্ণ পরিশোধ")
        : `${t(active, "DUE", "बाकी", "বাকি")} ${money(customer.summary.remainingPaise)}`,
      right - 4,
      y + bannerHeight / 2 + 2,
      { align: "right", maxWidth: 78 },
    );
    y += bannerHeight + 5;

    writeWrappedDetail(
      [
        `${t(active, "Customer code", "कस्टमर कोड", "ক্রেতার কোড")}: ${customer.party.codeName || "-"}`,
        `${t(active, "Phone", "फ़ोन", "ফোন")}: ${customer.party.phone || "-"}`,
        `GSTIN: ${customer.party.gstin || "-"}`,
        `${t(active, "Price tier", "मूल्य स्तर", "মূল্য স্তর")}: ${customer.party.priceTier}`,
      ].join("  |  "),
      customer.party.name,
      { bold: true },
    );
    writeWrappedDetail(
      `${t(active, "Address", "पता", "ঠিকানা")}: ${customer.party.address || "-"}`,
      customer.party.name,
    );
    writeWrappedDetail(
      `${t(active, "Customer notes", "कस्टमर नोट", "ক্রেতার নোট")}: ${customer.party.notes || "-"}`,
      customer.party.name,
    );
    writeWrappedDetail(
      `${t(active, "Tags", "टैग", "ট্যাগ")}: ${customer.party.tags.join(", ") || "-"}`,
      customer.party.name,
    );
    writeWrappedDetail(
      `${t(active, "Account created", "खाता बनाया", "হিসাব তৈরি")}: ${pdfDateTime(new Date(customer.party.createdAt), active)}  |  ${t(active, "Last updated", "आखिरी बदलाव", "শেষ পরিবর্তন")}: ${pdfDateTime(new Date(customer.party.updatedAt), active)}`,
      customer.party.name,
      { color: muted, gapAfter: 3 },
    );

    const cards: Array<[string, number, [number, number, number]]> = [
      [t(active, "Due added", "जोड़ा बाकी", "যোগ হওয়া বাকি"), customer.summary.totalDueAddedPaise, ink],
      [t(active, "Customer paid", "कस्टमर ने दिया", "ক্রেতা দিয়েছে"), customer.summary.actualPaymentsPaise, green],
      [t(active, "Return credits", "वापसी क्रेडिट", "ফেরত ক্রেডিট"), customer.summary.returnCreditsPaise, forest],
      [t(active, "Cash refunded", "कैश रिफंड", "নগদ ফেরত"), customer.summary.refundsPaidPaise, orange],
      [t(active, "Remaining", "बाकी", "বাকি"), customer.summary.remainingPaise, settled ? green : orange],
    ];
    const customerCardWidth = (contentWidth - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value, color], index) => {
      const x = margin + index * (customerCardWidth + gap);
      doc.setFillColor(...pale);
      doc.setDrawColor(...border);
      doc.roundedRect(x, y, customerCardWidth, 18, 1, 1, "FD");
      setPdfFont(doc, "bold");
      doc.setFontSize(active === "en" ? 7 : 6.8);
      doc.setTextColor(...muted);
      doc.text(label, x + 3, y + 6, { maxWidth: customerCardWidth - 6 });
      doc.setFontSize(8.8);
      doc.setTextColor(...color);
      doc.text(money(value), x + 3, y + 14, { maxWidth: customerCardWidth - 6 });
    });
    y += 24;

    const customerLabel = customer.party.name;
    const tableHeader = () => {
      doc.setFillColor(...forest);
      doc.rect(margin, y, contentWidth, 9, "F");
      doc.setTextColor(255, 255, 255);
      setPdfFont(doc, "bold");
      doc.setFontSize(active === "en" ? 7 : 6.8);
      const columns: Array<[string, number, "left" | "right"]> = [
        [t(active, "BUSINESS DATE", "बिज़नेस तारीख", "ব্যবসার তারিখ"), margin + 2, "left"],
        [t(active, "RECORDED TIME", "रिकॉर्ड समय", "রেকর্ডের সময়"), margin + 31, "left"],
        [t(active, "ACTIVITY / REFERENCE / MODE", "लेन-देन / रेफरेंस / तरीका", "লেনদেন / রেফারেন্স / মাধ্যম"), margin + 72, "left"],
        [t(active, "DUE +", "बाकी +", "বাকি +"), right - 83, "right"],
        [t(active, "PAID/CREDIT -", "पेमेंट/क्रेडिट -", "পেমেন্ট/ক্রেডিট -"), right - 55, "right"],
        [t(active, "REFUND", "रिफंड", "রিফান্ড"), right - 29, "right"],
        [t(active, "BALANCE", "बैलेंस", "ব্যালেন্স"), right - 2, "right"],
      ];
      columns.forEach(([label, x, align]) => doc.text(label, x, y + 5.8, { align, maxWidth: align === "left" ? 68 : 25 }));
      y += 9;
    };
    tableHeader();
    if (!customer.events.length) {
      doc.setTextColor(...muted);
      setPdfFont(doc);
      doc.setFontSize(7.2);
      doc.text(t(active, "No due activity recorded.", "कोई बाकी गतिविधि दर्ज नहीं है।", "কোনো বাকি লেনদেন লেখা নেই।"), margin + 3, y + 7);
      y += 12;
    }
    customer.events.forEach((event, index) => {
      const detail = `${eventActivityLabel(event, active)}${event.reference ? ` | ${event.reference}` : ""}${event.paymentMode ? ` | ${pdfPaymentMode(event.paymentMode, active)}` : ""}`;
      setPdfFont(doc);
      doc.setFontSize(7.2);
      const detailLines = doc.splitTextToSize(detail, 112);
      const rowHeight = Math.max(10, detailLines.length * 3.8 + 4);
      if (y + rowHeight > height - 13) {
        addPage(`${customerLabel} · ${t(active, "ledger continued", "खाता जारी", "খাতা চলবে")}`);
        tableHeader();
      }
      if (index % 2) {
        doc.setFillColor(...pale);
        doc.rect(margin, y, contentWidth, rowHeight, "F");
      }
      doc.setDrawColor(...border);
      doc.line(margin, y + rowHeight, right, y + rowHeight);
      setPdfFont(doc);
      doc.setFontSize(7.2);
      doc.setTextColor(...ink);
      doc.text(pdfDate(event.businessDate, active), margin + 2, y + 5);
      doc.text(pdfDateTime(new Date(event.recordedAt), active), margin + 31, y + 5, { maxWidth: 39 });
      doc.text(detailLines, margin + 72, y + 5);
      setPdfFont(doc, "bold");
      if (event.dueAddedPaise) doc.text(money(event.dueAddedPaise), right - 83, y + 5, { align: "right" });
      if (event.paymentReceivedPaise) {
        doc.setTextColor(...green);
        doc.text(money(event.paymentReceivedPaise), right - 55, y + 5, { align: "right" });
      }
      if (event.refundPaidPaise) {
        doc.setTextColor(...orange);
        doc.text(money(event.refundPaidPaise), right - 29, y + 5, { align: "right" });
      }
      doc.setTextColor(...(event.runningBalancePaise ? orange : green));
      doc.text(money(event.runningBalancePaise), right - 2, y + 5, { align: "right" });
      y += rowHeight;
    });

    ensure(16, customerLabel);
    doc.setFillColor(...(settled ? green : forest));
    doc.rect(margin, y, contentWidth, 12, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(7.1);
    doc.text(t(active, "TOTAL CUSTOMER PAYMENTS", "कुल कस्टमर पेमेंट", "মোট ক্রেতার পেমেন্ট"), margin + 3, y + 5);
    doc.text(money(customer.summary.actualPaymentsPaise), margin + 63, y + 5, { align: "right" });
    doc.text(t(active, "RETURN CREDITS", "वापसी क्रेडिट", "ফেরত ক্রেডিট"), margin + 71, y + 5);
    doc.text(money(customer.summary.returnCreditsPaise), margin + 126, y + 5, { align: "right" });
    doc.text(t(active, "REFUNDS", "रिफंड", "রিফান্ড"), margin + 134, y + 5);
    doc.text(money(customer.summary.refundsPaidPaise), margin + 176, y + 5, { align: "right" });
    doc.setFontSize(8.5);
    doc.text(`${t(active, "REMAINING", "बाकी", "বাকি")} ${money(customer.summary.remainingPaise)}`, right - 3, y + 7, { align: "right" });
    y += 18;

    const appendixTitle = t(active, "INVOICE & RETURN DETAILS", "बिल और वापसी का पूरा विवरण", "বিল ও ফেরতের সম্পূর্ণ বিবরণ");
    ensure(12, customerLabel);
    setPdfFont(doc, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...forest);
    doc.text(appendixTitle, margin, y);
    y += 6;
    if (!customer.invoices.length) {
      writeWrappedDetail(
        t(active, "No invoice or return records; this account history comes from opening/manual dues and payments.", "कोई बिल या वापसी रिकॉर्ड नहीं है; यह हिस्ट्री शुरुआती/हाथ से जोड़े बाकी और पेमेंट से बनी है।", "কোনো বিল বা ফেরত রেকর্ড নেই; এই ইতিহাস শুরুর/হাতে যোগ করা বাকি ও পেমেন্ট থেকে এসেছে।"),
        customerLabel,
        { color: muted, gapAfter: 4 },
      );
    }
    customer.invoices.forEach((invoice) => {
      setPdfFont(doc, "bold");
      doc.setFontSize(7.4);
      const leftHeader = `${invoice.deletedAt ? "VOIDED | " : ""}${invoice.invoiceNumber} | ${pdfDate(invoice.date, active)} | ${pdfDateTime(new Date(invoice.createdAt), active)} | ${invoice.type}`;
      const rightHeader = `${t(active, "Total", "कुल", "মোট")} ${pdfMoney(invoice.grandTotal, active)} | ${t(active, "Paid", "पेमेंट", "পেমেন্ট")} ${pdfMoney(invoice.amountPaid, active)} | ${t(active, "Due", "बाकी", "বাকি")} ${pdfMoney(invoice.amountDue, active)}`;
      const leftHeaderLines = doc.splitTextToSize(leftHeader, contentWidth - 96) as string[];
      const rightHeaderLines = doc.splitTextToSize(rightHeader, 88) as string[];
      const invoiceHeaderHeight = Math.max(leftHeaderLines.length, rightHeaderLines.length) * 4 + 8;
      ensure(invoiceHeaderHeight + 4, customerLabel);
      doc.setFillColor(...pale);
      doc.setDrawColor(...border);
      doc.roundedRect(margin, y, contentWidth, invoiceHeaderHeight, 1, 1, "FD");
      doc.setTextColor(...(invoice.deletedAt ? orange : ink));
      doc.text(leftHeaderLines, margin + 3, y + 5);
      doc.text(rightHeaderLines, right - 3, y + 5, { align: "right" });
      y += invoiceHeaderHeight + 3;
      if (invoice.deletedAt) {
        writeWrappedDetail(
          `${t(active, "Voided at", "रद्द करने का समय", "বাতিলের সময়")}: ${pdfDateTime(new Date(invoice.deletedAt), active)}`,
          customerLabel,
          { bold: true, color: orange },
        );
      }
      writeWrappedDetail(
        `${t(active, "Billed customer", "बिल कस्टमर", "বিলের ক্রেতা")}: ${invoice.partyName || customer.party.name}${invoice.partyGstin ? `  |  GSTIN: ${invoice.partyGstin}` : ""}`,
        customerLabel,
        { color: muted },
      );
      invoice.lineItems.forEach((line, lineIndex) => {
        const localizedNames = [line.itemNameHi, line.itemNameBn]
          .filter((name) => name && name !== line.itemName)
          .join(" / ");
        writeWrappedDetail(
          `${lineIndex + 1}. ${line.itemName}${localizedNames ? ` / ${localizedNames}` : ""}${line.skuCode ? ` [${line.skuCode}]` : ""}  |  HSN: ${line.hsnCode || "-"}`,
          customerLabel,
          { bold: true, fontSize: 7.4, gapAfter: 0.8 },
        );
        const optionalLineFacts = [
          line.baseUnit ? `${t(active, "Base unit", "बेस यूनिट", "মূল একক")}: ${line.baseUnit}` : "",
          line.unitCost != null ? `${t(active, "Stored unit cost", "सेव यूनिट लागत", "সংরক্ষিত একক খরচ")}: ${pdfMoney(line.unitCost, active)}` : "",
          line.lastPriceLabel ? `${t(active, "Price note", "रेट नोट", "দরের নোট")}: ${line.lastPriceLabel}` : "",
          line.lockPrice != null ? `${t(active, "Price locked", "रेट लॉक", "দর লক")}: ${line.lockPrice ? t(active, "Yes", "हाँ", "হ্যাঁ") : t(active, "No", "नहीं", "না")}` : "",
        ].filter(Boolean);
        writeWrappedDetail(
          [
            `${t(active, "Quantity", "मात्रा", "পরিমাণ")}: ${line.qty} ${line.unit}`,
            `${t(active, "Rate", "रेट", "দর")}: ${pdfMoney(line.rate, active)}`,
            `${t(active, "Discount", "छूट", "ছাড়")}: ${line.discount}%`,
            `${t(active, "Taxable", "टैक्स योग्य", "করযোগ্য")}: ${pdfMoney(line.taxableAmount, active)}`,
            `GST: ${line.gstRate}% / ${pdfMoney(line.gstAmount, active)}`,
            `${t(active, "Line total", "लाइन कुल", "লাইনের মোট")}: ${pdfMoney(line.amount, active)}`,
            ...optionalLineFacts,
          ].join("  |  "),
          customerLabel,
          { color: muted, gapAfter: 2 },
        );
        ensure(2, customerLabel);
        doc.setDrawColor(...border);
        doc.line(margin + 3, y, right - 3, y);
        y += 2;
      });
      const charges = (invoice.otherCharges || [])
        .map((charge) => `${charge.label} (${charge.code}): ${pdfMoney(charge.amount, active)}`)
        .join("; ") || "-";
      const tender = (invoice.paymentBreakdown || [])
        .map((part) => `${pdfPaymentMode(part.mode, active)} ${pdfMoney(part.amount, active)}${part.reference ? ` (${part.reference})` : ""}`)
        .join("; ") || `${pdfPaymentMode(invoice.paymentMode, active)}: ${pdfMoney(invoice.initialAmountPaid || 0, active)}`;
      writeWrappedDetail(
        [
          `${t(active, "Subtotal", "सबटोटल", "উপমোট")}: ${pdfMoney(invoice.subtotal, active)}`,
          `${t(active, "Discount", "छूट", "ছাড়")}: ${pdfMoney(invoice.discountTotal, active)}`,
          `GST: ${pdfMoney(invoice.gstTotal, active)}`,
          `${t(active, "Other charges total", "दूसरे चार्ज कुल", "অন্যান্য চার্জ মোট")}: ${pdfMoney(invoice.otherChargesTotal || 0, active)}`,
          `${t(active, "Round-off", "राउंड-ऑफ", "রাউন্ড-অফ")}: ${pdfMoney(invoice.roundOff, active)}`,
          `${t(active, "Grand total", "कुल", "সর্বমোট")}: ${pdfMoney(invoice.grandTotal, active)}`,
        ].join("  |  "),
        customerLabel,
        { bold: true },
      );
      writeWrappedDetail(
        `${t(active, "Other charges", "दूसरे चार्ज", "অন্যান্য চার্জ")}: ${charges}`,
        customerLabel,
      );
      writeWrappedDetail(
        `${t(active, "Tender / reference", "पेमेंट तरीका / रेफरेंस", "পেমেন্ট মাধ্যম / রেফারেন্স")}: ${tender}`,
        customerLabel,
      );
      writeWrappedDetail(
        `${t(active, "Initial payment", "शुरुआती पेमेंट", "প্রাথমিক পেমেন্ট")}: ${pdfMoney(invoice.initialAmountPaid || 0, active)}  |  ${t(active, "Total paid on invoice", "बिल पर कुल मिला", "বিলে মোট পাওয়া")}: ${pdfMoney(invoice.amountPaid, active)}  |  ${t(active, "Invoice due", "बिल बाकी", "বিল বাকি")}: ${pdfMoney(invoice.amountDue, active)}`,
        customerLabel,
      );
      if (invoice.returnDetails) {
        const sourceNumber = invoice.returnDetails.sourceInvoiceId
          ? invoiceByNumber(customer.invoices, invoice.returnDetails.sourceInvoiceId)
          : t(active, "Account-level return", "खाता-स्तर वापसी", "হিসাব-স্তরের ফেরত");
        const allocations = invoice.returnDetails.allocations
          .map((allocation) => `${invoiceByNumber(customer.invoices, allocation.invoiceId)}: ${pdfMoney(allocation.amount, active)}`)
          .join("; ") || "-";
        writeWrappedDetail(
          `${t(active, "Return source", "वापसी स्रोत", "ফেরতের উৎস")}: ${sourceNumber}  |  ${t(active, "Balance credit", "बैलेंस क्रेडिट", "ব্যালেন্স ক্রেডিট")}: ${pdfMoney(invoice.returnDetails.balanceApplied, active)}  |  ${t(active, "Immediate refund", "तुरंत रिफंड", "তাৎক্ষণিক রিফান্ড")}: ${pdfMoney(invoice.returnDetails.settlementAmount, active)}`,
          customerLabel,
          { bold: true, color: forest },
        );
        writeWrappedDetail(
          `${t(active, "Return allocations", "वापसी बँटवारा", "ফেরত বণ্টন")}: ${allocations}`,
          customerLabel,
        );
      }
      writeWrappedDetail(
        `${t(active, "Invoice notes", "बिल नोट", "বিলের নোট")}: ${invoice.notes || "-"}`,
        customerLabel,
        { gapAfter: 4 },
      );
    });
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...border);
    doc.line(margin, height - 8, right, height - 8);
    setPdfFont(doc);
    doc.setFontSize(6.2);
    doc.setTextColor(...muted);
    doc.text("Midori Kanjo | Complete customer dues ledger", margin, height - 4.5);
    doc.text(`${t(active, "Page", "पेज", "পৃষ্ঠা")} ${page}/${pages}`, right, height - 4.5, { align: "right" });
  }
  return doc;
}

async function shareOrDownload(blob: Blob, fileName: string, title: string) {
  assertDuesLedgerSize(blob);
  const nativeResult = await shareNativeBlob(blob, { fileName, title, text: title, dialogTitle: title });
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

export async function downloadDuesLedgerBackup(
  format: "pdf" | "text",
  source: DuesLedgerSource,
  business: BusinessSettings,
  language: Language = "en",
  selectedPartyIds?: string[],
) {
  const envelope = await createDuesLedgerEnvelope(source, business, { selectedPartyIds });
  const date = envelope.payload.snapshotDate;
  const singleCustomer = envelope.payload.customers.length === 1 ? envelope.payload.customers[0] : undefined;
  const safeFilePart = (value: string) => value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const single = singleCustomer
    ? `-${safeFilePart(oneLine(singleCustomer.party.name, 80)) || "customer"}-${safeFilePart(oneLine(singleCustomer.party.codeName, 30)) || singleCustomer.recordId.slice(0, 8)}`
    : "";
  const title = t(language, "Complete customer dues ledger", "पूरा कस्टमर बाकी खाता", "সম্পূর্ণ ক্রেতা বাকি খাতা");
  if (format === "pdf") {
    const doc = await createDuesLedgerPdf(envelope, language);
    return shareOrDownload(doc.output("blob"), `Midori-Kanjo-dues-ledger${single}-${date}.pdf`, title);
  }
  const blob = new Blob([`\uFEFF${duesLedgerText(envelope, language)}`], { type: "text/plain;charset=utf-8" });
  return shareOrDownload(blob, `Midori-Kanjo-dues-ledger${single}-${date}.txt`, title);
}

export async function downloadCurrentDuesLedgerBackup(
  format: "pdf" | "text",
  business: BusinessSettings,
  language: Language = "en",
  selectedPartyIds?: string[],
) {
  const source = await readDuesLedgerSource();
  return downloadDuesLedgerBackup(format, source, business, language, selectedPartyIds);
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DuesLedgerError("invalid_payload", `${label} is not an object.`);
  return value as Record<string, unknown>;
}

function assertSafeLedgerJson(value: unknown, path: string, depth = 0): void {
  if (depth > 32) throw new DuesLedgerError("invalid_payload", `${path} is nested too deeply.`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 2 * 1024 * 1024)
      throw new DuesLedgerError("invalid_payload", `${path} contains an oversized value.`);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DuesLedgerError("invalid_payload", `${path} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeLedgerJson(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object")
    throw new DuesLedgerError("invalid_payload", `${path} is not JSON data.`);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new DuesLedgerError("invalid_payload", `${path} contains a forbidden key.`);
    assertSafeLedgerJson(child, `${path}.${key}`, depth + 1);
  }
}

function string(value: unknown, label: string, max: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new DuesLedgerError("invalid_payload", `${label} is invalid.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new DuesLedgerError("invalid_payload", `${label} is invalid.`);
  return Number(value);
}

function finite(value: unknown, label: string, minimum?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum != null && value < minimum))
    throw new DuesLedgerError("invalid_payload", `${label} is invalid.`);
  return value;
}

function exactBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new DuesLedgerError("invalid_payload", `${label} is invalid.`);
  return value;
}

function validTimestamp(value: unknown, label: string) {
  const parsed = string(value, label, 40);
  if (!Number.isFinite(Date.parse(parsed))) throw new DuesLedgerError("invalid_payload", `${label} is invalid.`);
  return parsed;
}

function validateParty(raw: unknown, index: number): Party {
  const row = object(raw, `Customer ${index + 1}`);
  const priceTier = string(row.priceTier, `Customer ${index + 1} price tier`, 20) as PriceTier;
  if (!priceTiers.includes(priceTier)) throw new DuesLedgerError("invalid_payload", `Customer ${index + 1} has an invalid price tier.`);
  if (row.type !== "customer") throw new DuesLedgerError("invalid_payload", `Customer ${index + 1} is not a customer account.`);
  const tags = Array.isArray(row.tags) ? row.tags.map((tag, tagIndex) => string(tag, `Customer ${index + 1} tag ${tagIndex + 1}`, 500)) : [];
  return {
    id: string(row.id, `Customer ${index + 1} ID`, 200),
    name: string(row.name, `Customer ${index + 1} name`, 200),
    codeName: string(row.codeName, `Customer ${index + 1} code`, 80, true),
    phone: string(row.phone, `Customer ${index + 1} phone`, 40, true),
    address: string(row.address, `Customer ${index + 1} address`, 500, true),
    ...(row.gstin ? { gstin: string(row.gstin, `Customer ${index + 1} GSTIN`, 40) } : {}),
    type: "customer",
    priceTier,
    openingBalance: finite(row.openingBalance, `Customer ${index + 1} opening balance`, 0),
    currentBalance: finite(row.currentBalance, `Customer ${index + 1} current balance`, 0),
    notes: string(row.notes, `Customer ${index + 1} notes`, 20_000, true),
    tags,
    createdAt: validTimestamp(row.createdAt, `Customer ${index + 1} created time`),
    updatedAt: validTimestamp(row.updatedAt, `Customer ${index + 1} updated time`),
    isSynced: exactBoolean(row.isSynced, `Customer ${index + 1} sync state`),
  };
}

function validateInvoice(raw: unknown, customerIndex: number, sourcePartyId: string): Invoice {
  const row = object(raw, `Customer ${customerIndex + 1} invoice`);
  const invoice = cloneJson(row) as unknown as Invoice;
  string(invoice.id, "Invoice ID", 200);
  string(invoice.invoiceNumber, "Invoice number", 200);
  string(invoice.partyName, "Invoice customer name", 500, true);
  if (invoice.partyGstin != null) string(invoice.partyGstin, "Invoice customer GSTIN", 80, true);
  if (invoice.partyId !== sourcePartyId || (invoice.type !== "sale" && invoice.type !== "sale_return"))
    throw new DuesLedgerError("invalid_payload", "A ledger invoice has the wrong party or type.");
  if (!isValidLocalDate(invoice.date) || !Array.isArray(invoice.lineItems) || !invoice.lineItems.length)
    throw new DuesLedgerError("invalid_payload", "A ledger invoice has an invalid date or line list.");
  [invoice.subtotal, invoice.discountTotal, invoice.gstTotal, invoice.grandTotal, invoice.amountPaid, invoice.amountDue]
    .forEach((amount, index) => finite(amount, `Invoice amount ${index + 1}`, 0));
  finite(invoice.initialAmountPaid, "Invoice initial payment", 0);
  finite(invoice.roundOff, "Invoice round-off");
  if (Math.abs(invoice.roundOff) > 0.5)
    throw new DuesLedgerError("invalid_payload", "A ledger invoice has an invalid round-off.");
  if (!(paymentModes as readonly string[]).includes(invoice.paymentMode))
    throw new DuesLedgerError("invalid_payload", "A ledger invoice has an invalid payment mode.");
  if (invoice.paymentReceivedMode != null && !(paymentChannels as readonly string[]).includes(invoice.paymentReceivedMode))
    throw new DuesLedgerError("invalid_payload", "A ledger return has an invalid settlement mode.");
  string(invoice.notes, "Invoice notes", 50_000, true);
  exactBoolean(invoice.isSynced, "Invoice sync state");
  validTimestamp(invoice.createdAt, "Invoice created time");
  validTimestamp(invoice.updatedAt, "Invoice updated time");
  if (invoice.deletedAt != null) validTimestamp(invoice.deletedAt, "Invoice void time");
  let subtotal = 0;
  let discountTotal = 0;
  let gstTotal = 0;
  let lineTotal = 0;
  invoice.lineItems.forEach((line, index) => {
    string(line.itemId, `Invoice line ${index + 1} item ID`, 200);
    string(line.itemName, `Invoice line ${index + 1} name`, 500);
    if (line.itemNameHi != null) string(line.itemNameHi, `Invoice line ${index + 1} Hindi name`, 500, true);
    if (line.itemNameBn != null) string(line.itemNameBn, `Invoice line ${index + 1} Bengali name`, 500, true);
    string(line.skuCode, `Invoice line ${index + 1} SKU`, 200, true);
    string(line.hsnCode, `Invoice line ${index + 1} HSN`, 100, true);
    finite(line.qty, `Invoice line ${index + 1} quantity`, Number.EPSILON);
    if (!(invoiceUnits as readonly string[]).includes(line.unit))
      throw new DuesLedgerError("invalid_payload", `Invoice line ${index + 1} has an invalid unit.`);
    if (line.baseUnit != null && !(invoiceUnits as readonly string[]).includes(line.baseUnit))
      throw new DuesLedgerError("invalid_payload", `Invoice line ${index + 1} has an invalid base unit.`);
    finite(line.rate, `Invoice line ${index + 1} rate`, 0);
    finite(line.discount, `Invoice line ${index + 1} discount`, 0);
    if (line.discount > 100) throw new DuesLedgerError("invalid_payload", `Invoice line ${index + 1} has an invalid discount.`);
    finite(line.taxableAmount, `Invoice line ${index + 1} taxable amount`, 0);
    finite(line.gstRate, `Invoice line ${index + 1} GST rate`, 0);
    if (line.gstRate > 100) throw new DuesLedgerError("invalid_payload", `Invoice line ${index + 1} has an invalid GST rate.`);
    finite(line.gstAmount, `Invoice line ${index + 1} GST amount`, 0);
    finite(line.amount, `Invoice line ${index + 1} amount`, 0);
    if (line.unitCost != null) finite(line.unitCost, `Invoice line ${index + 1} unit cost`, 0);
    if (line.lastPriceLabel != null) string(line.lastPriceLabel, `Invoice line ${index + 1} price label`, 500, true);
    if (line.lockPrice != null) exactBoolean(line.lockPrice, `Invoice line ${index + 1} price lock`);
    if (line.sourceLineIndex != null) integer(line.sourceLineIndex, `Invoice line ${index + 1} source position`);
    const gross = roundMoney(line.qty * line.rate);
    const expectedDiscount = roundMoney(gross * line.discount / 100);
    const expectedTaxable = roundMoney(gross - expectedDiscount);
    const expectedGst = roundMoney(expectedTaxable * line.gstRate / 100);
    const expectedAmount = roundMoney(expectedTaxable + expectedGst);
    if (Math.abs(roundMoney(line.taxableAmount) - expectedTaxable) >= 0.01 ||
        Math.abs(roundMoney(line.gstAmount) - expectedGst) >= 0.01 ||
        Math.abs(roundMoney(line.amount) - expectedAmount) >= 0.01)
      throw new DuesLedgerError("invalid_payload", `Invoice line ${index + 1} totals do not reconcile.`);
    subtotal = roundMoney(subtotal + gross);
    discountTotal = roundMoney(discountTotal + expectedDiscount);
    gstTotal = roundMoney(gstTotal + expectedGst);
    lineTotal = roundMoney(lineTotal + expectedAmount);
  });
  const chargeCodes = ["carrier", "packing", "big_box"];
  if (invoice.otherCharges != null && !Array.isArray(invoice.otherCharges))
    throw new DuesLedgerError("invalid_payload", "Invoice other charges are invalid.");
  let chargesTotal = 0;
  for (const charge of invoice.otherCharges || []) {
    if (!chargeCodes.includes(charge.code)) throw new DuesLedgerError("invalid_payload", "Invoice charge code is invalid.");
    string(charge.label, "Invoice charge label", 500);
    chargesTotal = roundMoney(chargesTotal + finite(charge.amount, "Invoice charge amount", 0));
  }
  if (invoice.otherChargesTotal != null && Math.abs(roundMoney(invoice.otherChargesTotal) - chargesTotal) >= 0.01)
    throw new DuesLedgerError("invalid_payload", "Invoice other-charge total does not reconcile.");
  const expectedGrand = Math.round(roundMoney(lineTotal + chargesTotal));
  const expectedRoundOff = roundMoney(expectedGrand - roundMoney(lineTotal + chargesTotal));
  if (Math.abs(roundMoney(invoice.subtotal) - subtotal) >= 0.01 ||
      Math.abs(roundMoney(invoice.discountTotal) - discountTotal) >= 0.01 ||
      Math.abs(roundMoney(invoice.gstTotal) - gstTotal) >= 0.01 ||
      Math.abs(roundMoney(invoice.grandTotal) - expectedGrand) >= 0.01 ||
      Math.abs(roundMoney(invoice.roundOff) - expectedRoundOff) >= 0.01)
    throw new DuesLedgerError("invalid_payload", "Invoice totals do not reconcile to its line items.");
  if (invoice.paymentBreakdown) {
    if (!Array.isArray(invoice.paymentBreakdown)) throw new DuesLedgerError("invalid_payload", "Invoice payment breakdown is invalid.");
    let breakdownTotal = 0;
    invoice.paymentBreakdown.forEach((allocation) => {
      if (!paymentChannels.includes(allocation.mode)) throw new DuesLedgerError("invalid_payload", "Invoice payment mode is invalid.");
      breakdownTotal = roundMoney(breakdownTotal + finite(allocation.amount, "Invoice payment amount", 0));
      if (allocation.reference != null) string(allocation.reference, "Invoice payment reference", 2_000, true);
    });
    if (Math.abs(roundMoney(invoice.initialAmountPaid || 0) - breakdownTotal) >= 0.01)
      throw new DuesLedgerError("invalid_payload", "Invoice initial tender total does not reconcile.");
  }
  const isReturn = invoice.type === "sale_return";
  if (isReturn && !invoice.returnDetails)
    throw new DuesLedgerError("invalid_payload", "A sales return is missing its settlement details.");
  if (!isReturn && invoice.returnDetails)
    throw new DuesLedgerError("invalid_payload", "A sale bill contains unexpected return details.");
  if (invoice.returnDetails) {
    const details = invoice.returnDetails;
    if (details.sourceInvoiceId != null) string(details.sourceInvoiceId, "Return source invoice ID", 200);
    if (!Array.isArray(details.allocations))
      throw new DuesLedgerError("invalid_payload", "A return allocation list is invalid.");
    finite(details.balanceApplied, "Return balance credit", 0);
    finite(details.settlementAmount, "Return immediate refund", 0);
    let allocated = 0;
    for (const allocation of details.allocations) {
      string(allocation.invoiceId, "Return allocation invoice ID", 200);
      allocated += finite(allocation.amount, "Return allocation amount", 0);
    }
    if (roundMoney(allocated) > roundMoney(details.balanceApplied) ||
        Math.abs(roundMoney(details.balanceApplied + details.settlementAmount) - roundMoney(invoice.grandTotal)) >= 0.01)
      throw new DuesLedgerError("invalid_payload", "A return settlement does not reconcile to its total.");
  }
  return invoice;
}

function validatePayment(raw: unknown, sourcePartyId: string, invoiceIds: Set<string>): Payment {
  const payment = cloneJson(object(raw, "Payment")) as unknown as Payment;
  string(payment.id, "Payment ID", 200);
  if (payment.partyId !== sourcePartyId || !paymentChannels.includes(payment.mode))
    throw new DuesLedgerError("invalid_payload", "A ledger payment has the wrong party or mode.");
  finite(payment.amount, "Payment amount", 0.01);
  if (!isValidLocalDate(payment.date) || !Array.isArray(payment.allocatedTo))
    throw new DuesLedgerError("invalid_payload", "A ledger payment has an invalid date or allocation list.");
  string(payment.reference, "Payment reference", 2_000, true);
  let allocated = 0;
  const allocationIds = new Set<string>();
  payment.allocatedTo.forEach((allocation) => {
    string(allocation.invoiceId, "Payment allocation invoice ID", 200);
    if (!invoiceIds.has(allocation.invoiceId)) throw new DuesLedgerError("invalid_payload", "A payment allocation points outside this customer's archive.");
    if (allocationIds.has(allocation.invoiceId)) throw new DuesLedgerError("invalid_payload", "A payment contains duplicate allocations to one invoice.");
    allocationIds.add(allocation.invoiceId);
    allocated += finite(allocation.amount, "Payment allocation", 0);
  });
  if (roundMoney(allocated) > roundMoney(payment.amount))
    throw new DuesLedgerError("invalid_payload", "Payment allocations exceed the payment amount.");
  validTimestamp(payment.createdAt, "Payment created time");
  validTimestamp(payment.updatedAt, "Payment updated time");
  exactBoolean(payment.isSynced, "Payment sync state");
  return payment;
}

function validateEntry(raw: unknown, sourcePartyId: string): AccountEntry {
  const entry = cloneJson(object(raw, "Manual due")) as unknown as AccountEntry;
  string(entry.id, "Manual due ID", 200);
  if (entry.partyId !== sourcePartyId || entry.kind !== "due")
    throw new DuesLedgerError("invalid_payload", "A manual due has the wrong party or type.");
  finite(entry.amount, "Manual due amount", 0.01);
  if (!isValidLocalDate(entry.date)) throw new DuesLedgerError("invalid_payload", "A manual due has an invalid date.");
  string(entry.note, "Manual due note", 50_000, true);
  string(entry.reference, "Manual due reference", 2_000, true);
  validTimestamp(entry.createdAt, "Manual due created time");
  validTimestamp(entry.updatedAt, "Manual due updated time");
  exactBoolean(entry.isSynced, "Manual due sync state");
  return entry;
}

function summaryFor(statement: PartyDueStatement) {
  return {
    totalDueAddedPaise: paise(statement.totalDueAdded),
    actualPaymentsPaise: paise(statement.totalPaid),
    returnCreditsPaise: paise(statement.totalReturnCredits),
    refundsPaidPaise: paise(statement.totalRefunded),
    balanceAdjustmentsPaise: paise(statement.totalBalanceAdjustments),
    remainingPaise: paise(statement.remainingDue),
  };
}

function validatePayload(value: unknown): DuesLedgerPayload {
  assertSafeLedgerJson(value, "Ledger payload");
  const raw = object(value, "Ledger payload");
  if (raw.format !== DUES_LEDGER_FORMAT) throw new DuesLedgerError("not_backup", "This is not a complete Midori Kanjo dues ledger backup.");
  if (raw.version !== DUES_LEDGER_VERSION) throw new DuesLedgerError("unsupported_version", "This dues ledger version is not supported.");
  if (raw.currency !== "INR") throw new DuesLedgerError("wrong_currency", "Only INR dues ledgers can be restored.");
  const exportedAt = validTimestamp(raw.exportedAt, "Export time");
  const snapshotDate = string(raw.snapshotDate, "Snapshot date", 10);
  if (!isValidLocalDate(snapshotDate)) throw new DuesLedgerError("invalid_payload", "The snapshot date is invalid.");
  const sourceRaw = object(raw.source, "Source");
  const source = {
    datasetId: string(sourceRaw.datasetId, "Dataset ID", 200),
    businessName: string(sourceRaw.businessName, "Business name", 200),
    businessAddress: string(sourceRaw.businessAddress, "Business address", 500, true),
    businessPhone: string(sourceRaw.businessPhone, "Business phone", 40, true),
    businessGstin: string(sourceRaw.businessGstin, "Business GSTIN", 40, true),
    appVersion: string(sourceRaw.appVersion, "App version", 40),
  };
  const customerCount = integer(raw.customerCount, "Customer count");
  if (customerCount > MAX_DUES_LEDGER_CUSTOMERS || !Array.isArray(raw.customers) || raw.customers.length !== customerCount)
    throw new DuesLedgerError("invalid_payload", "The customer count does not match the ledger.");
  const customerIds = new Set<string>();
  const recordIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const invoiceNumbers = new Set<string>();
  const paymentIds = new Set<string>();
  const entryIds = new Set<string>();
  const customers = raw.customers.map((unknownCustomer, customerIndex) => {
    const customerRaw = object(unknownCustomer, `Customer ${customerIndex + 1}`);
    const party = validateParty(customerRaw.party, customerIndex);
    const sourcePartyId = string(customerRaw.sourcePartyId, `Customer ${customerIndex + 1} source ID`, 200);
    if (sourcePartyId !== party.id || customerIds.has(sourcePartyId))
      throw new DuesLedgerError("invalid_payload", "The ledger contains a duplicate or mismatched customer ID.");
    customerIds.add(sourcePartyId);
    const storedRecordId = string(customerRaw.recordId, `Customer ${customerIndex + 1} record ID`, 64);
    if (storedRecordId !== recordId(source.datasetId, sourcePartyId) || recordIds.has(storedRecordId))
      throw new DuesLedgerError("invalid_payload", "A customer record ID is invalid or duplicated.");
    recordIds.add(storedRecordId);
    if (!Array.isArray(customerRaw.invoices) || !Array.isArray(customerRaw.payments) || !Array.isArray(customerRaw.accountEntries) || !Array.isArray(customerRaw.events))
      throw new DuesLedgerError("invalid_payload", "A customer ledger section is incomplete.");
    const invoices = customerRaw.invoices.map((invoice) => validateInvoice(invoice, customerIndex, sourcePartyId));
    invoices.forEach((invoice) => {
      if (invoiceIds.has(invoice.id) || invoiceNumbers.has(invoice.invoiceNumber))
        throw new DuesLedgerError("invalid_payload", "The ledger contains duplicate invoices or invoice numbers.");
      invoiceIds.add(invoice.id);
      invoiceNumbers.add(invoice.invoiceNumber);
    });
    const localInvoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    for (const invoice of invoices) {
      if (invoice.type !== "sale_return" || !invoice.returnDetails) continue;
      const relatedIds = [
        ...(invoice.returnDetails.sourceInvoiceId ? [invoice.returnDetails.sourceInvoiceId] : []),
        ...invoice.returnDetails.allocations.map((allocation) => allocation.invoiceId),
      ];
      for (const relatedId of relatedIds) {
        const related = localInvoiceById.get(relatedId);
        if (!related || related.deletedAt || related.type !== "sale" || related.partyId !== sourcePartyId)
          throw new DuesLedgerError("invalid_payload", "A return points outside this customer's sale history.");
      }
      const allocationIds = invoice.returnDetails.allocations.map((allocation) => allocation.invoiceId);
      if (new Set(allocationIds).size !== allocationIds.length)
        throw new DuesLedgerError("invalid_payload", "A return contains duplicate allocations to one invoice.");
    }
    const payableInvoiceIds = new Set(invoices
      .filter((invoice) => invoice.type === "sale" && !invoice.deletedAt)
      .map((invoice) => invoice.id));
    const payments = customerRaw.payments.map((payment) => validatePayment(payment, sourcePartyId, payableInvoiceIds));
    payments.forEach((payment) => {
      if (paymentIds.has(payment.id)) throw new DuesLedgerError("invalid_payload", "The ledger contains a duplicate payment ID.");
      paymentIds.add(payment.id);
    });
    const laterAllocated = new Map<string, number>();
    for (const payment of payments) for (const allocation of payment.allocatedTo) {
      laterAllocated.set(allocation.invoiceId, roundMoney((laterAllocated.get(allocation.invoiceId) || 0) + allocation.amount));
    }
    const returnCredits = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.deletedAt || invoice.type !== "sale_return") continue;
      for (const allocation of invoice.returnDetails?.allocations || [])
        returnCredits.set(allocation.invoiceId, roundMoney((returnCredits.get(allocation.invoiceId) || 0) + allocation.amount));
    }
    for (const invoice of invoices) {
      if (invoice.type === "sale_return") {
        const settlement = roundMoney(invoice.returnDetails?.settlementAmount || 0);
        if (Math.abs(roundMoney(invoice.amountPaid) - settlement) >= 0.01 || Math.abs(roundMoney(invoice.amountDue)) >= 0.01)
          throw new DuesLedgerError("invalid_payload", "A return invoice has stale settlement totals.");
        continue;
      }
      const initial = invoiceInitialPaymentBreakdown(invoice, laterAllocated.get(invoice.id) || 0)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      const later = laterAllocated.get(invoice.id) || 0;
      if (invoice.deletedAt) {
        if (roundMoney(initial + later) >= 0.01)
          throw new DuesLedgerError("invalid_payload", "A deleted bill still contains a receipt and cannot be restored safely.");
        continue;
      }
      const expectedPaid = roundMoney(Math.min(invoice.grandTotal, initial + later));
      const credited = returnCredits.get(invoice.id) || 0;
      if (roundMoney(initial + later + credited) > roundMoney(invoice.grandTotal))
        throw new DuesLedgerError("invalid_payload", "Payments and return credits exceed a sale bill's total.");
      const expectedDue = roundMoney(Math.max(0, invoice.grandTotal - expectedPaid - credited));
      if (Math.abs(roundMoney(invoice.amountPaid) - expectedPaid) >= 0.01 || Math.abs(roundMoney(invoice.amountDue) - expectedDue) >= 0.01)
        throw new DuesLedgerError("invalid_payload", "A sale bill has stale paid or due totals.");
    }
    const accountEntries = customerRaw.accountEntries.map((entry) => validateEntry(entry, sourcePartyId));
    accountEntries.forEach((entry) => {
      if (entryIds.has(entry.id)) throw new DuesLedgerError("invalid_payload", "The ledger contains a duplicate manual-due ID.");
      entryIds.add(entry.id);
    });
    const statement = partyDueStatement(party, invoices, payments, accountEntries);
    if (paise(statement.totalPaid + statement.totalReturnCredits) > paise(statement.totalDueAdded))
      throw new DuesLedgerError("invalid_payload", "A customer ledger contains payments or credits beyond the recorded dues.");
    const expectedEvents = statement.rows.map((row) => archiveEvent(row, invoices));
    if (expectedEvents.some((event) => event.kind === "balance_adjustment"))
      throw new DuesLedgerError("invalid_payload", "A complete ledger cannot contain a synthetic balance adjustment. Reconcile the account before exporting it.");
    if (canonicalJson(customerRaw.events) !== canonicalJson(expectedEvents))
      throw new DuesLedgerError("invalid_payload", "A customer's event timeline does not match the saved transactions.");
    const summary = summaryFor(statement);
    if (canonicalJson(customerRaw.summary) !== canonicalJson(summary))
      throw new DuesLedgerError("invalid_payload", "A customer's totals do not match the saved transactions.");
    const status = statement.remainingDue > 0 ? "outstanding" as const : "paid_in_full" as const;
    if (customerRaw.status !== status)
      throw new DuesLedgerError("invalid_payload", "A customer's paid status does not match the remaining balance.");
    return {
      recordId: storedRecordId,
      sourcePartyId,
      party,
      status,
      summary,
      events: expectedEvents,
      invoices,
      payments,
      accountEntries,
    } satisfies DuesLedgerCustomer;
  });
  const transactionCount = customers.reduce((sum, customer) => sum + customer.invoices.length + customer.payments.length + customer.accountEntries.length, 0);
  if (transactionCount !== integer(raw.transactionCount, "Transaction count") || transactionCount > MAX_DUES_LEDGER_TRANSACTIONS)
    throw new DuesLedgerError("invalid_payload", "The transaction count does not match the ledger.");
  const outstandingCount = customers.filter((customer) => customer.status === "outstanding").length;
  const settledCount = customers.filter((customer) => customer.status === "paid_in_full").length;
  const totalRemainingPaise = customers.reduce((sum, customer) => sum + customer.summary.remainingPaise, 0);
  if (outstandingCount !== integer(raw.outstandingCount, "Outstanding count") || settledCount !== integer(raw.settledCount, "Settled count") || totalRemainingPaise !== integer(raw.totalRemainingPaise, "Remaining total"))
    throw new DuesLedgerError("invalid_payload", "The ledger summary does not match the customer records.");
  const backupId = string(raw.backupId, "Backup ID", 64);
  const expectedId = sha256Hex(canonicalJson({ format: DUES_LEDGER_FORMAT, version: DUES_LEDGER_VERSION, datasetId: source.datasetId, customers }));
  if (!/^[a-f0-9]{64}$/.test(backupId) || backupId !== expectedId)
    throw new DuesLedgerError("invalid_payload", "The ledger backup ID does not match its records.");
  return {
    format: DUES_LEDGER_FORMAT,
    version: DUES_LEDGER_VERSION,
    backupId,
    exportedAt,
    snapshotDate,
    currency: "INR",
    source,
    customerCount,
    outstandingCount,
    settledCount,
    transactionCount,
    totalRemainingPaise,
    customers,
  };
}

function markerParts(token: string) {
  const match = new RegExp(`^${DUES_LEDGER_MARKER}\\.([a-f0-9]{64})\\.([A-Za-z0-9_-]+)$`).exec(token.trim());
  if (!match) throw new DuesLedgerError("invalid_payload", "The ledger restore marker is malformed.");
  return { checksum: match[1], encoded: match[2] };
}

function extractTextMarker(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const begin = "----- MIDORI KANJO RESTORE DATA -----";
  const end = "----- END MIDORI KANJO RESTORE DATA -----";
  const beginMatches = [...normalized.matchAll(/^----- MIDORI KANJO RESTORE DATA -----$/gm)];
  const endMatches = [...normalized.matchAll(/^----- END MIDORI KANJO RESTORE DATA -----$/gm)];
  if (!beginMatches.length || !endMatches.length)
    throw new DuesLedgerError("not_backup", "This is not a complete Midori Kanjo dues ledger backup.");
  if (beginMatches.length !== 1 || endMatches.length !== 1)
    throw new DuesLedgerError("duplicate_payload", "The file contains more than one ledger restore payload.");
  const block = new RegExp(`\\n${begin}\\n([^\\n]+)\\n${end}\\n?$`).exec(normalized);
  if (!block) throw new DuesLedgerError("invalid_payload", "The ledger restore block is incomplete or is not at the end of the text file.");
  return markerParts(block[1]);
}

function extractPdfMarker(text: string) {
  const namespace = DUES_LEDGER_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(
    `<rdf:Description rdf:about="" xmlns:jspdf="${namespace}"><jspdf:metadata>(${DUES_LEDGER_MARKER}\\.[a-f0-9]{64}\\.[A-Za-z0-9_-]+)</jspdf:metadata></rdf:Description>`,
    "g",
  ))];
  if (!matches.length) throw new DuesLedgerError("not_backup", "This PDF does not contain Midori Kanjo ledger restore metadata.");
  if (matches.length !== 1) throw new DuesLedgerError("duplicate_payload", "The PDF contains more than one ledger restore payload.");
  return markerParts(matches[0][1]);
}

export function parseDuesLedgerBytes(bytes: Uint8Array): DuesLedgerEnvelope {
  if (bytes.byteLength > MAX_DUES_LEDGER_BYTES) throw new DuesLedgerError("file_too_large", "The selected ledger is larger than 64 MiB.");
  const latin = new TextDecoder("latin1").decode(bytes);
  const isPdf = latin.startsWith("%PDF-");
  let text = latin;
  if (!isPdf) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new DuesLedgerError("not_backup", "Choose a Midori Kanjo dues ledger PDF or UTF-8 text file."); }
    if (text.includes("\u0000") || !text.includes("----- MIDORI KANJO RESTORE DATA -----") || !text.includes("----- END MIDORI KANJO RESTORE DATA -----"))
      throw new DuesLedgerError("not_backup", "Choose a Midori Kanjo dues ledger PDF or text file.");
  } else if (!latin.includes("/Type /Metadata") || !latin.includes("/Subtype /XML")) {
    throw new DuesLedgerError("not_backup", "This PDF does not contain Midori Kanjo ledger restore metadata.");
  }
  const { checksum, encoded } = isPdf ? extractPdfMarker(text) : extractTextMarker(text);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded))); }
  catch (cause) {
    if (cause instanceof DuesLedgerError) throw cause;
    throw new DuesLedgerError("invalid_payload", "The ledger restore payload is not valid UTF-8 JSON.");
  }
  const payload = validatePayload(parsed);
  if (sha256Hex(canonicalPayload(payload)) !== checksum)
    throw new DuesLedgerError("checksum_mismatch", "The ledger is damaged or has been edited.");
  return { payload, checksum };
}

export async function parseDuesLedgerFile(file: File) {
  if (file.size > MAX_DUES_LEDGER_BYTES) throw new DuesLedgerError("file_too_large", "The selected ledger is larger than 64 MiB.");
  return parseDuesLedgerBytes(new Uint8Array(await file.arrayBuffer()));
}

const normalizeGstin = (value?: string) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const mergedInto = (party: Party) => party.tags.find((tag) => tag.startsWith("mergedInto:"))?.slice("mergedInto:".length).trim() || "";

function compatibleIdentity(party: Party, record: DuesLedgerCustomer) {
  const source = record.party;
  const name = normalizePartyIdentity(party.name) === normalizePartyIdentity(source.name);
  const partyCode = normalizePartyCode(party.codeName);
  const sourceCode = normalizePartyCode(source.codeName);
  const partyPhone = normalizePhoneDigits(party.phone);
  const sourcePhone = normalizePhoneDigits(source.phone);
  const partyGstin = normalizeGstin(party.gstin);
  const sourceGstin = normalizeGstin(source.gstin);
  const codeConflict = Boolean(partyCode && sourceCode && partyCode !== sourceCode);
  const phoneConflict = Boolean(partyPhone.length >= 8 && sourcePhone.length >= 8 && partyPhone !== sourcePhone);
  const gstinConflict = Boolean(partyGstin && sourceGstin && partyGstin !== sourceGstin);
  const corroborating = Boolean(
    (partyCode && sourceCode && partyCode === sourceCode) ||
    (partyPhone.length >= 8 && sourcePhone.length >= 8 && partyPhone === sourcePhone) ||
    (partyGstin && sourceGstin && partyGstin === sourceGstin) ||
    (normalizePartyIdentity(party.address) && normalizePartyIdentity(party.address) === normalizePartyIdentity(source.address)),
  );
  return name && corroborating && !codeConflict && !phoneConflict && !gstinConflict;
}

function comparable<T>(value: T) {
  const withoutSync = JSON.parse(JSON.stringify(value, (key, child) => key === "isSynced" ? undefined : child)) as unknown;
  return canonicalJson(withoutSync);
}

function comparableArchivedInvoice(invoice: Invoice) {
  // Later, legitimate payments and return credits update these cached fields.
  // Every immutable bill field (including notes, lines, totals and deletedAt)
  // remains part of the archived comparison.
  const {
    isSynced: _isSynced,
    updatedAt: _updatedAt,
    amountPaid: _amountPaid,
    amountDue: _amountDue,
    ...snapshot
  } = cloneJson(invoice);
  void _isSynced;
  void _updatedAt;
  void _amountPaid;
  void _amountDue;
  return canonicalJson(snapshot);
}

function exactHistoryPresent(
  record: DuesLedgerCustomer,
  party: Party,
  invoices: Invoice[],
  payments: Payment[],
  entries: AccountEntry[],
) {
  if (party.id !== record.sourcePartyId) return false;
  const partyComparable = { ...party, isSynced: false };
  const sourceComparable = { ...record.party, isSynced: false };
  if (comparable(partyComparable) !== comparable(sourceComparable)) return false;
  const order = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return comparable(order(invoices.filter((invoice) => invoice.partyId === party.id && (invoice.type === "sale" || invoice.type === "sale_return")))) === comparable(order(record.invoices)) &&
    comparable(order(payments.filter((payment) => payment.partyId === party.id))) === comparable(order(record.payments)) &&
    comparable(order(entries.filter((entry) => entry.partyId === party.id))) === comparable(order(record.accountEntries));
}

const importMarkerKey = (payload: DuesLedgerPayload, record: DuesLedgerCustomer) =>
  `dues-ledger-import:${payload.backupId}:${record.recordId}`;

function summarize(envelope: DuesLedgerEnvelope, rows: DuesLedgerRestoreRow[]): DuesLedgerRestorePreview {
  const ready = rows.filter((row) => row.status === "ready_new" || row.status === "ready_existing");
  return {
    envelope,
    rows,
    readyCount: ready.length,
    readyPaise: ready.reduce((sum, row) => sum + row.record.summary.remainingPaise, 0),
    readyTransactions: ready.reduce((sum, row) => sum + row.record.invoices.length + row.record.payments.length + row.record.accountEntries.length, 0),
    newCount: rows.filter((row) => row.status === "ready_new").length,
    matchedCount: rows.filter((row) => row.status === "ready_existing").length,
    alreadyCount: rows.filter((row) => row.status === "already_restored" || row.status === "already_present").length,
    conflictCount: rows.filter((row) => row.status === "conflict").length,
  };
}

function previewRows(
  envelope: DuesLedgerEnvelope,
  parties: Party[],
  invoices: Invoice[],
  payments: Payment[],
  entries: AccountEntry[],
  importMarkers: Map<string, unknown>,
) {
  const partiesById = new Map(parties.map((party) => [party.id, party]));
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const invoiceByNumber = new Map(invoices.map((invoice) => [invoice.invoiceNumber, invoice]));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const claimed = new Map<string, number>();
  const rows: DuesLedgerRestoreRow[] = envelope.payload.customers.map((record): DuesLedgerRestoreRow => {
    const marker = importMarkers.get(importMarkerKey(envelope.payload, record));
    if (marker != null) {
      let destinationId = record.sourcePartyId;
      try {
        const parsed = JSON.parse(String(marker)) as { destinationPartyId?: unknown };
        if (typeof parsed.destinationPartyId === "string" && parsed.destinationPartyId) destinationId = parsed.destinationPartyId;
      } catch {}
      const current = partiesById.get(destinationId);
      const complete = Boolean(
        current && current.type === "customer" &&
        record.invoices.every((invoice) => {
          const saved = invoiceById.get(invoice.id);
          return Boolean(saved && comparableArchivedInvoice(saved) === comparableArchivedInvoice({ ...invoice, partyId: destinationId }));
        }) &&
        record.payments.every((payment) => {
          const saved = paymentById.get(payment.id);
          return Boolean(saved && comparable(saved) === comparable({ ...payment, partyId: destinationId }));
        }) &&
        record.accountEntries.every((entry) => {
          const saved = entryById.get(entry.id);
          return Boolean(saved && comparable(saved) === comparable({ ...entry, partyId: destinationId }));
        }),
      );
      if (!complete)
        return { record, status: "conflict" as const, reason: "record_collision" as const, destinationPartyId: current?.id || destinationId, destinationPartyName: current?.name, currentPaise: paise(current?.currentBalance || 0) };
      return { record, status: "already_restored" as const, reason: "same_archive_imported" as const, destinationPartyId: current!.id, destinationPartyName: current!.name, currentPaise: paise(current!.currentBalance) };
    }
    const direct = partiesById.get(record.sourcePartyId);
    if (direct?.type === "supplier")
      return { record, status: "conflict" as const, reason: "supplier_collision" as const, destinationPartyId: direct.id, destinationPartyName: direct.name, currentPaise: paise(direct.currentBalance) };
    if (direct && exactHistoryPresent(record, direct, invoices, payments, entries))
      return { record, status: "already_present" as const, reason: "same_history_present" as const, destinationPartyId: direct.id, destinationPartyName: direct.name, currentPaise: paise(direct.currentBalance) };
    if (direct && (mergedInto(direct) || !compatibleIdentity(direct, record)))
      return { record, status: "conflict" as const, reason: "identity_collision" as const, destinationPartyId: direct.id, destinationPartyName: direct.name, currentPaise: paise(direct.currentBalance) };

    const strongMatches = parties.filter((party) => {
      if (mergedInto(party)) return false;
      const code = normalizePartyCode(record.party.codeName);
      const phone = normalizePhoneDigits(record.party.phone);
      const gstin = normalizeGstin(record.party.gstin);
      return Boolean(
        (code && normalizePartyCode(party.codeName) === code) ||
        (phone.length >= 8 && normalizePhoneDigits(party.phone) === phone) ||
        (gstin && normalizeGstin(party.gstin) === gstin) ||
        (normalizePartyIdentity(record.party.name) === normalizePartyIdentity(party.name) && normalizePartyIdentity(record.party.address) && normalizePartyIdentity(record.party.address) === normalizePartyIdentity(party.address)),
      );
    });
    if (strongMatches.some((party) => party.type === "supplier")) {
      const supplier = strongMatches.find((party) => party.type === "supplier")!;
      return { record, status: "conflict" as const, reason: "supplier_collision" as const, destinationPartyId: supplier.id, destinationPartyName: supplier.name, currentPaise: paise(supplier.currentBalance) };
    }
    const candidates = [...new Map([...(direct ? [direct] : []), ...strongMatches.filter((party) => party.type === "customer")].map((party) => [party.id, party])).values()];
    if (candidates.length > 1)
      return { record, status: "conflict" as const, reason: "ambiguous_identity" as const, currentPaise: 0 };
    const candidate = candidates[0];
    if (candidate && !compatibleIdentity(candidate, record) && candidate.id !== record.sourcePartyId)
      return { record, status: "conflict" as const, reason: "identity_collision" as const, destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise: paise(candidate.currentBalance) };
    if (candidate) {
      const hasHistory = candidate.openingBalance !== 0 || candidate.currentBalance !== 0 || invoices.some((invoice) => invoice.partyId === candidate.id) || payments.some((payment) => payment.partyId === candidate.id) || entries.some((entry) => entry.partyId === candidate.id);
      if (hasHistory)
        return { record, status: "conflict" as const, reason: "existing_history" as const, destinationPartyId: candidate.id, destinationPartyName: candidate.name, currentPaise: paise(candidate.currentBalance) };
    }
    for (const invoice of record.invoices) {
      if (invoiceById.has(invoice.id)) return { record, status: "conflict" as const, reason: "record_collision" as const, destinationPartyId: candidate?.id, destinationPartyName: candidate?.name, currentPaise: paise(candidate?.currentBalance || 0) };
      if (invoiceByNumber.has(invoice.invoiceNumber)) return { record, status: "conflict" as const, reason: "invoice_number_collision" as const, destinationPartyId: candidate?.id, destinationPartyName: candidate?.name, currentPaise: paise(candidate?.currentBalance || 0) };
    }
    if (record.payments.some((payment) => paymentById.has(payment.id)) || record.accountEntries.some((entry) => entryById.has(entry.id)))
      return { record, status: "conflict" as const, reason: "record_collision" as const, destinationPartyId: candidate?.id, destinationPartyName: candidate?.name, currentPaise: paise(candidate?.currentBalance || 0) };
    return {
      record,
      status: candidate ? "ready_existing" as const : "ready_new" as const,
      reason: candidate ? "matched_empty_customer" as const : "new_customer" as const,
      destinationPartyId: candidate?.id || record.sourcePartyId,
      destinationPartyName: candidate?.name || record.party.name,
      currentPaise: paise(candidate?.currentBalance || 0),
    };
  });
  rows.forEach((row, index) => {
    if (!row.destinationPartyId || (row.status !== "ready_new" && row.status !== "ready_existing")) return;
    const previous = claimed.get(row.destinationPartyId);
    if (previous == null) claimed.set(row.destinationPartyId, index);
    else {
      rows[index] = { ...row, status: "conflict", reason: "duplicate_destination" };
      rows[previous] = { ...rows[previous], status: "conflict", reason: "duplicate_destination" };
    }
  });
  return rows;
}

export async function previewDuesLedgerRestore(envelope: DuesLedgerEnvelope) {
  const payload = validatePayload(envelope.payload);
  if (sha256Hex(canonicalPayload(payload)) !== envelope.checksum)
    throw new DuesLedgerError("checksum_mismatch", "The ledger changed after it was opened.");
  const [parties, invoices, payments, entries, meta] = await db.transaction(
    "r",
    [db.parties, db.invoices, db.payments, db.accountEntries, db.meta],
    () => Promise.all([
      db.parties.toArray(), db.invoices.toArray(), db.payments.toArray(), db.accountEntries.toArray(), db.meta.toArray(),
    ]),
  );
  return summarize({ payload, checksum: envelope.checksum }, previewRows({ payload, checksum: envelope.checksum }, parties, invoices, payments, entries, new Map(meta.map((row) => [row.key, row.value]))));
}

export async function restoreDuesLedger(envelope: DuesLedgerEnvelope): Promise<DuesLedgerRestoreResult> {
  return db.transaction("rw", [db.parties, db.invoices, db.payments, db.accountEntries, db.meta, db.activityLogs], async () => {
    const payload = validatePayload(envelope.payload);
    if (sha256Hex(canonicalPayload(payload)) !== envelope.checksum)
      throw new DuesLedgerError("checksum_mismatch", "The ledger changed after review.");
    const [parties, invoices, payments, entries, meta] = await Promise.all([
      db.parties.toArray(), db.invoices.toArray(), db.payments.toArray(), db.accountEntries.toArray(), db.meta.toArray(),
    ]);
    const preview = summarize({ payload, checksum: envelope.checksum }, previewRows({ payload, checksum: envelope.checksum }, parties, invoices, payments, entries, new Map(meta.map((row) => [row.key, row.value]))));
    if (preview.conflictCount) throw new DuesLedgerError("conflict", "The destination contains conflicting customer history.");
    if (!preview.readyCount) return { importedCount: 0, importedPaise: 0, importedTransactions: 0, createdCustomers: 0, matchedCustomers: 0, alreadyCount: preview.alreadyCount };
    const partyWrites: Party[] = [];
    const invoiceWrites: Invoice[] = [];
    const paymentWrites: Payment[] = [];
    const entryWrites: AccountEntry[] = [];
    let createdCustomers = 0;
    let matchedCustomers = 0;
    for (const row of preview.rows) {
      if (row.status !== "ready_new" && row.status !== "ready_existing") continue;
      const destinationId = row.destinationPartyId!;
      partyWrites.push({ ...cloneJson(row.record.party), id: destinationId, isSynced: false });
      invoiceWrites.push(...row.record.invoices.map((invoice) => ({ ...cloneJson(invoice), partyId: destinationId, isSynced: false })));
      paymentWrites.push(...row.record.payments.map((payment) => ({ ...cloneJson(payment), partyId: destinationId, isSynced: false })));
      entryWrites.push(...row.record.accountEntries.map((entry) => ({ ...cloneJson(entry), partyId: destinationId, isSynced: false })));
      await db.meta.put({
        key: importMarkerKey(payload, row.record),
        value: JSON.stringify({ checksum: envelope.checksum, destinationPartyId: destinationId }),
      });
      if (row.status === "ready_new") createdCustomers += 1; else matchedCustomers += 1;
    }
    await db.parties.bulkPut(partyWrites);
    if (invoiceWrites.length) await db.invoices.bulkAdd(invoiceWrites);
    if (paymentWrites.length) await db.payments.bulkAdd(paymentWrites);
    if (entryWrites.length) await db.accountEntries.bulkAdd(entryWrites);
    const deviceCode = String((await db.meta.get("invoice-device-code"))?.value || "").trim();
    if (deviceCode) {
      const prefix = `-${deviceCode}-`;
      const restoredSequences = invoiceWrites
        .map((invoice) => {
          const at = invoice.invoiceNumber.lastIndexOf(prefix);
          return at >= 0 ? Number(invoice.invoiceNumber.slice(at + prefix.length)) : NaN;
        })
        .filter((value) => Number.isSafeInteger(value) && value >= 0);
      if (restoredSequences.length) {
        const currentCounter = Number((await db.meta.get("invoice-counter"))?.value || 1001);
        const nextCounter = Math.max(currentCounter, Math.max(...restoredSequences) + 1);
        if (nextCounter !== currentCounter) await db.meta.put({ key: "invoice-counter", value: nextCounter });
      }
    }
    for (const row of preview.rows) {
      if (row.status !== "ready_new" && row.status !== "ready_existing") continue;
      const party = await db.parties.get(row.destinationPartyId!);
      if (!party) throw new DuesLedgerError("conflict", "A restored customer disappeared before verification.");
      const [savedInvoices, savedPayments, savedEntries] = await Promise.all([
        db.invoices.where("partyId").equals(party.id).toArray(),
        db.payments.where("partyId").equals(party.id).toArray(),
        db.accountEntries.where("partyId").equals(party.id).toArray(),
      ]);
      const statement = partyDueStatement(party, savedInvoices, savedPayments, savedEntries);
      if (paise(statement.remainingDue) !== row.record.summary.remainingPaise || canonicalJson(summaryFor(statement)) !== canonicalJson(row.record.summary))
        throw new DuesLedgerError("conflict", "A restored customer ledger did not reconcile exactly.");
    }
    const stamp = nowIso();
    const log: ActivityLog = {
      id: makeId(),
      action: "dues.ledger.import",
      entityType: "due",
      description: `Restored complete due history for ${preview.readyCount} customers`,
      actor: "owner",
      metadata: JSON.stringify({ backupId: payload.backupId, transactions: preview.readyTransactions }),
      createdAt: stamp,
    };
    await db.activityLogs.add(log);
    return {
      importedCount: preview.readyCount,
      importedPaise: preview.readyPaise,
      importedTransactions: preview.readyTransactions,
      createdCustomers,
      matchedCustomers,
      alreadyCount: preview.alreadyCount,
    };
  });
}
