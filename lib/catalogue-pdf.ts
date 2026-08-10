import type { Item, Language, Unit } from "./db";
import type { BusinessSettings } from "./pdf";
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
  registerPdfFont,
  setPdfFont,
} from "./pdf-i18n";

export type CatalogueTier = "retail" | "wholesale" | "bulk";

const GREEN: [number, number, number] = [1, 73, 33];
const ACCENT: [number, number, number] = [48, 157, 75];
const CANVAS: [number, number, number] = [249, 249, 249];
const BORDER: [number, number, number] = [222, 222, 215];
const INK: [number, number, number] = [33, 31, 29];
const MUTED: [number, number, number] = [97, 95, 92];

export function cataloguePrice(item: Item, tier: CatalogueTier) {
  if (tier === "retail") return item.priceRetail;
  if (tier === "bulk") return item.priceBulk;
  return item.priceWholesale;
}

type CatalogueCopy = {
  phone: string;
  tiers: Record<CatalogueTier, string>;
  title: string;
  continued: string;
  prices: (tier: string) => string;
  product: string;
  unit: string;
  price: string;
  noSku: string;
  selectedItems: (count: number) => string;
  pricesMayChange: string;
  page: (page: number, pages: number) => string;
  selectError: string;
  subject: string;
  shareTitle: (tier: string) => string;
  shareText: (business: string, count: number) => string;
  dialogShare: string;
  dialogSave: string;
  downloaded: string;
  units: Record<Unit, string>;
};

const catalogueCopy: Record<Language, CatalogueCopy> = {
  en: {
    phone: "Phone", tiers: { retail: "Retail", wholesale: "Wholesale", bulk: "Bulk" },
    title: "PRODUCT PRICE CATALOGUE", continued: "PRICE CATALOGUE - CONTINUED",
    prices: (tier) => `${tier} prices`, product: "PRODUCT", unit: "UNIT", price: "PRICE",
    noSku: "No SKU", selectedItems: (count) => `${count} selected items`,
    pricesMayChange: "Prices may change without notice",
    page: (page, pages) => `Page ${page} of ${pages}`,
    selectError: "Select at least one item for the catalogue.",
    subject: "Shareable product price list", shareTitle: (tier) => `${tier} product price list`,
    shareText: (business, count) => `${business} - ${count} products`,
    dialogShare: "Share price catalogue", dialogSave: "Save or share catalogue",
    downloaded: "The PDF has been downloaded and is ready to attach.",
    units: { piece: "Piece", dozen: "Dozen", gross: "Gross", bundle: "Bundle", box: "Box", packet: "Packet" },
  },
  hi: {
    phone: "फ़ोन", tiers: { retail: "खुदरा", wholesale: "थोक", bulk: "बल्क" },
    title: "प्रोडक्ट की कीमतों का कैटलॉग", continued: "कीमत कैटलॉग - जारी",
    prices: (tier) => `${tier} कीमतें`, product: "प्रोडक्ट", unit: "इकाई", price: "कीमत",
    noSku: "SKU नहीं है", selectedItems: (count) => `चुने गए ${count} आइटम`,
    pricesMayChange: "कीमतें बिना सूचना के बदल सकती हैं",
    page: (page, pages) => `पेज ${page} / ${pages}`,
    selectError: "कैटलॉग के लिए कम से कम एक आइटम चुनें।",
    subject: "शेयर करने लायक प्रोडक्ट कीमत सूची", shareTitle: (tier) => `${tier} प्रोडक्ट कीमत सूची`,
    shareText: (business, count) => `${business} - ${count} प्रोडक्ट`,
    dialogShare: "कीमत कैटलॉग शेयर करें", dialogSave: "कैटलॉग सेव या शेयर करें",
    downloaded: "PDF डाउनलोड हो गई है और अटैच करने के लिए तैयार है।",
    units: { piece: "पीस", dozen: "दर्जन", gross: "ग्रॉस", bundle: "बंडल", box: "बॉक्स", packet: "पैकेट" },
  },
  bn: {
    phone: "ফোন", tiers: { retail: "খুচরা", wholesale: "পাইকারি", bulk: "বাল্ক" },
    title: "পণ্যের দামের ক্যাটালগ", continued: "দামের ক্যাটালগ - পরের অংশ",
    prices: (tier) => `${tier} দাম`, product: "পণ্য", unit: "একক", price: "দাম",
    noSku: "SKU নেই", selectedItems: (count) => `বাছা ${count}টি পণ্য`,
    pricesMayChange: "কোনো নোটিস ছাড়াই দাম বদলাতে পারে",
    page: (page, pages) => `পৃষ্ঠা ${page} / ${pages}`,
    selectError: "ক্যাটালগের জন্য অন্তত একটি পণ্য বাছুন।",
    subject: "শেয়ার করার উপযোগী পণ্যের দাম তালিকা", shareTitle: (tier) => `${tier} পণ্যের দাম তালিকা`,
    shareText: (business, count) => `${business} - ${count}টি পণ্য`,
    dialogShare: "দামের ক্যাটালগ শেয়ার করুন", dialogSave: "ক্যাটালগ সেভ বা শেয়ার করুন",
    downloaded: "PDF ডাউনলোড হয়েছে এবং অ্যাটাচ করার জন্য তৈরি।",
    units: { piece: "পিস", dozen: "ডজন", gross: "গ্রস", bundle: "বান্ডিল", box: "বক্স", packet: "প্যাকেট" },
  },
};

