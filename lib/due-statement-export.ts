import type { PartyDueStatement } from "./billing";
import type { BusinessSettings } from "./pdf";
import { shareNativeBlob } from "./native-files";

const money = (value: number) =>
  `Rs. ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)}`;

const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const safePart = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "customer";

export const partyStatementLabel = (
  party: Pick<PartyDueStatement["party"], "name" | "codeName">,
) => `${party.name} (${party.codeName})`;

const paymentMode = (mode?: string) =>
  mode ? mode.toUpperCase() : "";

const rowDetails = (row: PartyDueStatement["rows"][number]) =>
  [row.activity, row.reference, paymentMode(row.paymentMode)]
    .filter(Boolean)
    .join(" | ");

export function dueStatementText(
  statement: PartyDueStatement,
  business: BusinessSettings,
) {
  const { party } = statement;
  const accountLabel = partyStatementLabel(party);
  const last = statement.lastPayment;
  return [
    business.name || "Burrabazar Festival Decor",
    business.address || "Burrabazar, Kolkata, West Bengal",
    [business.phone ? `Phone: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""]
      .filter(Boolean)
      .join(" | "),
    "MIDORI KANJO - CUSTOMER DUE STATEMENT",
    `Generated\t${new Date().toLocaleString("en-IN")}`,
    "",
    `Customer / Party\t${accountLabel}`,
    `Customer code\t${party.codeName}`,
    `Phone\t${party.phone || "-"}`,
    `Address\t${party.address || "-"}`,
    "",
    "ACCOUNT SUMMARY",
    `Total due added\t${money(statement.totalDueAdded)}`,
    `Total paid\t${money(statement.totalPaid)}`,
    `AMOUNT TO PAY NEXT / TOTAL REMAINING\t${money(statement.remainingDue)}`,
    last
      ? `Last payment\t${money(last.amount)} on ${dateLabel(last.date)} via ${paymentMode(last.mode)}${last.reference ? ` | ${last.reference}` : ""}`
      : "Last payment\tNo payment recorded",
    "",
    `DETAILED DUE ACTIVITY - ${accountLabel}`,
    "Date\tActivity\tReference / mode\tDue added (+)\tPayment received (-)\tRunning balance",
    ...statement.rows.map((row) =>
      [
        dateLabel(row.date),
        row.activity,
        [row.reference, paymentMode(row.paymentMode)].filter(Boolean).join(" | "),
        row.dueAdded ? money(row.dueAdded) : "-",
        row.paymentReceived ? money(row.paymentReceived) : "-",
        money(row.runningBalance),
      ].join("\t"),
    ),
    "",
    `TOTAL\t\t\t${money(statement.totalDueAdded)}\t${money(statement.totalPaid)}\t${money(statement.remainingDue)}`,
    "",
    "This statement is generated from saved bills, manual dues and recorded payments.",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\r\n");
}

export async function createDueStatementPdf(
  statement: PartyDueStatement,
  business: BusinessSettings,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
    compress: true,
  });
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
    title: `Due statement - ${accountLabel}`,
    subject: `Customer due and payment activity for ${accountLabel}`,
    author: business.name || "Midori Kanjo",
    creator: "Midori Kanjo",
  });

  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...forest);
    doc.roundedRect(margin, y, contentWidth, 31, 2.5, 2.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(business.name || "Burrabazar Festival Decor", margin + 5, y + 9, {
      maxWidth: contentWidth * 0.56,
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      (business.address || "Burrabazar, Kolkata, West Bengal").slice(0, 110),
      margin + 5,
      y + 16,
      { maxWidth: contentWidth * 0.56 },
    );
    doc.text(
      [business.phone ? `Phone: ${business.phone}` : "", business.gstin ? `GSTIN: ${business.gstin}` : ""]
        .filter(Boolean)
        .join("  |  "),
      margin + 5,
      y + 24,
      { maxWidth: contentWidth * 0.56 },
    );
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(continued ? "DUE STATEMENT - CONTINUED" : "CUSTOMER DUE STATEMENT", right - 5, y + 10, {
      align: "right",
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Code: ${statement.party.codeName}`, right - 5, y + 17, {
      align: "right",
    });
    doc.text(`Generated ${new Date().toLocaleDateString("en-IN")}`, right - 5, y + 24, {
      align: "right",
    });
    y += 37;
  };

  const tableHeader = () => {
    doc.setFillColor(...forest);
    doc.rect(margin, y, contentWidth, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.text("DATE", margin + 2, y + 5.8);
    doc.text("ACTIVITY / REFERENCE", margin + 28, y + 5.8);
    doc.text("DUE ADDED", right - 55, y + 5.8, { align: "right" });
    doc.text("PAID", right - 29, y + 5.8, { align: "right" });
    doc.text("BALANCE", right - 2, y + 5.8, { align: "right" });
    y += 9;
  };

  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(...border);
      doc.line(margin, height - 8, right, height - 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...muted);
      doc.text("Midori Kanjo | Customer due statement", margin, height - 4.5);
      doc.text(`Page ${page} of ${pages}`, right, height - 4.5, { align: "right" });
    }
  };

  header();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ink);
  doc.text(accountLabel, margin, y, { maxWidth: contentWidth * 0.78 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  y += 6;
  doc.text(
    [statement.party.phone || "No phone", statement.party.address || "No address saved"].join("  |  "),
    margin,
    y,
    { maxWidth: contentWidth },
  );
  y += 8;

  const cardGap = 3;
  const cardWidth = (contentWidth - cardGap * 2) / 3;
  const cards = [
    { label: "TOTAL DUE ADDED", value: statement.totalDueAdded, color: ink },
    { label: "TOTAL PAID", value: statement.totalPaid, color: accent },
    { label: "AMOUNT TO PAY NEXT", value: statement.remainingDue, color: primary },
  ];
  cards.forEach((card, index) => {
    const x = margin + index * (cardWidth + cardGap);
    doc.setFillColor(...pale);
    doc.setDrawColor(...border);
    doc.roundedRect(x, y, cardWidth, 21, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...muted);
    doc.text(card.label, x + 4, y + 6);
    doc.setFontSize(10.5);
    doc.setTextColor(...card.color);
    doc.text(money(card.value), x + 4, y + 15, { maxWidth: cardWidth - 8 });
  });
  y += 27;

  doc.setFillColor(...pale);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, contentWidth, 13, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...ink);
  doc.text("LAST PAYMENT", margin + 4, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...muted);
  const last = statement.lastPayment;
  doc.text(
    last
      ? `${money(last.amount)} on ${dateLabel(last.date)} via ${paymentMode(last.mode)}${last.reference ? ` | ${last.reference}` : ""}`
      : "No payment recorded",
    margin + 4,
    y + 10,
    { maxWidth: contentWidth - 8 },
  );
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ink);
  doc.text("DETAILED DUE ACTIVITY", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...muted);
  doc.text(
    `${accountLabel} | ${statement.rows.length} account ${statement.rows.length === 1 ? "entry" : "entries"}`,
    margin,
    y,
    { maxWidth: contentWidth },
  );
  y += 5;
  tableHeader();

  if (!statement.rows.length) {
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "normal");
    doc.text("No due activity has been recorded for this customer.", margin + 3, y + 8);
    y += 14;
  }

  statement.rows.forEach((row, index) => {
    const details = doc.splitTextToSize(rowDetails(row), 74).slice(0, 3);
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
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(...ink);
    doc.text(dateLabel(row.date), margin + 2, y + 5);
    doc.text(details, margin + 28, y + 5);
    doc.setFont("helvetica", "bold");
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL", margin + 3, y + 6);
  doc.text(money(statement.totalDueAdded), right - 55, y + 6, { align: "right" });
  doc.text(money(statement.totalPaid), right - 29, y + 6, { align: "right" });
  doc.setFontSize(9);
  doc.text(money(statement.remainingDue), right - 2, y + 6, { align: "right" });
  doc.setFontSize(6.3);
  doc.text("Total remaining due / amount to pay next", right - 2, y + 12, { align: "right" });

  footer();
  return doc;
}

async function shareOrDownload(blob: Blob, fileName: string, title: string, text: string) {
  if (
    await shareNativeBlob(blob, {
      fileName,
      title,
      text,
      dialogTitle: "Save or share customer statement",
    })
  )
    return "shared" as const;

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
) {
  const doc = await createDueStatementPdf(statement, business);
  const accountLabel = partyStatementLabel(statement.party);
  const fileName = `Midori-Kanjo-due-statement-${safePart(statement.party.name)}-${safePart(statement.party.codeName)}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return shareOrDownload(
    doc.output("blob"),
    fileName,
    `Due statement - ${accountLabel}`,
    `${accountLabel}: total remaining due ${money(statement.remainingDue)}`,
  );
}

export async function downloadDueStatementText(
  statement: PartyDueStatement,
  business: BusinessSettings,
) {
  const content = `\uFEFF${dueStatementText(statement, business)}`;
  const accountLabel = partyStatementLabel(statement.party);
  const fileName = `Midori-Kanjo-due-statement-${safePart(statement.party.name)}-${safePart(statement.party.codeName)}-${new Date().toISOString().slice(0, 10)}.txt`;
  return shareOrDownload(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
    fileName,
    `Due statement - ${accountLabel}`,
    `${accountLabel}: total remaining due ${money(statement.remainingDue)}`,
  );
}
