import type { Language, ExpenseCategory } from "./db";
import type { BusinessSettings } from "./pdf";
import {
  expenseCategoryLabels,
  type CashFlowMovement,
  type CashFlowReport,
} from "./cashflow";
import { localizedInvoicePartyName } from "./i18n";
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

const filePart = (report: CashFlowReport) => report.fromDate || report.toDate
  ? `${report.fromDate || "first"}-to-${report.toDate || "today"}`
  : "all-dates";

type CashFlowCopy = {
  phone: string;
  title: string;
  reportTitle: string;
  continued: string;
  subject: string;
  generated: string;
  allDates: string;
  firstRecord: string;
  today: string;
  to: string;
  moneyIn: string;
  moneyOut: string;
  netCashFlow: string;
  completeCalculation: string;
  salesBilled: string;
  receivedWithBills: string;
  customerPayments: string;
  supplierBills: string;
  paidWithPurchases: string;
  supplierPayments: string;
  miscExpenses: string;
  customerOutstanding: string;
  supplierOutstanding: string;
  miscBreakdown: string;
  noMisc: string;
  detailedMovements: string;
  movementCount: (count: number) => string;
  noMovements: string;
  date: string;
  direction: string;
  type: string;
  details: string;
  mode: string;
  amount: string;
  incoming: string;
  outgoing: string;
  summary: string;
  total: string;
  footer: string;
  page: (page: number, pages: number) => string;
  shareTitle: string;
  dialogTitle: string;
  sources: Record<CashFlowMovement["source"], string>;
  categories: Record<ExpenseCategory, string>;
};

