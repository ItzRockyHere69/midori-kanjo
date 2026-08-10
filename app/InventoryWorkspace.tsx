"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  localDate,
  makeId,
  type Category,
  type CountLine,
  type Invoice,
  type Item,
  type Language,
  type Party,
  type Unit,
} from "../lib/db";
import { formatMoney } from "../lib/billing";
import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  localizedCategoryName,
  localizedItemName,
  localizedUnitName,
} from "../lib/i18n";
import {
  buildInventoryValuation,
  commitCountSession,
  itemMovementHistory,
  lowStockItems,
  recordInventoryReturn,
  recordStockInward,
  recordStockOutward,
  reviewCountSession,
  saveCountedStock,
  setStockAbsolute,
  startCountSession,
  type CountReviewRow,
} from "../lib/inventory";
import { AccessibleSheet } from "./AccessibleDialog";
import { inventoryLabels, inventoryText } from "./inventory-copy";

export type InventoryRoute =
  | { page: "hub" }
  | { page: "count"; sessionId?: string; reviewOpen?: boolean }
  | { page: "lowStock" }
  | { page: "valuation" }
  | { page: "history"; itemId?: string };

export type InventoryOverlay =
  | "inward"
  | "outward"
  | "saleReturn"
  | "purchaseReturn"
  | "adjustment"
  | null;

type CommonProps = {
  language: Language;
  items: Item[];
  parties: Party[];
  invoices: Invoice[];
  categories: Category[];
  ownerMode: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
  onRequestOwner: (resume: () => void) => void;
  onCreateProduct?: () => void;
  preferredItemId?: string;
  allItems?: Item[];
};

const units: Unit[] = ["piece", "dozen", "gross", "bundle", "box", "packet"];

function stockState(item: Item) {
  if (item.currentStock === null) return "unknown" as const;
  if (item.currentStock < 0) return "negative" as const;
  return "known" as const;
}

function stockLabel(item: Item, language: Language) {
  if (item.currentStock === null) return inventoryText(language, "Unknown", "अनजान", "অজানা");
  return `${item.currentStock} ${localizedUnitName(language, item.baseUnit)}`;
}

function inventoryFailure(language: Language, cause: unknown, english: string, hindi: string, bengali: string) {
  return language === "en" && cause instanceof Error
    ? cause.message
    : inventoryText(language, english, hindi, bengali);
}

function itemDisplayName(items: Item[], itemId: string, fallback: string, language: Language) {
  const item = items.find((entry) => entry.id === itemId);
  return item ? localizedItemName(language, item) : fallback;
}

function movementReasonLabel(language: Language, reason: string) {
  const known: Record<string, [string, string, string]> = {
    purchase_receipt: ["Purchase receipt", "खरीद रसीद", "কেনার রসিদ"],
    inward: ["Stock inward", "स्टॉक आवक", "স্টক ইন"],
    damage: ["Damage", "नुकसान", "নষ্ট"],
    sample: ["Sample", "सैंपल", "নমুনা"],
    internal_use: ["Internal use", "दुकान में इस्तेमाल", "দোকানে ব্যবহার"],
    manual_adjustment: ["Manual adjustment", "मैनुअल मिलान", "ম্যানুয়াল সমন্বয়"],
    count_adjustment: ["Count adjustment", "गिनती का मिलान", "গোনার সমন্বয়"],
    sale: ["Sale", "बिक्री", "বিক্রি"],
    sale_return: ["Sales return", "सेल्स रिटर्न", "বিক্রয় ফেরত"],
    purchase_return: ["Purchase return", "खरीद रिटर्न", "কেনা ফেরত"],
    sale_void: ["Deleted sale reversal", "हटाए बिल की वापसी", "মুছে-দেওয়া বিক্রির উল্টো এন্ট্রি"],
    sale_restore: ["Restored sale", "बहाल बिक्री", "ফেরানো বিক্রি"],
    item_merge: ["Product merge", "प्रोडक्ट मर्ज", "পণ্য মার্জ"],
  };
  const label = known[reason];
  return label ? inventoryText(language, ...label) : reason.replaceAll("_", " ");
}

function ErrorNote({ value }: { value: string }) {
  return value ? <p role="alert" className="inventory-error">{value}</p> : null;
}

function FormActions({ busy, label, onCancel, language }: { busy: boolean; label: string; onCancel: () => void; language: Language }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2">
      <button type="button" className="counter-secondary" onClick={onCancel} disabled={busy}>
        {inventoryText(language, "Cancel", "रद्द करें", "বাতিল")}
      </button>
      <button type="submit" className="counter-primary" disabled={busy}>
        {busy ? inventoryText(language, "Saving…", "सेव हो रहा है…", "সেভ হচ্ছে…") : label}
      </button>
    </div>
  );
}

function ProductSelect({ items, language, value, onChange }: { items: Item[]; language: Language; value: string; onChange: (value: string) => void }) {
  const copy = inventoryLabels(language);
  return (
    <label className="product-field">
      <span>{copy.product}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="">— {copy.product} —</option>
        {items.map((item) => <option key={item.id} value={item.id}>{localizedItemName(language, item)} · {stockLabel(item, language)}</option>)}
      </select>
    </label>
  );
}

