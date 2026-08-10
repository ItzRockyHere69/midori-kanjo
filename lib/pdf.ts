import type { Invoice, InvoiceLine, Language } from "./db";
import { invoiceInitialPaymentBreakdown, roundMoney } from "./billing";
import { localizedInvoicePartyName } from "./i18n";
import {
  isNativeApp,
  isTauriApp,
  openDesktopPrintBlob,
  openExternalUrl,
  saveDesktopBlob,
  shareNativeBlob,
} from "./native-files";
import {
  normalizePdfLanguage,
  pdfAmountInWords,
  pdfDate,
  pdfMoney,
  pdfPaymentMode,
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";

export type InvoiceFormat = "a4" | "a5" | "thermal";
export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  gstin: string;
  ownerName?: string;
  alternatePhone?: string;
  email?: string;
  logo?: string;
}

type Pdf = Awaited<ReturnType<typeof createPdf>>;
type Rgb = [number, number, number];

const GREEN: Rgb = [1, 73, 33];
const PALE: Rgb = [249, 249, 249];
const INK: Rgb = [33, 31, 29];
const MUTED: Rgb = [97, 95, 92];
const BORDER: Rgb = [226, 226, 219];
const MAX_THERMAL_PAGE_HEIGHT = 4800;

type InvoiceCopy = {
  quotation: string; taxInvoice: string; salesInvoice: string;
  customerQuotation: string; salesInvoiceSubject: string; phone: string;
  proprietor: string; alternatePhone: string; email: string;
  notProvided: string; continuedPage: (page: number) => string;
  estimateNotTax: string; originalRecipient: string; quotedTo: string;
  billTo: string; cashCustomer: string; quotationDetails: string;
  invoiceDetails: string; date: string; statusEstimate: string; payment: string;
  items: string; productSku: string; qty: string; rate: string; taxable: string;
  total: string; gstSummary: string; gstAmount: string; discountShort: string;
  subtotal: string; discount: string; taxableValue: string; roundOff: string;
  quotedTotal: string; grandTotal: string; amountPaid: string; balanceDue: string;
  amountInWords: string; quotationTerms: string; invoiceTerms: string;
  quotationNoDue: string; computerGeneratedInvoice: string; forBusiness: string;
  authorisedSignatory: string; pageOf: (page: number, total: number) => string;
  party: string; partyGstin: string; estimateNoDue: string; paid: string;
  due: string; quotationPrepared: string; thankYou: string;
  computerGeneratedDocument: (quotation: boolean) => string;
  payLater: string; partPaidVia: (channel: string) => string;
  otherCharges: string; quoted: string; invoice: string; quotedTotalShare: string;
  estimateUntilInvoice: string; pdfDownloaded: string; shareInvoicePdf: string;
  printTitle: string; choosePrintService: string; printOrOpen: string;
  carrierCharge: string; packingCharge: string; bigBoxCharge: string;
  taxableAt: string; units: Record<InvoiceLine["unit"], string>;
};

