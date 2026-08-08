import type { Party, Payment } from "./db";
import type { BusinessSettings, InvoiceFormat } from "./pdf";
import { shareNativeBlob } from "./native-files";

const money = (value: number) => `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;
const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const paymentReceiptNumber = (payment: Payment) => `RCP-${payment.id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}`;

export async function paymentReceiptPdf(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5") {
  const { jsPDF } = await import("jspdf");
  const page = format === "thermal" ? [80, 120] as [number, number] : format;
  const doc = new jsPDF({ unit: "mm", format: page, orientation: "portrait", compress: true });
  const width = doc.internal.pageSize.getWidth();
  const margin = format === "thermal" ? 6 : 10;
  const content = width - margin * 2;
  const isSupplierPayment = party.type === "supplier";
  doc.setProperties({ title: `${paymentReceiptNumber(payment)} - ${party.name}`, subject: isSupplierPayment ? "Supplier payment advice" : "Customer payment receipt", author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });
  doc.setFillColor(1, 73, 33);
  doc.roundedRect(margin, margin, content, format === "thermal" ? 24 : 30, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(format === "thermal" ? 12 : 17);
  doc.text(business.name || "Burrabazar Festival Decor", margin + 4, margin + 8, { maxWidth: content - 8 });
  doc.setFontSize(format === "thermal" ? 7 : 9);
  doc.text(isSupplierPayment ? "SUPPLIER PAYMENT ADVICE" : "PAYMENT RECEIPT", margin + 4, margin + (format === "thermal" ? 15 : 17));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(format === "thermal" ? 5.5 : 7);
  doc.text(paymentReceiptNumber(payment), margin + 4, margin + (format === "thermal" ? 20 : 24));
  let y = margin + (format === "thermal" ? 32 : 41);
  doc.setTextColor(33, 31, 29);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(format === "thermal" ? 10 : 15);
  doc.text(party.name, margin, y, { maxWidth: content });
  y += format === "thermal" ? 6 : 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(format === "thermal" ? 6 : 8);
  doc.text(`${party.codeName}${party.phone ? ` | ${party.phone}` : ""}`, margin, y, { maxWidth: content });
  y += 10;
  const rows = [
    ["Date", dateLabel(payment.date)],
    ["Mode", payment.mode.toUpperCase()],
    ["Reference", payment.reference || "-"],
    ["Allocated bills", payment.allocatedTo.length ? payment.allocatedTo.length.toString() : "Account payment"],
  ];
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, width - margin, y, { align: "right", maxWidth: content * 0.62 });
    y += format === "thermal" ? 6 : 8;
  }
  y += 2;
  doc.setFillColor(244, 250, 240);
  doc.setDrawColor(226, 226, 219);
  doc.roundedRect(margin, y, content, format === "thermal" ? 24 : 31, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(1, 73, 33);
  doc.setFontSize(format === "thermal" ? 11 : 17);
  doc.text(money(payment.amount), margin + 4, y + (format === "thermal" ? 9 : 12));
  doc.setTextColor(97, 95, 92);
  doc.setFontSize(format === "thermal" ? 6 : 8);
  doc.text(isSupplierPayment ? "PAYMENT MADE" : "PAYMENT RECEIVED", margin + 4, y + (format === "thermal" ? 16 : 21));
  doc.text(`Remaining balance: ${money(remaining)}`, margin + 4, y + (format === "thermal" ? 21 : 27), { maxWidth: content - 8 });
  return doc;
}

export async function downloadPaymentReceipt(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5") {
  const doc = await paymentReceiptPdf(payment, party, remaining, business, format);
  doc.save(`${paymentReceiptNumber(payment)}-${party.codeName}.pdf`);
}

export async function sharePaymentReceipt(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5", message?: string) {
  const doc = await paymentReceiptPdf(payment, party, remaining, business, format);
  const blob = doc.output("blob");
  const fileName = `${paymentReceiptNumber(payment)}-${party.codeName}.pdf`;
  if (await shareNativeBlob(blob, { fileName, title: "Payment receipt", text: message })) return;
  if (navigator.share && navigator.canShare?.({ files: [new File([blob], fileName, { type: "application/pdf" })] })) {
    await navigator.share({ files: [new File([blob], fileName, { type: "application/pdf" })], title: "Payment receipt", text: message });
    return;
  }
  doc.save(fileName);
  if (party.phone) window.open(`https://wa.me/${party.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message || `Payment receipt ${paymentReceiptNumber(payment)}`)}`, "_blank", "noopener,noreferrer");
}