function UnitSelect({ language, value, onChange, allowed = units }: { language: Language; value: Unit; onChange: (value: Unit) => void; allowed?: Unit[] }) {
  return (
    <label className="product-field">
      <span>{inventoryLabels(language).unit}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as Unit)}>
        {allowed.map((unit) => <option key={unit} value={unit}>{localizedUnitName(language, unit)}</option>)}
      </select>
    </label>
  );
}

function InwardSheet(props: CommonProps) {
  const { language, items, parties, ownerMode, onClose, onChanged, onRequestOwner, onCreateProduct, preferredItemId } = props;
  const copy = inventoryLabels(language);
  const preferredItem = preferredItemId ? items.find((item) => item.id === preferredItemId) : undefined;
  const [selectedItemId, setSelectedItemId] = useState("");
  const itemId = selectedItemId || preferredItem?.id || "";
  const [entryMode, setEntryMode] = useState<"quantity" | "pack">("quantity");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit | null>(null);
  const [packCount, setPackCount] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("");
  const [containedUnit, setContainedUnit] = useState<Unit | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [date, setDate] = useState(localDate());
  const [note, setNote] = useState("");
  const [startFromZero, setStartFromZero] = useState(false);
  const [operationId] = useState(() => makeId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = items.find((item) => item.id === itemId);
  const entryUnit = unit || selected?.baseUnit || "piece";
  const packUnit = containedUnit || selected?.baseUnit || "piece";

  function selectItem(nextId: string) {
    setSelectedItemId(nextId);
    setStartFromZero(false);
    const next = items.find((item) => item.id === nextId);
    if (next) {
      setUnit(next.baseUnit);
      setContainedUnit(next.baseUnit);
    }
  }

  async function persist(asOwner: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await recordStockInward({
        operationId,
        itemId,
        ...(entryMode === "pack"
          ? { packCount: Number(packCount), unitsPerPack: Number(unitsPerPack), containedUnit: packUnit }
          : { quantity: Number(quantity), unit: entryUnit }),
        supplierId: supplierId || undefined,
        supplierReference,
        purchasePrice: purchasePrice === "" ? undefined : Number(purchasePrice),
        date,
        note,
        startFromZero,
        actor: asOwner ? "owner" : "staff",
      });
      onChanged(copy.syncedLater);
      onClose();
    } catch (cause) {
      setError(inventoryFailure(language, cause, "Could not save this receipt.", "यह रसीद सेव नहीं हुई।", "এই রসিদ সেভ হয়নি।"));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const needsOwner = (startFromZero && selected?.currentStock === null) || purchasePrice !== "";
    if (needsOwner && !ownerMode) {
      onRequestOwner(() => void persist(true));
      return;
    }
    void persist(ownerMode);
  }

  return (
    <AccessibleSheet title={copy.inward} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <ProductSelect items={items} language={language} value={itemId} onChange={selectItem} />
        {onCreateProduct && <button type="button" className="counter-secondary" onClick={onCreateProduct}>＋ {inventoryText(language, "Create a new product", "नया प्रोडक्ट बनाएँ", "নতুন পণ্য বানান")}</button>}
        {selected && <p data-stock-state={stockState(selected)} className="inventory-stock-note">{stockLabel(selected, language)}</p>}
        <div className="item-catalogue-tabs" role="group" aria-label={inventoryText(language, "Entry type", "एंट्री का प्रकार", "এন্ট্রির ধরন")}>
          <button type="button" aria-pressed={entryMode === "quantity"} onClick={() => setEntryMode("quantity")}>{copy.quantity}</button>
          <button type="button" aria-pressed={entryMode === "pack"} onClick={() => setEntryMode("pack")}>{inventoryText(language, "Carton / pack", "कार्टन / पैक", "কার্টন / প্যাক")}</button>
        </div>
        {entryMode === "quantity" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="product-field"><span>{copy.quantity}</span><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
            <UnitSelect language={language} value={entryUnit} onChange={setUnit} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="product-field"><span>{inventoryText(language, "Pack count", "पैक की संख्या", "প্যাক সংখ্যা")}</span><input inputMode="decimal" value={packCount} onChange={(event) => setPackCount(event.target.value)} required /></label>
            <label className="product-field"><span>{inventoryText(language, "Units per pack", "हर पैक में मात्रा", "প্রতি প্যাকে পরিমাণ")}</span><input inputMode="decimal" value={unitsPerPack} onChange={(event) => setUnitsPerPack(event.target.value)} required /></label>
            <UnitSelect language={language} value={packUnit} onChange={setContainedUnit} />
          </div>
        )}
        {selected?.currentStock === null && (
          <label className="inventory-check-row">
            <input type="checkbox" checked={startFromZero} onChange={(event) => setStartFromZero(event.target.checked)} />
            <span>{inventoryText(language, "Owner: start unknown stock from zero, then add this receipt", "ओनर: अनजान स्टॉक को शून्य से शुरू करके यह रसीद जोड़ें", "ওনার: অজানা স্টক শূন্য থেকে শুরু করে এই রসিদ যোগ করুন")}</span>
          </label>
        )}
        {selected?.currentStock === null && !startFromZero && <p className="inventory-warning">{inventoryText(language, "The receipt will be logged, but stock stays Unknown until it is counted.", "रसीद दर्ज होगी, लेकिन गिनती होने तक स्टॉक अनजान रहेगा।", "রসিদ লেখা হবে, তবে গোনা না-হওয়া পর্যন্ত স্টক অজানা থাকবে।")}</p>}
        <label className="product-field"><span>{inventoryText(language, "Supplier (optional)", "सप्लायर (वैकल्पिक)", "সাপ্লায়ার (ঐচ্ছিক)")}</span><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">—</option>{parties.filter((party) => party.type === "supplier").map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="product-field"><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label className="product-field"><span>{inventoryText(language, "Supplier reference", "सप्लायर रेफरेंस", "সাপ্লায়ার রেফারেন্স")}</span><input value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} /></label>
        </div>
        <label className="product-field"><span>{copy.ownerOnly} · {inventoryText(language, "Purchase cost per base unit (optional)", "बेस यूनिट की खरीद लागत (वैकल्पिक)", "বেস ইউনিটের কেনা দাম (ঐচ্ছিক)")}</span><input inputMode="decimal" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} /></label>
        <label className="product-field"><span>{copy.note}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <ErrorNote value={error} />
        <FormActions busy={busy} label={copy.save} onCancel={onClose} language={language} />
      </form>
    </AccessibleSheet>
  );
}