const invoiceCopy: Record<Language, InvoiceCopy> = {
  en: {
    quotation: "QUOTATION", taxInvoice: "TAX INVOICE", salesInvoice: "SALES INVOICE",
    customerQuotation: "Customer quotation", salesInvoiceSubject: "Sales invoice", phone: "Phone",
    proprietor: "Proprietor", alternatePhone: "Alternate", email: "Email",
    notProvided: "Not provided", continuedPage: (page) => `CONTINUED - PAGE ${page}`,
    estimateNotTax: "ESTIMATE - NOT A TAX INVOICE", originalRecipient: "ORIGINAL FOR RECIPIENT",
    quotedTo: "QUOTED TO", billTo: "BILL TO", cashCustomer: "Cash customer",
    quotationDetails: "QUOTATION DETAILS", invoiceDetails: "INVOICE DETAILS", date: "Date",
    statusEstimate: "Status: Estimate only", payment: "Payment", items: "Items",
    productSku: "PRODUCT / SKU", qty: "QTY", rate: "RATE", taxable: "TAXABLE", total: "TOTAL",
    gstSummary: "GST SUMMARY", gstAmount: "GST AMOUNT", discountShort: "Disc",
    subtotal: "Subtotal", discount: "Discount", taxableValue: "Taxable value", roundOff: "Round off",
    quotedTotal: "QUOTED TOTAL", grandTotal: "GRAND TOTAL", amountPaid: "Amount paid", balanceDue: "Balance due",
    amountInWords: "AMOUNT IN WORDS",
    quotationTerms: "Terms: Final rates and availability are confirmed when converted to an invoice.",
    invoiceTerms: "Terms: Goods once sold will not be taken back without prior agreement.",
    quotationNoDue: "This estimate does not create a payment due.",
    computerGeneratedInvoice: "This is a computer-generated invoice.", forBusiness: "For",
    authorisedSignatory: "Authorised signatory", pageOf: (page, total) => `Page ${page} of ${total}`,
    party: "Party", partyGstin: "Party GSTIN", estimateNoDue: "Estimate only - no payment due",
    paid: "Paid", due: "DUE", quotationPrepared: "Quotation prepared for review",
    thankYou: "Thank you for your business", computerGeneratedDocument: (quote) => `Computer-generated ${quote ? "quotation" : "invoice"}`,
    payLater: "Pay later / Credit", partPaidVia: (channel) => `Part paid via ${channel}`,
    otherCharges: "Other charges", quoted: "Quoted", invoice: "Invoice", quotedTotalShare: "Quoted total",
    estimateUntilInvoice: "Estimate only - no payment is due until invoiced.", pdfDownloaded: "PDF has been downloaded.",
    shareInvoicePdf: "Share invoice PDF", printTitle: "Print", choosePrintService: "Choose your Android print service or PDF viewer.", printOrOpen: "Print or open invoice",
    carrierCharge: "Carrier / transport", packingCharge: "Packing charge", bigBoxCharge: "Big box charge",
    taxableAt: "on", units: { piece: "pc", dozen: "dz", gross: "gross", bundle: "bundle", box: "box", packet: "pkt" },
  },
  hi: {
    quotation: "कोटेशन", taxInvoice: "टैक्स इनवॉइस", salesInvoice: "बिक्री बिल",
    customerQuotation: "ग्राहक का कोटेशन", salesInvoiceSubject: "बिक्री बिल", phone: "फोन",
    proprietor: "मालिक", alternatePhone: "दूसरा संपर्क", email: "ईमेल",
    notProvided: "दर्ज नहीं", continuedPage: (page) => `जारी - पेज ${page}`,
    estimateNotTax: "अनुमान - टैक्स इनवॉइस नहीं", originalRecipient: "ग्राहक की मूल प्रति",
    quotedTo: "जिसके लिए कोटेशन", billTo: "बिल किसके नाम", cashCustomer: "नकद ग्राहक",
    quotationDetails: "कोटेशन की जानकारी", invoiceDetails: "बिल की जानकारी", date: "तारीख",
    statusEstimate: "स्थिति: केवल अनुमान", payment: "भुगतान", items: "सामान",
    productSku: "सामान / SKU", qty: "मात्रा", rate: "रेट", taxable: "कर योग्य", total: "कुल",
    gstSummary: "GST का सारांश", gstAmount: "GST राशि", discountShort: "छूट",
    subtotal: "उप-कुल", discount: "छूट", taxableValue: "कर योग्य राशि", roundOff: "राउंड ऑफ",
    quotedTotal: "कोटेशन का कुल", grandTotal: "कुल रकम", amountPaid: "जमा रकम", balanceDue: "बाकी रकम",
    amountInWords: "राशि शब्दों में",
    quotationTerms: "शर्तें: बिल बनाते समय अंतिम रेट और उपलब्धता की पुष्टि होगी।",
    invoiceTerms: "शर्तें: पहले से सहमति के बिना बिका हुआ सामान वापस नहीं लिया जाएगा।",
    quotationNoDue: "इस अनुमान से कोई भुगतान बकाया नहीं बनता।",
    computerGeneratedInvoice: "यह कंप्यूटर से बनाया गया बिल है।", forBusiness: "की ओर से",
    authorisedSignatory: "अधिकृत हस्ताक्षर", pageOf: (page, total) => `पेज ${page} / ${total}`,
    party: "पार्टी", partyGstin: "पार्टी GSTIN", estimateNoDue: "केवल अनुमान - अभी भुगतान बाकी नहीं",
    paid: "जमा", due: "बाकी", quotationPrepared: "जाँच के लिए कोटेशन तैयार",
    thankYou: "आपके कारोबार के लिए धन्यवाद", computerGeneratedDocument: (quote) => `कंप्यूटर से बनाया गया ${quote ? "कोटेशन" : "बिल"}`,
    payLater: "बाद में भुगतान / उधार", partPaidVia: (channel) => `${channel} से आंशिक भुगतान`,
    otherCharges: "अन्य शुल्क", quoted: "कोटेशन", invoice: "बिल", quotedTotalShare: "कोटेशन का कुल",
    estimateUntilInvoice: "यह केवल अनुमान है। बिल बनने तक कोई भुगतान बाकी नहीं है।", pdfDownloaded: "PDF डाउनलोड हो गया है।",
    shareInvoicePdf: "बिल की PDF साझा करें", printTitle: "प्रिंट", choosePrintService: "Android प्रिंट सेवा या PDF व्यूअर चुनें।", printOrOpen: "बिल प्रिंट करें या खोलें",
    carrierCharge: "ढुलाई / ट्रांसपोर्ट", packingCharge: "पैकिंग शुल्क", bigBoxCharge: "बड़े बॉक्स का शुल्क",
    taxableAt: "पर", units: { piece: "पीस", dozen: "दर्जन", gross: "ग्रॉस", bundle: "बंडल", box: "बॉक्स", packet: "पैकेट" },
  },
  bn: {
    quotation: "কোটেশন", taxInvoice: "ট্যাক্স ইনভয়েস", salesInvoice: "বিক্রির বিল",
    customerQuotation: "ক্রেতার কোটেশন", salesInvoiceSubject: "বিক্রির বিল", phone: "ফোন",
    proprietor: "মালিক", alternatePhone: "অন্য যোগাযোগ", email: "ইমেল",
    notProvided: "দেওয়া নেই", continuedPage: (page) => `চলবে - পৃষ্ঠা ${page}`,
    estimateNotTax: "আনুমানিক হিসাব - ট্যাক্স ইনভয়েস নয়", originalRecipient: "ক্রেতার মূল কপি",
    quotedTo: "যাঁর জন্য কোটেশন", billTo: "যাঁর নামে বিল", cashCustomer: "নগদ ক্রেতা",
    quotationDetails: "কোটেশনের তথ্য", invoiceDetails: "বিলের তথ্য", date: "তারিখ",
    statusEstimate: "অবস্থা: শুধু আনুমানিক", payment: "পেমেন্ট", items: "পণ্য",
    productSku: "পণ্য / SKU", qty: "পরিমাণ", rate: "দর", taxable: "করযোগ্য", total: "মোট",
    gstSummary: "GST-এর সারাংশ", gstAmount: "GST-এর টাকা", discountShort: "ছাড়",
    subtotal: "উপমোট", discount: "ছাড়", taxableValue: "করযোগ্য টাকা", roundOff: "রাউন্ড অফ",
    quotedTotal: "কোটেশনের মোট", grandTotal: "সর্বমোট", amountPaid: "জমা টাকা", balanceDue: "বাকি টাকা",
    amountInWords: "কথায় টাকার পরিমাণ",
    quotationTerms: "শর্ত: বিল করার সময় চূড়ান্ত দর ও পণ্যের জোগান নিশ্চিত হবে।",
    invoiceTerms: "শর্ত: আগে থেকে সম্মতি ছাড়া বিক্রি হওয়া পণ্য ফেরত নেওয়া হবে না।",
    quotationNoDue: "এই আনুমানিক হিসাব থেকে কোনো পেমেন্ট বাকি তৈরি হয় না।",
    computerGeneratedInvoice: "এটি কম্পিউটারে তৈরি বিল।", forBusiness: "পক্ষে",
    authorisedSignatory: "অনুমোদিত স্বাক্ষর", pageOf: (page, total) => `পৃষ্ঠা ${page} / ${total}`,
    party: "পার্টি", partyGstin: "পার্টির GSTIN", estimateNoDue: "শুধু আনুমানিক - এখন কোনো পেমেন্ট বাকি নেই",
    paid: "জমা", due: "বাকি", quotationPrepared: "দেখার জন্য কোটেশন তৈরি",
    thankYou: "আপনার ব্যবসার জন্য ধন্যবাদ", computerGeneratedDocument: (quote) => `কম্পিউটারে তৈরি ${quote ? "কোটেশন" : "বিল"}`,
    payLater: "পরে পেমেন্ট / বাকি", partPaidVia: (channel) => `${channel}-এ আংশিক পেমেন্ট`,
    otherCharges: "অন্যান্য চার্জ", quoted: "কোটেশন", invoice: "বিল", quotedTotalShare: "কোটেশনের মোট",
    estimateUntilInvoice: "এটি শুধু আনুমানিক হিসাব। বিল না হওয়া পর্যন্ত কোনো পেমেন্ট বাকি নেই।", pdfDownloaded: "PDF ডাউনলোড হয়েছে।",
    shareInvoicePdf: "বিলের PDF শেয়ার করুন", printTitle: "প্রিন্ট", choosePrintService: "Android প্রিন্ট সার্ভিস বা PDF ভিউয়ার বেছে নিন।", printOrOpen: "বিল প্রিন্ট করুন বা খুলুন",
    carrierCharge: "বহন / পরিবহন", packingCharge: "প্যাকিং চার্জ", bigBoxCharge: "বড় বাক্সের চার্জ",
    taxableAt: "এর ওপর", units: { piece: "পিস", dozen: "ডজন", gross: "গ্রস", bundle: "বান্ডিল", box: "বক্স", packet: "প্যাকেট" },
  },
};

