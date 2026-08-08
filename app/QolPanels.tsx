"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityLog, Expense, Invoice, Item, Party, Payment } from "../lib/db";
import { formatMoney, fuzzyScore, partyMatchesSearch, shortDate } from "../lib/billing";
import type { BusinessSettings, InvoiceFormat } from "../lib/pdf";
import { invoicePdf } from "../lib/pdf";
import {
  defaultMessageTemplates,
  defaultPrinterProfiles,
  defaultWorkspace,
  dailyCashSummary,
  renderMessageTemplate,
  saveDailyClose,
  setOwnerPin,
  verifyOwnerPin,
  type MessageTemplates,
  type PrinterProfile,
  type WorkspacePreferences,
  type WorkspaceTab,
} from "../lib/qol";
import { downloadPaymentReceipt, paymentReceiptNumber, sharePaymentReceipt } from "../lib/payment-receipt";
import type { SyncDiagnostics } from "../lib/sync";

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    window.setTimeout(() => panel.current?.querySelector<HTMLElement>("input,button")?.focus(), 0);
    return () => { document.removeEventListener("keydown", key); before?.focus?.(); };
  }, [onClose]);
  return <div className="sheet-backdrop fixed inset-0 z-[70] bg-[#102d27]/50 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} role="dialog" aria-modal="true" aria-label={title} className={`sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] flex-col rounded-t-[28px] bg-[#fbfaf6] shadow-2xl ${wide ? "max-w-5xl" : "max-w-xl"}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-[#ddd7ca] px-4 py-4"><h2 className="text-base font-black">{title}</h2><button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-xl bg-[#eeeae1] text-xl font-black">×</button></header>
      <div className="overflow-y-auto p-4 pb-8 md:p-5">{children}</div>
    </section>
  </div>;
}

export function OwnerPinSheet({ configured, onClose, onUnlocked, onToast }: { configured: boolean; onClose: () => void; onUnlocked: () => void; onToast: (message: string) => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  async function submit() {
    if (busy || attempts >= 5) return;
    setBusy(true); setError("");
    try {
      if (!configured) {
        if (pin !== confirmPin) throw new Error("PINs do not match.");
        await setOwnerPin(pin);
        onToast("Owner PIN created. Cost and profit details are unlocked.");
      } else if (!await verifyOwnerPin(pin)) {
        setAttempts((value) => value + 1);
        throw new Error(attempts >= 4 ? "Too many attempts. Close this screen and try again later." : "Incorrect owner PIN.");
      }
      onUnlocked();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify PIN."); }
    finally { setBusy(false); }
  }
  return <Modal title={configured ? "Unlock Owner Mode" : "Create Owner PIN"} onClose={onClose}>
    <div className="rounded-2xl bg-[#f4faf0] p-4"><strong className="text-sm text-[#014921]">Private cost & profit view</strong><p className="mt-2 text-[11px] leading-5 text-[#66736d]">The PIN verifier is protected with PBKDF2 and saved only on this device. Owner Mode locks when the app is hidden.</p></div>
    <label className="product-field mt-4"><span>{configured ? "Owner PIN" : "New PIN (4–8 digits)"}</span><input autoFocus type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}/></label>
    {!configured && <label className="product-field mt-3"><span>Confirm PIN</span><input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))}/></label>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]">{error}</p>}
    <button disabled={busy || pin.length < 4 || attempts >= 5} onClick={() => void submit()} className="counter-primary mt-4">{busy ? "Checking…" : configured ? "Unlock Owner Mode" : "Save PIN & unlock"}</button>
  </Modal>;
}