function OutwardSheet(props: CommonProps) {
  const { language, items, onClose, onChanged } = props;
  const copy = inventoryLabels(language);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit>("piece");
  const [reason, setReason] = useState<"damage" | "sample" | "internal_use" | "other">("damage");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(localDate());
  const [operationId] = useState(() => makeId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = items.find((item) => item.id === itemId);
  function selectItem(nextId: string) {
    setItemId(nextId);
    const next = items.find((item) => item.id === nextId);
    if (next) setUnit(next.baseUnit);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await recordStockOutward({ operationId, itemId, quantity: Number(quantity), unit, reason, note, date, actor: "staff" });
      onChanged(copy.syncedLater); onClose();
    } catch (cause) { setError(inventoryFailure(language, cause, "Could not save stock out.", "स्टॉक बाहर की एंट्री सेव नहीं हुई।", "স্টক আউট সেভ হয়নি।")); }
    finally { setBusy(false); }
  }
  return (
    <AccessibleSheet title={copy.outward} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <ProductSelect items={items} language={language} value={itemId} onChange={selectItem} />
        {selected && <p data-stock-state={stockState(selected)} className="inventory-stock-note">{stockLabel(selected, language)}</p>}
        <div className="grid grid-cols-2 gap-3"><label className="product-field"><span>{copy.quantity}</span><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label><UnitSelect language={language} value={unit} onChange={setUnit} /></div>
        <label className="product-field"><span>{copy.reason}</span><select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}><option value="damage">{inventoryText(language, "Damage", "नुकसान", "নষ্ট")}</option><option value="sample">{inventoryText(language, "Sample", "सैंपल", "নমুনা")}</option><option value="internal_use">{inventoryText(language, "Internal use", "दुकान में इस्तेमाल", "দোকানে ব্যবহার")}</option><option value="other">{inventoryText(language, "Other", "दूसरा", "অন্য")}</option></select></label>
        <label className="product-field"><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label className="product-field"><span>{copy.note}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} required={reason === "other"} /></label>
        <ErrorNote value={error} /><FormActions busy={busy} label={copy.save} onCancel={onClose} language={language} />
      </form>
    </AccessibleSheet>
  );
}

function AdjustmentSheet(props: CommonProps) {
  const { language, items, ownerMode, onClose, onChanged, onRequestOwner } = props;
  const copy = inventoryLabels(language);
  const [itemId, setItemId] = useState("");
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(localDate());
  const [operationId] = useState(() => makeId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = items.find((item) => item.id === itemId);
  async function persist() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await setStockAbsolute({ operationId, itemId, actualStock: Number(actual), reason, date, actor: "owner" });
      onChanged(copy.syncedLater); onClose();
    } catch (cause) { setError(inventoryFailure(language, cause, "Could not adjust stock.", "स्टॉक का मिलान सेव नहीं हुआ।", "স্টকের সমন্বয় সেভ হয়নি।")); }
    finally { setBusy(false); }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ownerMode) return onRequestOwner(() => void persist());
    void persist();
  }
  return (
    <AccessibleSheet title={copy.adjustment} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <p className="owner-mode-badge w-fit">{copy.ownerOnly}</p>
        <ProductSelect items={items} language={language} value={itemId} onChange={setItemId} />
        {selected && <p data-stock-state={stockState(selected)} className="inventory-stock-note">{inventoryText(language, "Before", "पहले", "আগে")}: {stockLabel(selected, language)}</p>}
        <label className="product-field"><span>{inventoryText(language, "Actual counted stock", "असल गिना हुआ स्टॉक", "আসল গোনা স্টক")}</span><input inputMode="decimal" value={actual} onChange={(event) => setActual(event.target.value)} required /></label>
        <label className="product-field"><span>{copy.reason}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
        <label className="product-field"><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <ErrorNote value={error} /><FormActions busy={busy} label={copy.save} onCancel={onClose} language={language} />
      </form>
    </AccessibleSheet>
  );
}