const chargeLabel = (
  charge: NonNullable<Invoice["otherCharges"]>[number],
  copy: InvoiceCopy,
) =>
  charge.code === "carrier"
    ? copy.carrierCharge
    : charge.code === "packing"
      ? copy.packingCharge
      : charge.code === "big_box"
        ? copy.bigBoxCharge
        : charge.label;

async function createPdf(format: InvoiceFormat, thermalHeight: number) {
  const { jsPDF } = await import("jspdf");
  const page = format === "a4" ? "a4" : format === "a5" ? "a5" : [80, thermalHeight] as [number, number];
  return await registerPdfFont(new jsPDF({ unit: "mm", format: page, orientation: "portrait", compress: true, putOnlyUsedFonts: true }));
}

const paymentDescription = (invoice: Invoice, language: Language) => {
  const copy = invoiceCopy[language];
  if (invoice.amountDue > 0 && invoice.amountPaid <= 0) return copy.payLater;
  const breakdown = invoiceInitialPaymentBreakdown(invoice);
  const channel = breakdown.length
    ? breakdown
        .map((entry) =>
          `${pdfPaymentMode(entry.mode, language)} ${pdfMoney(entry.amount, language)}${entry.reference ? ` (${entry.reference})` : ""}`,
        )
        .join(" + ")
    : pdfPaymentMode(invoice.paymentReceivedMode || invoice.paymentMode, language);
  return invoice.amountDue > 0 ? copy.partPaidVia(channel) : channel;
};