type SearchResult = { type: "party"; party: Party } | { type: "item"; item: Item } | { type: "invoice"; invoice: Invoice };
export function GlobalSearchSheet({ parties, items, invoices, ownerMode, onClose, onParty, onItem, onInvoice }: { parties: Party[]; items: Item[]; invoices: Invoice[]; ownerMode: boolean; onClose: () => void; onParty: (party: Party) => void; onItem: (item: Item) => void; onInvoice: (invoice: Invoice) => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const partyRows: SearchResult[] = parties.filter((party) => !party.tags.some((tag) => tag.startsWith("mergedInto:")) && partyMatchesSearch(party, q)).slice(0, 8).map((party) => ({ type: "party", party }));
    const itemRows: SearchResult[] = items.map((item) => ({ item, score: fuzzyScore(q, item) })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map(({ item }) => ({ type: "item", item }));
    const needle = q.toLowerCase();
    const invoiceRows: SearchResult[] = invoices.filter((invoice) => !invoice.deletedAt && `${invoice.invoiceNumber} ${invoice.partyName} ${invoice.date}`.toLowerCase().includes(needle)).slice(0, 8).map((invoice) => ({ type: "invoice", invoice }));
    return [...partyRows, ...itemRows, ...invoiceRows];
  }, [query, parties, items, invoices]);
  return <Modal title="Search everything · Ctrl/⌘ K" onClose={onClose} wide>
    <label className="search-box sticky top-0 z-10"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, code, phone, address, item, SKU or bill number"/></label>
    {!query.trim() && <div className="py-16 text-center"><strong className="text-sm">One search for the whole workspace</strong><p className="mt-2 text-xs text-[#747573]">Cost and profit never appear here unless Owner Mode is unlocked.</p></div>}
    <div className="mt-3 grid gap-2 md:grid-cols-2">{results.map((result) => {
      if (result.type === "party") return <button key={`p-${result.party.id}`} onClick={() => onParty(result.party)} className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f4faf0] text-lg">◎</span><span className="min-w-0"><strong className="block truncate text-xs">{result.party.name}</strong><span className="mt-1 block truncate text-[9px] text-[#747573]">{result.party.codeName} · {result.party.phone || result.party.address}</span><span className="mt-1 block text-[9px] font-black text-[#b85a28]">Due {formatMoney(result.party.currentBalance)}</span></span></button>;
      if (result.type === "item") return <button key={`i-${result.item.id}`} onClick={() => onItem(result.item)} className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#fff3e8] text-lg">◫</span><span className="min-w-0"><strong className="block truncate text-xs">{result.item.name}</strong><span className="mt-1 block text-[9px] text-[#747573]">{result.item.skuCode} · {formatMoney(result.item.priceWholesale)}</span>{ownerMode && <span className="mt-1 block text-[8px] font-bold text-[#014921]">Cost {formatMoney(result.item.purchasePrice)}</span>}</span></button>;
      return <button key={`v-${result.invoice.id}`} onClick={() => onInvoice(result.invoice)} className="flex min-h-16 items-center gap-3 rounded-xl border border-[#e2e2db] bg-white p-3 text-left"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f0ede6] text-lg">▤</span><span className="min-w-0"><strong className="block truncate text-xs">{result.invoice.invoiceNumber}</strong><span className="mt-1 block truncate text-[9px] text-[#747573]">{result.invoice.partyName} · {shortDate(result.invoice.date)}</span><span className="mt-1 block text-[9px] font-black">{formatMoney(result.invoice.grandTotal)}</span></span></button>;
    })}</div>
    {query.trim() && !results.length && <p className="py-14 text-center text-xs text-[#747573]">No matching customer, product or bill.</p>}
  </Modal>;
}

export function SyncCenterSheet({ diagnostics, state, configured, onClose, onSync }: { diagnostics: SyncDiagnostics; state: string; configured: boolean; onClose: () => void; onSync: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [renderTime] = useState(() => Date.now());
  const ageHours = diagnostics.lastSuccess ? (renderTime - new Date(diagnostics.lastSuccess).getTime()) / 36e5 : Infinity;
  const stale = configured && ageHours > 72;
  return <Modal title="Offline & cloud backup centre" onClose={onClose}>
    <div className={`rounded-2xl p-4 ${stale || diagnostics.lastError ? "bg-[#fff3e8]" : "bg-[#f4faf0]"}`}><div className="flex items-center justify-between"><div><strong className="text-sm">{!configured ? "Cloud backup not configured" : stale ? "Backup needs attention" : state === "synced" ? "Everything backed up" : "Changes waiting"}</strong><p className="mt-1 text-[10px] text-[#68736e]">Last success: {diagnostics.lastSuccess ? new Date(diagnostics.lastSuccess).toLocaleString("en-IN") : "Never"}</p></div><span className={`h-4 w-4 rounded-full ${!configured ? "bg-stone-400" : stale || diagnostics.lastError ? "bg-amber-500" : "bg-emerald-500"}`}/></div>{diagnostics.lastError && <p role="alert" className="mt-3 text-[10px] font-bold text-[#9b4c28]">{diagnostics.lastError}</p>}</div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(diagnostics.pending).map(([key, value]) => <div key={key} className="rounded-xl border border-[#e2e2db] bg-white p-3"><span className="field-caption">{key}</span><strong className="mt-1 block text-lg text-[#014921]">{value}</strong></div>)}</div>
    {diagnostics.conflictCount > 0 && <p className="mt-3 rounded-xl bg-[#fff3e8] p-3 text-[10px] font-bold text-[#9b4c28]">{diagnostics.conflictCount} newer cloud edits replaced older offline versions. Ledger balances were rebuilt from bills, dues and payments.</p>}
    <button disabled={!configured || busy} onClick={async () => { setBusy(true); await onSync(); setBusy(false); }} className="counter-primary mt-4">{busy ? "Backing up…" : `Back up now · ${diagnostics.totalPending} pending`}</button>
    <p className="mt-3 text-[10px] leading-5 text-[#747573]">Billing remains available without internet. Uploads are bounded into safe batches and downloads are paginated for large catalogues.</p>
  </Modal>;
}