function ReturnSheet(props: CommonProps & { type: "sale_return" | "purchase_return" }) {
  const { language, items, parties, invoices, type, onClose, onChanged } = props;
  const copy = inventoryLabels(language);
  const isSale = type === "sale_return";
  const [partyId, setPartyId] = useState("");
  const [sourceInvoiceId, setSourceInvoiceId] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [itemId, setItemId] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [manualUnit, setManualUnit] = useState<Unit>("piece");
  const [manualRate, setManualRate] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "bank" | "cheque">("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(localDate());
  const [operationId] = useState(() => makeId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const partyType = isSale ? "customer" : "supplier";
  const primaryType = isSale ? "sale" : "purchase";
  const sourceCandidates = invoices.filter((invoice) =>
    !invoice.deletedAt && invoice.type === primaryType &&
    (partyId ? invoice.partyId === partyId : isSale && !invoice.partyId),
  );
  const source = sourceCandidates.find((invoice) => invoice.id === sourceInvoiceId);

  function selectParty(nextPartyId: string) {
    setPartyId(nextPartyId);
    setSourceInvoiceId("");
    setQuantities({});
  }

  function selectManualItem(nextItemId: string) {
    setItemId(nextItemId);
    const next = items.find((item) => item.id === nextItemId);
    if (next) setManualUnit(next.baseUnit);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const lines = source
      ? source.lineItems.flatMap((line, index) => Number(quantities[index]) > 0 ? [{ sourceLineIndex: index, qty: Number(quantities[index]), unit: line.unit }] : [])
      : [{ itemId, qty: Number(manualQty), unit: manualUnit, rate: Number(manualRate) }];
    setBusy(true); setError("");
    try {
      const result = await recordInventoryReturn({
        type,
        partyId: partyId || undefined,
        sourceInvoiceId: source?.id,
        lines,
        settlementMode: mode,
        settlementReference: reference,
        notes,
        date,
        actor: "staff",
        idempotencyKey: operationId,
      });
      onChanged(inventoryText(language, `${result.invoiceNumber} saved. Balance credit ₹${result.returnDetails?.balanceApplied || 0}; immediate settlement ₹${result.returnDetails?.settlementAmount || 0}.`, `${result.invoiceNumber} सेव हुआ। बैलेंस क्रेडिट ₹${result.returnDetails?.balanceApplied || 0}; तुरंत सेटलमेंट ₹${result.returnDetails?.settlementAmount || 0}।`, `${result.invoiceNumber} সেভ হয়েছে। ব্যালেন্স ক্রেডিট ₹${result.returnDetails?.balanceApplied || 0}; সঙ্গে সঙ্গে মেটানো ₹${result.returnDetails?.settlementAmount || 0}।`));
      onClose();
    } catch (cause) { setError(inventoryFailure(language, cause, "Could not save return.", "रिटर्न सेव नहीं हुआ।", "ফেরত সেভ হয়নি।")); }
    finally { setBusy(false); }
  }

  return (
    <AccessibleSheet title={isSale ? copy.saleReturn : copy.purchaseReturn} onClose={onClose} panelClassName="max-w-2xl">
      <form onSubmit={submit} className="grid gap-3">
        <label className="product-field"><span>{isSale ? inventoryText(language, "Customer (leave blank for a cash bill)", "कस्टमर (कैश बिल के लिए खाली छोड़ें)", "কাস্টমার (ক্যাশ বিল হলে ফাঁকা রাখুন)") : inventoryText(language, "Supplier", "सप्लायर", "সাপ্লায়ার")}</span><select value={partyId} onChange={(event) => selectParty(event.target.value)} required={!isSale}><option value="">{isSale ? inventoryText(language, "Cash customer", "कैश कस्टमर", "ক্যাশ কাস্টমার") : "—"}</option>{parties.filter((party) => party.type === partyType).map((party) => <option key={party.id} value={party.id}>{party.name} · {formatMoney(party.currentBalance)}</option>)}</select></label>
        <label className="product-field"><span>{inventoryText(language, "Original bill (recommended)", "मूल बिल (बेहतर)", "আসল বিল (প্রস্তাবিত)")}</span><select value={sourceInvoiceId} onChange={(event) => { setSourceInvoiceId(event.target.value); setQuantities({}); }}><option value="">{inventoryText(language, "Manual return", "मैनुअल रिटर्न", "ম্যানুয়াল ফেরত")}</option>{sourceCandidates.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {formatLocalizedDate(invoice.date, language)} · {formatMoney(invoice.grandTotal)}</option>)}</select></label>
        {source ? (
          <div className="grid gap-2">
            {source.lineItems.map((line, index) => { const displayName = itemDisplayName(items, line.itemId, line.itemName, language); return <label key={`${line.itemId}-${index}`} className="inventory-return-line"><span><strong>{displayName}</strong><small>{line.qty} {localizedUnitName(language, line.unit)} · {formatMoney(line.rate)}</small></span><input aria-label={`${displayName} ${copy.quantity}`} inputMode="decimal" placeholder="0" value={quantities[index] || ""} onChange={(event) => setQuantities({ ...quantities, [index]: event.target.value })} /></label>; })}
          </div>
        ) : (
          <div className="grid gap-3">
            <ProductSelect items={items} language={language} value={itemId} onChange={selectManualItem} />
            <div className="grid gap-3 sm:grid-cols-3"><label className="product-field"><span>{copy.quantity}</span><input inputMode="decimal" value={manualQty} onChange={(event) => setManualQty(event.target.value)} required /></label><UnitSelect language={language} value={manualUnit} onChange={setManualUnit} /><label className="product-field"><span>{inventoryText(language, "Rate ₹", "रेट ₹", "দর ₹")}</span><input inputMode="decimal" value={manualRate} onChange={(event) => setManualRate(event.target.value)} required /></label></div>
          </div>
        )}
        <p className="inventory-warning">{inventoryText(language, "The return reduces outstanding balance first. Any excess is recorded as an immediate refund or receipt; balances never go below zero.", "रिटर्न पहले बाकी बैलेंस घटाता है। ज्यादा रकम तुरंत रिफंड या प्राप्ति के रूप में दर्ज होती है; बैलेंस शून्य से नीचे नहीं जाता।", "ফেরত আগে বাকি ব্যালেন্স কমায়। অতিরিক্ত টাকা সঙ্গে সঙ্গে রিফান্ড বা প্রাপ্তি হিসেবে লেখা হয়; ব্যালেন্স শূন্যের নিচে যায় না।")}</p>
        <div className="grid grid-cols-2 gap-3"><label className="product-field"><span>{inventoryText(language, "Settlement method", "सेटलमेंट तरीका", "মেটানোর পদ্ধতি")}</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="cash">{inventoryText(language, "Cash", "कैश", "নগদ")}</option><option value="upi">UPI</option><option value="bank">{inventoryText(language, "Bank", "बैंक", "ব্যাঙ্ক")}</option><option value="cheque">{inventoryText(language, "Cheque", "चेक", "চেক")}</option></select></label><label className="product-field"><span>{inventoryText(language, "Reference", "रेफरेंस", "রেফারেন্স")}</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label></div>
        <label className="product-field"><span>{copy.date}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label className="product-field"><span>{copy.note}</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <ErrorNote value={error} /><FormActions busy={busy} label={copy.save} onCancel={onClose} language={language} />
      </form>
    </AccessibleSheet>
  );
}

function CountWorkspace({ language, items, categories, route, ownerMode, onRoute, onChanged, onRequestOwner }: Pick<CommonProps, "language" | "items" | "categories" | "ownerMode" | "onChanged" | "onRequestOwner"> & { route: Extract<InventoryRoute, { page: "count" }>; onRoute: (route: InventoryRoute) => void }) {
  const copy = inventoryLabels(language);
  const sessions = useLiveQuery(() => db.countSessions.orderBy("updatedAt").reverse().toArray(), [], []);
  const session = sessions.find((entry) => entry.id === route.sessionId);
  const lines = useLiveQuery(() => route.sessionId ? db.countLines.where("sessionId").equals(route.sessionId).toArray() : Promise.resolve([] as CountLine[]), [route.sessionId], []);
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [review, setReview] = useState<CountReviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const counted = lines.filter((line) => line.countedStock !== null).length;

  async function begin() {
    setBusy(true); setError("");
    try { const next = await startCountSession(categoryId); onRoute({ page: "count", sessionId: next.id }); }
    catch (cause) { setError(inventoryFailure(language, cause, "Could not start count.", "गिनती शुरू नहीं हुई।", "গোনা শুরু হয়নি।")); }
    finally { setBusy(false); }
  }
  async function saveLine(line: CountLine) {
    const raw = drafts[line.itemId] ?? (line.countedStock === null ? "" : String(line.countedStock));
    try { await saveCountedStock(line.sessionId, line.itemId, raw === "" ? null : Number(raw)); setReview(null); }
    catch (cause) { setError(inventoryFailure(language, cause, "Could not save count.", "गिनती सेव नहीं हुई।", "গোনা সেভ হয়নি।")); }
  }
  async function openReview() {
    setBusy(true); setError("");
    try {
      const result = await reviewCountSession(session!.id);
      setReview(result.rows);
      onRoute({ ...route, reviewOpen: true });
    }
    catch (cause) { setError(inventoryFailure(language, cause, "Could not review count.", "गिनती की समीक्षा नहीं खुली।", "গোনার পর্যালোচনা খোলেনি।")); }
    finally { setBusy(false); }
  }
  async function commit(rows: CountReviewRow[]) {
    setBusy(true); setError("");
    try {
      await commitCountSession(session!.id, rows.map((row) => ({ itemId: row.line.itemId, systemStock: row.systemStock })), "owner");
      onChanged(copy.syncedLater); onRoute({ page: "hub" });
    } catch (cause) {
      setError(inventoryFailure(language, cause, "Could not commit count.", "गिनती लागू नहीं हुई।", "গোনা প্রয়োগ হয়নি।"));
      setReview(null);
      onRoute({ ...route, reviewOpen: false });
    }
    finally { setBusy(false); }
  }

  if (!session) return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7" data-inventory-view="count">
      <button className="inventory-back" type="button" onClick={() => onRoute({ page: "hub" })}>← {copy.title}</button>
      <p className="eyebrow mt-4">{copy.count}</p><h2 className="page-title">{inventoryText(language, "Count by category", "कैटेगरी से गिनें", "বিভাগ ধরে গুনুন")}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {sessions.filter((entry) => entry.status === "in_progress").map((entry) => <button key={entry.id} type="button" className="settings-card text-left" onClick={() => onRoute({ page: "count", sessionId: entry.id })}><strong>{localizedCategoryName(language, entry.categoryName)}</strong><p>{inventoryText(language, "Resume count", "गिनती जारी रखें", "গোনা চালিয়ে যান")} · {formatLocalizedDateTime(entry.updatedAt, language)}</p></button>)}
      </div>
      <div className="settings-card mt-4 max-w-xl"><label className="product-field"><span>{inventoryText(language, "Category", "कैटेगरी", "বিভাগ")}</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{localizedCategoryName(language, category.name)}</option>)}</select></label><button type="button" className="counter-primary mt-3 w-full" disabled={busy || !categoryId} onClick={() => void begin()}>{inventoryText(language, "Start / resume count", "गिनती शुरू / जारी रखें", "গোনা শুরু / চালিয়ে যান")}</button><ErrorNote value={error} /></div>
    </section>
  );

  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7" data-inventory-view="count">
      <button className="inventory-back" type="button" onClick={() => onRoute({ page: "hub" })}>← {inventoryText(language, "Pause", "रोकें", "বিরতি")}</button>
      <p className="eyebrow mt-4">{copy.count}</p><h2 className="page-title">{localizedCategoryName(language, session.categoryName)}</h2>
      <p role="status" aria-live="polite" className="inventory-progress mt-3">{counted} / {lines.length} {inventoryText(language, "counted", "गिने गए", "গোনা হয়েছে")}</p>
      <div className="mt-4 grid gap-2">
        {lines.map((line) => { const displayName = itemDisplayName(items, line.itemId, line.itemName, language); return <label key={line.id} data-inventory-item-id={line.itemId} className="inventory-count-line"><span><strong>{displayName}</strong><small>{line.skuCode} · {inventoryText(language, "Started at", "शुरू में", "শুরুতে")} {line.systemStockAtStart === null ? copy.unknown : line.systemStockAtStart} {localizedUnitName(language, line.baseUnit)}</small></span><input inputMode="decimal" aria-label={`${displayName} ${copy.count}`} value={drafts[line.itemId] ?? (line.countedStock === null ? "" : String(line.countedStock))} onChange={(event) => setDrafts({ ...drafts, [line.itemId]: event.target.value })} onBlur={() => void saveLine(line)} /></label>; })}
      </div>
      <ErrorNote value={error} />
      <button type="button" className="counter-primary mt-4 w-full" disabled={busy || counted !== lines.length} onClick={() => void openReview()}>{inventoryText(language, "Review discrepancies", "फर्क देखें", "পার্থক্য দেখুন")}</button>
      {review && route.reviewOpen && <AccessibleSheet title={inventoryText(language, "Count review", "गिनती की समीक्षा", "গোনার পর্যালোচনা")} onClose={() => { setReview(null); onRoute({ ...route, reviewOpen: false }); }} panelClassName="max-w-2xl">
        <div role="region" tabIndex={0} aria-label={inventoryText(language, "Count discrepancies", "गिनती का फर्क", "গোনার পার্থক্য")} className="report-table-scroller">
          <table className="dashboard-table min-w-[520px]"><thead><tr><th>{copy.product}</th><th>{inventoryText(language, "System now", "सिस्टम में", "সিস্টেমে")}</th><th>{inventoryText(language, "Counted", "गिना", "গোনা")}</th><th>{inventoryText(language, "Difference", "फर्क", "পার্থক্য")}</th></tr></thead><tbody>{review.map((row) => <tr key={row.line.id}><td>{itemDisplayName(items, row.line.itemId, row.line.itemName, language)}</td><td>{row.systemStock === null ? copy.unknown : row.systemStock}</td><td>{row.line.countedStock}</td><td>{row.difference === null ? "—" : row.difference}</td></tr>)}</tbody></table>
        </div>
        {review.some((row) => row.systemStock !== row.line.systemStockAtStart) && <p className="inventory-warning mt-3">{inventoryText(language, "Stock changed while this count was paused. The latest system stock is shown; commit will recheck it.", "गिनती रुकी थी तब स्टॉक बदला। नया सिस्टम स्टॉक दिख रहा है; सेव करते समय फिर जाँच होगी।", "গোনা থামানো থাকাকালীন স্টক বদলেছে। নতুন সিস্টেম স্টক দেখানো হয়েছে; সেভের সময় আবার পরীক্ষা হবে।")}</p>}
        <button type="button" className="counter-primary mt-4 w-full" disabled={busy} onClick={() => ownerMode ? void commit(review) : onRequestOwner(() => void commit(review))}>{copy.ownerOnly} · {inventoryText(language, "Commit count", "गिनती लागू करें", "গোনা প্রয়োগ করুন")}</button>
      </AccessibleSheet>}
    </section>
  );
}

