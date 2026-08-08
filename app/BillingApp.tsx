"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  localDate,
  makeId,
  nowIso,
  type AccountEntry,
  type Category,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMode,
  type Invoice,
  type InvoiceCharge,
  type InvoiceChargeCode,
  type InvoiceLine,
  type Item,
  type Language,
  type Party,
  type Payment,
  type PaymentChannel,
  type Unit,
} from "../lib/db";
import {
  allowedSaleUnits,
  calculateBill,
  convertUnitRate,
  createParty,
  createQuickItem,
  createQuickParty,
  customerInvoiceHistory,
  dueCustomerRows,
  formatMoney,
  fuzzyScore,
  normalizePartyCode,
  partyDueStatement,
  partyMatchesSearch,
  priceForParty,
  recordDue,
  recordPayment,
  saveQuotation,
  saveSale,
  shortDate,
  shouldOfferInlineItemCreation,
  unitShort,
  type SalePaymentPlan,
} from "../lib/billing";
import {
  buildCashFlowReport,
  dateRangeLabel,
  expenseCategoryLabels,
  recordExpense,
  removeExpense,
  restoreExpense,
} from "../lib/cashflow";
import { bilingual, t } from "../lib/i18n";
import {
  type BusinessSettings,
  type InvoiceFormat,
  printInvoice,
  shareInvoice,
} from "../lib/pdf";
import { prepareProductImage } from "../lib/product-image";
import { itemProfitMetrics } from "../lib/item-profit";
import {
  downloadCashFlowPdf,
  downloadCashFlowText,
} from "../lib/report-export";
import {
  downloadDueStatementPdf,
  downloadDueStatementText,
  partyStatementLabel,
} from "../lib/due-statement-export";
import {
  isNativeApp,
  openExternalUrl,
  shareNativeBlob,
} from "../lib/native-files";
import {
  clearCloudConfig,
  configureCloud,
  getCloudConfig,
  isCloudConfigured,
  pendingCount,
  startRealtimeSync,
  syncDiagnostics,
  syncNow,
  type CloudConfig,
  type SyncDiagnostics,
  type SyncState,
} from "../lib/sync";
import {
  clearBillDraft,
  defaultMessageTemplates,
  defaultPrinterProfiles,
  defaultWorkspace,
  loadBillDraft,
  logActivity,
  mergeItems,
  mergeParties,
  normalizeWorkspace,
  ownerPinConfigured,
  quantityPresets,
  PRINTER_PROFILES_META,
  MESSAGE_TEMPLATES_META,
  FAVOURITE_ITEMS_META,
  readJsonMeta,
  renderMessageTemplate,
  saveBillDraft,
  variantFamily,
  withVariantFamily,
  WORKSPACE_META,
  writeJsonMeta,
  type MessageTemplates,
  type PrinterProfile,
  type WorkspacePreferences,
} from "../lib/qol";
import {
  BillPreviewSheet,
  DailyClosePanel,
  GlobalSearchSheet,
  OwnerPinSheet,
  PaymentReceiptSheet,
  QualityOfLifeSettings,
  SyncCenterSheet,
} from "./QolPanels";
import { seedIfNeeded } from "../lib/seed";
import AdvancedReports from "./AdvancedReports";

type Tab = "bill" | "parties" | "dues" | "items" | "misc" | "reports" | "more";
type Sheet =
  | "party"
  | "item"
  | "payment"
  | "due"
  | "dueParty"
  | "partyEditor"
  | "invoice"
  | "product"
  | "ownerPin"
  | "globalSearch"
  | "syncCenter"
  | "receipt"
  | "preview"
  | null;
type PartyEditorOrigin = "bill" | "parties" | "dues";
type PadState = {
  title: string;
  value: number;
  decimal?: boolean;
  apply: (value: number) => void;
} | null;
type DraftInvoiceCharge = InvoiceCharge & { enabled: boolean };
type CounterDocument = "sale" | "quotation";
type Theme = "light" | "dark";

const tabOrder: Tab[] = [
  "bill",
  "parties",
  "dues",
  "items",
  "misc",
  "reports",
  "more",
];

const freshOtherCharges = (): DraftInvoiceCharge[] => [
  {
    code: "carrier",
    label: "Carrier / transport charge",
    amount: 0,
    enabled: false,
  },
  { code: "packing", label: "Packing charge", amount: 0, enabled: false },
  { code: "big_box", label: "Big box charge", amount: 0, enabled: false },
];

const emptyBusiness: BusinessSettings = {
  name: "Burrabazar Festival Decor",
  address: "Burrabazar, Kolkata, West Bengal",
  phone: "",
  gstin: "",
};

