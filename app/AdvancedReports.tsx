"use client";

import { useMemo, useState } from "react";
import {
  localDate,
  type AccountEntry,
  type Invoice,
  type Item,
  type Language,
  type Party,
} from "../lib/db";
import {
  convertQuotationToInvoice,
  convertedInvoiceId,
  formatMoney,
} from "../lib/billing";
import {
  buildDailySalesReport,
  buildDeadStockReport,
  buildItemProfitReport,
  buildMarginByPartyReport,
  buildPartySalesReport,
  buildReceivablesAging,
  buildTopRevenueItems,
} from "../lib/reports";
import {
  downloadCataloguePdf,
  shareCatalogue,
  type CatalogueTier,
} from "../lib/catalogue-pdf";
import {
  printInvoice,
  shareInvoice,
  type BusinessSettings,
  type InvoiceFormat,
} from "../lib/pdf";
import { isNativeApp } from "../lib/native-files";
import { renderMessageTemplate } from "../lib/qol";
import {
  formatLocalizedDate,
  localizedItemName,
} from "../lib/i18n";

type ReportKey =
  | "daily"
  | "party"
  | "profit"
  | "aging"
  | "dead"
  | "top"
  | "margin"
  | "catalogue"
  | "quotations";

const reportIcons: Record<ReportKey, string> = {
  daily: "▦",
  party: "◎",
  profit: "₹",
  aging: "◷",
  dead: "◇",
  top: "↗",
  margin: "⚑",
  catalogue: "▤",
  quotations: "✦",
};

type AdvancedReportsCopy = {
  reports: Record<ReportKey, string>;
  eyebrow: string;
  title: string;
  helper: string;
  returnsNotice: string;
  from: string;
  to: string;
  allDates: string;
  chooseReport: string;
  searchReport: string;
  noData: string;
  selected: string;
  selectVisible: string;
  clearSelection: string;
  downloadPdf: string;
  shareWhatsApp: string;
  rows: (count: number) => string;
  reportTable: (report: string) => string;
  dailyHelper: string;
  date: string;
  bills: string;
  taxable: string;
  gst: string;
  sales: string;
  paid: string;
  due: string;
  partyHelper: string;
  party: string;
  cashCustomer: string;
  code: string;
  averageBill: string;
  lastSale: string;
  profitHelper: string;
  knownProfit: string;
  salesBeforeGst: string;
  missingCosts: string;
  item: string;
  sku: string;
  cost: string;
  profit: string;
  margin: string;
  addCost: string;
  costMissing: string;
  agingHelper: (date: string) => string;
  age0To30: string;
  age30To60: string;
  age60Plus: string;
  totalDue: string;
  customer: string;
  total: string;
  oldest: string;
  days: (count: number) => string;
  deadStockHelper: string;
  inactive: string;
  stock: string;
  stockValue: string;
  neverSold: string;
  topItemsHelper: string;
  billCount: (count: number) => string;
  beforeGst: string;
  marginHelper: string;
  lowRateSummary: (count: number, gap: string) => string;
  possibleGap: string;
  rateComparison: (party: string) => string;
  partyRate: string;
  othersPaid: string;
  belowBy: string;
  partyMargin: string;
  noLowRateFlags: string;
  noLowRateHelp: string;
  catalogueHelper: string;
  priceTier: string;
  tiers: Record<CatalogueTier, string>;
  readyToExport: string;
  selectedPrice: (tier: string) => string;
  searchCatalogueItems: string;
  searchItemOrSku: string;
  visibleSelected: (visible: number, selected: number) => string;
  productPhoto: (name: string) => string;
  units: Record<Item["baseUnit"], string>;
  selectAtLeastOne: string;
  catalogueReady: (count: number, tier: string) => string;
  catalogueFailed: string;
  quotationsHelper: string;
  converted: string;
  openQuote: string;
  quoteItems: (count: number) => string;
  convertedInvoice: string;
  converting: string;
  convertToInvoice: string;
  printQuote: string;
  printFailed: string;
  whatsapp: string;
  noQuotations: string;
  noQuotationsHelp: string;
  quotationConverted: (quotation: string, invoice: string) => string;
  quotationConvertFailed: string;
};