function HistoryWorkspace({ language, items, itemId, onRoute }: { language: Language; items: Item[]; itemId?: string; onRoute: (route: InventoryRoute) => void }) {
  const copy = inventoryLabels(language);
  const [selectedId, setSelectedId] = useState(itemId || "");
  const movements = useLiveQuery(() => selectedId ? itemMovementHistory(selectedId) : db.stockMovements.orderBy("createdAt").reverse().limit(500).toArray(), [selectedId], []);
  return <section className="mx-auto max-w-5xl px-3 py-5 md:px-7" data-inventory-view="history"><button className="inventory-back" type="button" onClick={() => onRoute({ page: "hub" })}>← {copy.title}</button><p className="eyebrow mt-4">{copy.history}</p><h2 className="page-title">{copy.history}</h2><label className="product-field mt-4 max-w-xl"><span>{copy.product}</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">{inventoryText(language, "All products", "सभी प्रोडक्ट", "সব পণ্য")}</option>{items.map((item) => <option key={item.id} value={item.id}>{localizedItemName(language, item)}</option>)}</select></label><div role="region" tabIndex={0} aria-label={copy.history} className="report-table-scroller mt-4"><table className="dashboard-table min-w-[640px]"><thead><tr><th>{copy.date}</th><th>{copy.product}</th><th>{copy.reason}</th><th>{inventoryText(language, "Change", "बदलाव", "পরিবর্তন")}</th><th>{inventoryText(language, "After", "बाद में", "পরে")}</th></tr></thead><tbody>{movements.map((movement) => { const item = items.find((entry) => entry.id === movement.itemId); return <tr key={movement.id}><td>{formatLocalizedDateTime(movement.createdAt, language)}<small className="block">{formatLocalizedDate(movement.date, language)}</small></td><td>{item ? localizedItemName(language, item) : movement.itemId}</td><td>{movementReasonLabel(language, movement.reason)}<small className="block">{movement.note}</small></td><td className={movement.qtyChange !== null && movement.qtyChange < 0 ? "report-money-out" : "report-money-in"}>{movement.qtyChange === null ? inventoryText(language, "Set", "तय", "সেট") : `${movement.qtyChange > 0 ? "+" : ""}${movement.qtyChange}`}{!movement.applied ? ` · ${copy.unknown}` : ""}</td><td>{movement.stockAfter === null ? copy.unknown : movement.stockAfter}</td></tr>; })}</tbody></table>{!movements.length && <p className="p-4 text-sm">{copy.noRows}</p>}</div></section>;
}