export default function BillingApp() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("bill");
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme | null>(null);
  const [ownerMode, setOwnerMode] = useState(false);
  const [ownerConfigured, setOwnerConfigured] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePreferences>(defaultWorkspace);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>(defaultPrinterProfiles);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplates>(defaultMessageTemplates);
  const [favouriteItemIds, setFavouriteItemIds] = useState<string[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftId, setDraftId] = useState(() => makeId());
  const [undoAction, setUndoAction] = useState<{ label: string; run: () => void } | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncDiagnostics>({
    pending: { parties: 0, items: 0, prices: 0, invoices: 0, payments: 0, dues: 0, expenses: 0 },
    totalPending: 0,
    conflictCount: 0,
  });
  const [syncState, setSyncState] = useState<SyncState>("offline");
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() =>
    getCloudConfig(),
  );
  const [cloudRevision, setCloudRevision] = useState(0);
  const [pending, setPending] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pad, setPad] = useState<PadState>(null);
  const [party, setParty] = useState<Party | undefined>();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [paid, setPaid] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentChannel>("cash");
  const [paymentPlan, setPaymentPlan] = useState<SalePaymentPlan>("full");
  const [counterDocument, setCounterDocument] =
    useState<CounterDocument>("sale");
  const [gstEnabled, setGstEnabled] = useState(true);
  const [gstRate, setGstRate] = useState(18);
  const [otherCharges, setOtherCharges] =
    useState<DraftInvoiceCharge[]>(freshOtherCharges);
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<{ payment: Payment; party: Party; remaining: number } | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [selectedDueParty, setSelectedDueParty] = useState<Party | null>(null);
  const [newPartyType, setNewPartyType] = useState<Party["type"]>("customer");
  const [partyEditorOrigin, setPartyEditorOrigin] =
    useState<PartyEditorOrigin>("parties");
  const [invoiceFormat, setInvoiceFormat] = useState<InvoiceFormat>("a5");
  const [business, setBusiness] = useState<BusinessSettings>(emptyBusiness);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const previousTabRef = useRef<Tab>("bill");
  const themeTransitionTimerRef = useRef<number | null>(null);
  const [installEvent, setInstallEvent] = useState<
    Event & { prompt?: () => Promise<void> }
  >();

  const parties = useLiveQuery(
    () => db.parties.orderBy("name").filter((entry) => !entry.tags.some((tag) => tag.startsWith("mergedInto:"))).toArray(),
    [],
    [],
  );
  const items = useLiveQuery(
    () => db.items.filter((item) => item.isActive).toArray(),
    [],
    [],
  );
  const categories = useLiveQuery(
    () => db.categories.orderBy("name").toArray(),
    [],
    [],
  );
  const invoices = useLiveQuery(
    () => db.invoices.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const payments = useLiveQuery(
    () => db.payments.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const accountEntries = useLiveQuery(
    () => db.accountEntries.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const expenses = useLiveQuery(
    () => db.expenses.orderBy("createdAt").reverse().toArray(),
    [],
    [],
  );
  const activityLogs = useLiveQuery(
    () => db.activityLogs.orderBy("createdAt").reverse().limit(200).toArray(),
    [],
    [],
  );
  const appliedCharges = useMemo<InvoiceCharge[]>(
    () =>
      otherCharges
        .filter((charge) => charge.enabled && charge.amount > 0)
        .map(({ code, label, amount }) => ({ code, label, amount })),
    [otherCharges],
  );
  const bill = useMemo(() => {
    if (counterDocument === "quotation")
      return calculateBill(lines, 0, appliedCharges);
    const preview = calculateBill(lines, 0, appliedCharges);
    const received =
      paymentPlan === "full"
        ? preview.grandTotal
        : paymentPlan === "partial"
          ? paid
          : 0;
    return calculateBill(lines, received, appliedCharges);
  }, [lines, paid, paymentPlan, appliedCharges, counterDocument]);
  const partySummary = useMemo(() => {
    if (!party) return null;
    const latestInvoice = invoices.find((invoice) => invoice.partyId === party.id && invoice.type === "sale" && !invoice.deletedAt);
    const latestPayment = payments.find((payment) => payment.partyId === party.id);
    return { latestInvoice, latestPayment, due: party.currentBalance, tier: party.priceTier };
  }, [party, invoices, payments]);
  const quickItems = useMemo(() => {
    const favourites = favouriteItemIds.map((id) => items.find((item) => item.id === id)).filter((item): item is Item => Boolean(item));
    const frequent = [...items].sort((a, b) => b.saleCount - a.saleCount || (b.lastSoldDate || "").localeCompare(a.lastSoldDate || ""));
    return [...new Map([...favourites, ...frequent].map((item) => [item.id, item])).values()].slice(0, 8);
  }, [favouriteItemIds, items]);

  useEffect(() => {
    (async () => {
      await seedIfNeeded();
      const [storedLanguage, storedFormat, storedBusiness, storedGstEnabled, storedGstRate, storedWorkspace, storedProfiles, storedTemplates, storedFavourites, storedDraft, pinConfigured] = await Promise.all([
        db.meta.get("language"),
        db.meta.get("invoice-format"),
        db.meta.get("business-settings"),
        db.meta.get("bill-gst-enabled"),
        db.meta.get("bill-gst-rate"),
        readJsonMeta(WORKSPACE_META, defaultWorkspace),
        readJsonMeta(PRINTER_PROFILES_META, defaultPrinterProfiles),
        readJsonMeta(MESSAGE_TEMPLATES_META, defaultMessageTemplates),
        readJsonMeta<string[]>(FAVOURITE_ITEMS_META, []),
        loadBillDraft(),
        ownerPinConfigured(),
      ]);
      if (storedLanguage?.value) setLanguage(storedLanguage.value as Language);
      if (storedFormat?.value)
        setInvoiceFormat(storedFormat.value as InvoiceFormat);
      if (storedBusiness?.value) {
        try {
          setBusiness(JSON.parse(String(storedBusiness.value)));
        } catch {}
      }
      if (storedGstEnabled) setGstEnabled(storedGstEnabled.value !== false);
      if (storedGstRate?.value)
        setGstRate(
          Math.min(25, Math.max(0, Number(storedGstRate.value) || 18)),
        );
      const nextWorkspace = normalizeWorkspace(storedWorkspace);
      setWorkspace(nextWorkspace);
      setTab(nextWorkspace.startTab as Tab);
      setPrinterProfiles(Array.isArray(storedProfiles) && storedProfiles.length ? storedProfiles : defaultPrinterProfiles);
      setMessageTemplates({ ...defaultMessageTemplates, ...storedTemplates });
      setFavouriteItemIds(Array.isArray(storedFavourites) ? storedFavourites : []);
      setOwnerConfigured(pinConfigured);
      if (storedDraft) {
        setDraftId(storedDraft.draftId || makeId());
        setParty(storedDraft.partyId ? await db.parties.get(storedDraft.partyId) : undefined);
        setLines(storedDraft.lines);
        setPaid(storedDraft.paid);
        setPaymentMode(storedDraft.paymentMode);
        setPaymentPlan(storedDraft.paymentPlan);
        setCounterDocument(storedDraft.documentType);
        setGstEnabled(storedDraft.gstEnabled);
        setGstRate(storedDraft.gstRate);
        setOtherCharges(storedDraft.otherCharges.length ? storedDraft.otherCharges : freshOtherCharges());
        setDraftSavedAt(storedDraft.savedAt);
        setToast("Unfinished bill restored safely");
      }
      setReady(true);
      const diagnostics = await syncDiagnostics();
      setPending(diagnostics.totalPending);
      setSyncInfo(diagnostics);
    })();
    if (!isNativeApp() && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const online = () =>
      syncNow(setSyncState)
        .then(() => pendingCount())
        .then(setPending);
    const offline = () => setSyncState("offline");
    const install = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as Event & { prompt?: () => Promise<void> });
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void syncNow(setSyncState)
      .then(() => pendingCount())
      .then(setPending);
    return startRealtimeSync(setSyncState);
  }, [ready, cloudRevision]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.lang =
      language === "bn" ? "bn" : language === "hi" ? "hi" : "en";
  }, [language]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setTheme(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      ),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mantu-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101713" : "#014921");
  }, [theme]);
  useEffect(() => {
    previousTabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      if (!party && !lines.length && !paid) {
        void clearBillDraft();
        setDraftSavedAt("");
        return;
      }
      void saveBillDraft({
        draftId,
        partyId: party?.id,
        lines,
        paid,
        paymentMode,
        paymentPlan,
        documentType: counterDocument,
        gstEnabled,
        gstRate,
        otherCharges,
      }).then((draft) => setDraftSavedAt(draft.savedAt));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [ready, draftId, party, lines, paid, paymentMode, paymentPlan, counterDocument, gstEnabled, gstRate, otherCharges]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSheet("globalSearch");
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!ownerMode) return;
    let timer = window.setTimeout(() => setOwnerMode(false), 10 * 60 * 1000);
    const activity = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOwnerMode(false), 10 * 60 * 1000);
    };
    const hidden = () => { if (document.hidden) setOwnerMode(false); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [ownerMode]);
  useEffect(() => {
    if (!ready) return;
    void syncDiagnostics().then(setSyncInfo);
  }, [ready, pending, syncState]);
  useEffect(
    () => () => {
      if (themeTransitionTimerRef.current !== null)
        window.clearTimeout(themeTransitionTimerRef.current);
      document.documentElement.classList.remove("theme-transitioning");
    },
    [],
  );
  useEffect(() => {
    if (!isNativeApp()) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", () => {
          if (pad) {
            setPad(null);
            return;
          }
          if (sheet) {
            setSheet(null);
            return;
          }
          if (selectedParty) {
            setSelectedParty(null);
            return;
          }
          if (selectedDueParty) {
            setSelectedDueParty(null);
            return;
          }
          if (tab !== "bill") {
            setTab("bill");
            return;
          }
          if (
            lines.length &&
            !window.confirm(
              "Leave the app? The current unsaved bill will remain open when you return.",
            )
          )
            return;
          void App.minimizeApp();
        }),
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      });
    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, [lines.length, pad, selectedDueParty, selectedParty, sheet, tab]);

  async function chooseParty(next?: Party) {
    setParty(next);
    setSheet(null);
    const repriced = await Promise.all(
      lines.map(async (line) => {
        const item = items.find((x) => x.id === line.itemId);
        if (!item) return line;
        const price = await priceForParty(item, next);
        return {
          ...line,
          baseUnit: item.baseUnit,
          rate: convertUnitRate(price.rate, item.baseUnit, line.unit),
          lastPriceLabel: price.record
            ? `Last: ${formatMoney(price.record.lastPrice)}/${unitShort(item.baseUnit)} · ${shortDate(price.record.lastSoldDate)}`
            : undefined,
          lockPrice: price.record?.lockedPrice,
        };
      }),
    );
    setLines(repriced);
  }

  async function addItem(item: Item) {
    const price = await priceForParty(item, party);
    setLines((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (existing)
        return current.map((line) =>
          line.itemId === item.id ? { ...line, qty: line.qty + 1 } : line,
        );
      return [
        ...current,
        {
          itemId: item.id,
          itemName: item.name,
          skuCode: item.skuCode,
          hsnCode: item.hsnCode || "",
          qty: 1,
          unit: item.baseUnit,
          baseUnit: item.baseUnit,
          rate: price.rate,
          discount: 0,
          taxableAmount: 0,
          gstRate: gstEnabled ? gstRate : 0,
          gstAmount: 0,
          amount: 0,
          lastPriceLabel: price.record
            ? `Last: ${formatMoney(price.record.lastPrice)}/${unitShort(item.baseUnit)} · ${shortDate(price.record.lastSoldDate)}`
            : undefined,
          lockPrice: price.record?.lockedPrice,
        },
      ];
    });
    setSheet(null);
  }

  function changeGstEnabled(enabled: boolean) {
    setGstEnabled(enabled);
    setLines((current) =>
      current.map((line) => ({ ...line, gstRate: enabled ? gstRate : 0 })),
    );
    void savePreference("bill-gst-enabled", enabled);
  }

  function changeGstRate(value: number) {
    const rate =
      Math.round(Math.min(25, Math.max(0, Number(value) || 0)) * 100) / 100;
    setGstRate(rate);
    setLines((current) => current.map((line) => ({ ...line, gstRate: rate })));
    void savePreference("bill-gst-rate", String(rate));
  }

  function changeOtherCharge(
    code: InvoiceChargeCode,
    patch: Partial<Pick<DraftInvoiceCharge, "enabled" | "amount">>,
  ) {
    setOtherCharges((current) =>
      current.map((charge) =>
        charge.code === code
          ? {
              ...charge,
              ...patch,
              amount:
                patch.amount === undefined
                  ? charge.amount
                  : Math.max(0, patch.amount),
            }
          : charge,
      ),
    );
  }

  async function updateItemPhoto(item: Item, file?: File) {
    try {
      const imageUrl = file ? await prepareProductImage(file) : undefined;
      await db.items.update(item.id, {
        imageUrl,
        updatedAt: nowIso(),
        isSynced: false,
      });
      setPending(await pendingCount());
      setToast(
        imageUrl
          ? `${item.name} photo saved offline`
          : `${item.name} photo removed`,
      );
      await logActivity({ action: imageUrl ? "item.photo.update" : "item.photo.remove", entityType: "item", entityId: item.id, description: `${item.name} photo ${imageUrl ? "updated" : "removed"}`, actor: ownerMode ? "owner" : "staff" });
      void syncNow(setSyncState)
        .then(() => pendingCount())
        .then(setPending);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not save this product photo.",
      );
      throw error;
    }
  }

  async function productSaved(
    item: Item,
    mode: "created" | "updated" | "archived",
  ) {
    setEditingItem(null);
    setSheet(null);
    setPending(await pendingCount());
    setToast(
      mode === "created"
        ? `${item.name} added and saved offline`
        : mode === "archived"
          ? `${item.name} archived safely`
          : `${item.name} updated`,
    );
    await logActivity({ action: `item.${mode}`, entityType: "item", entityId: item.id, description: `${item.name} ${mode}`, actor: ownerMode ? "owner" : "staff" });
    void syncNow(setSyncState)
      .then(() => pendingCount())
      .then(setPending);
  }

  async function expenseChanged(message: string) {
    await logActivity({ action: "expense.change", entityType: "expense", description: message, actor: ownerMode ? "owner" : "staff" });
    await queueSync();
    setToast(message);
  }

  async function queueSync() {
    const before = await syncDiagnostics();
    setPending(before.totalPending);
    setSyncInfo(before);
    void syncNow(setSyncState).then(async () => {
      const after = await syncDiagnostics();
      setPending(after.totalPending);
      setSyncInfo(after);
    });
  }

  function rememberLineUndo(label: string, snapshot: InvoiceLine[]) {
    setUndoAction({ label, run: () => { setLines(snapshot); setUndoAction(null); setToast(`${label} undone`); } });
  }

  const changeLine = (index: number, patch: Partial<InvoiceLine>) => {
    rememberLineUndo("Bill change", lines);
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  const removeLine = (index: number) => {
    if (confirm("Remove this item from the bill?"))
      rememberLineUndo("Removed item", lines);
      setLines((current) => current.filter((_, i) => i !== index));
  };

  async function repeatLastBill() {
    if (!party) return;
    const previous = invoices.find((invoice) => invoice.partyId === party.id && invoice.type === "sale" && !invoice.deletedAt);
    if (!previous) return setToast("No earlier bill found for this customer.");
    const snapshot = lines;
    setLines(previous.lineItems.map((line) => ({ ...line })));
    setOtherCharges((previous.otherCharges || []).map((charge) => ({ ...charge, enabled: true })) as DraftInvoiceCharge[]);
    setGstEnabled(previous.gstTotal > 0);
    setPaymentPlan("full");
    setPaid(0);
    rememberLineUndo("Repeated last bill", snapshot);
    setToast(`${previous.invoiceNumber} copied as a new unsaved bill`);
  }

  async function toggleFavourite(item: Item) {
    const next = favouriteItemIds.includes(item.id) ? favouriteItemIds.filter((id) => id !== item.id) : [item.id, ...favouriteItemIds];
    setFavouriteItemIds(next);
    await writeJsonMeta(FAVOURITE_ITEMS_META, next);
  }

  async function saveWorkspace(next: WorkspacePreferences) {
    const safe = normalizeWorkspace(next);
    setWorkspace(safe);
    if (safe.hidden.includes(tab)) setTab("bill");
    await writeJsonMeta(WORKSPACE_META, safe);
    await logActivity({ action: "workspace.update", entityType: "settings", description: "Workspace layout updated", actor: ownerMode ? "owner" : "staff" });
  }

  async function finishSale(action: "save" | "print" | "whatsapp") {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let invoice: Invoice;
    try {
      invoice =
        counterDocument === "quotation"
          ? await saveQuotation({ party, lines, otherCharges: appliedCharges, idempotencyKey: draftId })
          : await saveSale({
              idempotencyKey: draftId,
              party,
              lines,
              paid,
              paymentMode: paymentPlan === "credit" ? "credit" : paymentMode,
              paymentPlan,
              otherCharges: appliedCharges,
            });
      setLastInvoice(invoice);
      setLines([]);
      setPaid(0);
      setPaymentPlan("full");
      setPaymentMode("cash");
      setParty(undefined);
      setOtherCharges(freshOtherCharges());
      setCounterDocument("sale");
      await clearBillDraft();
      setDraftId(makeId());
      setDraftSavedAt("");
      await logActivity({
        action: invoice.type === "quotation" ? "quotation.create" : "invoice.create",
        entityType: "invoice",
        entityId: invoice.id,
        description: `${invoice.invoiceNumber} saved for ${invoice.partyName}`,
        actor: ownerMode ? "owner" : "staff",
        metadata: { total: invoice.grandTotal, due: invoice.amountDue },
      });
      await queueSync();
      setToast(
        `${invoice.invoiceNumber} ${invoice.type === "quotation" ? "quotation" : "bill"} saved offline`,
      );
      setSheet(action === "save" ? "invoice" : "preview");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not save bill");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    savingRef.current = false;
    setSaving(false);
  }

  function invoiceShareMessage(invoice: Invoice) {
    const template = invoice.type === "quotation" ? messageTemplates.quotation : messageTemplates.invoice;
    return renderMessageTemplate(template, {
      party_name: invoice.partyName,
      party_code: parties.find((entry) => entry.id === invoice.partyId)?.codeName || "",
      invoice_number: invoice.invoiceNumber,
      total: formatMoney(invoice.grandTotal),
      paid: formatMoney(invoice.amountPaid),
      due: formatMoney(invoice.amountDue),
      shop_name: business.name,
    });
  }

  async function savePreference(key: string, value: string | number | boolean) {
    await db.meta.put({ key, value });
  }

  async function saveCloud(next: CloudConfig) {
    try {
      const saved = configureCloud(next);
      setCloudConfig(saved);
      setCloudRevision((revision) => revision + 1);
      setToast("Cloud backup settings saved. Sync is starting now.");
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Could not save cloud settings.",
      );
    }
  }

  function disconnectCloud() {
    if (
      !confirm(
        "Disconnect Supabase cloud backup on this device? Your offline data will remain here.",
      )
    )
      return false;
    clearCloudConfig();
    setCloudConfig({ url: "", key: "", syncCode: "" });
    setCloudRevision((revision) => revision + 1);
    setSyncState("offline");
    setToast("Cloud backup disconnected. Offline data was not removed.");
    return true;
  }

  function changeTheme(next: Theme) {
    if (next === theme) return;
    const root = document.documentElement;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduceMotion) {
      root.classList.add("theme-transitioning");
      if (themeTransitionTimerRef.current !== null)
        window.clearTimeout(themeTransitionTimerRef.current);
      themeTransitionTimerRef.current = window.setTimeout(() => {
        root.classList.remove("theme-transitioning");
        themeTransitionTimerRef.current = null;
      }, 460);
    }
    setTheme(next);
  }

  const previousTab = previousTabRef.current;
  const pageDirection =
    previousTab === tab
      ? "neutral"
      : tabOrder.indexOf(tab) > tabOrder.indexOf(previousTab)
        ? "forward"
        : "backward";

  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f1e8]">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-pulse rounded-2xl bg-[#ef7d32]" />
          <p className="mt-4 text-sm font-bold text-[#31524a]">
            Opening your offline counter…
          </p>
        </div>
      </div>
    );

  return (
    <main className="cartesia-shell min-h-dvh bg-[#eee9de] text-[#162b26]">
      <div className="cartesia-surface min-h-dvh bg-[#fbfaf6]">
        <AppHeader
          state={syncState}
          pending={pending}
          language={language}
          theme={theme || "light"}
          onTheme={() =>
            changeTheme((theme || "light") === "dark" ? "light" : "dark")
          }
          onLanguage={(next) => {
            setLanguage(next);
            savePreference("language", next);
          }}
          onSearch={() => setSheet("globalSearch")}
          onSync={() => setSheet("syncCenter")}
          undoLabel={undoAction?.label}
          onUndo={() => undoAction?.run()}
        />
        <div className="app-page-stage pb-40 md:pb-8 md:pl-[220px]">
          <div
            key={tab}
            className="app-page-transition"
            data-page={tab}
            data-direction={pageDirection}
          >
          {tab === "bill" && (
            <BillScreen
              language={language}
              documentType={counterDocument}
              onDocumentType={setCounterDocument}
              party={party}
              lines={lines}
              bill={bill}
              paid={paid}
              paymentMode={paymentMode}
              paymentPlan={paymentPlan}
              items={items}
              quickItems={quickItems}
              favouriteItemIds={favouriteItemIds}
              partySummary={partySummary}
              draftSavedAt={draftSavedAt}
              saving={saving}
              gstEnabled={gstEnabled}
              gstRate={gstRate}
              otherCharges={otherCharges}
              onGstEnabled={changeGstEnabled}
              onGstRate={changeGstRate}
              onOtherCharge={changeOtherCharge}
              onParty={() => setSheet("party")}
              onNewCustomer={() => {
                setNewPartyType("customer");
                setPartyEditorOrigin("bill");
                setSheet("partyEditor");
              }}
              onItem={() => setSheet("item")}
              onQuickItem={addItem}
              onFavourite={toggleFavourite}
              onRepeat={() => void repeatLastBill()}
              onLine={changeLine}
              onRemove={removeLine}
              onPad={setPad}
              onPaid={setPaid}
              onPaymentPlan={(plan) => {
                setPaymentPlan(plan);
                if (plan !== "partial") setPaid(0);
              }}
              onMode={setPaymentMode}
              onSave={finishSale}
            />
          )}
          {tab === "parties" && (
            <PartiesScreen
              parties={parties}
              invoices={invoices}
              payments={payments}
              accountEntries={accountEntries}
              language={language}
              businessName={business.name}
              dueTemplate={messageTemplates.due}
              onParty={setSelectedParty}
              selected={selectedParty}
              onBack={() => setSelectedParty(null)}
              onCreate={(type) => {
                setNewPartyType(type);
                setPartyEditorOrigin("parties");
                setSheet("partyEditor");
              }}
              onDue={(p) => {
                setSelectedParty(p);
                setSheet("due");
              }}
              onPayment={(p) => {
                setSelectedParty(p);
                setSheet("payment");
              }}
              onToast={(message) => { setToast(message); void queueSync(); }}
            />
          )}
          {tab === "dues" && (
            <DuesScreen
              parties={parties}
              invoices={invoices}
              payments={payments}
              accountEntries={accountEntries}
              language={language}
              business={business}
              dueTemplate={messageTemplates.due}
              selected={selectedDueParty}
              onParty={setSelectedDueParty}
              onBack={() => setSelectedDueParty(null)}
              onAddDue={(next) => {
                if (next) {
                  setSelectedDueParty(next);
                  setSelectedParty(next);
                  setSheet("due");
                } else setSheet("dueParty");
              }}
              onPayment={(next) => {
                setSelectedDueParty(next);
                setSelectedParty(next);
                setSheet("payment");
              }}
              onToast={(message) => { setToast(message); void queueSync(); }}
            />
          )}
          {tab === "items" && (
            <ItemsScreen
              items={items}
              language={language}
              ownerMode={ownerMode}
              onOwnerMode={(enabled) => {
                if (!enabled) setOwnerMode(false);
                else setSheet("ownerPin");
              }}
              onAdd={(item) => {
                addItem(item);
                setTab("bill");
              }}
              onCreate={() => {
                setEditingItem(null);
                setSheet("product");
              }}
              onEdit={(item) => {
                setEditingItem(item);
                setSheet("product");
              }}
              onPhoto={updateItemPhoto}
            />
          )}
          {tab === "misc" && (
            <MiscellaneousScreen
              expenses={expenses}
              language={language}
              onPad={setPad}
              onChanged={expenseChanged}
            />
          )}
          {tab === "reports" && (
            <ReportsDashboard
              invoices={invoices}
              payments={payments}
              accountEntries={accountEntries}
              expenses={expenses}
              parties={parties}
              items={items}
              language={language}
              ownerMode={ownerMode}
              business={business}
              format={invoiceFormat}
              onNewBill={() => setTab("bill")}
              onToast={setToast}
              onConverted={async (invoice) => {
                setLastInvoice(invoice);
                setPending(await pendingCount());
                void syncNow(setSyncState)
                  .then(() => pendingCount())
                  .then(setPending);
              }}
            />
          )}
          {tab === "more" && (
            <MoreScreen
              language={language}
              theme={theme || "light"}
              format={invoiceFormat}
              business={business}
              invoices={invoices}
              installable={Boolean(installEvent)}
              cloudConfigured={isCloudConfigured()}
              cloudConfig={cloudConfig}
              onCloud={saveCloud}
              onCloudDisconnect={disconnectCloud}
              onLanguage={(next) => {
                setLanguage(next);
                savePreference("language", next);
              }}
              onTheme={changeTheme}
              onFormat={(next) => {
                setInvoiceFormat(next);
                savePreference("invoice-format", next);
              }}
              onBusiness={(next) => {
                setBusiness(next);
                savePreference("business-settings", JSON.stringify(next));
                setToast("Shop details saved");
              }}
              onInstall={() => installEvent?.prompt?.()}
              onToast={(message) => { setToast(message); void queueSync(); }}
              workspace={workspace}
              printerProfiles={printerProfiles}
              messageTemplates={messageTemplates}
              activityLogs={activityLogs}
              parties={parties}
              items={items}
              ownerConfigured={ownerConfigured}
              onOwnerSetup={() => setSheet("ownerPin")}
              onWorkspace={(next) => void saveWorkspace(next)}
              onPrinterProfiles={(next) => {
                setPrinterProfiles(next);
                void writeJsonMeta(PRINTER_PROFILES_META, next);
                const selected = next.find((profile) => profile.isDefault);
                if (selected) {
                  setInvoiceFormat(selected.format);
                  void savePreference("invoice-format", selected.format);
                }
              }}
              onMessageTemplates={(next) => {
                setMessageTemplates(next);
                void writeJsonMeta(MESSAGE_TEMPLATES_META, next);
              }}
              onMergeParty={async (source, target) => {
                await mergeParties(source.id, target.id, ownerMode ? "owner" : "staff");
                await queueSync();
                setToast(`${source.name} merged into ${target.name}`);
              }}
              onMergeItem={async (source, target) => {
                await mergeItems(source.id, target.id, ownerMode ? "owner" : "staff");
                await queueSync();
                setToast(`${source.name} merged into ${target.name}`);
              }}
            />
          )}
          </div>
        </div>
        <BottomNav
          tab={tab}
          language={language}
          workspace={workspace}
          onChange={(next) => {
            setTab(next);
            if (next !== "parties") setSelectedParty(null);
            if (next !== "dues") setSelectedDueParty(null);
          }}
        />
        {tab === "bill" && (
          <BillDock
            documentType={counterDocument}
            bill={bill}
            language={language}
            gstEnabled={gstEnabled}
            gstRate={gstRate}
            disabled={
              !lines.length ||
              saving ||
              (counterDocument === "sale" &&
                paymentPlan !== "full" &&
                (!party ||
                  (paymentPlan === "partial" &&
                    (paid <= 0 || paid >= bill.grandTotal))))
            }
            saving={saving}
            onSave={finishSale}
          />
        )}
      </div>
      {sheet === "party" && (
        <PartyPicker
          parties={parties.filter((entry) => entry.type === "customer")}
          selected={party}
          onClose={() => setSheet(null)}
          onSelect={chooseParty}
          onToast={(message) => { setToast(message); void queueSync(); }}
        />
      )}
      {sheet === "dueParty" && (
        <DueCustomerPicker
          parties={parties.filter((entry) => entry.type === "customer")}
          onClose={() => setSheet(null)}
          onSelect={(next) => {
            setSelectedDueParty(next);
            setSelectedParty(next);
            setSheet("due");
          }}
          onNewCustomer={() => {
            setNewPartyType("customer");
            setPartyEditorOrigin("dues");
            setSheet("partyEditor");
          }}
        />
      )}
      {sheet === "item" && (
        <ItemPicker
          items={items}
          favouriteItemIds={favouriteItemIds}
          onClose={() => setSheet(null)}
          onSelect={addItem}
          onToast={(message) => { setToast(message); void queueSync(); }}
          onFavourite={toggleFavourite}
        />
      )}
      {sheet === "product" && (
        <ProductEditor
          item={editingItem}
          categories={categories}
          language={language}
          ownerMode={ownerMode}
          onPad={setPad}
          onClose={() => {
            setEditingItem(null);
            setSheet(null);
          }}
          onSaved={productSaved}
        />
      )}
      {sheet === "partyEditor" && (
        <PartyEditor
          language={language}
          defaultType={newPartyType}
          customerOnly={partyEditorOrigin !== "parties"}
          onClose={() => setSheet(null)}
          onPad={setPad}
          onSaved={async (created) => {
            await logActivity({ action: `${created.type}.create`, entityType: "party", entityId: created.id, description: `${created.name} created`, actor: ownerMode ? "owner" : "staff" });
            await queueSync();
            if (partyEditorOrigin === "bill") {
              await chooseParty(created);
              setTab("bill");
              setToast(`${created.name} saved and selected for this bill`);
              return;
            }
            if (partyEditorOrigin === "dues") {
              setSelectedParty(created);
              setSelectedDueParty(created);
              setTab("dues");
              setSheet("due");
              setToast(`${created.name} saved; enter the due amount`);
              return;
            }
            setSheet(null);
            setSelectedParty(created);
            setTab("parties");
            setToast(
              `${created.type === "supplier" ? "Supplier" : "Customer"} saved offline`,
            );
          }}
        />
      )}
      {sheet === "due" && selectedParty && (
        <DueSheet
          party={selectedParty}
          onClose={() => setSheet(null)}
          onPad={setPad}
          onSaved={async () => {
            const refreshed = (await db.parties.get(selectedParty.id)) || null;
            setSheet(null);
            setSelectedParty(refreshed);
            if (selectedDueParty?.id === selectedParty.id)
              setSelectedDueParty(refreshed);
            setToast(
              selectedParty.type === "supplier"
                ? "Supplier bill added"
                : "Customer due added and saved",
            );
            await logActivity({ action: "due.create", entityType: "due", entityId: selectedParty.id, description: `Manual due recorded for ${selectedParty.name}`, actor: ownerMode ? "owner" : "staff" });
            await queueSync();
          }}
        />
      )}
      {sheet === "payment" && selectedParty && (
        <PaymentSheet
          party={selectedParty}
          invoices={invoices.filter(
            (x) =>
              x.partyId === selectedParty.id && !x.deletedAt && x.amountDue > 0,
          )}
          onClose={() => setSheet(null)}
          onPad={setPad}
          onSaved={async (payment) => {
            const refreshed = (await db.parties.get(selectedParty.id)) || null;
            setSelectedParty(refreshed);
            if (selectedDueParty?.id === selectedParty.id)
              setSelectedDueParty(refreshed);
            setToast(
              selectedParty.type === "supplier"
                ? "Payment to supplier recorded"
                : "Customer payment recorded and allocated",
            );
            await logActivity({ action: "payment.create", entityType: "payment", entityId: payment.id, description: `${formatMoney(payment.amount)} ${selectedParty.type === "supplier" ? "paid to" : "received from"} ${selectedParty.name}`, actor: ownerMode ? "owner" : "staff" });
            await queueSync();
            if (refreshed) {
              setLastPaymentReceipt({ payment, party: refreshed, remaining: refreshed.currentBalance });
              setSheet("receipt");
            } else setSheet(null);
          }}
        />
      )}
      {sheet === "invoice" && lastInvoice && (
        <InvoiceSaved
          invoice={lastInvoice}
          business={business}
          format={invoiceFormat}
          shareMessage={invoiceShareMessage(lastInvoice)}
          onClose={() => setSheet(null)}
          onPreview={() => setSheet("preview")}
        />
      )}
      {sheet === "ownerPin" && (
        <OwnerPinSheet
          configured={ownerConfigured}
          onClose={() => setSheet(null)}
          onUnlocked={() => {
            setOwnerConfigured(true);
            setOwnerMode(true);
            setSheet(null);
          }}
          onToast={setToast}
        />
      )}
      {sheet === "globalSearch" && (
        <GlobalSearchSheet
          parties={parties}
          items={items}
          invoices={invoices}
          ownerMode={ownerMode}
          onClose={() => setSheet(null)}
          onParty={(next) => { setSelectedParty(next); setTab("parties"); setSheet(null); }}
          onItem={(next) => { void addItem(next); setTab("bill"); setSheet(null); }}
          onInvoice={(next) => { setLastInvoice(next); setSheet("invoice"); }}
        />
      )}
      {sheet === "syncCenter" && (
        <SyncCenterSheet
          diagnostics={syncInfo}
          state={syncState}
          configured={isCloudConfigured()}
          onClose={() => setSheet(null)}
          onSync={async () => {
            await syncNow(setSyncState);
            const info = await syncDiagnostics();
            setSyncInfo(info);
            setPending(info.totalPending);
          }}
        />
      )}
      {sheet === "receipt" && lastPaymentReceipt && (
        <PaymentReceiptSheet
          payment={lastPaymentReceipt.payment}
          party={lastPaymentReceipt.party}
          remaining={lastPaymentReceipt.remaining}
          business={business}
          templates={messageTemplates}
          format={invoiceFormat}
          onClose={() => { setLastPaymentReceipt(null); setSheet(null); }}
        />
      )}
      {sheet === "preview" && lastInvoice && (
        <BillPreviewSheet
          invoice={lastInvoice}
          business={business}
          format={invoiceFormat}
          onClose={() => setSheet("invoice")}
          onPrint={() => void printInvoice(lastInvoice, business, invoiceFormat)}
          onShare={() => void shareInvoice(lastInvoice, business, invoiceFormat, null, invoiceShareMessage(lastInvoice))}
        />
      )}
      {pad && <NumberPad state={pad} onClose={() => setPad(null)} />}
      {toast && (
        <div className="fixed left-1/2 top-20 z-[90] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl bg-[#173f35] px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      )}
    </main>
  );
}

function AppHeader({
  state,
  pending,
  language,
  theme,
  onTheme,
  onLanguage,
  onSearch,
  onSync,
  undoLabel,
  onUndo,
}: {
  state: SyncState;
  pending: number;
  language: Language;
  theme: Theme;
  onTheme: () => void;
  onLanguage: (language: Language) => void;
  onSearch: () => void;
  onSync: () => void;
  undoLabel?: string;
  onUndo: () => void;
}) {
  const color =
    state === "synced"
      ? "bg-emerald-500"
      : state === "offline"
        ? "bg-stone-400"
        : "bg-amber-500";
  const label =
    state === "syncing"
      ? t(language, "syncing")
      : state === "synced"
        ? t(language, "synced")
        : state === "offline"
          ? t(language, "offline")
          : `${pending} ${t(language, "pending")}`;
  const languageNames: Record<Language, string> = {
    en: "English",
    hi: "हिंदी",
    bn: "বাংলা",
  };
  return (
    <header className="app-header sticky top-0 z-30 flex min-h-[68px] items-center justify-between gap-2 border-b border-[#ddd7ca] bg-[#fbfaf6]/95 px-3 py-2 backdrop-blur md:px-7">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <div className="brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173f35] text-lg font-black text-[#ffb45f]">
          M
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-black tracking-tight md:text-[15px]">
            Midori Kanjo
          </h1>
          <p className="truncate text-[9px] font-semibold text-[#6d7973] md:text-[10px]">
            Made by Sayan Finance
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {undoLabel && <button type="button" onClick={onUndo} title={`Undo ${undoLabel}`} className="grid h-10 w-10 place-items-center rounded-xl border border-[#ded9ce] bg-white text-base font-black">↶</button>}
        <button type="button" onClick={onSearch} aria-label="Search everything" title="Search everything · Ctrl/Command K" className="grid h-10 w-10 place-items-center rounded-xl border border-[#ded9ce] bg-white text-lg font-black">⌕</button>
        <button
          type="button"
          onClick={onTheme}
          aria-pressed={theme === "dark"}
          aria-label={theme === "dark" ? t(language, "lightMode") : t(language, "darkMode")}
          title={theme === "dark" ? t(language, "lightMode") : t(language, "darkMode")}
          className={`theme-toggle ${theme === "dark" ? "is-dark" : "is-light"}`}
        >
          <span className="theme-toggle-track" aria-hidden="true">
            <span className="theme-toggle-knob">
              <span className="theme-toggle-sun">☀</span>
              <span className="theme-toggle-moon">☾</span>
            </span>
          </span>
          <span className="hidden lg:inline">
            {theme === "dark" ? t(language, "lightMode") : t(language, "darkMode")}
          </span>
        </button>
        <div
          role="group"
          aria-label="Choose language"
          className="language-toggle"
        >
          {(["en", "hi", "bn"] as Language[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              title={languageNames[option]}
              onClick={() => onLanguage(option)}
              className={language === option ? "active" : ""}
            >
              {option === "en" ? "EN" : option === "hi" ? "हिं" : "বাং"}
            </button>
          ))}
        </div>
        <button type="button" onClick={onSync} className="flex min-h-10 items-center gap-2 rounded-full border border-[#ded9ce] bg-white px-2.5 py-2 text-[10px] font-extrabold md:px-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${color} ${state === "syncing" ? "animate-pulse" : ""}`}
          />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </div>
    </header>
  );
}

function BillScreen({
  language,
  documentType,
  onDocumentType,
  party,
  lines,
  bill,
  paid,
  paymentMode,
  paymentPlan,
  items,
  quickItems,
  favouriteItemIds,
  partySummary,
  draftSavedAt,
  saving,
  gstEnabled,
  gstRate,
  otherCharges,
  onGstEnabled,
  onGstRate,
  onOtherCharge,
  onParty,
  onNewCustomer,
  onItem,
  onQuickItem,
  onFavourite,
  onRepeat,
  onLine,
  onRemove,
  onPad,
  onPaid,
  onPaymentPlan,
  onMode,
  onSave,
}: {
  language: Language;
  documentType: CounterDocument;
  onDocumentType: (type: CounterDocument) => void;
  party?: Party;
  lines: InvoiceLine[];
  bill: ReturnType<typeof calculateBill>;
  paid: number;
  paymentMode: PaymentChannel;
  paymentPlan: SalePaymentPlan;
  items: Item[];
  quickItems: Item[];
  favouriteItemIds: string[];
  partySummary: { latestInvoice?: Invoice; latestPayment?: Payment; due: number; tier: Party["priceTier"] } | null;
  draftSavedAt: string;
  saving: boolean;
  gstEnabled: boolean;
  gstRate: number;
  otherCharges: DraftInvoiceCharge[];
  onGstEnabled: (enabled: boolean) => void;
  onGstRate: (rate: number) => void;
  onOtherCharge: (
    code: InvoiceChargeCode,
    patch: Partial<Pick<DraftInvoiceCharge, "enabled" | "amount">>,
  ) => void;
  onParty: () => void;
  onNewCustomer: () => void;
  onItem: () => void;
  onQuickItem: (item: Item) => void;
  onFavourite: (item: Item) => void;
  onRepeat: () => void;
  onLine: (i: number, patch: Partial<InvoiceLine>) => void;
  onRemove: (i: number) => void;
  onPad: (p: PadState) => void;
  onPaid: (n: number) => void;
  onPaymentPlan: (plan: SalePaymentPlan) => void;
  onMode: (m: PaymentChannel) => void;
  onSave: (a: "save" | "print" | "whatsapp") => void;
}) {
  const isQuotation = documentType === "quotation";
  const taxable = Math.max(0, bill.subtotal - bill.discountTotal);
  const paymentReady =
    isQuotation ||
    paymentPlan === "full" ||
    Boolean(
      party &&
        (paymentPlan === "credit" || (paid > 0 && paid < bill.grandTotal)),
    );
  const projectedBalance = (party?.currentBalance || 0) + bill.amountDue;
  const documentLabel = isQuotation
    ? t(language, "newQuotation")
    : bilingual(language, "newBill");
  return (
    <section className="mx-auto max-w-5xl px-3 py-4 md:px-7 md:py-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[.15em] text-[#d86f29]">
            {t(language, "fastCounter")}
          </p>
          <h2 className="mt-1 text-2xl font-black">{documentLabel}</h2>
        </div>
        <div className="flex rounded-xl border border-[#dcd8cf] bg-white p-1">
          <button
            type="button"
            onClick={() => onDocumentType("sale")}
            className={`min-h-10 rounded-lg px-3 text-[10px] font-black ${!isQuotation ? "bg-[#014921] text-white" : "text-[#66736d]"}`}
          >
            {t(language, "saleBill")}
          </button>
          <button
            type="button"
            onClick={() => onDocumentType("quotation")}
            className={`min-h-10 rounded-lg px-3 text-[10px] font-black ${isQuotation ? "bg-[#ef7d32] text-white" : "text-[#66736d]"}`}
          >
            {t(language, "quotation")}
          </button>
        </div>
        {draftSavedAt && <span className="rounded-full bg-[#f4faf0] px-3 py-2 text-[9px] font-black text-[#267055]">✓ Draft saved {new Date(draftSavedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      <div className="grid gap-4 md:grid-cols-[1.45fr_.75fr]">
        <div>
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_108px] gap-2">
            <button
              onClick={onParty}
              className="flex min-h-16 min-w-0 items-center justify-between rounded-2xl border-2 border-[#d8d4c9] bg-white px-4 text-left shadow-sm active:scale-[.99]"
            >
              <div className="min-w-0">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-[#728079]">
                  {bilingual(language, "customer")}
                </span>
                <div
                  className={`mt-1 truncate text-base font-black ${party ? "text-[#173f35]" : "text-[#7a827e]"}`}
                >
                  {party?.name || bilingual(language, "cashCustomer")}
                </div>
                {party && (
                  <div className="mt-1 truncate text-xs font-semibold text-[#bd6427]">
                    {t(language, "udhaar")}: {formatMoney(party.currentBalance)}
                  </div>
                )}
              </div>
              <span className="ml-2 shrink-0 text-2xl text-[#ef7d32]">⌄</span>
            </button>
            <button
              type="button"
              onClick={onNewCustomer}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-[#8fbd9f] bg-[#f4faf0] px-2 text-center text-[10px] font-black leading-tight text-[#014921]"
            >
              <span className="mb-1 text-xl leading-none text-[#309d4b]">
                ＋
              </span>
              {t(language, "newCustomer")}
            </button>
          </div>
          {party && partySummary && <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-[#e2e2db] bg-[#f7f5ef] p-3 sm:grid-cols-4"><div><span className="field-caption">Price tier</span><strong className="mt-1 block text-[11px] capitalize">{partySummary.tier}</strong></div><div><span className="field-caption">Last bill</span><strong className="mt-1 block text-[11px]">{partySummary.latestInvoice ? `${shortDate(partySummary.latestInvoice.date)} · ${formatMoney(partySummary.latestInvoice.grandTotal)}` : "None"}</strong></div><div><span className="field-caption">Last payment</span><strong className="mt-1 block text-[11px]">{partySummary.latestPayment ? `${shortDate(partySummary.latestPayment.date)} · ${formatMoney(partySummary.latestPayment.amount)}` : "None"}</strong></div><button type="button" disabled={!partySummary.latestInvoice} onClick={onRepeat} className="min-h-11 rounded-lg border border-[#014921] bg-white px-2 text-[9px] font-black text-[#014921] disabled:opacity-40">↻ Repeat last bill</button></div>}
          <button
            onClick={onItem}
            className="mb-3 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-[#ef7d32] px-4 text-left font-black text-white shadow-lg shadow-orange-900/10 active:scale-[.99]"
          >
            <span className="text-2xl">＋</span>
            <span>{bilingual(language, "addItem")}</span>
            <span className="ml-auto text-xs font-semibold opacity-80">
              {items.length} {t(language, "items")}
            </span>
          </button>
          {quickItems.length > 0 && <div className="mb-3"><div className="mb-2 flex items-center justify-between"><p className="field-caption">Quick products · favourites first</p><span className="text-[8px] text-[#747573]">Tap ☆ to pin</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{quickItems.map((item) => <div key={item.id} className="relative"><button type="button" onClick={() => onQuickItem(item)} className="flex min-h-[76px] w-full items-center gap-2 rounded-xl border border-[#e2e2db] bg-white p-2 pr-8 text-left"><ProductThumb item={item} className="h-10 w-10"/><span className="min-w-0"><strong className="block truncate text-[10px]">{item.name}</strong><span className="mt-1 block text-[8px] text-[#747573]">{item.skuCode}</span></span></button><button type="button" aria-label={`${favouriteItemIds.includes(item.id) ? "Remove" : "Add"} favourite ${item.name}`} onClick={() => onFavourite(item)} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-[#f4faf0] text-sm text-[#014921]">{favouriteItemIds.includes(item.id) ? "★" : "☆"}</button></div>)}</div></div>}
          <GstControl
            language={language}
            enabled={gstEnabled}
            rate={gstRate}
            taxable={taxable}
            gstAmount={bill.gstTotal}
            onEnabled={onGstEnabled}
            onRate={onGstRate}
            onPad={onPad}
          />
          {!lines.length ? (
            <div className="rounded-3xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] px-5 py-14 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#fff0df] text-3xl">
                {isQuotation ? "▤" : "🧾"}
              </div>
              <h3 className="mt-4 font-black">
                {bilingual(language, "noItems")}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#748078]">
                {t(language, "searchHelp")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {lines.map((line, index) => (
                <BillLine
                  key={line.itemId}
                  language={language}
                  line={line}
                  item={items.find((item) => item.id === line.itemId)}
                  index={index}
                  onLine={onLine}
                  onRemove={onRemove}
                  onPad={onPad}
                />
              ))}
            </div>
          )}
        </div>
        <aside className="h-fit rounded-3xl border border-[#ddd7ca] bg-white p-4 shadow-sm md:sticky md:top-24">
          <h3 className="text-sm font-black">
            {isQuotation
              ? t(language, "quotationSummary")
              : t(language, "payment")}
          </h3>
          {isQuotation ? (
            <div className="mt-3 rounded-xl bg-[#f4faf0] p-3">
              <strong className="text-xs text-[#014921]">
                {t(language, "estimateOnly")}
              </strong>
              <p className="mt-1 text-[9px] font-semibold leading-4 text-[#66736d]">
                {t(language, "estimateHelp")}
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <p className="field-caption mb-2">
                {t(language, "paymentChoice")}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["full", "partial", "credit"] as SalePaymentPlan[]).map(
                  (plan) => (
                    <button
                      type="button"
                      key={plan}
                      aria-pressed={paymentPlan === plan}
                      onClick={() => {
                        onPaymentPlan(plan);
                        if (plan === "partial")
                          onPad({
                            title: t(language, "enterPartPayment"),
                            value: paid,
                            decimal: true,
                            apply: onPaid,
                          });
                      }}
                      className={`min-h-12 rounded-xl border px-1 text-[10px] font-black ${paymentPlan === plan ? "border-[#014921] bg-[#014921] text-white" : "border-[#ddd7ca] bg-white text-[#40544c]"}`}
                    >
                      {t(
                        language,
                        plan === "full"
                          ? "fullPayment"
                          : plan === "partial"
                            ? "partialPayment"
                            : "payLater",
                      )}
                    </button>
                  ),
                )}
              </div>
              {paymentPlan === "partial" && (
                <button
                  type="button"
                  onClick={() =>
                    onPad({
                      title: t(language, "enterPartPayment"),
                      value: paid,
                      decimal: true,
                      apply: onPaid,
                    })
                  }
                  className="mt-3 flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-[#efb17f] bg-[#fff8ef] px-4"
                >
                  <span className="text-xs font-bold text-[#8d5a35]">
                    {t(language, "amountReceived")}
                  </span>
                  <strong className="text-xl text-[#173f35]">
                    {formatMoney(paid)}
                  </strong>
                </button>
              )}
              {paymentPlan !== "credit" && (
                <>
                  <p className="field-caption mb-2 mt-3">
                    {t(language, "amountReceived")} {t(language, "via")}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["cash", "upi", "bank"] as PaymentChannel[]).map(
                      (mode) => (
                        <button
                          type="button"
                          key={mode}
                          onClick={() => onMode(mode)}
                          className={`min-h-10 rounded-xl border text-[10px] font-black uppercase ${paymentMode === mode ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#ddd7ca] bg-white"}`}
                        >
                          {t(language, mode)}
                        </button>
                      ),
                    )}
                  </div>
                </>
              )}
              {paymentPlan !== "full" && !party && (
                <button
                  type="button"
                  onClick={onParty}
                  className="mt-3 min-h-11 w-full rounded-xl border border-[#e5a46f] bg-[#fff0df] px-3 text-[10px] font-black text-[#9a4f22]"
                >
                  ⚠ {t(language, "selectCustomerForDue")}
                </button>
              )}
              {paymentPlan === "partial" && party && paid <= 0 && (
                <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[10px] font-black text-[#9a4f22]">
                  {t(language, "enterPartPayment")}
                </p>
              )}
              {paymentPlan === "partial" &&
                paid >= bill.grandTotal &&
                bill.grandTotal > 0 && (
                  <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[10px] font-black text-[#9a4f22]">
                    {t(language, "partPaymentLessThan")}{" "}
                    {formatMoney(bill.grandTotal)}.{" "}
                    {t(language, "chooseFullPayment")}
                  </p>
                )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#eaf4ee] p-3">
                  <span className="block text-[8px] font-black uppercase text-[#567268]">
                    {t(language, "receivedNow")}
                  </span>
                  <strong className="mt-1 block text-sm text-[#267055]">
                    {formatMoney(bill.amountPaid)}
                  </strong>
                </div>
                <div className="rounded-xl bg-[#fff0df] p-3">
                  <span className="block text-[8px] font-black uppercase text-[#8c694e]">
                    {t(language, "addedToDues")}
                  </span>
                  <strong className="mt-1 block text-sm text-[#b75b2b]">
                    {formatMoney(bill.amountDue)}
                  </strong>
                </div>
              </div>
              {party && bill.amountDue > 0 && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-[#e1d8c8] bg-[#faf8f2] p-3 text-[10px]">
                  <span className="font-bold text-[#66736d]">
                    {t(language, "balanceAfterBill")}
                  </span>
                  <strong className="text-sm text-[#b75b2b]">
                    {formatMoney(projectedBalance)}
                  </strong>
                </div>
              )}
            </div>
          )}
          <OtherChargesControl
            language={language}
            charges={otherCharges}
            total={bill.otherChargesTotal}
            onChange={onOtherCharge}
            onPad={onPad}
          />
          <div className="mt-5 space-y-2 border-t border-dashed border-[#d9d4c9] pt-4 text-sm">
            <TotalRow label={t(language, "subtotal")} value={bill.subtotal} />
            <TotalRow
              label={t(language, "discount")}
              value={-bill.discountTotal}
            />
            <TotalRow label={t(language, "taxable")} value={taxable} />
            <TotalRow
              label={`${t(language, "gst")} ${gstEnabled ? `${gstRate}%` : t(language, "gstOff")}`}
              value={bill.gstTotal}
            />
            {bill.otherChargesTotal > 0 && (
              <TotalRow
                label={t(language, "otherCharges")}
                value={bill.otherChargesTotal}
              />
            )}
            <TotalRow label={t(language, "roundOff")} value={bill.roundOff} />
            <TotalRow
              label={
                isQuotation
                  ? t(language, "quotationTotal")
                  : t(language, "total")
              }
              value={bill.grandTotal}
              strong
            />
            {!isQuotation && (
              <TotalRow label={t(language, "due")} value={bill.amountDue} due />
            )}
          </div>
          <div className="mt-4 hidden gap-2 md:grid">
            <button
              disabled={!lines.length || saving || !paymentReady}
              onClick={() => onSave("print")}
              className="counter-secondary"
            >
              {isQuotation ? t(language, "printQuote") : t(language, "print")}
            </button>
            <button
              disabled={!lines.length || saving || !paymentReady}
              onClick={() => onSave("whatsapp")}
              className="counter-secondary text-emerald-700"
            >
              {isQuotation
                ? t(language, "shareQuote")
                : t(language, "whatsapp")}
            </button>
            <button
              disabled={!lines.length || saving || !paymentReady}
              onClick={() => onSave("save")}
              className="counter-primary"
            >
              {saving
                ? "…"
                : isQuotation
                  ? t(language, "saveQuotation")
                  : t(language, "saveBill")}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function GstControl({
  language,
  enabled,
  rate,
  taxable,
  gstAmount,
  onEnabled,
  onRate,
  onPad,
}: {
  language: Language;
  enabled: boolean;
  rate: number;
  taxable: number;
  gstAmount: number;
  onEnabled: (enabled: boolean) => void;
  onRate: (rate: number) => void;
  onPad: (state: PadState) => void;
}) {
  const choose = (next: number) => {
    if (!enabled) onEnabled(true);
    onRate(next);
  };
  const custom = ![18, 25].includes(rate);
  return (
    <section className={`gst-control mb-3 ${enabled ? "enabled" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onEnabled(!enabled)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="gst-switch" aria-hidden="true">
            <span />
          </span>
          <span className="min-w-0">
            <strong className="block text-xs">
              {t(language, "gstOnBill")}
            </strong>
            <span className="block truncate text-[9px] font-semibold text-[#707873]">
              {enabled
                ? `${rate}% ${t(language, "gstApplied")}`
                : t(language, "gstOff")}
            </span>
          </span>
        </button>
        <div className="text-right">
          <span className="block text-[8px] font-black uppercase tracking-wide text-[#7b827e]">
            {t(language, "gst")}
          </span>
          <strong className="text-sm text-[#014921]">
            {formatMoney(gstAmount)}
          </strong>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => choose(18)}
          className={`gst-rate ${enabled && rate === 18 ? "active" : ""}`}
        >
          18%
        </button>
        <button
          type="button"
          onClick={() => choose(25)}
          className={`gst-rate ${enabled && rate === 25 ? "active" : ""}`}
        >
          25%
        </button>
        <button
          type="button"
          onClick={() =>
            onPad({
              title: t(language, "customGst"),
              value: rate,
              decimal: true,
              apply: (value) => {
                if (!enabled) onEnabled(true);
                onRate(value);
              },
            })
          }
          className={`gst-rate ${enabled && custom ? "active" : ""}`}
        >
          {custom ? `${rate}%` : t(language, "manual")}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] font-semibold text-[#707873]">
        <span>
          {t(language, "taxable")}: {formatMoney(taxable)}
        </span>
        <span>{t(language, "gstRange")}</span>
      </div>
    </section>
  );
}

function OtherChargesControl({
  language,
  charges,
  total,
  onChange,
  onPad,
}: {
  language: Language;
  charges: DraftInvoiceCharge[];
  total: number;
  onChange: (
    code: InvoiceChargeCode,
    patch: Partial<Pick<DraftInvoiceCharge, "enabled" | "amount">>,
  ) => void;
  onPad: (state: PadState) => void;
}) {
  const labelKey: Record<
    InvoiceChargeCode,
    "carrierCharge" | "packingCharge" | "bigBoxCharge"
  > = {
    carrier: "carrierCharge",
    packing: "packingCharge",
    big_box: "bigBoxCharge",
  };
  const editAmount = (charge: DraftInvoiceCharge) =>
    onPad({
      title: `${t(language, labelKey[charge.code])} · ${t(language, "chargeAmount")}`,
      value: charge.amount,
      decimal: true,
      apply: (amount) => onChange(charge.code, { enabled: true, amount }),
    });
  return (
    <section className="mt-4 rounded-2xl border border-[#ddd7ca] bg-[#faf8f2] p-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-black">{t(language, "otherCharges")}</h4>
          <p className="mt-1 text-[9px] font-semibold text-[#748078]">
            {t(language, "chargeHelp")}
          </p>
        </div>
        <strong className="text-sm text-[#014921]">{formatMoney(total)}</strong>
      </div>
      <div className="mt-3 space-y-2">
        {charges.map((charge) => (
          <div
            key={charge.code}
            className={`rounded-xl border p-2.5 transition ${charge.enabled ? "border-[#9fc6a9] bg-white" : "border-[#e1ddd4] bg-[#f5f2eb]"}`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={charge.enabled}
                aria-label={`${t(language, labelKey[charge.code])} ${charge.enabled ? t(language, "removeCharge") : t(language, "addCharge")}`}
                onClick={() => {
                  const enabled = !charge.enabled;
                  onChange(charge.code, { enabled });
                  if (enabled && charge.amount === 0) editAmount(charge);
                }}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${charge.enabled ? "bg-[#014921]" : "bg-[#c9c7bf]"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${charge.enabled ? "left-6" : "left-1"}`}
                />
              </button>
              <button
                type="button"
                onClick={() =>
                  charge.enabled
                    ? editAmount(charge)
                    : editAmount({ ...charge, enabled: true })
                }
                className="min-w-0 flex-1 text-left"
              >
                <strong className="block truncate text-[11px]">
                  {t(language, labelKey[charge.code])}
                </strong>
                <span className="mt-0.5 block text-[9px] font-semibold text-[#78817c]">
                  {charge.enabled
                    ? charge.amount > 0
                      ? formatMoney(charge.amount)
                      : t(language, "chargeAmount")
                    : t(language, "gstOff")}
                </span>
              </button>
              {charge.enabled && (
                <>
                  <button
                    type="button"
                    onClick={() => editAmount(charge)}
                    className="min-h-9 rounded-lg bg-[#fff0df] px-2.5 text-[10px] font-black text-[#a95721]"
                  >
                    {charge.amount > 0
                      ? formatMoney(charge.amount)
                      : `₹ ${t(language, "addCharge")}`}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t(language, "removeCharge")} ${t(language, labelKey[charge.code])}`}
                    onClick={() =>
                      onChange(charge.code, { enabled: false, amount: 0 })
                    }
                    className="grid h-9 w-9 place-items-center rounded-lg bg-[#f6e9e3] text-base font-black text-[#a74e38]"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductThumb({
  item,
  className = "h-14 w-14",
}: {
  item: Item;
  className?: string;
}) {
  if (item.imageUrl)
    return (
      // Product photos are offline data URLs, so the framework image optimizer cannot serve them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.imageUrl}
        alt={item.name}
        loading="lazy"
        decoding="async"
        className={`${className} shrink-0 rounded-lg border border-[#e2e2db] object-cover`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`${className} grid shrink-0 place-items-center rounded-lg border border-dashed border-[#cfd3cc] bg-[#f4faf0] text-xl text-[#309d4b]`}
    >
      ▧
    </span>
  );
}

function BillLine({
  language,
  line,
  item,
  index,
  onLine,
  onRemove,
  onPad,
}: {
  language: Language;
  line: InvoiceLine;
  item?: Item;
  index: number;
  onLine: (i: number, p: Partial<InvoiceLine>) => void;
  onRemove: (i: number) => void;
  onPad: (p: PadState) => void;
}) {
  const amount =
    line.qty * line.rate * (1 - line.discount / 100) * (1 + line.gstRate / 100);
  const units = allowedSaleUnits(line.baseUnit || line.unit);
  const presets = quantityPresets(line.unit);
  const lastPriceLabel = line.lastPriceLabel?.replace(
    /^Last:/,
    `${t(language, "lastPrice")}:`,
  );
  return (
    <article className="rounded-2xl border border-[#ddd7ca] bg-white p-3.5 shadow-sm">
      <div className="flex gap-3">
        {item && <ProductThumb item={item} className="h-12 w-12" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-black">
                {line.itemName}
              </h3>
              <p className="mt-1 text-[10px] font-bold text-[#78827d]">
                {line.skuCode} · GST {line.gstRate}%
              </p>
            </div>
            <button
              onClick={() => onRemove(index)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f6eee8] text-lg font-bold text-[#b5553b]"
            >
              ×
            </button>
          </div>
          {lastPriceLabel && (
            <button
              onClick={() => onLine(index, { lockPrice: !line.lockPrice })}
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-extrabold ${line.lockPrice ? "bg-[#fff0da] text-[#a7591f]" : "bg-[#eaf4ee] text-[#286c52]"}`}
            >
              {line.lockPrice ? "🔒" : "↺"} {lastPriceLabel}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1.15fr_.9fr_.8fr] gap-2">
        <div>
          <span className="field-caption">{t(language, "quantity")}</span>
          <div className="mt-1 flex min-h-12 items-center rounded-xl border-2 border-[#d8d4c9]">
            <button
              onClick={() =>
                onLine(index, { qty: Math.max(0.01, line.qty - 1) })
              }
              className="h-12 w-11 text-xl font-black"
            >
              −
            </button>
            <button
              onClick={() =>
                onPad({
                  title: `${line.itemName} · ${t(language, "quantity")}`,
                  value: line.qty,
                  decimal: true,
                  apply: (value) =>
                    onLine(index, { qty: Math.max(0.01, value) }),
                })
              }
              className="h-12 flex-1 border-x border-[#ddd7ca] text-base font-black"
            >
              {line.qty}
            </button>
            <button
              onClick={() => onLine(index, { qty: line.qty + 1 })}
              className="h-12 w-11 text-xl font-black"
            >
              ＋
            </button>
          </div>
        </div>
        <div>
          <span className="field-caption">{t(language, "unit")}</span>
          <select
            value={line.unit}
            onChange={(e) => {
              const unit = e.target.value as Unit;
              onLine(index, {
                unit,
                rate: convertUnitRate(line.rate, line.unit, unit),
              });
            }}
            className="mt-1 h-12 w-full rounded-xl border-2 border-[#d8d4c9] bg-white px-2 text-sm font-black"
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unitShort(unit)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-caption">{t(language, "rate")} ₹</span>
          <button
            onClick={() =>
              onPad({
                title: `${line.itemName} · ${t(language, "rate")}`,
                value: line.rate,
                decimal: true,
                apply: (value) => onLine(index, { rate: value }),
              })
            }
            className="mt-1 h-12 w-full rounded-xl border-2 border-[#efb17f] bg-[#fff8ef] px-2 text-base font-black"
          >
            {line.rate}
          </button>
        </div>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Quick quantity presets">
        {presets.map((value) => <button key={value} type="button" onClick={() => onLine(index, { qty: value })} className={`min-h-9 min-w-10 shrink-0 rounded-lg border px-2 text-[9px] font-black ${line.qty === value ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d4c9] bg-[#f7f5ef]"}`}>{value}</button>)}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-[#ddd7ca] pt-3">
        <button
          onClick={() =>
            onPad({
              title: `${t(language, "discount")} %`,
              value: line.discount,
              decimal: true,
              apply: (value) =>
                onLine(index, { discount: Math.min(100, value) }),
            })
          }
          className="rounded-lg bg-[#f1efe9] px-3 py-2 text-xs font-bold"
        >
          {t(language, "discountShort")} {line.discount}%
        </button>
        <strong className="text-lg">{formatMoney(amount)}</strong>
      </div>
    </article>
  );
}

function BillDock({
  documentType,
  bill,
  language,
  gstEnabled,
  gstRate,
  disabled,
  saving,
  onSave,
}: {
  documentType: CounterDocument;
  bill: ReturnType<typeof calculateBill>;
  language: Language;
  gstEnabled: boolean;
  gstRate: number;
  disabled: boolean;
  saving: boolean;
  onSave: (a: "save" | "print" | "whatsapp") => void;
}) {
  const quotation = documentType === "quotation";
  return (
    <div className="fixed inset-x-0 bottom-[68px] z-30 mx-auto max-w-6xl border-t border-[#d4cec0] bg-[#fffdf8]/98 px-3 py-2.5 shadow-[0_-12px_30px_rgba(30,48,42,.08)] backdrop-blur md:hidden">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-extrabold uppercase text-[#78827d]">
            {quotation
              ? t(language, "quotationTotal")
              : `${t(language, "total")} · ${t(language, "due")} ${formatMoney(bill.amountDue)}`}
          </span>
          <div className="text-xl font-black">
            {formatMoney(bill.grandTotal)}
          </div>
          {bill.otherChargesTotal > 0 && (
            <span className="text-[9px] font-bold text-[#b65d25]">
              + {t(language, "otherCharges")}{" "}
              {formatMoney(bill.otherChargesTotal)}
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${gstEnabled ? "bg-[#e9f3ed] text-[#286c52]" : "bg-[#f0ede6] text-[#747573]"}`}
        >
          {t(language, "gst")}{" "}
          {gstEnabled
            ? `${gstRate}% · ${formatMoney(bill.gstTotal)}`
            : t(language, "gstOff")}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1.25fr] gap-2">
        <button
          disabled={disabled}
          onClick={() => onSave("print")}
          className="counter-secondary"
        >
          {quotation ? t(language, "printQuote") : t(language, "print")}
        </button>
        <button
          disabled={disabled}
          onClick={() => onSave("whatsapp")}
          className="counter-secondary text-emerald-700"
        >
          {quotation ? t(language, "shareQuote") : t(language, "whatsapp")}
        </button>
        <button
          disabled={disabled}
          onClick={() => onSave("save")}
          className="counter-primary"
        >
          {saving
            ? "…"
            : quotation
              ? t(language, "saveQuotation")
              : t(language, "saveOnly")}
        </button>
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  due,
}: {
  label: string;
  value: number;
  strong?: boolean;
  due?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${strong ? "border-t border-[#d9d4c9] pt-3 text-lg font-black" : ""} ${due ? "font-black text-[#b44d30]" : ""}`}
    >
      <span>{label}</span>
      <span>{formatMoney(value)}</span>
    </div>
  );
}

function BottomNav({
  tab,
  language,
  workspace,
  onChange,
}: {
  tab: Tab;
  language: Language;
  workspace: WorkspacePreferences;
  onChange: (tab: Tab) => void;
}) {
  const allTabs: [Tab, string, string][] = [
    ["bill", "▤", t(language, "bill")],
    ["parties", "◎", t(language, "parties")],
    ["dues", "₹", t(language, "dues")],
    ["items", "◫", t(language, "items")],
    ["misc", "↘", t(language, "misc")],
    ["reports", "▥", t(language, "reports")],
    ["more", "•••", t(language, "more")],
  ];
  const byKey = new Map(allTabs.map((row) => [row[0], row]));
  const tabs = workspace.order.filter((key) => !workspace.hidden.includes(key)).map((key) => byKey.get(key as Tab)).filter((row): row is [Tab, string, string] => Boolean(row));
  return (
    <nav
      aria-label="Main navigation"
      style={{ "--nav-count": tabs.length } as React.CSSProperties}
      className="app-main-nav fixed inset-x-0 bottom-0 z-40 grid h-[68px] border-t border-[#d7d1c5] bg-[#fbfaf6] px-1 pb-[env(safe-area-inset-bottom)] md:inset-y-[64px] md:right-auto md:h-auto md:w-[220px] md:!grid-cols-1 md:auto-rows-min md:content-start md:border-r md:border-t-0 md:px-3 md:py-5"
    >
      <p className="mb-3 hidden px-3 text-[10px] font-black uppercase tracking-[.16em] text-[#a29f97] md:block">
        {t(language, "workspace")}
      </p>
      {tabs.map(([key, icon, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-current={tab === key ? "page" : undefined}
          className={`app-nav-item min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl text-[8px] font-extrabold md:min-h-12 md:flex-row md:justify-start md:gap-3 md:px-3 md:text-sm ${tab === key ? "active" : ""}`}
        >
          <span className="app-nav-icon text-xl leading-none">
            {icon}
          </span>
          <span className="app-nav-label max-w-full truncate">{label}</span>
        </button>
      ))}
      <div className="mt-auto hidden rounded-2xl bg-[#173f35] p-4 text-white md:block">
        <p className="text-[9px] font-black uppercase tracking-[.14em] text-[#aac0b8]">
          {t(language, "counterReady")}
        </p>
        <p className="mt-2 text-xs font-bold">{t(language, "offlineReady")}</p>
      </div>
    </nav>
  );
}

function PartyPicker({
  parties,
  selected,
  onClose,
  onSelect,
  onToast,
}: {
  parties: Party[];
  selected?: Party;
  onClose: () => void;
  onSelect: (p?: Party) => void;
  onToast: (m: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [phone, setPhone] = useState("");
  const [codeName, setCodeName] = useState("");
  const [address, setAddress] = useState("");
  const matches = parties
    .filter((party) => partyMatchesSearch(party, query))
    .slice(0, 12);
  const exact = matches.some((party) =>
    [party.name, party.codeName].some(
      (value) => value.toLowerCase() === query.trim().toLowerCase(),
    ),
  );
  async function create() {
    if (!query.trim()) return;
    try {
      const next = await createQuickParty(query, phone, codeName, address);
      onSelect(next);
      onToast(`${next.name} created with code ${next.codeName}`);
    } catch (cause) {
      onToast(
        cause instanceof Error ? cause.message : "Could not create customer",
      );
    }
  }
  return (
    <SheetFrame title="Choose customer · ग्राहक चुनें" onClose={onClose}>
      <div className="space-y-3">
        <button
          onClick={() => onSelect(undefined)}
          className={`flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 text-left ${!selected ? "border-[#ef7d32] bg-[#fff6eb]" : "border-[#ddd7ca] bg-white"}`}
        >
          <div>
            <strong>Cash customer · নগদ ক্রেতা</strong>
            <p className="mt-1 text-[10px] text-[#748078]">No ledger balance</p>
          </div>
          <span>›</span>
        </button>
        <label className="search-box">
          <span>⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, code, address or phone"
          />
        </label>
        {query && !exact && (
          <div className="rounded-2xl border-2 border-dashed border-[#efb17f] bg-[#fff9f0] p-3">
            <p className="text-xs font-black">New customer: “{query}”</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={codeName}
                onChange={(event) =>
                  setCodeName(event.target.value.toUpperCase())
                }
                placeholder="Code name (optional)"
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm uppercase"
              />
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                placeholder="Phone (optional)"
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm"
              />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Customer address"
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm sm:col-span-2"
              />
              <button
                onClick={create}
                className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white sm:col-span-2"
              >
                ＋ Create & save customer
              </button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {matches.map((party) => (
            <button
              key={party.id}
              onClick={() => onSelect(party)}
              className="flex min-h-[76px] w-full items-center justify-between rounded-2xl border border-[#ddd7ca] bg-white px-4 text-left active:bg-[#fff7ed]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <strong className="truncate text-sm">{party.name}</strong>
                  <span className="shrink-0 rounded-lg bg-[#e7f3ec] px-2 py-1 text-[8px] font-black text-[#25684f]">
                    {party.codeName}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] font-semibold text-[#748078]">
                  {party.address || "No address"}
                </p>
                <p className="mt-1 text-[9px] text-[#8a928e]">
                  {party.phone || "No phone"} · {party.priceTier}
                </p>
              </div>
              <div className="ml-3 shrink-0 text-right">
                <span className="text-xs font-black text-[#b75d26]">
                  {formatMoney(party.currentBalance)}
                </span>
                <p className="text-[9px] text-[#8a928e]">outstanding</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </SheetFrame>
  );
}

function DueCustomerPicker({
  parties,
  onClose,
  onSelect,
  onNewCustomer,
}: {
  parties: Party[];
  onClose: () => void;
  onSelect: (party: Party) => void;
  onNewCustomer: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = parties
    .filter((party) => partyMatchesSearch(party, query))
    .slice(0, 20);
  return (
    <SheetFrame
      title="Add due manually · बकाया जोड़ें · বাকি যোগ করুন"
      onClose={onClose}
    >
      <div className="rounded-2xl bg-[#f4faf0] p-3">
        <p className="text-xs font-black text-[#014921]">
          Choose the customer who owes this amount.
        </p>
        <p className="mt-1 text-[10px] font-semibold text-[#66736d]">
          You can choose any saved customer, even when their current balance is
          zero.
        </p>
      </div>
      <button
        type="button"
        onClick={onNewCustomer}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#8fbd9f] bg-white text-xs font-black text-[#014921]"
      >
        <span className="text-lg text-[#309d4b]">＋</span> New customer
      </button>
      <label className="search-box my-3">
        <span>⌕</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customer name, code, address or phone"
        />
      </label>
      <div className="space-y-2">
        {matches.map((party) => (
          <button
            type="button"
            key={party.id}
            onClick={() => onSelect(party)}
            className="flex min-h-[76px] w-full items-center justify-between rounded-2xl border border-[#ddd7ca] bg-white px-4 text-left active:bg-[#f4faf0]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm">{party.name}</strong>
                <span className="shrink-0 rounded-lg bg-[#e7f3ec] px-2 py-1 text-[8px] font-black text-[#25684f]">
                  {party.codeName}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] font-semibold text-[#748078]">
                {party.address || "No address saved"}
              </p>
              <p className="mt-1 text-[9px] text-[#8a928e]">
                {party.phone || "No phone"}
              </p>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <strong className="text-xs text-[#b75d26]">
                {formatMoney(party.currentBalance)}
              </strong>
              <p className="mt-1 text-[9px] text-[#8a928e]">current due ›</p>
            </div>
          </button>
        ))}
      </div>
      {!matches.length && (
        <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] p-8 text-center">
          <p className="text-sm font-black">No customer found</p>
          <button
            type="button"
            onClick={onNewCustomer}
            className="mt-3 text-xs font-black text-[#014921] underline"
          >
            Create this customer first
          </button>
        </div>
      )}
    </SheetFrame>
  );
}

function ItemPicker({
  items,
  favouriteItemIds,
  onClose,
  onSelect,
  onToast,
  onFavourite,
}: {
  items: Item[];
  favouriteItemIds: string[];
  onClose: () => void;
  onSelect: (i: Item) => void;
  onToast: (m: string) => void;
  onFavourite: (item: Item) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const matches = useMemo(() => [...items]
    .map((item) => {
      const matchScore = fuzzyScore(query, item);
      return { item, matchScore, score: matchScore + (favouriteItemIds.includes(item.id) ? 20000 : 0) };
    })
    .filter((x) => !query || x.matchScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24), [items, query, favouriteItemIds]);
  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const item = await createQuickItem(query, 0);
      onSelect(item);
      onToast(`“${item.name}” created. Tap rate to set price.`);
    } catch (cause) {
      onToast(
        cause instanceof Error ? cause.message : "Could not create this item.",
      );
      setCreating(false);
    }
  }
  const showCreate = shouldOfferInlineItemCreation(query, items);
  return (
    <SheetFrame title="Add item · পণ্য যোগ করুন" onClose={onClose} full>
      <label className="search-box sticky top-0 z-10">
        <span>⌕</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, SKU, हिंदी, বাংলা"
        />
      </label>
      <p className="my-3 text-[10px] font-black uppercase tracking-[.14em] text-[#7d8782]">
        {query ? `${matches.length} matches` : "Recent & frequent · সাম্প্রতিক"}
      </p>
      {showCreate && (
        <button
          disabled={creating}
          onClick={create}
          className="mb-3 flex min-h-14 w-full items-center rounded-2xl border-2 border-dashed border-[#ef9e61] bg-[#fff7ed] px-4 text-left text-sm font-black text-[#b75b20] disabled:opacity-50"
        >
          ＋ {creating ? "Creating…" : `Create “${query.trim()}”`}
        </button>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {matches.map(({ item }) => (
          <div
            key={item.id}
            className="relative"
          >
          <button
            onClick={() => onSelect(item)}
            className="flex min-h-[76px] w-full items-center gap-3 rounded-2xl border border-[#ddd7ca] bg-white px-3 pr-10 text-left shadow-sm active:scale-[.99]"
          >
            <ProductThumb item={item} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{item.name}</strong>
              <p className="mt-1 truncate text-[10px] text-[#727f78]">
                {item.nameBn || item.nameHi || item.skuCode}
              </p>
              <p className="mt-1 text-[9px] font-bold text-[#9a6a49]">
                {item.skuCode} · per {unitShort(item.baseUnit)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <strong className="text-sm">
                {formatMoney(item.priceWholesale)}
              </strong>
              <p className="mt-1 text-[9px] text-[#758079]">Stock —</p>
            </div>
          </button>
          <button type="button" onClick={() => onFavourite(item)} aria-label={`${favouriteItemIds.includes(item.id) ? "Remove" : "Add"} favourite ${item.name}`} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-[#f4faf0] text-[#014921]">{favouriteItemIds.includes(item.id) ? "★" : "☆"}</button>
          </div>
        ))}
      </div>
    </SheetFrame>
  );
}

function DraftProductPhoto({ imageUrl }: { imageUrl?: string }) {
  if (!imageUrl)
    return (
      <span>
        <b>＋</b>Add product photo
      </span>
    );
  // Product photos are offline data URLs, so the framework image optimizer cannot serve them.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt="Product preview"
      className="h-full w-full object-cover"
    />
  );
}

function ProductEditor({
  item,
  categories,
  language,
  ownerMode,
  onPad,
  onClose,
  onSaved,
}: {
  item: Item | null;
  categories: Category[];
  language: Language;
  ownerMode: boolean;
  onPad: (state: PadState) => void;
  onClose: () => void;
  onSaved: (item: Item, mode: "created" | "updated" | "archived") => void;
}) {
  const [name, setName] = useState(item?.name || "");
  const [nameHi, setNameHi] = useState(item?.nameHi || "");
  const [nameBn, setNameBn] = useState(item?.nameBn || "");
  const [sku, setSku] = useState(item?.skuCode || "");
  const [categoryId, setCategoryId] = useState(
    item?.categoryId || "cat-uncategorized",
  );
  const [unit, setUnit] = useState<Unit>(item?.baseUnit || "piece");
  const [purchase, setPurchase] = useState(String(item?.purchasePrice || ""));
  const [wholesale, setWholesale] = useState(
    String(item?.priceWholesale || ""),
  );
  const [bulk, setBulk] = useState(String(item?.priceBulk || ""));
  const [retail, setRetail] = useState(String(item?.priceRetail || ""));
  const [itemGst, setItemGst] = useState(String(item?.gstRate ?? 18));
  const [hsn, setHsn] = useState(item?.hsnCode || "");
  const [family, setFamily] = useState(item ? variantFamily(item) : "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function choosePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      setImageUrl(await prepareProductImage(file));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare this photo.",
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    const cleanName = name.trim();
    const cleanSku = sku.trim().toUpperCase();
    if (!cleanName) return setError("Enter a product name.");
    if (!cleanSku) return setError("Enter a SKU code.");
    setSaving(true);
    setError("");
    try {
      const duplicate = await db.items
        .where("skuCode")
        .equals(cleanSku)
        .first();
      if (duplicate && duplicate.id !== item?.id)
        throw new Error(
          `SKU ${cleanSku} is already used by ${duplicate.name}.`,
        );
      const stamp = nowIso();
      const next: Item = {
        id: item?.id || makeId(),
        name: cleanName,
        nameHi: nameHi.trim(),
        nameBn: nameBn.trim(),
        skuCode: cleanSku,
        categoryId,
        baseUnit: unit,
        conversionRate: unit === "gross" ? 12 : 1,
        purchasePrice: Math.max(0, Number(purchase) || 0),
        priceWholesale: Math.max(0, Number(wholesale) || 0),
        priceBulk: Math.max(0, Number(bulk) || Number(wholesale) || 0),
        priceRetail: Math.max(0, Number(retail) || 0),
        currentStock: item?.currentStock ?? null,
        lowStockAlert: item?.lowStockAlert ?? null,
        festivalTags: withVariantFamily(item?.festivalTags || [], family),
        hsnCode: hsn.trim() || undefined,
        gstRate:
          Math.round(Math.min(25, Math.max(0, Number(itemGst) || 0)) * 100) /
          100,
        imageUrl,
        isActive: true,
        saleCount: item?.saleCount || 0,
        lastSoldDate: item?.lastSoldDate,
        createdAt: item?.createdAt || stamp,
        updatedAt: stamp,
        isSynced: false,
      };
      await db.items.put(next);
      onSaved(next, item ? "updated" : "created");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this product.",
      );
      setSaving(false);
    }
  }

  async function archive() {
    if (
      !item ||
      !confirm(
        `Archive ${item.name}? It will disappear from billing but remain on old invoices.`,
      )
    )
      return;
    const updated = {
      ...item,
      isActive: false,
      updatedAt: nowIso(),
      isSynced: false,
    };
    await db.items.put(updated);
    onSaved(updated, "archived");
  }

  return (
    <SheetFrame
      title={item ? "Edit product · পণ্য বদলান" : "Add product · পণ্য যোগ করুন"}
      onClose={onClose}
      full
    >
      <div className="grid gap-4 md:grid-cols-[150px_1fr]">
        <div>
          <label className="product-editor-photo">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={photoBusy}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                void choosePhoto(file);
              }}
            />
            <DraftProductPhoto imageUrl={imageUrl} />
            <em>
              {photoBusy
                ? "Preparing…"
                : imageUrl
                  ? "Tap to replace"
                  : "JPG, PNG or WebP"}
            </em>
          </label>
          {imageUrl && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Remove this product photo?"))
                  setImageUrl(undefined);
              }}
              className="mt-2 w-full text-[10px] font-black text-[#8b4840] underline"
            >
              Remove photo
            </button>
          )}
        </div>
        <div className="grid gap-3">
          <label className="product-field md:col-span-2">
            <span>Product name *</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Moti Mala 24 inch Blue"
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="product-field">
              <span>Hindi name</span>
              <input
                value={nameHi}
                onChange={(e) => setNameHi(e.target.value)}
                placeholder="हिंदी नाम"
              />
            </label>
            <label className="product-field">
              <span>Bengali name</span>
              <input
                value={nameBn}
                onChange={(e) => setNameBn(e.target.value)}
                placeholder="বাংলা নাম"
              />
            </label>
            <label className="product-field">
              <span>SKU code *</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                placeholder="MM-24-BLU"
              />
            </label>
            <label className="product-field">
              <span>Category</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="product-field">
              <span>Variant family</span>
              <input value={family} onChange={(event) => setFamily(event.target.value)} placeholder="e.g. Moti Mala 12 inch" />
            </label>
            <label className="product-field">
              <span>Sale unit</span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
              >
                {(
                  [
                    "piece",
                    "dozen",
                    "gross",
                    "bundle",
                    "box",
                    "packet",
                  ] as Unit[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {ownerMode && (
              <label className="product-field owner-cost-field">
                <span>
                  {t(language, "ownerOnly")} · {t(language, "purchaseCost")} ₹
                </span>
                <button
                  type="button"
                  className="product-amount"
                  onClick={() =>
                    onPad({
                      title: "Purchase price",
                      value: Number(purchase) || 0,
                      decimal: true,
                      apply: (value) => setPurchase(String(value)),
                    })
                  }
                >
                  {formatMoney(Number(purchase) || 0)}
                </button>
              </label>
            )}
            <label className="product-field">
              <span>Wholesale price ₹ *</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: "Wholesale price",
                    value: Number(wholesale) || 0,
                    decimal: true,
                    apply: (value) => setWholesale(String(value)),
                  })
                }
              >
                {formatMoney(Number(wholesale) || 0)}
              </button>
            </label>
            <label className="product-field">
              <span>Bulk price ₹</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: "Bulk price",
                    value: Number(bulk) || Number(wholesale) || 0,
                    decimal: true,
                    apply: (value) => setBulk(String(value)),
                  })
                }
              >
                {bulk ? formatMoney(Number(bulk) || 0) : "Same as wholesale"}
              </button>
            </label>
            <label className="product-field">
              <span>Retail price ₹</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: "Retail price",
                    value: Number(retail) || 0,
                    decimal: true,
                    apply: (value) => setRetail(String(value)),
                  })
                }
              >
                {formatMoney(Number(retail) || 0)}
              </button>
            </label>
            <label className="product-field">
              <span>Default GST %</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: "Default GST rate",
                    value: Number(itemGst) || 0,
                    decimal: true,
                    apply: (value) => setItemGst(String(Math.min(25, value))),
                  })
                }
              >
                {Number(itemGst) || 0}%
              </button>
            </label>
            <label className="product-field">
              <span>HSN code</span>
              <input
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
                inputMode="numeric"
                placeholder="Optional"
              />
            </label>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
            >
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="counter-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || photoBusy}
              className="counter-primary"
            >
              {saving
                ? "Saving…"
                : item
                  ? "Save changes"
                  : "Add & save product"}
            </button>
          </div>
          {item && (
            <button
              type="button"
              onClick={archive}
              className="min-h-10 text-xs font-black text-[#8b4840] underline underline-offset-4"
            >
              Archive this product
            </button>
          )}
        </div>
      </div>
    </SheetFrame>
  );
}

function SheetFrame({
  title,
  onClose,
  full,
  children,
}: {
  title: string;
  onClose: () => void;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="sheet-backdrop fixed inset-0 z-50 bg-[#102d27]/45 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] flex-col rounded-t-[28px] bg-[#fbfaf6] shadow-2xl ${full ? "max-w-3xl" : "max-w-xl"}`}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#ddd7ca] px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-10 rounded-full bg-[#d6d0c4] md:hidden" />
            <h2 className="text-base font-black">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-[#eeeae1] text-xl font-bold"
          >
            ×
          </button>
        </header>
        <div className="overflow-y-auto p-3.5 pb-8 md:p-5">{children}</div>
      </section>
    </div>
  );
}

function NumberPad({
  state,
  onClose,
}: {
  state: NonNullable<PadState>;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(state.value || ""));
  const [fresh, setFresh] = useState(true);
  const press = (key: string) => {
    if (key === "⌫") {
      setFresh(false);
      return setText((x) => (fresh ? "" : x.slice(0, -1)));
    }
    if (key === "." && text.includes(".") && !fresh) return;
    setText((x) => {
      const next = fresh
        ? key === "."
          ? "0."
          : key
        : `${x}${key}`.replace(/^00+/, "0");
      return next.length <= 12 ? next : x;
    });
    setFresh(false);
  };
  return (
    <div
      className="fixed inset-0 z-[70] bg-[#102d27]/45"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[28px] bg-[#fbfaf6] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wide text-[#758079]">
              Enter value
            </p>
            <h2 className="mt-1 text-sm font-black">{state.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-[#eeeae1] text-xl"
          >
            ×
          </button>
        </div>
        <div className="mb-3 overflow-hidden rounded-2xl bg-[#173f35] px-4 py-3 text-right text-3xl font-black text-white">
          {text || "0"}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "00",
            "0",
            state.decimal ? "." : "⌫",
          ].map((key) => (
            <button
              key={key}
              onClick={() => press(key)}
              className="h-14 rounded-2xl border border-[#d7d1c5] bg-white text-xl font-black active:bg-[#fff1df]"
            >
              {key}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-[.7fr_1.3fr] gap-2">
          <button
            onClick={() => press("⌫")}
            className="h-13 rounded-2xl bg-[#eee9df] text-lg font-black"
          >
            ⌫
          </button>
          <button
            onClick={() => {
              const value = Number(text || 0);
              if (Number.isFinite(value)) state.apply(value);
              onClose();
            }}
            className="h-13 rounded-2xl bg-[#ef7d32] text-sm font-black text-white"
          >
            Done · ঠিক আছে
          </button>
        </div>
      </section>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-unused-vars -- retained briefly for IndexedDB UI migration comparison */
function LegacyPartiesScreen({
  parties,
  invoices,
  payments,
  language,
  businessName,
  selected,
  onParty,
  onBack,
  onPayment,
  onToast,
}: {
  parties: Party[];
  invoices: Invoice[];
  payments: {
    id: string;
    partyId: string;
    amount: number;
    date: string;
    mode: string;
  }[];
  language: Language;
  businessName: string;
  selected: Party | null;
  onParty: (p: Party) => void;
  onBack: () => void;
  onPayment: (p: Party) => void;
  onToast: (m: string) => void;
}) {
  const [query, setQuery] = useState("");
  if (selected) {
    const current =
      parties.find((party) => party.id === selected.id) || selected;
    return (
      <LegacyPartyLedger
        party={current}
        invoices={invoices.filter((x) => x.partyId === current.id)}
        payments={payments.filter((x) => x.partyId === current.id)}
        businessName={businessName}
        onBack={onBack}
        onPayment={() => onPayment(current)}
        onToast={onToast}
      />
    );
  }
  const list = parties.filter((p) =>
    `${p.name} ${p.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  const total = parties.reduce((sum, p) => sum + p.currentBalance, 0);
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Customer khata</p>
          <h2 className="page-title">{bilingual(language, "parties")}</h2>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-[#748078]">
            Total to collect
          </p>
          <strong className="text-lg text-[#b75b2b]">
            {formatMoney(total)}
          </strong>
        </div>
      </div>
      <label className="search-box my-4">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone"
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => onParty(p)}
            className="flex min-h-[72px] items-center justify-between rounded-2xl border border-[#ddd7ca] bg-white p-3.5 text-left shadow-sm"
          >
            <div>
              <strong>{p.name}</strong>
              <p className="mt-1 text-[10px] text-[#768079]">
                {p.phone} · {p.priceTier}
              </p>
            </div>
            <div className="text-right">
              <strong
                className={
                  p.currentBalance > 0 ? "text-[#b95b2a]" : "text-[#2d7358]"
                }
              >
                {formatMoney(p.currentBalance)}
              </strong>
              <p className="mt-1 text-[9px] text-[#818983]">View ledger ›</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function LegacyPartyLedger({
  party,
  invoices,
  payments,
  businessName,
  onBack,
  onPayment,
  onToast,
}: {
  party: Party;
  invoices: Invoice[];
  payments: { id: string; amount: number; date: string; mode: string }[];
  businessName: string;
  onBack: () => void;
  onPayment: () => void;
  onToast: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(party);
  const rows = [
    ...invoices
      .filter((x) => !x.deletedAt)
      .map((x) => ({
        id: x.id,
        date: x.date,
        type: "Bill",
        ref: x.invoiceNumber,
        amount: x.grandTotal,
        due: x.amountDue,
        invoice: x,
      })),
    ...payments.map((x) => ({
      id: x.id,
      date: x.date,
      type: "Payment",
      ref: x.mode.toUpperCase(),
      amount: -x.amount,
      due: 0,
      invoice: undefined,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  function remind() {
    const url = `https://wa.me/${party.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Namaste ${party.name}, your outstanding balance is ${formatMoney(party.currentBalance)}. Please arrange payment. — ${businessName}`)}`;
    void openExternalUrl(url).then((opened) => {
      if (!opened) window.open(url, "_blank", "noopener,noreferrer");
    });
  }
  async function deleteInvoice(invoice: Invoice) {
    if (!confirm(`Move ${invoice.invoiceNumber} to the 30-day bin?`)) return;
    const stamp = nowIso();
    await db.transaction("rw", [db.invoices, db.parties], async () => {
      const currentParty = await db.parties.get(party.id);
      await db.invoices.update(invoice.id, {
        deletedAt: stamp,
        updatedAt: stamp,
        isSynced: false,
      });
      if (currentParty)
        await db.parties.update(party.id, {
          currentBalance: Math.max(
            0,
            currentParty.currentBalance - invoice.amountDue,
          ),
          updatedAt: stamp,
          isSynced: false,
        });
    });
    onToast("Invoice moved to recoverable bin");
  }
  async function saveDetails() {
    if (!draft.name.trim()) return onToast("Party name cannot be empty");
    const stamp = nowIso();
    await db.parties.update(party.id, {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      gstin: draft.gstin?.trim().toUpperCase() || undefined,
      priceTier: draft.priceTier,
      updatedAt: stamp,
      isSynced: false,
    });
    setEditing(false);
    onToast("Party details saved");
  }
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <button
        onClick={onBack}
        className="mb-3 text-sm font-black text-[#b65d25]"
      >
        ‹ All parties
      </button>
      <div className="rounded-3xl bg-[#173f35] p-5 text-white">
        <p className="text-xs font-semibold text-[#bdd0c8]">
          {party.phone || "No phone"}
          {party.gstin && ` · GSTIN ${party.gstin}`}
        </p>
        <h2 className="mt-1 text-2xl font-black">{party.name}</h2>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#bcd0c8]">
              Outstanding · বাকি
            </p>
            <strong className="mt-1 block text-3xl text-[#ffb45f]">
              {formatMoney(party.currentBalance)}
            </strong>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black">
            {party.priceTier}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onPayment}
            className="min-h-12 rounded-xl bg-[#ef7d32] text-xs font-black"
          >
            ₹ Record payment
          </button>
          <button
            onClick={remind}
            className="min-h-12 rounded-xl bg-white text-xs font-black text-[#176b4d]"
          >
            WhatsApp reminder
          </button>
          <button
            onClick={() => setEditing((value) => !value)}
            className="col-span-2 min-h-11 rounded-xl bg-white/10 text-xs font-black"
          >
            ✎ Edit party details
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 rounded-2xl border border-[#ddd7ca] bg-white p-3">
          <h3 className="text-sm font-black">Party details · পার্টির তথ্য</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Party name"
              className="h-12 rounded-xl border border-[#d8d2c6] px-3 text-sm"
            />
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="Phone"
              inputMode="tel"
              className="h-12 rounded-xl border border-[#d8d2c6] px-3 text-sm"
            />
            <input
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="Address"
              className="h-12 rounded-xl border border-[#d8d2c6] px-3 text-sm"
            />
            <input
              value={draft.gstin || ""}
              onChange={(e) =>
                setDraft({ ...draft, gstin: e.target.value.toUpperCase() })
              }
              placeholder="GSTIN (optional)"
              className="h-12 rounded-xl border border-[#d8d2c6] px-3 text-sm uppercase"
            />
            <select
              value={draft.priceTier}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  priceTier: e.target.value as Party["priceTier"],
                })
              }
              className="h-12 rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm font-bold"
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="bulk">Bulk</option>
              <option value="special">Special</option>
            </select>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditing(false)}
              className="counter-secondary"
            >
              Cancel
            </button>
            <button onClick={saveDetails} className="counter-primary">
              Save details
            </button>
          </div>
        </div>
      )}
      <h3 className="mb-2 mt-5 text-sm font-black">
        Full history · সম্পূর্ণ খাতা
      </h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <article
            key={row.id}
            className="flex items-center justify-between rounded-2xl border border-[#ddd7ca] bg-white p-3.5"
          >
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-[9px] font-black ${row.type === "Payment" ? "bg-[#e6f4ed] text-[#2c7057]" : "bg-[#fff0df] text-[#b45c25]"}`}
                >
                  {row.type}
                </span>
                <strong className="text-xs">{row.ref}</strong>
              </div>
              <p className="mt-1 text-[10px] text-[#7a837e]">
                {shortDate(row.date)}{" "}
                {row.invoice && `· Due ${formatMoney(row.due)}`}
              </p>
            </div>
            <div className="text-right">
              <strong className={row.amount < 0 ? "text-[#267055]" : ""}>
                {row.amount < 0 ? "−" : ""}
                {formatMoney(Math.abs(row.amount))}
              </strong>
              {row.invoice && (
                <button
                  onClick={() => deleteInvoice(row.invoice!)}
                  className="mt-1 block w-full text-right text-[9px] font-bold text-[#b3513b]"
                >
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LegacyPaymentSheet({
  party,
  invoices,
  onClose,
  onPad,
  onSaved,
}: {
  party: Party;
  invoices: Invoice[];
  onClose: () => void;
  onPad: (p: PadState) => void;
  onSaved: (payment: Payment) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<"cash" | "upi" | "bank">("cash");
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedDue = invoices
    .filter((invoice) => selected.includes(invoice.id))
    .reduce((sum, invoice) => sum + invoice.amountDue, 0);
  async function save() {
    if (amount <= 0 || saving) return;
    setError("");
    setSaving(true);
    try {
      const payment = await recordPayment(
        party,
        amount,
        mode,
        reference,
        manual ? selected : undefined,
      );
      onSaved(payment);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not record payment.",
      );
      setSaving(false);
    }
  }
  return (
    <SheetFrame title={`Payment from ${party.name}`} onClose={onClose}>
      <button
        onClick={() =>
          onPad({
            title: "Payment amount",
            value: amount,
            decimal: true,
            apply: setAmount,
          })
        }
        className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-white"
      >
        <span className="text-xs font-bold text-[#c3d4cd]">
          Amount received
        </span>
        <strong className="text-2xl text-[#ffb45f]">
          {formatMoney(amount)}
        </strong>
      </button>
      <p className="mt-2 text-right text-[10px] font-bold text-[#748078]">
        Outstanding: {formatMoney(party.currentBalance)}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["cash", "upi", "bank"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setMode(x)}
            className={`h-11 rounded-xl border text-xs font-black uppercase ${mode === x ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d8d2c6] bg-white"}`}
          >
            {x}
          </button>
        ))}
      </div>
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Reference (optional)"
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      <label className="mt-4 flex items-center justify-between rounded-xl bg-[#f1eee7] p-3 text-xs font-black">
        <span>Manual bill allocation</span>
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => setManual(e.target.checked)}
          className="h-5 w-5 accent-[#ef7d32]"
        />
      </label>
      {manual && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold text-[#748078]">
            Choose bills. Payment applies oldest first among selected. Selected
            due: {formatMoney(selectedDue)}
          </p>
          {invoices.map((invoice) => (
            <label
              key={invoice.id}
              className="flex items-center justify-between rounded-xl border border-[#ddd7ca] bg-white p-3"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(invoice.id)}
                  onChange={(e) =>
                    setSelected((x) =>
                      e.target.checked
                        ? [...x, invoice.id]
                        : x.filter((id) => id !== invoice.id),
                    )
                  }
                  className="h-5 w-5 accent-[#ef7d32]"
                />
                <div>
                  <strong className="text-xs">{invoice.invoiceNumber}</strong>
                  <p className="text-[9px] text-[#7b837f]">
                    {shortDate(invoice.date)}
                  </p>
                </div>
              </div>
              <strong className="text-xs">
                {formatMoney(invoice.amountDue)}
              </strong>
            </label>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
        >
          {error}
        </p>
      )}
      <button
        onClick={save}
        disabled={
          amount <= 0 ||
          amount > party.currentBalance ||
          (manual && (!selected.length || amount > selectedDue)) ||
          saving
        }
        className="mt-4 h-14 w-full rounded-2xl bg-[#ef7d32] text-sm font-black text-white disabled:opacity-40"
      >
        {saving ? "Saving payment…" : "Save & allocate payment"}
      </button>
    </SheetFrame>
  );
}
/* eslint-enable @typescript-eslint/no-unused-vars */

function PartiesScreen({
  parties,
  invoices,
  payments,
  accountEntries,
  language,
  businessName,
  dueTemplate,
  selected,
  onParty,
  onBack,
  onCreate,
  onDue,
  onPayment,
  onToast,
}: {
  parties: Party[];
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
  language: Language;
  businessName: string;
  dueTemplate: string;
  selected: Party | null;
  onParty: (party: Party) => void;
  onBack: () => void;
  onCreate: (type: Party["type"]) => void;
  onDue: (party: Party) => void;
  onPayment: (party: Party) => void;
  onToast: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Party["type"]>(selected?.type || "customer");
  if (selected) {
    const current =
      parties.find((entry) => entry.id === selected.id) || selected;
    return (
      <PartyLedger
        party={current}
        invoices={invoices.filter((entry) => entry.partyId === current.id)}
        payments={payments.filter((entry) => entry.partyId === current.id)}
        accountEntries={accountEntries.filter(
          (entry) => entry.partyId === current.id,
        )}
        businessName={businessName}
        dueTemplate={dueTemplate}
        onBack={onBack}
        onDue={() => onDue(current)}
        onPayment={() => onPayment(current)}
        onToast={onToast}
      />
    );
  }
  const customers = parties.filter((entry) => entry.type === "customer");
  const suppliers = parties.filter((entry) => entry.type === "supplier");
  const totalToCollect = customers.reduce(
    (sum, entry) => sum + entry.currentBalance,
    0,
  );
  const totalToPay = suppliers.reduce(
    (sum, entry) => sum + entry.currentBalance,
    0,
  );
  const list = (type === "customer" ? customers : suppliers).filter((entry) =>
    partyMatchesSearch(entry, query),
  );
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Party accounts · পার্টি খাতা</p>
          <h2 className="page-title">{bilingual(language, "parties")}</h2>
        </div>
        <button
          onClick={() => onCreate(type)}
          className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white"
        >
          ＋ {t(language, "addParty")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setType("customer")}
          className={`party-type-tab ${type === "customer" ? "active" : ""}`}
        >
          <span>{t(language, "customers")}</span>
          <strong>{customers.length}</strong>
          <small>
            {t(language, "toCollect")} {formatMoney(totalToCollect)}
          </small>
        </button>
        <button
          onClick={() => setType("supplier")}
          className={`party-type-tab supplier ${type === "supplier" ? "active" : ""}`}
        >
          <span>{t(language, "suppliers")}</span>
          <strong>{suppliers.length}</strong>
          <small>
            {t(language, "toPay")} {formatMoney(totalToPay)}
          </small>
        </button>
      </div>
      <label className="search-box my-4">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            type === "customer"
              ? "Search customer name, code, address or phone"
              : "Search supplier name, code, address or phone"
          }
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onParty(entry)}
            className="flex min-h-[98px] items-center justify-between rounded-2xl border border-[#ddd7ca] bg-white p-3.5 text-left shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <strong className="truncate">{entry.name}</strong>
                <span
                  className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${entry.type === "supplier" ? "bg-[#fff0df] text-[#a95221]" : "bg-[#e7f3ec] text-[#25684f]"}`}
                >
                  {entry.codeName}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] font-semibold text-[#566760]">
                {entry.address || "No address saved"}
              </p>
              <p className="mt-1 text-[9px] text-[#768079]">
                {entry.phone || "No phone"}
                {entry.type === "customer"
                  ? ` · ${entry.priceTier}`
                  : " · goods supplier"}
              </p>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <strong
                className={
                  entry.currentBalance > 0 ? "text-[#b95b2a]" : "text-[#2d7358]"
                }
              >
                {formatMoney(entry.currentBalance)}
              </strong>
              <p className="mt-1 text-[9px] text-[#818983]">
                {entry.type === "supplier"
                  ? t(language, "toPay")
                  : t(language, "toCollect")}{" "}
                ›
              </p>
            </div>
          </button>
        ))}
      </div>
      {!list.length && (
        <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] p-8 text-center">
          <p className="text-sm font-black">No {type}s found</p>
          <button
            onClick={() => onCreate(type)}
            className="mt-3 rounded-xl bg-[#173f35] px-4 py-3 text-xs font-black text-white"
          >
            ＋ Add {type}
          </button>
        </div>
      )}
    </section>
  );
}

function PartyLedger({
  party,
  invoices,
  payments,
  accountEntries,
  businessName,
  dueTemplate,
  onBack,
  onDue,
  onPayment,
  onToast,
}: {
  party: Party;
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
  businessName: string;
  dueTemplate: string;
  onBack: () => void;
  onDue: () => void;
  onPayment: () => void;
  onToast: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(party);
  const allocationByInvoice = new Map<string, number>();
  for (const payment of payments)
    for (const allocation of payment.allocatedTo)
      allocationByInvoice.set(
        allocation.invoiceId,
        (allocationByInvoice.get(allocation.invoiceId) || 0) +
          allocation.amount,
      );
  const rawRows = [
    ...(party.openingBalance > 0
      ? [
          {
            id: `opening-${party.id}`,
            date: party.createdAt.slice(0, 10),
            timestamp: party.createdAt,
            type: "Opening",
            ref: "Opening balance",
            note:
              party.type === "supplier"
                ? "Payable brought forward"
                : "Receivable brought forward",
            delta: party.openingBalance,
            invoice: undefined as Invoice | undefined,
          },
        ]
      : []),
    ...invoices
      .filter(
        (entry) =>
          !entry.deletedAt &&
          entry.amountDue + (allocationByInvoice.get(entry.id) || 0) > 0,
      )
      .map((entry) => ({
        id: entry.id,
        date: entry.date,
        timestamp: entry.createdAt,
        type: "Bill",
        ref: entry.invoiceNumber,
        note: "Sales invoice",
        delta: entry.amountDue + (allocationByInvoice.get(entry.id) || 0),
        invoice: entry as Invoice | undefined,
      })),
    ...accountEntries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      timestamp: entry.createdAt,
      type: party.type === "supplier" ? "Supplier bill" : "Due",
      ref: entry.reference || entry.note,
      note: entry.note,
      delta: entry.amount,
      invoice: undefined as Invoice | undefined,
    })),
    ...payments.map((entry) => ({
      id: entry.id,
      date: entry.date,
      timestamp: entry.createdAt,
      type: "Payment",
      ref: entry.reference || entry.mode.toUpperCase(),
      note: `${party.type === "supplier" ? "Paid to supplier" : "Received from customer"} · ${entry.mode.toUpperCase()}`,
      delta: -entry.amount,
      invoice: undefined as Invoice | undefined,
    })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const rows = rawRows
    .reduce<Array<(typeof rawRows)[number] & { remaining: number }>>(
      (history, row) => {
        const previous = history.at(-1)?.remaining || 0;
        return [
          ...history,
          {
            ...row,
            remaining: Math.max(
              0,
              Math.round((previous + row.delta) * 100) / 100,
            ),
          },
        ];
      },
      [],
    )
    .reverse();
  function remind() {
    const message = renderMessageTemplate(dueTemplate, { party_name: party.name, party_code: party.codeName, due: formatMoney(party.currentBalance), shop_name: businessName });
    const url = `https://wa.me/${party.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
    void openExternalUrl(url).then((opened) => {
      if (!opened) window.open(url, "_blank", "noopener,noreferrer");
    });
  }
  async function deleteInvoice(invoice: Invoice) {
    if (!confirm(`Move ${invoice.invoiceNumber} to the 30-day bin?`)) return;
    const stamp = nowIso();
    await db.transaction("rw", [db.invoices, db.parties], async () => {
      const current = await db.parties.get(party.id);
      await db.invoices.update(invoice.id, {
        deletedAt: stamp,
        updatedAt: stamp,
        isSynced: false,
      });
      if (current)
        await db.parties.update(party.id, {
          currentBalance: Math.max(
            0,
            current.currentBalance - invoice.amountDue,
          ),
          updatedAt: stamp,
          isSynced: false,
        });
    });
    onToast("Invoice moved to recoverable bin");
  }
  async function saveDetails() {
    if (!draft.name.trim()) return onToast("Party name cannot be empty");
    const codeName = normalizePartyCode(draft.codeName);
    if (!codeName) return onToast("Enter a searchable code name");
    const duplicate = await db.parties
      .filter(
        (entry) =>
          entry.id !== party.id &&
          entry.codeName.toLowerCase() === codeName.toLowerCase(),
      )
      .first();
    if (duplicate)
      return onToast(
        `Code name ${codeName} is already used by ${duplicate.name}`,
      );
    if (
      draft.type !== party.type &&
      party.currentBalance > 0 &&
      !confirm(
        `Change this ${party.type} to a ${draft.type}? The ${formatMoney(party.currentBalance)} balance will change meaning.`,
      )
    )
      return;
    const stamp = nowIso();
    await db.parties.update(party.id, {
      name: draft.name.trim(),
      codeName,
      phone: draft.phone.trim(),
      address: draft.address.trim(),
      gstin: draft.gstin?.trim().toUpperCase() || undefined,
      type: draft.type,
      priceTier: draft.priceTier,
      notes: draft.notes.trim(),
      updatedAt: stamp,
      isSynced: false,
    });
    setEditing(false);
    onToast("Party code, address and details saved");
  }
  const isSupplier = party.type === "supplier";
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <button
        onClick={onBack}
        className="mb-3 text-sm font-black text-[#b65d25]"
      >
        ‹ All customers & suppliers
      </button>
      <div className="rounded-3xl bg-[#173f35] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-[#ffb45f] px-2 py-1 text-[9px] font-black uppercase text-[#173f35]">
                {party.codeName}
              </span>
              <p className="text-xs font-semibold text-[#bdd0c8]">
                {party.phone || "No phone"}
                {party.gstin && ` · GSTIN ${party.gstin}`}
              </p>
            </div>
            <h2 className="mt-2 text-2xl font-black">{party.name}</h2>
            <p className="mt-1 truncate text-[10px] text-[#c5d6d0]">
              ⌖ {party.address || "No address saved"}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase ${isSupplier ? "bg-[#ef7d32] text-white" : "bg-white/10 text-white"}`}
          >
            {party.type}
          </span>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#bcd0c8]">
              {isSupplier
                ? "We have to pay · देना है"
                : "Customer has to pay · लेना है"}
            </p>
            <strong className="mt-1 block text-3xl text-[#ffb45f]">
              {formatMoney(party.currentBalance)}
            </strong>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black">
            {party.currentBalance > 0 ? "Outstanding" : "Settled"}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onDue}
            className="min-h-12 rounded-xl bg-white text-xs font-black text-[#176b4d]"
          >
            ＋ {isSupplier ? "Add supplier bill" : "Add customer due"}
          </button>
          <button
            onClick={onPayment}
            disabled={party.currentBalance <= 0}
            className="min-h-12 rounded-xl bg-[#ef7d32] text-xs font-black disabled:opacity-45"
          >
            ₹ {isSupplier ? "Record payment paid" : "Record payment received"}
          </button>
          {!isSupplier && (
            <button
              onClick={remind}
              disabled={!party.phone}
              className="min-h-11 rounded-xl bg-white/10 text-xs font-black disabled:opacity-40"
            >
              WhatsApp reminder
            </button>
          )}
          <button
            onClick={() => {
              if (!editing) setDraft(party);
              setEditing((value) => !value);
            }}
            className={`min-h-11 rounded-xl bg-white/10 text-xs font-black ${isSupplier ? "col-span-2" : ""}`}
          >
            ✎ Edit code, address & details
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 rounded-2xl border border-[#ddd7ca] bg-white p-3">
          <h3 className="text-sm font-black">Party details · পার্টির তথ্য</h3>
          <p className="mt-1 text-[10px] text-[#748078]">
            Code name and address can be changed at any time and are both
            searchable.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="product-field md:col-span-2">
              <span>Account type</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDraft({ ...draft, type: "customer" })}
                  className={`party-kind-button ${draft.type === "customer" ? "active" : ""}`}
                >
                  Customer · ग्राहक
                </button>
                <button
                  onClick={() => setDraft({ ...draft, type: "supplier" })}
                  className={`party-kind-button ${draft.type === "supplier" ? "active" : ""}`}
                >
                  Supplier · सप्लायर
                </button>
              </div>
            </label>
            <label className="product-field">
              <span>Party name *</span>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Party name"
              />
            </label>
            <label className="product-field">
              <span>Searchable code name *</span>
              <input
                value={draft.codeName}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    codeName: event.target.value.toUpperCase(),
                  })
                }
                placeholder="e.g. RAM-01"
                className="uppercase"
              />
            </label>
            <label className="product-field">
              <span>Phone</span>
              <input
                value={draft.phone}
                onChange={(event) =>
                  setDraft({ ...draft, phone: event.target.value })
                }
                placeholder="Phone"
                inputMode="tel"
              />
            </label>
            <label className="product-field">
              <span>GSTIN</span>
              <input
                value={draft.gstin || ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    gstin: event.target.value.toUpperCase(),
                  })
                }
                placeholder="GSTIN (optional)"
                className="uppercase"
              />
            </label>
            <label className="product-field md:col-span-2">
              <span>Full address</span>
              <input
                value={draft.address}
                onChange={(event) =>
                  setDraft({ ...draft, address: event.target.value })
                }
                placeholder="Shop, market, area and city"
              />
            </label>
            <label className="product-field">
              <span>Price tier</span>
              <select
                value={draft.priceTier}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    priceTier: event.target.value as Party["priceTier"],
                  })
                }
              >
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
                <option value="bulk">Bulk</option>
                <option value="special">Special</option>
              </select>
            </label>
            <label className="product-field">
              <span>Notes</span>
              <input
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
                placeholder="Notes"
              />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditing(false)}
              className="counter-secondary"
            >
              Cancel
            </button>
            <button onClick={saveDetails} className="counter-primary">
              Save code & address
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 mt-5 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-black">
            Full account activity · সম্পূর্ণ খাতা
          </h3>
          <p className="mt-1 text-[10px] text-[#748078]">
            Every bill adds to the balance. Every payment shows its date and
            subtracts from the remaining due.
          </p>
        </div>
        <span className="text-[10px] font-black text-[#748078]">
          {rows.length} entries
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-2xl border border-[#ddd7ca] bg-white p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-1 text-[9px] font-black ${row.delta < 0 ? "bg-[#e6f4ed] text-[#2c7057]" : "bg-[#fff0df] text-[#b45c25]"}`}
                  >
                    {row.type}
                  </span>
                  <strong className="truncate text-xs">{row.ref}</strong>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-[#53635c]">
                  {fullInvoiceDate(row.date)} ·{" "}
                  {invoiceRecordedTime(row.timestamp)}
                </p>
                <p className="mt-1 text-[9px] text-[#7a837e]">{row.note}</p>
              </div>
              <div className="shrink-0 text-right">
                <strong
                  className={
                    row.delta < 0 ? "text-[#267055]" : "text-[#b75b2b]"
                  }
                >
                  {row.delta < 0 ? "−" : "+"}
                  {formatMoney(Math.abs(row.delta))}
                </strong>
                <p className="mt-1 text-[9px] font-black text-[#53635c]">
                  Remaining due {formatMoney(row.remaining)}
                </p>
                {row.invoice && (
                  <button
                    onClick={() => deleteInvoice(row.invoice!)}
                    className="mt-1 text-[9px] font-bold text-[#b3513b]"
                  >
                    Delete bill
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!rows.length && (
          <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] p-8 text-center text-xs font-bold text-[#748078]">
            No activity yet. Add a due or supplier bill to begin this khata.
          </div>
        )}
      </div>
    </section>
  );
}

function PartyEditor({
  language,
  defaultType,
  customerOnly = false,
  onClose,
  onPad,
  onSaved,
}: {
  language: Language;
  defaultType: Party["type"];
  customerOnly?: boolean;
  onClose: () => void;
  onPad: (state: PadState) => void;
  onSaved: (party: Party) => void;
}) {
  const [type, setType] = useState<Party["type"]>(defaultType);
  const [name, setName] = useState("");
  const [codeName, setCodeName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [notes, setNotes] = useState("");
  const [opening, setOpening] = useState(0);
  const [priceTier, setPriceTier] = useState<Party["priceTier"]>("wholesale");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const created = await createParty({
        name,
        codeName,
        phone,
        address,
        gstin,
        type,
        priceTier,
        openingBalance: opening,
        notes,
      });
      onSaved(created);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save party.",
      );
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={
        customerOnly
          ? "Add new customer · नया ग्राहक · নতুন ক্রেতা"
          : "Add customer or supplier · नई पार्टी"
      }
      onClose={onClose}
    >
      {!customerOnly && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setType("customer")}
            className={`party-kind-button ${type === "customer" ? "active" : ""}`}
          >
            Customer
            <br />
            <small>{t(language, "toCollect")}</small>
          </button>
          <button
            onClick={() => setType("supplier")}
            className={`party-kind-button ${type === "supplier" ? "active" : ""}`}
          >
            Supplier
            <br />
            <small>{t(language, "toPay")}</small>
          </button>
        </div>
      )}
      <div
        className={`${customerOnly ? "" : "mt-4"} grid gap-3 md:grid-cols-2`}
      >
        <label className="product-field">
          <span>
            {type === "supplier" ? "Supplier name *" : "Customer name *"}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              type === "supplier"
                ? "e.g. Sharma Festival Goods"
                : "e.g. New Market Decorators"
            }
          />
        </label>
        <label className="product-field">
          <span>Searchable code name</span>
          <input
            value={codeName}
            onChange={(event) => setCodeName(event.target.value.toUpperCase())}
            placeholder="e.g. NMD-01 (auto if blank)"
            className="uppercase"
          />
        </label>
        <label className="product-field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="Optional"
          />
        </label>
        <label className="product-field">
          <span>GSTIN</span>
          <input
            value={gstin}
            onChange={(event) => setGstin(event.target.value.toUpperCase())}
            placeholder="Optional"
          />
        </label>
        <label className="product-field md:col-span-2">
          <span>Full address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Shop, market, area and city"
          />
        </label>
        {type === "customer" && (
          <label className="product-field">
            <span>Price tier</span>
            <select
              value={priceTier}
              onChange={(event) =>
                setPriceTier(event.target.value as Party["priceTier"])
              }
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="bulk">Bulk</option>
              <option value="special">Special</option>
            </select>
          </label>
        )}
        <label className="product-field">
          <span>
            {type === "supplier"
              ? "Opening amount we owe"
              : "Opening amount customer owes"}
          </span>
          <button
            type="button"
            className="product-amount"
            onClick={() =>
              onPad({
                title: "Opening due",
                value: opening,
                decimal: true,
                apply: setOpening,
              })
            }
          >
            {formatMoney(opening)}
          </button>
        </label>
        <label className="product-field md:col-span-2">
          <span>Notes</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Regular supplier, seasonal buyer, payment terms…"
          />
        </label>
      </div>
      <p className="mt-3 rounded-xl bg-[#eef5ee] p-3 text-[10px] font-semibold text-[#426252]">
        Name, code name, address and phone will all be searchable. You can edit
        them later from the account.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
        >
          {error}
        </p>
      )}
      <button
        onClick={save}
        disabled={!name.trim() || saving}
        className="mt-4 h-14 w-full rounded-2xl bg-[#ef7d32] text-sm font-black text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : `Save ${type}`}
      </button>
    </SheetFrame>
  );
}

function DueSheet({
  party,
  onClose,
  onPad,
  onSaved,
}: {
  party: Party;
  onClose: () => void;
  onPad: (state: PadState) => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isSupplier = party.type === "supplier";
  async function save() {
    if (amount <= 0 || saving) return;
    setError("");
    setSaving(true);
    try {
      await recordDue(party, amount, note, reference);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add this due.",
      );
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={`${isSupplier ? "Supplier bill" : "Customer due"} · ${party.name}`}
      onClose={onClose}
    >
      <div className="rounded-2xl bg-[#fff0df] p-3 text-xs font-bold text-[#8d481f]">
        This adds to{" "}
        {isSupplier
          ? "the amount you must pay this supplier"
          : "the amount this customer must pay you"}
        .
      </div>
      <button
        onClick={() =>
          onPad({
            title: isSupplier ? "Supplier bill amount" : "Customer due amount",
            value: amount,
            decimal: true,
            apply: setAmount,
          })
        }
        className="mt-3 flex min-h-16 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-white"
      >
        <span className="text-xs font-bold text-[#c3d4cd]">Amount to add</span>
        <strong className="text-2xl text-[#ffb45f]">
          {formatMoney(amount)}
        </strong>
      </button>
      <p className="mt-2 text-right text-[10px] font-bold text-[#748078]">
        New balance: {formatMoney(party.currentBalance + amount)}
      </p>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={
          isSupplier ? "What goods or bill is this for?" : "Reason for this due"
        }
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder="Bill/reference number (optional)"
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
        >
          {error}
        </p>
      )}
      <button
        onClick={save}
        disabled={amount <= 0 || saving}
        className="mt-4 h-14 w-full rounded-2xl bg-[#ef7d32] text-sm font-black text-white disabled:opacity-40"
      >
        {saving
          ? "Saving…"
          : isSupplier
            ? "Add supplier bill"
            : "Add customer due"}
      </button>
    </SheetFrame>
  );
}

function PaymentSheet({
  party,
  invoices,
  onClose,
  onPad,
  onSaved,
}: {
  party: Party;
  invoices: Invoice[];
  onClose: () => void;
  onPad: (state: PadState) => void;
  onSaved: (payment: Payment) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<"cash" | "upi" | "bank">("cash");
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isSupplier = party.type === "supplier";
  const paymentModes = [
    ["cash", "Cash"],
    ["upi", "Online · UPI"],
    ["bank", "Online · Bank"],
  ] as const;
  const selectedDue = invoices
    .filter((invoice) => selected.includes(invoice.id))
    .reduce((sum, invoice) => sum + invoice.amountDue, 0);
  async function save() {
    if (amount <= 0 || saving) return;
    setError("");
    setSaving(true);
    try {
      const payment = await recordPayment(
        party,
        amount,
        mode,
        reference,
        !isSupplier && manual ? selected : undefined,
      );
      onSaved(payment);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not record payment.",
      );
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={`${isSupplier ? "Payment to" : "Payment from"} ${party.name}`}
      onClose={onClose}
    >
      <button
        onClick={() =>
          onPad({
            title: "Payment amount",
            value: amount,
            decimal: true,
            apply: setAmount,
          })
        }
        className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-white"
      >
        <span className="text-xs font-bold text-[#c3d4cd]">
          {isSupplier ? "Amount paid" : "Amount received"}
        </span>
        <strong className="text-2xl text-[#ffb45f]">
          {formatMoney(amount)}
        </strong>
      </button>
      <div className="mt-2 flex justify-between text-[10px] font-bold text-[#748078]">
        <span>Outstanding {formatMoney(party.currentBalance)}</span>
        <span>
          Remaining {formatMoney(Math.max(0, party.currentBalance - amount))}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {paymentModes.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`min-h-11 rounded-xl border px-1 text-[10px] font-black ${mode === value ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d8d2c6] bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder="Online reference / cash note (optional)"
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      {!isSupplier && invoices.length > 0 && (
        <label className="mt-4 flex items-center justify-between rounded-xl bg-[#f1eee7] p-3 text-xs font-black">
          <span>Manually choose sales bills</span>
          <input
            type="checkbox"
            checked={manual}
            onChange={(event) => setManual(event.target.checked)}
            className="h-5 w-5 accent-[#ef7d32]"
          />
        </label>
      )}
      {!isSupplier && manual && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold text-[#748078]">
            Payment applies oldest first among selected bills. Selected due:{" "}
            {formatMoney(selectedDue)}
          </p>
          {invoices.map((invoice) => (
            <label
              key={invoice.id}
              className="flex items-center justify-between rounded-xl border border-[#ddd7ca] bg-white p-3"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(invoice.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, invoice.id]
                        : current.filter((id) => id !== invoice.id),
                    )
                  }
                  className="h-5 w-5 accent-[#ef7d32]"
                />
                <div>
                  <strong className="text-xs">{invoice.invoiceNumber}</strong>
                  <p className="text-[9px] text-[#7b837f]">
                    {shortDate(invoice.date)}
                  </p>
                </div>
              </div>
              <strong className="text-xs">
                {formatMoney(invoice.amountDue)}
              </strong>
            </label>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
        >
          {error}
        </p>
      )}
      <button
        onClick={save}
        disabled={
          amount <= 0 ||
          amount > party.currentBalance ||
          (!isSupplier &&
            manual &&
            (!selected.length || amount > selectedDue)) ||
          saving
        }
        className="mt-4 h-14 w-full rounded-2xl bg-[#ef7d32] text-sm font-black text-white disabled:opacity-40"
      >
        {saving
          ? "Saving payment…"
          : isSupplier
            ? "Save payment to supplier"
            : "Save customer payment"}
      </button>
    </SheetFrame>
  );
}

function ItemsScreen({
  items,
  language,
  ownerMode,
  onOwnerMode,
  onAdd,
  onCreate,
  onEdit,
  onPhoto,
}: {
  items: Item[];
  language: Language;
  ownerMode: boolean;
  onOwnerMode: (enabled: boolean) => void;
  onAdd: (item: Item) => void;
  onCreate: () => void;
  onEdit: (item: Item) => void;
  onPhoto: (item: Item, file?: File) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [photoBusy, setPhotoBusy] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(90);
  const [groupVariants, setGroupVariants] = useState(true);
  const matches = useMemo(() => items
    .map((item) => ({ item, score: fuzzyScore(query, item) }))
    .filter((x) => !query || x.score > 0)
    .sort((a, b) => b.score - a.score || variantFamily(a.item).localeCompare(variantFamily(b.item))), [items, query]);
  const visibleMatches = matches.slice(0, visibleLimit);
  const familyCount = useMemo(() => new Set(matches.map(({ item }) => variantFamily(item))).size, [matches]);
  async function choosePhoto(item: Item, file?: File) {
    if (!file) return;
    setPhotoBusy(item.id);
    try {
      await onPhoto(item, file);
    } catch {
    } finally {
      setPhotoBusy("");
    }
  }
  async function removePhoto(item: Item) {
    if (!confirm(`Remove the photo for ${item.name}?`)) return;
    setPhotoBusy(item.id);
    try {
      await onPhoto(item);
    } catch {
    } finally {
      setPhotoBusy("");
    }
  }
  return (
    <section className="mx-auto max-w-5xl px-3 py-5 md:px-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Product catalogue</p>
          <h2 className="page-title">Items · পণ্য</h2>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="min-h-11 shrink-0 rounded-lg bg-[#014921] px-4 text-xs font-black text-white"
        >
          ＋ Add product
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-[#6f7773]">
          Add, edit and photograph products. Every change is saved offline
          first.
        </p>
        <span className="shrink-0 rounded-xl bg-[#e9f3ed] px-3 py-2 text-xs font-black text-[#286c52]">
          {items.length} active
        </span>
      </div>
      <div className={`owner-mode-panel mt-4 ${ownerMode ? "active" : ""}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="owner-mode-badge">{t(language, "ownerOnly")}</span>
            <h3>{t(language, "ownerMode")}</h3>
          </div>
          <p>
            {ownerMode
              ? t(language, "ownerModeVisible")
              : t(language, "ownerModeHidden")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ownerMode}
          aria-label={t(language, "ownerMode")}
          onClick={() => onOwnerMode(!ownerMode)}
          className="owner-mode-toggle"
        >
          <span className="owner-mode-toggle-track" aria-hidden="true">
            <span />
          </span>
          <strong>
            {ownerMode
              ? t(language, "ownerModeOn")
              : t(language, "ownerModeOff")}
          </strong>
        </button>
      </div>
      <label className="search-box my-4">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisibleLimit(90); }}
          placeholder="Name, SKU, हिंदी, বাংলা"
        />
      </label>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#e2e2db] bg-white p-2"><div><strong className="text-[10px]">Variant families</strong><p className="text-[8px] text-[#747573]">{familyCount} groups across {matches.length} matching SKUs</p></div><button type="button" role="switch" aria-checked={groupVariants} onClick={() => { setGroupVariants((value) => !value); setVisibleLimit(90); }} className={`min-h-10 rounded-lg px-3 text-[9px] font-black ${groupVariants ? "bg-[#014921] text-white" : "border"}`}>{groupVariants ? "Grouped" : "Flat list"}</button></div>
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {visibleMatches.map(({ item }, index) => {
          const metrics = itemProfitMetrics(item);
          const family = variantFamily(item);
          const showFamily = groupVariants && (index === 0 || variantFamily(visibleMatches[index - 1].item) !== family);
          return (
            <div key={item.id} className="contents">
            {showFamily && <div className="col-span-full mt-2 flex items-center gap-2 border-b border-[#e2e2db] pb-2"><strong className="text-xs text-[#014921]">{family}</strong><span className="rounded-full bg-[#f4faf0] px-2 py-1 text-[8px] font-black">{matches.filter((row) => variantFamily(row.item) === family).length} variants</span></div>}
            <article
              className="rounded-2xl border border-[#ddd7ca] bg-white p-3.5 shadow-sm"
            >
            <div className="flex items-start gap-3">
              <label
                className="group relative shrink-0 cursor-pointer"
                aria-label={`${item.imageUrl ? "Replace" : "Add"} photo for ${item.name}`}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={photoBusy === item.id}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    input.value = "";
                    void choosePhoto(item, file);
                  }}
                />
                <ProductThumb item={item} className="h-[72px] w-[72px]" />
                <span className="absolute inset-x-1 bottom-1 rounded bg-[#014921]/90 py-1 text-center text-[8px] font-black text-white">
                  {photoBusy === item.id
                    ? "SAVING…"
                    : item.imageUrl
                      ? "CHANGE"
                      : "＋ PHOTO"}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black">{item.name}</h3>
                    <p className="mt-1 truncate text-[10px] text-[#737f78]">
                      {item.nameBn || item.nameHi}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-[#f0ede6] px-2 py-1 text-[9px] font-black">
                    {item.skuCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="mt-2 text-[9px] font-black text-[#014921] underline underline-offset-2"
                >
                  Edit product details
                </button>
                {item.imageUrl && (
                  <button
                    type="button"
                    onClick={() => void removePhoto(item)}
                    className="ml-3 mt-2 text-[9px] font-black text-[#8b4840] underline underline-offset-2"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[8px] font-bold text-[#77817c]">
                  WHOLESALE
                </span>
                <strong className="mt-1 block text-xs">
                  ₹{item.priceWholesale}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[8px] font-bold text-[#77817c]">
                  BULK
                </span>
                <strong className="mt-1 block text-xs">
                  ₹{item.priceBulk}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[8px] font-bold text-[#77817c]">GST</span>
                <strong className="mt-1 block text-xs">{item.gstRate}%</strong>
              </div>
            </div>
            {ownerMode && (
              <div
                className="item-owner-panel mt-3"
                aria-label={`${t(language, "ownerMode")} · ${item.name}`}
              >
                <div className="item-owner-panel-heading">
                  <span>{t(language, "ownerOnly")}</span>
                  <strong>{t(language, "profitOverview")}</strong>
                </div>
                <div className="item-profit-grid">
                  <div>
                    <span>{t(language, "purchaseCost")}</span>
                    <strong>
                      {metrics.costKnown
                        ? formatMoney(metrics.purchasePrice)
                        : t(language, "costNotSet")}
                    </strong>
                  </div>
                  <div>
                    <span>{t(language, "wholesaleSelling")}</span>
                    <strong>{formatMoney(metrics.sellingPrice)}</strong>
                  </div>
                  <div>
                    <span>{t(language, "profitPerUnit")}</span>
                    <strong
                      className={
                        metrics.profit != null && metrics.profit < 0
                          ? "negative"
                          : "positive"
                      }
                    >
                      {metrics.profit == null
                        ? "—"
                        : formatMoney(metrics.profit)}
                    </strong>
                  </div>
                  <div>
                    <span>{t(language, "grossMargin")}</span>
                    <strong
                      className={
                        metrics.marginPercent != null &&
                        metrics.marginPercent < 0
                          ? "negative"
                          : "positive"
                      }
                    >
                      {metrics.marginPercent == null
                        ? "—"
                        : `${metrics.marginPercent.toFixed(2)}%`}
                    </strong>
                  </div>
                </div>
                <p>
                  {t(language, "sellingTiers")}: {t(language, "wholesaleSelling")} {formatMoney(item.priceWholesale)} ·{" "}
                  {t(language, "bulkSelling")} {formatMoney(item.priceBulk)} ·{" "}
                  {t(language, "retailSelling")} {formatMoney(item.priceRetail)}
                </p>
              </div>
            )}
            <button
              onClick={() => onAdd(item)}
              className="mt-3 h-11 w-full rounded-xl border-2 border-[#ef9e61] text-xs font-black text-[#b75b20]"
            >
              ＋ Add to current bill
            </button>
            </article>
            </div>
          );
        })}
      </div>
      {visibleLimit < matches.length && <button type="button" onClick={() => setVisibleLimit((value) => value + 90)} className="counter-secondary mt-4">Load 90 more · {matches.length - visibleLimit} remaining</button>}
      {!matches.length && (
        <div className="rounded-xl border border-dashed border-[#cfd3cc] p-8 text-center">
          <p className="text-sm font-black">No matching product</p>
          <button
            onClick={onCreate}
            className="mt-3 text-xs font-black text-[#014921] underline"
          >
            Add it manually
          </button>
        </div>
      )}
    </section>
  );
}

type DashboardPeriod = "7d" | "30d" | "90d" | "all";

const dashboardModeColors: Record<string, string> = {
  cash: "#014921",
  upi: "#309d4b",
  credit: "#abd49e",
  mixed: "#5b8f66",
  bank: "#97ae9f",
};
const dashboardCategoryNames: Record<string, string> = {
  "cat-mala": "Moti Mala",
  "cat-puja": "Puja Decor",
  "cat-diwali": "Diwali",
  "cat-christmas": "Christmas",
  "cat-birthday": "Birthday",
  "cat-patriotic": "Patriotic",
  "cat-uncategorized": "Other",
};

function DashboardMetric({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  tone: "orange" | "green" | "blue" | "gold";
}) {
  const tones = {
    orange: "bg-[#f4faf0] text-[#014921]",
    green: "bg-[#f4faf0] text-[#309d4b]",
    blue: "bg-[#f3f2f1] text-[#014921]",
    gold: "bg-[#f4faf0] text-[#5b8f66]",
  };
  return (
    <article className="dashboard-card flex min-h-[112px] items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#8a918d]">
          {label}
        </p>
        <strong className="mt-2 block truncate text-[22px] tracking-tight text-[#173f35]">
          {value}
        </strong>
        <p className="mt-1 text-[10px] font-semibold text-[#7b8580]">{note}</p>
      </div>
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${tones[tone]}`}
      >
        {icon}
      </span>
    </article>
  );
}

const reportHistoryCopy: Record<
  Language,
  {
    section: string;
    helper: string;
    search: string;
    bills: string;
    spent: string;
    lastPurchase: string;
    noBills: string;
    back: string;
    savedBills: string;
    purchaseTotal: string;
    paid: string;
    due: string;
    viewBill: string;
    items: string;
    deleted: string;
  }
> = {
  en: {
    section: "Customer purchase history",
    helper: "Tap any customer to see every saved bill and purchase date.",
    search: "Search name, code, address or phone",
    bills: "bills",
    spent: "purchases",
    lastPurchase: "Last purchase",
    noBills: "No saved purchases yet",
    back: "Back to Reports",
    savedBills: "saved bills",
    purchaseTotal: "Purchase total",
    paid: "Paid",
    due: "Due",
    viewBill: "View full bill",
    items: "Items purchased",
    deleted: "In recoverable bin",
  },
  hi: {
    section: "ग्राहक खरीद इतिहास",
    helper:
      "हर सेव किया हुआ बिल और खरीद की तारीख देखने के लिए ग्राहक पर टैप करें।",
    search: "नाम, कोड, पता या फोन खोजें",
    bills: "बिल",
    spent: "कुल खरीद",
    lastPurchase: "अंतिम खरीद",
    noBills: "अभी कोई सेव की गई खरीद नहीं",
    back: "रिपोर्ट पर वापस",
    savedBills: "सेव किए बिल",
    purchaseTotal: "कुल खरीद",
    paid: "जमा",
    due: "बाकी",
    viewBill: "पूरा बिल देखें",
    items: "खरीदा सामान",
    deleted: "रिकवरी बिन में",
  },
  bn: {
    section: "ক্রেতার কেনাকাটার ইতিহাস",
    helper: "সব সেভ করা বিল ও কেনার তারিখ দেখতে ক্রেতার নামে চাপুন।",
    search: "নাম, কোড, ঠিকানা বা ফোন খুঁজুন",
    bills: "বিল",
    spent: "মোট কেনাকাটা",
    lastPurchase: "শেষ কেনাকাটা",
    noBills: "এখনও কোনো সেভ করা কেনাকাটা নেই",
    back: "রিপোর্টে ফিরুন",
    savedBills: "সেভ করা বিল",
    purchaseTotal: "মোট কেনাকাটা",
    paid: "জমা",
    due: "বাকি",
    viewBill: "সম্পূর্ণ বিল দেখুন",
    items: "কেনা পণ্য",
    deleted: "রিকভারি বিনে",
  },
};

const fullInvoiceDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const invoiceRecordedTime = (createdAt: string) =>
  new Date(createdAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const paymentModeLabel = (mode: Payment["mode"]) =>
  mode === "cash" ? "Cash" : mode === "upi" ? "Online · UPI" : "Online · Bank";
const invoicePaymentLabel = (invoice: Invoice) => {
  const channel =
    invoice.paymentReceivedMode ||
    (["cash", "upi", "bank"].includes(invoice.paymentMode)
      ? (invoice.paymentMode as PaymentChannel)
      : undefined);
  if (invoice.amountDue > 0)
    return invoice.amountPaid > 0
      ? `Part paid${channel ? ` · ${paymentModeLabel(channel)}` : ""}`
      : "Pay later · Credit";
  return channel
    ? paymentModeLabel(channel)
    : invoice.paymentMode === "mixed"
      ? "Mixed payment"
      : "Paid";
};

function DuesScreen({
  parties,
  invoices,
  payments,
  accountEntries,
  language,
  business,
  dueTemplate,
  selected,
  onParty,
  onBack,
  onAddDue,
  onPayment,
  onToast,
}: {
  parties: Party[];
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
  language: Language;
  business: BusinessSettings;
  dueTemplate: string;
  selected: Party | null;
  onParty: (party: Party) => void;
  onBack: () => void;
  onAddDue: (party?: Party) => void;
  onPayment: (party: Party) => void;
  onToast: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const allDueRows = useMemo(
    () => dueCustomerRows(parties, payments, "", invoices),
    [parties, payments, invoices],
  );
  const visibleRows = useMemo(
    () => dueCustomerRows(parties, payments, query, invoices),
    [parties, payments, invoices, query],
  );
  const totalDue = allDueRows.reduce(
    (sum, row) => sum + row.party.currentBalance,
    0,
  );
  const exportPartyStatement = async (
    party: Party,
    format: "pdf" | "text",
  ) => {
    const current = parties.find((entry) => entry.id === party.id) || party;
    const statement = partyDueStatement(
      current,
      invoices,
      payments,
      accountEntries,
    );
    try {
      const result =
        format === "pdf"
          ? await downloadDueStatementPdf(statement, business)
          : await downloadDueStatementText(statement, business);
      onToast(
        `${partyStatementLabel(current)} ${format === "pdf" ? "PDF" : "text"} due statement ${result}`,
      );
    } catch (cause) {
      onToast(
        cause instanceof Error
          ? cause.message
          : `Could not export the ${format.toUpperCase()} statement for ${partyStatementLabel(current)}.`,
      );
    }
  };
  if (selected) {
    const current =
      parties.find((party) => party.id === selected.id) || selected;
    const statement = partyDueStatement(
      current,
      invoices,
      payments,
      accountEntries,
    );
    const outstandingBills = invoices
      .filter(
        (invoice) =>
          invoice.partyId === current.id &&
          !invoice.deletedAt &&
          invoice.type === "sale" &&
          invoice.amountDue > 0,
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt),
      );
    const lastPayment = statement.lastPayment;
    return (
      <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
        <button
          onClick={onBack}
          className="mb-3 text-sm font-black text-[#b65d25]"
        >
          ‹ {t(language, "backToDues")}
        </button>
        <div className="overflow-hidden rounded-3xl bg-[#173f35] text-white shadow-sm">
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-[#ffb45f] px-2 py-1 text-[9px] font-black uppercase text-[#173f35]">
                    {current.codeName}
                  </span>
                  <span className="text-[10px] font-semibold text-[#c2d3cc]">
                    {t(language, "customerAccount")}
                  </span>
                </div>
                <h2 className="mt-2 truncate text-2xl font-black">
                  {partyStatementLabel(current)}
                </h2>
                <p className="mt-1 truncate text-[10px] text-[#c5d6d0]">
                  ⌖ {current.address || "No address saved"}
                </p>
                <p className="mt-1 text-[10px] text-[#c5d6d0]">
                  {current.phone || "No phone saved"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[9px] font-black uppercase tracking-wide text-[#bdd0c8]">
                  {t(language, "amountToPayNext")}
                </p>
                <strong className="mt-1 block text-2xl text-[#ffb45f]">
                  {formatMoney(statement.remainingDue)}
                </strong>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={() => onAddDue(current)}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[10px] font-black text-[#014921]"
              >
                ＋ {t(language, "addManualDue")}
              </button>
              <button
                onClick={() => onPayment(current)}
                disabled={statement.remainingDue <= 0}
                className="min-h-12 rounded-xl border border-white/20 bg-[#309d4b] px-2 text-[10px] font-black text-white disabled:opacity-45"
              >
                ₹ {t(language, "paymentReceived")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(current, "pdf")}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[10px] font-black text-[#014921]"
              >
                ↓ {t(language, "exportPdf")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(current, "text")}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[10px] font-black text-[#014921]"
              >
                ↓ {t(language, "exportText")}
              </button>
              <button
                type="button"
                disabled={!current.phone}
                onClick={() => {
                  const message = renderMessageTemplate(dueTemplate, { party_name: current.name, party_code: current.codeName, due: formatMoney(statement.remainingDue), shop_name: business.name });
                  const url = `https://wa.me/${current.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
                  void openExternalUrl(url).then((opened) => { if (!opened) window.open(url, "_blank", "noopener,noreferrer"); });
                }}
                className="min-h-12 rounded-xl border border-white/25 bg-[#309d4b] px-2 text-[10px] font-black text-white disabled:opacity-40"
              >
                WhatsApp reminder
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/10 bg-white/5 text-center sm:grid-cols-4">
            <div className="p-3">
              <span className="text-[8px] font-black uppercase text-[#b9cbc4]">
                {t(language, "dueAdded")}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalDueAdded)}
              </strong>
            </div>
            <div className="border-l border-white/10 p-3">
              <span className="text-[8px] font-black uppercase text-[#b9cbc4]">
                {t(language, "totalPaid")}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalPaid)}
              </strong>
            </div>
            <div className="border-t border-white/10 p-3 sm:border-l sm:border-t-0">
              <span className="text-[8px] font-black uppercase text-[#b9cbc4]">
                {t(language, "lastPayment")}
              </span>
              <strong className="mt-1 block text-[10px]">
                {lastPayment
                  ? `${formatMoney(lastPayment.amount)} · ${shortDate(lastPayment.date)}`
                  : t(language, "noPaymentRecorded")}
              </strong>
            </div>
            <div className="border-l border-t border-white/10 p-3 sm:border-t-0">
              <span className="text-[8px] font-black uppercase text-[#b9cbc4]">
                {t(language, "activity")}
              </span>
              <strong className="mt-1 block text-sm">
                {statement.rows.length}
              </strong>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Khata · खाता · খাতা</p>
            <h3 className="mt-1 text-xl font-black">
              {t(language, "dueStatement")}
            </h3>
            <p className="mt-1 text-[11px] font-black text-[#335f50]">
              {partyStatementLabel(current)}
            </p>
            <p className="mt-1 text-[10px] text-[#748078]">
              {t(language, "dueStatementHelp")}
            </p>
          </div>
          <span className="shrink-0 text-[10px] font-black text-[#748078]">
            {statement.rows.length} {t(language, "accountEntries")}
          </span>
        </div>
        {lastPayment && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ddd7ca] bg-white p-3">
            <div>
              <span className="field-caption">{t(language, "lastPayment")}</span>
              <strong className="mt-1 block text-xs">
                {fullInvoiceDate(lastPayment.date)} · {invoiceRecordedTime(lastPayment.createdAt)}
              </strong>
              <p className="mt-1 text-[9px] text-[#748078]">
                {paymentModeLabel(lastPayment.mode)}
                {lastPayment.reference ? ` · ${lastPayment.reference}` : ""}
              </p>
            </div>
            <strong className="text-lg text-[#267055]">
              −{formatMoney(lastPayment.amount)}
            </strong>
          </div>
        )}
        <div className="due-statement-scroller mt-3" role="region" aria-label={t(language, "dueStatement")} tabIndex={0}>
          <table className="due-statement-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>{t(language, "activity")}</th>
                <th>{t(language, "referenceMode")}</th>
                <th className="amount-column">{t(language, "dueAdded")} (+)</th>
                <th className="amount-column">{t(language, "paymentReceived")} (−)</th>
                <th className="amount-column">{t(language, "runningBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{fullInvoiceDate(row.date)}</strong>
                    <small>{invoiceRecordedTime(row.timestamp)}</small>
                  </td>
                  <td>
                    <strong>{row.activity}</strong>
                    <small>
                      {partyStatementLabel(current)} · {row.kind.replaceAll("_", " ")}
                    </small>
                  </td>
                  <td>
                    <strong>{row.reference || "—"}</strong>
                    {row.paymentMode && <small>{paymentModeLabel(row.paymentMode)}</small>}
                  </td>
                  <td className="amount-column due-added">
                    {row.dueAdded ? `+${formatMoney(row.dueAdded)}` : "—"}
                  </td>
                  <td className="amount-column payment-received">
                    {row.paymentReceived ? `−${formatMoney(row.paymentReceived)}` : "—"}
                  </td>
                  <td className="amount-column running-balance">
                    {formatMoney(row.runningBalance)}
                  </td>
                </tr>
              ))}
              {!statement.rows.length && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {t(language, "noPaymentRecorded")}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>{t(language, "totalRemaining")}</th>
                <td className="amount-column">{formatMoney(statement.totalDueAdded)}</td>
                <td className="amount-column">{formatMoney(statement.totalPaid)}</td>
                <td className="amount-column">{formatMoney(statement.remainingDue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="due-statement-total mt-3">
          <div>
            <span>{t(language, "amountToPayNext")}</span>
            <small>{t(language, "totalRemaining")}</small>
          </div>
          <strong>{formatMoney(statement.remainingDue)}</strong>
        </div>
        {outstandingBills.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-end justify-between">
              <div>
                <h3 className="text-sm font-black">Bills still due</h3>
                <p className="mt-1 text-[10px] text-[#748078]">
                  Oldest unpaid bill is shown first. Each card separates the
                  original total, money received and balance left.
                </p>
              </div>
              <span className="text-[10px] font-black text-[#748078]">
                {outstandingBills.length} bills
              </span>
            </div>
            <div className="space-y-2">
              {outstandingBills.map((invoice) => (
                <div
                  key={invoice.id}
                  className="rounded-xl border border-[#ddd7ca] bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-xs">
                        {partyStatementLabel(current)}
                      </strong>
                      <p className="mt-1 text-[9px] text-[#7b837f]">
                        {invoice.invoiceNumber} · {fullInvoiceDate(invoice.date)} ·{" "}
                        {invoicePaymentLabel(invoice)}
                      </p>
                    </div>
                    <strong className="text-sm text-[#b75b2b]">
                      Due {formatMoney(invoice.amountDue)}
                    </strong>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-[#f4faf0] p-2">
                      <span className="block text-[8px] font-black uppercase text-[#718077]">
                        Bill total
                      </span>
                      <strong className="mt-1 block text-[10px]">
                        {formatMoney(invoice.grandTotal)}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-[#eaf4ee] p-2">
                      <span className="block text-[8px] font-black uppercase text-[#567268]">
                        Received so far
                      </span>
                      <strong className="mt-1 block text-[10px] text-[#267055]">
                        {formatMoney(invoice.amountPaid)}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            Customer receivables · ग्राहक उधार · ক্রেতার বাকি
          </p>
          <h2 className="page-title">{t(language, "dues")}</h2>
          <p className="mt-1 text-[11px] font-semibold text-[#6f7773]">
            Customers who chose to pay later, with their latest payment and
            current balance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAddDue()}
          className="min-h-12 shrink-0 rounded-xl bg-[#309d4b] px-3 text-[10px] font-black text-white"
        >
          ＋ {t(language, "addManualDue")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-[#173f35] p-4 text-white">
          <span className="text-[9px] font-black uppercase tracking-wide text-[#bdd0c8]">
            Total to collect
          </span>
          <strong className="mt-1 block text-xl text-[#ffb45f]">
            {formatMoney(totalDue)}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#ddd7ca] bg-white p-4">
          <span className="text-[9px] font-black uppercase tracking-wide text-[#748078]">
            Customers with due
          </span>
          <strong className="mt-1 block text-xl text-[#173f35]">
            {allDueRows.length}
          </strong>
        </div>
      </div>
      <label className="search-box my-4">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search customer name or code"
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleRows.map(({ party, lastPayment }) => (
          <article
            key={party.id}
            className="rounded-2xl border border-[#ddd7ca] bg-white p-3.5 text-left shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate text-sm">
                  {partyStatementLabel(party)}
                </strong>
                <p className="mt-2 text-[9px] font-black uppercase text-[#898f8b]">
                  Last payment
                </p>
                {lastPayment ? (
                  <p className="mt-1 text-[10px] font-semibold text-[#53635c]">
                    {formatMoney(lastPayment.amount)} ·{" "}
                    {fullInvoiceDate(lastPayment.date)}
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] font-semibold text-[#9a6b50]">
                    No payment recorded yet
                  </p>
                )}
                {lastPayment && (
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-1 text-[8px] font-black ${lastPayment.mode === "cash" ? "bg-[#fff0df] text-[#a95221]" : "bg-[#e6f4ed] text-[#246b50]"}`}
                  >
                    {paymentModeLabel(lastPayment.mode)}
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className="text-[8px] font-black uppercase text-[#898f8b]">
                  Due
                </span>
                <strong className="mt-1 block text-base text-[#b75b2b]">
                  {formatMoney(party.currentBalance)}
                </strong>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#e2e2db] pt-3">
              <button
                type="button"
                onClick={() => onParty(party)}
                className="due-list-action due-list-action-primary"
                aria-label={`${t(language, "viewStatement")} for ${partyStatementLabel(party)}`}
              >
                {t(language, "viewStatement")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(party, "pdf")}
                className="due-list-action due-list-action-secondary"
                aria-label={`${t(language, "exportPdf")} for ${partyStatementLabel(party)}`}
              >
                ↓ PDF
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(party, "text")}
                className="due-list-action due-list-action-secondary"
                aria-label={`${t(language, "exportText")} for ${partyStatementLabel(party)}`}
              >
                ↓ Text
              </button>
            </div>
          </article>
        ))}
      </div>
      {!visibleRows.length && (
        <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] p-8 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm font-black">
            {query
              ? "No due customer matches this search"
              : "No customer dues right now"}
          </p>
          <p className="mt-1 text-[10px] text-[#748078]">
            {query
              ? "Try the customer name or code name."
              : "Customers with a pay-later balance will appear here automatically."}
          </p>
        </div>
      )}
    </section>
  );
}

const expenseCopy: Record<
  Language,
  {
    eyebrow: string;
    helper: string;
    today: string;
    month: string;
    all: string;
    category: string;
    amount: string;
    date: string;
    description: string;
    descriptionPlaceholder: string;
    method: string;
    reference: string;
    referencePlaceholder: string;
    save: string;
    saved: string;
    history: string;
    search: string;
    none: string;
    removed: string;
    restore: string;
    entries: string;
    formHelper: string;
    offlineFirst: string;
    historyHelper: string;
    recorded: string;
    ref: string;
    remove: string;
    removeConfirm: string;
    moved: string;
    restored: string;
  }
> = {
  en: {
    eyebrow: "Shop spending",
    helper:
      "Record tea, coffee, customer food and other small shop costs. Every entry is saved offline first.",
    today: "Today",
    month: "This month",
    all: "All recorded",
    category: "Expense category",
    amount: "Amount",
    date: "Expense date",
    description: "What was it for?",
    descriptionPlaceholder: "e.g. Tea for customers",
    method: "Paid using",
    reference: "Reference (optional)",
    referencePlaceholder: "Receipt or UPI reference",
    save: "Save expense",
    saved: "Expense saved offline",
    history: "Expense history",
    search: "Search description, category, date or reference",
    none: "No miscellaneous expenses recorded yet.",
    removed: "Recently removed",
    restore: "Restore",
    entries: "entries",
    formHelper: "Tea, food and everyday shop spending",
    offlineFirst: "Offline first",
    historyHelper: "Newest expense first · exact date and payment method",
    recorded: "recorded",
    ref: "Ref",
    remove: "Remove",
    removeConfirm: "Remove this expense? You can restore it later.",
    moved: "Expense moved to the recoverable list",
    restored: "Expense restored",
  },
  hi: {
    eyebrow: "दुकान का खर्च",
    helper:
      "चाय, कॉफी, ग्राहक के खाने और दुकान के छोटे खर्च दर्ज करें। हर एंट्री पहले ऑफलाइन सेव होती है।",
    today: "आज",
    month: "इस महीने",
    all: "कुल दर्ज",
    category: "खर्च की श्रेणी",
    amount: "राशि",
    date: "खर्च की तारीख",
    description: "खर्च किसलिए था?",
    descriptionPlaceholder: "जैसे ग्राहकों के लिए चाय",
    method: "भुगतान का तरीका",
    reference: "रेफरेंस (वैकल्पिक)",
    referencePlaceholder: "रसीद या UPI रेफरेंस",
    save: "खर्च सेव करें",
    saved: "खर्च ऑफलाइन सेव हुआ",
    history: "खर्च का इतिहास",
    search: "विवरण, श्रेणी, तारीख या रेफरेंस खोजें",
    none: "अभी कोई विविध खर्च दर्ज नहीं है।",
    removed: "हाल में हटाए गए",
    restore: "वापस लाएँ",
    entries: "एंट्री",
    formHelper: "चाय, खाना और रोज़ का दुकान खर्च",
    offlineFirst: "पहले ऑफलाइन सेव",
    historyHelper: "नया खर्च पहले · सही तारीख और भुगतान तरीका",
    recorded: "दर्ज समय",
    ref: "रेफरेंस",
    remove: "हटाएँ",
    removeConfirm: "यह खर्च हटाएँ? इसे बाद में वापस लाया जा सकता है।",
    moved: "खर्च रिकवरी सूची में भेजा गया",
    restored: "खर्च वापस लाया गया",
  },
  bn: {
    eyebrow: "দোকানের খরচ",
    helper:
      "চা, কফি, ক্রেতার খাবার ও দোকানের ছোট খরচ লিখুন। প্রতিটি এন্ট্রি আগে অফলাইনে সেভ হয়।",
    today: "আজ",
    month: "এই মাস",
    all: "মোট নথিভুক্ত",
    category: "খরচের ধরন",
    amount: "টাকার পরিমাণ",
    date: "খরচের তারিখ",
    description: "কেন খরচ হয়েছে?",
    descriptionPlaceholder: "যেমন ক্রেতাদের জন্য চা",
    method: "যেভাবে পেমেন্ট হয়েছে",
    reference: "রেফারেন্স (ঐচ্ছিক)",
    referencePlaceholder: "রসিদ বা UPI রেফারেন্স",
    save: "খরচ সেভ করুন",
    saved: "খরচ অফলাইনে সেভ হয়েছে",
    history: "খরচের ইতিহাস",
    search: "বিবরণ, ধরন, তারিখ বা রেফারেন্স খুঁজুন",
    none: "এখনও কোনো অন্যান্য খরচ নথিভুক্ত হয়নি।",
    removed: "সম্প্রতি সরানো",
    restore: "ফিরিয়ে আনুন",
    entries: "এন্ট্রি",
    formHelper: "চা, খাবার ও প্রতিদিনের দোকান খরচ",
    offlineFirst: "আগে অফলাইনে সেভ",
    historyHelper: "নতুন খরচ আগে · সঠিক তারিখ ও পেমেন্ট পদ্ধতি",
    recorded: "নথিভুক্ত",
    ref: "রেফারেন্স",
    remove: "সরান",
    removeConfirm: "এই খরচ সরাবেন? পরে ফিরিয়ে আনা যাবে।",
    moved: "খরচ পুনরুদ্ধার তালিকায় গেছে",
    restored: "খরচ ফিরিয়ে আনা হয়েছে",
  },
};

const expenseCategoryCopy: Record<Language, Record<ExpenseCategory, string>> = {
  en: {
    refreshments: "Tea & coffee",
    customer_food: "Customer food",
    shop_supplies: "Shop supplies",
    transport: "Local transport",
    other: "Other",
  },
  hi: {
    refreshments: "चाय और कॉफी",
    customer_food: "ग्राहक का खाना",
    shop_supplies: "दुकान का सामान",
    transport: "स्थानीय परिवहन",
    other: "अन्य",
  },
  bn: {
    refreshments: "চা ও কফি",
    customer_food: "ক্রেতার খাবার",
    shop_supplies: "দোকানের সামগ্রী",
    transport: "স্থানীয় পরিবহন",
    other: "অন্যান্য",
  },
};

function MiscellaneousScreen({
  expenses,
  language,
  onPad,
  onChanged,
}: {
  expenses: Expense[];
  language: Language;
  onPad: (state: PadState) => void;
  onChanged: (message: string) => void;
}) {
  const copy = expenseCopy[language];
  const [category, setCategory] = useState<ExpenseCategory>("refreshments");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [paymentMode, setPaymentMode] = useState<ExpensePaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = expenses.filter((expense) => !expense.deletedAt);
  const removed = expenses.filter((expense) => expense.deletedAt).slice(0, 5);
  const month = localDate().slice(0, 7);
  const todayTotal = active
    .filter((expense) => expense.date === localDate())
    .reduce((sum, expense) => sum + expense.amount, 0);
  const monthTotal = active
    .filter((expense) => expense.date.startsWith(month))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const allTotal = active.reduce((sum, expense) => sum + expense.amount, 0);
  const needle = query.trim().toLowerCase();
  const visible = active.filter(
    (expense) =>
      !needle ||
      `${expense.description} ${expenseCategoryLabels[expense.category]} ${expenseCategoryCopy[language][expense.category]} ${expense.date} ${expense.reference} ${expense.paymentMode}`
        .toLowerCase()
        .includes(needle),
  );
  const categoryIcons: Record<ExpenseCategory, string> = {
    refreshments: "☕",
    customer_food: "◉",
    shop_supplies: "▧",
    transport: "↗",
    other: "•••",
  };

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await recordExpense({
        category,
        amount,
        date,
        description,
        paymentMode,
        reference,
      });
      setAmount(0);
      setDescription("");
      setReference("");
      await onChanged(copy.saved);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this expense.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove(expense: Expense) {
    if (
      !confirm(
        `${copy.removeConfirm}\n${expense.description} · ${formatMoney(expense.amount)}`,
      )
    )
      return;
    try {
      await removeExpense(expense.id);
      await onChanged(copy.moved);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove this expense.",
      );
    }
  }
  async function restore(expense: Expense) {
    try {
      await restoreExpense(expense.id);
      await onChanged(copy.restored);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not restore this expense.",
      );
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-3 py-4 md:px-7 md:py-6">
      <div>
        <p className="eyebrow">{copy.eyebrow} · विविध · অন্যান্য</p>
        <h2 className="page-title">{t(language, "miscellaneous")}</h2>
        <p className="mt-1 max-w-2xl text-[11px] font-semibold leading-5 text-[#6f7773]">
          {copy.helper}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <DashboardMetric
          icon="↘"
          label={copy.today}
          value={formatMoney(todayTotal)}
          note={`${active.filter((expense) => expense.date === localDate()).length} ${copy.entries}`}
          tone="orange"
        />
        <DashboardMetric
          icon="◫"
          label={copy.month}
          value={formatMoney(monthTotal)}
          note={`${active.filter((expense) => expense.date.startsWith(month)).length} ${copy.entries}`}
          tone="green"
        />
        <DashboardMetric
          icon="Σ"
          label={copy.all}
          value={formatMoney(allTotal)}
          note={`${active.length} ${copy.entries}`}
          tone="gold"
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[.85fr_1.15fr]">
        <article className="dashboard-card p-4 md:p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">
                ＋ {t(language, "addExpense")}
              </h3>
              <p className="dashboard-subtitle">{copy.formHelper}</p>
            </div>
            <span className="dashboard-chip">{copy.offlineFirst}</span>
          </div>
          <p className="field-caption mb-2 mt-5">{copy.category}</p>
          <div
            role="group"
            aria-label={copy.category}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {(Object.keys(expenseCategoryLabels) as ExpenseCategory[]).map(
              (option) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={category === option}
                  onClick={() => setCategory(option)}
                  className={`min-h-14 rounded-xl border px-2 text-[10px] font-black ${category === option ? "border-[#014921] bg-[#e8f3e9] text-[#014921]" : "border-[#ddd8ce] bg-white text-[#68746e]"}`}
                >
                  <span className="mb-1 block text-lg">
                    {categoryIcons[option]}
                  </span>
                  {expenseCategoryCopy[language][option]}
                </button>
              ),
            )}
          </div>
          <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3">
            <div>
              <p className="field-caption mb-1">{copy.amount}</p>
              <button
                type="button"
                onClick={() =>
                  onPad({
                    title: `${copy.amount} · miscellaneous`,
                    value: amount,
                    decimal: true,
                    apply: setAmount,
                  })
                }
                className="flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-[#efb17f] bg-[#fff8ef] px-3 text-left"
              >
                <span className="text-[10px] font-black text-[#9a6a49]">₹</span>
                <strong className="text-lg">{formatMoney(amount)}</strong>
              </button>
            </div>
            <label>
              <span className="field-caption mb-1 block">{copy.date}</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="min-h-14 w-full rounded-xl border-2 border-[#d8d4c9] bg-white px-3 text-xs font-black"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="field-caption mb-1 block">{copy.description}</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy.descriptionPlaceholder}
              className="min-h-12 w-full rounded-xl border border-[#d8d4c9] bg-white px-3 text-sm font-semibold"
            />
          </label>
          <p className="field-caption mb-2 mt-4">{copy.method}</p>
          <div
            role="group"
            aria-label={copy.method}
            className="grid grid-cols-3 gap-2"
          >
            {(["cash", "upi", "bank"] as ExpensePaymentMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                aria-pressed={paymentMode === mode}
                onClick={() => setPaymentMode(mode)}
                className={`min-h-11 rounded-xl border text-[10px] font-black uppercase ${paymentMode === mode ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d4c9] bg-white"}`}
              >
                {mode}
              </button>
            ))}
          </div>
          <label className="mt-4 block">
            <span className="field-caption mb-1 block">{copy.reference}</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={copy.referencePlaceholder}
              className="min-h-12 w-full rounded-xl border border-[#d8d4c9] bg-white px-3 text-sm font-semibold"
            />
          </label>
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-[#fff0e8] p-3 text-[10px] font-bold text-[#a9502b]"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={saving || amount <= 0 || !date}
            onClick={save}
            className="counter-primary mt-4"
          >
            {saving ? "Saving…" : `＋ ${copy.save}`}
          </button>
        </article>
        <article className="dashboard-card overflow-hidden">
          <div className="border-b border-[#e7e3da] p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="dashboard-title">{copy.history}</h3>
                <p className="dashboard-subtitle">{copy.historyHelper}</p>
              </div>
              <span className="dashboard-chip">
                {visible.length} {copy.entries}
              </span>
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-[#d9d6cc] bg-[#fbfaf6] px-3">
              <span className="text-[#66736d]">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
                className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
              />
            </label>
          </div>
          <div className="max-h-[720px] divide-y divide-[#ece8de] overflow-y-auto">
            {visible.map((expense) => (
              <div
                key={expense.id}
                className="flex items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#fff0df] px-2 py-1 text-[8px] font-black text-[#a95221]">
                      {expenseCategoryCopy[language][expense.category]}
                    </span>
                    <span className="rounded-full bg-[#e7f3ec] px-2 py-1 text-[8px] font-black uppercase text-[#25684f]">
                      {expense.paymentMode}
                    </span>
                  </div>
                  <strong className="mt-2 block text-sm">
                    {expense.description}
                  </strong>
                  <p className="mt-1 text-[10px] font-semibold text-[#65716b]">
                    {fullInvoiceDate(expense.date)} · {copy.recorded}{" "}
                    {invoiceRecordedTime(expense.createdAt)}
                  </p>
                  {expense.reference && (
                    <p className="mt-1 text-[9px] text-[#7c8580]">
                      {copy.ref}: {expense.reference}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <strong className="text-base text-[#b75b2b]">
                    −{formatMoney(expense.amount)}
                  </strong>
                  <button
                    type="button"
                    onClick={() => void remove(expense)}
                    className="mt-2 block min-h-9 rounded-lg border border-[#e2c6b9] bg-white px-3 text-[9px] font-black text-[#9e4d2d]"
                  >
                    {copy.remove}
                  </button>
                </div>
              </div>
            ))}
            {!visible.length && (
              <div className="p-12 text-center">
                <div className="text-3xl">☕</div>
                <p className="mt-3 text-sm font-black">{copy.none}</p>
              </div>
            )}
          </div>
          {removed.length > 0 && (
            <div className="border-t border-[#e7e3da] bg-[#f8f5ee] p-4">
              <h4 className="text-[10px] font-black uppercase tracking-wide text-[#737d78]">
                {copy.removed}
              </h4>
              <div className="mt-2 space-y-2">
                {removed.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-[10px]">
                        {expense.description}
                      </strong>
                      <p className="mt-1 text-[9px] text-[#7a837e]">
                        {formatMoney(expense.amount)} ·{" "}
                        {shortDate(expense.date)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restore(expense)}
                      className="min-h-9 rounded-lg bg-[#e7f3ec] px-3 text-[9px] font-black text-[#25684f]"
                    >
                      {copy.restore}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

const cashFlowCopy: Record<
  Language,
  {
    title: string;
    helper: string;
    period: string;
    from: string;
    to: string;
    today: string;
    seven: string;
    thirty: string;
    month: string;
    all: string;
    calculation: string;
    receivedBills: string;
    customerPayments: string;
    supplierPaid: string;
    misc: string;
    salesBilled: string;
    supplierBills: string;
    customerDue: string;
    supplierDue: string;
    movements: string;
    movementHelper: string;
    noMovement: string;
    actualReceipts: string;
    actualPayments: string;
    netHelper: string;
    separated: string;
    paidPurchases: string;
    entries: string;
    dateHeader: string;
    directionHeader: string;
    typeHeader: string;
    detailsHeader: string;
    modeHeader: string;
    amountHeader: string;
    newest: string;
  }
> = {
  en: {
    title: "Money in & money out",
    helper:
      "Actual cash received and actual cash paid. Credit sales are shown separately and later payments are counted only once.",
    period: "Export period",
    from: "From date",
    to: "To date",
    today: "Today",
    seven: "7 days",
    thirty: "30 days",
    month: "This month",
    all: "All dates",
    calculation: "Complete calculation",
    receivedBills: "Received with bills",
    customerPayments: "Later customer payments",
    supplierPaid: "Supplier payments",
    misc: "Miscellaneous costs",
    salesBilled: "Sales billed",
    supplierBills: "Supplier bills recorded",
    customerDue: "Customer dues to collect",
    supplierDue: "Supplier payables",
    movements: "Detailed cash movements",
    movementHelper: "Every actual receipt and payment in the selected dates",
    noMovement: "No money came in or went out during these dates.",
    actualReceipts: "Actual receipts",
    actualPayments: "Actual payments",
    netHelper: "Money in minus money out",
    separated: "Billed amounts and actual cash are kept separate",
    paidPurchases: "Paid with purchases",
    entries: "entries",
    dateHeader: "Date",
    directionHeader: "Direction",
    typeHeader: "Type",
    detailsHeader: "Details",
    modeHeader: "Mode",
    amountHeader: "Amount",
    newest: "Showing the newest 100 entries. PDF and text exports include all",
  },
  hi: {
    title: "पैसा आया और पैसा गया",
    helper:
      "वास्तव में मिला और दिया गया पैसा। उधार बिक्री अलग दिखाई जाती है और बाद का भुगतान केवल एक बार गिना जाता है।",
    period: "निर्यात अवधि",
    from: "शुरू तारीख",
    to: "अंतिम तारीख",
    today: "आज",
    seven: "7 दिन",
    thirty: "30 दिन",
    month: "यह महीना",
    all: "सभी तारीखें",
    calculation: "पूरा हिसाब",
    receivedBills: "बिल के साथ मिली रकम",
    customerPayments: "बाद में मिले ग्राहक भुगतान",
    supplierPaid: "सप्लायर को भुगतान",
    misc: "विविध खर्च",
    salesBilled: "कुल बनाए बिल",
    supplierBills: "दर्ज सप्लायर बिल",
    customerDue: "ग्राहक से लेना है",
    supplierDue: "सप्लायर को देना है",
    movements: "विस्तृत नकदी लेनदेन",
    movementHelper: "चुनी तारीखों में हर वास्तविक प्राप्ति और भुगतान",
    noMovement: "इन तारीखों में कोई पैसा आया या गया नहीं।",
    actualReceipts: "वास्तविक प्राप्ति",
    actualPayments: "वास्तविक भुगतान",
    netHelper: "आया पैसा घटा गया पैसा",
    separated: "बिल की राशि और वास्तविक नकदी अलग रखी गई है",
    paidPurchases: "खरीद के साथ भुगतान",
    entries: "एंट्री",
    dateHeader: "तारीख",
    directionHeader: "दिशा",
    typeHeader: "प्रकार",
    detailsHeader: "विवरण",
    modeHeader: "तरीका",
    amountHeader: "राशि",
    newest: "नवीनतम 100 एंट्री दिखाई गई हैं। PDF और टेक्स्ट में सभी शामिल हैं",
  },
  bn: {
    title: "টাকা এসেছে ও টাকা গেছে",
    helper:
      "বাস্তবে পাওয়া ও দেওয়া টাকা। বাকির বিক্রি আলাদা দেখানো হয় এবং পরের পেমেন্ট একবারই গণনা হয়।",
    period: "রপ্তানির সময়কাল",
    from: "শুরুর তারিখ",
    to: "শেষ তারিখ",
    today: "আজ",
    seven: "7 দিন",
    thirty: "30 দিন",
    month: "এই মাস",
    all: "সব তারিখ",
    calculation: "সম্পূর্ণ হিসাব",
    receivedBills: "বিলের সঙ্গে পাওয়া",
    customerPayments: "পরে পাওয়া ক্রেতার পেমেন্ট",
    supplierPaid: "সরবরাহকারীকে পেমেন্ট",
    misc: "অন্যান্য খরচ",
    salesBilled: "মোট বিল করা বিক্রি",
    supplierBills: "নথিভুক্ত সরবরাহকারী বিল",
    customerDue: "ক্রেতার কাছ থেকে পাওনা",
    supplierDue: "সরবরাহকারীকে দেনা",
    movements: "বিস্তারিত নগদ লেনদেন",
    movementHelper: "নির্বাচিত তারিখে প্রতিটি আসল প্রাপ্তি ও পেমেন্ট",
    noMovement: "এই তারিখে কোনো টাকা আসেনি বা যায়নি।",
    actualReceipts: "প্রকৃত প্রাপ্তি",
    actualPayments: "প্রকৃত পেমেন্ট",
    netHelper: "আসা টাকা থেকে যাওয়া টাকা বাদ",
    separated: "বিলের অঙ্ক ও আসল নগদ আলাদা রাখা হয়েছে",
    paidPurchases: "কেনার সঙ্গে পেমেন্ট",
    entries: "এন্ট্রি",
    dateHeader: "তারিখ",
    directionHeader: "দিক",
    typeHeader: "ধরন",
    detailsHeader: "বিবরণ",
    modeHeader: "পদ্ধতি",
    amountHeader: "টাকার পরিমাণ",
    newest: "নতুন 100টি এন্ট্রি দেখানো হয়েছে। PDF ও টেক্সটে সবগুলো থাকবে",
  },
};

const movementTypeCopy: Record<Language, Record<string, string>> = {
  en: {
    sale: "Sale",
    purchase: "Purchase",
    sale_return: "Sale return",
    purchase_return: "Purchase return",
    customer_payment: "Customer payment",
    supplier_payment: "Supplier payment",
    misc_expense: "Miscellaneous",
  },
  hi: {
    sale: "बिक्री",
    purchase: "खरीद",
    sale_return: "बिक्री वापसी",
    purchase_return: "खरीद वापसी",
    customer_payment: "ग्राहक भुगतान",
    supplier_payment: "सप्लायर भुगतान",
    misc_expense: "विविध खर्च",
  },
  bn: {
    sale: "বিক্রি",
    purchase: "ক্রয়",
    sale_return: "বিক্রি ফেরত",
    purchase_return: "ক্রয় ফেরত",
    customer_payment: "ক্রেতার পেমেন্ট",
    supplier_payment: "সরবরাহকারী পেমেন্ট",
    misc_expense: "অন্যান্য খরচ",
  },
};

function CashFlowPanel({
  invoices,
  payments,
  parties,
  accountEntries,
  expenses,
  business,
  language,
  onToast,
}: {
  invoices: Invoice[];
  payments: Payment[];
  parties: Party[];
  accountEntries: AccountEntry[];
  expenses: Expense[];
  business: BusinessSettings;
  language: Language;
  onToast: (message: string) => void;
}) {
  const today = localDate();
  const startOfMonth = `${today.slice(0, 7)}-01`;
  const [fromDate, setFromDate] = useState(startOfMonth);
  const [toDate, setToDate] = useState(today);
  const copy = cashFlowCopy[language];
  const report = useMemo(
    () =>
      buildCashFlowReport({
        invoices,
        payments,
        parties,
        accountEntries,
        expenses,
        fromDate,
        toDate,
      }),
    [invoices, payments, parties, accountEntries, expenses, fromDate, toDate],
  );
  const visibleMovements = report.movements.slice(0, 100);
  const dayOffset = (days: number) => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - days);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  };
  const preset = (kind: "today" | "7d" | "30d" | "month" | "all") => {
    if (kind === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
    setToDate(today);
    setFromDate(
      kind === "today"
        ? today
        : kind === "7d"
          ? dayOffset(6)
          : kind === "30d"
            ? dayOffset(29)
            : startOfMonth,
    );
  };
  const changeFrom = (value: string) => {
    setFromDate(value);
    if (value && toDate && value > toDate) setToDate(value);
  };
  const changeTo = (value: string) => {
    setToDate(value);
    if (value && fromDate && value < fromDate) setFromDate(value);
  };
  async function exportPdf() {
    try {
      await downloadCashFlowPdf(report, business);
      onToast("PDF cash-flow report exported");
    } catch (cause) {
      onToast(
        cause instanceof Error
          ? cause.message
          : "Could not export the PDF report.",
      );
    }
  }
  async function exportText() {
    try {
      await downloadCashFlowText(report, business);
      onToast("Text cash-flow report exported");
    } catch (cause) {
      onToast(
        cause instanceof Error
          ? cause.message
          : "Could not export the text report.",
      );
    }
  }
  const movementType = (source: string) =>
    movementTypeCopy[language][source] || source;

  return (
    <article className="dashboard-card overflow-hidden xl:col-span-12">
      <div className="border-b border-[#e7e3da] p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f3ec] text-xl text-[#014921]">
                ↕
              </span>
              <div>
                <h3 className="text-lg font-black text-[#014921]">
                  {copy.title}
                </h3>
                <p className="mt-1 text-[10px] font-semibold leading-4 text-[#6f7974]">
                  {copy.helper}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportPdf()}
              className="min-h-11 rounded-xl bg-[#014921] px-4 text-[10px] font-black text-white"
            >
              ↓ {t(language, "exportPdf")}
            </button>
            <button
              type="button"
              onClick={exportText}
              className="min-h-11 rounded-xl border border-[#8fbd9f] bg-white px-4 text-[10px] font-black text-[#014921]"
            >
              ↓ {t(language, "exportText")}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-[#f7f5ef] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-[.13em] text-[#7a837e]">
              {copy.period} · {dateRangeLabel(fromDate, toDate)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["today", copy.today],
                  ["7d", copy.seven],
                  ["30d", copy.thirty],
                  ["month", copy.month],
                  ["all", copy.all],
                ] as ["today" | "7d" | "30d" | "month" | "all", string][]
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => preset(key)}
                  className="min-h-9 rounded-lg border border-[#d9d5ca] bg-white px-2.5 text-[9px] font-black text-[#53615b]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label>
              <span className="field-caption mb-1 block">{copy.from}</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => changeFrom(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#d8d4c9] bg-white px-3 text-xs font-black"
              />
            </label>
            <label>
              <span className="field-caption mb-1 block">{copy.to}</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => changeTo(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-[#d8d4c9] bg-white px-3 text-xs font-black"
              />
            </label>
          </div>
        </div>
      </div>
      <div className="p-4 md:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#e8f3e9] p-4">
            <span className="text-[9px] font-black uppercase tracking-wide text-[#4d6a5d]">
              {t(language, "moneyIn")}
            </span>
            <strong className="mt-2 block text-2xl text-[#267055]">
              +{formatMoney(report.moneyIn)}
            </strong>
            <p className="mt-1 text-[9px] font-semibold text-[#66736d]">
              {copy.actualReceipts}
            </p>
          </div>
          <div className="rounded-2xl bg-[#fff0e4] p-4">
            <span className="text-[9px] font-black uppercase tracking-wide text-[#8a654e]">
              {t(language, "moneyOut")}
            </span>
            <strong className="mt-2 block text-2xl text-[#b75b2b]">
              −{formatMoney(report.moneyOut)}
            </strong>
            <p className="mt-1 text-[9px] font-semibold text-[#806b5e]">
              {copy.actualPayments}
            </p>
          </div>
          <div
            className={`rounded-2xl p-4 ${report.netCashFlow >= 0 ? "bg-[#014921] text-white" : "bg-[#8f3e28] text-white"}`}
          >
            <span className="text-[9px] font-black uppercase tracking-wide opacity-75">
              {t(language, "netCashFlow")}
            </span>
            <strong className="mt-2 block text-2xl">
              {formatMoney(report.netCashFlow)}
            </strong>
            <p className="mt-1 text-[9px] font-semibold opacity-75">
              {copy.netHelper}
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-[#ddd9cf] bg-[#fbfaf6] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black">{copy.calculation}</h4>
              <p className="mt-1 text-[9px] text-[#78817d]">{copy.separated}</p>
            </div>
            <span className="dashboard-chip">
              {dateRangeLabel(fromDate, toDate)}
            </span>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-2 text-[10px] sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <span>{copy.salesBilled}</span>
              <strong>{formatMoney(report.salesBilled)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>{copy.supplierBills}</span>
              <strong>{formatMoney(report.supplierBillsRecorded)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-[#267055]">
              <span>{copy.receivedBills}</span>
              <strong>+{formatMoney(report.receivedWithBills)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-[#b75b2b]">
              <span>{copy.paidPurchases}</span>
              <strong>−{formatMoney(report.paidWithPurchases)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-[#267055]">
              <span>{copy.customerPayments}</span>
              <strong>+{formatMoney(report.customerPayments)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-[#b75b2b]">
              <span>{copy.supplierPaid}</span>
              <strong>−{formatMoney(report.supplierPayments)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>{copy.customerDue}</span>
              <strong>{formatMoney(report.customerOutstanding)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>{copy.supplierDue}</span>
              <strong>{formatMoney(report.supplierOutstanding)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-[#b75b2b] sm:col-span-2">
              <span>{copy.misc}</span>
              <strong>−{formatMoney(report.miscellaneousExpenses)}</strong>
            </div>
          </div>
          {report.expenseBreakdown.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e4e0d6] pt-3">
              {report.expenseBreakdown.map((row) => (
                <span
                  key={row.category}
                  className="rounded-lg bg-white px-2.5 py-2 text-[9px] font-black text-[#705f54]"
                >
                  {expenseCategoryCopy[language][row.category]} ·{" "}
                  {formatMoney(row.amount)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-[#ddd9cf]">
          <div className="flex items-end justify-between gap-3 border-b border-[#e7e3da] bg-white p-4">
            <div>
              <h4 className="text-xs font-black">{copy.movements}</h4>
              <p className="mt-1 text-[9px] text-[#78817d]">
                {copy.movementHelper}
              </p>
            </div>
            <span className="dashboard-chip">
              {report.movements.length} {copy.entries}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="dashboard-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{copy.dateHeader}</th>
                  <th>{copy.directionHeader}</th>
                  <th>{copy.typeHeader}</th>
                  <th>{copy.detailsHeader}</th>
                  <th>{copy.modeHeader}</th>
                  <th className="text-right">{copy.amountHeader}</th>
                </tr>
              </thead>
              <tbody>
                {visibleMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{fullInvoiceDate(movement.date)}</td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${movement.direction === "in" ? "bg-[#e7f3ec] text-[#267055]" : "bg-[#fff0e4] text-[#b75b2b]"}`}
                      >
                        {movement.direction === "in"
                          ? t(language, "moneyIn")
                          : t(language, "moneyOut")}
                      </span>
                    </td>
                    <td>{movementType(movement.source)}</td>
                    <td>
                      <strong className="block text-[10px]">
                        {movement.title}
                      </strong>
                      <span className="text-[8px] text-[#7d8581]">
                        {movement.details}
                      </span>
                    </td>
                    <td className="uppercase">{movement.mode}</td>
                    <td
                      className={`text-right font-black ${movement.direction === "in" ? "text-[#267055]" : "text-[#b75b2b]"}`}
                    >
                      {movement.direction === "in" ? "+" : "−"}
                      {formatMoney(movement.amount)}
                    </td>
                  </tr>
                ))}
                {!visibleMovements.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-12 text-center text-[#858c88]"
                    >
                      {copy.noMovement}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {report.movements.length > visibleMovements.length && (
            <p className="border-t border-[#e7e3da] bg-[#f8f6f1] p-3 text-center text-[9px] font-semibold text-[#707a75]">
              {copy.newest} {report.movements.length}.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function ReportsDashboard({
  invoices,
  payments,
  accountEntries,
  expenses,
  parties,
  items,
  language,
  business,
  format,
  onNewBill,
  onToast,
  onConverted,
  ownerMode,
}: {
  invoices: Invoice[];
  payments: Payment[];
  accountEntries: AccountEntry[];
  expenses: Expense[];
  parties: Party[];
  items: Item[];
  language: Language;
  business: BusinessSettings;
  format: InvoiceFormat;
  onNewBill: () => void;
  onToast: (message: string) => void;
  onConverted: (invoice: Invoice) => void;
  ownerMode: boolean;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [selectedHistoryInvoice, setSelectedHistoryInvoice] =
    useState<Invoice | null>(null);
  const data = useMemo(() => {
    const allSales = invoices.filter(
      (invoice) => !invoice.deletedAt && invoice.type === "sale",
    );
    const now = new Date();
    const periodDays =
      period === "7d"
        ? 7
        : period === "30d"
          ? 30
          : period === "90d"
            ? 90
            : null;
    const start = periodDays
      ? new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - periodDays + 1,
        ).getTime()
      : 0;
    const sales = allSales.filter(
      (invoice) =>
        !start || new Date(`${invoice.date}T00:00:00`).getTime() >= start,
    );
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const salesTotal = sales.reduce(
      (sum, invoice) => sum + invoice.grandTotal,
      0,
    );
    const todayTotal = allSales
      .filter((invoice) => invoice.date === localDate())
      .reduce((sum, invoice) => sum + invoice.grandTotal, 0);
    const outstanding = parties
      .filter((party) => party.type === "customer")
      .reduce((sum, party) => sum + Math.max(0, party.currentBalance), 0);
    let profit = 0;
    for (const invoice of sales)
      for (const line of invoice.lineItems) {
        const item = itemMap.get(line.itemId);
        if (item)
          profit +=
            line.taxableAmount -
            convertUnitRate(item.purchasePrice, item.baseUnit, line.unit) *
              line.qty;
      }

    const modeMap = new Map<string, number>();
    for (const invoice of sales)
      modeMap.set(
        invoice.paymentMode,
        (modeMap.get(invoice.paymentMode) || 0) + invoice.grandTotal,
      );
    const modeRows = ["cash", "upi", "credit", "mixed", "bank"]
      .map((mode) => ({
        name: mode,
        value: modeMap.get(mode) || 0,
        color: dashboardModeColors[mode],
      }))
      .filter((row) => row.value > 0);
    let cursor = 0;
    const donutStops = modeRows.map((row) => {
      const from = salesTotal ? (cursor / salesTotal) * 100 : 0;
      cursor += row.value;
      const to = salesTotal ? (cursor / salesTotal) * 100 : 0;
      return `${row.color} ${from}% ${to}%`;
    });

    const productMap = new Map<string, { name: string; value: number }>();
    const categoryMap = new Map<string, number>();
    for (const invoice of sales)
      for (const line of invoice.lineItems) {
        const existing = productMap.get(line.itemId);
        productMap.set(line.itemId, {
          name: line.itemName,
          value: (existing?.value || 0) + line.amount,
        });
        const category =
          itemMap.get(line.itemId)?.categoryId || "cat-uncategorized";
        categoryMap.set(
          category,
          (categoryMap.get(category) || 0) + line.amount,
        );
      }
    const hasProductSales = productMap.size > 0;
    const topProducts = hasProductSales
      ? [...productMap.values()].sort((a, b) => b.value - a.value).slice(0, 5)
      : [...items]
          .sort((a, b) => b.saleCount - a.saleCount)
          .slice(0, 5)
          .map((item) => ({ name: item.name, value: item.saleCount }));
    const categories = [...categoryMap.entries()]
      .map(([id, value]) => ({
        name: dashboardCategoryNames[id] || "Other",
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const receivables = parties
      .filter((party) => party.type === "customer" && party.currentBalance > 0)
      .sort((a, b) => b.currentBalance - a.currentBalance)
      .slice(0, 5);
    const maxReceivable = Math.max(
      ...receivables.map((party) => party.currentBalance),
      1,
    );
    const recent = [...sales]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6);

    const bucketCount = 7;
    const rangeDays =
      periodDays ||
      Math.max(
        30,
        Math.ceil(
          (now.getTime() -
            Math.min(
              ...allSales.map((invoice) =>
                new Date(`${invoice.date}T00:00:00`).getTime(),
              ),
              now.getTime(),
            )) /
            86400000,
        ),
      );
    const bucketDays = Math.max(1, Math.ceil(rangeDays / bucketCount));
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const daysAgo = (bucketCount - 1 - index) * bucketDays;
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysAgo,
      );
      const startDate = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() - bucketDays + 1,
      );
      const value = allSales
        .filter((invoice) => {
          const time = new Date(`${invoice.date}T00:00:00`).getTime();
          return (
            time >= startDate.getTime() && time < endDate.getTime() + 86400000
          );
        })
        .reduce((sum, invoice) => sum + invoice.grandTotal, 0);
      return {
        label: endDate.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        }),
        value,
      };
    });
    const maxTrend = Math.max(...buckets.map((bucket) => bucket.value), 1);
    const points = buckets
      .map(
        (bucket, index) =>
          `${(index * 100) / (bucketCount - 1)},${88 - (bucket.value / maxTrend) * 68}`,
      )
      .join(" ");
    return {
      sales,
      salesTotal,
      todayTotal,
      outstanding,
      profit: Math.max(0, profit),
      modeRows,
      donutBackground: donutStops.length
        ? `conic-gradient(${donutStops.join(",")})`
        : "conic-gradient(#e8e6df 0 100%)",
      topProducts,
      hasProductSales,
      categories,
      receivables,
      maxReceivable,
      recent,
      buckets,
      maxTrend,
      points,
    };
  }, [invoices, parties, items, period]);
  const customerRows = useMemo(() => {
    const rows: {
      id: string;
      party?: Party;
      name: string;
      codeName: string;
      phone: string;
      address: string;
      invoices: Invoice[];
      billCount: number;
      total: number;
      last?: Invoice;
    }[] = parties
      .filter((party) => party.type === "customer")
      .map((party) => {
        const history = customerInvoiceHistory(invoices, party.id);
        const active = history.filter((invoice) => !invoice.deletedAt);
        return {
          id: party.id,
          party,
          name: party.name,
          codeName: party.codeName,
          phone: party.phone,
          address: party.address,
          invoices: history,
          billCount: active.length,
          total: active.reduce((sum, invoice) => sum + invoice.grandTotal, 0),
          last: active[0],
        };
      });
    const cashHistory = customerInvoiceHistory(invoices);
    const activeCash = cashHistory.filter((invoice) => !invoice.deletedAt);
    if (cashHistory.length)
      rows.push({
        id: "__cash__",
        party: undefined,
        name: t(language, "cashCustomer"),
        codeName: "CASH",
        phone: "No customer account",
        address: "Walk-in sale",
        invoices: cashHistory,
        billCount: activeCash.length,
        total: activeCash.reduce((sum, invoice) => sum + invoice.grandTotal, 0),
        last: activeCash[0],
      });
    return rows.sort(
      (a, b) =>
        (b.last?.createdAt || "").localeCompare(a.last?.createdAt || "") ||
        a.name.localeCompare(b.name),
    );
  }, [invoices, parties, language]);
  const visibleCustomerRows = customerRows.filter((row) =>
    `${row.name} ${row.codeName} ${row.address} ${row.phone}`
      .toLowerCase()
      .includes(customerQuery.trim().toLowerCase()),
  );
  const selectedHistoryParty =
    selectedCustomerId && selectedCustomerId !== "__cash__"
      ? parties.find((party) => party.id === selectedCustomerId)
      : undefined;
  const selectedCustomerInvoices =
    selectedCustomerId === null
      ? []
      : customerInvoiceHistory(
          invoices,
          selectedCustomerId === "__cash__" ? undefined : selectedCustomerId,
        );
  const openInvoiceHistory = (invoice: Invoice) => {
    setSelectedCustomerId(invoice.partyId || "__cash__");
    setSelectedHistoryInvoice(invoice);
  };
  if (selectedCustomerId !== null)
    return (
      <>
        <CustomerPurchaseHistory
          party={selectedHistoryParty}
          invoices={selectedCustomerInvoices}
          language={language}
          onBack={() => {
            setSelectedCustomerId(null);
            setSelectedHistoryInvoice(null);
          }}
          onInvoice={setSelectedHistoryInvoice}
        />
        {selectedHistoryInvoice && (
          <ReportInvoiceDetail
            invoice={selectedHistoryInvoice}
            business={business}
            format={format}
            language={language}
            onClose={() => setSelectedHistoryInvoice(null)}
          />
        )}
      </>
    );
  const topProductMax = Math.max(
    ...data.topProducts.map((row) => row.value),
    1,
  );
  const periodLabel = period === "all" ? "All time" : period.toUpperCase();
  return (
    <section className="mx-auto max-w-[1380px] px-3 py-4 md:px-5 md:py-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold text-[#8b918d]">
            <span>{t(language, "reports")}</span>
            <span>›</span>
            <span className="text-[#3b4944]">Business dashboard</span>
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight md:text-[28px]">
            Business Dashboard · ব্যবসার ড্যাশবোর্ড
          </h2>
          <p className="mt-1 text-xs text-[#7a837f]">
            A live view of sales, udhaar and product performance on this device.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-[#dcd8cf] bg-white p-1">
            {(["7d", "30d", "90d", "all"] as DashboardPeriod[]).map((value) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={`min-h-9 rounded-lg px-3 text-[10px] font-black uppercase ${period === value ? "bg-[#173f35] text-white" : "text-[#737d78]"}`}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            onClick={onNewBill}
            className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white shadow-sm"
          >
            ＋ New bill
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardMetric
          icon="₹"
          label="Sales"
          value={formatMoney(data.salesTotal)}
          note={`${data.sales.length} bills · ${periodLabel}`}
          tone="orange"
        />
        <DashboardMetric
          icon="↗"
          label="Today"
          value={formatMoney(data.todayTotal)}
          note="Sales recorded today"
          tone="green"
        />
        <DashboardMetric
          icon="◎"
          label="Outstanding"
          value={formatMoney(data.outstanding)}
          note="Total customer udhaar"
          tone="gold"
        />
        <DashboardMetric
          icon={ownerMode ? "◈" : "▤"}
          label={ownerMode ? "Est. gross profit" : "Bills"}
          value={ownerMode ? formatMoney(data.profit) : String(data.sales.length)}
          note={ownerMode ? "Owner-only · before expenses" : `Recorded in ${periodLabel}`}
          tone="blue"
        />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-12">
        <AdvancedReports
          invoices={invoices}
          parties={parties}
          items={items}
          accountEntries={accountEntries}
          language={language}
          business={business}
          format={format}
          onToast={onToast}
          onConverted={onConverted}
          ownerMode={ownerMode}
        />
        <DailyClosePanel invoices={invoices} payments={payments} expenses={expenses} parties={parties} onToast={onToast} />
        <CashFlowPanel
          invoices={invoices}
          payments={payments}
          parties={parties}
          accountEntries={accountEntries}
          expenses={expenses}
          business={business}
          language={language}
          onToast={onToast}
        />
        <article className="dashboard-card p-4 xl:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">Sales by payment mode</h3>
              <p className="dashboard-subtitle">
                How customers paid · {periodLabel}
              </p>
            </div>
            <span className="dashboard-chip">{data.sales.length} bills</span>
          </div>
          <div className="mt-5 grid items-center gap-5 sm:grid-cols-[1.1fr_.9fr]">
            <div
              className="relative mx-auto grid aspect-square w-full max-w-[230px] place-items-center rounded-full"
              style={{ background: data.donutBackground }}
            >
              <div className="grid h-[68%] w-[68%] place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_#eeeae1]">
                <div>
                  <strong className="block text-2xl tracking-tight">
                    {formatMoney(data.salesTotal)}
                  </strong>
                  <span className="text-[10px] font-bold text-[#8a918d]">
                    Total sales
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {data.modeRows.length ? (
                data.modeRows.map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between rounded-xl bg-[#f8f6f1] px-3 py-2.5"
                  >
                    <span className="flex items-center gap-2 text-xs font-bold capitalize">
                      <i
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: row.color }}
                      />
                      {row.name}
                    </span>
                    <strong className="text-xs">
                      {formatMoney(row.value)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="rounded-xl bg-[#f8f6f1] p-4 text-center text-xs text-[#7b837f]">
                  No sales in this period yet.
                </p>
              )}
            </div>
          </div>
        </article>
        <article className="dashboard-card overflow-hidden xl:col-span-7">
          <div className="flex items-center justify-between border-b border-[#e7e3da] px-4 py-4">
            <div>
              <h3 className="dashboard-title">Recent invoices</h3>
              <p className="dashboard-subtitle">
                Tap a bill to open it and see that customer&apos;s full history
              </p>
            </div>
            <span className="dashboard-chip">Live</span>
          </div>
          <div className="overflow-x-auto">
            <table className="dashboard-table min-w-[650px]">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Party</th>
                  <th>Date</th>
                  <th>Mode</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.length ? (
                  data.recent.map((invoice) => (
                    <tr
                      key={invoice.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openInvoiceHistory(invoice)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openInvoiceHistory(invoice);
                        }
                      }}
                      className="cursor-pointer transition hover:bg-[#f4faf0] focus:bg-[#f4faf0] focus:outline-none"
                    >
                      <td>
                        <strong className="text-[#014921] underline decoration-[#abd49e] underline-offset-4">
                          {invoice.invoiceNumber}
                        </strong>
                      </td>
                      <td>{invoice.partyName}</td>
                      <td>{fullInvoiceDate(invoice.date)}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 capitalize">
                          <i
                            className="h-2 w-2 rounded-full"
                            style={{
                              background:
                                dashboardModeColors[invoice.paymentMode] ||
                                "#8b918d",
                            }}
                          />
                          {invoice.paymentMode}
                        </span>
                      </td>
                      <td className="text-right font-bold">
                        {formatMoney(invoice.grandTotal)}
                      </td>
                      <td
                        className={`text-right font-bold ${invoice.amountDue > 0 ? "text-[#bd5d2a]" : "text-[#267055]"}`}
                      >
                        {formatMoney(invoice.amountDue)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-16 text-center text-[#858c88]"
                    >
                      Your saved bills will appear here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
        <article className="dashboard-card overflow-hidden xl:col-span-12">
          <div className="flex flex-col gap-3 border-b border-[#e7e3da] px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="dashboard-title">
                {reportHistoryCopy[language].section}
              </h3>
              <p className="dashboard-subtitle">
                {reportHistoryCopy[language].helper}
              </p>
            </div>
            <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[#d9d6cc] bg-[#fbfaf6] px-3 md:max-w-xs">
              <span className="text-[#66736d]">⌕</span>
              <input
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder={reportHistoryCopy[language].search}
                className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none"
              />
            </label>
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleCustomerRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedCustomerId(row.id)}
                className="group flex min-h-[108px] items-center justify-between gap-3 rounded-2xl border border-[#dedbd2] bg-white p-3.5 text-left transition hover:border-[#8fbd9f] hover:bg-[#f5faf4] focus:outline-none focus:ring-2 focus:ring-[#309d4b]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm group-hover:text-[#014921]">
                      {row.name}
                    </strong>
                    <span className="shrink-0 rounded-md bg-[#e7f3ec] px-1.5 py-1 text-[8px] font-black text-[#25684f]">
                      {row.codeName}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-semibold text-[#5f6e67]">
                    {row.address || "No address"}
                  </p>
                  <p className="mt-1 truncate text-[9px] text-[#77817c]">
                    {row.phone || "No phone"}
                  </p>
                  <p className="mt-2 text-[9px] font-black uppercase tracking-wide text-[#6f7974]">
                    {row.billCount} {reportHistoryCopy[language].bills}
                    {row.last
                      ? ` · ${reportHistoryCopy[language].lastPurchase} ${shortDate(row.last.date)}`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <strong className="text-sm text-[#173f35]">
                    {formatMoney(row.total)}
                  </strong>
                  <p className="mt-1 text-[9px] font-bold text-[#7b847f]">
                    {reportHistoryCopy[language].spent} ›
                  </p>
                </div>
              </button>
            ))}
            {!visibleCustomerRows.length && (
              <p className="col-span-full py-10 text-center text-xs font-semibold text-[#858c88]">
                No matching customer.
              </p>
            )}
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <h3 className="dashboard-title">Sales trend</h3>
          <p className="dashboard-subtitle">
            Seven equal intervals · {periodLabel}
          </p>
          <div className="mt-5 h-[175px]">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-[132px] w-full overflow-visible"
              aria-label="Sales trend chart"
              role="img"
            >
              <defs>
                <linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#309d4b" stopOpacity=".24" />
                  <stop offset="100%" stopColor="#309d4b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1="88"
                x2="100"
                y2="88"
                stroke="#e2e2db"
                strokeWidth=".7"
                strokeDasharray="2 2"
              />
              <polygon
                points={`0,88 ${data.points} 100,88`}
                fill="url(#salesArea)"
              />
              <polyline
                points={data.points}
                fill="none"
                stroke="#309d4b"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.buckets.map((bucket, index) => (
                <circle
                  key={bucket.label}
                  cx={(index * 100) / 6}
                  cy={88 - (bucket.value / data.maxTrend) * 68}
                  r="1.6"
                  fill="#f9f9f9"
                  stroke="#309d4b"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className="grid grid-cols-7 gap-1 text-center text-[8px] font-bold text-[#8b918d]">
              {data.buckets.map((bucket) => (
                <span key={bucket.label}>{bucket.label}</span>
              ))}
            </div>
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">Outstanding by party</h3>
              <p className="dashboard-subtitle">
                Tap a customer to see every bill
              </p>
            </div>
            <span className="dashboard-chip">Top 5</span>
          </div>
          <div className="mt-4 space-y-2">
            {data.receivables.length ? (
              data.receivables.map((party) => (
                <button
                  key={party.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(party.id)}
                  className="block w-full rounded-xl p-2 text-left transition hover:bg-[#f4faf0] focus:outline-none focus:ring-2 focus:ring-[#309d4b]"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] font-bold text-[#014921]">
                      {party.name} ›
                    </span>
                    <strong className="shrink-0 text-[11px] text-[#b85a28]">
                      {formatMoney(party.currentBalance)}
                    </strong>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eeeae2]">
                    <div
                      className="h-full rounded-full bg-[#abd49e]"
                      style={{
                        width: `${(party.currentBalance / data.maxReceivable) * 100}%`,
                      }}
                    />
                  </div>
                </button>
              ))
            ) : (
              <p className="py-16 text-center text-xs text-[#858c88]">
                No outstanding balances.
              </p>
            )}
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">Top products</h3>
              <p className="dashboard-subtitle">
                {data.hasProductSales
                  ? "By billed revenue"
                  : "By recorded catalogue activity"}
              </p>
            </div>
            <span className="dashboard-chip">Top 5</span>
          </div>
          <div className="mt-4 space-y-3">
            {data.topProducts.map((row, index) => (
              <div
                key={row.name}
                className="grid grid-cols-[22px_1fr_auto] items-center gap-2"
              >
                <span className="grid h-5 w-5 place-items-center rounded-md bg-[#f1eee7] text-[9px] font-black text-[#737b77]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold">{row.name}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eeeae2]">
                    <div
                      className="h-full rounded-full bg-[#309d4b]"
                      style={{ width: `${(row.value / topProductMax) * 100}%` }}
                    />
                  </div>
                </div>
                <strong className="text-[10px]">
                  {data.hasProductSales
                    ? formatMoney(row.value)
                    : `${row.value} sales`}
                </strong>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function CustomerPurchaseHistory({
  party,
  invoices,
  language,
  onBack,
  onInvoice,
}: {
  party?: Party;
  invoices: Invoice[];
  language: Language;
  onBack: () => void;
  onInvoice: (invoice: Invoice) => void;
}) {
  const copy = reportHistoryCopy[language];
  const activeInvoices = invoices.filter((invoice) => !invoice.deletedAt);
  const deletedCount = invoices.length - activeInvoices.length;
  const total = activeInvoices.reduce(
    (sum, invoice) => sum + invoice.grandTotal,
    0,
  );
  const paid = activeInvoices.reduce(
    (sum, invoice) => sum + invoice.amountPaid,
    0,
  );
  const due = activeInvoices.reduce(
    (sum, invoice) => sum + invoice.amountDue,
    0,
  );
  const customerName = party?.name || t(language, "cashCustomer");
  return (
    <section className="mx-auto max-w-5xl px-3 py-4 md:px-7 md:py-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 min-h-11 rounded-xl border border-[#d8d4ca] bg-white px-4 text-xs font-black text-[#014921]"
      >
        ‹ {copy.back}
      </button>
      <div className="overflow-hidden rounded-3xl bg-[#014921] text-white shadow-sm">
        <div className="p-5 md:p-6">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#abd49e]">
            {copy.section}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black md:text-3xl">{customerName}</h2>
            <span className="rounded-lg bg-[#ffbf6f] px-2 py-1 text-[9px] font-black text-[#014921]">
              {party?.codeName || "CASH"}
            </span>
          </div>
          <p className="mt-2 text-xs text-[#d6e5d9]">
            {party?.phone || "No phone number"}
            {party?.gstin ? ` · GSTIN ${party.gstin}` : ""}
          </p>
          <p className="mt-1 text-[10px] text-[#c7dbc9]">
            ⌖ {party?.address || "No address saved"}
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
          <div className="border-r border-white/15 p-4">
            <span className="text-[9px] font-bold uppercase text-[#c3d9c7]">
              {copy.savedBills}
            </span>
            <strong className="mt-1 block text-xl">
              {activeInvoices.length}
            </strong>
          </div>
          <div className="border-r border-white/15 p-4">
            <span className="text-[9px] font-bold uppercase text-[#c3d9c7]">
              {copy.purchaseTotal}
            </span>
            <strong className="mt-1 block text-xl text-[#ffbf6f]">
              {formatMoney(total)}
            </strong>
          </div>
          <div className="border-r border-t border-white/15 p-4 sm:border-t-0">
            <span className="text-[9px] font-bold uppercase text-[#c3d9c7]">
              {copy.paid}
            </span>
            <strong className="mt-1 block text-xl">{formatMoney(paid)}</strong>
          </div>
          <div className="border-t border-white/15 p-4 sm:border-t-0">
            <span className="text-[9px] font-bold uppercase text-[#c3d9c7]">
              {copy.due}
            </span>
            <strong className="mt-1 block text-xl text-[#ffbf6f]">
              {formatMoney(due)}
            </strong>
          </div>
        </div>
      </div>
      <div className="mb-3 mt-5 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-black">All purchase bills</h3>
          <p className="mt-1 text-[10px] font-semibold text-[#748078]">
            Newest first · exact billed date and recorded time
          </p>
        </div>
        <span className="shrink-0 rounded-xl bg-[#e8f3e9] px-3 py-2 text-[10px] font-black text-[#276b50]">
          {invoices.length} total
          {deletedCount ? ` · ${deletedCount} deleted` : ""}
        </span>
      </div>
      <div className="space-y-3">
        {invoices.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            onClick={() => onInvoice(invoice)}
            className={`block w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-[#8fbd9f] hover:bg-[#f8fbf6] focus:outline-none focus:ring-2 focus:ring-[#309d4b] ${invoice.deletedAt ? "border-[#e3c8bb] opacity-75" : "border-[#ddd9cf]"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-[#014921] underline decoration-[#abd49e] underline-offset-4">
                    {invoice.invoiceNumber}
                  </strong>
                  {invoice.deletedAt && (
                    <span className="rounded-full bg-[#f7e8df] px-2 py-1 text-[8px] font-black uppercase text-[#9a4e2d]">
                      {copy.deleted}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[11px] font-bold text-[#374a43]">
                  {fullInvoiceDate(invoice.date)}
                </p>
                <p className="mt-1 text-[9px] text-[#7b8580]">
                  Recorded {invoiceRecordedTime(invoice.createdAt)} ·{" "}
                  {invoicePaymentLabel(invoice)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <strong className="text-base">
                  {formatMoney(invoice.grandTotal)}
                </strong>
                <p
                  className={`mt-1 text-[9px] font-black ${invoice.amountDue > 0 ? "text-[#b85a28]" : "text-[#267055]"}`}
                >
                  {invoice.amountDue > 0
                    ? `${copy.due} ${formatMoney(invoice.amountDue)}`
                    : "Paid in full"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {invoice.lineItems.map((line, index) => (
                <span
                  key={`${invoice.id}-${line.itemId}-${index}`}
                  className="rounded-lg bg-[#f1eee7] px-2 py-1.5 text-[9px] font-bold text-[#4f5f58]"
                >
                  {line.qty} {unitShort(line.unit)} × {line.itemName}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#ece8de] pt-3">
              <span className="text-[9px] font-bold text-[#748078]">
                {invoice.lineItems.length} {copy.items.toLowerCase()}
              </span>
              <span className="text-[10px] font-black text-[#014921]">
                {copy.viewBill} ›
              </span>
            </div>
          </button>
        ))}
        {!invoices.length && (
          <div className="rounded-2xl border-2 border-dashed border-[#d8d2c6] bg-[#f8f5ee] p-12 text-center">
            <span className="text-3xl">▤</span>
            <p className="mt-3 text-sm font-black">{copy.noBills}</p>
            <p className="mt-1 text-[10px] text-[#7a837f]">
              Future bills saved for this customer will appear here
              automatically.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ReportInvoiceDetail({
  invoice,
  business,
  format,
  language,
  onClose,
}: {
  invoice: Invoice;
  business: BusinessSettings;
  format: InvoiceFormat;
  language: Language;
  onClose: () => void;
}) {
  const copy = reportHistoryCopy[language];
  return (
    <SheetFrame
      title={`${copy.viewBill} · ${invoice.invoiceNumber}`}
      onClose={onClose}
      full
    >
      <div className="rounded-3xl bg-[#014921] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#abd49e]">
              Sales invoice
            </p>
            <h3 className="mt-2 text-xl font-black">{invoice.partyName}</h3>
            <p className="mt-1 text-[10px] text-[#d0e1d3]">
              {fullInvoiceDate(invoice.date)} · recorded{" "}
              {invoiceRecordedTime(invoice.createdAt)} ·{" "}
              {invoicePaymentLabel(invoice)}
            </p>
          </div>
          <strong className="shrink-0 text-xl text-[#ffbf6f]">
            {formatMoney(invoice.grandTotal)}
          </strong>
        </div>
        {invoice.deletedAt && (
          <p className="mt-4 rounded-xl bg-[#fff3e8] p-3 text-[10px] font-black text-[#91471f]">
            This bill is currently in the 30-day recoverable bin.
          </p>
        )}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#ddd9cf] bg-white">
        <div className="border-b border-[#e8e4da] px-4 py-3">
          <h4 className="text-sm font-black">{copy.items}</h4>
          <p className="mt-1 text-[9px] text-[#748078]">
            Quantity, unit, negotiated rate, GST and line total
          </p>
        </div>
        <div className="divide-y divide-[#ece8de]">
          {invoice.lineItems.map((line, index) => (
            <div key={`${line.itemId}-${index}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-xs">{line.itemName}</strong>
                  <p className="mt-1 text-[9px] text-[#7a837e]">
                    {line.skuCode || "No SKU"}
                    {line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}
                  </p>
                </div>
                <strong className="shrink-0 text-xs">
                  {formatMoney(line.amount)}
                </strong>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[8px] font-bold text-[#7b837f]">
                    QUANTITY
                  </span>
                  <strong className="mt-1 block text-[10px]">
                    {line.qty} {unitShort(line.unit)}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[8px] font-bold text-[#7b837f]">
                    RATE
                  </span>
                  <strong className="mt-1 block text-[10px]">
                    {formatMoney(line.rate)}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[8px] font-bold text-[#7b837f]">
                    GST
                  </span>
                  <strong className="mt-1 block text-[10px]">
                    {line.gstRate}% · {formatMoney(line.gstAmount)}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-[#ddd9cf] bg-white p-4">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <strong>{formatMoney(invoice.subtotal)}</strong>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <strong>−{formatMoney(invoice.discountTotal)}</strong>
          </div>
          <div className="flex justify-between">
            <span>GST</span>
            <strong>{formatMoney(invoice.gstTotal)}</strong>
          </div>
          {(invoice.otherCharges || []).map((charge) => (
            <div
              key={charge.code}
              className="flex justify-between text-[#9b592f]"
            >
              <span>{charge.label}</span>
              <strong>{formatMoney(charge.amount)}</strong>
            </div>
          ))}
          <div className="flex justify-between border-t border-[#e5e1d7] pt-2 text-sm">
            <span className="font-black">Grand total</span>
            <strong>{formatMoney(invoice.grandTotal)}</strong>
          </div>
          <div className="flex justify-between text-[#267055]">
            <span>
              {copy.paid} · {invoicePaymentLabel(invoice)}
            </span>
            <strong>{formatMoney(invoice.amountPaid)}</strong>
          </div>
          <div className="flex justify-between text-[#b85a28]">
            <span>{copy.due}</span>
            <strong>{formatMoney(invoice.amountDue)}</strong>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void printInvoice(invoice, business, format)}
          className="counter-primary"
        >
          Print this bill
        </button>
        <button
          type="button"
          onClick={() => void shareInvoice(invoice, business, format)}
          className="counter-secondary text-[#014921]"
        >
          Share PDF on WhatsApp
        </button>
      </div>
    </SheetFrame>
  );
}

function MoreScreen({
  language,
  theme,
  format,
  business,
  invoices,
  installable,
  cloudConfigured,
  cloudConfig,
  onCloud,
  onCloudDisconnect,
  onLanguage,
  onTheme,
  onFormat,
  onBusiness,
  onInstall,
  onToast,
  workspace,
  printerProfiles,
  messageTemplates,
  activityLogs,
  parties,
  items,
  ownerConfigured,
  onOwnerSetup,
  onWorkspace,
  onPrinterProfiles,
  onMessageTemplates,
  onMergeParty,
  onMergeItem,
}: {
  language: Language;
  theme: Theme;
  format: InvoiceFormat;
  business: BusinessSettings;
  invoices: Invoice[];
  installable: boolean;
  cloudConfigured: boolean;
  cloudConfig: CloudConfig;
  onCloud: (config: CloudConfig) => Promise<void>;
  onCloudDisconnect: () => boolean;
  onLanguage: (x: Language) => void;
  onTheme: (x: Theme) => void;
  onFormat: (x: InvoiceFormat) => void;
  onBusiness: (x: BusinessSettings) => void;
  onInstall: () => void;
  onToast: (m: string) => void;
  workspace: WorkspacePreferences;
  printerProfiles: PrinterProfile[];
  messageTemplates: MessageTemplates;
  activityLogs: import("../lib/db").ActivityLog[];
  parties: Party[];
  items: Item[];
  ownerConfigured: boolean;
  onOwnerSetup: () => void;
  onWorkspace: (value: WorkspacePreferences) => void;
  onPrinterProfiles: (value: PrinterProfile[]) => void;
  onMessageTemplates: (value: MessageTemplates) => void;
  onMergeParty: (source: Party, target: Party) => Promise<void>;
  onMergeItem: (source: Item, target: Item) => Promise<void>;
}) {
  const [draft, setDraft] = useState(business);
  const [cloudDraft, setCloudDraft] = useState(cloudConfig);
  const [renderTime] = useState(() => Date.now());
  const trash = invoices.filter(
    (x) =>
      x.deletedAt &&
      renderTime - new Date(x.deletedAt).getTime() < 30 * 86400000,
  );
  async function exportGstr() {
    const rows = [
      [
        "Invoice Number",
        "Invoice Date",
        "Customer",
        "GSTIN",
        "Taxable Value",
        "GST Amount",
        "Other Charges",
        "Invoice Total",
      ],
      ...invoices
        .filter((x) => !x.deletedAt && x.type === "sale")
        .map((x) => [
          x.invoiceNumber,
          x.date,
          x.partyName,
          x.partyGstin || "",
          x.subtotal - x.discountTotal,
          x.gstTotal,
          x.otherChargesTotal || 0,
          x.grandTotal,
        ]),
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const name = `GSTR1-working-export-${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    if (
      await shareNativeBlob(blob, {
        fileName: name,
        title: "GSTR-1 working CSV",
        dialogTitle: "Save or share GST export",
      })
    ) {
      onToast("GSTR-1 working CSV ready");
      return;
    }
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast("GSTR-1 working CSV exported");
  }
  async function restore(invoice: Invoice) {
    const stamp = nowIso();
    await db.transaction("rw", [db.invoices, db.parties], async () => {
      const party = invoice.partyId
        ? await db.parties.get(invoice.partyId)
        : undefined;
      await db.invoices.update(invoice.id, {
        deletedAt: undefined,
        updatedAt: stamp,
        isSynced: false,
      });
      if (party)
        await db.parties.update(party.id, {
          currentBalance: party.currentBalance + invoice.amountDue,
          updatedAt: stamp,
          isSynced: false,
        });
    });
    onToast(`${invoice.invoiceNumber} restored`);
  }
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <p className="eyebrow">Settings & data</p>
      <h2 className="page-title">{t(language, "more")}</h2>
      {installable && (
        <button
          onClick={onInstall}
          className="mt-4 flex min-h-14 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-left text-white"
        >
          <div>
            <strong>Install on this phone</strong>
            <p className="mt-1 text-[10px] text-[#c6d6d0]">
              Works like an app from the home screen
            </p>
          </div>
          <span className="text-2xl">↓</span>
        </button>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="settings-card">
          <h3>Shop details · দোকানের তথ্য</h3>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Shop name"
          />
          <input
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder="Address"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              inputMode="tel"
              placeholder="Phone"
            />
            <input
              value={draft.gstin}
              onChange={(e) =>
                setDraft({ ...draft, gstin: e.target.value.toUpperCase() })
              }
              placeholder="GSTIN"
            />
          </div>
          <button
            onClick={() => onBusiness(draft)}
            className="counter-primary mt-2"
          >
            Save shop details
          </button>
        </section>
        <QualityOfLifeSettings
          workspace={workspace}
          onWorkspace={onWorkspace}
          profiles={printerProfiles}
          onProfiles={onPrinterProfiles}
          templates={messageTemplates}
          onTemplates={onMessageTemplates}
          activityLogs={activityLogs}
          parties={parties}
          items={items}
          onMergeParty={onMergeParty}
          onMergeItem={onMergeItem}
          ownerConfigured={ownerConfigured}
          onOwnerSetup={onOwnerSetup}
        />
        <section className="settings-card">
          <h3>Language · भाषा · ভাষা</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["en", "hi", "bn"] as Language[]).map((x) => (
              <button
                key={x}
                onClick={() => onLanguage(x)}
                className={`h-12 rounded-xl border text-xs font-black ${language === x ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d8d2c6]"}`}
              >
                {x === "en" ? "English" : x === "hi" ? "हिंदी" : "বাংলা"}
              </button>
            ))}
          </div>
          <h3 className="mt-5">{t(language, "appearance")}</h3>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={t(language, "appearance")}>
            {(["light", "dark"] as Theme[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onTheme(option)}
                aria-pressed={theme === option}
                className={`h-12 rounded-xl border text-xs font-black ${theme === option ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d8d2c6]"}`}
              >
                <span aria-hidden="true" className="mr-1.5">{option === "dark" ? "☾" : "☀"}</span>
                {t(language, option === "dark" ? "darkMode" : "lightMode")}
              </button>
            ))}
          </div>
          <h3 className="mt-5">Invoice size</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["a4", "a5", "thermal"] as InvoiceFormat[]).map((x) => (
              <button
                key={x}
                onClick={() => onFormat(x)}
                className={`h-12 rounded-xl border text-xs font-black uppercase ${format === x ? "border-[#ef7d32] bg-[#fff0df] text-[#b75b20]" : "border-[#d8d2c6]"}`}
              >
                {x}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card">
          <h3>Cloud backup · ऑफलाइन सिंक</h3>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f2efe8] p-3">
            <div>
              <strong className="text-xs">Supabase sync</strong>
              <p className="mt-1 text-[9px] text-[#748078]">
                {cloudConfigured
                  ? "Configured; local-first sync active"
                  : "Not configured; device works offline"}
              </p>
            </div>
            <span
              className={`h-3 w-3 rounded-full ${cloudConfigured ? "bg-emerald-500" : "bg-stone-400"}`}
            />
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[#6f7a74]">
            Every bill is saved on this device first. Use the same private
            business sync code on every trusted device; a missing connection
            never blocks billing.
          </p>
          <label className="product-field mt-3">
            <span>Supabase project URL</span>
            <input
              value={cloudDraft.url}
              onChange={(event) =>
                setCloudDraft({ ...cloudDraft, url: event.target.value })
              }
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://your-project.supabase.co"
            />
          </label>
          <label className="product-field mt-2">
            <span>Anon public key</span>
            <input
              type="password"
              value={cloudDraft.key}
              onChange={(event) =>
                setCloudDraft({ ...cloudDraft, key: event.target.value })
              }
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Paste anon public key"
            />
          </label>
          <label className="product-field mt-2">
            <span>Private business sync code</span>
            <input
              type="password"
              value={cloudDraft.syncCode}
              onChange={(event) =>
                setCloudDraft({ ...cloudDraft, syncCode: event.target.value })
              }
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Use the same code on every device"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              setCloudDraft({
                ...cloudDraft,
                syncCode: `${makeId()}-${makeId()}`,
              })
            }
            className="mt-2 text-left text-[10px] font-black text-[#267055]"
          >
            Generate a strong sync code
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void onCloud(cloudDraft)}
              className="counter-primary"
            >
              Save & sync
            </button>
            <button
              type="button"
              disabled={!cloudConfigured}
              onClick={() => {
                if (onCloudDisconnect())
                  setCloudDraft({ url: "", key: "", syncCode: "" });
              }}
              className="counter-secondary disabled:opacity-40"
            >
              Disconnect
            </button>
          </div>
        </section>
        <section className="settings-card">
          <h3>GST export</h3>
          <p className="mt-2 text-[10px] leading-5 text-[#6f7a74]">
            Working CSV for your CA. This does not file a return, generate IRN
            or create e-way bills.
          </p>
          <button onClick={exportGstr} className="counter-secondary mt-3">
            ↓ Export GSTR-1 working CSV
          </button>
        </section>
        {trash.length > 0 && (
          <section className="settings-card md:col-span-2">
            <h3>30-day invoice bin</h3>
            <div className="mt-3 space-y-2">
              {trash.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between rounded-xl bg-[#f5eee9] p-3"
                >
                  <div>
                    <strong className="text-xs">{invoice.invoiceNumber}</strong>
                    <p className="mt-1 text-[9px] text-[#7d817e]">
                      {invoice.partyName} · {formatMoney(invoice.grandTotal)}
                    </p>
                  </div>
                  <button
                    onClick={() => restore(invoice)}
                    className="rounded-lg bg-white px-3 py-2 text-[10px] font-black text-[#267055]"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function InvoiceSaved({
  invoice,
  business,
  format,
  onClose,
  onPreview,
  shareMessage,
}: {
  invoice: Invoice;
  business: BusinessSettings;
  format: InvoiceFormat;
  onClose: () => void;
  onPreview: () => void;
  shareMessage: string;
}) {
  const [selectedFormat, setSelectedFormat] = useState<InvoiceFormat>(format);
  const formatLabels: Record<InvoiceFormat, string> = {
    a4: "A4 detailed",
    a5: "A5 compact",
    thermal: "3-inch thermal",
  };
  const quotation = invoice.type === "quotation";
  return (
    <SheetFrame
      title={
        quotation
          ? "Quotation saved · कोटेशन सेव हुआ · কোটেশন সেভ হয়েছে"
          : "Bill saved · बिल सेव हुआ · বিল সেভ হয়েছে"
      }
      onClose={onClose}
    >
      <div className="rounded-3xl bg-[#e9f3ed] p-5 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#2f7a5e] text-2xl font-black text-white">
          ✓
        </div>
        <h3 className="mt-3 text-xl font-black">{invoice.invoiceNumber}</h3>
        <p className="mt-1 text-xs text-[#62746c]">{invoice.partyName}</p>
        <strong className="mt-3 block text-3xl text-[#173f35]">
          {formatMoney(invoice.grandTotal)}
        </strong>
        <div
          className={`mx-auto mt-3 grid max-w-sm gap-2 text-center ${quotation ? "grid-cols-3" : "grid-cols-4"}`}
        >
          <div>
            <span className="block text-[8px] font-black uppercase text-[#748078]">
              Taxable
            </span>
            <strong className="text-[11px]">
              {formatMoney(invoice.subtotal - invoice.discountTotal)}
            </strong>
          </div>
          <div>
            <span className="block text-[8px] font-black uppercase text-[#748078]">
              GST
            </span>
            <strong className="text-[11px]">
              {formatMoney(invoice.gstTotal)}
            </strong>
          </div>
          <div>
            <span className="block text-[8px] font-black uppercase text-[#748078]">
              Charges
            </span>
            <strong className="text-[11px]">
              {formatMoney(invoice.otherChargesTotal || 0)}
            </strong>
          </div>
          {!quotation && (
            <div>
              <span className="block text-[8px] font-black uppercase text-[#748078]">
                Due
              </span>
              <strong className="text-[11px] text-[#b65b2b]">
                {formatMoney(invoice.amountDue)}
              </strong>
            </div>
          )}
        </div>
        {quotation && (
          <p className="mx-auto mt-3 max-w-sm rounded-xl bg-white/70 p-2 text-[9px] font-bold text-[#014921]">
            Estimate only. Customer due and last-sale prices were not changed.
          </p>
        )}
        {!quotation && invoice.amountDue > 0 && (
          <div className="mx-auto mt-3 max-w-sm rounded-xl border border-[#e8c69f] bg-[#fff7ed] p-3 text-left">
            <p className="text-[10px] font-black text-[#267055]">
              Received now: {formatMoney(invoice.amountPaid)}
              {invoice.amountPaid > 0
                ? ` · ${invoicePaymentLabel(invoice)}`
                : ""}
            </p>
            <p className="mt-1 text-[10px] font-black text-[#b65b2b]">
              {formatMoney(invoice.amountDue)} automatically added to{" "}
              {invoice.partyName} in Dues.
            </p>
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="field-caption mb-2">Choose print layout</p>
        <div
          role="group"
          aria-label="Choose print layout"
          className="grid grid-cols-3 gap-2"
        >
          {(["a4", "a5", "thermal"] as InvoiceFormat[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelectedFormat(option)}
              aria-pressed={selectedFormat === option}
              className={`min-h-12 rounded-lg border px-2 text-[10px] font-black ${selectedFormat === option ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d2c6] bg-white"}`}
            >
              {formatLabels[option]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        <button onClick={onPreview} className="counter-secondary">Preview exact PDF before printing</button>
        <button
          onClick={() => printInvoice(invoice, business, selectedFormat)}
          className="counter-primary"
        >
          Print refined {quotation ? "quotation" : formatLabels[selectedFormat]}
        </button>
        <button
          onClick={() => shareInvoice(invoice, business, selectedFormat, null, shareMessage)}
          className="counter-secondary text-emerald-700"
        >
          Share {quotation ? "quotation" : "detailed PDF"} on WhatsApp
        </button>
        <button onClick={onClose} className="counter-secondary">
          {quotation ? "Back to billing" : "Start next bill"}
        </button>
      </div>
    </SheetFrame>
  );
}