const uiCopy = {
  en: {
    reports: {
      daily: "Daily sales",
      party: "Party-wise",
      profit: "Item profit",
      aging: "Receivables aging",
      dead: "Dead stock",
      top: "Top 20 items",
      margin: "Low-rate parties",
      catalogue: "WhatsApp catalogue",
      quotations: "Quotations",
    },
    eyebrow: "Business insights",
    title: "Reports & growth tools",
    helper:
      "Sales, profit, receivables, stock health, price checks and customer catalogues.",
    returnsNotice:
      "Sales, revenue and profit are shown before imported sales returns; return cash movements remain in Cash flow.",
    from: "From",
    to: "To",
    allDates: "All dates",
    chooseReport: "Choose report",
    searchReport: "Search this report",
    noData: "No matching records yet.",
    selected: "selected",
    selectVisible: "Select visible",
    clearSelection: "Clear selection",
    downloadPdf: "Download PDF",
    shareWhatsApp: "Share on WhatsApp",
    rows: (count) => `${count} rows`,
    reportTable: (report) => `${report} table`,
    dailyHelper:
      "One row per selling day with taxable value, GST, collections and credit.",
    date: "Date",
    bills: "Bills",
    taxable: "Taxable",
    gst: "GST",
    sales: "Sales",
    paid: "Paid",
    due: "Due",
    partyHelper:
      "Customer totals for the selected dates, ranked by sales value.",
    party: "Party",
    cashCustomer: "Cash customer",
    code: "Code",
    averageBill: "Average bill",
    lastSale: "Last sale",
    profitHelper:
      "Estimated gross profit before expenses. Items without a purchase cost are marked.",
    knownProfit: "Known profit",
    salesBeforeGst: "Sales before GST",
    missingCosts: "Missing costs",
    item: "Item",
    sku: "SKU",
    cost: "Cost",
    profit: "Profit",
    margin: "Margin",
    addCost: "ADD COST",
    costMissing: "Cost missing",
    agingHelper: (date) =>
      `Outstanding customer dues as of ${date}. Invoice and manual dues are included.`,
    age0To30: "0–30 days",
    age30To60: "30–60 days",
    age60Plus: "60+ days",
    totalDue: "Total due",
    customer: "Customer",
    total: "Total",
    oldest: "Oldest",
    days: (count) => `${count} days`,
    deadStockHelper:
      "Active items with no recorded sale for at least six months. Unknown stock stays visible as – and never blocks billing.",
    inactive: "Inactive",
    stock: "Stock",
    stockValue: "Stock value",
    neverSold: "NEVER SOLD",
    topItemsHelper:
      "The 20 highest-revenue items for the selected dates, including GST in billed revenue.",
    billCount: (count) => `${count} bills`,
    beforeGst: "Before GST",
    marginHelper:
      "Flags party-item rates at least 10% below what other customers paid for the same item and unit.",
    lowRateSummary: (count, gap) =>
      `${count} unusually low item rates · average gap ${gap}%`,
    possibleGap: "Possible gap",
    rateComparison: (party) => `Rate comparison for ${party}`,
    partyRate: "Party rate",
    othersPaid: "Others paid",
    belowBy: "Below by",
    partyMargin: "Party margin",
    noLowRateFlags: "No low-rate party flags",
    noLowRateHelp:
      "A comparison appears after at least two customers buy the same item.",
    catalogueHelper:
      "Select items and a price tier, then download or share a branded A4 price-list PDF.",
    priceTier: "Price tier",
    tiers: { wholesale: "Wholesale", bulk: "Bulk", retail: "Retail" },
    readyToExport: "Ready to export",
    selectedPrice: (tier) => `selected · ${tier} price`,
    searchCatalogueItems: "Search catalogue items",
    searchItemOrSku: "Search item name or SKU",
    visibleSelected: (visible, selected) =>
      `${visible} visible · ${selected} selected`,
    productPhoto: (name) => `${name} product photo`,
    units: {
      piece: "piece",
      dozen: "dozen",
      gross: "gross",
      bundle: "bundle",
      box: "box",
      packet: "packet",
    },
    selectAtLeastOne: "Select at least one catalogue item.",
    catalogueReady: (count, tier) =>
      `${count}-item ${tier} catalogue is ready.`,
    catalogueFailed: "Could not create the catalogue PDF.",
    quotationsHelper:
      "Print or share estimates, then turn an accepted quotation into a credit invoice with one tap. Repeated taps are safe.",
    converted: "CONVERTED",
    openQuote: "OPEN QUOTE",
    quoteItems: (count) => `${count} items`,
    convertedInvoice: "Converted invoice",
    converting: "Converting…",
    convertToInvoice: "Convert to invoice",
    printQuote: "Print quote",
    printFailed: "The print preview could not be opened.",
    whatsapp: "WhatsApp",
    noQuotations: "No quotations yet",
    noQuotationsHelp:
      "Choose “Quotation” at the top of the billing screen to create one.",
    quotationConverted: (quotation, invoice) =>
      `${quotation} converted to ${invoice}.`,
    quotationConvertFailed: "Could not convert the quotation.",
  },
  hi: {
    reports: {
      daily: "डेली सेल",
      party: "पार्टी-वाइज़",
      profit: "सामान का प्रॉफिट",
      aging: "बाकी की अवधि",
      dead: "डेड स्टॉक",
      top: "टॉप 20 सामान",
      margin: "कम रेट वाली पार्टी",
      catalogue: "WhatsApp कैटलॉग",
      quotations: "कोटेशन",
    },
    eyebrow: "बिज़नेस इनसाइट्स",
    title: "रिपोर्ट और बिज़नेस टूल्स",
    helper: "सेल, प्रॉफिट, बाकी, स्टॉक, रेट चेक और कस्टमर कैटलॉग।",
    returnsNotice:
      "सेल, रेवेन्यू और प्रॉफिट में इम्पोर्ट किए सेल रिटर्न घटे नहीं हैं; रिटर्न का कैश लेनदेन कैश फ्लो में दिखेगा।",
    from: "से",
    to: "तक",
    allDates: "सभी तारीखें",
    chooseReport: "रिपोर्ट चुनें",
    searchReport: "इस रिपोर्ट में खोजें",
    noData: "कोई रिकॉर्ड नहीं मिला।",
    selected: "चुने हुए",
    selectVisible: "दिख रहे सभी चुनें",
    clearSelection: "चयन साफ़ करें",
    downloadPdf: "PDF डाउनलोड",
    shareWhatsApp: "WhatsApp पर भेजें",
    rows: (count) => `${count} एंट्री`,
    reportTable: (report) => `${report} की टेबल`,
    dailyHelper:
      "हर सेल तारीख का टैक्सेबल अमाउंट, GST, जमा और बाकी एक लाइन में।",
    date: "तारीख",
    bills: "बिल",
    taxable: "टैक्सेबल",
    gst: "GST",
    sales: "सेल",
    paid: "जमा",
    due: "बाकी",
    partyHelper: "चुनी तारीखों की पार्टी-वाइज़ सेल, सबसे बड़ी सेल पहले।",
    party: "पार्टी",
    cashCustomer: "कैश कस्टमर",
    code: "कोड",
    averageBill: "एवरेज बिल",
    lastSale: "पिछली सेल",
    profitHelper:
      "खर्च से पहले का अनुमानित ग्रॉस प्रॉफिट। बिना खरीद रेट वाले सामान अलग दिखेंगे।",
    knownProfit: "मालूम प्रॉफिट",
    salesBeforeGst: "GST से पहले की सेल",
    missingCosts: "खरीद रेट नहीं",
    item: "सामान",
    sku: "SKU",
    cost: "खरीद रेट",
    profit: "प्रॉफिट",
    margin: "मार्जिन",
    addCost: "रेट डालें",
    costMissing: "खरीद रेट नहीं",
    agingHelper: (date) =>
      `${date} तक कस्टमर से बाकी रकम। बिल और हाथ से जोड़ी बाकी शामिल है।`,
    age0To30: "0–30 दिन",
    age30To60: "30–60 दिन",
    age60Plus: "60+ दिन",
    totalDue: "कुल बाकी",
    customer: "कस्टमर",
    total: "कुल",
    oldest: "सबसे पुरानी",
    days: (count) => `${count} दिन`,
    deadStockHelper:
      "ऐसा चालू सामान जो कम-से-कम छह महीने से नहीं बिका। अनजान स्टॉक – दिखेगा और बिलिंग नहीं रोकेगा।",
    inactive: "नहीं बिका",
    stock: "स्टॉक",
    stockValue: "स्टॉक की कीमत",
    neverSold: "कभी नहीं बिका",
    topItemsHelper:
      "चुनी तारीखों में सबसे ज़्यादा रेवेन्यू वाले 20 सामान; बिल की रकम में GST शामिल है।",
    billCount: (count) => `${count} बिल`,
    beforeGst: "GST से पहले",
    marginHelper:
      "एक ही सामान और यूनिट पर दूसरे कस्टमर से कम-से-कम 10% कम पार्टी रेट दिखाता है।",
    lowRateSummary: (count, gap) =>
      `${count} सामान के रेट काफ़ी कम · एवरेज फर्क ${gap}%`,
    possibleGap: "मुमकिन फर्क",
    rateComparison: (party) => `${party} के रेट की तुलना`,
    partyRate: "पार्टी रेट",
    othersPaid: "दूसरों का रेट",
    belowBy: "इतना कम",
    partyMargin: "पार्टी मार्जिन",
    noLowRateFlags: "कोई कम रेट वाली पार्टी नहीं",
    noLowRateHelp:
      "एक ही सामान कम-से-कम दो कस्टमर खरीदें, तब तुलना दिखेगी।",
    catalogueHelper:
      "सामान और रेट चुनें, फिर ब्रांड वाला A4 प्राइस-लिस्ट PDF डाउनलोड या शेयर करें।",
    priceTier: "कौन-सा रेट",
    tiers: { wholesale: "होलसेल", bulk: "बल्क", retail: "रिटेल" },
    readyToExport: "एक्सपोर्ट के लिए तैयार",
    selectedPrice: (tier) => `चुने हुए · ${tier} रेट`,
    searchCatalogueItems: "कैटलॉग का सामान खोजें",
    searchItemOrSku: "सामान का नाम या SKU खोजें",
    visibleSelected: (visible, selected) =>
      `${visible} दिख रहे · ${selected} चुने हुए`,
    productPhoto: (name) => `${name} की फोटो`,
    units: {
      piece: "पीस",
      dozen: "दर्जन",
      gross: "ग्रॉस",
      bundle: "बंडल",
      box: "बॉक्स",
      packet: "पैकेट",
    },
    selectAtLeastOne: "कैटलॉग के लिए कम-से-कम एक सामान चुनें।",
    catalogueReady: (count, tier) =>
      `${count} सामान का ${tier} कैटलॉग तैयार है।`,
    catalogueFailed: "कैटलॉग PDF नहीं बन सका।",
    quotationsHelper:
      "कोटेशन प्रिंट या शेयर करें। मंज़ूर कोटेशन को एक टैप में उधार बिल बनाएँ; दोबारा टैप सुरक्षित है।",
    converted: "बिल बन गया",
    openQuote: "कोटेशन खुला है",
    quoteItems: (count) => `${count} सामान`,
    convertedInvoice: "बना हुआ बिल",
    converting: "बिल बन रहा है…",
    convertToInvoice: "बिल में बदलें",
    printQuote: "कोटेशन प्रिंट करें",
    printFailed: "प्रिंट प्रिव्यू नहीं खुला।",
    whatsapp: "WhatsApp",
    noQuotations: "अभी कोई कोटेशन नहीं",
    noQuotationsHelp:
      "नया बनाने के लिए बिलिंग स्क्रीन के ऊपर “कोटेशन” चुनें।",
    quotationConverted: (quotation, invoice) =>
      `${quotation} को ${invoice} बिल में बदल दिया।`,
    quotationConvertFailed: "कोटेशन बिल में नहीं बदल सका।",
  },
  bn: {
    reports: {
      daily: "ডেলি সেল",
      party: "পার্টি অনুযায়ী",
      profit: "আইটেমের লাভ",
      aging: "বাকির সময়কাল",
      dead: "ডেড স্টক",
      top: "টপ 20 আইটেম",
      margin: "কম রেটের পার্টি",
      catalogue: "WhatsApp ক্যাটালগ",
      quotations: "কোটেশন",
    },
    eyebrow: "বিজনেস ইনসাইটস",
    title: "রিপোর্ট ও বিজনেস টুলস",
    helper: "সেল, লাভ, বাকি, স্টক, রেট চেক আর কাস্টমার ক্যাটালগ।",
    returnsNotice:
      "সেল, রেভিনিউ ও লাভে ইমপোর্ট করা সেল রিটার্ন বাদ যায়নি; রিটার্নের ক্যাশ লেনদেন ক্যাশ ফ্লোতে দেখা যাবে।",
    from: "থেকে",
    to: "পর্যন্ত",
    allDates: "সব তারিখ",
    chooseReport: "রিপোর্ট বাছুন",
    searchReport: "এই রিপোর্টে খুঁজুন",
    noData: "কোনো রেকর্ড পাওয়া যায়নি।",
    selected: "বাছাই করা",
    selectVisible: "দেখানো সব বাছুন",
    clearSelection: "বাছাই সাফ করুন",
    downloadPdf: "PDF ডাউনলোড",
    shareWhatsApp: "WhatsApp-এ পাঠান",
    rows: (count) => `${count}টি এন্ট্রি`,
    reportTable: (report) => `${report} টেবিল`,
    dailyHelper:
      "প্রতি সেলের তারিখে ট্যাক্সযোগ্য টাকা, GST, জমা ও বাকি এক লাইনে।",
    date: "তারিখ",
    bills: "বিল",
    taxable: "ট্যাক্সযোগ্য",
    gst: "GST",
    sales: "সেল",
    paid: "জমা",
    due: "বাকি",
    partyHelper: "বাছাই করা তারিখে পার্টি অনুযায়ী সেল, বেশি সেল আগে।",
    party: "পার্টি",
    cashCustomer: "ক্যাশ কাস্টমার",
    code: "কোড",
    averageBill: "গড় বিল",
    lastSale: "শেষ সেল",
    profitHelper:
      "খরচের আগের আনুমানিক মোট লাভ। কেনার রেট না থাকা আইটেম আলাদা দেখাবে।",
    knownProfit: "জানা লাভ",
    salesBeforeGst: "GST-এর আগের সেল",
    missingCosts: "কেনার রেট নেই",
    item: "আইটেম",
    sku: "SKU",
    cost: "কেনার রেট",
    profit: "লাভ",
    margin: "মার্জিন",
    addCost: "রেট দিন",
    costMissing: "কেনার রেট নেই",
    agingHelper: (date) =>
      `${date} পর্যন্ত কাস্টমারের বাকি। বিল ও হাতে যোগ করা বাকি ধরা হয়েছে।`,
    age0To30: "0–30 দিন",
    age30To60: "30–60 দিন",
    age60Plus: "60+ দিন",
    totalDue: "মোট বাকি",
    customer: "কাস্টমার",
    total: "মোট",
    oldest: "সবচেয়ে পুরনো",
    days: (count) => `${count} দিন`,
    deadStockHelper:
      "যে চালু আইটেম অন্তত ছয় মাস বিক্রি হয়নি। অজানা স্টক – দেখাবে, বিলিং আটকাবে না।",
    inactive: "বিক্রি নেই",
    stock: "স্টক",
    stockValue: "স্টকের দাম",
    neverSold: "কখনও বিক্রি হয়নি",
    topItemsHelper:
      "বাছাই করা তারিখে সবচেয়ে বেশি রেভিনিউর 20টি আইটেম; বিলের টাকায় GST ধরা আছে।",
    billCount: (count) => `${count}টি বিল`,
    beforeGst: "GST-এর আগে",
    marginHelper:
      "একই আইটেম ও ইউনিটে অন্য কাস্টমারের চেয়ে অন্তত 10% কম পার্টি রেট দেখায়।",
    lowRateSummary: (count, gap) =>
      `${count}টি আইটেমের রেট বেশ কম · গড় ফারাক ${gap}%`,
    possibleGap: "সম্ভাব্য ফারাক",
    rateComparison: (party) => `${party}-র রেট তুলনা`,
    partyRate: "পার্টি রেট",
    othersPaid: "অন্যদের রেট",
    belowBy: "যতটা কম",
    partyMargin: "পার্টি মার্জিন",
    noLowRateFlags: "কম রেটের কোনো পার্টি নেই",
    noLowRateHelp:
      "একই আইটেম অন্তত দুই কাস্টমার কিনলে তুলনা দেখা যাবে।",
    catalogueHelper:
      "আইটেম ও রেট বাছুন, তারপর ব্র্যান্ডের A4 প্রাইস-লিস্ট PDF ডাউনলোড বা শেয়ার করুন।",
    priceTier: "কোন রেট",
    tiers: { wholesale: "পাইকারি", bulk: "বাল্ক", retail: "খুচরা" },
    readyToExport: "এক্সপোর্টের জন্য তৈরি",
    selectedPrice: (tier) => `বাছাই করা · ${tier} রেট`,
    searchCatalogueItems: "ক্যাটালগের আইটেম খুঁজুন",
    searchItemOrSku: "আইটেমের নাম বা SKU খুঁজুন",
    visibleSelected: (visible, selected) =>
      `${visible}টি দেখা যাচ্ছে · ${selected}টি বাছাই`,
    productPhoto: (name) => `${name}-এর ছবি`,
    units: {
      piece: "পিস",
      dozen: "ডজন",
      gross: "গ্রস",
      bundle: "বান্ডিল",
      box: "বক্স",
      packet: "প্যাকেট",
    },
    selectAtLeastOne: "ক্যাটালগের জন্য অন্তত একটি আইটেম বাছুন।",
    catalogueReady: (count, tier) =>
      `${count}টি আইটেমের ${tier} ক্যাটালগ তৈরি।`,
    catalogueFailed: "ক্যাটালগ PDF তৈরি করা যায়নি।",
    quotationsHelper:
      "কোটেশন প্রিন্ট বা শেয়ার করুন। মঞ্জুর কোটেশন এক ট্যাপে বাকির বিলে বদলান; আবার ট্যাপ করলেও সমস্যা নেই।",
    converted: "বিল হয়েছে",
    openQuote: "কোটেশন খোলা",
    quoteItems: (count) => `${count}টি আইটেম`,
    convertedInvoice: "তৈরি হওয়া বিল",
    converting: "বিল হচ্ছে…",
    convertToInvoice: "বিলে বদলান",
    printQuote: "কোটেশন প্রিন্ট করুন",
    printFailed: "প্রিন্ট প্রিভিউ খোলা যায়নি।",
    whatsapp: "WhatsApp",
    noQuotations: "এখনও কোনো কোটেশন নেই",
    noQuotationsHelp:
      "নতুন করতে বিলিং স্ক্রিনের উপরে “কোটেশন” বাছুন।",
    quotationConverted: (quotation, invoice) =>
      `${quotation} থেকে ${invoice} বিল তৈরি হয়েছে।`,
    quotationConvertFailed: "কোটেশন বিল করা যায়নি।",
  },
} satisfies Record<Language, AdvancedReportsCopy>;