const cashFlowCopy: Record<Language, CashFlowCopy> = {
  en: {
    phone: "Phone", title: "MONEY IN & OUT", reportTitle: "MONEY IN & OUT REPORT", continued: "CASH FLOW - CONTINUED",
    subject: "Money in and money out report", generated: "Generated", allDates: "All recorded dates",
    firstRecord: "First record", today: "Today", to: "to", moneyIn: "MONEY IN",
    moneyOut: "MONEY OUT", netCashFlow: "NET CASH FLOW", completeCalculation: "COMPLETE CALCULATION",
    salesBilled: "Sales billed (cash + credit)", receivedWithBills: "Received while making bills",
    customerPayments: "Later customer payments received", supplierBills: "Supplier bills recorded",
    paidWithPurchases: "Paid while recording purchases", supplierPayments: "Later payments made to suppliers",
    miscExpenses: "Miscellaneous expenses", customerOutstanding: "Current customer dues to collect",
    supplierOutstanding: "Current supplier payables", miscBreakdown: "MISCELLANEOUS BREAKDOWN",
    noMisc: "No miscellaneous expenses in this period", detailedMovements: "DETAILED MONEY MOVEMENTS",
    movementCount: (count) => `${count} cash movement${count === 1 ? "" : "s"} in the selected period`,
    noMovements: "No money came in or went out during this date range.",
    date: "DATE", direction: "Direction", type: "TYPE", details: "DETAILS", mode: "MODE", amount: "AMOUNT",
    incoming: "IN", outgoing: "OUT", summary: "SUMMARY", total: "TOTAL", footer: "Midori Kanjo | Cash-flow report",
    page: (page, pages) => `Page ${page} of ${pages}`,
    shareTitle: "Midori Kanjo cash-flow report", dialogTitle: "Save or share report",
    sources: { sale: "Sale", purchase: "Purchase", sale_return: "Sale return", purchase_return: "Purchase return", customer_payment: "Customer payment", supplier_payment: "Supplier payment", misc_expense: "Miscellaneous" },
    categories: { refreshments: "Tea & coffee", customer_food: "Customer food", shop_supplies: "Shop supplies", transport: "Local transport", other: "Other" },
  },
  hi: {
    phone: "फ़ोन", title: "पैसे आए और गए", reportTitle: "पैसे आने और जाने की रिपोर्ट", continued: "कैश फ़्लो - जारी",
    subject: "पैसे आने और जाने की रिपोर्ट", generated: "बनाने का समय", allDates: "दर्ज की गई सभी तारीखें",
    firstRecord: "पहली एंट्री", today: "आज", to: "से", moneyIn: "पैसे आए",
    moneyOut: "पैसे गए", netCashFlow: "शुद्ध कैश फ़्लो", completeCalculation: "पूरा हिसाब",
    salesBilled: "बिक्री के बिल (नकद + उधार)", receivedWithBills: "बिल बनाते समय मिला भुगतान",
    customerPayments: "बाद में ग्राहकों से मिला भुगतान", supplierBills: "सप्लायर के दर्ज बिल",
    paidWithPurchases: "खरीद दर्ज करते समय दिया भुगतान", supplierPayments: "बाद में सप्लायरों को दिया भुगतान",
    miscExpenses: "अन्य खर्च", customerOutstanding: "ग्राहकों से मिलने वाली मौजूदा बकाया राशि",
    supplierOutstanding: "सप्लायरों को देनी मौजूदा राशि", miscBreakdown: "अन्य खर्चों का विवरण",
    noMisc: "इस अवधि में कोई अन्य खर्च नहीं है", detailedMovements: "पैसों के लेन-देन का पूरा विवरण",
    movementCount: (count) => `चुनी हुई अवधि में ${count} कैश एंट्री`,
    noMovements: "इस तारीख़ अवधि में कोई पैसा आया या गया नहीं।",
    date: "तारीख", direction: "दिशा", type: "प्रकार", details: "विवरण", mode: "तरीका", amount: "राशि",
    incoming: "आया", outgoing: "गया", summary: "सारांश", total: "कुल", footer: "Midori Kanjo | कैश फ़्लो रिपोर्ट",
    page: (page, pages) => `पेज ${page} / ${pages}`,
    shareTitle: "Midori Kanjo कैश फ़्लो रिपोर्ट", dialogTitle: "रिपोर्ट सेव या शेयर करें",
    sources: { sale: "बिक्री", purchase: "खरीद", sale_return: "बिक्री वापसी", purchase_return: "खरीद वापसी", customer_payment: "ग्राहक का भुगतान", supplier_payment: "सप्लायर का भुगतान", misc_expense: "अन्य खर्च" },
    categories: { refreshments: "चाय और कॉफ़ी", customer_food: "ग्राहक का खाना", shop_supplies: "दुकान का सामान", transport: "स्थानीय यातायात", other: "अन्य" },
  },
  bn: {
    phone: "ফোন", title: "টাকা এসেছে ও গেছে", reportTitle: "টাকা আসা ও যাওয়ার রিপোর্ট", continued: "ক্যাশ ফ্লো - পরের অংশ",
    subject: "টাকা আসা ও যাওয়ার রিপোর্ট", generated: "তৈরির সময়", allDates: "লেখা সব তারিখ",
    firstRecord: "প্রথম এন্ট্রি", today: "আজ", to: "থেকে", moneyIn: "টাকা এসেছে",
    moneyOut: "টাকা গেছে", netCashFlow: "নিট ক্যাশ ফ্লো", completeCalculation: "সম্পূর্ণ হিসাব",
    salesBilled: "বিক্রির বিল (নগদ + বাকি)", receivedWithBills: "বিল করার সময় পাওয়া পেমেন্ট",
    customerPayments: "পরে ক্রেতাদের কাছ থেকে পাওয়া পেমেন্ট", supplierBills: "সাপ্লায়ারের লেখা বিল",
    paidWithPurchases: "কেনাকাটা লেখার সময় দেওয়া পেমেন্ট", supplierPayments: "পরে সাপ্লায়ারদের দেওয়া পেমেন্ট",
    miscExpenses: "অন্যান্য খরচ", customerOutstanding: "ক্রেতাদের কাছ থেকে পাওয়ার বর্তমান বাকি",
    supplierOutstanding: "সাপ্লায়ারদের দেওয়ার বর্তমান বাকি", miscBreakdown: "অন্যান্য খরচের বিবরণ",
    noMisc: "এই সময়ে অন্য কোনো খরচ নেই", detailedMovements: "টাকার লেনদেনের সম্পূর্ণ বিবরণ",
    movementCount: (count) => `বাছা সময়ে ${count}টি ক্যাশ এন্ট্রি`,
    noMovements: "এই তারিখের মধ্যে কোনো টাকা আসেনি বা যায়নি।",
    date: "তারিখ", direction: "দিক", type: "ধরন", details: "বিবরণ", mode: "পদ্ধতি", amount: "টাকা",
    incoming: "এসেছে", outgoing: "গেছে", summary: "সারাংশ", total: "মোট", footer: "Midori Kanjo | ক্যাশ ফ্লো রিপোর্ট",
    page: (page, pages) => `পৃষ্ঠা ${page} / ${pages}`,
    shareTitle: "Midori Kanjo ক্যাশ ফ্লো রিপোর্ট", dialogTitle: "রিপোর্ট সেভ বা শেয়ার করুন",
    sources: { sale: "বিক্রি", purchase: "কেনাকাটা", sale_return: "বিক্রি ফেরত", purchase_return: "কেনাকাটা ফেরত", customer_payment: "ক্রেতার পেমেন্ট", supplier_payment: "সাপ্লায়ারের পেমেন্ট", misc_expense: "অন্যান্য খরচ" },
    categories: { refreshments: "চা ও কফি", customer_food: "ক্রেতার খাবার", shop_supplies: "দোকানের জিনিস", transport: "স্থানীয় যাতায়াত", other: "অন্যান্য" },
  },
};

