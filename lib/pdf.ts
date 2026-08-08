import type { Invoice, InvoiceLine } from "./db";
import { roundMoney, unitShort } from "./billing";
import { isNativeApp, shareNativeBlob } from "./native-files";

export type InvoiceFormat = "a4" | "a5" | "thermal";
export interface BusinessSettings { name: string; address: string; phone: string; gstin: string; logo?: string }

type Pdf = Awaited<ReturnType<typeof createPdf>>;
type Rgb = [number, number, number];

const GREEN: Rgb = [1, 73, 33];
const PALE: Rgb = [249, 249, 249];
const INK: Rgb = [33, 31, 29];
const MUTED: Rgb = [97, 95, 92];
const BORDER: Rgb = [226, 226, 219];

async function createPdf(format: InvoiceFormat, thermalHeight: number) {
  const { jsPDF } = await import("jspdf");
  const page = format === "a4" ? "a4" : format === "a5" ? "a5" : [80, thermalHeight] as [number, number];
  return new jsPDF({ unit: "mm", format: page, orientation: "portrait", compress: true });
}

const money = (value: number) => `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;
const invoiceDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const titleCase = (value: string) => value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
const paymentDescription = (invoice: Invoice) => {
  if (invoice.amountDue > 0 && invoice.amountPaid <= 0) return "Pay later / Credit";
  const channel = titleCase(invoice.paymentReceivedMode || invoice.paymentMode);
  return invoice.amountDue > 0 ? `Part paid via ${channel}` : channel;
};

function amountInWords(value: number) {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const belowHundred = (number: number) => number < 20 ? ones[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
  const integer = Math.max(0, Math.round(value));
  if (!integer) return "Zero Rupees Only";
  let remainder = integer;
  const parts: string[] = [];
  const add = (divisor: number, label: string) => {
    const count = Math.floor(remainder / divisor);
    if (!count) return;
    if (count >= 100) {
      const hundred = Math.floor(count / 100);
      parts.push(`${belowHundred(hundred)} hundred${count % 100 ? ` ${belowHundred(count % 100)}` : ""} ${label}`.trim());
    } else parts.push(`${belowHundred(count)} ${label}`.trim());
    remainder %= divisor;
  };
  add(10_000_000, "crore");
  add(100_000, "lakh");
  add(1_000, "thousand");
  add(100, "hundred");
  if (remainder) parts.push(belowHundred(remainder));
  return `${titleCase(parts.join(" "))} Rupees Only`;
}

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

function drawRegularInvoice(doc: Pdf, invoice: Invoice, business: BusinessSettings, format: "a4" | "a5") {
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
  const documentTitle = quotation ? "QUOTATION" : invoice.gstTotal > 0 ? "TAX INVOICE" : "SALES INVOICE";
  let pageNumber = 1;
  let y = margin;

  doc.setProperties({ title: `${invoice.invoiceNumber} - ${invoice.partyName}`, subject: quotation ? "Customer quotation" : "Sales invoice", author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });

  const drawHeader = (continued = false) => {
    y = margin;
    doc.setFillColor(...GREEN);
    doc.roundedRect(margin, y, contentWidth, small ? 29 : 32, 2.2, 2.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 15 : 19);
    doc.text(business.name || "Burrabazar Festival Decor", margin + 5, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(small ? 6.5 : 7.5);
    const address = doc.splitTextToSize(business.address || "Burrabazar, Kolkata, West Bengal", contentWidth * .58);
    doc.text(address.slice(0, 2), margin + 5, y + 13);
    const contact = [business.phone ? `Phone: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : "GSTIN: Not provided"].filter(Boolean).join("  |  ");
    doc.text(contact, margin + 5, y + (small ? 23 : 25));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 10 : 12);
    doc.text(documentTitle, right - 5, y + 9, { align: "right" });
    doc.setFontSize(small ? 6.5 : 7.5);
    doc.setFont("helvetica", "normal");
    doc.text(continued ? `CONTINUED - PAGE ${pageNumber}` : quotation ? "ESTIMATE - NOT A TAX INVOICE" : "ORIGINAL FOR RECIPIENT", right - 5, y + 14, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 7.5 : 8.5);
    doc.text(invoice.invoiceNumber, right - 5, y + 22, { align: "right" });
    y += small ? 34 : 37;

    if (!continued) {
      doc.setDrawColor(...BORDER);
      doc.setFillColor(...PALE);
      doc.roundedRect(margin, y, contentWidth, small ? 28 : 30, 1.5, 1.5, "FD");
      const split = margin + contentWidth * .58;
      doc.line(split, y, split, y + (small ? 28 : 30));
      doc.setTextColor(...MUTED);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(small ? 6 : 7);
      doc.text(quotation ? "QUOTED TO" : "BILL TO", margin + 4, y + 5);
      doc.setTextColor(...INK);
      doc.setFontSize(small ? 9 : 10);
      doc.text(invoice.partyName || "Cash customer", margin + 4, y + 11, { maxWidth: contentWidth * .52 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(small ? 6.5 : 7.5);
      doc.setTextColor(...MUTED);
      doc.text(`GSTIN: ${invoice.partyGstin || "Not provided"}`, margin + 4, y + 17);
      doc.setFont("helvetica", "bold");
      doc.text(quotation ? "QUOTATION DETAILS" : "INVOICE DETAILS", split + 4, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...INK);
      doc.text(`Date: ${invoiceDate(invoice.date)}`, split + 4, y + 11);
      doc.text(quotation ? "Status: Estimate only" : `Payment: ${paymentDescription(invoice)}`, split + 4, y + 17);
      doc.text(`Items: ${invoice.lineItems.length}`, split + 4, y + 23);
      y += small ? 34 : 36;
    } else y += 5;
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
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 5.8 : 6.8);
    const labels = ["#", "PRODUCT / SKU", "QTY", "RATE", "TAXABLE", "GST", "TOTAL"];
    labels.forEach((label, index) => doc.text(label, index === 0 ? positions[index] + 1.5 : index === 1 ? positions[index] + 1.5 : positions[index] + columns[index] - 1.5, y + rowHeight * .64, { align: index < 2 ? "left" : "right" }));
    y += rowHeight;
  };

  drawHeader();
  drawTableHeader();
  invoice.lineItems.forEach((line, index) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 6.5 : 7.5);
    const nameLines = doc.splitTextToSize(line.itemName, columns[1] - 3).slice(0, 2);
    const rowHeight = Math.max(small ? 13 : 14, nameLines.length * (small ? 3 : 3.5) + (small ? 7 : 8));
    if (y + rowHeight > height - 18) {
      doc.addPage();
      pageNumber += 1;
      drawHeader(true);
      drawTableHeader();
    }
    if (index % 2) { doc.setFillColor(...PALE); doc.rect(margin, y, contentWidth, rowHeight, "F"); }
    doc.setDrawColor(...BORDER);
    doc.line(margin, y + rowHeight, tableRight, y + rowHeight);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(small ? 6 : 6.8);
    doc.text(String(index + 1), positions[0] + 1.5, y + 5);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(small ? 6.5 : 7.5);
    doc.text(nameLines, positions[1] + 1.5, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.setFontSize(small ? 5.2 : 5.8);
    const details = `${line.skuCode}${line.hsnCode ? ` | HSN ${line.hsnCode}` : ""}${line.discount ? ` | Disc ${line.discount}%` : ""}`;
    doc.text(details, positions[1] + 1.5, y + rowHeight - 3);
    doc.setTextColor(...INK);
    doc.setFontSize(small ? 5.8 : 6.8);
    const values = [
      `${line.qty} ${unitShort(line.unit)}`,
      money(line.rate),
      money(line.taxableAmount),
      `${line.gstRate}%\n${money(line.gstAmount)}`,
      money(line.amount)
    ];
    values.forEach((value, valueIndex) => doc.text(value, positions[valueIndex + 2] + columns[valueIndex + 2] - 1.5, y + 5, { align: "right", maxWidth: columns[valueIndex + 2] - 2 }));
    y += rowHeight;
  });

  const summaryHeight = (small ? 78 : 69) + charges.length * (small ? 7 : 7.5);
  if (y + summaryHeight > height - 14) {
    doc.addPage();
    pageNumber += 1;
    drawHeader(true);
  }
  y += 5;
  const taxWidth = small ? contentWidth : contentWidth * .5;
  const taxStart = y;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  doc.setFontSize(small ? 7 : 8);
  doc.text("GST SUMMARY", margin, y + 4);
  y += 7;
  doc.setFillColor(...PALE);
  doc.rect(margin, y, taxWidth, 7, "F");
  doc.setFontSize(small ? 5.8 : 6.5);
  doc.text("RATE", margin + 2, y + 4.5);
  doc.text("TAXABLE", margin + taxWidth * .61, y + 4.5, { align: "right" });
  doc.text("GST AMOUNT", margin + taxWidth - 2, y + 4.5, { align: "right" });
  y += 7;
  doc.setFont("helvetica", "normal");
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
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? (small ? 9 : 10) : (small ? 6.5 : 7.5));
    doc.setTextColor(...(strong ? GREEN : INK));
    if (strong) { doc.setFillColor(...PALE); doc.rect(totalsX, totalRowY - 1, totalsWidth, small ? 8 : 9, "F"); }
    doc.text(label, totalsX + 2, totalRowY + 4.5);
    doc.text(money(value), totalsX + totalsWidth - 2, totalRowY + 4.5, { align: "right" });
    totalRowY += strong ? (small ? 8 : 10) : (small ? 6 : 7.5);
  };
  totalRow("Subtotal", invoice.subtotal);
  if (invoice.discountTotal) totalRow("Discount", -invoice.discountTotal);
  totalRow("Taxable value", taxableTotal);
  totalRow("GST", invoice.gstTotal);
  charges.forEach((charge) => totalRow(charge.label, charge.amount));
  if (invoice.roundOff) totalRow("Round off", invoice.roundOff);
  totalRow(quotation ? "QUOTED TOTAL" : "GRAND TOTAL", invoice.grandTotal, true);
  if (!quotation) {
    totalRow("Amount paid", invoice.amountPaid);
    totalRow("Balance due", invoice.amountDue, invoice.amountDue > 0);
  }
  if (!small) {
    const wordsY = y + 3;
    doc.setFillColor(...PALE);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(margin, wordsY, taxWidth, 16, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text("AMOUNT IN WORDS", margin + 3, wordsY + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.setFontSize(7);
    doc.text(doc.splitTextToSize(amountInWords(invoice.grandTotal), taxWidth - 6), margin + 3, wordsY + 10);
    doc.setTextColor(...MUTED);
    doc.setFontSize(6.2);
    doc.text(quotation ? "Terms: Final rates and availability are confirmed when converted to an invoice." : "Terms: Goods once sold will not be taken back without prior agreement.", margin, wordsY + 22, { maxWidth: taxWidth });
    doc.text(quotation ? "This estimate does not create a payment due." : "This is a computer-generated invoice.", margin, wordsY + 29);
  } else {
    y = Math.max(y, totalRowY) + 5;
    doc.setFillColor(...PALE);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(margin, y, contentWidth, 15, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.setTextColor(...MUTED);
    doc.text("AMOUNT IN WORDS", margin + 3, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.setFontSize(6.2);
    doc.text(doc.splitTextToSize(amountInWords(invoice.grandTotal), contentWidth - 6), margin + 3, y + 10);
    y += 18;
    if (y + 20 > height - 10) { doc.addPage(); pageNumber += 1; y = margin + 8; }
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text(quotation ? "Terms: Final rates and availability are confirmed on invoicing." : "Terms: Goods once sold will not be taken back without prior agreement.", margin, y + 3, { maxWidth: contentWidth * .62 });
    doc.text(quotation ? "Estimate only - no payment due." : "This is a computer-generated invoice.", margin, y + 8);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.text(`For ${business.name || "Burrabazar Festival Decor"}`, right, y + 3, { align: "right" });
    doc.setDrawColor(...BORDER);
    doc.line(right - 40, y + 15, right, y + 15);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text("Authorised signatory", right, y + 20, { align: "right" });
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(margin, height - 8, right, height - 8);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text(`Midori Kanjo | ${invoice.invoiceNumber}`, margin, height - 4.5);
    doc.text(`Page ${page} of ${totalPages}`, right, height - 4.5, { align: "right" });
  }
}

function drawThermalInvoice(doc: Pdf, invoice: Invoice, business: BusinessSettings) {
  const width = 80;
  const margin = 4;
  const right = width - margin;
  const taxableTotal = roundMoney(invoice.subtotal - invoice.discountTotal);
  const groups = taxGroups(invoice.lineItems);
  const charges = invoice.otherCharges || [];
  const quotation = invoice.type === "quotation";
  let y = 6;
  const divider = () => { doc.setDrawColor(90, 90, 90); doc.setLineDashPattern([1, 1], 0); doc.line(margin, y, right, y); doc.setLineDashPattern([], 0); y += 4; };
  const row = (label: string, value: string, bold = false) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 9 : 7); doc.text(label, margin, y); doc.text(value, right, y, { align: "right" }); y += bold ? 5.5 : 4.2; };

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(business.name || "Burrabazar Festival Decor", width / 2, y, { align: "center", maxWidth: width - 8 });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  const address = doc.splitTextToSize(business.address || "Burrabazar, Kolkata, West Bengal", width - 12);
  doc.text(address, width / 2, y, { align: "center" });
  y += address.length * 3.2;
  if (business.phone) { doc.text(`Phone: ${business.phone}`, width / 2, y, { align: "center" }); y += 3.2; }
  doc.text(`GSTIN: ${business.gstin || "Not provided"}`, width / 2, y, { align: "center" });
  y += 4;
  divider();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(quotation ? "QUOTATION" : invoice.gstTotal > 0 ? "TAX INVOICE" : "SALES INVOICE", width / 2, y, { align: "center" });
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(invoice.invoiceNumber, margin, y);
  doc.text(invoiceDate(invoice.date), right, y, { align: "right" });
  y += 4;
  doc.text(`Party: ${invoice.partyName}`, margin, y, { maxWidth: width - 8 });
  y += 4;
  if (invoice.partyGstin) { doc.text(`Party GSTIN: ${invoice.partyGstin}`, margin, y); y += 4; }
  doc.text(quotation ? "Estimate only - no payment due" : `Payment: ${paymentDescription(invoice)}`, margin, y);
  y += 4;
  divider();

  invoice.lineItems.forEach((line, index) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const name = doc.splitTextToSize(`${index + 1}. ${line.itemName}`, width - 8).slice(0, 2);
    doc.text(name, margin, y);
    y += name.length * 3.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(`${line.qty} ${unitShort(line.unit)} x ${money(line.rate)}`, margin, y);
    doc.setFont("helvetica", "bold");
    doc.text(money(line.amount), right, y, { align: "right" });
    y += 3.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.text(`Taxable ${money(line.taxableAmount)} | GST ${line.gstRate}%: ${money(line.gstAmount)}`, margin, y);
    y += 4.5;
    doc.setDrawColor(210, 210, 210);
    doc.line(margin, y - 1.7, right, y - 1.7);
  });

  divider();
  row("Subtotal", money(invoice.subtotal));
  if (invoice.discountTotal) row("Discount", `- ${money(invoice.discountTotal)}`);
  row("Taxable", money(taxableTotal));
  row("GST", money(invoice.gstTotal));
  charges.forEach((charge) => row(charge.label, money(charge.amount)));
  if (invoice.roundOff) row("Round off", money(invoice.roundOff));
  divider();
  row(quotation ? "QUOTED TOTAL" : "GRAND TOTAL", money(invoice.grandTotal), true);
  if (!quotation) {
    row("Paid", money(invoice.amountPaid));
    row("DUE", money(invoice.amountDue), invoice.amountDue > 0);
  }
  divider();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("GST SUMMARY", margin, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  for (const [rate, group] of groups) {
    doc.text(`${rate}% on ${money(group.taxable)}`, margin, y);
    doc.text(money(group.tax), right, y, { align: "right" });
    y += 3.8;
  }
  divider();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text(doc.splitTextToSize(amountInWords(invoice.grandTotal), width - 8), width / 2, y, { align: "center" });
  y += 9;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(quotation ? "Quotation prepared for review" : "Thank you for your business", width / 2, y, { align: "center" });
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.text(`Computer-generated ${quotation ? "quotation" : "invoice"} | Midori Kanjo`, width / 2, y, { align: "center" });
}

export async function invoicePdf(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat) {
  const thermalHeight = Math.max(185, 118 + invoice.lineItems.length * 14 + taxGroups(invoice.lineItems).length * 4 + (invoice.otherCharges?.length || 0) * 5);
  const doc = await createPdf(format, thermalHeight);
  if (format === "thermal") drawThermalInvoice(doc, invoice, business);
  else drawRegularInvoice(doc, invoice, business, format);
  return doc;
}

export async function shareInvoice(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat, preparedWindow?: Window | null, customMessage?: string) {
  const defaultMessage = invoice.type === "quotation" ? `${invoice.partyName} | Quoted ${money(invoice.grandTotal)}` : `${invoice.partyName} | ${money(invoice.grandTotal)} | Due ${money(invoice.amountDue)}`;
  const shareText = customMessage?.trim() || defaultMessage;
  if (isNativeApp()) {
    preparedWindow?.close();
    const doc = await invoicePdf(invoice, business, format);
    await shareNativeBlob(doc.output("blob"), {
      fileName: `${invoice.invoiceNumber}.pdf`,
      title: invoice.type === "quotation" ? `Quotation ${invoice.invoiceNumber}` : `Invoice ${invoice.invoiceNumber}`,
      text: shareText,
      dialogTitle: "Share invoice PDF",
    });
    return true;
  }
  const supportsFileShare = "share" in navigator && "canShare" in navigator;
  const whatsappWindow = supportsFileShare ? preparedWindow || null : preparedWindow || window.open("", "_blank");
  const doc = await invoicePdf(invoice, business, format);
  const blob = doc.output("blob");
  const file = new File([blob], `${invoice.invoiceNumber}.pdf`, { type: "application/pdf" });
  if (supportsFileShare && navigator.canShare({ files: [file] })) {
    if (whatsappWindow) whatsappWindow.close();
    await navigator.share({ title: invoice.invoiceNumber, text: shareText, files: [file] });
    return true;
  }
  doc.save(`${invoice.invoiceNumber}.pdf`);
  const chargesText = invoice.otherChargesTotal ? `\nOther charges: ${money(invoice.otherChargesTotal)}` : "";
  const whatsappText = customMessage?.trim() || (invoice.type === "quotation"
    ? `Quotation ${invoice.invoiceNumber}\n${invoice.partyName}\nQuoted total: ${money(invoice.grandTotal)}\nGST: ${money(invoice.gstTotal)}${chargesText}\nEstimate only - no payment is due until invoiced.\nPDF has been downloaded.`
    : `Invoice ${invoice.invoiceNumber}\n${invoice.partyName}\nTotal: ${money(invoice.grandTotal)}\nGST: ${money(invoice.gstTotal)}${chargesText}\nDue: ${money(invoice.amountDue)}\nPDF has been downloaded.`);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;
  if (whatsappWindow) { whatsappWindow.opener = null; whatsappWindow.location.href = whatsappUrl; }
  else window.location.href = whatsappUrl;
  return false;
}

export async function printInvoice(invoice: Invoice, business: BusinessSettings, format: InvoiceFormat, preparedWindow?: Window | null) {
  const doc = await invoicePdf(invoice, business, format);
  if (isNativeApp()) {
    preparedWindow?.close();
    await shareNativeBlob(doc.output("blob"), {
      fileName: `${invoice.invoiceNumber}.pdf`,
      title: `Print ${invoice.invoiceNumber}`,
      text: "Choose your Android print service or PDF viewer.",
      dialogTitle: "Print or open invoice",
    });
    return;
  }
  const printWindow = preparedWindow || window.open("", "_blank");
  doc.autoPrint();
  const url = doc.output("bloburl");
  if (printWindow) { printWindow.opener = null; printWindow.location.href = String(url); }
  else doc.save(`${invoice.invoiceNumber}.pdf`);
}
