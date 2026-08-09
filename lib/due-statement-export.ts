import type { PartyDueStatement, PartyDueStatementRow } from "./billing";
import type { Language } from "./db";
import type { BusinessSettings } from "./pdf";
import { shareNativeBlob } from "./native-files";
import {
  normalizePdfLanguage,
  pdfDate,
  pdfDateTime,
  pdfMoney,
  pdfPaymentMode,
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";

const safePart = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "customer";

export const partyStatementLabel = (
  party: Pick<PartyDueStatement["party"], "name" | "codeName">,
) => party.codeName ? `${party.name} (${party.codeName})` : party.name;

type DueCopy = {
  phone: string;
  generated: string;
  customerParty: string;
  customerCode: string;
  address: string;
  accountSummary: string;
  totalDueAdded: string;
  totalPaid: string;
  amountToPay: string;
  lastPayment: string;
  on: string;
  via: string;
  noPayment: string;
  detailedActivity: string;
  date: string;
  activity: string;
  referenceMode: string;
  dueAdded: string;
  paid: string;
  paymentReceived: string;
  runningBalance: string;
  balance: string;
  total: string;
  sourceNote: string;
  statement: string;
  continued: string;
  code: string;
  noPhone: string;
  noAddress: string;
  entryCount: (count: number) => string;
  noActivity: string;
  remainingCaption: string;
  page: (page: number, pages: number) => string;
  footer: string;
  title: (account: string) => string;
  subject: (account: string) => string;
  dialogTitle: string;
  shareText: (account: string, amount: string) => string;
};

const dueCopy: Record<Language, DueCopy> = {
  en: {
    phone: "Phone", generated: "Generated", customerParty: "Customer / Party",
    customerCode: "Customer code", address: "Address", accountSummary: "ACCOUNT SUMMARY",
    totalDueAdded: "Total due added", totalPaid: "Total paid",
    amountToPay: "AMOUNT TO PAY NEXT / TOTAL REMAINING", lastPayment: "Last payment",
    on: "on", via: "via", noPayment: "No payment recorded",
    detailedActivity: "DETAILED DUE ACTIVITY", date: "Date", activity: "Activity",
    referenceMode: "Reference / mode", dueAdded: "Due added (+)", paid: "PAID",
    paymentReceived: "Payment received (-)", runningBalance: "Running balance",
    balance: "BALANCE", total: "TOTAL",
    sourceNote: "This statement is generated from saved bills, manual dues and recorded payments.",
    statement: "CUSTOMER DUE STATEMENT", continued: "DUE STATEMENT - CONTINUED", code: "Code",
    noPhone: "No phone", noAddress: "No address saved",
    entryCount: (count) => `${count} account ${count === 1 ? "entry" : "entries"}`,
    noActivity: "No due activity has been recorded for this customer.",
    remainingCaption: "Total remaining due / amount to pay next",
    page: (page, pages) => `Page ${page} of ${pages}`,
    footer: "Midori Kanjo | Customer due statement",
    title: (account) => `Due statement - ${account}`,
    subject: (account) => `Customer due and payment activity for ${account}`,
    dialogTitle: "Save or share customer statement",
    shareText: (account, amount) => `${account}: total remaining due ${amount}`,
  },
  hi: {
    phone: "फ़ोन", generated: "बनाने की तारीख", customerParty: "ग्राहक / पार्टी",
    customerCode: "ग्राहक कोड", address: "पता", accountSummary: "खाते का सारांश",
    totalDueAdded: "कुल जोड़ी गई बकाया राशि", totalPaid: "कुल भुगतान",
    amountToPay: "अगला भुगतान / कुल बाकी", lastPayment: "पिछला भुगतान",
    on: "को", via: "के ज़रिए", noPayment: "कोई भुगतान दर्ज नहीं है",
    detailedActivity: "बकाया खाते का पूरा विवरण", date: "तारीख", activity: "लेन-देन",
    referenceMode: "रेफरेंस / तरीका", dueAdded: "बकाया जोड़ी (+)", paid: "भुगतान",
    paymentReceived: "भुगतान मिला (-)", runningBalance: "चलता बैलेंस",
    balance: "बैलेंस", total: "कुल",
    sourceNote: "यह स्टेटमेंट सेव किए गए बिल, हाथ से जोड़ी गई बकाया राशि और दर्ज भुगतानों से बना है।",
    statement: "ग्राहक की बकाया स्टेटमेंट", continued: "बकाया स्टेटमेंट - जारी", code: "कोड",
    noPhone: "फ़ोन उपलब्ध नहीं", noAddress: "पता सेव नहीं है",
    entryCount: (count) => `खाते में ${count} एंट्री`,
    noActivity: "इस ग्राहक के लिए बकाया खाते में कोई लेन-देन दर्ज नहीं है।",
    remainingCaption: "कुल बाकी / अगला भुगतान",
    page: (page, pages) => `पेज ${page} / ${pages}`,
    footer: "Midori Kanjo | ग्राहक की बकाया स्टेटमेंट",
    title: (account) => `बकाया स्टेटमेंट - ${account}`,
    subject: (account) => `${account} का बकाया और भुगतान विवरण`,
    dialogTitle: "ग्राहक की स्टेटमेंट सेव या शेयर करें",
    shareText: (account, amount) => `${account}: कुल बाकी ${amount}`,
  },
  bn: {
    phone: "ফোন", generated: "তৈরির তারিখ", customerParty: "ক্রেতা / পার্টি",
    customerCode: "ক্রেতার কোড", address: "ঠিকানা", accountSummary: "খাতার সারাংশ",
    totalDueAdded: "মোট যোগ হওয়া বাকি", totalPaid: "মোট পেমেন্ট",
    amountToPay: "পরের পেমেন্ট / মোট বাকি", lastPayment: "শেষ পেমেন্ট",
    on: "তারিখে", via: "মাধ্যমে", noPayment: "কোনো পেমেন্ট লেখা নেই",
    detailedActivity: "বাকি খাতার সম্পূর্ণ বিবরণ", date: "তারিখ", activity: "লেনদেন",
    referenceMode: "রেফারেন্স / পদ্ধতি", dueAdded: "বাকি যোগ (+)", paid: "পেমেন্ট",
    paymentReceived: "পেমেন্ট পাওয়া (-)", runningBalance: "চলতি ব্যালেন্স",
    balance: "ব্যালেন্স", total: "মোট",
    sourceNote: "এই স্টেটমেন্ট সেভ করা বিল, হাতে যোগ করা বাকি এবং লেখা পেমেন্ট থেকে তৈরি হয়েছে।",
    statement: "ক্রেতার বাকি স্টেটমেন্ট", continued: "বাকি স্টেটমেন্ট - পরের অংশ", code: "কোড",
    noPhone: "ফোন নেই", noAddress: "ঠিকানা সেভ করা নেই",
    entryCount: (count) => `খাতায় ${count}টি এন্ট্রি`,
    noActivity: "এই ক্রেতার বাকি খাতায় কোনো লেনদেন লেখা নেই।",
    remainingCaption: "মোট বাকি / পরের পেমেন্ট",
    page: (page, pages) => `পৃষ্ঠা ${page} / ${pages}`,
    footer: "Midori Kanjo | ক্রেতার বাকি স্টেটমেন্ট",
    title: (account) => `বাকি স্টেটমেন্ট - ${account}`,
    subject: (account) => `${account}-এর বাকি ও পেমেন্টের বিবরণ`,
    dialogTitle: "ক্রেতার স্টেটমেন্ট সেভ বা শেয়ার করুন",
    shareText: (account, amount) => `${account}: মোট বাকি ${amount}`,
  },
};

function localizedActivity(row: PartyDueStatementRow, language: Language) {
  if (language === "en") return row.activity;
  const labels = language === "hi"
    ? {
        opening_balance: "शुरुआती बैलेंस",
        sale_invoice: "बिक्री बिल",
        payment: row.activity === "Payment received with bill" ? "बिल के साथ मिला भुगतान" : "ग्राहक से मिला भुगतान",
        balance_adjustment: "खाते के बैलेंस का मिलान",
      }
    : {
        opening_balance: "শুরুর ব্যালেন্স",
        sale_invoice: "বিক্রির বিল",
        payment: row.activity === "Payment received with bill" ? "বিলের সঙ্গে পাওয়া পেমেন্ট" : "ক্রেতার কাছ থেকে পাওয়া পেমেন্ট",
        balance_adjustment: "খাতার ব্যালেন্স মেলানো",
      };
  if (row.kind === "manual_due") {
    if (row.activity !== "Manual due") return row.activity;
    return language === "hi" ? "हाथ से जोड़ी गई बकाया राशि" : "হাতে যোগ করা বাকি";
  }
  return labels[row.kind];
}

function localizedReference(row: PartyDueStatementRow, language: Language) {
  if (row.reference !== "Imported / legacy balance" || language === "en") return row.reference;
  return language === "hi" ? "इम्पोर्ट किया / पुराना बैलेंस" : "ইমপোর্ট করা / পুরোনো ব্যালেন্স";
}

const rowDetails = (row: PartyDueStatementRow, language: Language) =>
  [localizedActivity(row, language), localizedReference(row, language), pdfPaymentMode(row.paymentMode, language)]
    .filter(Boolean)
    .join(" | ");

export function dueStatementText(
  statement: PartyDueStatement,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = dueCopy[active];
  const money = (value: number) => pdfMoney(value, active);
  const { party } = statement;
  const accountLabel = partyStatementLabel(party);
  const last = statement.lastPayment;
  return [
    business.name || "Burrabazar Festival Decor",
    business.address || "Burrabazar, Kolkata, West Bengal",
    [business.phone ? `${copy.phone}: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""]
      .filter(Boolean)
      .join(" | "),
    `MIDORI KANJO - ${copy.statement}`,
    `${copy.generated}\t${pdfDateTime(new Date(), active)}`,
    "",
    `${copy.customerParty}\t${accountLabel}`,
    party.codeName ? `${copy.customerCode}\t${party.codeName}` : "",
    `${copy.phone}\t${party.phone || "-"}`,
    `${copy.address}\t${party.address || "-"}`,
    "",
    copy.accountSummary,
    `${copy.totalDueAdded}\t${money(statement.totalDueAdded)}`,
    `${copy.totalPaid}\t${money(statement.totalPaid)}`,
    `${copy.amountToPay}\t${money(statement.remainingDue)}`,
    last
      ? `${copy.lastPayment}\t${money(last.amount)} ${copy.on} ${pdfDate(last.date, active)} ${copy.via} ${pdfPaymentMode(last.mode, active)}${last.reference ? ` | ${last.reference}` : ""}`
      : `${copy.lastPayment}\t${copy.noPayment}`,
    "",
    `${copy.detailedActivity} - ${accountLabel}`,
    `${copy.date}\t${copy.activity}\t${copy.referenceMode}\t${copy.dueAdded}\t${copy.paymentReceived}\t${copy.runningBalance}`,
    ...statement.rows.map((row) =>
      [
        pdfDate(row.date, active),
        localizedActivity(row, active),
        [localizedReference(row, active), pdfPaymentMode(row.paymentMode, active)].filter(Boolean).join(" | "),
        row.dueAdded ? money(row.dueAdded) : "-",
        row.paymentReceived ? money(row.paymentReceived) : "-",
        money(row.runningBalance),
      ].join("\t"),
    ),
    "",
    `${copy.total}\t\t\t${money(statement.totalDueAdded)}\t${money(statement.totalPaid)}\t${money(statement.remainingDue)}`,
    "",
    copy.sourceNote,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\r\n");
}

export async function createDueStatementPdf(
  statement: PartyDueStatement,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = dueCopy[active];
  const money = (value: number) => pdfMoney(value, active);
  const { jsPDF } = await import("jspdf");
  const doc = await registerPdfFont(new jsPDF({
    unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true,
  }));
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const forest: [number, number, number] = [1, 73, 33];
  const primary: [number, number, number] = [0, 78, 35];
  const accent: [number, number, number] = [48, 157, 75];
  const pale: [number, number, number] = [249, 249, 249];
  const ink: [number, number, number] = [33, 31, 29];
  const muted: [number, number, number] = [97, 95, 92];
  const border: [number, number, number] = [226, 226, 219];
  let y = margin;
  const accountLabel = partyStatementLabel(statement.party);

  doc.setProperties({
    title: copy.title(accountLabel), subject: copy.subject(accountLabel),
    author: business.name || "Midori Kanjo", creator: "Midori Kanjo",
  });

  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...forest);
    doc.roundedRect(margin, y, contentWidth, 31, 2.5, 2.5, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(16);
    doc.text(business.name || "Burrabazar Festival Decor", margin + 5, y + 9, { maxWidth: contentWidth * 0.56 });
    setPdfFont(doc);
    doc.setFontSize(7);
    doc.text((business.address || "Burrabazar, Kolkata, West Bengal").slice(0, 110), margin + 5, y + 16, { maxWidth: contentWidth * 0.56 });
    doc.text(
      [business.phone ? `${copy.phone}: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""].filter(Boolean).join("  |  "),
      margin + 5, y + 24, { maxWidth: contentWidth * 0.56 },
    );
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 11 : 9.2);
    doc.text(continued ? copy.continued : copy.statement, right - 5, y + 10, { align: "right", maxWidth: contentWidth * 0.4 });
    setPdfFont(doc);
    doc.setFontSize(7);
    if (statement.party.codeName) {
      doc.text(`${copy.code}: ${statement.party.codeName}`, right - 5, y + 17, { align: "right" });
    }
    doc.text(`${copy.generated} ${pdfDate(new Date(), active)}`, right - 5, y + 24, { align: "right" });
    y += 37;
  };

  const tableHeader = () => {
    doc.setFillColor(...forest);
    doc.rect(margin, y, contentWidth, 9, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 6.2 : 5.6);
    doc.text(copy.date.toUpperCase(), margin + 2, y + 5.8, { maxWidth: 24 });
    doc.text(`${copy.activity} / ${copy.referenceMode}`, margin + 28, y + 5.8, { maxWidth: 66 });
    doc.text(copy.dueAdded.toUpperCase(), right - 55, y + 5.8, { align: "right", maxWidth: 28 });
    doc.text(copy.paid.toUpperCase(), right - 29, y + 5.8, { align: "right", maxWidth: 22 });
    doc.text(copy.balance.toUpperCase(), right - 2, y + 5.8, { align: "right", maxWidth: 25 });
    y += 9;
  };

  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(...border);
      doc.line(margin, height - 8, right, height - 8);
      setPdfFont(doc);
      doc.setFontSize(6);
      doc.setTextColor(...muted);
      doc.text(copy.footer, margin, height - 4.5);
      doc.text(copy.page(page, pages), right, height - 4.5, { align: "right" });
    }
  };

  header();
  setPdfFont(doc, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ink);
  doc.text(accountLabel, margin, y, { maxWidth: contentWidth * 0.78 });
  setPdfFont(doc);
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  y += 6;
  doc.text([statement.party.phone || copy.noPhone, statement.party.address || copy.noAddress].join("  |  "), margin, y, { maxWidth: contentWidth });
  y += 8;

  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * 2) / 3;
  const cards = [
    { label: copy.totalDueAdded, value: statement.totalDueAdded, color: ink },
    { label: copy.totalPaid, value: statement.totalPaid, color: accent },
    { label: copy.amountToPay, value: statement.remainingDue, color: primary },
  ];
  cards.forEach((card, index) => {
    const x = margin + index * (cardWidth + cardGap);
    doc.setFillColor(...pale);
    doc.setDrawColor(...border);
    doc.roundedRect(x, y, cardWidth, 21, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 6.2 : 5.6);
    doc.setTextColor(...muted);
    doc.text(card.label.toUpperCase(), x + 4, y + 6, { maxWidth: cardWidth - 8 });
    doc.setFontSize(10.5);
    doc.setTextColor(...card.color);
    doc.text(money(card.value), x + 4, y + 15, { maxWidth: cardWidth - 8 });
  });
  y += 27;

  doc.setFillColor(...pale);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, contentWidth, 13, 1.5, 1.5, "FD");
  setPdfFont(doc, "bold");
  doc.setFontSize(7);
  doc.setTextColor(...ink);
  doc.text(copy.lastPayment.toUpperCase(), margin + 4, y + 5.5);
  setPdfFont(doc);
  doc.setTextColor(...muted);
  const last = statement.lastPayment;
  doc.text(
    last
      ? `${money(last.amount)} ${copy.on} ${pdfDate(last.date, active)} ${copy.via} ${pdfPaymentMode(last.mode, active)}${last.reference ? ` | ${last.reference}` : ""}`
      : copy.noPayment,
    margin + 4, y + 10, { maxWidth: contentWidth - 8 },
  );
  y += 20;

  setPdfFont(doc, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ink);
  doc.text(copy.detailedActivity, margin, y);
  y += 5;
  setPdfFont(doc);
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(`${accountLabel} | ${copy.entryCount(statement.rows.length)}`, margin, y, { maxWidth: contentWidth });
  y += 5;
  tableHeader();

  if (!statement.rows.length) {
    doc.setTextColor(...muted);
    setPdfFont(doc);
    doc.text(copy.noActivity, margin + 3, y + 8);
    y += 14;
  }

  statement.rows.forEach((row, index) => {
    const details = doc.splitTextToSize(rowDetails(row, active), 74).slice(0, 3);
    const rowHeight = Math.max(11, details.length * 3.2 + 4.5);
    if (y + rowHeight > height - 16) {
      doc.addPage();
      header(true);
      tableHeader();
    }
    if (index % 2) {
      doc.setFillColor(...pale);
      doc.rect(margin, y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...border);
    doc.line(margin, y + rowHeight, right, y + rowHeight);
    setPdfFont(doc);
    doc.setFontSize(6.3);
    doc.setTextColor(...ink);
    doc.text(pdfDate(row.date, active, { day: "2-digit", month: "short", year: "2-digit" }), margin + 2, y + 5);
    doc.text(details, margin + 28, y + 5);
    setPdfFont(doc, "bold");
    if (row.dueAdded) doc.text(money(row.dueAdded), right - 55, y + 5, { align: "right" });
    if (row.paymentReceived) {
      doc.setTextColor(...accent);
      doc.text(money(row.paymentReceived), right - 29, y + 5, { align: "right" });
    }
    doc.setTextColor(...primary);
    doc.text(money(row.runningBalance), right - 2, y + 5, { align: "right" });
    y += rowHeight;
  });

  if (y + 18 > height - 14) {
    doc.addPage();
    header(true);
  }
  doc.setFillColor(...forest);
  doc.rect(margin, y, contentWidth, 15, "F");
  setPdfFont(doc, "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text(copy.total.toUpperCase(), margin + 3, y + 6);
  doc.text(money(statement.totalDueAdded), right - 55, y + 6, { align: "right" });
  doc.text(money(statement.totalPaid), right - 29, y + 6, { align: "right" });
  doc.setFontSize(9);
  doc.text(money(statement.remainingDue), right - 2, y + 6, { align: "right" });
  doc.setFontSize(6.3);
  doc.text(copy.remainingCaption, right - 2, y + 12, { align: "right" });

  footer();
  return doc;
}

async function shareOrDownload(
  blob: Blob,
  fileName: string,
  title: string,
  text: string,
  dialogTitle: string,
) {
  if (await shareNativeBlob(blob, { fileName, title, text, dialogTitle })) return "shared" as const;

  // Browser Web Share support is inconsistent on desktops and can leave the
  // promise pending behind an operating-system dialog. Web exports therefore
  // always download; installed native apps continue to use the share sheet.
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

export async function downloadDueStatementPdf(
  statement: PartyDueStatement,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = dueCopy[active];
  const doc = await createDueStatementPdf(statement, business, active);
  const accountLabel = partyStatementLabel(statement.party);
  const codePart = statement.party.codeName ? `-${safePart(statement.party.codeName)}` : "";
  const fileName = `Midori-Kanjo-due-statement-${safePart(statement.party.name)}${codePart}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return shareOrDownload(
    doc.output("blob"), fileName, copy.title(accountLabel),
    copy.shareText(accountLabel, pdfMoney(statement.remainingDue, active)), copy.dialogTitle,
  );
}

export async function downloadDueStatementText(
  statement: PartyDueStatement,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = dueCopy[active];
  const content = `\uFEFF${dueStatementText(statement, business, active)}`;
  const accountLabel = partyStatementLabel(statement.party);
  const codePart = statement.party.codeName ? `-${safePart(statement.party.codeName)}` : "";
  const fileName = `Midori-Kanjo-due-statement-${safePart(statement.party.name)}${codePart}-${new Date().toISOString().slice(0, 10)}.txt`;
  return shareOrDownload(
    new Blob([content], { type: "text/plain;charset=utf-8" }), fileName, copy.title(accountLabel),
    copy.shareText(accountLabel, pdfMoney(statement.remainingDue, active)), copy.dialogTitle,
  );
}