const builtInExpenseTitleAliases: Record<ExpenseCategory, readonly string[]> = {
  refreshments: [
    expenseCategoryLabels.refreshments,
    "चाय और कॉफी",
    "চা ও কফি",
    cashFlowCopy.hi.categories.refreshments,
    cashFlowCopy.bn.categories.refreshments,
  ],
  customer_food: [
    expenseCategoryLabels.customer_food,
    "कस्टमर का खाना",
    "কাস্টমারের খাবার",
    cashFlowCopy.hi.categories.customer_food,
    cashFlowCopy.bn.categories.customer_food,
  ],
  shop_supplies: [
    expenseCategoryLabels.shop_supplies,
    "दुकान का सामान",
    "দোকানের জিনিস",
    cashFlowCopy.hi.categories.shop_supplies,
    cashFlowCopy.bn.categories.shop_supplies,
  ],
  transport: [
    expenseCategoryLabels.transport,
    "लोकल ट्रांसपोर्ट",
    "লোকাল ট্রান্সপোর্ট",
    cashFlowCopy.hi.categories.transport,
    cashFlowCopy.bn.categories.transport,
  ],
  other: [
    expenseCategoryLabels.other,
    "बाकी",
    "অন্যান্য",
    cashFlowCopy.hi.categories.other,
    cashFlowCopy.bn.categories.other,
  ],
};

function rangeLabel(report: CashFlowReport, language: Language) {
  const copy = cashFlowCopy[language];
  if (!report.fromDate && !report.toDate) return copy.allDates;
  const from = report.fromDate ? pdfDate(report.fromDate, language) : copy.firstRecord;
  const to = report.toDate ? pdfDate(report.toDate, language) : copy.today;
  return report.fromDate === report.toDate && report.fromDate ? from : `${from} ${copy.to} ${to}`;
}

