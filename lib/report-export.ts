import type { BusinessSettings } from "./pdf";
import { dateRangeLabel, type CashFlowReport } from "./cashflow";
import { shareNativeBlob } from "./native-files";

const money = (value: number) => `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;
const filePart = (report: CashFlowReport) => report.fromDate || report.toDate ? `${report.fromDate || "first"}-to-${report.toDate || "today"}` : "all-dates";
const movementLabel = (source: CashFlowReport["movements"][number]["source"]) => ({ sale:"Sale", purchase:"Purchase", sale_return:"Sale return", purchase_return:"Purchase return", customer_payment:"Customer payment", supplier_payment:"Supplier payment", misc_expense:"Miscellaneous" }[source]);

export async function createCashFlowPdf(report: CashFlowReport, business: BusinessSettings) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const right = width - margin;
  const contentWidth = width - margin * 2;
  const green: [number,number,number] = [1,73,33];
  const primary: [number,number,number] = [0,78,35];
  const deep: [number,number,number] = [0,64,20];
  const accent: [number,number,number] = [48,157,75];
  const pale: [number,number,number] = [249,249,249];
  const ink: [number,number,number] = [33,31,29];
  const muted: [number,number,number] = [97,95,92];
  const border: [number,number,number] = [226,226,219];
  let y = 12;

  doc.setProperties({ title:`Cash flow - ${dateRangeLabel(report.fromDate,report.toDate)}`, subject:"Money in and money out report", author:business.name || "Midori Kanjo", creator:"Midori Kanjo" });
  const header = (continued = false) => {
    y = margin;
    doc.setFillColor(...green);
    doc.roundedRect(margin,y,contentWidth,30,2.5,2.5,"F");
    doc.setTextColor(255,255,255);
    doc.setFont("helvetica","bold");
    doc.setFontSize(17);
    doc.text(business.name || "Burrabazar Festival Decor",margin+5,y+9,{maxWidth:contentWidth*.58});
    doc.setFont("helvetica","normal");
    doc.setFontSize(7);
    doc.text((business.address || "Burrabazar, Kolkata, West Bengal").slice(0,110),margin+5,y+15,{maxWidth:contentWidth*.58});
    doc.text([business.phone?`Phone: ${business.phone}`:"",business.gstin?`GSTIN: ${business.gstin}`:""].filter(Boolean).join("  |  "),margin+5,y+23,{maxWidth:contentWidth*.58});
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text(continued ? "CASH FLOW - CONTINUED" : "MONEY IN & OUT",right-5,y+10,{align:"right"});
    doc.setFont("helvetica","normal");
    doc.setFontSize(7.5);
    doc.text(dateRangeLabel(report.fromDate,report.toDate),right-5,y+17,{align:"right"});
    doc.text(`Generated ${new Date().toLocaleString("en-IN")}`,right-5,y+23,{align:"right"});
    y += 36;
  };
  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let page=1;page<=pages;page+=1) {
      doc.setPage(page);
      doc.setDrawColor(...border);
      doc.line(margin,height-8,right,height-8);
      doc.setFont("helvetica","normal");
      doc.setFontSize(6);
      doc.setTextColor(...muted);
      doc.text("Midori Kanjo | Cash-flow report",margin,height-4.5);
      doc.text(`Page ${page} of ${pages}`,right,height-4.5,{align:"right"});
    }
  };
  const summaryRow = (label: string, value: number, color: [number,number,number] = ink) => {
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(label,margin+4,y);
    doc.setFont("helvetica","bold"); doc.setTextColor(...color); doc.text(money(value),right-4,y,{align:"right"}); y += 6.5;
  };

  header();
  const boxWidth = (contentWidth-6)/3;
  const cards = [
    {label:"MONEY IN",value:report.moneyIn,color:accent},
    {label:"MONEY OUT",value:report.moneyOut,color:deep},
    {label:"NET CASH FLOW",value:report.netCashFlow,color:report.netCashFlow>=0?primary:deep}
  ];
  cards.forEach((card,index)=>{
    const x=margin+index*(boxWidth+3); doc.setFillColor(...pale); doc.setDrawColor(...border); doc.roundedRect(x,y,boxWidth,22,1.5,1.5,"FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(...muted); doc.text(card.label,x+4,y+6);
    doc.setFontSize(11); doc.setTextColor(...card.color); doc.text(money(card.value),x+4,y+15.5,{maxWidth:boxWidth-8});
  });
  y += 28;
  doc.setFillColor(...pale); doc.setDrawColor(...border); doc.roundedRect(margin,y,contentWidth,84,1.5,1.5,"FD");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...ink); doc.text("COMPLETE CALCULATION",margin+4,y+6); y += 13;
  summaryRow("Sales billed (cash + credit)",report.salesBilled);
  summaryRow("Received while making bills",report.receivedWithBills,accent);
  summaryRow("Later customer payments received",report.customerPayments,accent);
  summaryRow("Supplier bills recorded",report.supplierBillsRecorded);
  summaryRow("Paid while recording purchases",report.paidWithPurchases,deep);
  summaryRow("Later payments made to suppliers",report.supplierPayments,deep);
  summaryRow("Miscellaneous expenses",report.miscellaneousExpenses,deep);
  y += 2;
  doc.setDrawColor(...border); doc.line(margin+4,y,right-4,y); y += 6;
  summaryRow("Current customer dues to collect",report.customerOutstanding);
  summaryRow("Current supplier payables",report.supplierOutstanding);
  y += 5;

  if (report.expenseBreakdown.length) {
    doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...ink); doc.text("MISCELLANEOUS BREAKDOWN",margin,y); y += 6;
    report.expenseBreakdown.forEach((row)=>summaryRow(row.label,row.amount,deep)); y += 3;
  }

  const tableHeader = () => {
    doc.setFillColor(...green); doc.rect(margin,y,contentWidth,8,"F"); doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(6.5);
    doc.text("DATE",margin+2,y+5.2); doc.text("TYPE",margin+29,y+5.2); doc.text("DETAILS",margin+57,y+5.2); doc.text("MODE",right-40,y+5.2); doc.text("AMOUNT",right-2,y+5.2,{align:"right"}); y+=8;
  };
  doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...ink); doc.text("DETAILED MONEY MOVEMENTS",margin,y); y += 5;
  doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...muted); doc.text(`${report.movements.length} cash movement${report.movements.length===1?"":"s"} in the selected period`,margin,y); y += 5;
  tableHeader();
  if (!report.movements.length) {
    doc.setFont("helvetica","normal"); doc.setTextColor(...muted); doc.text("No money came in or went out during this date range.",margin+3,y+8); y+=13;
  }
  for (let index=0;index<report.movements.length;index+=1) {
    const movement=report.movements[index];
    const detailLines=doc.splitTextToSize(`${movement.title}${movement.details?` | ${movement.details}`:""}`,72).slice(0,2);
    const rowHeight=Math.max(11,detailLines.length*3.2+5);
    if (y+rowHeight>height-14) { doc.addPage(); header(true); tableHeader(); }
    if(index%2){doc.setFillColor(...pale);doc.rect(margin,y,contentWidth,rowHeight,"F");}
    doc.setDrawColor(...border);doc.line(margin,y+rowHeight,right,y+rowHeight);
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...ink);
    doc.text(new Date(`${movement.date}T00:00:00`).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"2-digit"}),margin+2,y+5);
    doc.text(movementLabel(movement.source),margin+29,y+5,{maxWidth:25});
    doc.text(detailLines,margin+57,y+5);
    doc.text(movement.mode.toUpperCase(),right-40,y+5);
    doc.setFont("helvetica","bold"); doc.setTextColor(...(movement.direction==="in"?accent:deep)); doc.text(`${movement.direction==="in"?"+":"-"}${money(movement.amount)}`,right-2,y+5,{align:"right"});
    y+=rowHeight;
  }
  footer();
  return doc;
}

export async function downloadCashFlowPdf(report: CashFlowReport, business: BusinessSettings) {
  const doc = await createCashFlowPdf(report,business);
  const name=`Midori-Kanjo-cash-flow-${filePart(report)}.pdf`;
  if (await shareNativeBlob(doc.output("blob"),{fileName:name,title:"Midori Kanjo cash-flow report",dialogTitle:"Save or share report"})) return;
  doc.save(name);
}

export function cashFlowText(report: CashFlowReport, business: BusinessSettings) {
  const lines = [
    business.name || "Burrabazar Festival Decor",
    "MIDORI KANJO - MONEY IN & OUT REPORT",
    dateRangeLabel(report.fromDate,report.toDate),
    "",
    "SUMMARY",
    `Sales billed (cash + credit)\t${money(report.salesBilled)}`,
    `Money in - received with bills\t${money(report.receivedWithBills)}`,
    `Money in - later customer payments\t${money(report.customerPayments)}`,
    `TOTAL MONEY IN\t${money(report.moneyIn)}`,
    `Supplier bills recorded\t${money(report.supplierBillsRecorded)}`,
    `Money out - paid with purchases\t${money(report.paidWithPurchases)}`,
    `Money out - supplier payments\t${money(report.supplierPayments)}`,
    `Money out - miscellaneous expenses\t${money(report.miscellaneousExpenses)}`,
    `TOTAL MONEY OUT\t${money(report.moneyOut)}`,
    `NET CASH FLOW\t${money(report.netCashFlow)}`,
    `Current customer dues to collect\t${money(report.customerOutstanding)}`,
    `Current supplier payables\t${money(report.supplierOutstanding)}`,
    "",
    "MISCELLANEOUS BREAKDOWN",
    ...(report.expenseBreakdown.length ? report.expenseBreakdown.map((row)=>`${row.label}\t${money(row.amount)}`) : ["No miscellaneous expenses in this period"]),
    "",
    "DETAILED MONEY MOVEMENTS",
    "Date\tDirection\tType\tDetails\tMode\tAmount",
    ...report.movements.map((movement)=>[movement.date,movement.direction.toUpperCase(),movementLabel(movement.source),`${movement.title}${movement.details?` - ${movement.details}`:""}`,movement.mode.toUpperCase(),`${movement.direction==="in"?"+":"-"}${money(movement.amount)}`].join("\t"))
  ];
  return lines.join("\r\n");
}

export async function downloadCashFlowText(report: CashFlowReport, business: BusinessSettings) {
  const content=`\uFEFF${cashFlowText(report,business)}`;
  const name=`Midori-Kanjo-cash-flow-${filePart(report)}.txt`;
  if (await shareNativeBlob(new Blob([content],{type:"text/plain;charset=utf-8"}),{fileName:name,title:"Midori Kanjo cash-flow report",dialogTitle:"Save or share report"})) return;
  const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
  const link=document.createElement("a"); link.href=url; link.download=name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