export default function InventoryWorkspace({ language, items, allItems = items, parties, invoices, categories, ownerMode, route, overlay, onRoute, onOverlay, onBackCatalogue, onChanged, onRequestOwner, onCreateProduct, preferredItemId }: CommonProps & { route: InventoryRoute; overlay: InventoryOverlay; onRoute: (route: InventoryRoute) => void; onOverlay: (overlay: InventoryOverlay) => void; onBackCatalogue: () => void }) {
  const copy = inventoryLabels(language);
  const movements = useLiveQuery(() => db.stockMovements.toArray(), [], []);
  const low = useMemo(() => lowStockItems(items), [items]);
  const valuation = useMemo(() => buildInventoryValuation(items), [items]);
  const known = items.filter((item) => item.currentStock !== null).length;
  const unknown = items.length - known;
  const negative = items.filter((item) => item.currentStock !== null && item.currentStock < 0).length;

  if (route.page === "count") return <CountWorkspace key={route.sessionId || "count-picker"} language={language} items={allItems} categories={categories} ownerMode={ownerMode} route={route} onRoute={onRoute} onChanged={onChanged} onRequestOwner={onRequestOwner} />;
  if (route.page === "history") return <HistoryWorkspace language={language} items={allItems} itemId={route.itemId} onRoute={onRoute} />;
  if (route.page === "lowStock") return <section className="mx-auto max-w-5xl px-3 py-5 md:px-7" data-inventory-view="lowStock"><button className="inventory-back" type="button" onClick={() => onRoute({ page: "hub" })}>← {copy.title}</button><p className="eyebrow mt-4">{copy.lowStock}</p><h2 className="page-title">{copy.lowStock}</h2><div className="mt-4 grid gap-2">{low.map((item) => <button type="button" key={item.id} data-inventory-item-id={item.id} className="settings-card flex items-center justify-between text-left" onClick={() => onRoute({ page: "history", itemId: item.id })}><span><strong>{localizedItemName(language, item)}</strong><small className="block">{inventoryText(language, "Alert below", "अलर्ट सीमा", "সতর্কতার সীমা")} {item.lowStockAlert} {localizedUnitName(language, item.baseUnit)}</small></span><b className="report-money-due">{stockLabel(item, language)}</b></button>)}{!low.length && <p className="settings-card">{copy.noRows}</p>}</div></section>;
  if (route.page === "valuation") return <section className="mx-auto max-w-5xl px-3 py-5 md:px-7" data-inventory-view="valuation"><button className="inventory-back" type="button" onClick={() => onRoute({ page: "hub" })}>← {copy.title}</button><p className="eyebrow mt-4">{copy.ownerOnly}</p><h2 className="page-title">{copy.valuation}</h2>{ownerMode ? <><div className="dashboard-card mt-4"><small>{inventoryText(language, "Valued known stock", "मूल्य वाला ज्ञात स्टॉक", "মূল্যসহ জানা স্টক")}</small><strong className="block text-2xl">{formatMoney(valuation.totalValue)}</strong><p>{valuation.missingCostCount} {inventoryText(language, "missing cost", "की लागत नहीं", "টির দাম নেই")} · {valuation.unknownStockCount} {copy.unknown} · {valuation.negativeStockCount} {copy.negative}</p></div><div role="region" tabIndex={0} aria-label={copy.valuation} className="report-table-scroller mt-4"><table className="dashboard-table min-w-[540px]"><thead><tr><th>{copy.product}</th><th>{inventoryText(language, "Stock", "स्टॉक", "স্টক")}</th><th>{inventoryText(language, "Cost", "लागत", "দাম")}</th><th>{copy.valuation}</th></tr></thead><tbody>{valuation.rows.map((row) => <tr key={row.item.id}><td>{localizedItemName(language, row.item)}</td><td>{stockLabel(row.item, language)}</td><td>{row.item.purchasePrice > 0 ? formatMoney(row.item.purchasePrice) : inventoryText(language, "Missing", "नहीं", "নেই")}</td><td>{row.value === null ? "—" : formatMoney(row.value)}</td></tr>)}</tbody></table></div></> : <div className="owner-mode-panel mt-4"><p>{inventoryText(language, "Unlock Owner Mode to see purchase cost and inventory value.", "खरीद लागत और स्टॉक मूल्य देखने के लिए ओनर मोड अनलॉक करें।", "কেনা দাম ও স্টকের মূল্য দেখতে ওনার মোড আনলক করুন।")}</p><button type="button" className="counter-primary" onClick={() => onRequestOwner(() => onRoute({ page: "valuation" }))}>{copy.ownerOnly}</button></div>}</section>;

  const actions: Array<{ key: Exclude<InventoryOverlay, null> | "count"; label: string; icon: string }> = [
    { key: "inward", label: copy.inward, icon: "＋" }, { key: "outward", label: copy.outward, icon: "−" },
    { key: "saleReturn", label: copy.saleReturn, icon: "↩" }, { key: "purchaseReturn", label: copy.purchaseReturn, icon: "↪" },
    { key: "adjustment", label: copy.adjustment, icon: "=" }, { key: "count", label: copy.count, icon: "✓" },
  ];
  return <>
    <section className="mx-auto max-w-5xl px-3 py-5 md:px-7" data-inventory-view="hub">
      <button className="inventory-back" type="button" onClick={onBackCatalogue}>← {copy.backItems}</button>
      <p className="eyebrow mt-4">{copy.eyebrow}</p><h2 className="page-title">{copy.title}</h2><p className="mt-2 max-w-2xl text-xs text-[#66736c]">{copy.helper}</p>
      <div className="inventory-summary-grid mt-4"><button type="button" className="dashboard-card" onClick={() => onRoute({ page: "history" })}><small>{copy.known}</small><strong>{known}</strong></button><button type="button" className="dashboard-card" onClick={() => onRoute({ page: "history" })}><small>{copy.unknown}</small><strong>{unknown}</strong></button><button type="button" className="dashboard-card" onClick={() => onRoute({ page: "history" })}><small>{copy.negative}</small><strong>{negative}</strong></button><button type="button" className="dashboard-card" onClick={() => onRoute({ page: "lowStock" })}><small>{copy.lowStock}</small><strong>{low.length}</strong></button></div>
      <div className="inventory-action-grid mt-4">{actions.map((action) => <button key={action.key} type="button" data-inventory-action={action.key === "saleReturn" ? "sale-return" : action.key === "purchaseReturn" ? "purchase-return" : action.key} className="settings-card inventory-action" onClick={() => action.key === "count" ? onRoute({ page: "count" }) : action.key === "adjustment" && !ownerMode ? onRequestOwner(() => onOverlay("adjustment")) : onOverlay(action.key)}><span aria-hidden="true">{action.icon}</span><strong>{action.label}</strong>{action.key === "adjustment" && <small>{copy.ownerOnly}</small>}</button>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><button className="settings-card text-left" type="button" onClick={() => onRoute({ page: "history" })}><strong>{copy.history}</strong><p>{movements.length} {inventoryText(language, "audit records", "ऑडिट रिकॉर्ड", "অডিট রেকর্ড")}</p></button><button className="settings-card text-left" type="button" onClick={() => onRoute({ page: "lowStock" })}><strong>{copy.lowStock}</strong><p>{low.length}</p></button><button className="settings-card text-left" type="button" onClick={() => ownerMode ? onRoute({ page: "valuation" }) : onRequestOwner(() => onRoute({ page: "valuation" }))}><strong>{copy.valuation}</strong><p>{copy.ownerOnly}</p></button></div>
    </section>
    {overlay === "inward" && <InwardSheet {...{ language, items, parties, invoices, categories, ownerMode, onClose: () => onOverlay(null), onChanged, onRequestOwner, onCreateProduct, preferredItemId }} />}
    {overlay === "outward" && <OutwardSheet {...{ language, items, parties, invoices, categories, ownerMode, onClose: () => onOverlay(null), onChanged, onRequestOwner }} />}
    {overlay === "adjustment" && <AdjustmentSheet {...{ language, items, parties, invoices, categories, ownerMode, onClose: () => onOverlay(null), onChanged, onRequestOwner }} />}
    {overlay === "saleReturn" && <ReturnSheet type="sale_return" {...{ language, items, parties, invoices, categories, ownerMode, onClose: () => onOverlay(null), onChanged, onRequestOwner }} />}
    {overlay === "purchaseReturn" && <ReturnSheet type="purchase_return" {...{ language, items, parties, invoices, categories, ownerMode, onClose: () => onOverlay(null), onChanged, onRequestOwner }} />}
  </>;
}