const itemName = (item: Item, language: Language) =>
  (language === "hi" ? item.nameHi : language === "bn" ? item.nameBn : item.name).trim() || item.name;

export async function cataloguePdf(
  items: Item[],
  tier: CatalogueTier,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = catalogueCopy[active];
  const tierLabel = copy.tiers[tier];
  if (!items.length) throw new Error(copy.selectError);
  const { jsPDF } = await import("jspdf");
  const doc = await registerPdfFont(new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true }));
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  let y = margin;

  doc.setProperties({ title: `${tierLabel} ${copy.title} - ${business.name || "Midori Kanjo"}`, subject: copy.subject, author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });

  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...GREEN);
    doc.roundedRect(margin, y, contentWidth, 31, 2.5, 2.5, "F");
    doc.setFillColor(...ACCENT);
    doc.rect(margin, y + 27, contentWidth, 4, "F");
    doc.setTextColor(255, 255, 255);
    setPdfFont(doc, "bold");
    doc.setFontSize(18);
    doc.text(business.name || "Midori Kanjo", margin + 6, y + 9, { maxWidth: contentWidth * 0.54 });
    setPdfFont(doc);
    doc.setFontSize(7);
    doc.text(business.address || "Burrabazar, Kolkata", margin + 6, y + 15, { maxWidth: 102 });
    const contact = [business.phone ? `${copy.phone} ${business.phone}` : "", business.gstin ? `GSTIN ${business.gstin}` : ""].filter(Boolean).join("  |  ");
    if (contact) doc.text(contact, margin + 6, y + 21, { maxWidth: 105 });
    setPdfFont(doc, "bold");
    doc.setFontSize(active === "en" ? 11 : 9.4);
    doc.text(continued ? copy.continued : copy.title, right - 6, y + 9, { align: "right", maxWidth: contentWidth * 0.42 });
    doc.setFontSize(7.5);
    doc.text(copy.prices(tierLabel), right - 6, y + 15, { align: "right" });
    setPdfFont(doc);
    doc.text(pdfDate(new Date(), active), right - 6, y + 21, { align: "right" });
    y += 38;
  };

  const tableHeader = () => {
    doc.setFillColor(...CANVAS);
    doc.setDrawColor(...BORDER);
    doc.rect(margin, y, contentWidth, 8, "FD");
    setPdfFont(doc, "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GREEN);
    doc.text(copy.product, margin + 20, y + 5.2);
    doc.text("SKU", margin + 108, y + 5.2);
    doc.text(copy.unit, margin + 145, y + 5.2);
    doc.text(copy.price, right - 3, y + 5.2, { align: "right" });
    y += 8;
  };

  header();
  tableHeader();
  const sorted = [...items].sort((a, b) => itemName(a, active).localeCompare(itemName(b, active), active === "hi" ? "hi" : active === "bn" ? "bn" : "en"));
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    const displayName = itemName(item, active);
    const rowHeight = 18;
    if (y + rowHeight > height - 16) {
      doc.addPage();
      header(true);
      tableHeader();
    }
    if (index % 2) {
      doc.setFillColor(...CANVAS);
      doc.rect(margin, y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...BORDER);
    doc.line(margin, y + rowHeight, right, y + rowHeight);
    doc.setFillColor(...CANVAS);
    doc.roundedRect(margin + 2, y + 2, 14, 14, 1.5, 1.5, "F");
    let imageAdded = false;
    if (item.imageUrl?.startsWith("data:image/")) {
      try {
        const format = item.imageUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(item.imageUrl, format, margin + 2, y + 2, 14, 14, undefined, "FAST");
        imageAdded = true;
      } catch {
        imageAdded = false;
      }
    }
    if (!imageAdded) {
      doc.setTextColor(...GREEN);
      setPdfFont(doc, "bold");
      doc.setFontSize(8);
      doc.text(displayName.trim().slice(0, 2).toUpperCase() || "--", margin + 9, y + 10.5, { align: "center" });
    }
    doc.setTextColor(...INK);
    setPdfFont(doc, "bold");
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(displayName, 83).slice(0, 2), margin + 20, y + 6);
    doc.setTextColor(...MUTED);
    setPdfFont(doc);
    doc.setFontSize(6.5);
    doc.text(item.skuCode || copy.noSku, margin + 108, y + 9, { maxWidth: 34 });
    doc.text(copy.units[item.baseUnit], margin + 145, y + 9, { maxWidth: 20 });
    doc.setTextColor(...GREEN);
    setPdfFont(doc, "bold");
    doc.setFontSize(9);
    doc.text(pdfMoney(cataloguePrice(item, tier), active, 0), right - 3, y + 9, { align: "right" });
    y += rowHeight;
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(margin, height - 9, right, height - 9);
    doc.setTextColor(...MUTED);
    setPdfFont(doc);
    doc.setFontSize(6);
    doc.text(`${copy.selectedItems(sorted.length)} | ${copy.pricesMayChange} | Midori Kanjo`, margin, height - 5, { maxWidth: contentWidth * 0.76 });
    doc.text(copy.page(page, totalPages), right, height - 5, { align: "right" });
  }
  return doc;
}