function movementTitle(movement: CashFlowMovement, language: Language) {
  if (movement.source === "misc_expense") {
    const category = movement.expenseCategory;
    return category && builtInExpenseTitleAliases[category].includes(movement.title.trim())
      ? cashFlowCopy[language].categories[category]
      : movement.title;
  }
  if (language === "en") return movement.title;
  const source = cashFlowCopy[language].sources[movement.source];
  const prefixes: Record<CashFlowMovement["source"], RegExp> = {
    sale: /^Sale\s+/i,
    purchase: /^Purchase\s+/i,
    sale_return: /^Sale return\s+/i,
    purchase_return: /^Purchase return\s+/i,
    customer_payment: /^Payment from\s+/i,
    supplier_payment: /^Payment to\s+/i,
    misc_expense: /^$/,
  };
  return `${source}: ${movement.title.replace(prefixes[movement.source], "")}`;
}

function movementDetails(movement: CashFlowMovement, language: Language) {
  if (language === "en") return movement.details;
  if (
    movement.partyId === null &&
    ["sale", "purchase", "sale_return", "purchase_return"].includes(
      movement.source,
    )
  )
    return localizedInvoicePartyName(language, {
      partyName: movement.details,
    });
  const accountPayment = language === "hi" ? "खाते का भुगतान" : "খাতার পেমেন্ট";
  if (movement.details === "Account payment") return accountPayment;
  const allocation = movement.details.match(/^(\d+) bill allocation(s)?$/);
  if (allocation) return language === "hi" ? `${allocation[1]} बिल में लगाया` : `${allocation[1]}টি বিলে ধরা হয়েছে`;
  let details = movement.details;
  const enCategories: Record<ExpenseCategory, string> = { refreshments: "Tea & coffee", customer_food: "Customer food", shop_supplies: "Shop supplies", transport: "Local transport", other: "Other" };
  for (const category of Object.keys(enCategories) as ExpenseCategory[]) {
    if (details.startsWith(enCategories[category])) {
      details = `${cashFlowCopy[language].categories[category]}${details.slice(enCategories[category].length)}`;
      break;
    }
  }
  return details;
}