export function PaymentReceiptSheet({ payment, party, remaining, business, templates, format, onClose }: { payment: Payment; party: Party; remaining: number; business: BusinessSettings; templates: MessageTemplates; format: InvoiceFormat; onClose: () => void }) {
  const supplier = party.type === "supplier";
  const message = supplier
    ? `Payment of ${formatMoney(payment.amount)} made to ${party.name} on ${shortDate(payment.date)}. Remaining payable: ${formatMoney(remaining)}. — ${business.name}`
    : renderMessageTemplate(templates.payment, { party_name: party.name, party_code: party.codeName, paid: formatMoney(payment.amount), due: formatMoney(remaining), payment_date: shortDate(payment.date), shop_name: business.name });
  return <Modal title={supplier ? "Supplier payment advice" : "Payment receipt"} onClose={onClose}>
    <div className="rounded-3xl bg-[#e9f3ed] p-5 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#014921] text-xl text-white">✓</span><p className="mt-3 text-[9px] font-black tracking-wide text-[#747573]">{paymentReceiptNumber(payment)}</p><h3 className="mt-1 text-lg font-black">{party.name}</h3><strong className="mt-3 block text-3xl text-[#014921]">{formatMoney(payment.amount)}</strong><p className="mt-2 text-xs">{shortDate(payment.date)} · {payment.mode.toUpperCase()} · {supplier ? "Paid" : "Received"}</p><p className="mt-3 rounded-xl bg-white/70 p-3 text-xs font-black text-[#b85a28]">{supplier ? "Remaining payable" : "Remaining due"} {formatMoney(remaining)}</p></div>
    <div className="mt-3 grid gap-2"><button onClick={() => void downloadPaymentReceipt(payment, party, remaining, business, format)} className="counter-primary">Download / print PDF receipt</button><button onClick={() => void sharePaymentReceipt(payment, party, remaining, business, format, message)} className="counter-secondary text-emerald-700">Share receipt on WhatsApp</button><button onClick={onClose} className="counter-secondary">Done</button></div>
  </Modal>;
}

export function BillPreviewSheet({ invoice, business, format, onClose, onPrint, onShare }: { invoice: Invoice; business: BusinessSettings; format: InvoiceFormat; onClose: () => void; onPrint: () => void; onShare: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let active = true; let objectUrl = ""; void invoicePdf(invoice, business, format).then((doc) => { objectUrl = URL.createObjectURL(doc.output("blob")); if (active) setUrl(objectUrl); }); return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [invoice, business, format]);
  return <Modal title="Exact bill preview" onClose={onClose} wide><div className="overflow-hidden rounded-2xl border border-[#e2e2db] bg-[#eee]">{url ? <object data={url} type="application/pdf" className="h-[58dvh] w-full"><div className="p-8 text-center text-xs">PDF preview is not available in this browser. Use Print or Share below.</div></object> : <div className="grid h-[45dvh] place-items-center text-xs">Preparing exact PDF preview…</div>}</div><div className="mt-3 grid grid-cols-3 gap-2"><button onClick={onClose} className="counter-secondary">Back</button><button onClick={onShare} className="counter-secondary text-emerald-700">WhatsApp</button><button onClick={onPrint} className="counter-primary">Print now</button></div></Modal>;
}