export async function shareCatalogue(
  items: Item[],
  tier: CatalogueTier,
  business: BusinessSettings,
  preparedWindow?: Window | null,
  language: Language = "en",
  customMessage?: string,
) {
  const active = normalizePdfLanguage(language);
  const copy = catalogueCopy[active];
  const tierLabel = copy.tiers[tier];
  const doc = await cataloguePdf(items, tier, business, active);
  const name = `Midori-Kanjo-${tier}-price-list-${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = doc.output("blob");
  const title = copy.shareTitle(tierLabel);
  const text = customMessage?.trim() || copy.shareText(business.name || "Midori Kanjo", items.length);
  if (isTauriApp()) {
    preparedWindow?.close();
    const savedPath = await saveDesktopBlob(blob, {
      fileName: name,
      title,
      dialogTitle: copy.dialogShare,
    });
    if (!savedPath) return false;
    await openExternalUrl(
      `https://wa.me/?text=${encodeURIComponent(`${text}\n${copy.downloaded}`)}`,
    );
    return true;
  }
  if (isNativeApp()) {
    preparedWindow?.close();
    await shareNativeBlob(blob, { fileName: name, title, text, dialogTitle: copy.dialogShare });
    return true;
  }
  const file = new File([blob], name, { type: "application/pdf" });
  if ("share" in navigator && "canShare" in navigator && navigator.canShare({ files: [file] })) {
    preparedWindow?.close();
    await navigator.share({ title, text, files: [file] });
    return true;
  }
  doc.save(name);
  const message = customMessage?.trim()
    || `${business.name || "Midori Kanjo"}\n${copy.prices(tierLabel)}\n${copy.selectedItems(items.length)}\n${copy.downloaded}`;
  const target = preparedWindow || window.open("", "_blank");
  if (target) {
    target.opener = null;
    target.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  } else {
    window.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  }
  return false;
}

export async function downloadCataloguePdf(
  items: Item[],
  tier: CatalogueTier,
  business: BusinessSettings,
  language: Language = "en",
) {
  const active = normalizePdfLanguage(language);
  const copy = catalogueCopy[active];
  const doc = await cataloguePdf(items, tier, business, active);
  const name = `Midori-Kanjo-${tier}-price-list-${new Date().toISOString().slice(0, 10)}.pdf`;
  if (await shareNativeBlob(doc.output("blob"), { fileName: name, title: copy.shareTitle(copy.tiers[tier]), dialogTitle: copy.dialogSave })) return;
  doc.save(name);
}
