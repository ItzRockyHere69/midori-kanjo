import { db, type Category, type Item, type Party, type PartyItemPrice } from "./db";

const stamp = "2026-08-08T09:00:00.000Z";

const category = (id: string, name: string, festivalSeason: string[]): Category => ({
  id,
  name,
  festivalSeason,
  createdAt: stamp,
  updatedAt: stamp,
  isSynced: false,
});

export const sampleCategories: Category[] = [
  category("cat-uncategorized", "Uncategorized", []),
  category("cat-mala", "Moti Mala", ["durga_puja", "kali_puja", "wedding"]),
  category("cat-puja", "Puja Decor", ["durga_puja", "kali_puja", "saraswati_puja", "lakshmi_puja"]),
  category("cat-diwali", "Diwali Lights & Torans", ["diwali", "kali_puja"]),
  category("cat-christmas", "Christmas Decor", ["christmas"]),
  category("cat-birthday", "Birthday Items", ["birthday"]),
  category("cat-patriotic", "Independence Day / Patriotic", ["independence_day", "republic_day"]),
  category("cat-wedding", "Wedding Decor", ["wedding"]),
  category("cat-party", "Balloons & Party Supplies", ["birthday", "wedding"]),
];

const item = (
  id: string,
  name: string,
  nameHi: string,
  nameBn: string,
  skuCode: string,
  categoryId: string,
  baseUnit: Item["baseUnit"],
  purchasePrice: number,
  wholesale: number,
  retail: number,
  festivalTags: string[],
  saleCount = 0
): Item => ({
  id, name, nameHi, nameBn, skuCode, categoryId, baseUnit,
  conversionRate: baseUnit === "gross" ? 12 : 1,
  purchasePrice,
  priceRetail: retail,
  priceWholesale: wholesale,
  priceBulk: wholesale,
  currentStock: null,
  lowStockAlert: null,
  festivalTags,
  hsnCode: "",
  gstRate: 0,
  isActive: true,
  saleCount,
  lastSoldDate: saleCount ? "2026-08-01" : undefined,
  createdAt: stamp,
  updatedAt: stamp,
  isSynced: false
});

export const sampleItems: Item[] = [
  item("i-mm12-red", "Moti Mala 12 inch Red", "मोती माला 12 इंच लाल", "মোতি মালা ১২ ইঞ্চি লাল", "MM-12-RED", "cat-mala", "dozen", 220, 280, 350, ["durga_puja", "wedding"], 18),
  item("i-mm12-gold", "Moti Mala 12 inch Gold", "मोती माला 12 इंच सुनहरी", "মোতি মালা ১২ ইঞ্চি সোনালি", "MM-12-GLD", "cat-mala", "dozen", 240, 300, 380, ["durga_puja", "diwali", "wedding"], 22),
  item("i-mm18-red", "Moti Mala 18 inch Red", "मोती माला 18 इंच लाल", "মোতি মালা ১৮ ইঞ্চি লাল", "MM-18-RED", "cat-mala", "dozen", 300, 380, 460, ["durga_puja", "kali_puja"], 14),
  item("i-mm18-silver", "Moti Mala 18 inch Silver", "मोती माला 18 इंच चांदी", "মোতি মালা ১৮ ইঞ্চি রূপালি", "MM-18-SLV", "cat-mala", "dozen", 310, 390, 470, ["durga_puja", "wedding"], 15),
  item("i-toran", "Toran Diwali Standard", "दिवाली तोरण स्टैंडर्ड", "দীপাবলি তোরণ স্ট্যান্ডার্ড", "DL-TOR-STD", "cat-diwali", "piece", 35, 55, 75, ["diwali"], 16),
  item("i-diya", "Diya Set (12pc)", "दीया सेट (12 पीस)", "প্রদীপ সেট (১২টি)", "DL-DIYA-12", "cat-diwali", "packet", 40, 60, 90, ["diwali", "kali_puja"], 13),
  item("i-tree2", "Christmas Tree 2ft", "क्रिसमस ट्री 2 फीट", "ক্রিসমাস ট্রি ২ ফুট", "XM-TREE-2FT", "cat-christmas", "piece", 150, 220, 300, ["christmas"], 8),
  item("i-snow", "Snow Spray Small", "स्नो स्प्रे छोटा", "স্নো স্প্রে ছোট", "XM-SNOW-S", "cat-christmas", "piece", 28, 40, 55, ["christmas"], 9),
  item("i-balloon-pack", "Balloon Pack Happy Birthday (50pc)", "हैप्पी बर्थडे बैलून पैक (50 पीस)", "হ্যাপি বার্থডে বেলুন প্যাক (৫০টি)", "BP-BAL-HB50", "cat-party", "packet", 70, 100, 140, ["birthday"], 21),
  item("i-party-hat", "Birthday Party Hat Set (10pc)", "बर्थडे पार्टी हैट सेट (10 पीस)", "বার্থডে পার্টি হ্যাট সেট (১০টি)", "BD-HAT-10", "cat-birthday", "packet", 35, 55, 80, ["birthday"], 12),
  item("i-flag-small", "India Flag Small (per dozen)", "भारत झंडा छोटा (प्रति दर्जन)", "ভারতের ছোট পতাকা (প্রতি ডজন)", "IN-FLAG-S12", "cat-patriotic", "dozen", 90, 130, 180, ["independence_day", "republic_day"], 11),
  item("i-bunting", "Tricolour Bunting 10m", "तिरंगा बंटिंग 10 मीटर", "তিরঙ্গা বান্টিং ১০ মিটার", "IN-BUNT-10M", "cat-patriotic", "piece", 60, 90, 130, ["independence_day", "republic_day"], 10),
  item("i-rangoli-powder", "Rangoli Powder Set", "रंगोली पाउडर सेट", "রঙ্গোলি পাউডার সেট", "PU-RANG-SET", "cat-puja", "packet", 25, 40, 60, ["diwali", "lakshmi_puja"], 13),
  item("i-wedding-flower", "Wedding Backdrop Flower Strip", "वेडिंग बैकड्रॉप फूल स्ट्रिप", "বিয়ের ব্যাকড্রপ ফুলের স্ট্রিপ", "WD-FLW-BDL", "cat-wedding", "bundle", 180, 260, 340, ["wedding"], 7)
];