function taxGroups(lines: InvoiceLine[]) {
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const line of lines) {
    const current = groups.get(line.gstRate) || { taxable: 0, tax: 0 };
    current.taxable = roundMoney(current.taxable + line.taxableAmount);
    current.tax = roundMoney(current.tax + line.gstAmount);
    groups.set(line.gstRate, current);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

type ThermalInvoicePlan = {
  pageHeights: number[];
  itemPages: number[];
  summaryPage: number;
};

function thermalInvoicePlan(
  doc: Pdf,
  invoice: Invoice,
  business: BusinessSettings,
  language: Language,
): ThermalInvoicePlan {
  const copy = invoiceCopy[language];
  const contentWidth = 72;
  const shopName = business.name?.trim() || "Shop";
  const partyName = localizedInvoicePartyName(language, invoice);
  const lineCount = (
    text: string,
    width: number,
    fontSize: number,
    weight: "normal" | "bold" = "normal",
  ) => {
    setPdfFont(doc, weight);
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(text, width).length;
  };
  let y = 6;
  y += lineCount(shopName, contentWidth, 13, "bold") * 5;
  if (business.ownerName?.trim()) {
    y += lineCount(`${copy.proprietor}: ${business.ownerName.trim()}`, 68, 6.5) * 3.2;
  }
  if (business.address?.trim()) {
    y += lineCount(business.address.trim(), 68, 6.5) * 3.2;
  }
  for (const identityLine of [
    business.phone?.trim() ? `${copy.phone}: ${business.phone.trim()}` : "",
    business.alternatePhone?.trim()
      ? `${copy.alternatePhone}: ${business.alternatePhone.trim()}`
      : "",
    business.email?.trim() ? `${copy.email}: ${business.email.trim()}` : "",
    `GSTIN: ${business.gstin?.trim() || copy.notProvided}`,
  ].filter(Boolean)) {
    y += lineCount(identityLine, 68, 6.5) * 3.2;
  }
  y += 1 + 4;
  y += lineCount(
    invoice.type === "quotation"
      ? copy.quotation
      : invoice.gstTotal > 0
        ? copy.taxInvoice
        : copy.salesInvoice,
    contentWidth,
    9,
    "bold",
  ) * 4.5;
  y += 4;
  y += lineCount(`${copy.party}: ${partyName}`, contentWidth, 7) * 3.5;
  if (invoice.partyGstin) y += lineCount(`${copy.partyGstin}: ${invoice.partyGstin}`, contentWidth, 7) * 3.5;
  y += lineCount(
    invoice.type === "quotation"
      ? copy.estimateNoDue
      : `${copy.payment}: ${paymentDescription(invoice, language)}`,
    contentWidth,
    7,
  ) * 3.5;
  y += 1 + 4;

  const itemHeights = invoice.lineItems.map((line, index) => {
    const localizedName = language === "hi"
      ? line.itemNameHi || line.itemName
      : language === "bn"
        ? line.itemNameBn || line.itemName
        : line.itemName;
    return lineCount(`${index + 1}. ${localizedName}`, contentWidth, 7.5, "bold") * 3.5 + 8.3;
  });
  const charges = invoice.otherCharges || [];
  const quotation = invoice.type === "quotation";
  const tenderRows = quotation ? [] : invoiceInitialPaymentBreakdown(invoice);
  const amountWordsLines = lineCount(
    pdfAmountInWords(invoice.grandTotal, language),
    contentWidth,
    6,
  );
  const regularRows =
    3
    + charges.length
    + (invoice.discountTotal ? 1 : 0)
    + (invoice.roundOff ? 1 : 0);
  const summaryHeight =
    4
    + regularRows * 4.2
    + 4
    + 5.5
    + (quotation ? 0 : 4.2 + (invoice.amountDue > 0 ? 5.5 : 4.2) + tenderRows.length * 4.2)
    + 4
    + 4
    + taxGroups(invoice.lineItems).length * 3.8
    + 4
    + amountWordsLines * 3.2
    + 3
    + 4
    + 2;

  const pageHeights: number[] = [];
  const itemPages: number[] = [];
  let page = 0;
  const finishPage = () => {
    pageHeights[page] = Math.min(
      MAX_THERMAL_PAGE_HEIGHT,
      Math.max(190, Math.ceil(y + 8)),
    );
  };
  for (let index = 0; index < invoice.lineItems.length; index += 1) {
    const itemHeight = itemHeights[index];
    if (y + itemHeight + 1 > MAX_THERMAL_PAGE_HEIGHT - 8 && y > 18) {
      finishPage();
      page += 1;
      y = 18;
    }
    itemPages[index] = page;
    y += itemHeight;
  }
  if (y + summaryHeight > MAX_THERMAL_PAGE_HEIGHT - 8 && y > 18) {
    finishPage();
    page += 1;
    y = 18;
  }
  const summaryPage = page;
  y += summaryHeight;
  finishPage();
  return { pageHeights, itemPages, summaryPage };
}

function drawRegularInvoice(doc: Pdf, invoice: Invoice, business: BusinessSettings, format: "a4" | "a5", language: Language) {
  const copy = invoiceCopy[language];
  const partyName = localizedInvoicePartyName(language, invoice);
  const money = (value: number) => pdfMoney(value, language);
  const invoiceDate = (value: string) => pdfDate(value, language);
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = format === "a4" ? 12 : 9;
  const contentWidth = width - margin * 2;
  const small = format === "a5";
  const right = width - margin;
  const taxableTotal = roundMoney(invoice.subtotal - invoice.discountTotal);
  const groups = taxGroups(invoice.lineItems);
  const charges = invoice.otherCharges || [];
  const quotation = invoice.type === "quotation";
  const documentTitle = quotation ? copy.quotation : invoice.gstTotal > 0 ? copy.taxInvoice : copy.salesInvoice;
  const shopName = business.name?.trim() || "Shop";
  const ownerName = business.ownerName?.trim() || "";
  const primaryPhone = business.phone?.trim() || "";
  const alternatePhone = business.alternatePhone?.trim() || "";
  const email = business.email?.trim() || "";
  const compactContact = [
    primaryPhone ? `${copy.phone}: ${primaryPhone}` : "",
    alternatePhone ? `${copy.alternatePhone}: ${alternatePhone}` : "",
    !primaryPhone && !alternatePhone && email ? email : "",
  ].filter(Boolean).join("  |  ");
  let pageNumber = 1;
  let y = margin;

  doc.setProperties({ title: `${invoice.invoiceNumber} - ${partyName}`, subject: quotation ? copy.customerQuotation : copy.salesInvoiceSubject, author: shopName, creator: "Invoice PDF" });

  const drawHeader = (continued = false) => {
    y = margin;
    if (continued) {
      const compactHeight = small ? 13 : 14;
      doc.setFillColor(...GREEN);
      doc.rect(margin, y, 1.5, compactHeight - 2, "F");
      doc.setTextColor(...INK);
      setPdfFont(doc, "bold");
      doc.setFontSize(small ? 6.5 : 7.5);
      doc.text(shopName, margin + 3.5, y + 4.2, { maxWidth: contentWidth * .52 });
      setPdfFont(doc);
      doc.setTextColor(...MUTED);
      doc.setFontSize(small ? 5.2 : 6);
      if (compactContact) {
        doc.text(compactContact, margin + 3.5, y + 8.5, { maxWidth: contentWidth * .58 });
      }
      setPdfFont(doc, "bold");
      doc.setTextColor(...GREEN);
      doc.setFontSize(small ? 5.4 : 6.2);
      doc.text(invoice.invoiceNumber, right, y + 4.2, { align: "right", maxWidth: contentWidth * .36 });
      setPdfFont(doc);
      doc.setTextColor(...MUTED);
      doc.text(copy.continuedPage(pageNumber), right, y + 8.5, { align: "right" });
      doc.setDrawColor(...BORDER);
      doc.line(margin, y + compactHeight - 1.5, right, y + compactHeight - 1.5);
      y += compactHeight;
      return;
    }

    const identityLineHeight = small ? 3 : 3.4;
    const address = business.address?.trim()
      ? doc.splitTextToSize(business.address.trim(), contentWidth * .56)
      : [];
    const fullContact = [
      primaryPhone ? `${copy.phone}: ${primaryPhone}` : "",
      alternatePhone ? `${copy.alternatePhone}: ${alternatePhone}` : "",
      email ? `${copy.email}: ${email}` : "",
    ].filter(Boolean).join("  |  ");
    const contactLines = fullContact
      ? doc.splitTextToSize(fullContact, contentWidth * .56)
      : [];
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 13.5 : 18);
    const shopNameLines = doc.splitTextToSize(shopName, contentWidth * .56);
    const shopLineHeight = small ? 4.8 : 6;
    const identityRows = (ownerName ? 1 : 0) + address.length + contactLines.length + 1;
    const fullHeaderHeight = Math.max(
      small ? 30 : 32,
      9 + shopNameLines.length * shopLineHeight + identityRows * identityLineHeight,
    );
    doc.setFillColor(...GREEN);
    doc.roundedRect(margin, y, contentWidth, fullHeaderHeight, 2.2, 2.2, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 13.5 : 18);
    shopNameLines.forEach((line: string, index: number) => {
      doc.text(line, margin + 5, y + 7 + index * shopLineHeight);
    });
    setPdfFont(doc);
    doc.setFontSize(small ? 5.5 : 6.5);
    let identityY = y + 8 + shopNameLines.length * shopLineHeight;
    if (ownerName) {
      doc.text(`${copy.proprietor}: ${ownerName}`, margin + 5, identityY, { maxWidth: contentWidth * .56 });
      identityY += small ? 3.2 : 3.6;
    }
    doc.text(address, margin + 5, identityY);
    identityY += address.length * identityLineHeight;
    if (contactLines.length) {
      doc.text(contactLines, margin + 5, identityY);
      identityY += contactLines.length * identityLineHeight;
    }
    doc.text(
      `GSTIN: ${business.gstin?.trim() || copy.notProvided}`,
      margin + 5,
      identityY,
      { maxWidth: contentWidth * .56 },
    );
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 10 : 12);
    doc.text(documentTitle, right - 5, y + 9, { align: "right" });
    doc.setFontSize(small ? 6.5 : 7.5);
    setPdfFont(doc);
    doc.text(quotation ? copy.estimateNotTax : copy.originalRecipient, right - 5, y + 14, { align: "right" });
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 7.5 : 8.5);
    doc.text(invoice.invoiceNumber, right - 5, y + 22, { align: "right" });
    y += fullHeaderHeight + 5;

    const detailLineHeight = small ? 3.4 : 3.8;
    const split = margin + contentWidth * .58;
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 9 : 10);
    const partyLines = doc.splitTextToSize(partyName, contentWidth * .52);
    setPdfFont(doc);
    doc.setFontSize(small ? 6.5 : 7.5);
    const paymentLines = doc.splitTextToSize(
      quotation ? copy.statusEstimate : `${copy.payment}: ${paymentDescription(invoice, language)}`,
      contentWidth * .36,
    );
    const detailsHeight = Math.max(
      small ? 28 : 30,
      17 + partyLines.length * detailLineHeight,
      23 + Math.max(1, paymentLines.length) * detailLineHeight,
    );
    doc.setDrawColor(...BORDER);
    doc.setFillColor(...PALE);
    doc.roundedRect(margin, y, contentWidth, detailsHeight, 1.5, 1.5, "FD");
    doc.line(split, y, split, y + detailsHeight);
    doc.setTextColor(...MUTED);
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 6 : 7);
    doc.text(quotation ? copy.quotedTo : copy.billTo, margin + 4, y + 5);
    doc.setTextColor(...INK);
    doc.setFontSize(small ? 9 : 10);
    doc.text(partyLines, margin + 4, y + 11);
    setPdfFont(doc);
    doc.setFontSize(small ? 6.5 : 7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `GSTIN: ${invoice.partyGstin || copy.notProvided}`,
      margin + 4,
      y + 12 + partyLines.length * detailLineHeight,
    );
    setPdfFont(doc, "bold");
    doc.text(quotation ? copy.quotationDetails : copy.invoiceDetails, split + 4, y + 5);
    setPdfFont(doc);
    doc.setTextColor(...INK);
    doc.text(`${copy.date}: ${invoiceDate(invoice.date)}`, split + 4, y + 11);
    doc.text(paymentLines, split + 4, y + 17);
    doc.text(
      `${copy.items}: ${invoice.lineItems.length}`,
      split + 4,
      y + 18 + paymentLines.length * detailLineHeight,
    );
    y += detailsHeight + 6;
  };

  const columns = small
    ? [6, 39, 14, 18, 20, 14, 17]
    : [8, 61, 19, 26, 27, 21, 24];
  const positions = columns.reduce<number[]>((all, column, index) => [...all, index ? all[index - 1] + columns[index - 1] : margin], []);
  const tableRight = margin + columns.reduce((sum, value) => sum + value, 0);

  const drawTableHeader = () => {
    const rowHeight = small ? 8 : 9;
    doc.setFillColor(...GREEN);
    doc.rect(margin, y, contentWidth, rowHeight, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 5.8 : 6.8);
    const labels = ["#", copy.productSku, copy.qty, copy.rate, copy.taxable, "GST", copy.total];
    labels.forEach((label, index) => doc.text(label, index === 0 ? positions[index] + 1.5 : index === 1 ? positions[index] + 1.5 : positions[index] + columns[index] - 1.5, y + rowHeight * .64, { align: index < 2 ? "left" : "right" }));
    y += rowHeight;
  };

  const addContinuationPage = (includeTableHeader = false) => {
    doc.addPage();
    pageNumber += 1;
    drawHeader(true);
    if (includeTableHeader) drawTableHeader();
  };

  drawHeader();
  drawTableHeader();
  invoice.lineItems.forEach((line, index) => {
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 6.5 : 7.5);
    const localizedName = language === "hi" ? line.itemNameHi || line.itemName : language === "bn" ? line.itemNameBn || line.itemName : line.itemName;
    const nameLines = doc.splitTextToSize(localizedName, columns[1] - 3);
    const rowHeight = Math.max(small ? 13 : 14, nameLines.length * (small ? 3 : 3.5) + (small ? 7 : 8));
    if (y + rowHeight > height - 18) {
      addContinuationPage(true);
    }
    if (index % 2) { doc.setFillColor(...PALE); doc.rect(margin, y, contentWidth, rowHeight, "F"); }
    doc.setDrawColor(...BORDER);
    doc.line(margin, y + rowHeight, tableRight, y + rowHeight);
    doc.setTextColor(...MUTED);
    setPdfFont(doc);
    doc.setFontSize(small ? 6 : 6.8);
    doc.text(String(index + 1), positions[0] + 1.5, y + 5);
    doc.setTextColor(...INK);
    setPdfFont(doc, "bold");
    doc.setFontSize(small ? 6.5 : 7.5);
    doc.text(nameLines, positions[1] + 1.5, y + 5);
    setPdfFont(doc);
    doc.setTextColor(...MUTED);
    doc.setFontSize(small ? 5.2 : 5.8);
    const details = `${line.skuCode}${line.hsnCode ? ` | HSN ${line.hsnCode}` : ""}${line.discount ? ` | ${copy.discountShort} ${line.discount}%` : ""}`;
    doc.text(details, positions[1] + 1.5, y + rowHeight - 3);
    doc.setTextColor(...INK);
    doc.setFontSize(small ? 5.8 : 6.8);
    const values = [
      `${line.qty} ${copy.units[line.unit]}`,
      money(line.rate),
      money(line.taxableAmount),
      `${line.gstRate}%\n${money(line.gstAmount)}`,
      money(line.amount)
    ];
    values.forEach((value, valueIndex) => doc.text(value, positions[valueIndex + 2] + columns[valueIndex + 2] - 1.5, y + 5, { align: "right", maxWidth: columns[valueIndex + 2] - 2 }));
    y += rowHeight;
  });

  const optionalTotalRows =
    charges.length + (invoice.discountTotal ? 1 : 0) + (invoice.roundOff ? 1 : 0);
  const tenderRows = quotation ? [] : invoiceInitialPaymentBreakdown(invoice);
  const summaryHeight = small
    ? 108 + groups.length * 7 + (optionalTotalRows + tenderRows.length) * 6
    : 69 + groups.length * 7 + (optionalTotalRows + tenderRows.length) * 7.5;
  if (y + summaryHeight > height - 14) {
    addContinuationPage();
  }
  y += 5;
  const taxWidth = small ? contentWidth : contentWidth * .5;
  const taxStart = y;
  setPdfFont(doc, "bold");
  doc.setTextColor(...INK);
  doc.setFontSize(small ? 7 : 8);
  doc.text(copy.gstSummary, margin, y + 4);
  y += 7;
  doc.setFillColor(...PALE);
  doc.rect(margin, y, taxWidth, 7, "F");
  doc.setFontSize(small ? 5.8 : 6.5);
  doc.text(copy.rate, margin + 2, y + 4.5);
  doc.text(copy.taxable, margin + taxWidth * .61, y + 4.5, { align: "right" });
  doc.text(copy.gstAmount, margin + taxWidth - 2, y + 4.5, { align: "right" });
  y += 7;
  setPdfFont(doc);
  for (const [rate, group] of groups) {
    doc.text(`${rate}%`, margin + 2, y + 4.5);
    doc.text(money(group.taxable), margin + taxWidth * .61, y + 4.5, { align: "right" });
    doc.text(money(group.tax), margin + taxWidth - 2, y + 4.5, { align: "right" });
    doc.setDrawColor(...BORDER);
    doc.line(margin, y + 6.5, margin + taxWidth, y + 6.5);
    y += 7;
  }

  const totalsY = small ? y + 4 : taxStart;
  const totalsX = small ? margin : margin + contentWidth * .56;
  const totalsWidth = small ? contentWidth : contentWidth * .44;
  let totalRowY = totalsY;
  const totalRow = (label: string, value: number, strong = false) => {
    setPdfFont(doc, strong ? "bold" : "normal");
    doc.setFontSize(strong ? (small ? 9 : 10) : (small ? 6.5 : 7.5));
    doc.setTextColor(...(strong ? GREEN : INK));
    if (strong) { doc.setFillColor(...PALE); doc.rect(totalsX, totalRowY - 1, totalsWidth, small ? 8 : 9, "F"); }
    doc.text(label, totalsX + 2, totalRowY + 4.5);
    doc.text(money(value), totalsX + totalsWidth - 2, totalRowY + 4.5, { align: "right" });
    totalRowY += strong ? (small ? 8 : 10) : (small ? 6 : 7.5);
  };
  totalRow(copy.subtotal, invoice.subtotal);
  if (invoice.discountTotal) totalRow(copy.discount, -invoice.discountTotal);
  totalRow(copy.taxableValue, taxableTotal);
  totalRow("GST", invoice.gstTotal);
  charges.forEach((charge) => totalRow(chargeLabel(charge, copy), charge.amount));
  if (invoice.roundOff) totalRow(copy.roundOff, invoice.roundOff);
  totalRow(quotation ? copy.quotedTotal : copy.grandTotal, invoice.grandTotal, true);
  if (!quotation) {
    totalRow(copy.amountPaid, invoice.amountPaid);
    totalRow(copy.balanceDue, invoice.amountDue, invoice.amountDue > 0);
    tenderRows.forEach((entry) =>
      totalRow(`↳ ${pdfPaymentMode(entry.mode, language)}`, entry.amount),
    );
  }
  if (!small) {
    const wordsY = y + 3;
    doc.setFillColor(...PALE);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(margin, wordsY, taxWidth, 16, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(copy.amountInWords, margin + 3, wordsY + 5);
    setPdfFont(doc);
    doc.setTextColor(...INK);
    doc.setFontSize(7);
    doc.text(doc.splitTextToSize(pdfAmountInWords(invoice.grandTotal, language), taxWidth - 6), margin + 3, wordsY + 10);
    doc.setTextColor(...MUTED);
    doc.setFontSize(6.2);
    doc.text(quotation ? copy.quotationTerms : copy.invoiceTerms, margin, wordsY + 22, { maxWidth: taxWidth });
    doc.text(quotation ? copy.quotationNoDue : copy.computerGeneratedInvoice, margin, wordsY + 29);
  } else {
    y = Math.max(y, totalRowY) + 5;
    doc.setFillColor(...PALE);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(margin, y, contentWidth, 15, 1.5, 1.5, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(5.8);
    doc.setTextColor(...MUTED);
    doc.text(copy.amountInWords, margin + 3, y + 5);
    setPdfFont(doc);
    doc.setTextColor(...INK);
    doc.setFontSize(6.2);
    doc.text(doc.splitTextToSize(pdfAmountInWords(invoice.grandTotal, language), contentWidth - 6), margin + 3, y + 10);
    y += 18;
    doc.setTextColor(...MUTED);
    setPdfFont(doc);
    doc.setFontSize(5.5);
    doc.text(quotation ? copy.quotationTerms : copy.invoiceTerms, margin, y + 3, { maxWidth: contentWidth * .62 });
    doc.text(quotation ? copy.estimateNoDue : copy.computerGeneratedInvoice, margin, y + 8);
    doc.setTextColor(...INK);
    setPdfFont(doc, "bold");
    doc.text(copy.authorisedSignatory, right, y + 3, { align: "right" });
    doc.setDrawColor(...BORDER);
    doc.line(right - 40, y + 15, right, y + 15);
    setPdfFont(doc);
    doc.setTextColor(...MUTED);
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(margin, height - 8, right, height - 8);
    doc.setTextColor(...MUTED);
    setPdfFont(doc);
    doc.setFontSize(5.5);
    doc.text(invoice.invoiceNumber, margin, height - 4.5);
    doc.text(copy.pageOf(page, totalPages), right, height - 4.5, { align: "right" });
  }
}

function drawThermalInvoice(doc: Pdf, invoice: Invoice, business: BusinessSettings, language: Language, plan: ThermalInvoicePlan) {
  const copy = invoiceCopy[language];
  const partyName = localizedInvoicePartyName(language, invoice);
  const money = (value: number) => pdfMoney(value, language);
  const invoiceDate = (value: string) => pdfDate(value, language);
  const width = doc.internal.pageSize.getWidth();
  const margin = 4;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const taxableTotal = roundMoney(invoice.subtotal - invoice.discountTotal);
  const groups = taxGroups(invoice.lineItems);
  const charges = invoice.otherCharges || [];
  const quotation = invoice.type === "quotation";
  const shopName = business.name?.trim() || "Shop";
  const compactContact = [
    business.phone?.trim(),
    business.alternatePhone?.trim(),
    !business.phone?.trim() && !business.alternatePhone?.trim()
      ? business.email?.trim()
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
  let pageNumber = 1;
  let pageIndex = 0;
  let y = 6;

  const split = (
    text: string,
    fontSize: number,
    maxWidth = contentWidth,
    weight: "normal" | "bold" = "normal",
  ): string[] => {
    setPdfFont(doc, weight);
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(text, maxWidth) as string[];
  };
  const drawCenteredLines = (lines: string[], lineHeight: number) => {
    lines.forEach((line, index) => {
      doc.text(line, width / 2, y + index * lineHeight, { align: "center" });
    });
    y += lines.length * lineHeight;
  };
  const divider = () => {
    doc.setDrawColor(90, 90, 90);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(margin, y, right, y);
    doc.setLineDashPattern([], 0);
    y += 4;
  };
  const drawContinuationHeader = () => {
    y = 6;
    doc.setFillColor(...GREEN);
    doc.rect(margin, y - 2.5, 1.2, 11, "F");
    doc.setTextColor(...INK);
    setPdfFont(doc, "bold");
    doc.setFontSize(6.2);
    doc.text(split(shopName, 6.2, 43, "bold").slice(0, 1), margin + 2.5, y);
    setPdfFont(doc);
    doc.setFontSize(5.2);
    if (compactContact) {
      doc.text(split(compactContact, 5.2, 43).slice(0, 1), margin + 2.5, y + 4);
    }
    doc.setTextColor(...GREEN);
    setPdfFont(doc, "bold");
    doc.text(invoice.invoiceNumber, right, y, { align: "right", maxWidth: 24 });
    setPdfFont(doc);
    doc.setTextColor(...MUTED);
    doc.text(copy.continuedPage(pageNumber), right, y + 4, { align: "right" });
    doc.setDrawColor(...BORDER);
    doc.line(margin, y + 7.5, right, y + 7.5);
    y += 12;
  };
  const addContinuationPage = () => {
    pageIndex += 1;
    doc.addPage([80, plan.pageHeights[pageIndex]], "portrait");
    pageNumber += 1;
    drawContinuationHeader();
  };
  const row = (label: string, value: string, bold = false) => {
    setPdfFont(doc, bold ? "bold" : "normal");
    doc.setFontSize(bold ? 9 : 7);
    doc.text(label, margin, y);
    doc.text(value, right, y, { align: "right" });
    y += bold ? 5.5 : 4.2;
  };

  doc.setProperties({
    title: `${invoice.invoiceNumber} - ${partyName}`,
    subject: quotation ? copy.customerQuotation : copy.salesInvoiceSubject,
    author: shopName,
    creator: "Invoice PDF",
  });

  doc.setTextColor(...INK);
  drawCenteredLines(split(shopName, 13, contentWidth, "bold"), 5);
  const identityLine = (text: string) => {
    drawCenteredLines(split(text, 6.5, contentWidth - 4), 3.2);
  };
  if (business.ownerName?.trim()) {
    identityLine(`${copy.proprietor}: ${business.ownerName.trim()}`);
  }
  if (business.address?.trim()) identityLine(business.address.trim());
  if (business.phone?.trim()) identityLine(`${copy.phone}: ${business.phone.trim()}`);
  if (business.alternatePhone?.trim()) {
    identityLine(`${copy.alternatePhone}: ${business.alternatePhone.trim()}`);
  }
  if (business.email?.trim()) identityLine(`${copy.email}: ${business.email.trim()}`);
  identityLine(`GSTIN: ${business.gstin?.trim() || copy.notProvided}`);
  y += 1;
  divider();

  drawCenteredLines(
    split(
      quotation ? copy.quotation : invoice.gstTotal > 0 ? copy.taxInvoice : copy.salesInvoice,
      9,
      contentWidth,
      "bold",
    ),
    4.5,
  );
  setPdfFont(doc);
  doc.setFontSize(7);
  doc.text(invoice.invoiceNumber, margin, y);
  doc.text(invoiceDate(invoice.date), right, y, { align: "right" });
  y += 4;
  const partyLines = split(`${copy.party}: ${partyName}`, 7);
  partyLines.forEach((line, index) => doc.text(line, margin, y + index * 3.5));
  y += partyLines.length * 3.5;
  if (invoice.partyGstin) {
    const gstinLines = split(`${copy.partyGstin}: ${invoice.partyGstin}`, 7);
    gstinLines.forEach((line, index) => doc.text(line, margin, y + index * 3.5));
    y += gstinLines.length * 3.5;
  }
  const paymentLines = split(
    quotation ? copy.estimateNoDue : `${copy.payment}: ${paymentDescription(invoice, language)}`,
    7,
  );
  paymentLines.forEach((line, index) => doc.text(line, margin, y + index * 3.5));
  y += paymentLines.length * 3.5 + 1;
  divider();

  invoice.lineItems.forEach((line, index) => {
    const localizedName = language === "hi"
      ? line.itemNameHi || line.itemName
      : language === "bn"
        ? line.itemNameBn || line.itemName
        : line.itemName;
    const nameLines = split(`${index + 1}. ${localizedName}`, 7.5, contentWidth, "bold");
    while (pageIndex < plan.itemPages[index]) addContinuationPage();
    setPdfFont(doc, "bold");
    doc.setFontSize(7.5);
    nameLines.forEach((nameLine, lineIndex) => {
      doc.text(nameLine, margin, y + lineIndex * 3.5);
    });
    y += nameLines.length * 3.5;
    setPdfFont(doc);
    doc.setFontSize(6.5);
    doc.text(`${line.qty} ${copy.units[line.unit]} x ${money(line.rate)}`, margin, y);
    setPdfFont(doc, "bold");
    doc.text(money(line.amount), right, y, { align: "right" });
    y += 3.8;
    setPdfFont(doc);
    doc.setFontSize(5.8);
    doc.text(
      `${copy.taxable} ${money(line.taxableAmount)} | GST ${line.gstRate}%: ${money(line.gstAmount)}`,
      margin,
      y,
    );
    y += 4.5;
    doc.setDrawColor(210, 210, 210);
    doc.line(margin, y - 1.7, right, y - 1.7);
  });

  const amountWords = split(pdfAmountInWords(invoice.grandTotal, language), 6);
  const tenderRows = quotation ? [] : invoiceInitialPaymentBreakdown(invoice);
  while (pageIndex < plan.summaryPage) addContinuationPage();
  divider();
  row(copy.subtotal, money(invoice.subtotal));
  if (invoice.discountTotal) row(copy.discount, `- ${money(invoice.discountTotal)}`);
  row(copy.taxable, money(taxableTotal));
  row("GST", money(invoice.gstTotal));
  charges.forEach((charge) => row(chargeLabel(charge, copy), money(charge.amount)));
  if (invoice.roundOff) row(copy.roundOff, money(invoice.roundOff));
  divider();
  row(quotation ? copy.quotedTotal : copy.grandTotal, money(invoice.grandTotal), true);
  if (!quotation) {
    row(copy.paid, money(invoice.amountPaid));
    row(copy.due, money(invoice.amountDue), invoice.amountDue > 0);
    tenderRows.forEach((entry) =>
      row(`↳ ${pdfPaymentMode(entry.mode, language)}`, money(entry.amount)),
    );
  }
  divider();
  setPdfFont(doc, "bold");
  doc.setFontSize(6.5);
  doc.text(copy.gstSummary, margin, y);
  y += 4;
  setPdfFont(doc);
  doc.setFontSize(6);
  for (const [rate, group] of groups) {
    doc.text(`${rate}% ${copy.taxableAt} ${money(group.taxable)}`, margin, y);
    doc.text(money(group.tax), right, y, { align: "right" });
    y += 3.8;
  }
  divider();
  setPdfFont(doc);
  doc.setFontSize(6);
  drawCenteredLines(amountWords, 3.2);
  y += 3;
  setPdfFont(doc, "bold");
  doc.setFontSize(7);
  doc.text(quotation ? copy.quotationPrepared : copy.thankYou, width / 2, y, { align: "center" });
  y += 4;
  setPdfFont(doc);
  doc.setFontSize(5.5);
  doc.text(copy.computerGeneratedDocument(quotation), width / 2, y, { align: "center" });
}

export async function invoicePdf(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat, language: Language = "en") {
  const activeLanguage = normalizePdfLanguage(language);
  if (format === "thermal") {
    const measurementDoc = await createPdf("thermal", 190);
    const plan = thermalInvoicePlan(
      measurementDoc,
      invoice,
      business,
      activeLanguage,
    );
    const doc = await createPdf(
      "thermal",
      plan.pageHeights[0],
    );
    drawThermalInvoice(doc, invoice, business, activeLanguage, plan);
    return doc;
  }
  const doc = await createPdf(format, 190);
  drawRegularInvoice(doc, invoice, business, format, activeLanguage);
  return doc;
}

export async function shareInvoice(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat, preparedWindow?: Window | null, customMessage?: string, language: Language = "en") {
  const activeLanguage = normalizePdfLanguage(language);
  const copy = invoiceCopy[activeLanguage];
  const partyName = localizedInvoicePartyName(activeLanguage, invoice);
  const money = (value: number) => pdfMoney(value, activeLanguage);
  const defaultMessage = invoice.type === "quotation" ? `${partyName} | ${copy.quoted} ${money(invoice.grandTotal)}` : `${partyName} | ${money(invoice.grandTotal)} | ${copy.due} ${money(invoice.amountDue)}`;
  const shareText = customMessage?.trim() || defaultMessage;
  if (isTauriApp()) {
    preparedWindow?.close();
    const doc = await invoicePdf(invoice, business, format, activeLanguage);
    const fileName = `${invoice.invoiceNumber}.pdf`;
    const savedPath = await saveDesktopBlob(doc.output("blob"), {
      fileName,
      title: `${invoice.type === "quotation" ? copy.quotation : copy.invoice} ${invoice.invoiceNumber}`,
      dialogTitle: copy.shareInvoicePdf,
    });
    if (!savedPath) return false;
    await openExternalUrl(
      `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${copy.pdfDownloaded}`)}`,
    );
    return true;
  }
  if (isNativeApp()) {
    preparedWindow?.close();
    const doc = await invoicePdf(invoice, business, format, activeLanguage);
    await shareNativeBlob(doc.output("blob"), {
      fileName: `${invoice.invoiceNumber}.pdf`,
      title: `${invoice.type === "quotation" ? copy.quotation : copy.invoice} ${invoice.invoiceNumber}`,
      text: shareText,
      dialogTitle: copy.shareInvoicePdf,
    });
    return true;
  }
  const supportsFileShare = "share" in navigator && "canShare" in navigator;
  const whatsappWindow = supportsFileShare ? preparedWindow || null : preparedWindow || window.open("", "_blank");
  const doc = await invoicePdf(invoice, business, format, activeLanguage);
  const blob = doc.output("blob");
  const file = new File([blob], `${invoice.invoiceNumber}.pdf`, { type: "application/pdf" });
  if (supportsFileShare && navigator.canShare({ files: [file] })) {
    if (whatsappWindow) whatsappWindow.close();
    await navigator.share({ title: invoice.invoiceNumber, text: shareText, files: [file] });
    return true;
  }
  doc.save(`${invoice.invoiceNumber}.pdf`);
  const chargesText = invoice.otherChargesTotal ? `\n${copy.otherCharges}: ${money(invoice.otherChargesTotal)}` : "";
  const whatsappText = customMessage?.trim() || (invoice.type === "quotation"
    ? `${copy.quotation} ${invoice.invoiceNumber}\n${partyName}\n${copy.quotedTotalShare}: ${money(invoice.grandTotal)}\nGST: ${money(invoice.gstTotal)}${chargesText}\n${copy.estimateUntilInvoice}\n${copy.pdfDownloaded}`
    : `${copy.invoice} ${invoice.invoiceNumber}\n${partyName}\n${copy.total}: ${money(invoice.grandTotal)}\nGST: ${money(invoice.gstTotal)}${chargesText}\n${copy.due}: ${money(invoice.amountDue)}\n${copy.pdfDownloaded}`);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
  if (whatsappWindow) { whatsappWindow.opener = null; whatsappWindow.location.href = whatsappUrl; }
  else window.location.href = whatsappUrl;
  return false;
}

export async function printInvoice(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat, preparedWindow?: Window | null, language: Language = "en") {
  const activeLanguage = normalizePdfLanguage(language);
  const copy = invoiceCopy[activeLanguage];
  const native = isNativeApp();
  // Browsers only allow popups in the synchronous user-gesture call stack.
  // Reserve the tab before PDF/font generation yields to HarfBuzz/WASM.
  const printWindow = native ? null : preparedWindow || window.open("", "_blank");
  try {
    const doc = await invoicePdf(invoice, business, format, activeLanguage);
    if (native) {
      preparedWindow?.close();
      if (isTauriApp()) {
        await openDesktopPrintBlob(doc.output("blob"), {
          fileName: `${invoice.invoiceNumber}.pdf`,
          title: `${copy.printTitle} ${invoice.invoiceNumber}`,
        });
        return;
      }
      await shareNativeBlob(doc.output("blob"), {
        fileName: `${invoice.invoiceNumber}.pdf`,
        title: `${copy.printTitle} ${invoice.invoiceNumber}`,
        text: copy.choosePrintService,
        dialogTitle: copy.printOrOpen,
      });
      return;
    }
    doc.autoPrint();
    const url = doc.output("bloburl");
    if (printWindow) {
      printWindow.opener = null;
      printWindow.location.href = String(url);
    } else {
      doc.save(`${invoice.invoiceNumber}.pdf`);
    }
  } catch (error) {
    printWindow?.close();
    throw error;
  }
}