export function DailyClosePanel({ invoices, payments, expenses, parties, onToast }: { invoices: Invoice[]; payments: Payment[]; expenses: Expense[]; parties: Party[]; onToast: (message: string) => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [notes, setNotes] = useState("");
  const summary = useMemo(() => dailyCashSummary(date, invoices, payments, expenses, opening, parties), [date, invoices, payments, expenses, opening, parties]);
  const difference = counted - summary.expectedCash;
  return <article className="dashboard-card overflow-hidden xl:col-span-12"><div className="border-b border-[#e2e2db] p-4"><p className="eyebrow">Counter control</p><h3 className="mt-1 text-xl text-[#014921]">Daily closing</h3><p className="mt-1 text-[10px] text-[#747573]">Compare expected cash with the cash physically counted in the drawer.</p></div><div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.3fr]"><div className="grid grid-cols-2 gap-2"><label className="product-field col-span-2"><span>Closing date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label><label className="product-field"><span>Opening cash ₹</span><input inputMode="decimal" value={opening || ""} onChange={(event) => setOpening(Math.max(0, Number(event.target.value) || 0))}/></label><label className="product-field"><span>Counted cash ₹</span><input inputMode="decimal" value={counted || ""} onChange={(event) => setCounted(Math.max(0, Number(event.target.value) || 0))}/></label><label className="product-field col-span-2"><span>Closing notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2}/></label></div><div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[["Sales", summary.sales],["Cash with bills",summary.invoiceCash],["Later cash",summary.customerCash],["Cash expenses",-summary.expensesCash],["UPI in",summary.upiIn],["Bank in",summary.bankIn]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#f7f5ef] p-3"><span className="field-caption">{label}</span><strong className="mt-1 block text-sm">{formatMoney(Number(value))}</strong></div>)}</div><div className="mt-2 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#014921] p-3 text-white"><span className="text-[8px] font-black uppercase opacity-75">Expected cash</span><strong className="mt-1 block text-xl">{formatMoney(summary.expectedCash)}</strong></div><div className={`rounded-xl p-3 ${Math.abs(difference) < .01 ? "bg-[#f4faf0] text-[#014921]" : "bg-[#fff3e8] text-[#9b4c28]"}`}><span className="text-[8px] font-black uppercase">Over / short</span><strong className="mt-1 block text-xl">{formatMoney(difference)}</strong></div></div><button onClick={async () => { await saveDailyClose({ date, openingCash: opening, expectedCash: summary.expectedCash, countedCash: counted, notes }); onToast(`Daily closing saved for ${date}`); }} className="counter-primary mt-3">Close day</button></div></div></article>;
}

function duplicatePairs<T extends { id: string }>(rows: T[], keys: (row: T) => string[]) {
  const seen = new Map<string, T>(); const pairs: Array<[T, T]> = []; const emitted = new Set<string>();
  for (const row of rows) for (const raw of keys(row)) { const key = raw.trim().toLowerCase(); if (!key) continue; const earlier = seen.get(key); if (!earlier) seen.set(key, row); else { const pairKey = [earlier.id, row.id].sort().join(":"); if (!emitted.has(pairKey)) { pairs.push([earlier, row]); emitted.add(pairKey); } } }
  return pairs;
}

