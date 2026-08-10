import type { Language, Party, Payment } from "./db";
import type { BusinessSettings, InvoiceFormat } from "./pdf";
import {
  isNativeApp,
  isTauriApp,
  openExternalUrl,
  saveDesktopBlob,
  shareNativeBlob,
} from "./native-files";
import {
  normalizePdfLanguage,
  pdfDate,
  pdfMoney,
  pdfPaymentMode,
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";

export const paymentReceiptNumber = (payment: Payment) => `RCP-${payment.id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()}`;

/**
 * Probe file-share support synchronously, while the caller still has the user
 * gesture. Browsers that can use Web Share must not consume that gesture by
 * opening a placeholder tab first.
 */
export function canSharePaymentReceiptFile() {
  if (
    typeof navigator === "undefined"
    || typeof File !== "function"
    || typeof navigator.share !== "function"
    || typeof navigator.canShare !== "function"
  ) return false;
  try {
    return navigator.canShare({
      files: [new File([], "payment-receipt.pdf", { type: "application/pdf" })],
    });
  } catch {
    return false;
  }
}

type ReceiptCopy = {
  supplierAdvice: string; paymentReceipt: string; date: string; mode: string;
  reference: string; allocatedBills: string; accountPayment: string;
  paymentMade: string; paymentReceived: string; remainingBalance: string;
  shareTitle: string; fallbackMessage: (receipt: string) => string;
};

const receiptCopy: Record<Language, ReceiptCopy> = {
  en: {
    supplierAdvice: "SUPPLIER PAYMENT ADVICE", paymentReceipt: "PAYMENT RECEIPT",
    date: "Date", mode: "Mode", reference: "Reference", allocatedBills: "Allocated bills",
    accountPayment: "Account payment", paymentMade: "PAYMENT MADE", paymentReceived: "PAYMENT RECEIVED",
    remainingBalance: "Remaining balance", shareTitle: "Payment receipt",
    fallbackMessage: (receipt) => `Payment receipt ${receipt}`,
  },
  hi: {
    supplierAdvice: "सप्लायर भुगतान पर्ची", paymentReceipt: "भुगतान रसीद",
    date: "तारीख", mode: "तरीका", reference: "रेफरेंस", allocatedBills: "जिन बिलों में लगा",
    accountPayment: "खाते का भुगतान", paymentMade: "भुगतान किया", paymentReceived: "भुगतान मिला",
    remainingBalance: "बाकी बैलेंस", shareTitle: "भुगतान रसीद",
    fallbackMessage: (receipt) => `भुगतान रसीद ${receipt}`,
  },
  bn: {
    supplierAdvice: "সাপ্লায়ারের পেমেন্ট স্লিপ", paymentReceipt: "পেমেন্ট রসিদ",
    date: "তারিখ", mode: "পদ্ধতি", reference: "রেফারেন্স", allocatedBills: "যে বিলগুলিতে ধরা হয়েছে",
    accountPayment: "খাতার পেমেন্ট", paymentMade: "পেমেন্ট দেওয়া হয়েছে", paymentReceived: "পেমেন্ট পাওয়া হয়েছে",
    remainingBalance: "বাকি ব্যালেন্স", shareTitle: "পেমেন্ট রসিদ",
    fallbackMessage: (receipt) => `পেমেন্ট রসিদ ${receipt}`,
  },
};

export async function paymentReceiptPdf(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5", language: Language = "en") {
  const activeLanguage = normalizePdfLanguage(language);
  const copy = receiptCopy[activeLanguage];
  const money = (value: number) => pdfMoney(value, activeLanguage);
  const { jsPDF } = await import("jspdf");
  const page = format === "thermal" ? [80, 120] as [number, number] : format;
  const doc = await registerPdfFont(new jsPDF({ unit: "mm", format: page, orientation: "portrait", compress: true, putOnlyUsedFonts: true }));
  const width = doc.internal.pageSize.getWidth();
  const margin = format === "thermal" ? 6 : 10;
  const content = width - margin * 2;
  const isSupplierPayment = party.type === "supplier";
  doc.setProperties({ title: `${paymentReceiptNumber(payment)} - ${party.name}`, subject: isSupplierPayment ? copy.supplierAdvice : copy.paymentReceipt, author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });
  doc.setFillColor(1, 73, 33);
  doc.roundedRect(margin, margin, content, format === "thermal" ? 24 : 30, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  setPdfFont(doc, "bold");
  doc.setFontSize(format === "thermal" ? 12 : 17);
  doc.text(business.name || "Burrabazar Festival Decor", margin + 4, margin + 8, { maxWidth: content - 8 });
  doc.setFontSize(format === "thermal" ? 7 : 9);
  doc.text(isSupplierPayment ? copy.supplierAdvice : copy.paymentReceipt, margin + 4, margin + (format === "thermal" ? 15 : 17));
  setPdfFont(doc);
  doc.setFontSize(format === "thermal" ? 5.5 : 7);
  doc.text(paymentReceiptNumber(payment), margin + 4, margin + (format === "thermal" ? 20 : 24));
  let y = margin + (format === "thermal" ? 32 : 41);
  doc.setTextColor(33, 31, 29);
  setPdfFont(doc, "bold");
  doc.setFontSize(format === "thermal" ? 10 : 15);
  doc.text(party.name, margin, y, { maxWidth: content });
  y += format === "thermal" ? 6 : 8;
  setPdfFont(doc);
  doc.setFontSize(format === "thermal" ? 6 : 8);
  const partyMeta = [party.codeName, party.phone].filter(Boolean).join(" | ");
  if (partyMeta) {
    doc.text(partyMeta, margin, y, { maxWidth: content });
    y += 10;
  } else {
    y += 4;
  }
  const rows = [
    [copy.date, pdfDate(payment.date, activeLanguage)],
    [copy.mode, pdfPaymentMode(payment.mode, activeLanguage)],
    [copy.reference, payment.reference || "-"],
    [copy.allocatedBills, payment.allocatedTo.length ? payment.allocatedTo.length.toString() : copy.accountPayment],
  ];
  for (const [label, value] of rows) {
    setPdfFont(doc, "bold");
    doc.text(label, margin, y);
    setPdfFont(doc);
    doc.text(value, width - margin, y, { align: "right", maxWidth: content * 0.62 });
    y += format === "thermal" ? 6 : 8;
  }
  y += 2;
  doc.setFillColor(244, 250, 240);
  doc.setDrawColor(226, 226, 219);
  doc.roundedRect(margin, y, content, format === "thermal" ? 24 : 31, 2, 2, "FD");
  setPdfFont(doc, "bold");
  doc.setTextColor(1, 73, 33);
  doc.setFontSize(format === "thermal" ? 11 : 17);
  doc.text(money(payment.amount), margin + 4, y + (format === "thermal" ? 9 : 12));
  doc.setTextColor(97, 95, 92);
  doc.setFontSize(format === "thermal" ? 6 : 8);
  doc.text(isSupplierPayment ? copy.paymentMade : copy.paymentReceived, margin + 4, y + (format === "thermal" ? 16 : 21));
  doc.text(`${copy.remainingBalance}: ${money(remaining)}`, margin + 4, y + (format === "thermal" ? 21 : 27), { maxWidth: content - 8 });
  return doc;
}

export async function downloadPaymentReceipt(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5", language: Language = "en") {
  const doc = await paymentReceiptPdf(payment, party, remaining, business, format, language);
  const partyPart = (party.codeName || party.name).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "customer";
  const fileName = `${paymentReceiptNumber(payment)}-${partyPart}.pdf`;
  if (isTauriApp()) {
    await saveDesktopBlob(doc.output("blob"), {
      fileName,
      title: receiptCopy[normalizePdfLanguage(language)].shareTitle,
    });
    return;
  }
  doc.save(fileName);
}

export async function sharePaymentReceipt(payment: Payment, party: Party, remaining: number, business: BusinessSettings, format: InvoiceFormat = "a5", message?: string, language: Language = "en", preparedWindow?: Window | null) {
  const activeLanguage = normalizePdfLanguage(language);
  const copy = receiptCopy[activeLanguage];
  const shareMessage = message?.trim() || copy.fallbackMessage(paymentReceiptNumber(payment));
  const native = isNativeApp();
  const useWebShare = !native && canSharePaymentReceiptFile();
  // Only the WhatsApp fallback reserves a tab. Opening one on Web Share-capable
  // browsers can consume the transient activation that navigator.share needs.
  const shareWindow = native || useWebShare
    ? null
    : preparedWindow || window.open("", "_blank");
  try {
    const doc = await paymentReceiptPdf(payment, party, remaining, business, format, activeLanguage);
    const blob = doc.output("blob");
    const partyPart = (party.codeName || party.name).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "customer";
    const fileName = `${paymentReceiptNumber(payment)}-${partyPart}.pdf`;
    if (isTauriApp()) {
      preparedWindow?.close();
      const savedPath = await saveDesktopBlob(blob, {
        fileName,
        title: copy.shareTitle,
      });
      if (savedPath && party.phone)
        await openExternalUrl(
          `https://wa.me/${party.phone.replace(/\D/g, "")}?text=${encodeURIComponent(shareMessage)}`,
        );
      return;
    }
    if (native) {
      preparedWindow?.close();
      await shareNativeBlob(blob, { fileName, title: copy.shareTitle, text: shareMessage });
      return;
    }
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (useWebShare) {
      await navigator.share({ files: [file], title: copy.shareTitle, text: shareMessage });
      return;
    }
    doc.save(fileName);
    if (!party.phone) {
      shareWindow?.close();
      return;
    }
    const whatsappUrl = `https://wa.me/${party.phone.replace(/\D/g, "")}?text=${encodeURIComponent(shareMessage)}`;
    if (shareWindow) {
      shareWindow.opener = null;
      shareWindow.location.href = whatsappUrl;
    } else {
      window.location.href = whatsappUrl;
    }
  } catch (error) {
    shareWindow?.close();
    throw error;
  }
}
