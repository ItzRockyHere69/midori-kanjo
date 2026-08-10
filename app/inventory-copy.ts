import type { Language } from "../lib/db";

export const inventoryText = (
  language: Language,
  en: string,
  hi: string,
  bn: string,
) => language === "hi" ? hi : language === "bn" ? bn : en;

export const inventoryLabels = (language: Language) => ({
  eyebrow: inventoryText(language, "Inventory control", "स्टॉक नियंत्रण", "স্টক নিয়ন্ত্রণ"),
  title: inventoryText(language, "Inventory", "इन्वेंटरी", "ইনভেন্টরি"),
  helper: inventoryText(language, "Every change is logged. Billing never stops for low or unknown stock.", "हर बदलाव दर्ज होता है। कम या अनजान स्टॉक से बिलिंग कभी नहीं रुकती।", "প্রতিটি পরিবর্তন লেখা থাকে। কম বা অজানা স্টকের জন্য বিলিং কখনও থামে না।"),
  backItems: inventoryText(language, "Back to products", "प्रोडक्ट पर वापस", "পণ্যে ফিরে যান"),
  inward: inventoryText(language, "Stock inward", "स्टॉक अंदर", "স্টক ইন"),
  outward: inventoryText(language, "Stock outward", "स्टॉक बाहर", "স্টক আউট"),
  saleReturn: inventoryText(language, "Sales return", "बिक्री वापसी", "বিক্রি ফেরত"),
  purchaseReturn: inventoryText(language, "Purchase return", "खरीद वापसी", "কেনা ফেরত"),
  adjustment: inventoryText(language, "Set actual stock", "असल स्टॉक सेट करें", "আসল স্টক সেট করুন"),
  count: inventoryText(language, "Physical count", "फिजिकल गिनती", "হাতে গোনা"),
  history: inventoryText(language, "Movement history", "स्टॉक इतिहास", "স্টক ইতিহাস"),
  lowStock: inventoryText(language, "Low stock", "कम स्टॉक", "কম স্টক"),
  valuation: inventoryText(language, "Stock value", "स्टॉक मूल्य", "স্টকের মূল্য"),
  known: inventoryText(language, "Known", "मालूम", "জানা"),
  unknown: inventoryText(language, "Unknown", "अनजान", "অজানা"),
  negative: inventoryText(language, "Negative", "नेगेटिव", "ঋণাত্মক"),
  save: inventoryText(language, "Save", "सेव करें", "সেভ করুন"),
  saving: inventoryText(language, "Saving…", "सेव हो रहा है…", "সেভ হচ্ছে…"),
  product: inventoryText(language, "Product", "प्रोडक्ट", "পণ্য"),
  quantity: inventoryText(language, "Quantity", "मात्रा", "পরিমাণ"),
  unit: inventoryText(language, "Unit", "यूनिट", "একক"),
  date: inventoryText(language, "Date", "तारीख", "তারিখ"),
  note: inventoryText(language, "Note", "नोट", "নোট"),
  reason: inventoryText(language, "Reason", "कारण", "কারণ"),
  ownerOnly: inventoryText(language, "Owner only", "सिर्फ ओनर", "শুধু ওনার"),
  noRows: inventoryText(language, "Nothing to show yet.", "अभी कुछ नहीं है।", "এখনও কিছু নেই।"),
  syncedLater: inventoryText(language, "Saved offline. Cloud backup will follow when available.", "ऑफलाइन सेव हुआ। इंटरनेट मिलने पर क्लाउड बैकअप होगा।", "অফলাইনে সেভ হয়েছে। ইন্টারনেট এলে ক্লাউড ব্যাকআপ হবে।"),
});