export function QualityOfLifeSettings({ workspace, onWorkspace, profiles, onProfiles, templates, onTemplates, activityLogs, parties, items, onMergeParty, onMergeItem, ownerConfigured, onOwnerSetup }: { workspace: WorkspacePreferences; onWorkspace: (value: WorkspacePreferences) => void; profiles: PrinterProfile[]; onProfiles: (value: PrinterProfile[]) => void; templates: MessageTemplates; onTemplates: (value: MessageTemplates) => void; activityLogs: ActivityLog[]; parties: Party[]; items: Item[]; onMergeParty: (source: Party, target: Party) => Promise<void>; onMergeItem: (source: Item, target: Item) => Promise<void>; ownerConfigured: boolean; onOwnerSetup: () => void }) {
  const [section, setSection] = useState<"workspace" | "printer" | "messages" | "duplicates" | "activity">("workspace");
  const tabs = [["workspace","Workspace"],["printer","Printers"],["messages","Messages"],["duplicates","Duplicates"],["activity","Activity"]] as const;
  const partyPairs = useMemo(() => duplicatePairs(parties.filter((party) => !party.tags.some((tag) => tag.startsWith("mergedInto:"))), (party) => [party.name.replace(/[^a-z0-9]/gi, ""), party.phone.replace(/\D/g, "")]), [parties]);
  const itemPairs = useMemo(() => duplicatePairs(items, (item) => [item.name.replace(/[^a-z0-9]/gi, ""), item.skuCode]), [items]);
  const visible = workspace.order.filter((tab) => !workspace.hidden.includes(tab));
  const updateOrder = (tab: WorkspaceTab, direction: -1 | 1) => { const index = workspace.order.indexOf(tab); const next = index + direction; if (next < 0 || next >= workspace.order.length) return; const order = [...workspace.order]; [order[index], order[next]] = [order[next], order[index]]; onWorkspace({ ...workspace, order }); };
  return <section className="settings-card md:col-span-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3>Quality-of-life controls</h3><p className="mt-1 text-[10px] text-[#747573]">Counter layout, print profiles, WhatsApp wording, duplicate review and audit history.</p></div><button onClick={onOwnerSetup} className="min-h-10 rounded-lg border border-[#e2e2db] bg-white px-3 text-[9px] font-black text-[#014921]">{ownerConfigured ? "Owner PIN configured" : "Set owner PIN"}</button></div><div className="mt-4 flex gap-2 overflow-x-auto">{tabs.map(([key,label]) => <button key={key} onClick={() => setSection(key)} className={`min-h-10 shrink-0 rounded-lg px-3 text-[9px] font-black ${section === key ? "bg-[#014921] text-white" : "border border-[#e2e2db] bg-white"}`}>{label}</button>)}</div>
    {section === "workspace" && <div className="mt-4"><p className="text-[10px] text-[#747573]">Bill and More always remain available. Choose which other tabs appear and where the app opens.</p><div className="mt-3 space-y-2">{workspace.order.map((tab, index) => <div key={tab} className="flex items-center gap-2 rounded-xl border border-[#e2e2db] bg-white p-2"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f4faf0] text-[10px] font-black">{index + 1}</span><strong className="min-w-0 flex-1 capitalize">{tab}</strong><button aria-label={`Move ${tab} up`} onClick={() => updateOrder(tab, -1)} className="h-9 w-9 rounded-lg border">↑</button><button aria-label={`Move ${tab} down`} onClick={() => updateOrder(tab, 1)} className="h-9 w-9 rounded-lg border">↓</button><label className="flex min-h-9 items-center gap-2 px-1 text-[9px] font-black"><input type="checkbox" disabled={tab === "bill" || tab === "more"} checked={!workspace.hidden.includes(tab)} onChange={(event) => onWorkspace({ ...workspace, hidden: event.target.checked ? workspace.hidden.filter((key) => key !== tab) : [...workspace.hidden, tab], startTab: workspace.startTab === tab && !event.target.checked ? "bill" : workspace.startTab })}/> Show</label></div>)}</div><label className="product-field mt-3"><span>Open app on</span><select value={workspace.startTab} onChange={(event) => onWorkspace({ ...workspace, startTab: event.target.value as WorkspaceTab })}>{visible.map((tab) => <option key={tab} value={tab}>{tab}</option>)}</select></label><button onClick={() => onWorkspace(defaultWorkspace)} className="counter-secondary mt-3">Restore default workspace</button></div>}
    {section === "printer" && <div className="mt-4 space-y-2">{profiles.map((profile) => <div key={profile.id} className="grid gap-2 rounded-xl border border-[#e2e2db] bg-white p-3 sm:grid-cols-[1fr_100px_90px_auto]"><input value={profile.name} onChange={(event) => onProfiles(profiles.map((row) => row.id === profile.id ? { ...row, name: event.target.value } : row))} className="h-11 rounded-lg border px-3 text-xs font-bold"/><select value={profile.format} onChange={(event) => onProfiles(profiles.map((row) => row.id === profile.id ? { ...row, format: event.target.value as InvoiceFormat } : row))} className="h-11 rounded-lg border bg-white px-2 text-xs"><option value="a4">A4</option><option value="a5">A5</option><option value="thermal">Thermal</option></select><label className="flex items-center gap-2 text-[9px] font-black"><input type="number" min={1} max={5} value={profile.copies} onChange={(event) => onProfiles(profiles.map((row) => row.id === profile.id ? { ...row, copies: Math.min(5, Math.max(1, Number(event.target.value) || 1)) } : row))} className="h-11 w-14 rounded-lg border px-2"/> copies</label><button onClick={() => onProfiles(profiles.map((row) => ({ ...row, isDefault: row.id === profile.id })))} className={`min-h-11 rounded-lg px-3 text-[9px] font-black ${profile.isDefault ? "bg-[#014921] text-white" : "border"}`}>{profile.isDefault ? "Default" : "Make default"}</button></div>)}<p className="text-[10px] text-[#747573]">A browser cannot silently select a physical printer; profiles remember layout and copies before the system print dialog.</p><button onClick={() => onProfiles(defaultPrinterProfiles)} className="counter-secondary">Restore print profiles</button></div>}
    {section === "messages" && <div className="mt-4 grid gap-3 md:grid-cols-2">{(Object.keys(templates) as Array<keyof MessageTemplates>).map((key) => <label key={key} className="product-field"><span className="capitalize">{key} WhatsApp template</span><textarea rows={4} value={templates[key]} onChange={(event) => onTemplates({ ...templates, [key]: event.target.value })}/></label>)}<p className="text-[10px] leading-5 text-[#747573] md:col-span-2">Placeholders: {"{{party_name}} {{party_code}} {{invoice_number}} {{total}} {{paid}} {{due}} {{payment_date}} {{shop_name}}"}</p><button onClick={() => onTemplates(defaultMessageTemplates)} className="counter-secondary md:col-span-2">Restore message defaults</button></div>}
    {section === "duplicates" && <div className="mt-4 grid gap-4 md:grid-cols-2"><div><h4 className="text-xs font-black">Possible duplicate parties · {partyPairs.length}</h4><div className="mt-2 space-y-2">{partyPairs.slice(0, 20).map(([a,b]) => <div key={`${a.id}-${b.id}`} className="rounded-xl border bg-white p-3"><strong className="text-[11px]">{a.name} ↔ {b.name}</strong><p className="mt-1 text-[9px] text-[#747573]">{a.codeName} / {b.codeName}</p><button onClick={async () => { if (confirm(`Merge ${a.name} into ${b.name}? Bills, payments, dues and negotiated prices will move. The old account will be archived.`)) await onMergeParty(a,b); }} className="mt-2 text-[9px] font-black text-[#014921] underline">Merge first into second</button></div>)}{!partyPairs.length && <p className="rounded-xl bg-[#f4faf0] p-4 text-xs">No exact name, phone or code duplicates.</p>}</div></div><div><h4 className="text-xs font-black">Possible duplicate items · {itemPairs.length}</h4><div className="mt-2 space-y-2">{itemPairs.slice(0, 20).map(([a,b]) => <div key={`${a.id}-${b.id}`} className="rounded-xl border bg-white p-3"><strong className="text-[11px]">{a.name} ↔ {b.name}</strong><p className="mt-1 text-[9px] text-[#747573]">{a.skuCode} / {b.skuCode}</p><button onClick={async () => { if (confirm(`Merge ${a.name} into ${b.name}? The first product will be archived and its negotiated prices and stock will move.`)) await onMergeItem(a,b); }} className="mt-2 text-[9px] font-black text-[#014921] underline">Merge first into second</button></div>)}{!itemPairs.length && <p className="rounded-xl bg-[#f4faf0] p-4 text-xs">No exact name or SKU duplicates.</p>}</div></div></div>}
    {section === "activity" && <div className="mt-4"><div className="overflow-x-auto"><table className="dashboard-table min-w-[680px]"><thead><tr><th>Date/time</th><th>Actor</th><th>Action</th><th>Description</th></tr></thead><tbody>{activityLogs.slice(0, 100).map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("en-IN")}</td><td className="capitalize">{row.actor}</td><td>{row.action}</td><td className="font-bold">{row.description}</td></tr>)}</tbody></table></div>{!activityLogs.length && <p className="py-8 text-center text-xs text-[#747573]">Activity will appear after bills, payments, dues and settings changes.</p>}</div>}
  </section>;
}