const preparePrintWindow = () => {
  if (isNativeApp() || typeof window === "undefined") return null;
  const prepared = window.open("", "_blank");
  if (prepared) prepared.opener = null;
  return prepared;
};

const dateLabel = (value: string | undefined, language: Language) =>
  value ? formatLocalizedDate(value, language) : "-";
const matches = (values: unknown[], query: string) =>
  !query.trim() ||
  values.join(" ").toLowerCase().includes(query.trim().toLowerCase());

function EmptyRow({ columns, label }: { columns: number; label: string }) {
  return (
    <tr>
      <td colSpan={columns} className="py-14 text-center text-[#7b837f]">
        {label}
      </td>
    </tr>
  );
}

function ReportHeader({
  title,
  helper,
  countLabel,
}: {
  title: string;
  helper: string;
  countLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#e2e2db] px-4 py-4">
      <div>
        <h4 className="dashboard-title">{title}</h4>
        <p className="dashboard-subtitle">{helper}</p>
      </div>
      {countLabel && <span className="dashboard-chip">{countLabel}</span>}
    </div>
  );
}

export default function AdvancedReports({
  invoices,
  parties,
  items,
  accountEntries,
  language,
  business,
  format,
  catalogueTemplate,
  onToast,
  onConverted,
  ownerMode,
}: {
  invoices: Invoice[];
  parties: Party[];
  items: Item[];
  accountEntries: AccountEntry[];
  language: Language;
  business: BusinessSettings;
  format: InvoiceFormat;
  catalogueTemplate: string;
  onToast: (message: string) => void;
  onConverted: (invoice: Invoice) => void;
  ownerMode: boolean;
}) {
  const today = localDate();
  const [selectedReport, setReport] = useState<ReportKey>("daily");
  const report: ReportKey =
    ownerMode || !["profit", "margin"].includes(selectedReport)
      ? selectedReport
      : "daily";
  const [fromDate, setFromDate] = useState(`${today.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(today);
  const [query, setQuery] = useState("");
  const [marginParty, setMarginParty] = useState<string | null>(null);
  const [tier, setTier] = useState<CatalogueTier>("wholesale");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [converting, setConverting] = useState<string | null>(null);
  const copy = uiCopy[language];
  const formatDate = (value?: string) => dateLabel(value, language);
  const range = useMemo(() => ({ fromDate, toDate }), [fromDate, toDate]);
  const allSales = invoices.filter(
    (invoice) => !invoice.deletedAt && invoice.type === "sale",
  );
  const daily = useMemo(
    () => buildDailySalesReport(invoices, range),
    [invoices, range],
  );
  const partySales = useMemo(
    () => buildPartySalesReport(invoices, parties, range),
    [invoices, parties, range],
  );
  const itemProfit = useMemo(
    () => buildItemProfitReport(invoices, items, range),
    [invoices, items, range],
  );
  const aging = useMemo(
    () =>
      buildReceivablesAging({
        invoices,
        parties,
        accountEntries,
        asOfDate: today,
      }),
    [invoices, parties, accountEntries, today],
  );
  const deadStock = useMemo(
    () => buildDeadStockReport(invoices, items, today),
    [invoices, items, today],
  );
  const topItems = useMemo(
    () => buildTopRevenueItems(invoices, items, range, 20),
    [invoices, items, range],
  );
  const marginRows = useMemo(
    () => buildMarginByPartyReport(invoices, items, parties, range, 10),
    [invoices, items, parties, range],
  );
  const quotations = useMemo(
    () =>
      invoices
        .filter((invoice) => !invoice.deletedAt && invoice.type === "quotation")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [invoices],
  );
  const catalogueItems = items.filter(
    (item) =>
      item.isActive &&
      matches([item.name, item.skuCode, item.nameHi, item.nameBn], query),
  );
  const chosenItems = items.filter((item) => selectedItems.has(item.id));
  const itemNameById = useMemo(
    () => {
      const names = new Map(
        items.map((item) => [item.id, localizedItemName(language, item)]),
      );
      for (const invoice of invoices) {
        for (const line of invoice.lineItems) {
          if (names.has(line.itemId)) continue;
          names.set(
            line.itemId,
            localizedItemName(language, {
              name: line.itemName,
              nameHi: line.itemNameHi || "",
              nameBn: line.itemNameBn || "",
            }),
          );
        }
      }
      return names;
    },
    [items, invoices, language],
  );
  const displayItemName = (itemId: string, fallback: string) =>
    itemNameById.get(itemId) || fallback;
  const displayPartyName = (name: string, partyId?: string) =>
    partyId ? name : copy.cashCustomer;
  const localizedChosenItems = chosenItems.map((item) => ({
    ...item,
    name: localizedItemName(language, item),
  }));
  const usesRange = !["aging", "dead", "catalogue", "quotations"].includes(
    report,
  );
  const reportName = copy.reports[report];

  const resetDates = () => {
    setFromDate("");
    setToDate("");
  };
  const chooseReport = (next: ReportKey) => {
    setReport(next);
    setQuery("");
    setMarginParty(null);
  };
  const toggleItem = (id: string) =>
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectVisible = () =>
    setSelectedItems(
      (current) =>
        new Set([...current, ...catalogueItems.map((item) => item.id)]),
    );

  async function exportCatalogue(mode: "download" | "share") {
    if (!chosenItems.length) {
      onToast(copy.selectAtLeastOne);
      return;
    }
    const hasFileShare = "share" in navigator && "canShare" in navigator;
    const prepared =
      !isNativeApp() && mode === "share" && !hasFileShare
        ? window.open("", "_blank")
        : null;
    if (prepared) prepared.opener = null;
    try {
      if (mode === "share")
        await shareCatalogue(
          localizedChosenItems,
          tier,
          business,
          prepared,
          language,
          renderMessageTemplate(catalogueTemplate, {
            shop_name: business.name || "Midori Kanjo",
            item_count: chosenItems.length,
            price_tier: copy.tiers[tier],
          }),
        );
      else
        await downloadCataloguePdf(
          localizedChosenItems,
          tier,
          business,
          language,
        );
      onToast(copy.catalogueReady(chosenItems.length, copy.tiers[tier]));
    } catch {
      prepared?.close();
      onToast(copy.catalogueFailed);
    }
  }

  async function convert(quotation: Invoice) {
    if (converting) return;
    setConverting(quotation.id);
    try {
      const invoice = await convertQuotationToInvoice(quotation.id);
      onConverted(invoice);
      onToast(
        copy.quotationConverted(
          quotation.invoiceNumber,
          invoice.invoiceNumber,
        ),
      );
    } catch {
      onToast(copy.quotationConvertFailed);
    } finally {
      setConverting(null);
    }
  }

  return (
    <article className="dashboard-card overflow-hidden xl:col-span-12">
      <div className="border-b border-[#e2e2db] p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 className="mt-1 text-xl text-[#014921]">{copy.title}</h3>
            <p className="mt-1 max-w-2xl text-[10px] font-semibold leading-4 text-[#747573]">
              {copy.helper}
            </p>
            <p className="mt-1 max-w-2xl text-[9px] leading-4 text-[#8a5a36]">
              {copy.returnsNotice}
            </p>
          </div>
          {usesRange && (
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="field-caption mb-1 block">{copy.from}</span>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="min-h-11 rounded-lg border border-[#e2e2db] bg-white px-3 text-[10px] font-black"
                />
              </label>
              <label>
                <span className="field-caption mb-1 block">{copy.to}</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => setToDate(event.target.value)}
                  className="min-h-11 rounded-lg border border-[#e2e2db] bg-white px-3 text-[10px] font-black"
                />
              </label>
              <button
                onClick={resetDates}
                className="min-h-11 rounded-lg border border-[#e2e2db] bg-white px-3 text-[9px] font-black text-[#014921]"
              >
                {copy.allDates}
              </button>
            </div>
          )}
        </div>
        <div
          className="mt-4 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label={copy.chooseReport}
        >
          {(Object.keys(reportIcons) as ReportKey[])
            .filter((key) => ownerMode || !["profit", "margin"].includes(key))
            .map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={report === key}
                onClick={() => chooseReport(key)}
                className={`flex min-h-12 shrink-0 items-center gap-2 rounded-lg border px-3 text-left ${report === key ? "border-[#014921] bg-[#014921] text-white" : "border-[#e2e2db] bg-white text-[#4e5954]"}`}
              >
                <span aria-hidden="true" className="text-base">
                  {reportIcons[key]}
                </span>
                <span className="text-[10px] font-black">
                  {copy.reports[key]}
                </span>
              </button>
            ))}
        </div>
        {!["catalogue"].includes(report) && (
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-[#e2e2db] bg-[#fbfaf6] px-3">
            <span aria-hidden="true" className="text-lg text-[#747573]">
              ⌕
            </span>
            <input
              aria-label={`${copy.searchReport} · ${reportName}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`${copy.searchReport} · ${reportName}`}
              className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
            />
          </label>
        )}
      </div>

      {report === "daily" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.dailyHelper}
            countLabel={copy.rows(daily.length)}
          />
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.reportTable(reportName)}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[820px]">
              <thead>
                <tr>
                  <th>{copy.date}</th>
                  <th className="text-right">{copy.bills}</th>
                  <th className="text-right">{copy.taxable}</th>
                  <th className="text-right">{copy.gst}</th>
                  <th className="text-right">{copy.sales}</th>
                  <th className="text-right">{copy.paid}</th>
                  <th className="text-right">{copy.due}</th>
                </tr>
              </thead>
              <tbody>
                {daily
                  .filter((row) =>
                    matches([row.date, formatDate(row.date)], query),
                  )
                  .map((row) => (
                    <tr key={row.date}>
                      <td className="font-black text-[#014921]">
                        {formatDate(row.date)}
                      </td>
                      <td className="text-right">{row.bills}</td>
                      <td className="text-right">{formatMoney(row.taxable)}</td>
                      <td className="text-right">{formatMoney(row.gst)}</td>
                      <td className="text-right font-black">
                        {formatMoney(row.revenue)}
                      </td>
                      <td className="text-right text-[#267055]">
                        {formatMoney(row.paid)}
                      </td>
                      <td className="text-right text-[#b85a28]">
                        {formatMoney(row.due)}
                      </td>
                    </tr>
                  ))}
                {!daily.filter((row) =>
                  matches([row.date, formatDate(row.date)], query),
                ).length && <EmptyRow columns={7} label={copy.noData} />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report === "party" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.partyHelper}
            countLabel={copy.rows(partySales.length)}
          />
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.reportTable(reportName)}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[860px]">
              <thead>
                <tr>
                  <th>{copy.party}</th>
                  <th>{copy.code}</th>
                  <th className="text-right">{copy.bills}</th>
                  <th className="text-right">{copy.sales}</th>
                  <th className="text-right">{copy.averageBill}</th>
                  <th className="text-right">{copy.paid}</th>
                  <th className="text-right">{copy.due}</th>
                  <th>{copy.lastSale}</th>
                </tr>
              </thead>
              <tbody>
                {partySales
                  .filter((row) =>
                    matches(
                      [
                        row.partyName,
                        displayPartyName(row.partyName, row.partyId),
                        row.codeName,
                      ],
                      query,
                    ),
                  )
                  .map((row) => (
                    <tr key={row.partyId || "cash"}>
                      <td className="font-black text-[#014921]">
                        {displayPartyName(row.partyName, row.partyId)}
                      </td>
                      <td>{row.codeName}</td>
                      <td className="text-right">{row.bills}</td>
                      <td className="text-right font-black">
                        {formatMoney(row.revenue)}
                      </td>
                      <td className="text-right">
                        {formatMoney(row.averageBill)}
                      </td>
                      <td className="text-right">{formatMoney(row.paid)}</td>
                      <td className="text-right text-[#b85a28]">
                        {formatMoney(row.due)}
                      </td>
                      <td>{formatDate(row.lastSaleDate)}</td>
                    </tr>
                  ))}
                {!partySales.filter((row) =>
                  matches(
                    [
                      row.partyName,
                      displayPartyName(row.partyName, row.partyId),
                      row.codeName,
                    ],
                    query,
                  ),
                ).length && <EmptyRow columns={8} label={copy.noData} />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report === "profit" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.profitHelper}
            countLabel={copy.rows(itemProfit.length)}
          />
          <div className="grid grid-cols-2 gap-3 border-b border-[#e2e2db] p-4 sm:grid-cols-3">
            <div className="rounded-xl bg-[#f4faf0] p-3">
              <span className="field-caption">{copy.knownProfit}</span>
              <strong className="mt-2 block text-xl text-[#014921]">
                {formatMoney(
                  itemProfit.reduce((sum, row) => sum + (row.profit || 0), 0),
                )}
              </strong>
            </div>
            <div className="rounded-xl bg-[#f7f5ef] p-3">
              <span className="field-caption">{copy.salesBeforeGst}</span>
              <strong className="mt-2 block text-xl">
                {formatMoney(
                  itemProfit.reduce(
                    (sum, row) => sum + row.revenueBeforeGst,
                    0,
                  ),
                )}
              </strong>
            </div>
            <div className="col-span-2 rounded-xl bg-[#fff3e8] p-3 sm:col-span-1">
              <span className="field-caption">{copy.missingCosts}</span>
              <strong className="mt-2 block text-xl text-[#b85a28]">
                {itemProfit.filter((row) => row.cost === null).length}
              </strong>
            </div>
          </div>
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.reportTable(reportName)}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[820px]">
              <thead>
                <tr>
                  <th>{copy.item}</th>
                  <th>{copy.sku}</th>
                  <th className="text-right">{copy.bills}</th>
                  <th className="text-right">{copy.salesBeforeGst}</th>
                  <th className="text-right">{copy.cost}</th>
                  <th className="text-right">{copy.profit}</th>
                  <th className="text-right">{copy.margin}</th>
                </tr>
              </thead>
              <tbody>
                {itemProfit
                  .filter((row) =>
                    matches(
                      [
                        row.itemName,
                        displayItemName(row.itemId, row.itemName),
                        row.skuCode,
                      ],
                      query,
                    ),
                  )
                  .map((row) => (
                    <tr key={row.itemId}>
                      <td className="font-black">
                        {displayItemName(row.itemId, row.itemName)}
                      </td>
                      <td>{row.skuCode}</td>
                      <td className="text-right">{row.bills}</td>
                      <td className="text-right">
                        {formatMoney(row.revenueBeforeGst)}
                      </td>
                      <td className="text-right">
                        {row.cost === null ? (
                          <span className="rounded-md bg-[#fff3e8] px-2 py-1 text-[8px] font-black text-[#9b4c28]">
                            {copy.addCost}
                          </span>
                        ) : (
                          formatMoney(row.cost)
                        )}
                      </td>
                      <td className="text-right font-black text-[#014921]">
                        {row.profit === null ? "-" : formatMoney(row.profit)}
                      </td>
                      <td className="text-right">
                        {row.marginPercent == null
                          ? copy.costMissing
                          : `${row.marginPercent.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                {!itemProfit.filter((row) =>
                  matches(
                    [
                      row.itemName,
                      displayItemName(row.itemId, row.itemName),
                      row.skuCode,
                    ],
                    query,
                  ),
                ).length && <EmptyRow columns={7} label={copy.noData} />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report === "aging" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.agingHelper(formatDate(today))}
            countLabel={copy.rows(aging.rows.length)}
          />
          <div className="grid grid-cols-2 gap-3 border-b border-[#e2e2db] p-4 sm:grid-cols-4">
            {(
              [
                ["0-30", copy.age0To30],
                ["30-60", copy.age30To60],
                ["60+", copy.age60Plus],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className={`rounded-xl p-3 ${key === "60+" ? "bg-[#fff0e4]" : "bg-[#f4faf0]"}`}
              >
                <span className="field-caption">{label}</span>
                <strong
                  className={`mt-2 block text-xl ${key === "60+" ? "text-[#b85a28]" : "text-[#014921]"}`}
                >
                  {formatMoney(aging.totals[key])}
                </strong>
              </div>
            ))}
            <div className="rounded-xl bg-[#014921] p-3 text-white">
              <span className="text-[8px] font-black uppercase tracking-wide opacity-75">
                {copy.totalDue}
              </span>
              <strong className="mt-2 block text-xl">
                {formatMoney(aging.totals.total)}
              </strong>
            </div>
          </div>
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.reportTable(reportName)}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[780px]">
              <thead>
                <tr>
                  <th>{copy.customer}</th>
                  <th>{copy.code}</th>
                  <th className="text-right">{copy.age0To30}</th>
                  <th className="text-right">{copy.age30To60}</th>
                  <th className="text-right">{copy.age60Plus}</th>
                  <th className="text-right">{copy.total}</th>
                  <th className="text-right">{copy.oldest}</th>
                </tr>
              </thead>
              <tbody>
                {aging.rows
                  .filter((row) =>
                    matches([row.partyName, row.codeName], query),
                  )
                  .map((row) => (
                    <tr key={row.partyId}>
                      <td className="font-black text-[#014921]">
                        {row.partyName}
                      </td>
                      <td>{row.codeName}</td>
                      <td className="text-right">
                        {formatMoney(row.zeroToThirty)}
                      </td>
                      <td className="text-right">
                        {formatMoney(row.thirtyToSixty)}
                      </td>
                      <td className="text-right text-[#b85a28]">
                        {formatMoney(row.sixtyPlus)}
                      </td>
                      <td className="text-right font-black">
                        {formatMoney(row.total)}
                      </td>
                      <td className="text-right">{copy.days(row.oldestDays)}</td>
                    </tr>
                  ))}
                {!aging.rows.filter((row) =>
                  matches([row.partyName, row.codeName], query),
                ).length && <EmptyRow columns={7} label={copy.noData} />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report === "dead" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.deadStockHelper}
            countLabel={copy.rows(deadStock.length)}
          />
          <div
            className="report-table-scroller"
            role="region"
            aria-label={copy.reportTable(reportName)}
            tabIndex={0}
          >
            <table className="dashboard-table min-w-[760px]">
              <thead>
                <tr>
                  <th>{copy.item}</th>
                  <th>{copy.sku}</th>
                  <th>{copy.lastSale}</th>
                  <th className="text-right">{copy.inactive}</th>
                  <th className="text-right">{copy.stock}</th>
                  {ownerMode && (
                    <th className="text-right">{copy.stockValue}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {deadStock
                  .filter((row) =>
                    matches(
                      [
                        row.itemName,
                        displayItemName(row.itemId, row.itemName),
                        row.skuCode,
                      ],
                      query,
                    ),
                  )
                  .map((row) => (
                    <tr key={row.itemId}>
                      <td className="font-black">
                        {displayItemName(row.itemId, row.itemName)}
                      </td>
                      <td>{row.skuCode}</td>
                      <td>
                        {row.lastSaleDate ? (
                          formatDate(row.lastSaleDate)
                        ) : (
                          <span className="rounded-md bg-[#fff3e8] px-2 py-1 text-[8px] font-black text-[#9b4c28]">
                            {copy.neverSold}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        {row.daysWithoutSale == null
                          ? "-"
                          : copy.days(row.daysWithoutSale)}
                      </td>
                      <td className="text-right">
                        {row.currentStock == null ? "-" : row.currentStock}
                      </td>
                      {ownerMode && (
                        <td className="text-right">
                          {row.stockValue == null
                            ? "-"
                            : formatMoney(row.stockValue)}
                        </td>
                      )}
                    </tr>
                  ))}
                {!deadStock.filter((row) =>
                  matches(
                    [
                      row.itemName,
                      displayItemName(row.itemId, row.itemName),
                      row.skuCode,
                    ],
                    query,
                  ),
                ).length && (
                  <EmptyRow columns={ownerMode ? 6 : 5} label={copy.noData} />
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report === "top" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.topItemsHelper}
            countLabel={copy.rows(topItems.length)}
          />
          <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {topItems
              .filter((row) =>
                matches(
                  [
                    row.itemName,
                    displayItemName(row.itemId, row.itemName),
                    row.skuCode,
                  ],
                  query,
                ),
              )
              .map((row, index) => (
                <div
                  key={row.itemId}
                  className="rounded-xl border border-[#e2e2db] bg-white p-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#014921] text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-xs">
                        {displayItemName(row.itemId, row.itemName)}
                      </strong>
                      <p className="mt-1 text-[8px] text-[#747573]">
                        {row.skuCode} · {copy.billCount(row.bills)}
                      </p>
                      <strong className="mt-3 block text-lg text-[#014921]">
                        {formatMoney(row.revenue)}
                      </strong>
                      <p className="mt-1 text-[8px] text-[#747573]">
                        {copy.beforeGst} {formatMoney(row.taxable)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            {!topItems.filter((row) =>
              matches(
                [
                  row.itemName,
                  displayItemName(row.itemId, row.itemName),
                  row.skuCode,
                ],
                query,
              ),
            ).length && (
              <p className="col-span-full py-12 text-center text-xs text-[#747573]">
                {copy.noData}
              </p>
            )}
          </div>
        </div>
      )}

      {report === "margin" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.marginHelper}
            countLabel={copy.rows(marginRows.length)}
          />
          <div className="space-y-2 p-4">
            {marginRows
              .filter((row) =>
                matches(
                  [
                    row.partyName,
                    row.codeName,
                    ...row.comparisons.map((entry) => entry.itemName),
                    ...row.comparisons.map((entry) =>
                      displayItemName(entry.itemId, entry.itemName),
                    ),
                  ],
                  query,
                ),
              )
              .map((row) => (
                <div
                  key={row.partyId}
                  className="overflow-hidden rounded-xl border border-[#e2e2db]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setMarginParty(
                        marginParty === row.partyId ? null : row.partyId,
                      )
                    }
                    className="flex min-h-16 w-full items-center justify-between gap-3 bg-white p-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="truncate text-sm text-[#014921]">
                          {row.partyName}
                        </strong>
                        {row.codeName && (
                          <span className="rounded-md bg-[#f4faf0] px-2 py-1 text-[8px] font-black">
                            {row.codeName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[9px] text-[#747573]">
                        {copy.lowRateSummary(
                          row.flaggedItems,
                          row.averageGapPercent.toFixed(1),
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-[8px] font-black uppercase text-[#747573]">
                        {copy.possibleGap}
                      </span>
                      <strong className="mt-1 block text-sm text-[#b85a28]">
                        {formatMoney(row.estimatedRevenueGap)}
                      </strong>
                    </div>
                  </button>
                  {marginParty === row.partyId && (
                    <div
                      className="report-table-scroller border-t border-[#e2e2db]"
                      role="region"
                      aria-label={copy.rateComparison(row.partyName)}
                      tabIndex={0}
                    >
                      <table className="dashboard-table min-w-[720px]">
                        <thead>
                          <tr>
                            <th>{copy.item}</th>
                            <th className="text-right">{copy.partyRate}</th>
                            <th className="text-right">{copy.othersPaid}</th>
                            <th className="text-right">{copy.belowBy}</th>
                            <th className="text-right">{copy.partyMargin}</th>
                            <th className="text-right">{copy.possibleGap}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.comparisons.map((entry) => (
                            <tr key={entry.itemId}>
                              <td className="font-black">
                                {displayItemName(entry.itemId, entry.itemName)}
                              </td>
                              <td className="text-right">
                                {formatMoney(entry.partyRate)}
                              </td>
                              <td className="text-right">
                                {formatMoney(entry.comparisonRate)}
                              </td>
                              <td className="text-right text-[#b85a28]">
                                {entry.gapPercent.toFixed(1)}%
                              </td>
                              <td className="text-right">
                                {entry.marginPercent == null
                                  ? copy.costMissing
                                  : `${entry.marginPercent.toFixed(1)}%`}
                              </td>
                              <td className="text-right font-black">
                                {formatMoney(entry.estimatedRevenueGap)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            {!marginRows.filter((row) =>
              matches(
                [
                  row.partyName,
                  row.codeName,
                  ...row.comparisons.map((entry) => entry.itemName),
                  ...row.comparisons.map((entry) =>
                    displayItemName(entry.itemId, entry.itemName),
                  ),
                ],
                query,
              ),
            ).length && (
              <div className="rounded-xl bg-[#f4faf0] p-10 text-center">
                <strong className="text-sm text-[#014921]">
                  {copy.noLowRateFlags}
                </strong>
                <p className="mt-2 text-[10px] text-[#747573]">
                  {copy.noLowRateHelp}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {report === "catalogue" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.catalogueHelper}
            countLabel={copy.rows(chosenItems.length)}
          />
          <div className="grid gap-4 p-4 lg:grid-cols-[300px_1fr]">
            <aside className="h-fit rounded-xl border border-[#e2e2db] bg-[#f7f5ef] p-4 lg:sticky lg:top-24">
              <fieldset className="m-0 border-0 p-0">
                <legend className="field-caption mb-2 block">
                  {copy.priceTier}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["wholesale", "bulk", "retail"] as CatalogueTier[]).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={tier === value}
                        onClick={() => setTier(value)}
                        className={`min-h-11 rounded-lg border text-[9px] font-black ${tier === value ? "border-[#014921] bg-[#014921] text-white" : "border-[#e2e2db] bg-white"}`}
                      >
                        {copy.tiers[value]}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
              <div className="mt-4 rounded-xl bg-white p-3">
                <span className="field-caption">{copy.readyToExport}</span>
                <strong className="mt-2 block text-2xl text-[#014921]">
                  {chosenItems.length}
                </strong>
                <p className="mt-1 text-[9px] text-[#747573]">
                  {copy.selectedPrice(copy.tiers[tier])}
                </p>
              </div>
              <div className="mt-3 grid gap-2">
                <button
                  onClick={() => void exportCatalogue("share")}
                  disabled={!chosenItems.length}
                  className="counter-primary"
                >
                  {copy.shareWhatsApp}
                </button>
                <button
                  onClick={() => void exportCatalogue("download")}
                  disabled={!chosenItems.length}
                  className="counter-secondary"
                >
                  {copy.downloadPdf}
                </button>
              </div>
            </aside>
            <div>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#e2e2db] bg-white px-3">
                <span aria-hidden="true" className="text-lg text-[#747573]">⌕</span>
                <input
                  aria-label={copy.searchCatalogueItems}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchItemOrSku}
                  className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
                />
              </label>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[9px] font-bold text-[#747573]">
                  {copy.visibleSelected(
                    catalogueItems.length,
                    chosenItems.length,
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={selectVisible}
                    className="min-h-9 rounded-lg border border-[#e2e2db] bg-white px-3 text-[8px] font-black text-[#014921]"
                  >
                    {copy.selectVisible}
                  </button>
                  <button
                    onClick={() => setSelectedItems(new Set())}
                    className="min-h-9 rounded-lg border border-[#e2e2db] bg-white px-3 text-[8px] font-black"
                  >
                    {copy.clearSelection}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {catalogueItems.map((item) => {
                  const itemName = localizedItemName(language, item);
                  return (
                    <label
                      key={item.id}
                      className={`flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border p-2.5 ${selectedItems.has(item.id) ? "border-[#014921] bg-[#f4faf0]" : "border-[#e2e2db] bg-white"}`}
                    >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="h-5 w-5 accent-[#014921]"
                    />
                    {item.imageUrl ? (
                      <span
                        role="img"
                        aria-label={copy.productPhoto(itemName)}
                        className="h-12 w-12 shrink-0 rounded-lg bg-cover bg-center"
                        style={{ backgroundImage: `url(${item.imageUrl})` }}
                      />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#f4faf0] text-[10px] font-black text-[#014921]">
                        {itemName.slice(0, 2).toLocaleUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px]">
                        {itemName}
                      </strong>
                      <span className="mt-1 block truncate text-[8px] text-[#747573]">
                        {item.skuCode} · {copy.units[item.baseUnit]}
                      </span>
                      <strong className="mt-1 block text-[10px] text-[#014921]">
                        {formatMoney(
                          tier === "retail"
                            ? item.priceRetail
                            : tier === "bulk"
                              ? item.priceBulk
                              : item.priceWholesale,
                        )}
                      </strong>
                    </span>
                    </label>
                  );
                })}
                {!catalogueItems.length && (
                  <p className="col-span-full py-12 text-center text-xs text-[#747573]">
                    {copy.noData}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {report === "quotations" && (
        <div>
          <ReportHeader
            title={reportName}
            helper={copy.quotationsHelper}
            countLabel={copy.rows(quotations.length)}
          />
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {quotations
              .filter((quotation) =>
                matches(
                  [
                    quotation.invoiceNumber,
                    quotation.partyName,
                    displayPartyName(quotation.partyName, quotation.partyId),
                  ],
                  query,
                ),
              )
              .map((quotation) => {
                const convertedId = convertedInvoiceId(quotation);
                const converted = convertedId
                  ? allSales.find((invoice) => invoice.id === convertedId)
                  : undefined;
                return (
                  <div
                    key={quotation.id}
                    className="rounded-xl border border-[#e2e2db] bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span
                          className={`rounded-md px-2 py-1 text-[8px] font-black ${converted ? "bg-[#f4faf0] text-[#014921]" : "bg-[#fff3e8] text-[#9b4c28]"}`}
                        >
                          {converted ? copy.converted : copy.openQuote}
                        </span>
                        <strong className="mt-2 block text-sm text-[#014921]">
                          {quotation.invoiceNumber}
                        </strong>
                        <p className="mt-1 text-[10px] font-bold">
                          {displayPartyName(
                            quotation.partyName,
                            quotation.partyId,
                          )}
                        </p>
                        <p className="mt-1 text-[8px] text-[#747573]">
                          {formatDate(quotation.date)} ·{" "}
                          {copy.quoteItems(quotation.lineItems.length)}
                        </p>
                      </div>
                      <strong className="text-base">
                        {formatMoney(quotation.grandTotal)}
                      </strong>
                    </div>
                    {converted ? (
                      <div className="mt-4 rounded-lg bg-[#f4faf0] p-3">
                        <span className="field-caption">
                          {copy.convertedInvoice}
                        </span>
                        <strong className="mt-1 block text-xs text-[#014921]">
                          {converted.invoiceNumber}
                        </strong>
                      </div>
                    ) : (
                      <button
                        disabled={converting === quotation.id}
                        onClick={() => void convert(quotation)}
                        className="counter-primary mt-4"
                      >
                        {converting === quotation.id
                          ? copy.converting
                          : copy.convertToInvoice}
                      </button>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          const prepared = preparePrintWindow();
                          void printInvoice(
                            quotation,
                            business,
                            format,
                            prepared,
                            language,
                          ).catch(() => {
                            prepared?.close();
                            onToast(copy.printFailed);
                          });
                        }}
                        className="counter-secondary"
                      >
                        {copy.printQuote}
                      </button>
                      <button
                        onClick={() =>
                          void shareInvoice(
                            quotation,
                            business,
                            format,
                            undefined,
                            undefined,
                            language,
                          )
                        }
                        className="counter-secondary text-[#014921]"
                      >
                        {copy.whatsapp}
                      </button>
                    </div>
                  </div>
                );
              })}
            {!quotations.filter((quotation) =>
              matches(
                [
                  quotation.invoiceNumber,
                  quotation.partyName,
                  displayPartyName(quotation.partyName, quotation.partyId),
                ],
                query,
              ),
            ).length && (
              <div className="col-span-full rounded-xl bg-[#f7f5ef] p-12 text-center">
                <strong className="text-sm">{copy.noQuotations}</strong>
                <p className="mt-2 text-[10px] text-[#747573]">
                  {copy.noQuotationsHelp}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