export async function createCashFlowPdf(
  report: CashFlowReport,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = cashFlowCopy[active];
  const money = (value: number) => pdfMoney(value, active);
  const { jsPDF } = await import("jspdf");
  const doc = await registerPdfFont(new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true }));
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const green: [number, number, number] = [1, 73, 33];
  const primary: [number, number, number] = [0, 78, 35];
  const deep: [number, number, number] = [0, 64, 20];
  const accent: [number, number, number] = [48, 157, 75];
  const pale: [number, number, number] = [249, 249, 249];
  const ink: [number, number, number] = [33, 31, 29];
  const muted: [number, number, number] = [97, 95, 92];
  const border: [number, number, number] = [226, 226, 219];
  let y = 12;

  doc.setProperties({ title: `${copy.title} - ${rangeLabel(report, active)}`, subject: copy.subject, author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });
  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...green);
    doc.roundedRect(margin, y, contentWidth, 30, 2.5, 2.5, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(17);
    doc.text(business.name || "Burrabazar Festival Decor", margin + 5, y + 9, { maxWidth: contentWidth * 0.58 });
    setPdfFont(doc);
    doc.setFontSize(7);
    doc.text((business.address || "Burrabazar, Kolkata, West Bengal").slice(0, 110), margin + 5, y + 15, { maxWidth: contentWidth * 0.58 });
    doc.text([business.phone ? `${copy.phone}: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""].filter(Boolean).join("  |  "), margin + 5, y + 23, { maxWidth: contentWidth * 0.58 });
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 12 : 10);
    doc.text(continued ? copy.continued : copy.title, right - 5, y + 10, { align: "right", maxWidth: contentWidth * 0.38 });
    setPdfFont(doc);
    doc.setFontSize(7.5);
    doc.text(rangeLabel(report, active), right - 5, y + 17, { align: "right", maxWidth: contentWidth * 0.38 });
    doc.text(`${copy.generated} ${pdfDateTime(new Date(), active)}`, right - 5, y + 23, { align: "right", maxWidth: contentWidth * 0.38 });
    y += 36;
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
  const summaryRow = (label: string, value: number, color: [number, number, number] = ink) => {
    setPdfFont(doc);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(label, margin + 4, y, { maxWidth: contentWidth * 0.62 });
    setPdfFont(doc, "bold");
    doc.setTextColor(...color);
    doc.text(money(value), right - 4, y, { align: "right" });
    y += 6.5;
  };

  header();
  const boxWidth = (contentWidth - 6) / 3;
  const cards = [
    { label: copy.moneyIn, value: report.moneyIn, color: accent },
    { label: copy.moneyOut, value: report.moneyOut, color: deep },
    { label: copy.netCashFlow, value: report.netCashFlow, color: report.netCashFlow >= 0 ? primary : deep },
  ];
  cards.forEach((card, index) => {
    const x = margin + index * (boxWidth + 3);
    doc.setFillColor(...pale);
    doc.setDrawColor(...border);
    doc.roundedRect(x, y, boxWidth, 22, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...muted);
    doc.text(card.label, x + 4, y + 6, { maxWidth: boxWidth - 8 });
    doc.setFontSize(11);
    doc.setTextColor(...card.color);
    doc.text(money(card.value), x + 4, y + 15.5, { maxWidth: boxWidth - 8 });
  });
  y += 28;
  doc.setFillColor(...pale);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, contentWidth, 84, 1.5, 1.5, "FD");
  setPdfFont(doc, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ink);
  doc.text(copy.completeCalculation, margin + 4, y + 6);
  y += 13;
  summaryRow(copy.salesBilled, report.salesBilled);
  summaryRow(copy.receivedWithBills, report.receivedWithBills, accent);
  summaryRow(copy.customerPayments, report.customerPayments, accent);
  summaryRow(copy.supplierBills, report.supplierBillsRecorded);
  summaryRow(copy.paidWithPurchases, report.paidWithPurchases, deep);
  summaryRow(copy.supplierPayments, report.supplierPayments, deep);
  summaryRow(copy.miscExpenses, report.miscellaneousExpenses, deep);
  y += 2;
  doc.setDrawColor(...border);
  doc.line(margin + 4, y, right - 4, y);
  y += 6;
  summaryRow(copy.customerOutstanding, report.customerOutstanding);
  summaryRow(copy.supplierOutstanding, report.supplierOutstanding);
  y += 5;

  if (report.expenseBreakdown.length) {
    setPdfFont(doc, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...ink);
    doc.text(copy.miscBreakdown, margin, y);
    y += 6;
    report.expenseBreakdown.forEach((row) => summaryRow(copy.categories[row.category], row.amount, deep));
    y += 3;
  }

  const tableHeader = () => {
    doc.setFillColor(...green);
    doc.rect(margin, y, contentWidth, 8, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 6.5 : 5.8);
    doc.text(copy.date, margin + 2, y + 5.2);
    doc.text(copy.type, margin + 29, y + 5.2);
    doc.text(copy.details, margin + 57, y + 5.2);
    doc.text(copy.mode, right - 40, y + 5.2);
    doc.text(copy.amount, right - 2, y + 5.2, { align: "right" });
    y += 8;
  };
  setPdfFont(doc, "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ink);
  doc.text(copy.detailedMovements, margin, y);
  y += 5;
  setPdfFont(doc);
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(copy.movementCount(report.movements.length), margin, y);
  y += 5;
  tableHeader();
  if (!report.movements.length) {
    setPdfFont(doc);
    doc.setTextColor(...muted);
    doc.text(copy.noMovements, margin + 3, y + 8);
    y += 13;
  }
  for (let index = 0; index < report.movements.length; index += 1) {
    const movement = report.movements[index];
    const title = movementTitle(movement, active);
    const details = movementDetails(movement, active);
    const detailLines = doc.splitTextToSize(`${title}${details ? ` | ${details}` : ""}`, 72).slice(0, 2);
    const rowHeight = Math.max(11, detailLines.length * 3.2 + 5);
    if (y + rowHeight > height - 14) {
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
    doc.setFontSize(6.5);
    doc.setTextColor(...ink);
    doc.text(pdfDate(movement.date, active, { day: "2-digit", month: "short", year: "2-digit" }), margin + 2, y + 5);
    doc.text(copy.sources[movement.source], margin + 29, y + 5, { maxWidth: 25 });
    doc.text(detailLines, margin + 57, y + 5);
    doc.text(pdfPaymentMode(movement.mode, active), right - 40, y + 5, { maxWidth: 30 });
    setPdfFont(doc, "bold");
    doc.setTextColor(...(movement.direction === "in" ? accent : deep));
    doc.text(`${movement.direction === "in" ? "+" : "-"}${money(movement.amount)}`, right - 2, y + 5, { align: "right" });
    y += rowHeight;
  }
  footer();
  return doc;
}

export async function downloadCashFlowPdf(
  report: CashFlowReport,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = cashFlowCopy[active];
  const doc = await createCashFlowPdf(report, business, active);
  const name = `Midori-Kanjo-cash-flow-${filePart(report)}.pdf`;
  if (await shareNativeBlob(doc.output("blob"), { fileName: name, title: copy.shareTitle, dialogTitle: copy.dialogTitle })) return;
  doc.save(name);
}

export function cashFlowText(
  report: CashFlowReport,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = cashFlowCopy[active];
  const money = (value: number) => pdfMoney(value, active);
  const lines = [
    business.name || "Burrabazar Festival Decor",
    `MIDORI KANJO - ${copy.reportTitle}`,
    rangeLabel(report, active),
    "",
    copy.summary,
    `${copy.salesBilled}\t${money(report.salesBilled)}`,
    `${copy.moneyIn} - ${copy.receivedWithBills}\t${money(report.receivedWithBills)}`,
    `${copy.moneyIn} - ${copy.customerPayments}\t${money(report.customerPayments)}`,
    `${copy.total} ${copy.moneyIn}\t${money(report.moneyIn)}`,
    `${copy.supplierBills}\t${money(report.supplierBillsRecorded)}`,
    `${copy.moneyOut} - ${copy.paidWithPurchases}\t${money(report.paidWithPurchases)}`,
    `${copy.moneyOut} - ${copy.supplierPayments}\t${money(report.supplierPayments)}`,
    `${copy.moneyOut} - ${copy.miscExpenses}\t${money(report.miscellaneousExpenses)}`,
    `${copy.total} ${copy.moneyOut}\t${money(report.moneyOut)}`,
    `${copy.netCashFlow}\t${money(report.netCashFlow)}`,
    `${copy.customerOutstanding}\t${money(report.customerOutstanding)}`,
    `${copy.supplierOutstanding}\t${money(report.supplierOutstanding)}`,
    "",
    copy.miscBreakdown,
    ...(report.expenseBreakdown.length
      ? report.expenseBreakdown.map((row) => `${copy.categories[row.category]}\t${money(row.amount)}`)
      : [copy.noMisc]),
    "",
    copy.detailedMovements,
    `${copy.date}\t${copy.direction}\t${copy.type}\t${copy.details}\t${copy.mode}\t${copy.amount}`,
    ...report.movements.map((movement) => [
      pdfDate(movement.date, active),
      movement.direction === "in" ? copy.incoming : copy.outgoing,
      copy.sources[movement.source],
      `${movementTitle(movement, active)}${movementDetails(movement, active) ? ` - ${movementDetails(movement, active)}` : ""}`,
      pdfPaymentMode(movement.mode, active),
      `${movement.direction === "in" ? "+" : "-"}${money(movement.amount)}`,
    ].join("\t")),
  ];
  return lines.join("\r\n");
}

export async function downloadCashFlowText(
  report: CashFlowReport,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = cashFlowCopy[active];
  const content = `\uFEFF${cashFlowText(report, business, active)}`;
  const name = `Midori-Kanjo-cash-flow-${filePart(report)}.txt`;
  if (await shareNativeBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), { fileName: name, title: copy.shareTitle, dialogTitle: copy.dialogTitle })) return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