const party = (id: string, name: string, priceTier: Party["priceTier"], note: string, tags: string[], type: Party["type"] = "customer"): Party => ({
  id,
  name,
  codeName: `${type === "supplier" ? "SUP" : "CUS"}-${id.replace(/^[ps]-/,"").replace(/[^a-z0-9]/gi,"-").toUpperCase()}`,
  phone: "",
  address: "Kolkata, West Bengal",
  type,
  priceTier,
  openingBalance: 0,
  currentBalance: 0,
  notes: note,
  tags,
  createdAt: stamp,
  updatedAt: stamp,
  isSynced: false
});

export const sampleParties: Party[] = [
  party("p-ramesh", "Ramesh Decorators", "wholesale", "Regular buyer", ["regular_buyer", "decorator"]),
  party("p-bagbazar", "Bagbazar Puja Committee", "bulk", "Seasonal only", ["seasonal_only", "puja_committee"]),
  party("p-shubho", "Shubho Event Solutions", "wholesale", "Regular buyer", ["regular_buyer", "event_organiser"]),
  party("p-kolkata-balloon", "Kolkata Balloon House", "wholesale", "Regular buyer", ["regular_buyer", "birthday"]),
  party("p-walk-in", "Walk-in Retail Customer", "retail", "Walk-in retail customer", ["walk_in"]),
  party("p-howrah-mela", "Howrah Mela Traders", "bulk", "Seasonal only", ["seasonal_only", "mela_trader"])
];

export const sampleSuppliers: Party[] = [
  party("s-gupta-imports", "Gupta Festival Imports", "wholesale", "Mala and puja decor supplier", ["supplier", "mala"], "supplier"),
  party("s-roy-lighting", "Roy Lighting & Torans", "wholesale", "Diwali lighting supplier", ["supplier", "diwali"], "supplier")
];

export const samplePrices: PartyItemPrice[] = [
  { id: "p-ramesh::i-mm12-red", partyId: "p-ramesh", itemId: "i-mm12-red", lastPrice: 275, lastSoldDate: "2026-08-01", timesSold: 9, lockedPrice: false, updatedAt: stamp, isSynced: false },
  { id: "p-shubho::i-mm12-red", partyId: "p-shubho", itemId: "i-mm12-red", lastPrice: 285, lastSoldDate: "2026-07-29", timesSold: 6, lockedPrice: false, updatedAt: stamp, isSynced: false },
  { id: "p-bagbazar::i-toran", partyId: "p-bagbazar", itemId: "i-toran", lastPrice: 50, lastSoldDate: "2025-10-08", timesSold: 4, lockedPrice: false, updatedAt: stamp, isSynced: false },
  { id: "p-kolkata-balloon::i-balloon-pack", partyId: "p-kolkata-balloon", itemId: "i-balloon-pack", lastPrice: 95, lastSoldDate: "2026-07-31", timesSold: 12, lockedPrice: true, updatedAt: stamp, isSynced: false }
];

export async function seedIfNeeded() {
  if (await db.meta.get("seeded-v3")) return;
  await db.transaction("rw", [db.categories, db.items, db.parties, db.partyItemPrices, db.meta], async () => {
    const parties = [...sampleParties, ...sampleSuppliers];
    const [existingCategories, existingItems, existingParties, existingPrices] = await Promise.all([
      db.categories.bulkGet(sampleCategories.map((entry) => entry.id)),
      db.items.bulkGet(sampleItems.map((entry) => entry.id)),
      db.parties.bulkGet(parties.map((entry) => entry.id)),
      db.partyItemPrices.bulkGet(samplePrices.map((entry) => entry.id)),
    ]);

    // Seed upgrades must be additive. These rows are editable business data
    // after first launch, so replacing a matching seed ID would erase the
    // owner's catalogue, contact, balance or negotiated-price changes.
    await db.categories.bulkAdd(sampleCategories.filter((_, index) => !existingCategories[index]));
    await db.items.bulkAdd(sampleItems.filter((_, index) => !existingItems[index]));
    await db.parties.bulkAdd(parties.filter((_, index) => !existingParties[index]));
    await db.partyItemPrices.bulkAdd(samplePrices.filter((_, index) => !existingPrices[index]));
    await db.meta.put({ key: "seeded-v1", value: true });
    await db.meta.put({ key: "seeded-v2", value: true });
    await db.meta.put({ key: "seeded-v3", value: true });
    if (!(await db.meta.get("invoice-counter"))) await db.meta.put({ key: "invoice-counter", value: 1001 });
  });
}
