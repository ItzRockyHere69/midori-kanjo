import type { Item } from "./db";
import type { BusinessSettings } from "./pdf";
import { isNativeApp, shareNativeBlob } from "./native-files";

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

const money = (value: number) => `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value || 0)}`;
const titleTier = (tier: CatalogueTier) => `${tier[0].toUpperCase()}${tier.slice(1)}`;

export async function cataloguePdf(items: Item[], tier: CatalogueTier, business: BusinessSettings) {
  if (!items.length) throw new Error("Select at least one item for the catalogue.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  let y = margin;

  doc.setProperties({ title: `${titleTier(tier)} price catalogue - ${business.name || "Midori Kanjo"}`, subject: "Shareable product price list", author: business.name || "Midori Kanjo", creator: "Midori Kanjo" });

  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...GREEN);
    doc.roundedRect(margin, y, contentWidth, 31, 2.5, 2.5, "F");
    doc.setFillColor(...ACCENT);
    doc.rect(margin, y + 27, contentWidth, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(business.name || "Midori Kanjo", margin + 6, y + 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(business.address || "Burrabazar, Kolkata", margin + 6, y + 15, { maxWidth: 102 });
    const contact = [business.phone ? `Phone ${business.phone}` : "", business.gstin ? `GSTIN ${business.gstin}` : ""].filter(Boolean).join("  |  ");
    if (contact) doc.text(contact, margin + 6, y + 21, { maxWidth: 105 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(continued ? "PRICE CATALOGUE - CONTINUED" : "PRODUCT PRICE CATALOGUE", right - 6, y + 9, { align: "right" });
    doc.setFontSize(7.5);
    doc.text(`${titleTier(tier)} prices`, right - 6, y + 15, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), right - 6, y + 21, { align: "right" });
    y += 38;
  };

  const tableHeader = () => {
    doc.setFillColor(...CANVAS);
    doc.setDrawColor(...BORDER);
    doc.rect(margin, y, contentWidth, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GREEN);
    doc.text("PRODUCT", margin + 20, y + 5.2);
    doc.text("SKU", margin + 108, y + 5.2);
    doc.text("UNIT", margin + 145, y + 5.2);
    doc.text("PRICE", right - 3, y + 5.2, { align: "right" });
    y += 8;
  };

  header();
  tableHeader();
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    const rowHeight = 18;
    if (y + rowHeight > height - 16) {
      doc.addPage();
      header(true);
      tableHeader();
    }
    if (index % 2) { doc.setFillColor(...CANVAS); doc.rect(margin, y, contentWidth, rowHeight, "F"); }
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
      } catch { imageAdded = false; }
    }
    if (!imageAdded) {
      doc.setTextColor(...GREEN);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(item.name.trim().slice(0, 2).toUpperCase() || "--", margin + 9, y + 10.5, { align: "center" });
    }
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(item.name, 83).slice(0, 2), margin + 20, y + 6);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(item.skuCode || "No SKU", margin + 108, y + 9, { maxWidth: 34 });
    doc.text(item.baseUnit, margin + 145, y + 9, { maxWidth: 20 });
    doc.setTextColor(...GREEN);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(money(cataloguePrice(item, tier)), right - 3, y + 9, { align: "right" });
    y += rowHeight;
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(margin, height - 9, right, height - 9);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text(`${sorted.length} selected items | Prices may change without notice | Midori Kanjo`, margin, height - 5);
    doc.text(`Page ${page} of ${totalPages}`, right, height - 5, { align: "right" });
  }
  return doc;
}

export async function shareCatalogue(items: Item[], tier: CatalogueTier, business: BusinessSettings, preparedWindow?: Window | null) {
  const doc = await cataloguePdf(items, tier, business);
  const name = `Midori-Kanjo-${tier}-price-list-${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = doc.output("blob");
  if (isNativeApp()) {
    preparedWindow?.close();
    await shareNativeBlob(blob, {
      fileName: name,
      title: `${titleTier(tier)} product price list`,
      text: `${business.name || "Midori Kanjo"} - ${items.length} products`,
      dialogTitle: "Share price catalogue",
    });
    return true;
  }
  const file = new File([blob], name, { type: "application/pdf" });
  if ("share" in navigator && "canShare" in navigator && navigator.canShare({ files: [file] })) {
    preparedWindow?.close();
    await navigator.share({ title: `${titleTier(tier)} product price list`, text: `${business.name || "Midori Kanjo"} - ${items.length} products`, files: [file] });
    return true;
  }
  doc.save(name);
  const message = `${business.name || "Midori Kanjo"}\n${titleTier(tier)} price list\n${items.length} selected products\nThe PDF has been downloaded and is ready to attach.`;
  const target = preparedWindow || window.open("", "_blank");
  if (target) { target.opener = null; target.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`; }
  else window.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  return false;
}

export async function downloadCataloguePdf(items: Item[], tier: CatalogueTier, business: BusinessSettings) {
  const doc = await cataloguePdf(items, tier, business);
  const name = `Midori-Kanjo-${tier}-price-list-${new Date().toISOString().slice(0, 10)}.pdf`;
  if (await shareNativeBlob(doc.output("blob"), { fileName:name, title:`${titleTier(tier)} price catalogue`, dialogTitle:"Save or share catalogue" })) return;
  doc.save(name);
}
