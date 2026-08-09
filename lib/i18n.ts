import type { Item, Language, Unit } from "./db";

export const supportedLanguages = ["en", "hi", "bn"] as const satisfies readonly Language[];

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && supportedLanguages.includes(value as Language);

/**
 * Hindi and Bengali keep familiar Indian business wording and Latin digits.
 * The script, month and weekday names still follow the selected language.
 */
export const localeForLanguage = (language: Language) =>
  language === "hi"
    ? "hi-IN-u-nu-latn"
    : language === "bn"
      ? "bn-IN-u-nu-latn"
      : "en-IN";

const toLocalDate = (value: string | Date) => {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
};

export function formatLocalizedDate(
  value: string | Date,
  language: Language,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  },
) {
  const date = toLocalDate(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat(localeForLanguage(language), options).format(date);
}

export function formatLocalizedDateTime(
  value: string | Date,
  language: Language,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
) {
  return formatLocalizedDate(value, language, options);
}

type LocalizedItem = Pick<Item, "name" | "nameHi" | "nameBn">;

export function localizedItemName(language: Language, item: LocalizedItem) {
  const selected = language === "hi" ? item.nameHi : language === "bn" ? item.nameBn : item.name;
  return selected?.trim() || item.name.trim();
}

export function localizedItemSecondaryName(language: Language, item: LocalizedItem) {
  const primary = localizedItemName(language, item);
  const fallback = language === "en" ? item.nameHi || item.nameBn : item.name;
  const secondary = fallback?.trim() || "";
  return secondary && secondary !== primary ? secondary : "";
}

const unitNames: Record<Language, Record<Unit, string>> = {
  en: { piece: "Piece", dozen: "Dozen", gross: "Gross", bundle: "Bundle", box: "Box", packet: "Packet" },
  hi: { piece: "पीस", dozen: "दर्जन", gross: "ग्रोस", bundle: "बंडल", box: "बॉक्स", packet: "पैकेट" },
  bn: { piece: "পিস", dozen: "ডজন", gross: "গ্রস", bundle: "বান্ডিল", box: "বক্স", packet: "প্যাকেট" },
};

export const localizedUnitName = (language: Language, unit: Unit) =>
  unitNames[language][unit];

const builtInCategoryNames: Record<string, { hi: string; bn: string }> = {
  Uncategorized: { hi: "बिना कैटेगरी", bn: "ক্যাটাগরি নেই" },
  "Moti Mala": { hi: "मोती माला", bn: "মোতি মালা" },
  "Puja Decor": { hi: "पूजा डेकोर", bn: "পুজোর ডেকর" },
  "Diwali Lights & Torans": { hi: "दिवाली लाइट और तोरण", bn: "দীপাবলির লাইট ও তোরণ" },
  "Christmas Decor": { hi: "क्रिसमस डेकोर", bn: "ক্রিসমাস ডেকর" },
  "Birthday Items": { hi: "बर्थडे आइटम", bn: "বার্থডে আইটেম" },
  "Independence Day / Patriotic": { hi: "स्वतंत्रता दिवस / देशभक्ति", bn: "স্বাধীনতা দিবস / দেশাত্মবোধক" },
  "Wedding Decor": { hi: "शादी डेकोर", bn: "বিয়ের ডেকর" },
  "Balloons & Party Supplies": { hi: "बैलून और पार्टी सामान", bn: "বেলুন ও পার্টি সামগ্রী" },
};

export const localizedCategoryName = (language: Language, name: string) =>
  language === "en" ? name : builtInCategoryNames[name]?.[language] || name;

export const labels = {
  en: {
    bill: "Bill", parties: "Parties", dues: "Dues", items: "Items", misc: "Misc.", reports: "Reports", more: "More",
    miscellaneous: "Miscellaneous costs", addExpense: "Add expense", moneyIn: "Money in", moneyOut: "Money out", netCashFlow: "Net cash flow", exportPdf: "Export PDF", exportText: "Export text", viewStatement: "View statement",
    newBill: "New Bill", saleBill: "Sale bill", quotation: "Quotation", newQuotation: "New quotation", quotationSummary: "Quotation summary", estimateOnly: "Estimate only", estimateHelp: "Saving this quotation does not add customer due, update last-sale prices or count stock. Convert it after the customer accepts.", customer: "Customer", cashCustomer: "Cash customer", newCustomer: "New customer", addManualDue: "Add due manually",
    searchParty: "Search party name or phone", addItem: "Add item",
    searchItem: "Search name, SKU, Hindi or Bengali", recentItems: "Recent & frequent",
    qty: "Qty", quantity: "Quantity", unit: "Unit", rate: "Rate", lastPrice: "Last", discount: "Discount", discountShort: "Disc.", subtotal: "Subtotal",
    gst: "GST", taxable: "Taxable", total: "Total", paid: "Paid", due: "Due", roundOff: "Round off",
    gstOnBill: "GST on final bill", gstApplied: "applied to every item", gstOff: "Off",
    customGst: "Enter GST rate (0 to 25%)", manual: "Manual", gstRange: "Manual 0-25%",
    otherCharges: "Other charges", chargeHelp: "Turn on only the charges needed for this bill", carrierCharge: "Carrier / transport", packingCharge: "Packing charge",
    bigBoxCharge: "Big box charge", addCharge: "Add", removeCharge: "Remove", chargeAmount: "Charge amount",
    saveOnly: "Save only", savePrint: "Save & print", saveWhatsapp: "Save & WhatsApp",
    noItems: "Add an item to start the bill", create: "Create", payment: "Payment",
    ledger: "Ledger", offline: "Offline", pending: "Pending", synced: "Synced",
    syncing: "Syncing", fastCounter: "Fast counter", pricesBeforeGst: "Prices before GST",
    searchHelp: "Search the sample items now. Unknown or zero stock will never block a sale.",
    amountReceived: "Amount received", via: "via", fullPayment: "Full payment", partialPayment: "Part payment", payLater: "Pay later", paymentChoice: "How is this bill being paid?", receivedNow: "Received now", addedToDues: "Added to dues", balanceAfterBill: "Customer due after bill", selectCustomerForDue: "Select a customer to save a due", enterPartPayment: "Enter the amount received", partPaymentLessThan: "Part payment must be less than", chooseFullPayment: "Choose full payment instead.", cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque",
    credit: "Credit", udhaar: "Udhaar", changeReturn: "Change to return", print: "Print", whatsapp: "WhatsApp", quotationTotal: "Quotation total", printQuote: "Print quote", shareQuote: "Share quote", saveQuotation: "Save quotation",
    saveBill: "Save bill", workspace: "Workspace", counterReady: "Counter ready",
    offlineReady: "Fast billing works offline", customers: "Customers", suppliers: "Suppliers",
    addParty: "Add party", toCollect: "To collect", toPay: "To pay", addDue: "Add due",
    supplierBill: "Add supplier bill", paymentReceived: "Payment received", paymentPaid: "Payment paid",
    appearance: "Appearance", lightMode: "Light mode", darkMode: "Dark mode",
    dueStatement: "Due statement", dueStatementHelp: "Every bill, manual due and payment in one running account statement.",
    dueAdded: "Due added", totalPaid: "Total paid", remainingDue: "Remaining due", amountToPayNext: "Amount to pay next",
    lastPayment: "Last payment", noPaymentRecorded: "No payment recorded", activity: "Activity", referenceMode: "Reference / mode",
    runningBalance: "Running balance", accountEntries: "account entries",
    totalRemaining: "Total remaining due", customerAccount: "Customer account", backToDues: "Back to all dues",
    ownerMode: "Owner mode", ownerOnly: "Owner only", ownerModeOn: "ON", ownerModeOff: "OFF", ownerModeVisible: "Purchase costs and profit margins are visible. Turn this off before staff use the screen.", ownerModeHidden: "Selling prices stay visible; purchase costs and profits are private.", profitOverview: "Cost & profit", purchaseCost: "Purchase cost", wholesaleSelling: "Wholesale rate", profitPerUnit: "Profit per unit", grossMargin: "Gross margin", costNotSet: "Not set", sellingTiers: "Selling rates", bulkSelling: "Bulk", retailSelling: "Retail",
  },
  hi: {
    bill: "बिल", parties: "पार्टी", dues: "बकाया", items: "आइटम", misc: "खर्च", reports: "रिपोर्ट", more: "और",
    miscellaneous: "दुकान के खर्च", addExpense: "खर्च जोड़ें", moneyIn: "पैसा आया", moneyOut: "पैसा गया", netCashFlow: "नेट कैश फ्लो", exportPdf: "PDF डाउनलोड", exportText: "टेक्स्ट डाउनलोड", viewStatement: "स्टेटमेंट देखें",
    newBill: "नया बिल", saleBill: "सेल बिल", quotation: "कोटेशन", newQuotation: "नया कोटेशन", quotationSummary: "कोटेशन का सारांश", estimateOnly: "सिर्फ अनुमान", estimateHelp: "कोटेशन सेव करने से कस्टमर का बकाया, पिछला रेट या स्टॉक नहीं बदलता। कस्टमर की मंजूरी के बाद इसे बिल में बदलें।", customer: "कस्टमर", cashCustomer: "कैश कस्टमर", newCustomer: "नया कस्टमर", addManualDue: "बकाया जोड़ें",
    searchParty: "नाम या फोन खोजें", addItem: "आइटम जोड़ें",
    searchItem: "नाम, SKU, हिंदी या बंगाली में खोजें", recentItems: "हाल में इस्तेमाल किए गए",
    qty: "मात्रा", quantity: "मात्रा", unit: "यूनिट", rate: "रेट", lastPrice: "पिछला रेट", discount: "छूट", discountShort: "छूट", subtotal: "सबटोटल",
    gst: "GST", taxable: "टैक्स योग्य", total: "कुल", paid: "जमा", due: "बकाया", roundOff: "राउंड ऑफ",
    gstOnBill: "फाइनल बिल पर GST", gstApplied: "सभी आइटम पर", gstOff: "बंद",
    customGst: "GST रेट डालें (0 से 25%)", manual: "मैनुअल", gstRange: "मैनुअल 0-25%",
    otherCharges: "दूसरे चार्ज", chargeHelp: "इस बिल के लिए जरूरी चार्ज ही चालू करें", carrierCharge: "ढुलाई / ट्रांसपोर्ट", packingCharge: "पैकिंग चार्ज",
    bigBoxCharge: "बड़े बॉक्स का चार्ज", addCharge: "जोड़ें", removeCharge: "हटाएँ", chargeAmount: "चार्ज की रकम",
    saveOnly: "सिर्फ सेव", savePrint: "सेव और प्रिंट", saveWhatsapp: "सेव और WhatsApp",
    noItems: "बिल शुरू करने के लिए आइटम जोड़ें", create: "बनाएँ", payment: "पेमेंट",
    ledger: "खाता", offline: "ऑफलाइन", pending: "पेंडिंग", synced: "सिंक हो गया",
    syncing: "सिंक हो रहा है", fastCounter: "फास्ट काउंटर", pricesBeforeGst: "GST से पहले के रेट",
    searchHelp: "आइटम खोजें। स्टॉक पता न हो या शून्य हो, फिर भी बिक्री नहीं रुकेगी।",
    amountReceived: "मिली रकम", via: "के जरिए", fullPayment: "पूरा पेमेंट", partialPayment: "पार्ट पेमेंट", payLater: "बाद में देंगे", paymentChoice: "इस बिल का पेमेंट कैसे होगा?", receivedNow: "अभी मिला", addedToDues: "बकाया में गया", balanceAfterBill: "बिल के बाद कस्टमर का बकाया", selectCustomerForDue: "बकाया सेव करने के लिए कस्टमर चुनें", enterPartPayment: "मिली रकम डालें", partPaymentLessThan: "पार्ट पेमेंट इससे कम होना चाहिए", chooseFullPayment: "इसके बजाय पूरा पेमेंट चुनें।", cash: "कैश", upi: "UPI", bank: "बैंक", cheque: "चेक",
    credit: "उधार", udhaar: "उधार", changeReturn: "वापस देने की रकम", print: "प्रिंट", whatsapp: "WhatsApp", quotationTotal: "कोटेशन का कुल", printQuote: "कोटेशन प्रिंट करें", shareQuote: "कोटेशन शेयर करें", saveQuotation: "कोटेशन सेव करें",
    saveBill: "बिल सेव करें", workspace: "वर्कस्पेस", counterReady: "काउंटर तैयार",
    offlineReady: "बिलिंग ऑफलाइन भी चलती है", customers: "कस्टमर", suppliers: "सप्लायर",
    addParty: "पार्टी जोड़ें", toCollect: "लेना है", toPay: "देना है", addDue: "बकाया जोड़ें",
    supplierBill: "सप्लायर बिल जोड़ें", paymentReceived: "पेमेंट मिला", paymentPaid: "पेमेंट दिया",
    appearance: "थीम", lightMode: "लाइट मोड", darkMode: "डार्क मोड",
    dueStatement: "बकाया स्टेटमेंट", dueStatementHelp: "सभी बिल, जोड़ा गया बकाया और पेमेंट एक ही खाते में देखें।",
    dueAdded: "बकाया जुड़ा", totalPaid: "कुल पेमेंट", remainingDue: "बाकी बकाया", amountToPayNext: "अगली पेमेंट रकम",
    lastPayment: "पिछला पेमेंट", noPaymentRecorded: "कोई पेमेंट दर्ज नहीं", activity: "हिस्ट्री", referenceMode: "रेफरेंस / तरीका",
    runningBalance: "चालू बैलेंस", accountEntries: "खाते की एंट्री",
    totalRemaining: "कुल बकाया", customerAccount: "कस्टमर का खाता", backToDues: "सभी बकाया पर लौटें",
    ownerMode: "ओनर मोड", ownerOnly: "सिर्फ ओनर", ownerModeOn: "चालू", ownerModeOff: "बंद", ownerModeVisible: "खरीद रेट और प्रॉफिट दिख रहे हैं। स्टाफ को देने से पहले इसे बंद करें।", ownerModeHidden: "बिक्री रेट दिखेंगे; खरीद रेट और प्रॉफिट छिपे रहेंगे।", profitOverview: "लागत और प्रॉफिट", purchaseCost: "खरीद रेट", wholesaleSelling: "होलसेल रेट", profitPerUnit: "प्रति यूनिट प्रॉफिट", grossMargin: "प्रॉफिट मार्जिन", costNotSet: "दर्ज नहीं", sellingTiers: "बिक्री रेट", bulkSelling: "बल्क", retailSelling: "रिटेल",
  },
  bn: {
    bill: "বিল", parties: "পার্টি", dues: "বাকি", items: "আইটেম", misc: "খরচ", reports: "রিপোর্ট", more: "আরও",
    miscellaneous: "দোকানের খরচ", addExpense: "খরচ যোগ করুন", moneyIn: "টাকা এসেছে", moneyOut: "টাকা গেছে", netCashFlow: "নেট ক্যাশ ফ্লো", exportPdf: "PDF ডাউনলোড", exportText: "টেক্সট ডাউনলোড", viewStatement: "স্টেটমেন্ট দেখুন",
    newBill: "নতুন বিল", saleBill: "সেল বিল", quotation: "কোটেশন", newQuotation: "নতুন কোটেশন", quotationSummary: "কোটেশনের সারাংশ", estimateOnly: "শুধু আনুমানিক", estimateHelp: "কোটেশন সেভ করলে কাস্টমারের বাকি, আগের রেট বা স্টক বদলাবে না। কাস্টমার রাজি হলে এটিকে বিলে বদলান।", customer: "কাস্টমার", cashCustomer: "ক্যাশ কাস্টমার", newCustomer: "নতুন কাস্টমার", addManualDue: "বাকি যোগ করুন",
    searchParty: "নাম বা ফোন খুঁজুন", addItem: "আইটেম যোগ করুন",
    searchItem: "নাম, SKU, হিন্দি বা বাংলায় খুঁজুন", recentItems: "সাম্প্রতিক আইটেম",
    qty: "পরিমাণ", quantity: "পরিমাণ", unit: "ইউনিট", rate: "রেট", lastPrice: "আগের রেট", discount: "ছাড়", discountShort: "ছাড়", subtotal: "সাবটোটাল",
    gst: "GST", taxable: "ট্যাক্সযোগ্য", total: "মোট", paid: "জমা", due: "বাকি", roundOff: "রাউন্ড অফ",
    gstOnBill: "ফাইনাল বিলে GST", gstApplied: "সব আইটেমে", gstOff: "বন্ধ",
    customGst: "GST রেট দিন (0 থেকে 25%)", manual: "ম্যানুয়াল", gstRange: "ম্যানুয়াল 0-25%",
    otherCharges: "অন্য চার্জ", chargeHelp: "এই বিলের জন্য দরকারি চার্জই চালু করুন", carrierCharge: "বহন / ট্রান্সপোর্ট", packingCharge: "প্যাকিং চার্জ",
    bigBoxCharge: "বড় বক্সের চার্জ", addCharge: "যোগ করুন", removeCharge: "সরান", chargeAmount: "চার্জের টাকা",
    saveOnly: "শুধু সেভ", savePrint: "সেভ ও প্রিন্ট", saveWhatsapp: "সেভ ও WhatsApp",
    noItems: "বিল শুরু করতে আইটেম যোগ করুন", create: "তৈরি করুন", payment: "পেমেন্ট",
    ledger: "খাতা", offline: "অফলাইন", pending: "পেন্ডিং", synced: "সিঙ্ক হয়েছে",
    syncing: "সিঙ্ক হচ্ছে", fastCounter: "ফাস্ট কাউন্টার", pricesBeforeGst: "GST-এর আগের রেট",
    searchHelp: "আইটেম খুঁজুন। স্টক জানা না থাকলে বা শূন্য হলেও বিক্রি বন্ধ হবে না।",
    amountReceived: "পাওয়া টাকা", via: "মাধ্যমে", fullPayment: "পুরো পেমেন্ট", partialPayment: "পার্ট পেমেন্ট", payLater: "পরে দেবেন", paymentChoice: "এই বিলের পেমেন্ট কীভাবে হবে?", receivedNow: "এখন পাওয়া", addedToDues: "বাকিতে গেছে", balanceAfterBill: "বিলের পর কাস্টমারের বাকি", selectCustomerForDue: "বাকি সেভ করতে কাস্টমার বাছুন", enterPartPayment: "পাওয়া টাকার পরিমাণ দিন", partPaymentLessThan: "পার্ট পেমেন্ট এর চেয়ে কম হতে হবে", chooseFullPayment: "এর বদলে পুরো পেমেন্ট বাছুন।", cash: "ক্যাশ", upi: "UPI", bank: "ব্যাংক", cheque: "চেক",
    credit: "বাকি", udhaar: "বাকি", changeReturn: "ফেরত দিতে হবে", print: "প্রিন্ট", whatsapp: "WhatsApp", quotationTotal: "কোটেশনের মোট", printQuote: "কোটেশন প্রিন্ট করুন", shareQuote: "কোটেশন শেয়ার করুন", saveQuotation: "কোটেশন সেভ করুন",
    saveBill: "বিল সেভ করুন", workspace: "ওয়ার্কস্পেস", counterReady: "কাউন্টার তৈরি",
    offlineReady: "বিলিং অফলাইনেও চলে", customers: "কাস্টমার", suppliers: "সাপ্লায়ার",
    addParty: "পার্টি যোগ করুন", toCollect: "পাওনা", toPay: "দেনা", addDue: "বাকি যোগ করুন",
    supplierBill: "সাপ্লায়ার বিল যোগ করুন", paymentReceived: "পেমেন্ট পাওয়া", paymentPaid: "পেমেন্ট দেওয়া",
    appearance: "থিম", lightMode: "লাইট মোড", darkMode: "ডার্ক মোড",
    dueStatement: "বাকি স্টেটমেন্ট", dueStatementHelp: "সব বিল, যোগ করা বাকি ও পেমেন্ট একই খাতায় দেখুন।",
    dueAdded: "বাকি যোগ হয়েছে", totalPaid: "মোট পেমেন্ট", remainingDue: "বাকি আছে", amountToPayNext: "পরের পেমেন্ট",
    lastPayment: "আগের পেমেন্ট", noPaymentRecorded: "কোনো পেমেন্ট রেকর্ড নেই", activity: "হিস্ট্রি", referenceMode: "রেফারেন্স / মাধ্যম",
    runningBalance: "চলতি ব্যালেন্স", accountEntries: "খাতার এন্ট্রি",
    totalRemaining: "মোট বাকি", customerAccount: "কাস্টমারের খাতা", backToDues: "সব বাকিতে ফিরুন",
    ownerMode: "ওনার মোড", ownerOnly: "শুধু ওনার", ownerModeOn: "চালু", ownerModeOff: "বন্ধ", ownerModeVisible: "কেনার রেট ও লাভ দেখা যাচ্ছে। স্টাফকে দেওয়ার আগে এটি বন্ধ করুন।", ownerModeHidden: "বিক্রির রেট দেখা যাবে; কেনার রেট ও লাভ লুকানো থাকবে।", profitOverview: "খরচ ও লাভ", purchaseCost: "কেনার রেট", wholesaleSelling: "পাইকারি রেট", profitPerUnit: "প্রতি ইউনিটে লাভ", grossMargin: "লাভের হার", costNotSet: "দেওয়া নেই", sellingTiers: "বিক্রির রেট", bulkSelling: "বাল্ক", retailSelling: "খুচরা",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type LabelKey = keyof typeof labels.en;
export const t = (language: Language, key: LabelKey) => labels[language][key];

type InvoicePartySnapshot = {
  partyId?: string;
  partyName: string;
};

export const localizedInvoicePartyName = (
  language: Language,
  invoice: InvoicePartySnapshot,
) => invoice.partyId ? invoice.partyName : t(language, "cashCustomer");
