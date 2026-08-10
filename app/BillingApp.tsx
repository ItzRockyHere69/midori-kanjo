"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  localDate,
  makeId,
  nowIso,
  type AccountEntry,
  type BillingCustomerDraft,
  type Category,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMode,
  type FestivalEntry,
  type Invoice,
  type InvoiceCharge,
  type InvoiceChargeCode,
  type InvoiceLine,
  type InvoicePaymentAllocation,
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
  customerInvoiceHistory,
  dueCustomerRows,
  formatMoney,
  fuzzyScore,
  invoiceInitialPaymentBreakdown,
  normalizePartyCode,
  normalizePartyIdentity,
  normalizePhoneDigits,
  paymentChannels,
  partyDueStatement,
  partyMatchesSearch,
  priceForParty,
  recordDue,
  recordPayment,
  roundMoney,
  saveQuotation,
  saveSale,
  shouldOfferInlineItemCreation,
  softDeleteInvoice,
  restoreInvoice,
  unitShort,
  type SalePaymentPlan,
} from "../lib/billing";
import {
  buildCashFlowReport,
  dateRangeLabel,
  expenseCategoryLabels,
  inDateRange,
  recordExpense,
  removeExpense,
  restoreExpense,
} from "../lib/cashflow";
import {
  buildDashboardTrendBuckets,
  buildSalesSettlementReport,
  dashboardPeriodRange,
  type DashboardPeriod,
} from "../lib/report-dashboard";
import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  isLanguage,
  localizedCategoryName,
  localizedInvoicePartyName,
  localizedItemName,
  localizedItemSecondaryName,
  localizedUnitName,
  t,
} from "../lib/i18n";
import {
  applyInterfaceScale,
  interfaceScaleOptions,
  INTERFACE_SCALE_META,
  parseInterfaceScale,
  readInterfaceScaleCache,
  readInterfaceScaleCacheValue,
  writeInterfaceScaleCache,
  type InterfaceScale,
} from "../lib/interface-scale";
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
  DuesBackupError,
  importedDueActivityLabel,
  previewDuesBackupRestore,
  restoreDuesBackup,
} from "../lib/due-backup";
import {
  DuesLedgerError,
  previewDuesLedgerRestore,
  restoreDuesLedger,
} from "../lib/dues-ledger-archive";
import {
  isCapacitorApp,
  isNativeApp,
  openExternalUrl,
  shareNativeBlob,
} from "../lib/native-files";
import { AccessibleSheet, useDialogFocus } from "./AccessibleDialog";
import {
  clearCloudConfig,
  configureCloud,
  generateBusinessSyncCode,
  getCloudConfig,
  isCloudConfigured,
  pendingCount,
  reconcilePartyBalances,
  startRealtimeSync,
  syncDiagnostics,
  syncNow,
  type CloudConfig,
  type SyncDiagnostics,
  type SyncState,
} from "../lib/sync";
import {
  clearBillDraft,
  canonicalizeMessageTemplates,
  defaultMessageTemplates,
  defaultPrinterProfiles,
  defaultWorkspace,
  loadBillDraft,
  isRestorableArchivedItem,
  logActivity,
  messageTemplatesForLanguage,
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
  restoreArchivedItem,
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
import AdvancedReports, { type ReportKey } from "./AdvancedReports";
import DotmSquare12 from "./DotmSquare12";
import InventoryWorkspace, {
  type InventoryOverlay,
  type InventoryRoute,
} from "./InventoryWorkspace";
import { inventoryText } from "./inventory-copy";
import {
  applyTheme,
  type AppTheme,
  writeThemeCache,
} from "../lib/theme";
import FestivalWorkspace from "./FestivalWorkspace";
import DueBackupSheet, {
  type DueBackupPreviewSession,
  type DueBackupSession,
} from "./DueBackupSheet";
import { dueBackupCopy } from "./due-backup-copy";
import MasterBackupPanel from "./MasterBackupPanel";
import {
  ensureFestivalCalendar,
  festivalEntryName,
  festivalKeysForItem,
  FESTIVAL_DEFINITIONS,
  withFestivalKeys,
  type FestivalKey,
} from "../lib/festivals";
import { festivalCopy, festivalText } from "./festival-copy";

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
  | "dueBackup"
  | null;
type PartyEditorOrigin = "bill" | "parties" | "dues";
type ProductEditorOrigin = "catalogue" | "inventoryInward";
type ItemsMode = "catalogue" | "inventory" | "festival";
type PadState = {
  title: string;
  value: number;
  decimal?: boolean;
  apply: (value: number) => void;
} | null;
type DraftInvoiceCharge = InvoiceCharge & { enabled: boolean };
type CounterDocument = "sale" | "quotation";
type Theme = AppTheme;

const tr = (language: Language, en: string, hi: string, bn: string) =>
  language === "hi" ? hi : language === "bn" ? bn : en;

const localizedPriceTierName = (
  language: Language,
  tier: Party["priceTier"],
) => {
  const copy: Record<Party["priceTier"], [string, string, string]> = {
    retail: ["Retail", "रिटेल", "খুচরো"],
    wholesale: ["Wholesale", "होलसेल", "পাইকারি"],
    bulk: ["Bulk", "बल्क", "বাল্ক"],
    special: ["Special", "खास रेट", "বিশেষ রেট"],
  };
  return tr(language, ...copy[tier]);
};

const preparePrintWindow = () => {
  if (isNativeApp() || typeof window === "undefined") return null;
  const prepared = window.open("", "_blank");
  if (prepared) prepared.opener = null;
  return prepared;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

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
  name: "",
  ownerName: "",
  address: "",
  phone: "",
  alternatePhone: "",
  email: "",
  gstin: "",
};

const normalizeBusinessSettings = (
  value: Partial<BusinessSettings>,
): BusinessSettings => ({
  name: typeof value.name === "string" ? value.name.trim() : emptyBusiness.name,
  ownerName: typeof value.ownerName === "string" ? value.ownerName.trim() : "",
  address:
    typeof value.address === "string" ? value.address.trim() : emptyBusiness.address,
  phone: typeof value.phone === "string" ? value.phone.trim() : "",
  alternatePhone:
    typeof value.alternatePhone === "string" ? value.alternatePhone.trim() : "",
  email: typeof value.email === "string" ? value.email.trim() : "",
  gstin: typeof value.gstin === "string" ? value.gstin.trim().toUpperCase() : "",
  logo: typeof value.logo === "string" ? value.logo : undefined,
});

export default function BillingApp() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [tab, setTab] = useState<Tab>("bill");
  const [reportsInitialView, setReportsInitialView] = useState<ReportKey>("daily");
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<Theme | null>(null);
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(() =>
    readInterfaceScaleCache(),
  );
  const [ownerMode, setOwnerMode] = useState(false);
  const [ownerConfigured, setOwnerConfigured] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspacePreferences>(defaultWorkspace);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>(defaultPrinterProfiles);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplates>(defaultMessageTemplates);
  const outgoingMessageTemplates = useMemo(
    () => messageTemplatesForLanguage(language, messageTemplates),
    [language, messageTemplates],
  );
  const [favouriteItemIds, setFavouriteItemIds] = useState<string[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftId, setDraftId] = useState(() => makeId());
  const [undoAction, setUndoAction] = useState<{ label: string; run: () => void } | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncDiagnostics>({
    pending: { categories: 0, parties: 0, items: 0, prices: 0, invoices: 0, payments: 0, dues: 0, expenses: 0, countSessions: 0, countLines: 0, stockMovements: 0 },
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
  const [itemsMode, setItemsMode] = useState<ItemsMode>("catalogue");
  const [inventoryRoute, setInventoryRoute] = useState<InventoryRoute>({ page: "hub" });
  const [inventoryOverlay, setInventoryOverlay] = useState<InventoryOverlay>(null);
  const [productEditorOrigin, setProductEditorOrigin] = useState<ProductEditorOrigin>("catalogue");
  const [inventoryDraftItemId, setInventoryDraftItemId] = useState("");
  const ownerIntentRef = useRef<null | (() => void)>(null);
  const [pad, setPad] = useState<PadState>(null);
  const [party, setParty] = useState<Party | undefined>();
  const [customerDraft, setCustomerDraft] =
    useState<BillingCustomerDraft | undefined>();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [paid, setPaid] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentChannel>("cash");
  const [splitPayment, setSplitPayment] = useState(false);
  const [paymentBreakdown, setPaymentBreakdown] =
    useState<InvoicePaymentAllocation[]>([]);
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
  const [dueBackupSession, setDueBackupSession] = useState<DueBackupSession>(null);
  const [dueBackupRestoring, setDueBackupRestoring] = useState(false);
  const dueBackupRestoringRef = useRef(false);
  const masterBackupRestoringRef = useRef(false);
  const [newPartyType, setNewPartyType] = useState<Party["type"]>("customer");
  const [partyEditorOrigin, setPartyEditorOrigin] =
    useState<PartyEditorOrigin>("parties");
  const [invoiceFormat, setInvoiceFormat] = useState<InvoiceFormat>("a5");
  const [previewFormat, setPreviewFormat] = useState<InvoiceFormat | null>(null);
  const [business, setBusiness] = useState<BusinessSettings>(emptyBusiness);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const previousTabRef = useRef<Tab>("bill");
  const themeTransitionTimerRef = useRef<number | null>(null);
  const interfaceScaleTransitionTimerRef = useRef<number | null>(null);
  const interfaceScaleSaveTimerRef = useRef<number | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent>();

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
  const reportItems = useLiveQuery(() => db.items.toArray(), [], []);
  const categories = useLiveQuery(
    () => db.categories.orderBy("name").toArray(),
    [],
    [],
  );
  const festivalEntries = useLiveQuery(
    () => db.festivalEntries.orderBy("startDate").toArray(),
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
        ? splitPayment
          ? paid
          : preview.grandTotal
        : paymentPlan === "partial"
          ? paid
          : 0;
    return calculateBill(lines, received, appliedCharges);
  }, [lines, paid, paymentPlan, splitPayment, appliedCharges, counterDocument]);
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
    let cancelled = false;
    (async () => {
      let startupLanguage: Language = "en";
      try {
        await seedIfNeeded();
        await reconcilePartyBalances();
        await ensureFestivalCalendar();
        const [
          storedLanguage,
          storedFormat,
          storedBusiness,
          storedGstEnabled,
          storedGstRate,
          storedInterfaceScale,
          storedWorkspace,
          storedProfiles,
          storedTemplates,
          storedFavourites,
          storedDraft,
          pinConfigured,
        ] = await Promise.all([
          db.meta.get("language"),
          db.meta.get("invoice-format"),
          db.meta.get("business-settings"),
          db.meta.get("bill-gst-enabled"),
          db.meta.get("bill-gst-rate"),
          db.meta.get(INTERFACE_SCALE_META),
          readJsonMeta(WORKSPACE_META, defaultWorkspace),
          readJsonMeta(PRINTER_PROFILES_META, defaultPrinterProfiles),
          readJsonMeta(MESSAGE_TEMPLATES_META, defaultMessageTemplates),
          readJsonMeta<string[]>(FAVOURITE_ITEMS_META, []),
          loadBillDraft(),
          ownerPinConfigured(),
        ]);
        if (cancelled) return;
        const loadedLanguage = isLanguage(storedLanguage?.value)
          ? storedLanguage.value
          : "en";
        startupLanguage = loadedLanguage;
        setLanguage(loadedLanguage);
        if (storedFormat?.value)
          setInvoiceFormat(storedFormat.value as InvoiceFormat);
        if (storedBusiness?.value) {
          try {
            const parsed = JSON.parse(String(storedBusiness.value));
            if (parsed && typeof parsed === "object") {
              setBusiness(
                normalizeBusinessSettings(parsed as Partial<BusinessSettings>),
              );
            }
          } catch {}
        }
        if (storedGstEnabled) setGstEnabled(storedGstEnabled.value !== false);
        if (storedGstRate?.value)
          setGstRate(
            Math.min(25, Math.max(0, Number(storedGstRate.value) || 18)),
          );
        const loadedInterfaceScale =
          readInterfaceScaleCacheValue() ??
          parseInterfaceScale(storedInterfaceScale?.value) ??
          100;
        setInterfaceScale(loadedInterfaceScale);
        applyInterfaceScale(loadedInterfaceScale);
        writeInterfaceScaleCache(loadedInterfaceScale);
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
          setCustomerDraft(storedDraft.customerDraft);
          setLines(storedDraft.lines);
          setPaid(storedDraft.paid);
          setPaymentMode(storedDraft.paymentMode);
          setSplitPayment(Boolean(storedDraft.splitPayment));
          setPaymentBreakdown(storedDraft.paymentBreakdown || []);
          setPaymentPlan(storedDraft.paymentPlan);
          setCounterDocument(storedDraft.documentType);
          setGstEnabled(storedDraft.gstEnabled);
          setGstRate(storedDraft.gstRate);
          setOtherCharges(storedDraft.otherCharges.length ? storedDraft.otherCharges : freshOtherCharges());
          setDraftSavedAt(storedDraft.savedAt);
          setToast(
            tr(
              loadedLanguage,
              "Your unfinished bill was restored safely.",
              "आपका अधूरा बिल सुरक्षित तरीके से वापस आ गया।",
              "আপনার অসম্পূর্ণ বিল নিরাপদে ফিরে এসেছে।",
            ),
          );
        }
        const diagnostics = await syncDiagnostics();
        if (cancelled) return;
        setPending(diagnostics.totalPending);
        setSyncInfo(diagnostics);
        setReady(true);
        if (!isNativeApp() && navigator.storage?.persist) {
          void (async () => {
            const previous = await db.meta.get("storage-persistence-v1");
            const alreadyPersistent = await navigator.storage.persisted?.();
            const persistent = alreadyPersistent || await navigator.storage.persist();
            await db.meta.put({
              key: "storage-persistence-v1",
              value: persistent ? "granted" : "denied",
            });
            if (!persistent && previous?.value !== "denied" && !cancelled) {
              setToast(
                (current) =>
                  current ||
                  tr(
                    loadedLanguage,
                    "This browser may clear offline data when storage is low. Keep cloud backup on and download a backup regularly.",
                    "स्टोरेज कम होने पर यह ब्राउज़र ऑफलाइन डेटा हटा सकता है। क्लाउड बैकअप चालू रखें और समय-समय पर बैकअप डाउनलोड करें।",
                    "স্টোরেজ কম হলে এই ব্রাউজার অফলাইন ডেটা মুছে দিতে পারে। ক্লাউড ব্যাকআপ চালু রাখুন এবং নিয়মিত ব্যাকআপ ডাউনলোড করুন।",
                  ),
              );
            }
          })().catch(() => undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setStartupError(
            startupLanguage === "en" && error instanceof Error
              ? error.message
              : tr(
                  startupLanguage,
                  "The offline database could not be opened.",
                  "ऑफलाइन डेटाबेस नहीं खुल पाया।",
                  "অফলাইন ডেটাবেস খোলা যায়নি।",
                ),
          );
        }
      }
    })();
    if (!isNativeApp() && "serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const online = () =>
      syncNow(setSyncState)
        .then(() => pendingCount())
        .then(setPending)
        .catch(() => setSyncState("pending"));
    const offline = () => setSyncState("offline");
    const install = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const installed = () => setInstallEvent(undefined);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installed);
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void syncNow(setSyncState)
      .then(() => pendingCount())
      .then(setPending)
      .catch(() => setSyncState(navigator.onLine ? "pending" : "offline"));
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
    applyTheme(theme);
    writeThemeCache(theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101713" : "#014921");
  }, [theme]);
  useEffect(() => {
    applyInterfaceScale(interfaceScale);
    writeInterfaceScaleCache(interfaceScale);
  }, [interfaceScale]);
  useEffect(() => {
    previousTabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      if (!party && !customerDraft && !lines.length && !paid) {
        void clearBillDraft().catch(() =>
          setToast(
            tr(
              language,
              "The draft cleanup could not be saved.",
              "ड्राफ्ट हटाने का बदलाव सेव नहीं हुआ।",
              "ড্রাফট সরানোর বদল সেভ হয়নি।",
            ),
          ),
        );
        setDraftSavedAt("");
        return;
      }
      void saveBillDraft({
        draftId,
        partyId: party?.id,
        customerDraft,
        lines,
        paid,
        paymentMode,
        splitPayment,
        paymentBreakdown,
        paymentPlan,
        documentType: counterDocument,
        gstEnabled,
        gstRate,
        otherCharges,
      })
        .then((draft) => setDraftSavedAt(draft.savedAt))
        .catch(() =>
          setToast(
            tr(
              language,
              "The draft could not be saved. Check the device's free storage.",
              "ड्राफ्ट सेव नहीं हुआ। डिवाइस में खाली स्टोरेज जाँचें।",
              "ড্রাফট সেভ হয়নি। ডিভাইসে খালি স্টোরেজ আছে কি না দেখুন।",
            ),
          ),
        );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [ready, draftId, party, customerDraft, lines, paid, paymentMode, splitPayment, paymentBreakdown, paymentPlan, counterDocument, gstEnabled, gstRate, otherCharges, language]);
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
    const expireOwnerMode = () => {
      if (!masterBackupRestoringRef.current) setOwnerMode(false);
    };
    let timer = window.setTimeout(expireOwnerMode, 10 * 60 * 1000);
    const activity = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(expireOwnerMode, 10 * 60 * 1000);
    };
    const hidden = () => { if (document.hidden && !masterBackupRestoringRef.current) setOwnerMode(false); };
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
    const blockUnloadDuringRestore = (event: BeforeUnloadEvent) => {
      if (!dueBackupRestoringRef.current && !masterBackupRestoringRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", blockUnloadDuringRestore);
    return () => window.removeEventListener("beforeunload", blockUnloadDuringRestore);
  }, []);
  useEffect(() => {
    if (!ready) return;
    void syncDiagnostics().then(setSyncInfo).catch(() => undefined);
  }, [ready, pending, syncState]);
  useEffect(
    () => () => {
      if (themeTransitionTimerRef.current !== null)
        window.clearTimeout(themeTransitionTimerRef.current);
      if (interfaceScaleTransitionTimerRef.current !== null)
        window.clearTimeout(interfaceScaleTransitionTimerRef.current);
      if (interfaceScaleSaveTimerRef.current !== null)
        window.clearTimeout(interfaceScaleSaveTimerRef.current);
      document.documentElement.classList.remove("theme-transitioning");
      document.documentElement.classList.remove("interface-scale-transitioning");
    },
    [],
  );
  useEffect(() => {
    if (!isCapacitorApp()) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", () => {
          if (masterBackupRestoringRef.current) return;
          if (pad) {
            setPad(null);
            return;
          }
          if (sheet) {
            if (sheet === "dueBackup" && dueBackupRestoringRef.current) return;
            if (sheet === "ownerPin") ownerIntentRef.current = null;
            setSheet(null);
            return;
          }
          if (inventoryOverlay) {
            setInventoryOverlay(null);
            setInventoryDraftItemId("");
            return;
          }
          if (tab === "items" && itemsMode === "festival") {
            setItemsMode("catalogue");
            return;
          }
          if (tab === "items" && itemsMode === "inventory" && inventoryRoute.page === "count" && inventoryRoute.reviewOpen) {
            setInventoryRoute({ ...inventoryRoute, reviewOpen: false });
            return;
          }
          if (tab === "items" && itemsMode === "inventory" && inventoryRoute.page !== "hub") {
            setInventoryRoute({ page: "hub" });
            return;
          }
          if (tab === "items" && itemsMode === "inventory") {
            setItemsMode("catalogue");
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
              tr(
                language,
                "Leave the app? Your unsaved bill will still be here when you return.",
                "ऐप बंद करें? आपका बिना सेव किया बिल वापस आने पर यहीं मिलेगा।",
                "অ্যাপ বন্ধ করবেন? সেভ না-করা বিল ফিরে এলে এখানেই থাকবে।",
              ),
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
  }, [inventoryOverlay, inventoryRoute, itemsMode, language, lines.length, pad, selectedDueParty, selectedParty, sheet, tab]);

  function requestInventoryOwner(resume: () => void) {
    if (ownerMode) {
      resume();
      return;
    }
    ownerIntentRef.current = resume;
    setSheet("ownerPin");
  }

  function closeDueBackup() {
    if (dueBackupRestoringRef.current) return;
    setDueBackupSession(null);
    setDueBackupRestoring(false);
    setSheet(null);
  }

  function confirmDuesBackupRestore(session: DueBackupPreviewSession) {
    if (dueBackupRestoringRef.current) return;
    const { fileName } = session;
    const execute = async () => {
      if (dueBackupRestoringRef.current) return;
      dueBackupRestoringRef.current = true;
      setSheet("dueBackup");
      setDueBackupRestoring(true);
      try {
        const result = session.mode === "complete"
          ? await restoreDuesLedger(session.preview.envelope)
          : await restoreDuesBackup(session.preview.envelope);
        if (session.mode === "legacy")
          await reconcilePartyBalances().catch(() => undefined);
        setDueBackupSession({ step: "result", mode: session.mode, fileName, result } as DueBackupSession);
        setToast(tr(
          language,
          `${result.importedCount} customer ${session.mode === "complete" ? "histories" : "balances"} restored offline.`,
          `${result.importedCount} कस्टमर ${session.mode === "complete" ? "की पूरी हिस्ट्री" : "बैलेंस"} ऑफलाइन रिस्टोर हुए।`,
          `${result.importedCount}টি ক্রেতার ${session.mode === "complete" ? "সম্পূর্ণ ইতিহাস" : "ব্যালেন্স"} অফলাইনে ফিরিয়ে আনা হয়েছে।`,
        ));
        void queueSync();
      } catch (cause) {
        if (session.mode === "complete") {
          const refreshed = await previewDuesLedgerRestore(session.preview.envelope).catch(() => session.preview);
          setDueBackupSession({ step: "preview", mode: "complete", fileName, preview: refreshed });
        } else {
          const refreshed = await previewDuesBackupRestore(session.preview.envelope).catch(() => session.preview);
          setDueBackupSession({ step: "preview", mode: "legacy", fileName, preview: refreshed });
        }
        setToast(
          cause instanceof DuesBackupError || cause instanceof DuesLedgerError
            ? tr(
                language,
                "The dues restore was stopped safely. Review the conflicts and try again.",
                "बाकी रिस्टोर सुरक्षित रूप से रोक दिया गया। टकराव जाँचकर फिर कोशिश करें।",
                "বাকি ফিরিয়ে আনা নিরাপদে বন্ধ হয়েছে। দ্বন্দ্ব দেখে আবার চেষ্টা করুন।",
              )
            : tr(
                language,
                "The balances could not be restored.",
                "बैलेंस रिस्टोर नहीं हुए।",
                "ব্যালেন্স ফিরিয়ে আনা যায়নি।",
              ),
        );
      } finally {
        dueBackupRestoringRef.current = false;
        setDueBackupRestoring(false);
      }
    };
    requestInventoryOwner(() => void execute());
  }

  async function chooseParty(next?: Party | BillingCustomerDraft) {
    const existing = next && "id" in next ? next : undefined;
    const pendingCustomer = next && !("id" in next) ? next : undefined;
    setParty(existing);
    setCustomerDraft(pendingCustomer);
    setSheet(null);
    const repriced = await Promise.all(
      lines.map(async (line) => {
        const item = items.find((x) => x.id === line.itemId);
        if (!item) return line;
        const price = await priceForParty(item, existing);
        return {
          ...line,
          baseUnit: item.baseUnit,
          rate: convertUnitRate(price.rate, item.baseUnit, line.unit),
          lastPriceLabel: price.record
            ? `${t(language, "lastPrice")}: ${formatMoney(price.record.lastPrice)}/${localizedUnitName(language, item.baseUnit)} · ${formatLocalizedDate(price.record.lastSoldDate, language)}`
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
          itemNameHi: item.nameHi,
          itemNameBn: item.nameBn,
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
            ? `${t(language, "lastPrice")}: ${formatMoney(price.record.lastPrice)}/${localizedUnitName(language, item.baseUnit)} · ${formatLocalizedDate(price.record.lastSoldDate, language)}`
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
      const displayName = localizedItemName(language, item);
      const imageUrl = file ? await prepareProductImage(file) : undefined;
      await db.items.update(item.id, {
        imageUrl,
        updatedAt: nowIso(),
        isSynced: false,
      });
      setPending(await pendingCount());
      setToast(
        imageUrl
          ? tr(language, `${displayName} photo saved offline`, `${displayName} की फोटो ऑफलाइन सेव हुई`, `${displayName}-এর ছবি অফলাইনে সেভ হয়েছে`)
          : tr(language, `${displayName} photo removed`, `${displayName} की फोटो हट गई`, `${displayName}-এর ছবি সরানো হয়েছে`),
      );
      await logActivity({ action: imageUrl ? "item.photo.update" : "item.photo.remove", entityType: "item", entityId: item.id, description: `${item.name} photo ${imageUrl ? "updated" : "removed"}`, actor: ownerMode ? "owner" : "staff" });
      void syncNow(setSyncState)
        .then(() => pendingCount())
        .then(setPending);
    } catch (error) {
      setToast(
        language === "en" && error instanceof Error
          ? error.message
          : tr(language, "Could not save this product photo.", "प्रोडक्ट फोटो सेव नहीं हुई।", "প্রোডাক্টের ছবি সেভ হয়নি।"),
      );
      throw error;
    }
  }

  async function productSaved(
    item: Item,
    mode: "created" | "updated" | "archived",
  ) {
    const displayName = localizedItemName(language, item);
    setEditingItem(null);
    setSheet(null);
    if (productEditorOrigin === "inventoryInward" && mode === "created") {
      setInventoryDraftItemId(item.id);
      setItemsMode("inventory");
      setInventoryOverlay("inward");
    }
    setPending(await pendingCount());
    setToast(
      mode === "created"
        ? tr(language, `${displayName} added and saved offline`, `${displayName} जुड़कर ऑफलाइन सेव हुआ`, `${displayName} যোগ হয়ে অফলাইনে সেভ হয়েছে`)
        : mode === "archived"
          ? tr(language, `${displayName} archived safely`, `${displayName} सुरक्षित तरीके से आर्काइव हुआ`, `${displayName} নিরাপদে আর্কাইভ হয়েছে`)
          : tr(language, `${displayName} updated`, `${displayName} अपडेट हुआ`, `${displayName} আপডেট হয়েছে`),
    );
    await logActivity({ action: `item.${mode}`, entityType: "item", entityId: item.id, description: `${item.name} ${mode}`, actor: ownerMode ? "owner" : "staff" });
    void syncNow(setSyncState)
      .then(() => pendingCount())
      .then(setPending);
  }

  async function restoreProduct(item: Item) {
    try {
      const restored = await restoreArchivedItem(
        item.id,
        ownerMode ? "owner" : "staff",
      );
      setPending(await pendingCount());
      setToast(
        tr(
          language,
          `${localizedItemName(language, restored)} restored to active products`,
          `${localizedItemName(language, restored)} फिर से चालू प्रोडक्ट में आ गया`,
          `${localizedItemName(language, restored)} আবার চালু পণ্যে ফিরে এসেছে`,
        ),
      );
      void syncNow(setSyncState)
        .then(() => pendingCount())
        .then(setPending);
    } catch (error) {
      setToast(
        language === "en" && error instanceof Error
          ? error.message
          : tr(
              language,
              "Could not restore this product.",
              "यह प्रोडक्ट वापस नहीं लाया जा सका।",
              "এই পণ্য ফিরিয়ে আনা যায়নি।",
            ),
      );
    }
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
    setUndoAction({
      label,
      run: () => {
        setLines(snapshot);
        setUndoAction(null);
        setToast(
          tr(
            language,
            `${label} undone`,
            `${label} वापस किया गया`,
            `${label} আগের অবস্থায় ফেরানো হয়েছে`,
          ),
        );
      },
    });
  }

  const changeLine = (index: number, patch: Partial<InvoiceLine>) => {
    rememberLineUndo(
      tr(language, "Bill change", "बिल में बदलाव", "বিলে বদল"),
      lines,
    );
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };
  const removeLine = (index: number) => {
    const confirmed = confirm(
      language === "hi"
        ? "इस आइटम को बिल से हटाएँ?"
        : language === "bn"
          ? "এই আইটেমটি বিল থেকে সরাবেন?"
          : "Remove this item from the bill?",
    );
    if (!confirmed) return;
    rememberLineUndo(
      language === "hi"
        ? "आइटम हटाया"
        : language === "bn"
          ? "আইটেম সরানো হয়েছে"
          : "Removed item",
      lines,
    );
    setLines((current) => current.filter((_, i) => i !== index));
  };

  async function repeatLastBill() {
    if (!party) return;
    const previous = invoices.find((invoice) => invoice.partyId === party.id && invoice.type === "sale" && !invoice.deletedAt);
    if (!previous)
      return setToast(
        tr(
          language,
          "No earlier bill was found for this customer.",
          "इस कस्टमर का कोई पुराना बिल नहीं मिला।",
          "এই কাস্টমারের কোনও পুরনো বিল পাওয়া যায়নি।",
        ),
      );
    const snapshot = lines;
    setLines(previous.lineItems.map((line) => ({ ...line })));
    setOtherCharges((previous.otherCharges || []).map((charge) => ({ ...charge, enabled: true })) as DraftInvoiceCharge[]);
    setGstEnabled(previous.gstTotal > 0);
    setPaymentPlan("full");
    setPaid(0);
    rememberLineUndo(
      tr(language, "Last bill copied", "पिछला बिल कॉपी किया", "আগের বিল কপি করা হয়েছে"),
      snapshot,
    );
    setToast(
      tr(
        language,
        `${previous.invoiceNumber} was copied as a new unsaved bill.`,
        `${previous.invoiceNumber} को नए बिना सेव किए बिल में कॉपी किया गया।`,
        `${previous.invoiceNumber} নতুন সেভ না-করা বিল হিসেবে কপি হয়েছে।`,
      ),
    );
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
      const tenderBreakdown = paymentPlan === "credit"
        ? []
        : splitPayment
          ? paymentBreakdown
          : [{
              mode: paymentMode,
              amount: paymentPlan === "full" ? bill.grandTotal : paid,
            } satisfies InvoicePaymentAllocation];
      const receivedNow = paymentPlan === "credit"
        ? 0
        : splitPayment
          ? roundMoney(
              tenderBreakdown.reduce(
                (sum, entry) => sum + roundMoney(entry.amount),
                0,
              ),
            )
          : paymentPlan === "full"
            ? bill.grandTotal
            : paid;
      invoice =
        counterDocument === "quotation"
          ? await saveQuotation({ party, customerDraft, lines, otherCharges: appliedCharges, idempotencyKey: draftId })
          : await saveSale({
              idempotencyKey: draftId,
              party,
              customerDraft,
              lines,
              paid: receivedNow,
              paymentMode: paymentPlan === "credit"
                ? "credit"
                : splitPayment
                  ? "mixed"
                  : paymentMode,
              paymentBreakdown: tenderBreakdown,
              paymentPlan,
              otherCharges: appliedCharges,
            });
      setLastInvoice(invoice);
      setPreviewFormat(null);
      setLines([]);
      setPaid(0);
      setPaymentPlan("full");
      setPaymentMode("cash");
      setSplitPayment(false);
      setPaymentBreakdown([]);
      setParty(undefined);
      setCustomerDraft(undefined);
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
        tr(
          language,
          `${invoice.invoiceNumber} ${invoice.type === "quotation" ? "quotation" : "bill"} saved offline.`,
          `${invoice.invoiceNumber} ${invoice.type === "quotation" ? "कोटेशन" : "बिल"} ऑफलाइन सेव हुआ।`,
          `${invoice.invoiceNumber} ${invoice.type === "quotation" ? "কোটেশন" : "বিল"} অফলাইনে সেভ হয়েছে।`,
        ),
      );
      setSheet(action === "save" ? "invoice" : "preview");
    } catch (error) {
      setToast(
        language === "en" && error instanceof Error
          ? error.message
          : tr(
              language,
              "The bill could not be saved.",
              "बिल सेव नहीं हुआ।",
              "বিল সেভ হয়নি।",
            ),
      );
      savingRef.current = false;
      setSaving(false);
      return;
    }
    savingRef.current = false;
    setSaving(false);
  }

  function invoiceShareMessage(invoice: Invoice) {
    const template =
      invoice.type === "quotation"
        ? outgoingMessageTemplates.quotation
        : outgoingMessageTemplates.invoice;
    return renderMessageTemplate(template, {
      party_name: localizedInvoicePartyName(language, invoice),
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

  function changeLanguage(next: Language) {
    if (!isLanguage(next) || next === language) return;
    const previous = language;
    setLanguage(next);
    void savePreference("language", next).catch(() => {
      setLanguage(previous);
      setToast(
        previous === "hi"
          ? "भाषा सेव नहीं हुई। दोबारा कोशिश करें।"
          : previous === "bn"
            ? "ভাষা সেভ হয়নি। আবার চেষ্টা করুন।"
            : "Language could not be saved. Try again.",
      );
    });
  }

  async function saveCloud(next: CloudConfig) {
    try {
      const saved = await configureCloud(next);
      setCloudConfig(saved);
      setCloudRevision((revision) => revision + 1);
      setToast(
        tr(
          language,
          "Cloud backup settings saved. Sync is starting now.",
          "क्लाउड बैकअप सेटिंग सेव हुई। अब सिंक शुरू हो रहा है।",
          "ক্লাউড ব্যাকআপ সেটিং সেভ হয়েছে। এখন সিঙ্ক শুরু হচ্ছে।",
        ),
      );
    } catch (error) {
      setToast(
        language === "en" && error instanceof Error
          ? error.message
          : tr(
              language,
              "Cloud settings could not be saved.",
              "क्लाउड सेटिंग सेव नहीं हुई।",
              "ক্লাউড সেটিং সেভ হয়নি।",
            ),
      );
    }
  }

  async function disconnectCloud() {
    if (
      !confirm(
        tr(
          language,
          "Disconnect Supabase cloud backup on this device? Your offline data will stay here.",
          "इस डिवाइस से Supabase क्लाउड बैकअप डिसकनेक्ट करें? आपका ऑफलाइन डेटा यहीं रहेगा।",
          "এই ডিভাইস থেকে Supabase ক্লাউড ব্যাকআপ ডিসকানেক্ট করবেন? অফলাইন ডেটা এখানেই থাকবে।",
        ),
      )
    )
      return false;
    try {
      await clearCloudConfig();
      setCloudConfig({ url: "", key: "", syncCode: "" });
      setCloudRevision((revision) => revision + 1);
      setSyncState("offline");
      setToast(
        tr(
          language,
          "Cloud backup disconnected. Offline data was not removed.",
          "क्लाउड बैकअप डिसकनेक्ट हुआ। ऑफलाइन डेटा नहीं हटाया गया।",
          "ক্লাউড ব্যাকআপ ডিসকানেক্ট হয়েছে। অফলাইন ডেটা মুছে যায়নি।",
        ),
      );
      return true;
    } catch (error) {
      // clearCloudConfig still disables cloud for this running session when
      // persistent storage is unavailable. Refresh sync UI and tell the owner
      // that the disconnect must be retried before the next app launch.
      setCloudRevision((revision) => revision + 1);
      setSyncState("offline");
      setToast(
        language === "en" && error instanceof Error
          ? error.message
          : tr(
              language,
              "Cloud was stopped for this session, but the disconnect could not be saved.",
              "इस सेशन के लिए क्लाउड रुक गया, लेकिन डिसकनेक्ट सेव नहीं हुआ।",
              "এই সেশনের জন্য ক্লাউড বন্ধ হয়েছে, কিন্তু ডিসকানেক্ট সেভ হয়নি।",
            ),
      );
      return false;
    }
  }

  async function promptInstall() {
    const event = installEvent;
    if (!event) return;
    // beforeinstallprompt is one-shot. Clear it immediately so a rejected or
    // dismissed prompt cannot leave a permanently broken Install button.
    setInstallEvent(undefined);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome === "dismissed")
        setToast(
          tr(
            language,
            "Installation dismissed. Your offline data is unchanged.",
            "इंस्टॉलेशन रद्द हुआ। आपका ऑफलाइन डेटा सुरक्षित है।",
            "ইনস্টল বাতিল হয়েছে। আপনার অফলাইন ডেটা আগের মতোই আছে।",
          ),
        );
    } catch {
      setToast(
        tr(
          language,
          "The install prompt is no longer available. Install the app from your browser menu.",
          "इंस्टॉल प्रॉम्प्ट अब उपलब्ध नहीं है। ब्राउज़र मेन्यू से ऐप इंस्टॉल करें।",
          "ইনস্টল প্রম্পট আর পাওয়া যাচ্ছে না। ব্রাউজার মেনু থেকে অ্যাপ ইনস্টল করুন।",
        ),
      );
    }
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

  function changeInterfaceScale(next: InterfaceScale) {
    if (!interfaceScaleOptions.includes(next) || next === interfaceScale) return;
    const root = document.documentElement;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduceMotion) {
      root.classList.add("interface-scale-transitioning");
      if (interfaceScaleTransitionTimerRef.current !== null)
        window.clearTimeout(interfaceScaleTransitionTimerRef.current);
      interfaceScaleTransitionTimerRef.current = window.setTimeout(() => {
        root.classList.remove("interface-scale-transitioning");
        interfaceScaleTransitionTimerRef.current = null;
      }, 260);
    }

    applyInterfaceScale(next);
    writeInterfaceScaleCache(next);
    setInterfaceScale(next);

    if (interfaceScaleSaveTimerRef.current !== null)
      window.clearTimeout(interfaceScaleSaveTimerRef.current);
    interfaceScaleSaveTimerRef.current = window.setTimeout(() => {
      interfaceScaleSaveTimerRef.current = null;
      void savePreference(INTERFACE_SCALE_META, next).catch(() => {
        setToast(
          tr(
            language,
            "Interface size changed for now, but could not be saved on this device.",
            "इंटरफ़ेस का साइज़ अभी बदल गया है, लेकिन इस डिवाइस में सेव नहीं हुआ।",
            "ইন্টারফেসের আকার এখন বদলেছে, কিন্তু এই ডিভাইসে সেভ হয়নি।",
          ),
        );
      });
    }, 180);
  }

  const previousTab = previousTabRef.current;
  const pageDirection =
    previousTab === tab
      ? "neutral"
      : tabOrder.indexOf(tab) > tabOrder.indexOf(previousTab)
        ? "forward"
        : "backward";

  if (startupError)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f1e8] p-6">
        <div role="alert" className="w-full max-w-lg rounded-3xl border border-[#9b4c28] bg-white p-6 text-[#162b26] shadow-xl">
          <p className="text-xs font-black uppercase tracking-wider text-[#9b4c28]">
            {tr(language, "Offline data could not open", "ऑफलाइन डेटा नहीं खुला", "অফলাইন ডেটা খোলেনি")}
          </p>
          <h1 className="mt-2 text-xl font-black">{tr(language, "Midori Kanjo needs attention", "Midori Kanjo पर ध्यान दें", "Midori Kanjo-তে নজর দিন")}</h1>
          <p className="mt-3 text-sm leading-6">
            {startupError}
          </p>
          <p className="mt-3 text-sm leading-6 text-[#40544c]">
            {tr(
              language,
              "Close other Midori Kanjo tabs, check that this device has free storage, then reload. Do not uninstall or clear site data while unsynced records may still be on this device.",
              "Midori Kanjo के दूसरे टैब बंद करें, डिवाइस में खाली जगह जाँचें और फिर रीलोड करें। जब तक पेंडिंग रिकॉर्ड इस डिवाइस में हों, ऐप अनइंस्टॉल न करें और साइट डेटा साफ न करें।",
              "Midori Kanjo-র অন্য ট্যাব বন্ধ করুন, ডিভাইসে খালি জায়গা আছে কি না দেখুন, তারপর রিলোড করুন। পেন্ডিং রেকর্ড ডিভাইসে থাকলে অ্যাপ আনইনস্টল বা সাইট ডেটা মুছবেন না।",
            )}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="counter-primary mt-5 w-full"
          >
            {tr(language, "Reload safely", "सुरक्षित तरीके से रीलोड करें", "নিরাপদে রিলোড করুন")}
          </button>
        </div>
      </div>
    );

  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f1e8]">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-pulse rounded-2xl bg-[#ef7d32]" />
          <p className="mt-4 text-sm font-bold text-[#31524a]">
            {tr(language, "Opening your offline counter…", "ऑफलाइन काउंटर खुल रहा है…", "অফলাইন কাউন্টার খুলছে…")}
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
          onLanguage={changeLanguage}
          onSearch={() => setSheet("globalSearch")}
          onSync={() => setSheet("syncCenter")}
          undoLabel={undoAction?.label}
          onUndo={() => undoAction?.run()}
        />
        <div className="app-page-stage md:pb-8 md:pl-[220px]">
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
              customerDraft={customerDraft}
              lines={lines}
              bill={bill}
              paid={paid}
              paymentMode={paymentMode}
              splitPayment={splitPayment}
              paymentBreakdown={paymentBreakdown}
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
                setPaid(0);
                setPaymentBreakdown([]);
                if (plan === "credit") setSplitPayment(false);
              }}
              onMode={setPaymentMode}
              onSplitPayment={(enabled) => {
                setSplitPayment(enabled);
                if (!enabled) {
                  const firstTender = paymentBreakdown.find((entry) => entry.amount > 0);
                  if (firstTender) setPaymentMode(firstTender.mode);
                  setPaymentBreakdown([]);
                  if (paymentPlan === "full") setPaid(0);
                }
              }}
              onPaymentBreakdown={(next) => {
                const normalized = next.map((entry) => ({
                  ...entry,
                  amount: roundMoney(entry.amount),
                }));
                setPaymentBreakdown(normalized);
                setPaid(
                  roundMoney(
                    normalized.reduce((sum, entry) => sum + entry.amount, 0),
                  ),
                );
              }}
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
              dueTemplate={outgoingMessageTemplates.due}
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
              dueTemplate={outgoingMessageTemplates.due}
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
              onBackup={() => {
                setDueBackupSession(null);
                setSheet("dueBackup");
              }}
              onToast={(message) => { setToast(message); void queueSync(); }}
            />
          )}
          {tab === "items" && (
            itemsMode === "inventory" ? (
              <InventoryWorkspace
                items={items}
                allItems={reportItems}
                parties={parties}
                invoices={invoices}
                categories={categories}
                language={language}
                ownerMode={ownerMode}
                route={inventoryRoute}
                overlay={inventoryOverlay}
                onRoute={setInventoryRoute}
                onOverlay={(next) => {
                  setInventoryOverlay(next);
                  if (next !== "inward") setInventoryDraftItemId("");
                }}
                onBackCatalogue={() => {
                  setInventoryOverlay(null);
                  setInventoryDraftItemId("");
                  setInventoryRoute({ page: "hub" });
                  setItemsMode("catalogue");
                }}
                onChanged={(message) => {
                  setToast(message);
                  void queueSync();
                }}
                onRequestOwner={requestInventoryOwner}
                preferredItemId={inventoryDraftItemId}
                onCreateProduct={() => {
                  setProductEditorOrigin("inventoryInward");
                  setEditingItem(null);
                  setSheet("product");
                }}
                onClose={() => setInventoryOverlay(null)}
              />
            ) : itemsMode === "festival" ? (
              <FestivalWorkspace
                items={reportItems}
                categories={categories}
                invoices={invoices}
                language={language}
                ownerMode={ownerMode}
                onBackCatalogue={() => setItemsMode("catalogue")}
                onOpenReports={() => {
                  setReportsInitialView("dead");
                  setItemsMode("catalogue");
                  setTab("reports");
                }}
                onChanged={(message) => {
                  setToast(message);
                  void queueSync();
                }}
              />
            ) : (
              <ItemsScreen
                items={items}
                archivedItems={reportItems.filter(isRestorableArchivedItem)}
                language={language}
                ownerMode={ownerMode}
                onOwnerMode={(enabled) => {
                  if (!enabled) setOwnerMode(false);
                  else setSheet("ownerPin");
                }}
                onInventory={() => {
                  setInventoryRoute({ page: "hub" });
                  setInventoryOverlay(null);
                  setItemsMode("inventory");
                }}
                onFestival={() => {
                  setInventoryOverlay(null);
                  setItemsMode("festival");
                }}
                onAdd={(item) => {
                  addItem(item);
                  setTab("bill");
                }}
                onCreate={() => {
                  setProductEditorOrigin("catalogue");
                  setEditingItem(null);
                  setSheet("product");
                }}
                onEdit={(item) => {
                  setProductEditorOrigin("catalogue");
                  setEditingItem(item);
                  setSheet("product");
                }}
                onRestore={restoreProduct}
                onPhoto={updateItemPhoto}
              />
            )
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
              items={reportItems}
              language={language}
              ownerMode={ownerMode}
              cloudConfigured={isCloudConfigured()}
              initialAdvancedReport={reportsInitialView}
              onOwnerUnlock={() => setSheet("ownerPin")}
              onMasterRestoringChange={(restoring) => {
                masterBackupRestoringRef.current = restoring;
              }}
              business={business}
              format={invoiceFormat}
              catalogueTemplate={outgoingMessageTemplates.catalogue}
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
              interfaceScale={interfaceScale}
              format={invoiceFormat}
              business={business}
              invoices={invoices}
              installable={Boolean(installEvent)}
              cloudConfigured={isCloudConfigured()}
              cloudConfig={cloudConfig}
              onCloud={saveCloud}
              onCloudDisconnect={disconnectCloud}
              onLanguage={changeLanguage}
              onTheme={changeTheme}
              onInterfaceScale={changeInterfaceScale}
              onFormat={(next) => {
                setInvoiceFormat(next);
                savePreference("invoice-format", next);
              }}
              onBusiness={async (next) => {
                const normalized = normalizeBusinessSettings(next);
                await savePreference(
                  "business-settings",
                  JSON.stringify(normalized),
                );
                setBusiness(normalized);
                setToast(
                  tr(
                    language,
                    "Shop details saved.",
                    "दुकान की जानकारी सेव हुई।",
                    "দোকানের তথ্য সেভ হয়েছে।",
                  ),
                );
              }}
              onInstall={() => void promptInstall()}
              onToast={(message) => { setToast(message); void queueSync(); }}
              onInventory={() => {
                setSelectedParty(null);
                setSelectedDueParty(null);
                setInventoryOverlay(null);
                setInventoryRoute({ page: "hub" });
                setItemsMode("inventory");
                setTab("items");
              }}
              onFestival={() => {
                setSelectedParty(null);
                setSelectedDueParty(null);
                setInventoryOverlay(null);
                setItemsMode("festival");
                setTab("items");
              }}
              onNavigate={(next) => {
                if (next === "reports") setReportsInitialView("daily");
                setTab(next);
                if (next === "items") setItemsMode("catalogue");
                if (next !== "parties") setSelectedParty(null);
                if (next !== "dues") setSelectedDueParty(null);
              }}
              workspace={workspace}
              printerProfiles={printerProfiles}
              messageTemplates={messageTemplates}
              activityLogs={activityLogs}
              parties={parties}
              items={items}
              ownerMode={ownerMode}
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
                const canonical = canonicalizeMessageTemplates(language, next);
                setMessageTemplates(canonical);
                void writeJsonMeta(MESSAGE_TEMPLATES_META, canonical);
              }}
              onMergeParty={async (source, target) => {
                await mergeParties(source.id, target.id, ownerMode ? "owner" : "staff");
                await queueSync();
                setToast(
                  tr(
                    language,
                    `${source.name} was merged into ${target.name}.`,
                    `${source.name} को ${target.name} में मर्ज किया गया।`,
                    `${source.name}-কে ${target.name}-এর সঙ্গে মার্জ করা হয়েছে।`,
                  ),
                );
              }}
              onMergeItem={async (source, target) => {
                await mergeItems(source.id, target.id, ownerMode ? "owner" : "staff");
                await queueSync();
                setToast(
                  tr(
                    language,
                    `${source.name} was merged into ${target.name}.`,
                    `${source.name} को ${target.name} में मर्ज किया गया।`,
                    `${source.name}-কে ${target.name}-এর সঙ্গে মার্জ করা হয়েছে।`,
                  ),
                );
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
            if (next === "reports") setReportsInitialView("daily");
            setTab(next);
            if (next === "items") setItemsMode("catalogue");
            else {
              setInventoryOverlay(null);
              setInventoryRoute({ page: "hub" });
            }
            if (next !== "parties") setSelectedParty(null);
            if (next !== "dues") setSelectedDueParty(null);
          }}
        />
      </div>
      {sheet === "party" && (
        <PartyPicker
          language={language}
          parties={parties.filter((entry) => entry.type === "customer")}
          selected={party}
          selectedDraft={customerDraft}
          onClose={() => setSheet(null)}
          onSelect={chooseParty}
          onToast={setToast}
        />
      )}
      {sheet === "dueParty" && (
        <DueCustomerPicker
          language={language}
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
          language={language}
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
          festivalEntries={festivalEntries}
          language={language}
          ownerMode={ownerMode}
          onPad={setPad}
          onClose={() => {
            setEditingItem(null);
            setSheet(null);
            if (productEditorOrigin === "inventoryInward") {
              setItemsMode("inventory");
              setInventoryOverlay("inward");
            }
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
              setToast(
                tr(
                  language,
                  `${created.name} was saved and selected for this bill.`,
                  `${created.name} सेव होकर इस बिल के लिए चुना गया।`,
                  `${created.name} সেভ হয়ে এই বিলের জন্য বেছে নেওয়া হয়েছে।`,
                ),
              );
              return;
            }
            if (partyEditorOrigin === "dues") {
              setSelectedParty(created);
              setSelectedDueParty(created);
              setTab("dues");
              setSheet("due");
              setToast(
                tr(
                  language,
                  `${created.name} was saved. Enter the due amount.`,
                  `${created.name} सेव हुआ। बाकी रकम डालें।`,
                  `${created.name} সেভ হয়েছে। বাকি টাকার অঙ্ক দিন।`,
                ),
              );
              return;
            }
            setSheet(null);
            setSelectedParty(created);
            setTab("parties");
            setToast(
              tr(
                language,
                `${created.type === "supplier" ? "Supplier" : "Customer"} saved offline.`,
                `${created.type === "supplier" ? "सप्लायर" : "कस्टमर"} ऑफलाइन सेव हुआ।`,
                `${created.type === "supplier" ? "সাপ্লায়ার" : "কাস্টমার"} অফলাইনে সেভ হয়েছে।`,
              ),
            );
          }}
        />
      )}
      {sheet === "due" && selectedParty && (
        <DueSheet
          language={language}
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
                ? tr(language, "Supplier bill added", "सप्लायर बिल जुड़ गया", "সাপ্লায়ার বিল যোগ হয়েছে")
                : tr(language, "Customer due added and saved", "कस्टमर का बकाया जुड़कर सेव हो गया", "কাস্টমারের বাকি যোগ হয়ে সেভ হয়েছে"),
            );
            await logActivity({ action: "due.create", entityType: "due", entityId: selectedParty.id, description: `Manual due recorded for ${selectedParty.name}`, actor: ownerMode ? "owner" : "staff" });
            await queueSync();
          }}
        />
      )}
      {sheet === "payment" && selectedParty && (
        <PaymentSheet
          language={language}
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
                ? tr(language, "Payment to supplier recorded", "सप्लायर का पेमेंट सेव हुआ", "সাপ্লায়ারের পেমেন্ট সেভ হয়েছে")
                : tr(language, "Customer payment recorded and allocated", "कस्टमर पेमेंट सेव होकर बिल में जुड़ गया", "কাস্টমার পেমেন্ট সেভ হয়ে বিলে যোগ হয়েছে"),
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
      {sheet === "dueBackup" && (
        <DueBackupSheet
          parties={parties}
          invoices={invoices}
          payments={payments}
          accountEntries={accountEntries}
          business={business}
          language={language}
          ownerMode={ownerMode}
          session={dueBackupSession}
          restoring={dueBackupRestoring}
          onSession={setDueBackupSession}
          onConfirm={confirmDuesBackupRestore}
          onClose={closeDueBackup}
          onToast={setToast}
        />
      )}
      {sheet === "invoice" && lastInvoice && (
        <InvoiceSaved
          invoice={lastInvoice}
          language={language}
          business={business}
          format={invoiceFormat}
          shareMessage={invoiceShareMessage(lastInvoice)}
          onClose={() => setSheet(null)}
          onPreview={(selectedFormat) => {
            setPreviewFormat(selectedFormat);
            setSheet("preview");
          }}
        />
      )}
      {sheet === "ownerPin" && (
        <OwnerPinSheet
          language={language}
          configured={ownerConfigured}
          onClose={() => {
            ownerIntentRef.current = null;
            setSheet(null);
          }}
          onUnlocked={() => {
            setOwnerConfigured(true);
            setOwnerMode(true);
            setSheet(null);
            const resume = ownerIntentRef.current;
            ownerIntentRef.current = null;
            resume?.();
          }}
          onToast={setToast}
        />
      )}
      {sheet === "globalSearch" && (
        <GlobalSearchSheet
          language={language}
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
          language={language}
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
          language={language}
          payment={lastPaymentReceipt.payment}
          party={lastPaymentReceipt.party}
          remaining={lastPaymentReceipt.remaining}
          business={business}
          templates={outgoingMessageTemplates}
          format={invoiceFormat}
          onClose={() => { setLastPaymentReceipt(null); setSheet(null); }}
        />
      )}
      {sheet === "preview" && lastInvoice && (
        <BillPreviewSheet
          language={language}
          invoice={lastInvoice}
          business={business}
          format={previewFormat || invoiceFormat}
          onClose={() => {
            setPreviewFormat(null);
            setSheet("invoice");
          }}
          onPrint={() => {
            const prepared = preparePrintWindow();
            void printInvoice(
              lastInvoice,
              business,
              previewFormat || invoiceFormat,
              prepared,
              language,
            ).catch(() => {
              prepared?.close();
              setToast(
                tr(
                  language,
                  "The print preview could not be opened.",
                  "प्रिंट प्रिव्यू नहीं खुला।",
                  "প্রিন্ট প্রিভিউ খোলা যায়নি।",
                ),
              );
            });
          }}
          onShare={() =>
            void shareInvoice(
              lastInvoice,
              business,
              previewFormat || invoiceFormat,
              null,
              invoiceShareMessage(lastInvoice),
              language,
            )
          }
        />
      )}
      {pad && <NumberPad language={language} state={pad} onClose={() => setPad(null)} />}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="fixed left-1/2 top-20 z-[90] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl bg-[#173f35] px-4 py-3 text-center text-sm font-bold text-white shadow-xl"
        >
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
      <div className="app-header-brand flex min-w-0 items-center gap-2.5 md:gap-3">
        <div className="brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173f35] text-lg font-black text-[#ffb45f]">
          M
        </div>
        <div className="app-header-brand-copy min-w-0">
          <h1 className="truncate text-[0.875rem] font-black tracking-tight md:text-[0.9375rem]">
            Midori Kanjo
          </h1>
          <p className="truncate text-[0.5625rem] font-semibold text-[#6d7973] md:text-[0.625rem]">
            {tr(
              language,
              "Made by Sayan Finance",
              "Sayan Finance द्वारा बनाया गया",
              "Sayan Finance-এর তৈরি",
            )}
          </p>
        </div>
      </div>
      <div className="app-header-actions flex shrink-0 items-center gap-1.5 md:gap-2">
        {undoLabel && (
          <button
            type="button"
            onClick={onUndo}
            aria-label={`${tr(language, "Undo", "वापस करें", "ফিরিয়ে দিন")} ${undoLabel}`}
            title={`${tr(language, "Undo", "वापस करें", "ফিরিয়ে দিন")} ${undoLabel}`}
            className="grid h-10 w-10 place-items-center rounded-xl border border-[#ded9ce] bg-white text-base font-black"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 7 5 11l4 4" />
              <path d="M5 11h8a6 6 0 0 1 6 6" />
            </svg>
          </button>
        )}
        <button type="button" onClick={onSearch} aria-label={tr(language, "Search everything", "सब कुछ खोजें", "সব কিছু খুঁজুন")} title={`${tr(language, "Search everything", "सब कुछ खोजें", "সব কিছু খুঁজুন")} · Ctrl/Command K`} className="app-header-search grid h-10 w-10 place-items-center rounded-xl border border-[#ded9ce] bg-white text-lg font-black">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
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
          aria-label={tr(language, "Choose language", "भाषा चुनें", "ভাষা বাছুন")}
          className="language-toggle"
        >
          {(["en", "hi", "bn"] as Language[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              aria-label={languageNames[option]}
              title={languageNames[option]}
              onClick={() => onLanguage(option)}
              className={language === option ? "active" : ""}
            >
              {option === "en" ? "EN" : option === "hi" ? "हिं" : "বাং"}
            </button>
          ))}
        </div>
        <label className="app-language-select" title={languageNames[language]}>
          <span className="sr-only">{tr(language, "Choose language", "भाषा चुनें", "ভাষা বাছুন")}</span>
          <select
            aria-label={tr(language, "Choose language", "भाषा चुनें", "ভাষা বাছুন")}
            value={language}
            onChange={(event) => onLanguage(event.target.value as Language)}
          >
            <option value="en">EN</option>
            <option value="hi">हिं</option>
            <option value="bn">বাং</option>
          </select>
        </label>
        <button type="button" onClick={onSync} aria-label={label} title={label} className="app-sync-button flex min-h-10 items-center gap-2 rounded-full border border-[#ded9ce] bg-white px-2.5 py-2 text-[0.625rem] font-extrabold md:px-3">
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
  customerDraft,
  lines,
  bill,
  paid,
  paymentMode,
  splitPayment,
  paymentBreakdown,
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
  onSplitPayment,
  onPaymentBreakdown,
  onSave,
}: {
  language: Language;
  documentType: CounterDocument;
  onDocumentType: (type: CounterDocument) => void;
  party?: Party;
  customerDraft?: BillingCustomerDraft;
  lines: InvoiceLine[];
  bill: ReturnType<typeof calculateBill>;
  paid: number;
  paymentMode: PaymentChannel;
  splitPayment: boolean;
  paymentBreakdown: InvoicePaymentAllocation[];
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
  onSplitPayment: (enabled: boolean) => void;
  onPaymentBreakdown: (next: InvoicePaymentAllocation[]) => void;
  onSave: (a: "save" | "print" | "whatsapp") => void;
}) {
  const isQuotation = documentType === "quotation";
  const taxable = Math.max(0, bill.subtotal - bill.discountTotal);
  const hasCustomer = Boolean(party || customerDraft?.name.trim());
  const splitMatchesTotal =
    Math.abs(roundMoney(paid - bill.grandTotal)) < 0.01;
  const splitHasMultipleMethods =
    paymentBreakdown.filter((entry) => entry.amount > 0).length >= 2;
  const splitDifference = roundMoney(bill.grandTotal - paid);
  const splitRemaining = Math.max(0, splitDifference);
  const splitOver = Math.max(0, -splitDifference);
  const paymentReady =
    isQuotation ||
    (paymentPlan === "full" ? !splitPayment || (splitMatchesTotal && splitHasMultipleMethods) :
      hasCustomer &&
        (paymentPlan === "credit" ||
          (paid > 0 &&
            paid < bill.grandTotal &&
            (!splitPayment || splitHasMultipleMethods))));
  const projectedBalance = (party?.currentBalance || 0) + bill.amountDue;
  const documentLabel = isQuotation
    ? t(language, "newQuotation")
    : t(language, "newBill");
  const updateTender = (
    mode: PaymentChannel,
    patch: Partial<Pick<InvoicePaymentAllocation, "amount" | "reference">>,
  ) => {
    const current = paymentBreakdown.find((entry) => entry.mode === mode) || {
      mode,
      amount: 0,
    };
    const nextEntry = {
      ...current,
      ...patch,
      ...(patch.amount === undefined
        ? {}
        : { amount: roundMoney(patch.amount) }),
    };
    const next = paymentBreakdown.filter((entry) => entry.mode !== mode);
    if (nextEntry.amount > 0 || nextEntry.reference?.trim()) next.push(nextEntry);
    next.sort((a, b) => paymentChannels.indexOf(a.mode) - paymentChannels.indexOf(b.mode));
    onPaymentBreakdown(next);
  };
  return (
    <section className="bill-screen mx-auto max-w-5xl px-3 py-4 md:px-7 md:py-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.6875rem] font-black uppercase tracking-[.15em] text-[#d86f29]">
            {t(language, "fastCounter")}
          </p>
          <h2 className="mt-1 text-2xl font-black">{documentLabel}</h2>
        </div>
        <div className="flex rounded-xl border border-[#dcd8cf] bg-white p-1">
          <button
            type="button"
            aria-pressed={!isQuotation}
            onClick={() => onDocumentType("sale")}
            className={`min-h-10 rounded-lg px-3 text-[0.625rem] font-black ${!isQuotation ? "bg-[#014921] text-white" : "text-[#66736d]"}`}
          >
            {t(language, "saleBill")}
          </button>
          <button
            type="button"
            aria-pressed={isQuotation}
            onClick={() => onDocumentType("quotation")}
            className={`min-h-10 rounded-lg px-3 text-[0.625rem] font-black ${isQuotation ? "bg-[#ef7d32] text-white" : "text-[#66736d]"}`}
          >
            {t(language, "quotation")}
          </button>
        </div>
        {draftSavedAt && <span className="rounded-full bg-[#f4faf0] px-3 py-2 text-[0.5625rem] font-black text-[#267055]">✓ {tr(language, "Draft saved", "ड्राफ्ट सेव हुआ", "ড্রাফ্ট সেভ হয়েছে")} {formatLocalizedDateTime(draftSavedAt, language, { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      <div className="bill-workspace-grid grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
        <div>
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_108px] gap-2">
            <button
              onClick={onParty}
              className="flex min-h-16 min-w-0 items-center justify-between rounded-2xl border-2 border-[#d8d4c9] bg-white px-4 text-left shadow-sm active:scale-[.99]"
            >
              <div className="min-w-0">
                <span className="text-[0.625rem] font-extrabold uppercase tracking-wide text-[#728079]">
                  {t(language, "customer")}
                </span>
                <div
                  className={`mt-1 truncate text-base font-black ${party || customerDraft ? "text-[#173f35]" : "text-[#7a827e]"}`}
                >
                  {party?.name || customerDraft?.name || t(language, "cashCustomer")}
                </div>
                {party && (
                  <div className="mt-1 truncate text-xs font-semibold text-[#bd6427]">
                    {t(language, "udhaar")}: {formatMoney(party.currentBalance)}
                  </div>
                )}
                {!party && customerDraft && (
                  <div className="mt-1 truncate text-[0.625rem] font-semibold text-[#267055]">
                    {tr(language, "New customer · saves with bill", "नया कस्टमर · बिल के साथ सेव होगा", "নতুন কাস্টমার · বিলের সঙ্গে সেভ হবে")}
                  </div>
                )}
              </div>
              <span className="ml-2 shrink-0 text-2xl text-[#ef7d32]">⌄</span>
            </button>
            <button
              type="button"
              onClick={onNewCustomer}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-[#8fbd9f] bg-[#f4faf0] px-2 text-center text-[0.625rem] font-black leading-tight text-[#014921]"
            >
              <span className="mb-1 text-xl leading-none text-[#309d4b]">
                ＋
              </span>
              {t(language, "newCustomer")}
            </button>
          </div>
          {party && partySummary && <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl border border-[#e2e2db] bg-[#f7f5ef] p-3 sm:grid-cols-4"><div><span className="field-caption">{tr(language, "Price tier", "रेट ग्रुप", "রেট গ্রুপ")}</span><strong className="mt-1 block text-[0.6875rem] capitalize">{localizedPriceTierName(language, partySummary.tier)}</strong></div><div><span className="field-caption">{tr(language, "Last bill", "पिछला बिल", "আগের বিল")}</span><strong className="mt-1 block text-[0.6875rem]">{partySummary.latestInvoice ? `${formatLocalizedDate(partySummary.latestInvoice.date, language, { day: "2-digit", month: "short" })} · ${formatMoney(partySummary.latestInvoice.grandTotal)}` : tr(language, "None", "कोई नहीं", "কিছু নেই")}</strong></div><div><span className="field-caption">{t(language, "lastPayment")}</span><strong className="mt-1 block text-[0.6875rem]">{partySummary.latestPayment ? `${formatLocalizedDate(partySummary.latestPayment.date, language, { day: "2-digit", month: "short" })} · ${formatMoney(partySummary.latestPayment.amount)}` : tr(language, "None", "कोई नहीं", "কিছু নেই")}</strong></div><button type="button" disabled={!partySummary.latestInvoice} onClick={onRepeat} className="min-h-11 rounded-lg border border-[#014921] bg-white px-2 text-[0.5625rem] font-black text-[#014921] disabled:opacity-40">↻ {tr(language, "Repeat last bill", "पिछला बिल दोहराएँ", "আগের বিল আবার নিন")}</button></div>}
          <button
            onClick={onItem}
            className="mb-3 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-[#ef7d32] px-4 text-left font-black text-white shadow-lg shadow-orange-900/10 active:scale-[.99]"
          >
            <span className="text-2xl">＋</span>
            <span>{t(language, "addItem")}</span>
            <span className="ml-auto text-xs font-semibold opacity-80">
              {items.length} {t(language, "items")}
            </span>
          </button>
          {quickItems.length > 0 && <div className="mb-3"><div className="mb-2 flex items-center justify-between"><p className="field-caption">{language === "hi" ? "क्विक आइटम · पसंदीदा पहले" : language === "bn" ? "কুইক আইটেম · পছন্দেরগুলো আগে" : "Quick products · favourites first"}</p><span className="text-[0.5rem] text-[#747573]">{language === "hi" ? "पिन करने के लिए ☆ दबाएँ" : language === "bn" ? "পিন করতে ☆ চাপুন" : "Tap ☆ to pin"}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{quickItems.map((item) => <div key={item.id} className="relative"><button type="button" onClick={() => onQuickItem(item)} className="flex min-h-[76px] w-full items-center gap-2 rounded-xl border border-[#e2e2db] bg-white p-2 pr-12 text-left"><ProductThumb item={item} language={language} className="h-10 w-10"/><span className="min-w-0"><strong className="block truncate text-[0.625rem]">{localizedItemName(language, item)}</strong><span className="mt-1 block text-[0.5rem] text-[#747573]">{item.skuCode}</span></span></button><button type="button" aria-label={`${favouriteItemIds.includes(item.id) ? (language === "hi" ? "पसंदीदा से हटाएँ" : language === "bn" ? "পছন্দের তালিকা থেকে সরান" : "Remove favourite") : (language === "hi" ? "पसंदीदा में जोड़ें" : language === "bn" ? "পছন্দের তালিকায় যোগ করুন" : "Add favourite")}: ${localizedItemName(language, item)}`} onClick={() => onFavourite(item)} className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-lg bg-[#f4faf0] text-base text-[#014921]">{favouriteItemIds.includes(item.id) ? "★" : "☆"}</button></div>)}</div></div>}
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
                {t(language, "noItems")}
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
        <aside className="bill-summary-panel h-fit rounded-3xl border border-[#ddd7ca] bg-white p-4 shadow-sm xl:sticky xl:top-24">
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
              <p className="mt-1 text-[0.5625rem] font-semibold leading-4 text-[#66736d]">
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
                        if (plan === "partial" && !splitPayment)
                          onPad({
                            title: t(language, "enterPartPayment"),
                            value: paid,
                            decimal: true,
                            apply: onPaid,
                          });
                      }}
                      className={`min-h-12 rounded-xl border px-1 text-[0.625rem] font-black ${paymentPlan === plan ? "border-[#014921] bg-[#014921] text-white" : "border-[#ddd7ca] bg-white text-[#40544c]"}`}
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
              {paymentPlan === "partial" && !splitPayment && (
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
                  <div className="mb-2 mt-3">
                    <p className="field-caption">
                      {tr(language, "Payment method", "पेमेंट का तरीका", "পেমেন্টের মাধ্যম")}
                    </p>
                    <div className="mt-2 grid grid-cols-2 rounded-xl border border-[#d8d2c6] bg-[#f6f3ec] p-1">
                      <button
                        type="button"
                        aria-pressed={!splitPayment}
                        onClick={() => onSplitPayment(false)}
                        className={`min-h-11 rounded-lg px-2 text-[0.625rem] font-black transition-colors duration-200 ${!splitPayment ? "bg-[#173f35] text-white shadow-sm" : "text-[#53635c]"}`}
                      >
                        {tr(language, "One method", "एक तरीका", "একটি মাধ্যম")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={splitPayment}
                        onClick={() => {
                          if (splitPayment) return;
                          onSplitPayment(true);
                          const seedAmount = paymentPlan === "full" ? bill.grandTotal : paid;
                          onPaymentBreakdown(seedAmount > 0 ? [{ mode: paymentMode, amount: seedAmount }] : []);
                        }}
                        className={`min-h-11 rounded-lg px-2 text-[0.625rem] font-black transition-colors duration-200 ${splitPayment ? "bg-[#ef7d32] text-white shadow-sm" : "text-[#53635c]"}`}
                      >
                        {tr(language, "Split methods", "कई तरीकों से", "একাধিক মাধ্যমে")}
                      </button>
                    </div>
                    {splitPayment && (
                      <p className="mt-2 text-[0.5625rem] font-semibold leading-4 text-[#66736d]">
                        {paymentPlan === "full"
                          ? tr(
                              language,
                              "Use two or more methods for this bill. This settles the bill now and creates no due.",
                              "इस बिल के लिए दो या अधिक तरीके इस्तेमाल करें। बिल अभी पूरा चुक जाएगा और कोई उधार नहीं बनेगा।",
                              "এই বিলের জন্য দুই বা তার বেশি মাধ্যম ব্যবহার করুন। বিল এখনই পুরো মিটবে, কোনো বাকি তৈরি হবে না।",
                            )
                          : tr(
                              language,
                              "Receive through two or more methods now. Only the unpaid balance will be added to dues.",
                              "अभी दो या अधिक तरीकों से रकम लें। केवल बाकी रकम उधार में जाएगी।",
                              "এখন দুই বা তার বেশি মাধ্যমে টাকা নিন। শুধু বাকি অংশ বাকিতে যোগ হবে।",
                            )}
                      </p>
                    )}
                  </div>
                  {!splitPayment ? (
                    <div className="grid grid-cols-4 gap-2">
                      {paymentChannels.map((mode) => (
                        <button
                          type="button"
                          key={mode}
                          aria-pressed={paymentMode === mode}
                          onClick={() => onMode(mode)}
                          className={`min-h-11 rounded-xl border text-[0.625rem] font-black uppercase ${paymentMode === mode ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#ddd7ca] bg-white"}`}
                        >
                          {t(language, mode)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-2xl border border-[#e2ddd3] bg-[#faf8f3] p-2.5">
                      {paymentChannels.map((mode) => {
                        const allocation = paymentBreakdown.find((entry) => entry.mode === mode);
                        const currentAmount = allocation?.amount || 0;
                        const otherAllocated = roundMoney(paid - currentAmount);
                        const balanceForMode = roundMoney(
                          Math.max(0, bill.grandTotal - otherAllocated),
                        );
                        return (
                          <div key={mode} className="rounded-xl border border-[#e1ddd4] bg-white p-2">
                            <div className="flex items-center gap-2">
                              <strong className="min-w-16 text-[0.625rem] uppercase text-[#40544c]">
                                {t(language, mode)}
                              </strong>
                              <button
                                type="button"
                                onClick={() => onPad({
                                  title: `${t(language, mode)} · ${t(language, "amountReceived")}`,
                                  value: currentAmount,
                                  decimal: true,
                                  apply: (amount) => updateTender(mode, { amount }),
                                })}
                                aria-label={tr(
                                  language,
                                  `${t(language, mode)} amount ${formatMoney(currentAmount)}`,
                                  `${t(language, mode)} रकम ${formatMoney(currentAmount)}`,
                                  `${t(language, mode)} পরিমাণ ${formatMoney(currentAmount)}`,
                                )}
                                className="ml-auto min-h-11 min-w-28 rounded-lg bg-[#eef5ee] px-3 text-right text-sm font-black text-[#173f35]"
                              >
                                {formatMoney(currentAmount)}
                              </button>
                            </div>
                            {paymentPlan === "full" && bill.grandTotal > 0 && (
                              <div className="mt-2 flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateTender(mode, {
                                      amount: roundMoney(bill.grandTotal / 2),
                                    })
                                  }
                                  aria-label={tr(
                                    language,
                                    `Set ${t(language, mode)} to half of the bill`,
                                    `${t(language, mode)} को बिल की आधी रकम पर रखें`,
                                    `${t(language, mode)}-এ বিলের অর্ধেক রাখুন`,
                                  )}
                                  className="min-h-11 rounded-lg border border-[#d8d2c6] px-3 text-[0.5625rem] font-black text-[#53635c]"
                                >
                                  50%
                                </button>
                                <button
                                  type="button"
                                  disabled={Math.abs(balanceForMode - currentAmount) < 0.01}
                                  onClick={() =>
                                    updateTender(mode, { amount: balanceForMode })
                                  }
                                  aria-label={tr(
                                    language,
                                    `Use the remaining bill balance for ${t(language, mode)}`,
                                    `बिल की बाकी रकम ${t(language, mode)} में रखें`,
                                    `বিলের বাকি টাকা ${t(language, mode)}-এ রাখুন`,
                                  )}
                                  className="min-h-11 rounded-lg border border-[#8fbd9f] px-3 text-[0.5625rem] font-black text-[#267055] disabled:opacity-40"
                                >
                                  {tr(language, "Use balance", "बाकी रकम", "বাকি টাকা")}
                                </button>
                              </div>
                            )}
                            {mode !== "cash" && (
                              <input
                                value={allocation?.reference || ""}
                                onChange={(event) => updateTender(mode, { reference: event.target.value })}
                                maxLength={80}
                                aria-label={tr(
                                  language,
                                  `${t(language, mode)} transaction reference`,
                                  `${t(language, mode)} ट्रांज़ैक्शन रेफरेंस`,
                                  `${t(language, mode)} লেনদেনের রেফারেন্স`,
                                )}
                                placeholder={mode === "cheque"
                                  ? tr(language, "Cheque number (optional)", "चेक नंबर (ज़रूरी नहीं)", "চেক নম্বর (ঐচ্ছিক)")
                                  : tr(language, "Transaction reference (optional)", "ट्रांज़ैक्शन रेफरेंस (ज़रूरी नहीं)", "লেনদেনের রেফারেন্স (ঐচ্ছিক)")}
                                className="mt-2 min-h-11 w-full rounded-lg border border-[#ddd7ca] px-2 text-[0.625rem]"
                              />
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1 pt-1 text-[0.625rem] font-black" role="status" aria-live="polite">
                        <span>{tr(language, "Allocated", "बाँटा गया", "ভাগ করা হয়েছে")} {formatMoney(paid)}</span>
                        <span className={splitOver > 0 ? "text-red-700" : "text-[#9a4f22]"}>
                          {splitOver > 0
                            ? tr(language, "Over", "ज़्यादा", "বেশি")
                            : tr(language, "Left", "बाकी", "বাকি")} {formatMoney(splitOver || splitRemaining)}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
              {splitPayment && !splitHasMultipleMethods && bill.grandTotal > 0 && (
                <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[0.625rem] font-black text-[#9a4f22]" role="alert">
                  {tr(
                    language,
                    "Enter amounts for at least two payment methods, or choose One method.",
                    "कम से कम दो पेमेंट तरीकों में रकम डालें, या एक तरीका चुनें।",
                    "কমপক্ষে দুইটি পেমেন্ট মাধ্যমে টাকা লিখুন, অথবা একটি মাধ্যম বেছে নিন।",
                  )}
                </p>
              )}
              {paymentPlan !== "full" && !hasCustomer && (
                <button
                  type="button"
                  onClick={onParty}
                  className="mt-3 min-h-11 w-full rounded-xl border border-[#e5a46f] bg-[#fff0df] px-3 text-[0.625rem] font-black text-[#9a4f22]"
                >
                  ⚠ {t(language, "selectCustomerForDue")}
                </button>
              )}
              {paymentPlan === "partial" && hasCustomer && paid <= 0 && (
                <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[0.625rem] font-black text-[#9a4f22]" role="alert">
                  {t(language, "enterPartPayment")}
                </p>
              )}
              {paymentPlan === "partial" &&
                paid >= bill.grandTotal &&
                bill.grandTotal > 0 && (
                  <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[0.625rem] font-black text-[#9a4f22]" role="alert">
                    {language === "hi"
                      ? `पार्ट पेमेंट ${formatMoney(bill.grandTotal)} से कम होना चाहिए। इसके बजाय पूरा पेमेंट चुनें।`
                      : language === "bn"
                        ? `পার্ট পেমেন্ট অবশ্যই ${formatMoney(bill.grandTotal)}-এর কম হতে হবে। এর বদলে পুরো পেমেন্ট বাছুন।`
                        : `Part payment must be less than ${formatMoney(bill.grandTotal)}. Choose full payment instead.`}
                  </p>
                )}
              {paymentPlan === "full" && splitPayment && !splitMatchesTotal && bill.grandTotal > 0 && (
                <p className="mt-3 rounded-xl bg-[#fff0df] p-2.5 text-[0.625rem] font-black text-[#9a4f22]" role="alert">
                  {tr(
                    language,
                    `Split amounts must total ${formatMoney(bill.grandTotal)} for full payment.`,
                    `पूरा पेमेंट करने के लिए सभी रकम का कुल ${formatMoney(bill.grandTotal)} होना चाहिए।`,
                    `পুরো পেমেন্টের জন্য ভাগ করা টাকার মোট ${formatMoney(bill.grandTotal)} হতে হবে।`,
                  )}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#eaf4ee] p-3">
                  <span className="block text-[0.5rem] font-black uppercase text-[#567268]">
                    {t(language, "receivedNow")}
                  </span>
                  <strong className="mt-1 block text-sm text-[#267055]">
                    {formatMoney(bill.amountPaid)}
                  </strong>
                </div>
                <div className="rounded-xl bg-[#fff0df] p-3">
                  <span className="block text-[0.5rem] font-black uppercase text-[#8c694e]">
                    {paymentPlan === "full" && splitPayment
                      ? splitOver > 0
                        ? tr(language, "Over allocated", "ज़्यादा बाँटा", "বেশি ভাগ করা")
                        : tr(language, "Still to allocate", "अभी बाँटना बाकी", "এখনও ভাগ করা বাকি")
                      : t(language, "addedToDues")}
                  </span>
                  <strong className="mt-1 block text-sm text-[#b75b2b]">
                    {formatMoney(
                      paymentPlan === "full" && splitPayment
                        ? splitOver || splitRemaining
                        : bill.amountDue,
                    )}
                  </strong>
                </div>
              </div>
              {hasCustomer && bill.amountDue > 0 && (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-[#e1d8c8] bg-[#faf8f2] p-3 text-[0.625rem]">
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
          <div className="bill-payment-actions mt-4 grid gap-2">
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
            <span className="block truncate text-[0.5625rem] font-semibold text-[#707873]">
              {enabled
                ? `${rate}% ${t(language, "gstApplied")}`
                : t(language, "gstOff")}
            </span>
          </span>
        </button>
        <div className="text-right">
          <span className="block text-[0.5rem] font-black uppercase tracking-wide text-[#7b827e]">
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
          aria-pressed={enabled && rate === 18}
          onClick={() => choose(18)}
          className={`gst-rate ${enabled && rate === 18 ? "active" : ""}`}
        >
          18%
        </button>
        <button
          type="button"
          aria-pressed={enabled && rate === 25}
          onClick={() => choose(25)}
          className={`gst-rate ${enabled && rate === 25 ? "active" : ""}`}
        >
          25%
        </button>
        <button
          type="button"
          aria-pressed={enabled && custom}
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
      <div className="mt-2 flex items-center justify-between text-[0.5625rem] font-semibold text-[#707873]">
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
          <p className="mt-1 text-[0.5625rem] font-semibold text-[#748078]">
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
                className="charge-toggle-button grid h-11 w-[52px] shrink-0 place-items-center rounded-xl"
              >
                <span className={`charge-toggle-track relative block h-7 w-12 rounded-full transition ${charge.enabled ? "bg-[#014921]" : "bg-[#c9c7bf]"}`} aria-hidden="true">
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${charge.enabled ? "left-6" : "left-1"}`}
                  />
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  charge.enabled
                    ? editAmount(charge)
                    : editAmount({ ...charge, enabled: true })
                }
                className="min-h-11 min-w-0 flex-1 text-left"
              >
                <strong className="block truncate text-[0.6875rem]">
                  {t(language, labelKey[charge.code])}
                </strong>
                <span className="mt-0.5 block text-[0.5625rem] font-semibold text-[#78817c]">
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
                    className="min-h-11 rounded-lg bg-[#fff0df] px-2.5 text-[0.625rem] font-black text-[#a95721]"
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
                    className="grid h-11 w-11 place-items-center rounded-lg bg-[#f6e9e3] text-base font-black text-[#a74e38]"
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
  language = "en",
  className = "h-14 w-14",
}: {
  item: Item;
  language?: Language;
  className?: string;
}) {
  if (item.imageUrl)
    return (
      // Product photos are offline data URLs, so the framework image optimizer cannot serve them.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.imageUrl}
        alt={localizedItemName(language, item)}
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
  const displayName = item
    ? localizedItemName(language, item)
    : language === "hi"
      ? line.itemNameHi?.trim() || line.itemName
      : language === "bn"
        ? line.itemNameBn?.trim() || line.itemName
        : line.itemName;
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
        {item && <ProductThumb item={item} language={language} className="h-12 w-12" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[0.875rem] font-black">
                {displayName}
              </h3>
              <p className="mt-1 text-[0.625rem] font-bold text-[#78827d]">
                {line.skuCode} · GST {line.gstRate}%
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`${tr(language, "Remove from bill", "बिल से हटाएँ", "বিল থেকে সরান")}: ${displayName}`}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f6eee8] text-lg font-bold text-[#b5553b]"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {lastPriceLabel && (
            <button
              type="button"
              onClick={() => onLine(index, { lockPrice: !line.lockPrice })}
              aria-pressed={line.lockPrice}
              aria-label={
                line.lockPrice
                  ? tr(
                      language,
                      `Unlock ${displayName} from ${lastPriceLabel}`,
                      `${displayName} का ${lastPriceLabel} लॉक हटाएँ`,
                      `${displayName}-এর ${lastPriceLabel} লক খুলুন`,
                    )
                  : tr(
                      language,
                      `Lock ${displayName} at ${lastPriceLabel}`,
                      `${displayName} को ${lastPriceLabel} पर लॉक करें`,
                      `${displayName}-কে ${lastPriceLabel}-এ লক করুন`,
                    )
              }
              className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.625rem] font-extrabold ${line.lockPrice ? "bg-[#fff0da] text-[#a7591f]" : "bg-[#eaf4ee] text-[#286c52]"}`}
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
              type="button"
              onClick={() =>
                onLine(index, { qty: Math.max(0.01, line.qty - 1) })
              }
              aria-label={tr(
                language,
                `Decrease quantity of ${displayName}`,
                `${displayName} की मात्रा घटाएँ`,
                `${displayName}-এর পরিমাণ কমান`,
              )}
              className="h-12 w-11 text-xl font-black"
            >
              −
            </button>
            <button
              type="button"
              onClick={() =>
                onPad({
                  title: `${displayName} · ${t(language, "quantity")}`,
                  value: line.qty,
                  decimal: true,
                  apply: (value) =>
                    onLine(index, { qty: Math.max(0.01, value) }),
                })
              }
              aria-label={tr(
                language,
                `Edit quantity of ${displayName}, currently ${line.qty} ${localizedUnitName(language, line.unit)}`,
                `${displayName} की मात्रा बदलें, अभी ${line.qty} ${localizedUnitName(language, line.unit)}`,
                `${displayName}-এর পরিমাণ বদলান, এখন ${line.qty} ${localizedUnitName(language, line.unit)}`,
              )}
              className="h-12 flex-1 border-x border-[#ddd7ca] text-base font-black"
            >
              {line.qty}
            </button>
            <button
              type="button"
              onClick={() => onLine(index, { qty: line.qty + 1 })}
              aria-label={tr(
                language,
                `Increase quantity of ${displayName}`,
                `${displayName} की मात्रा बढ़ाएँ`,
                `${displayName}-এর পরিমাণ বাড়ান`,
              )}
              className="h-12 w-11 text-xl font-black"
            >
              ＋
            </button>
          </div>
        </div>
        <div>
          <span className="field-caption">{t(language, "unit")}</span>
          <select
            aria-label={tr(
              language,
              `Unit for ${displayName}`,
              `${displayName} की यूनिट`,
              `${displayName}-এর ইউনিট`,
            )}
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
                {localizedUnitName(language, unit)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-caption">{t(language, "rate")} ₹</span>
          <button
            type="button"
            onClick={() =>
              onPad({
                title: `${displayName} · ${t(language, "rate")}`,
                value: line.rate,
                decimal: true,
                apply: (value) => onLine(index, { rate: value }),
              })
            }
            aria-label={tr(
              language,
              `Edit rate for ${displayName}, currently ${formatMoney(line.rate)}`,
              `${displayName} का रेट बदलें, अभी ${formatMoney(line.rate)}`,
              `${displayName}-এর রেট বদলান, এখন ${formatMoney(line.rate)}`,
            )}
            className="mt-1 h-12 w-full rounded-xl border-2 border-[#efb17f] bg-[#fff8ef] px-2 text-base font-black"
          >
            {line.rate}
          </button>
        </div>
      </div>
      <div
        className="mt-2 flex gap-1.5 overflow-x-auto pb-1"
        role="group"
        aria-label={tr(
          language,
          `Quick quantity presets for ${displayName}`,
          `${displayName} की मात्रा के शॉर्टकट`,
          `${displayName}-এর পরিমাণের শর্টকাট`,
        )}
      >
        {presets.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={tr(
              language,
              `Set ${displayName} quantity to ${value} ${localizedUnitName(language, line.unit)}`,
              `${displayName} की मात्रा ${value} ${localizedUnitName(language, line.unit)} करें`,
              `${displayName}-এর পরিমাণ ${value} ${localizedUnitName(language, line.unit)} করুন`,
            )}
            aria-pressed={line.qty === value}
            onClick={() => onLine(index, { qty: value })}
            className={`min-h-9 min-w-10 shrink-0 rounded-lg border px-2 text-[0.5625rem] font-black ${line.qty === value ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d4c9] bg-[#f7f5ef]"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-[#ddd7ca] pt-3">
        <button
          type="button"
          onClick={() =>
            onPad({
              title: `${t(language, "discount")} %`,
              value: line.discount,
              decimal: true,
              apply: (value) =>
                onLine(index, { discount: Math.min(100, value) }),
            })
          }
          aria-label={tr(
            language,
            `Edit discount for ${displayName}, currently ${line.discount} percent`,
            `${displayName} का डिस्काउंट बदलें, अभी ${line.discount} प्रतिशत`,
            `${displayName}-এর ডিসকাউন্ট বদলান, এখন ${line.discount} শতাংশ`,
          )}
          className="rounded-lg bg-[#f1efe9] px-3 py-2 text-xs font-bold"
        >
          {t(language, "discountShort")} {line.discount}%
        </button>
        <strong className="text-lg">{formatMoney(amount)}</strong>
      </div>
    </article>
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

function NavigationIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, React.ReactNode> = {
    bill: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </>
    ),
    parties: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c.5-4 2.5-6 5.5-6s5 2 5.5 6" />
        <path d="M15 6.5a2.5 2.5 0 1 1 0 5M16 14c2.5.5 4 2.5 4.5 5" />
      </>
    ),
    dues: (
      <>
        <path d="M4 7.5h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
        <path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" />
        <circle cx="15.5" cy="13.5" r=".7" fill="currentColor" stroke="none" />
      </>
    ),
    items: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    misc: (
      <>
        <circle cx="8" cy="8" r="4" />
        <path d="M8 6v4M6 8h4M13 13h7v7h-7zM16.5 11v7M14.5 16l2 2 2-2" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[tab]}
    </svg>
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
  const allTabs: [Tab, string][] = [
    ["bill", t(language, "bill")],
    ["parties", t(language, "parties")],
    ["dues", t(language, "dues")],
    ["items", t(language, "items")],
    ["misc", t(language, "misc")],
    ["reports", t(language, "reports")],
    ["more", t(language, "more")],
  ];
  const byKey = new Map(allTabs.map((row) => [row[0], row]));
  const tabs = workspace.order.filter((key) => !workspace.hidden.includes(key)).map((key) => byKey.get(key as Tab)).filter((row): row is [Tab, string] => Boolean(row));
  const mobilePrimaryKeys: Tab[] = ["bill", "parties", "items", "reports", "more"];
  const mobileTabs = mobilePrimaryKeys
    .filter((key) => !workspace.hidden.includes(key))
    .map((key) => byKey.get(key))
    .filter((row): row is [Tab, string] => Boolean(row));
  const mobileActiveTab = tab === "dues" || tab === "misc" ? "more" : tab;
  const tabButton = (
    [key, label]: [Tab, string],
    activeTab: Tab,
    desktop = false,
  ) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(key)}
      aria-current={activeTab === key ? "page" : undefined}
      className={`app-nav-item min-w-0 flex items-center justify-center rounded-xl font-extrabold ${
        desktop
          ? "min-h-12 flex-row justify-start gap-3 px-3 text-sm"
          : "flex-col gap-1 text-[0.5625rem]"
      } ${activeTab === key ? "active" : ""}`}
    >
      <span className="app-nav-icon grid place-items-center" aria-hidden="true">
        <NavigationIcon tab={key} />
      </span>
      <span className="app-nav-label max-w-full truncate">{label}</span>
    </button>
  );
  return (
    <>
      <nav
        aria-label={tr(language, "Main navigation", "मुख्य नेविगेशन", "মূল নেভিগেশন")}
        style={{ "--nav-count": mobileTabs.length } as React.CSSProperties}
        className="app-main-nav app-main-nav-mobile fixed inset-x-0 bottom-0 z-40 grid border-t border-[#d7d1c5] bg-[#fbfaf6] px-1 md:hidden"
      >
        {mobileTabs.map((entry) => tabButton(entry, mobileActiveTab))}
      </nav>
      <nav
        aria-label={tr(language, "Main navigation", "मुख्य नेविगेशन", "মূল নেভিগেশন")}
        className="app-main-nav app-main-nav-desktop fixed inset-y-[64px] left-0 z-40 hidden w-[220px] auto-rows-min content-start border-r border-[#d7d1c5] bg-[#fbfaf6] px-3 py-5 md:grid"
      >
        <p className="mb-3 px-3 text-[0.625rem] font-black uppercase tracking-[.16em] text-[#a29f97]">
          {t(language, "workspace")}
        </p>
        {tabs.map((entry) => tabButton(entry, tab, true))}
        <div className="mt-auto rounded-2xl bg-[#173f35] p-4 text-white">
          <p className="text-[0.5625rem] font-black uppercase tracking-[.14em] text-[#aac0b8]">
            {t(language, "counterReady")}
          </p>
          <p className="mt-2 text-xs font-bold">{t(language, "offlineReady")}</p>
        </div>
      </nav>
    </>
  );
}

function PartyPicker({
  language,
  parties,
  selected,
  selectedDraft,
  onClose,
  onSelect,
  onToast,
}: {
  language: Language;
  parties: Party[];
  selected?: Party;
  selectedDraft?: BillingCustomerDraft;
  onClose: () => void;
  onSelect: (p?: Party | BillingCustomerDraft) => void;
  onToast: (m: string) => void;
}) {
  const [query, setQuery] = useState(selectedDraft?.name || "");
  const [phone, setPhone] = useState(selectedDraft?.phone || "");
  const [codeName, setCodeName] = useState(selectedDraft?.codeName || "");
  const [address, setAddress] = useState(selectedDraft?.address || "");
  const matches = parties
    .filter((party) => partyMatchesSearch(party, query))
    .slice(0, 12);
  const exactNeedle = normalizePartyIdentity(query);
  const exact = Boolean(exactNeedle) && parties.some((party) =>
    [party.name, party.codeName]
      .filter(Boolean)
      .some((value) => normalizePartyIdentity(value) === exactNeedle),
  );
  function create() {
    if (!query.trim()) return;
    const normalizedCode = normalizePartyCode(codeName);
    const duplicateCode = normalizedCode
      ? parties.find((party) => party.codeName.toLowerCase() === normalizedCode.toLowerCase())
      : undefined;
    if (duplicateCode) {
      onToast(tr(
        language,
        `Code ${normalizedCode} is already used by ${duplicateCode.name}. Choose that saved customer or use another code.`,
        `कोड ${normalizedCode} पहले से ${duplicateCode.name} के लिए है। सेव कस्टमर चुनें या दूसरा कोड लें।`,
        `কোড ${normalizedCode} আগে থেকেই ${duplicateCode.name}-এর। সেভ করা কাস্টমার বাছুন বা অন্য কোড দিন।`,
      ));
      return;
    }
    const phoneDigits = normalizePhoneDigits(phone);
    const duplicatePhone = phoneDigits.length >= 8
      ? parties.find((party) => normalizePhoneDigits(party.phone) === phoneDigits)
      : undefined;
    if (duplicatePhone) {
      onToast(tr(
        language,
        `${duplicatePhone.name} already uses this phone number. Choose the saved customer.`,
        `यह फोन नंबर पहले से ${duplicatePhone.name} का है। सेव कस्टमर चुनें।`,
        `এই ফোন নম্বর আগে থেকেই ${duplicatePhone.name}-এর। সেভ করা কাস্টমার বাছুন।`,
      ));
      return;
    }
    const next: BillingCustomerDraft = {
      name: query.trim(),
      ...(normalizedCode ? { codeName: normalizedCode } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    };
    onSelect(next);
    onToast(tr(language, `${next.name} will be saved with this bill.`, `${next.name} इस बिल के साथ सेव होगा।`, `${next.name} এই বিলের সঙ্গে সেভ হবে।`));
  }
  return (
    <SheetFrame title={tr(language, "Choose customer", "कस्टमर चुनें", "কাস্টমার বাছুন")} onClose={onClose}>
      <div className="space-y-3">
        <button
          onClick={() => onSelect(undefined)}
          className={`flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 text-left ${!selected && !selectedDraft ? "border-[#ef7d32] bg-[#fff6eb]" : "border-[#ddd7ca] bg-white"}`}
        >
          <div>
            <strong>{t(language, "cashCustomer")}</strong>
            <p className="mt-1 text-[0.625rem] text-[#748078]">{tr(language, "No ledger balance", "खाते में कोई बैलेंस नहीं", "খাতায় কোনো ব্যালেন্স নেই")}</p>
          </div>
          <span>›</span>
        </button>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            data-dialog-initial-focus
            aria-label={tr(language, "Search customers", "कस्टमर खोजें", "কাস্টমার খুঁজুন")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tr(language, "Search name, code, address or phone", "नाम, कोड, पता या फोन खोजें", "নাম, কোড, ঠিকানা বা ফোন খুঁজুন")}
          />
        </label>
        {query && !exact && (
          <div className="rounded-2xl border-2 border-dashed border-[#efb17f] bg-[#fff9f0] p-3">
            <p className="text-xs font-black">{tr(language, "New customer", "नया कस्टमर", "নতুন কাস্টমার")}: “{query}”</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                aria-label={tr(language, "New customer code name", "नए कस्टमर का कोड नाम", "নতুন কাস্টমারের কোড নাম")}
                value={codeName}
                onChange={(event) =>
                  setCodeName(event.target.value.toUpperCase())
                }
                placeholder={tr(language, "Code name (optional)", "कोड नाम (जरूरी नहीं)", "কোড নাম (দরকার নেই)")}
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm uppercase"
              />
              <input
                aria-label={tr(language, "New customer phone", "नए कस्टमर का फोन", "নতুন কাস্টমারের ফোন")}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                placeholder={tr(language, "Phone (optional)", "फोन (जरूरी नहीं)", "ফোন (দরকার নেই)")}
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm"
              />
              <input
                aria-label={tr(language, "New customer address", "नए कस्टमर का पता", "নতুন কাস্টমারের ঠিকানা")}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={tr(language, "Customer address", "कस्टमर का पता", "কাস্টমারের ঠিকানা")}
                className="h-11 rounded-xl border border-[#d7d1c5] bg-white px-3 text-sm sm:col-span-2"
              />
              <button
                onClick={create}
                className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white sm:col-span-2"
              >
                ＋ {tr(language, "Use this new customer for the bill", "इस नए कस्टमर को बिल में लें", "এই নতুন কাস্টমারকে বিলে নিন")}
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
                  {party.codeName && (
                    <span className="shrink-0 rounded-lg bg-[#e7f3ec] px-2 py-1 text-[0.5rem] font-black text-[#25684f]">
                      {party.codeName}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-[0.625rem] font-semibold text-[#748078]">
                  {party.address || tr(language, "No address", "पता नहीं", "ঠিকানা নেই")}
                </p>
                <p className="mt-1 text-[0.5625rem] text-[#8a928e]">
                  {party.phone || tr(language, "No phone", "फोन नहीं", "ফোন নেই")} · {localizedPriceTierName(language, party.priceTier)}
                </p>
              </div>
              <div className="ml-3 shrink-0 text-right">
                <span className="text-xs font-black text-[#b75d26]">
                  {formatMoney(party.currentBalance)}
                </span>
                <p className="text-[0.5625rem] text-[#8a928e]">{tr(language, "outstanding", "बकाया", "বাকি")}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </SheetFrame>
  );
}

function DueCustomerPicker({
  language,
  parties,
  onClose,
  onSelect,
  onNewCustomer,
}: {
  language: Language;
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
      title={t(language, "addManualDue")}
      onClose={onClose}
    >
      <div className="rounded-2xl bg-[#f4faf0] p-3">
        <p className="text-xs font-black text-[#014921]">
          {tr(language, "Choose the customer who owes this amount.", "जिस कस्टमर पर यह रकम बाकी है, उसे चुनें।", "যে কাস্টমারের এই টাকা বাকি, তাকে বাছুন।")}
        </p>
        <p className="mt-1 text-[0.625rem] font-semibold text-[#66736d]">
          {tr(language, "You can choose any saved customer, even when their current balance is zero.", "बैलेंस शून्य हो तब भी किसी सेव कस्टमर को चुन सकते हैं।", "ব্যালেন্স শূন্য হলেও যেকোনো সেভ করা কাস্টমার বাছতে পারেন।")}
        </p>
      </div>
      <button
        type="button"
        onClick={onNewCustomer}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#8fbd9f] bg-white text-xs font-black text-[#014921]"
      >
        <span className="text-lg text-[#309d4b]">＋</span> {t(language, "newCustomer")}
      </button>
      <label className="search-box my-3">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          data-dialog-initial-focus
          aria-label={tr(language, "Search customers for manual due", "बकाया जोड़ने के लिए कस्टमर खोजें", "বাকি যোগ করতে কাস্টমার খুঁজুন")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr(language, "Search customer name, code, address or phone", "कस्टमर का नाम, कोड, पता या फोन खोजें", "কাস্টমারের নাম, কোড, ঠিকানা বা ফোন খুঁজুন")}
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
                {party.codeName && (
                  <span className="shrink-0 rounded-lg bg-[#e7f3ec] px-2 py-1 text-[0.5rem] font-black text-[#25684f]">
                    {party.codeName}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-[0.625rem] font-semibold text-[#748078]">
                {party.address || tr(language, "No address saved", "पता सेव नहीं है", "ঠিকানা সেভ নেই")}
              </p>
              <p className="mt-1 text-[0.5625rem] text-[#8a928e]">
                {party.phone || tr(language, "No phone", "फोन नहीं", "ফোন নেই")}
              </p>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <strong className="text-xs text-[#b75d26]">
                {formatMoney(party.currentBalance)}
              </strong>
              <p className="mt-1 text-[0.5625rem] text-[#8a928e]">{tr(language, "current due", "अभी का बकाया", "এখনকার বাকি")} ›</p>
            </div>
          </button>
        ))}
      </div>
      {!matches.length && (
        <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] p-8 text-center">
          <p className="text-sm font-black">{tr(language, "No customer found", "कोई कस्टमर नहीं मिला", "কোনো কাস্টমার পাওয়া যায়নি")}</p>
          <button
            type="button"
            onClick={onNewCustomer}
            className="mt-3 text-xs font-black text-[#014921] underline"
          >
            {tr(language, "Create this customer first", "पहले यह कस्टमर बनाएँ", "আগে এই কাস্টমার তৈরি করুন")}
          </button>
        </div>
      )}
    </SheetFrame>
  );
}

function ItemPicker({
  language,
  items,
  favouriteItemIds,
  onClose,
  onSelect,
  onToast,
  onFavourite,
}: {
  language: Language;
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
      onToast(tr(language, `“${item.name}” created. Tap rate to set price.`, `“${item.name}” बन गया। रेट सेट करने के लिए रेट पर टैप करें।`, `“${item.name}” তৈরি হয়েছে। রেট দিতে রেটে চাপুন।`));
    } catch (cause) {
      onToast(
        language === "en" && cause instanceof Error
          ? cause.message
          : tr(language, "Could not create this item.", "यह आइटम नहीं बन पाया।", "এই আইটেম তৈরি করা যায়নি।"),
      );
      setCreating(false);
    }
  }
  const showCreate = shouldOfferInlineItemCreation(query, items);
  return (
    <SheetFrame title={t(language, "addItem")} onClose={onClose} full>
      <label className="search-box sticky top-0 z-10">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          data-dialog-initial-focus
          aria-label={tr(language, "Search products to add to bill", "बिल में जोड़ने के लिए आइटम खोजें", "বিলে যোগ করতে আইটেম খুঁজুন")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(language, "searchItem")}
        />
      </label>
      <p className="my-3 text-[0.625rem] font-black uppercase tracking-[.14em] text-[#7d8782]">
        {query
          ? tr(language, `${matches.length} matches`, `${matches.length} नतीजे`, `${matches.length}টি মিল`)
          : t(language, "recentItems")}
      </p>
      {showCreate && (
        <button
          disabled={creating}
          onClick={create}
          className="mb-3 flex min-h-14 w-full items-center rounded-2xl border-2 border-dashed border-[#ef9e61] bg-[#fff7ed] px-4 text-left text-sm font-black text-[#b75b20] disabled:opacity-50"
        >
          ＋ {creating
            ? tr(language, "Creating…", "बन रहा है…", "তৈরি হচ্ছে…")
            : tr(language, `Create “${query.trim()}”`, `“${query.trim()}” बनाएँ`, `“${query.trim()}” তৈরি করুন`)}
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
            <ProductThumb item={item} language={language} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{localizedItemName(language, item)}</strong>
              <p className="mt-1 truncate text-[0.625rem] text-[#727f78]">
                {localizedItemSecondaryName(language, item) || item.skuCode}
              </p>
              <p className="mt-1 text-[0.5625rem] font-bold text-[#9a6a49]">
                {item.skuCode} · {tr(language, "per", "प्रति", "প্রতি")} {localizedUnitName(language, item.baseUnit)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <strong className="text-sm">
                {formatMoney(item.priceWholesale)}
              </strong>
              <p className="mt-1 text-[0.5625rem] text-[#758079]">{tr(language, "Stock", "स्टॉक", "স্টক")} —</p>
            </div>
          </button>
          <button type="button" onClick={() => onFavourite(item)} aria-label={`${favouriteItemIds.includes(item.id) ? tr(language, "Remove favourite", "पसंदीदा से हटाएँ", "পছন্দের তালিকা থেকে সরান") : tr(language, "Add favourite", "पसंदीदा में जोड़ें", "পছন্দের তালিকায় যোগ করুন")}: ${localizedItemName(language, item)}`} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-[#f4faf0] text-[#014921]">{favouriteItemIds.includes(item.id) ? "★" : "☆"}</button>
          </div>
        ))}
      </div>
    </SheetFrame>
  );
}

function DraftProductPhoto({ imageUrl, language }: { imageUrl?: string; language: Language }) {
  if (!imageUrl)
    return (
      <span>
        <b>＋</b>{tr(language, "Add product photo", "प्रोडक्ट फोटो जोड़ें", "প্রোডাক্টের ছবি যোগ করুন")}
      </span>
    );
  // Product photos are offline data URLs, so the framework image optimizer cannot serve them.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={tr(language, "Product preview", "प्रोडक्ट का प्रिव्यू", "প্রোডাক্ট প্রিভিউ")}
      className="h-full w-full object-cover"
    />
  );
}

function ProductEditor({
  item,
  categories,
  festivalEntries,
  language,
  ownerMode,
  onPad,
  onClose,
  onSaved,
}: {
  item: Item | null;
  categories: Category[];
  festivalEntries: FestivalEntry[];
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
  const [lowStockEnabled, setLowStockEnabled] = useState(item?.lowStockAlert != null);
  const [lowStockThreshold, setLowStockThreshold] = useState(
    item?.lowStockAlert == null ? "" : String(item.lowStockAlert),
  );
  const [purchase, setPurchase] = useState(String(item?.purchasePrice || ""));
  const [wholesale, setWholesale] = useState(
    String(item?.priceWholesale || ""),
  );
  const [bulk, setBulk] = useState(String(item?.priceBulk || ""));
  const [retail, setRetail] = useState(String(item?.priceRetail || ""));
  const [itemGst, setItemGst] = useState(String(item?.gstRate ?? 18));
  const [hsn, setHsn] = useState(item?.hsnCode || "");
  const [family, setFamily] = useState(item ? variantFamily(item) : "");
  const [selectedFestivalKeys, setSelectedFestivalKeys] = useState<Set<FestivalKey>>(
    () => new Set(item ? festivalKeysForItem(item) : []),
  );
  const [imageUrl, setImageUrl] = useState(item?.imageUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const productFestivalCopy = festivalCopy(language);
  const currentFestivalYear = Number(localDate().slice(0, 4));
  const currentFestivalEntries = festivalEntries
    .filter((entry) => entry.year === currentFestivalYear)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const productFestivalOptions: Array<{ key: FestivalKey; label: string }> = currentFestivalEntries.length
    ? currentFestivalEntries.map((entry) => ({
        key: entry.festivalKey as FestivalKey,
        label: festivalEntryName(entry, language),
      }))
    : FESTIVAL_DEFINITIONS.map((definition) => ({
        key: definition.key,
        label: language === "hi" ? definition.nameHi : language === "bn" ? definition.nameBn : definition.nameEn,
      }));

  async function choosePhoto(file?: File) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      setImageUrl(await prepareProductImage(file));
    } catch (cause) {
      setError(
        language === "en" && cause instanceof Error
          ? cause.message
          : tr(language, "Could not prepare this photo.", "यह फोटो तैयार नहीं हो पाई।", "এই ছবি তৈরি করা যায়নি।"),
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    const cleanName = name.trim();
    const cleanSku = sku.trim().toUpperCase();
    if (!cleanName) return setError(tr(language, "Enter a product name.", "प्रोडक्ट का नाम डालें।", "প্রোডাক্টের নাম দিন।"));
    if (!cleanSku) return setError(tr(language, "Enter a SKU code.", "SKU कोड डालें।", "SKU কোড দিন।"));
    setSaving(true);
    setError("");
    try {
      const duplicate = await db.items
        .where("skuCode")
        .equals(cleanSku)
        .first();
      if (duplicate && duplicate.id !== item?.id) {
        setError(
          tr(
            language,
            `SKU ${cleanSku} is already used by ${localizedItemName(language, duplicate)}.`,
            `SKU ${cleanSku} पहले से ${localizedItemName(language, duplicate)} में इस्तेमाल हो रहा है।`,
            `SKU ${cleanSku} আগে থেকেই ${localizedItemName(language, duplicate)}-এ ব্যবহার হচ্ছে।`,
          ),
        );
        setSaving(false);
        return;
      }
      if (lowStockEnabled && (lowStockThreshold.trim() === "" || !Number.isFinite(Number(lowStockThreshold)) || Number(lowStockThreshold) < 0)) {
        setError(tr(language, "Enter a valid non-negative low-stock threshold.", "कम-स्टॉक सीमा शून्य या उससे ज्यादा रखें।", "কম-স্টকের সীমা শূন্য বা তার বেশি দিন।"));
        setSaving(false);
        return;
      }
      if (item && unit !== item.baseUnit) {
        const [movement, countLine, invoice] = await Promise.all([
          db.stockMovements.where("itemId").equals(item.id).first(),
          db.countLines.where("itemId").equals(item.id).first(),
          db.invoices.filter((entry) => entry.lineItems.some((line) => line.itemId === item.id)).first(),
        ]);
        if (item.currentStock !== null || movement || countLine || invoice) {
          setError(tr(language, "The base unit cannot change after stock or invoice history exists. Create a new product for a different unit.", "स्टॉक या बिल का इतिहास बनने के बाद बेस यूनिट नहीं बदल सकती। दूसरी यूनिट के लिए नया प्रोडक्ट बनाएँ।", "স্টক বা বিলের ইতিহাস তৈরি হলে বেস ইউনিট বদলানো যায় না। অন্য ইউনিটের জন্য নতুন পণ্য বানান।"));
          setSaving(false);
          return;
        }
      }
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
        lowStockAlert: lowStockEnabled ? Number(lowStockThreshold) : null,
        festivalTags: withVariantFamily(
          withFestivalKeys(item?.festivalTags || [], selectedFestivalKeys),
          family,
        ),
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
        language === "en" && cause instanceof Error
          ? cause.message
          : tr(language, "Could not save this product.", "यह प्रोडक्ट सेव नहीं हुआ।", "এই প্রোডাক্ট সেভ হয়নি।"),
      );
      setSaving(false);
    }
  }

  async function archive() {
    if (
      !item ||
      !confirm(
        tr(
          language,
          `Archive ${localizedItemName(language, item)}? It will disappear from billing but remain on old invoices.`,
          `${localizedItemName(language, item)} को आर्काइव करें? यह बिलिंग से हट जाएगा, लेकिन पुराने बिल में रहेगा।`,
          `${localizedItemName(language, item)} আর্কাইভ করবেন? বিলিং থেকে সরে যাবে, তবে পুরনো বিলে থাকবে।`,
        ),
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
      title={item ? tr(language, "Edit product", "प्रोडक्ट बदलें", "প্রোডাক্ট বদলান") : tr(language, "Add product", "प्रोडक्ट जोड़ें", "প্রোডাক্ট যোগ করুন")}
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
            <DraftProductPhoto imageUrl={imageUrl} language={language} />
            <em>
              {photoBusy
                ? tr(language, "Preparing…", "तैयार हो रहा है…", "তৈরি হচ্ছে…")
                : imageUrl
                  ? tr(language, "Tap to replace", "बदलने के लिए टैप करें", "বদলাতে চাপুন")
                  : "JPG, PNG or WebP"}
            </em>
          </label>
          {imageUrl && (
            <button
              type="button"
              onClick={() => {
                if (confirm(tr(language, "Remove this product photo?", "यह प्रोडक्ट फोटो हटाएँ?", "এই প্রোডাক্টের ছবি সরাবেন?")))
                  setImageUrl(undefined);
              }}
              className="mt-2 w-full text-[0.625rem] font-black text-[#8b4840] underline"
            >
              {tr(language, "Remove photo", "फोटो हटाएँ", "ছবি সরান")}
            </button>
          )}
        </div>
        <div className="grid gap-3">
          <label className="product-field md:col-span-2">
            <span>{tr(language, "English / base name", "अंग्रेज़ी / मुख्य नाम", "ইংরেজি / মূল নাম")} *</span>
            <input
              autoFocus
              data-dialog-initial-focus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr(
                language,
                "e.g. Moti Mala 24 inch Blue",
                "जैसे Moti Mala 24 inch Blue",
                "যেমন Moti Mala 24 inch Blue",
              )}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="product-field">
              <span>{tr(language, "Hindi name", "हिंदी नाम", "হিন্দি নাম")}</span>
              <input
                value={nameHi}
                onChange={(e) => setNameHi(e.target.value)}
                placeholder="हिंदी नाम"
              />
            </label>
            <label className="product-field">
              <span>{tr(language, "Bengali name", "बंगाली नाम", "বাংলা নাম")}</span>
              <input
                value={nameBn}
                onChange={(e) => setNameBn(e.target.value)}
                placeholder="বাংলা নাম"
              />
            </label>
            <label className="product-field">
              <span>SKU {tr(language, "code", "कोड", "কোড")} *</span>
              <input
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                placeholder="MM-24-BLU"
              />
            </label>
            <label className="product-field">
              <span>{tr(language, "Category", "कैटेगरी", "ক্যাটাগরি")}</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {localizedCategoryName(language, category.name)}
                  </option>
                ))}
              </select>
            </label>
            <div className="product-field">
              <span>{tr(language, "Current stock", "मौजूदा स्टॉक", "এখনকার স্টক")}</span>
              <output data-stock-state={item?.currentStock === null || !item ? "unknown" : item.currentStock < 0 ? "negative" : "known"} className="inventory-readonly-stock">
                {!item || item.currentStock === null
                  ? tr(language, "Unknown", "अनजान", "অজানা")
                  : `${item.currentStock} ${localizedUnitName(language, item.baseUnit)}`}
              </output>
              <small>{tr(language, "Use Inventory to change stock so the audit history stays complete.", "स्टॉक बदलने के लिए इन्वेंटरी इस्तेमाल करें, ताकि पूरा इतिहास रहे।", "স্টক বদলাতে ইনভেন্টরি ব্যবহার করুন, যাতে পুরো ইতিহাস থাকে।")}</small>
            </div>
            <div className="product-field">
              <span>{tr(language, "Low-stock alert", "कम-स्टॉक अलर्ट", "কম-স্টক সতর্কতা")}</span>
              <label className="inventory-check-row">
                <input type="checkbox" role="switch" aria-label={tr(language, "Enable low-stock alert", "कम-स्टॉक अलर्ट चालू करें", "কম-স্টক সতর্কতা চালু করুন")} aria-checked={lowStockEnabled} checked={lowStockEnabled} onChange={(event) => setLowStockEnabled(event.target.checked)} />
                <span>{lowStockEnabled ? tr(language, "Enabled", "चालू", "চালু") : tr(language, "Off", "बंद", "বন্ধ")}</span>
              </label>
              {lowStockEnabled && <input aria-label={tr(language, "Low-stock threshold", "कम-स्टॉक सीमा", "কম-স্টক সীমা")} inputMode="decimal" value={lowStockThreshold} onChange={(event) => setLowStockThreshold(event.target.value)} placeholder={`0 ${localizedUnitName(language, unit)}`} required />}
            </div>
            <label className="product-field">
              <span>{tr(language, "Variant family", "वेरिएंट ग्रुप", "ভ্যারিয়েন্ট গ্রুপ")}</span>
              <input
                value={family}
                onChange={(event) => setFamily(event.target.value)}
                placeholder={tr(
                  language,
                  "e.g. Moti Mala 12 inch",
                  "जैसे Moti Mala 12 inch",
                  "যেমন Moti Mala 12 inch",
                )}
              />
            </label>
            <fieldset className="festival-product-field md:col-span-2">
              <legend>{productFestivalCopy.productFestivalTags}</legend>
              <p>{productFestivalCopy.productFestivalHelp}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {productFestivalOptions.map((option) => (
                  <label key={option.key}>
                    <input
                      type="checkbox"
                      checked={selectedFestivalKeys.has(option.key)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedFestivalKeys((current) => {
                          const next = new Set(current);
                          if (checked) next.add(option.key);
                          else next.delete(option.key);
                          return next;
                        });
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="product-field">
              <span>{tr(language, "Sale unit", "बिक्री यूनिट", "বিক্রির ইউনিট")}</span>
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
                    {localizedUnitName(language, value)}
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
                      title: t(language, "purchaseCost"),
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
              <span>{t(language, "wholesaleSelling")} ₹ *</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: t(language, "wholesaleSelling"),
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
              <span>{t(language, "bulkSelling")} {t(language, "rate")} ₹</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: `${t(language, "bulkSelling")} ${t(language, "rate")}`,
                    value: Number(bulk) || Number(wholesale) || 0,
                    decimal: true,
                    apply: (value) => setBulk(String(value)),
                  })
                }
              >
                {bulk ? formatMoney(Number(bulk) || 0) : tr(language, "Same as wholesale", "होलसेल के बराबर", "পাইকারি রেটের সমান")}
              </button>
            </label>
            <label className="product-field">
              <span>{t(language, "retailSelling")} {t(language, "rate")} ₹</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: `${t(language, "retailSelling")} ${t(language, "rate")}`,
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
              <span>{tr(language, "Default GST %", "डिफॉल्ट GST %", "ডিফল্ট GST %")}</span>
              <button
                type="button"
                className="product-amount"
                onClick={() =>
                  onPad({
                    title: tr(language, "Default GST rate", "डिफॉल्ट GST रेट", "ডিফল্ট GST রেট"),
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
              <span>HSN {tr(language, "code", "कोड", "কোড")}</span>
              <input
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
                inputMode="numeric"
                placeholder={tr(language, "Optional", "जरूरी नहीं", "দরকার নেই")}
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
              {tr(language, "Cancel", "रद्द करें", "বাতিল")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || photoBusy}
              className="counter-primary"
            >
              {saving
                ? tr(language, "Saving…", "सेव हो रहा है…", "সেভ হচ্ছে…")
                : item
                  ? tr(language, "Save changes", "बदलाव सेव करें", "বদল সেভ করুন")
                  : tr(language, "Add & save product", "प्रोडक्ट जोड़कर सेव करें", "প্রোডাক্ট যোগ করে সেভ করুন")}
            </button>
          </div>
          {item && (
            <button
              type="button"
              onClick={archive}
              className="min-h-10 text-xs font-black text-[#8b4840] underline underline-offset-4"
            >
              {tr(language, "Archive this product", "यह प्रोडक्ट आर्काइव करें", "এই প্রোডাক্ট আর্কাইভ করুন")}
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
    <AccessibleSheet
      title={title}
      onClose={onClose}
      panelClassName={full ? "max-w-3xl" : "max-w-xl"}
    >
      {children}
    </AccessibleSheet>
  );
}

function NumberPad({
  language,
  state,
  onClose,
}: {
  language: Language;
  state: NonNullable<PadState>;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(state.value || ""));
  const [fresh, setFresh] = useState(true);
  const panelRef = useDialogFocus(onClose);
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
      data-dialog-backdrop
      className="fixed inset-0 z-[70] bg-[#102d27]/45"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label={state.title} tabIndex={-1} className="number-pad-panel absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[28px] bg-[#fbfaf6] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[0.625rem] font-black uppercase tracking-wide text-[#758079]">
              {tr(language, "Enter value", "रकम डालें", "অঙ্ক দিন")}
            </p>
            <h2 className="mt-1 text-sm font-black">{state.title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={tr(language, "Close number pad", "नंबर पैड बंद करें", "নাম্বার প্যাড বন্ধ করুন")}
            className="grid h-10 w-10 place-items-center rounded-xl bg-[#eeeae1] text-xl"
          >
            ×
          </button>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="mb-3 overflow-hidden rounded-2xl bg-[#173f35] px-4 py-3 text-right text-3xl font-black text-white">
          <span className="sr-only">{tr(language, "Current value", "अभी की रकम", "এখনকার অঙ্ক")} </span>
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
              type="button"
              data-dialog-initial-focus={key === "1" ? "true" : undefined}
              aria-label={key === "⌫" ? tr(language, "Backspace", "पिछला अंक मिटाएँ", "আগের অঙ্ক মুছুন") : key === "." ? tr(language, "Decimal point", "दशमलव", "দশমিক") : key === "00" ? tr(language, "Double zero", "दो शून्य", "দুই শূন্য") : `${tr(language, "Digit", "अंक", "অঙ্ক")} ${key}`}
              onClick={() => press(key)}
              className="h-14 rounded-2xl border border-[#d7d1c5] bg-white text-xl font-black active:bg-[#fff1df]"
            >
              {key}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-[.7fr_1.3fr] gap-2">
          <button
            type="button"
            aria-label={tr(language, "Backspace", "पिछला अंक मिटाएँ", "আগের অঙ্ক মুছুন")}
            onClick={() => press("⌫")}
            className="h-13 rounded-2xl bg-[#eee9df] text-lg font-black"
          >
            ⌫
          </button>
          <button
            type="button"
            onClick={() => {
              const value = Number(text || 0);
              if (Number.isFinite(value)) state.apply(value);
              onClose();
            }}
            className="h-13 rounded-2xl bg-[#ef7d32] text-sm font-black text-white"
          >
            {tr(language, "Done", "हो गया", "ঠিক আছে")}
          </button>
        </div>
      </section>
    </div>
  );
}

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
  const copy = partyFlowCopy(language);
  if (selected) {
    const current =
      parties.find((entry) => entry.id === selected.id) || selected;
    return (
      <PartyLedger
        language={language}
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = (type === "customer" ? customers : suppliers).filter(
    (entry) =>
      partyMatchesSearch(entry, query) ||
      copy.tiers[entry.priceTier]
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  );
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{copy.partyAccounts}</p>
          <h2 className="page-title">{t(language, "parties")}</h2>
        </div>
        <button
          onClick={() => onCreate(type)}
          className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white"
        >
          ＋ {t(language, "addParty")}
        </button>
      </div>
      <div
        className="mt-4 grid grid-cols-2 gap-2"
        role="group"
        aria-label={copy.partyAccountType}
      >
        <button
          type="button"
          aria-pressed={type === "customer"}
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
          type="button"
          aria-pressed={type === "supplier"}
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
        <span aria-hidden="true">⌕</span>
        <input
          aria-label={
            type === "customer"
              ? copy.searchCustomers
              : copy.searchSuppliers
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            type === "customer"
              ? copy.searchCustomerPlaceholder
              : copy.searchSupplierPlaceholder
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
                {entry.codeName && (
                  <span
                    className={`rounded-full px-2 py-1 text-[0.5rem] font-black uppercase ${entry.type === "supplier" ? "bg-[#fff0df] text-[#a95221]" : "bg-[#e7f3ec] text-[#25684f]"}`}
                  >
                    {entry.codeName}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-[0.625rem] font-semibold text-[#566760]">
                {entry.address || copy.noAddress}
              </p>
              <p className="mt-1 text-[0.5625rem] text-[#768079]">
                {entry.phone || copy.noPhone}
                {entry.type === "customer"
                  ? ` · ${copy.tiers[entry.priceTier]}`
                  : ` · ${copy.goodsSupplier}`}
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
              <p className="mt-1 text-[0.5625rem] text-[#818983]">
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
          <p className="text-sm font-black">
            {type === "customer" ? copy.noCustomers : copy.noSuppliers}
          </p>
          <button
            onClick={() => onCreate(type)}
            className="mt-3 rounded-xl bg-[#173f35] px-4 py-3 text-xs font-black text-white"
          >
            ＋ {type === "customer" ? copy.addCustomer : copy.addSupplier}
          </button>
        </div>
      )}
    </section>
  );
}

function partyFlowCopy(language: Language) {
  const tx = (en: string, hi: string, bn: string) => tr(language, en, hi, bn);
  return {
    customer: tx("Customer", "कस्टमर", "কাস্টমার"),
    supplier: tx("Supplier", "सप्लायर", "সাপ্লায়ার"),
    partyAccounts: tx("Party accounts", "पार्टी खाते", "পার্টির খাতা"),
    partyAccountType: tx(
      "Party account type",
      "पार्टी खाते का प्रकार",
      "পার্টির খাতার ধরন",
    ),
    searchCustomers: tx("Search customers", "कस्टमर खोजें", "কাস্টমার খুঁজুন"),
    searchSuppliers: tx("Search suppliers", "सप्लायर खोजें", "সাপ্লায়ার খুঁজুন"),
    searchCustomerPlaceholder: tx(
      "Search customer name, code, address or phone",
      "नाम, कोड, पता या फोन से कस्टमर खोजें",
      "নাম, কোড, ঠিকানা বা ফোন দিয়ে কাস্টমার খুঁজুন",
    ),
    searchSupplierPlaceholder: tx(
      "Search supplier name, code, address or phone",
      "नाम, कोड, पता या फोन से सप्लायर खोजें",
      "নাম, কোড, ঠিকানা বা ফোন দিয়ে সাপ্লায়ার খুঁজুন",
    ),
    noAddress: tx("No address saved", "पता सेव नहीं है", "ঠিকানা সেভ নেই"),
    noPhone: tx("No phone", "फोन नहीं", "ফোন নেই"),
    goodsSupplier: tx("goods supplier", "माल सप्लायर", "মালের সাপ্লায়ার"),
    noCustomers: tx("No customers found", "कोई कस्टमर नहीं मिला", "কোনো কাস্টমার পাওয়া যায়নি"),
    noSuppliers: tx("No suppliers found", "कोई सप्लायर नहीं मिला", "কোনো সাপ্লায়ার পাওয়া যায়নি"),
    addCustomer: tx("Add customer", "कस्टमर जोड़ें", "কাস্টমার যোগ করুন"),
    addSupplier: tx("Add supplier", "सप्लायर जोड़ें", "সাপ্লায়ার যোগ করুন"),
    bill: tx("Bill", "बिल", "বিল"),
    payment: tx("Payment", "पेमेंट", "পেমেন্ট"),
    purchaseBill: tx("Purchase bill", "खरीद बिल", "কেনার বিল"),
    salesBill: tx("Sales bill", "सेल बिल", "সেল বিল"),
    paidWithPurchase: tx(
      "Paid with purchase",
      "खरीद के साथ पेमेंट दी",
      "কেনার সময় পেমেন্ট দেওয়া",
    ),
    receivedWithBill: tx(
      "Received with bill",
      "बिल के साथ पेमेंट मिली",
      "বিলের সময় পেমেন্ট পাওয়া",
    ),
    opening: tx("Opening", "ओपनिंग", "ওপেনিং"),
    openingBalance: tx("Opening balance", "ओपनिंग बैलेंस", "ওপেনিং ব্যালেন্স"),
    payableBroughtForward: tx("Previous amount to pay", "पिछला देना", "আগের দেনা"),
    receivableBroughtForward: tx("Previous amount to collect", "पिछला लेना", "আগের পাওনা"),
    supplierBill: tx("Supplier bill", "सप्लायर बिल", "সাপ্লায়ার বিল"),
    due: tx("Due", "बाकी", "বাকি"),
    manualDue: tx("Manual due", "हाथ से जोड़ी बाकी", "হাতে যোগ করা বাকি"),
    paidToSupplier: tx("Paid to supplier", "सप्लायर को पेमेंट दी", "সাপ্লায়ারকে পেমেন্ট দেওয়া"),
    receivedFromCustomer: tx("Received from customer", "कस्टमर से पेमेंट मिली", "কাস্টমারের পেমেন্ট পাওয়া"),
    allParties: tx(
      "All customers & suppliers",
      "सभी कस्टमर और सप्लायर",
      "সব কাস্টমার ও সাপ্লায়ার",
    ),
    weHaveToPay: tx("We have to pay", "हमें देना है", "আমাদের দিতে হবে"),
    customerHasToPay: tx("Customer has to pay", "कस्टमर से लेना है", "কাস্টমারের কাছে পাওনা"),
    outstanding: tx("Outstanding", "बाकी है", "বাকি আছে"),
    settled: tx("Settled", "हिसाब पूरा", "হিসাব মিটেছে"),
    addSupplierBill: tx("Add supplier bill", "सप्लायर बिल जोड़ें", "সাপ্লায়ার বিল যোগ করুন"),
    addCustomerDue: tx("Add customer due", "कस्टमर की बाकी जोड़ें", "কাস্টমারের বাকি যোগ করুন"),
    recordPaymentPaid: tx("Record payment paid", "दी गई पेमेंट दर्ज करें", "দেওয়া পেমেন্ট লিখুন"),
    recordPaymentReceived: tx("Record payment received", "मिली पेमेंट दर्ज करें", "পাওয়া পেমেন্ট লিখুন"),
    whatsappReminder: tx("WhatsApp reminder", "WhatsApp रिमाइंडर", "WhatsApp রিমাইন্ডার"),
    editDetails: tx("Edit code, address & details", "कोड, पता और डिटेल बदलें", "কোড, ঠিকানা ও ডিটেল বদলান"),
    partyDetails: tx("Party details", "पार्टी की डिटेल", "পার্টির ডিটেল"),
    partyDetailsHelp: tx(
      "A code is optional and can be added later for regular trade accounts. All saved details remain searchable.",
      "कोड ज़रूरी नहीं है; बड़े या रेगुलर खाते के लिए बाद में जोड़ सकते हैं। सेव की गई सभी डिटेल से खोज सकते हैं।",
      "কোড ঐচ্ছিক; বড় বা নিয়মিত ব্যবসার খাতায় পরে যোগ করা যাবে। সেভ করা সব তথ্য দিয়ে খোঁজা যাবে।",
    ),
    accountType: tx("Account type", "खाते का प्रकार", "খাতার ধরন"),
    accountTypeLocked: tx(
      "Account type is locked because this party has financial history.",
      "इस पार्टी में पुराना लेनदेन है, इसलिए खाते का प्रकार लॉक है।",
      "এই পার্টির আগের লেনদেন আছে, তাই খাতার ধরন লক করা।",
    ),
    partyName: tx("Party name *", "पार्टी का नाम *", "পার্টির নাম *"),
    partyNamePlaceholder: tx("Party name", "पार्टी का नाम", "পার্টির নাম"),
    searchableCode: tx("Code name (optional)", "कोड नाम (ज़रूरी नहीं)", "কোড নাম (ঐচ্ছিক)"),
    codeExample: tx("e.g. RAM-01", "जैसे RAM-01", "যেমন RAM-01"),
    phone: tx("Phone", "फोन", "ফোন"),
    optional: tx("Optional", "ज़रूरी नहीं", "ঐচ্ছিক"),
    fullAddress: tx("Full address", "पूरा पता", "পুরো ঠিকানা"),
    addressPlaceholder: tx(
      "Shop, market, area and city",
      "दुकान, मार्केट, इलाका और शहर",
      "দোকান, মার্কেট, এলাকা ও শহর",
    ),
    priceTier: tx("Price tier", "कौन-सा रेट", "কোন রেট"),
    tiers: {
      retail: tx("Retail", "रिटेल", "খুচরা"),
      wholesale: tx("Wholesale", "होलसेल", "পাইকারি"),
      bulk: tx("Bulk", "बल्क", "বাল্ক"),
      special: tx("Special", "स्पेशल", "স্পেশাল"),
    } satisfies Record<Party["priceTier"], string>,
    notes: tx("Notes", "नोट", "নোট"),
    cancel: tx("Cancel", "कैंसल", "ক্যানসেল"),
    saveDetails: tx("Save details", "डिटेल सेव करें", "ডিটেল সেভ করুন"),
    accountActivity: tx("Full account activity", "खाते का पूरा हिसाब", "খাতার পুরো হিসাব"),
    activityHelp: tx(
      "Every bill adds to the balance. Every payment shows its date and reduces the remaining due.",
      "हर बिल बाकी बढ़ाता है। हर पेमेंट तारीख के साथ दिखती है और बाकी घटाती है।",
      "প্রতিটি বিল বাকি বাড়ায়। প্রতিটি পেমেন্ট তারিখসহ দেখায় ও বাকি কমায়।",
    ),
    entries: (count: number) => tx(`${count} entries`, `${count} एंट्री`, `${count}টি এন্ট্রি`),
    remainingDue: tx("Remaining due", "बाकी", "বাকি"),
    deleteBill: tx("Delete bill", "बिल हटाएँ", "বিল মুছুন"),
    noActivity: tx(
      "No activity yet. Add a due or supplier bill to start this account.",
      "अभी कोई लेनदेन नहीं। खाता शुरू करने के लिए बाकी या सप्लायर बिल जोड़ें।",
      "এখনও কোনো লেনদেন নেই। খাতা শুরু করতে বাকি বা সাপ্লায়ার বিল যোগ করুন।",
    ),
    deleteConfirm: (invoiceNumber: string) =>
      tx(
        `Move ${invoiceNumber} to the 30-day bin?`,
        `${invoiceNumber} को 30 दिन की रिकवरी लिस्ट में भेजें?`,
        `${invoiceNumber} 30 দিনের রিকভারি লিস্টে পাঠাবেন?`,
      ),
    invoiceDeleted: tx("Invoice moved to the recovery bin", "बिल रिकवरी लिस्ट में गया", "বিল রিকভারি লিস্টে গেছে"),
    invoiceDeleteFailed: tx("Could not delete this invoice", "यह बिल नहीं हट सका", "এই বিল মোছা যায়নি"),
    partyNameEmpty: tx("Party name cannot be empty", "पार्टी का नाम खाली नहीं हो सकता", "পার্টির নাম ফাঁকা রাখা যাবে না"),
    codeRequired: tx("Enter a searchable code name", "खोजने वाला कोड डालें", "খোঁজার কোড দিন"),
    duplicateCode: (code: string, name: string) =>
      tx(
        `Code ${code} is already used by ${name}`,
        `कोड ${code} पहले से ${name} के लिए है`,
        `কোড ${code} আগে থেকেই ${name}-এর জন্য আছে`,
      ),
    typeChangeLocked: tx(
      "Account type cannot change after a balance, bill, due or payment is recorded.",
      "बैलेंस, बिल, बाकी या पेमेंट दर्ज होने के बाद खाते का प्रकार नहीं बदल सकता।",
      "ব্যালেন্স, বিল, বাকি বা পেমেন্ট রেকর্ড হলে খাতার ধরন বদলানো যাবে না।",
    ),
    detailsSaved: tx("Party details saved", "पार्टी की डिटेल सेव हुई", "পার্টির ডিটেল সেভ হয়েছে"),
    detailsSaveFailed: tx("Could not save party details", "पार्टी की डिटेल सेव नहीं हुई", "পার্টির ডিটেল সেভ হয়নি"),
    addNewCustomer: tx("Add new customer", "नया कस्टमर जोड़ें", "নতুন কাস্টমার যোগ করুন"),
    addCustomerOrSupplier: tx(
      "Add customer or supplier",
      "कस्टमर या सप्लायर जोड़ें",
      "কাস্টমার বা সাপ্লায়ার যোগ করুন",
    ),
    newPartyAccountType: tx("New party account type", "नई पार्टी का प्रकार", "নতুন পার্টির ধরন"),
    supplierName: tx("Supplier name *", "सप्लायर का नाम *", "সাপ্লায়ারের নাম *"),
    customerName: tx("Customer name *", "कस्टमर का नाम *", "কাস্টমারের নাম *"),
    supplierExample: tx(
      "e.g. Sharma Festival Goods",
      "जैसे Sharma Festival Goods",
      "যেমন Sharma Festival Goods",
    ),
    customerExample: tx(
      "e.g. New Market Decorators",
      "जैसे New Market Decorators",
      "যেমন New Market Decorators",
    ),
    codeAutoExample: tx(
      "e.g. NMD-01 — leave blank for no code",
      "जैसे NMD-01 — कोड न चाहिए तो खाली छोड़ें",
      "যেমন NMD-01 — কোড না চাইলে খালি রাখুন",
    ),
    supplierOpening: tx("Opening amount we owe", "शुरू में सप्लायर को देना है", "শুরুতে সাপ্লায়ারকে দিতে হবে"),
    customerOpening: tx("Opening amount customer owes", "शुरू में कस्टमर से लेना है", "শুরুতে কাস্টমারের কাছে পাওনা"),
    openingDue: tx("Opening due", "ओपनिंग बाकी", "ওপেনিং বাকি"),
    notesPlaceholder: tx(
      "Regular supplier, seasonal buyer, payment terms…",
      "रेगुलर सप्लायर, सीज़नल कस्टमर, पेमेंट की शर्तें…",
      "রেগুলার সাপ্লায়ার, সিজনের কাস্টমার, পেমেন্টের শর্ত…",
    ),
    editorHelp: tx(
      "Name, address and phone are searchable. Add a code only for regular trade accounts; every detail can be edited later.",
      "नाम, पता और फोन से खोज सकते हैं। कोड केवल रेगुलर बड़े खाते के लिए रखें; सभी डिटेल बाद में बदल सकते हैं।",
      "নাম, ঠিকানা ও ফোন দিয়ে খোঁজা যাবে। কোড শুধু নিয়মিত বড় ব্যবসার খাতায় দিন; সব তথ্য পরে বদলানো যাবে।",
    ),
    saving: tx("Saving…", "सेव हो रहा है…", "সেভ হচ্ছে…"),
    saveCustomer: tx("Save customer", "कस्टमर सेव करें", "কাস্টমার সেভ করুন"),
    saveSupplier: tx("Save supplier", "सप्लायर सेव करें", "সাপ্লায়ার সেভ করুন"),
    savePartyFailed: tx("Could not save the party. Check the details and code.", "पार्टी सेव नहीं हुई। डिटेल और कोड जाँचें।", "পার্টি সেভ হয়নি। ডিটেল ও কোড দেখুন।"),
    customerDue: tx("Customer due", "कस्टमर की बाकी", "কাস্টমারের বাকি"),
    dueAddsSupplier: tx(
      "This adds to the amount you must pay this supplier.",
      "यह रकम सप्लायर को आपकी कुल बाकी में जुड़ेगी।",
      "এই টাকা সাপ্লায়ারকে আপনার মোট দেনায় যোগ হবে।",
    ),
    dueAddsCustomer: tx(
      "This adds to the amount this customer must pay you.",
      "यह रकम कस्टमर से आपकी कुल बाकी में जुड़ेगी।",
      "এই টাকা কাস্টমারের কাছে আপনার মোট পাওনায় যোগ হবে।",
    ),
    supplierBillAmount: tx("Supplier bill amount", "सप्लायर बिल की रकम", "সাপ্লায়ার বিলের টাকা"),
    customerDueAmount: tx("Customer due amount", "कस्टमर की बाकी रकम", "কাস্টমারের বাকি টাকা"),
    amountToAdd: tx("Amount to add", "जोड़ने की रकम", "যোগ করার টাকা"),
    newBalance: tx("New balance", "नया बैलेंस", "নতুন ব্যালেন্স"),
    supplierDueReason: tx("What goods or bill is this for?", "किस माल या बिल के लिए?", "কোন মাল বা বিলের জন্য?"),
    customerDueReason: tx("Reason for this due", "इस बाकी की वजह", "এই বাকির কারণ"),
    billReference: tx("Bill/reference number (optional)", "बिल/रेफरेंस नंबर (ज़रूरी नहीं)", "বিল/রেফারেন্স নম্বর (ঐচ্ছিক)"),
    addDueFailed: tx("Could not add this due.", "यह बाकी नहीं जुड़ सकी।", "এই বাকি যোগ করা যায়নি।"),
    paymentTitle: (supplier: boolean, name: string) =>
      supplier
        ? tx(`Payment to ${name}`, `${name} को पेमेंट`, `${name}-কে পেমেন্ট`)
        : tx(`Payment from ${name}`, `${name} से पेमेंट`, `${name}-এর পেমেন্ট`),
    paymentAmount: tx("Payment amount", "पेमेंट की रकम", "পেমেন্টের টাকা"),
    amountPaid: tx("Amount paid", "दी गई रकम", "দেওয়া টাকা"),
    amountReceived: tx("Amount received", "मिली रकम", "পাওয়া টাকা"),
    remaining: tx("Remaining", "बाकी", "বাকি"),
    paymentMethod: tx("Payment method", "पेमेंट का तरीका", "পেমেন্টের মাধ্যম"),
    paymentReference: tx(
      "Online reference / cash note (optional)",
      "ऑनलाइन रेफरेंस / कैश नोट (ज़रूरी नहीं)",
      "অনলাইন রেফারেন্স / ক্যাশ নোট (ঐচ্ছিক)",
    ),
    chooseBillsManually: tx(
      "Choose sales bills manually",
      "सेल बिल खुद चुनें",
      "সেল বিল নিজে বাছুন",
    ),
    allocationHelp: (selectedDue: string) =>
      tx(
        `Payment goes to the oldest selected bill first. Selected due: ${selectedDue}`,
        `पेमेंट चुने हुए सबसे पुराने बिल में पहले लगेगी। चुनी बाकी: ${selectedDue}`,
        `পেমেন্ট আগে বাছাই করা সবচেয়ে পুরনো বিলে যাবে। বাছাই করা বাকি: ${selectedDue}`,
      ),
    recordPaymentFailed: tx("Could not record payment.", "पेमेंट दर्ज नहीं हुई।", "পেমেন্ট রেকর্ড করা যায়নি।"),
    savingPayment: tx("Saving payment…", "पेमेंट सेव हो रही है…", "পেমেন্ট সেভ হচ্ছে…"),
    saveSupplierPayment: tx("Save payment to supplier", "सप्लायर को दी पेमेंट सेव करें", "সাপ্লায়ারকে দেওয়া পেমেন্ট সেভ করুন"),
    saveCustomerPayment: tx("Save customer payment", "कस्टमर की पेमेंट सेव करें", "কাস্টমারের পেমেন্ট সেভ করুন"),
  };
}

function PartyLedger({
  language,
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
  language: Language;
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
  const copy = partyFlowCopy(language);
  const ledgerNote = (note: string) =>
    note === "Supplier bill"
      ? copy.supplierBill
      : note === "Manual due"
        ? copy.manualDue
        : note;
  const payableInvoiceType: Invoice["type"] =
    party.type === "supplier" ? "purchase" : "sale";
  const typeLocked =
    party.openingBalance !== 0 ||
    party.currentBalance !== 0 ||
    invoices.length > 0 ||
    payments.length > 0 ||
    accountEntries.length > 0;
  const allocationByInvoice = new Map<string, number>();
  for (const payment of payments)
    for (const allocation of payment.allocatedTo || [])
      allocationByInvoice.set(
        allocation.invoiceId,
        (allocationByInvoice.get(allocation.invoiceId) || 0) +
          allocation.amount,
      );
  const invoiceRows = invoices
    .filter(
      (entry) => !entry.deletedAt && entry.type === payableInvoiceType,
    )
    .flatMap((entry) => {
      const laterAllocated = allocationByInvoice.get(entry.id) || 0;
      const initialBreakdown = invoiceInitialPaymentBreakdown(
        entry,
        laterAllocated,
      );
      return [
        {
          id: entry.id,
          date: entry.date,
          timestamp: entry.createdAt,
          priority: 1,
          type: copy.bill,
          ref: entry.invoiceNumber,
          note:
            party.type === "supplier" ? copy.purchaseBill : copy.salesBill,
          delta: entry.grandTotal,
          invoice: entry as Invoice | undefined,
        },
        ...initialBreakdown.map((allocation, index) => ({
          id: `invoice-payment-${entry.id}-${index}`,
          date: entry.date,
          timestamp: entry.createdAt,
          priority: 2,
          type: copy.payment,
          ref: [entry.invoiceNumber, paymentModeLabel(allocation.mode, language), allocation.reference].filter(Boolean).join(" · "),
          note: `${party.type === "supplier" ? copy.paidWithPurchase : copy.receivedWithBill} · ${paymentModeLabel(allocation.mode, language)}`,
          delta: -allocation.amount,
          invoice: undefined as Invoice | undefined,
        })),
      ];
    });
  const rawRows = [
    ...(party.openingBalance > 0
      ? [
          {
            id: `opening-${party.id}`,
            date: party.createdAt.slice(0, 10),
            timestamp: party.createdAt,
            priority: 0,
            type: copy.opening,
            ref: copy.openingBalance,
            note:
              party.type === "supplier"
                ? copy.payableBroughtForward
                : copy.receivableBroughtForward,
            delta: party.openingBalance,
            invoice: undefined as Invoice | undefined,
          },
        ]
      : []),
    ...invoiceRows,
    ...accountEntries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      timestamp: entry.createdAt,
      priority: 1,
      type: party.type === "supplier" ? copy.supplierBill : copy.due,
      ref: entry.reference || ledgerNote(entry.note),
      note: ledgerNote(entry.note),
      delta: entry.amount,
      invoice: undefined as Invoice | undefined,
    })),
    ...payments.map((entry) => ({
      id: entry.id,
      date: entry.date,
      timestamp: entry.createdAt,
      priority: 3,
      type: copy.payment,
      ref: entry.reference || paymentModeLabel(entry.mode, language),
      note: `${party.type === "supplier" ? copy.paidToSupplier : copy.receivedFromCustomer} · ${paymentModeLabel(entry.mode, language)}`,
      delta: -entry.amount,
      invoice: undefined as Invoice | undefined,
    })),
  ].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id),
  );
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
    if (!confirm(copy.deleteConfirm(invoice.invoiceNumber))) return;
    try {
      await softDeleteInvoice(invoice.id);
      onToast(copy.invoiceDeleted);
    } catch {
      onToast(copy.invoiceDeleteFailed);
    }
  }
  async function saveDetails() {
    if (!draft.name.trim()) return onToast(copy.partyNameEmpty);
    const codeName = normalizePartyCode(draft.codeName);
    try {
      const duplicate = codeName
        ? await db.parties
            .filter(
              (entry) =>
                entry.id !== party.id &&
                entry.codeName.toLowerCase() === codeName.toLowerCase(),
            )
            .first()
        : undefined;
      if (duplicate)
        return onToast(copy.duplicateCode(codeName, duplicate.name));
      if (draft.type !== party.type && typeLocked)
        return onToast(copy.typeChangeLocked);
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
      onToast(copy.detailsSaved);
    } catch {
      onToast(copy.detailsSaveFailed);
    }
  }
  const isSupplier = party.type === "supplier";
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <button
        onClick={onBack}
        className="mb-3 text-sm font-black text-[#b65d25]"
      >
        ‹ {copy.allParties}
      </button>
      <div className="rounded-3xl bg-[#173f35] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {party.codeName && (
                <span className="rounded-lg bg-[#ffb45f] px-2 py-1 text-[0.5625rem] font-black uppercase text-[#173f35]">
                  {party.codeName}
                </span>
              )}
              <p className="text-xs font-semibold text-[#bdd0c8]">
                {party.phone || copy.noPhone}
                {party.gstin && ` · GSTIN ${party.gstin}`}
              </p>
            </div>
            <h2 className="mt-2 text-2xl font-black">{party.name}</h2>
            <p className="mt-1 truncate text-[0.625rem] text-[#c5d6d0]">
              ⌖ {party.address || copy.noAddress}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-[0.625rem] font-black uppercase ${isSupplier ? "bg-[#ef7d32] text-white" : "bg-white/10 text-white"}`}
          >
            {isSupplier ? copy.supplier : copy.customer}
          </span>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <p className="text-[0.625rem] font-bold uppercase text-[#bcd0c8]">
              {isSupplier ? copy.weHaveToPay : copy.customerHasToPay}
            </p>
            <strong className="mt-1 block text-3xl text-[#ffb45f]">
              {formatMoney(party.currentBalance)}
            </strong>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black">
            {party.currentBalance > 0 ? copy.outstanding : copy.settled}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={onDue}
            className="min-h-12 rounded-xl bg-white text-xs font-black text-[#176b4d]"
          >
            ＋ {isSupplier ? copy.addSupplierBill : copy.addCustomerDue}
          </button>
          <button
            onClick={onPayment}
            disabled={party.currentBalance <= 0}
            className="min-h-12 rounded-xl bg-[#ef7d32] text-xs font-black disabled:opacity-45"
          >
            ₹ {isSupplier
              ? copy.recordPaymentPaid
              : copy.recordPaymentReceived}
          </button>
          {!isSupplier && (
            <button
              onClick={remind}
              disabled={!party.phone}
              className="min-h-11 rounded-xl bg-white/10 text-xs font-black disabled:opacity-40"
            >
              {copy.whatsappReminder}
            </button>
          )}
          <button
            onClick={() => {
              if (!editing) setDraft(party);
              setEditing((value) => !value);
            }}
            className={`min-h-11 rounded-xl bg-white/10 text-xs font-black ${isSupplier ? "col-span-2" : ""}`}
          >
            ✎ {copy.editDetails}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 rounded-2xl border border-[#ddd7ca] bg-white p-3">
          <h3 className="text-sm font-black">{copy.partyDetails}</h3>
          <p className="mt-1 text-[0.625rem] text-[#748078]">
            {copy.partyDetailsHelp}
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <fieldset className="product-field md:col-span-2">
              <legend>{copy.accountType}</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={typeLocked}
                  aria-pressed={draft.type === "customer"}
                  onClick={() => setDraft({ ...draft, type: "customer" })}
                  className={`party-kind-button ${draft.type === "customer" ? "active" : ""}`}
                >
                  {copy.customer}
                </button>
                <button
                  type="button"
                  disabled={typeLocked}
                  aria-pressed={draft.type === "supplier"}
                  onClick={() => setDraft({ ...draft, type: "supplier" })}
                  className={`party-kind-button ${draft.type === "supplier" ? "active" : ""}`}
                >
                  {copy.supplier}
                </button>
              </div>
              {typeLocked && (
                <p className="mt-2 text-[0.625rem] font-semibold text-[#8a5a36]">
                  {copy.accountTypeLocked}
                </p>
              )}
            </fieldset>
            <label className="product-field">
              <span>{copy.partyName}</span>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder={copy.partyNamePlaceholder}
              />
            </label>
            <label className="product-field">
              <span>{copy.searchableCode}</span>
              <input
                value={draft.codeName}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    codeName: event.target.value.toUpperCase(),
                  })
                }
                placeholder={copy.codeExample}
                className="uppercase"
              />
            </label>
            <label className="product-field">
              <span>{copy.phone}</span>
              <input
                value={draft.phone}
                onChange={(event) =>
                  setDraft({ ...draft, phone: event.target.value })
                }
                placeholder={copy.phone}
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
                placeholder={`GSTIN (${copy.optional})`}
                className="uppercase"
              />
            </label>
            <label className="product-field md:col-span-2">
              <span>{copy.fullAddress}</span>
              <input
                value={draft.address}
                onChange={(event) =>
                  setDraft({ ...draft, address: event.target.value })
                }
                placeholder={copy.addressPlaceholder}
              />
            </label>
            <label className="product-field">
              <span>{copy.priceTier}</span>
              <select
                value={draft.priceTier}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    priceTier: event.target.value as Party["priceTier"],
                  })
                }
              >
                <option value="retail">{copy.tiers.retail}</option>
                <option value="wholesale">{copy.tiers.wholesale}</option>
                <option value="bulk">{copy.tiers.bulk}</option>
                <option value="special">{copy.tiers.special}</option>
              </select>
            </label>
            <label className="product-field">
              <span>{copy.notes}</span>
              <input
                value={draft.notes}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
                placeholder={copy.notes}
              />
            </label>
          </div>
          <div className="report-date-grid mt-3">
            <button
              onClick={() => setEditing(false)}
              className="counter-secondary"
            >
              {copy.cancel}
            </button>
            <button onClick={saveDetails} className="counter-primary">
              {copy.saveDetails}
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 mt-5 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-black">{copy.accountActivity}</h3>
          <p className="mt-1 text-[0.625rem] text-[#748078]">
            {copy.activityHelp}
          </p>
        </div>
        <span className="text-[0.625rem] font-black text-[#748078]">
          {copy.entries(rows.length)}
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
                    className={`rounded-full px-2 py-1 text-[0.5625rem] font-black ${row.delta < 0 ? "bg-[#e6f4ed] text-[#2c7057]" : "bg-[#fff0df] text-[#b45c25]"}`}
                  >
                    {row.type}
                  </span>
                  <strong className="truncate text-xs">{row.ref}</strong>
                </div>
                <p className="mt-1 text-[0.625rem] font-semibold text-[#53635c]">
                  {fullInvoiceDate(row.date, language)} ·{" "}
                  {invoiceRecordedTime(row.timestamp, language)}
                </p>
                <p className="mt-1 text-[0.5625rem] text-[#7a837e]">{row.note}</p>
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
                <p className="mt-1 text-[0.5625rem] font-black text-[#53635c]">
                  {copy.remainingDue} {formatMoney(row.remaining)}
                </p>
                {row.invoice && (
                  <button
                    onClick={() => deleteInvoice(row.invoice!)}
                    className="mt-1 text-[0.5625rem] font-bold text-[#b3513b]"
                  >
                    {copy.deleteBill}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!rows.length && (
          <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] p-8 text-center text-xs font-bold text-[#748078]">
            {copy.noActivity}
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
  const copy = partyFlowCopy(language);
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
    } catch {
      setError(copy.savePartyFailed);
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={
        customerOnly
          ? copy.addNewCustomer
          : copy.addCustomerOrSupplier
      }
      onClose={onClose}
    >
      {!customerOnly && (
        <div
          className="grid grid-cols-2 gap-2"
          role="group"
          aria-label={copy.newPartyAccountType}
        >
          <button
            type="button"
            aria-pressed={type === "customer"}
            onClick={() => setType("customer")}
            className={`party-kind-button ${type === "customer" ? "active" : ""}`}
          >
            {copy.customer}
            <br />
            <small>{t(language, "toCollect")}</small>
          </button>
          <button
            type="button"
            aria-pressed={type === "supplier"}
            onClick={() => setType("supplier")}
            className={`party-kind-button ${type === "supplier" ? "active" : ""}`}
          >
            {copy.supplier}
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
            {type === "supplier" ? copy.supplierName : copy.customerName}
          </span>
          <input
            autoFocus
            data-dialog-initial-focus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              type === "supplier"
                ? copy.supplierExample
                : copy.customerExample
            }
          />
        </label>
        <label className="product-field">
          <span>{copy.searchableCode.replace(" *", "")}</span>
          <input
            value={codeName}
            onChange={(event) => setCodeName(event.target.value.toUpperCase())}
            placeholder={copy.codeAutoExample}
            className="uppercase"
          />
        </label>
        <label className="product-field">
          <span>{copy.phone}</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder={copy.optional}
          />
        </label>
        <label className="product-field">
          <span>GSTIN</span>
          <input
            value={gstin}
            onChange={(event) => setGstin(event.target.value.toUpperCase())}
            placeholder={copy.optional}
          />
        </label>
        <label className="product-field md:col-span-2">
          <span>{copy.fullAddress}</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={copy.addressPlaceholder}
          />
        </label>
        {type === "customer" && (
          <label className="product-field">
            <span>{copy.priceTier}</span>
            <select
              value={priceTier}
              onChange={(event) =>
                setPriceTier(event.target.value as Party["priceTier"])
              }
            >
              <option value="retail">{copy.tiers.retail}</option>
              <option value="wholesale">{copy.tiers.wholesale}</option>
              <option value="bulk">{copy.tiers.bulk}</option>
              <option value="special">{copy.tiers.special}</option>
            </select>
          </label>
        )}
        <label className="product-field">
          <span>
            {type === "supplier"
              ? copy.supplierOpening
              : copy.customerOpening}
          </span>
          <button
            type="button"
            className="product-amount"
            onClick={() =>
              onPad({
                title: copy.openingDue,
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
          <span>{copy.notes}</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={copy.notesPlaceholder}
          />
        </label>
      </div>
      <p className="mt-3 rounded-xl bg-[#eef5ee] p-3 text-[0.625rem] font-semibold text-[#426252]">
        {copy.editorHelp}
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
        {saving
          ? copy.saving
          : type === "supplier"
            ? copy.saveSupplier
            : copy.saveCustomer}
      </button>
    </SheetFrame>
  );
}

function DueSheet({
  language,
  party,
  onClose,
  onPad,
  onSaved,
}: {
  language: Language;
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
  const copy = partyFlowCopy(language);
  async function save() {
    if (amount <= 0 || saving) return;
    setError("");
    setSaving(true);
    try {
      await recordDue(party, amount, note, reference);
      onSaved();
    } catch {
      setError(copy.addDueFailed);
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={`${isSupplier ? copy.supplierBill : copy.customerDue} · ${party.name}`}
      onClose={onClose}
    >
      <div className="rounded-2xl bg-[#fff0df] p-3 text-xs font-bold text-[#8d481f]">
        {isSupplier ? copy.dueAddsSupplier : copy.dueAddsCustomer}
      </div>
      <button
        data-dialog-initial-focus
        onClick={() =>
          onPad({
            title: isSupplier
              ? copy.supplierBillAmount
              : copy.customerDueAmount,
            value: amount,
            decimal: true,
            apply: setAmount,
          })
        }
        className="mt-3 flex min-h-16 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-white"
      >
        <span className="text-xs font-bold text-[#c3d4cd]">
          {copy.amountToAdd}
        </span>
        <strong className="text-2xl text-[#ffb45f]">
          {formatMoney(amount)}
        </strong>
      </button>
      <p className="mt-2 text-right text-[0.625rem] font-bold text-[#748078]">
        {copy.newBalance}: {formatMoney(party.currentBalance + amount)}
      </p>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={
          isSupplier ? copy.supplierDueReason : copy.customerDueReason
        }
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder={copy.billReference}
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
          ? copy.saving
          : isSupplier
            ? copy.addSupplierBill
            : copy.addCustomerDue}
      </button>
    </SheetFrame>
  );
}

function PaymentSheet({
  language,
  party,
  invoices,
  onClose,
  onPad,
  onSaved,
}: {
  language: Language;
  party: Party;
  invoices: Invoice[];
  onClose: () => void;
  onPad: (state: PadState) => void;
  onSaved: (payment: Payment) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<PaymentChannel>("cash");
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isSupplier = party.type === "supplier";
  const copy = partyFlowCopy(language);
  const paymentModes = [
    ["cash", paymentModeLabel("cash", language)],
    ["upi", paymentModeLabel("upi", language)],
    ["bank", paymentModeLabel("bank", language)],
    ["cheque", paymentModeLabel("cheque", language)],
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
    } catch {
      setError(copy.recordPaymentFailed);
      setSaving(false);
    }
  }
  return (
    <SheetFrame
      title={copy.paymentTitle(isSupplier, party.name)}
      onClose={onClose}
    >
      <button
        data-dialog-initial-focus
        onClick={() =>
          onPad({
            title: copy.paymentAmount,
            value: amount,
            decimal: true,
            apply: setAmount,
          })
        }
        className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-white"
      >
        <span className="text-xs font-bold text-[#c3d4cd]">
          {isSupplier ? copy.amountPaid : copy.amountReceived}
        </span>
        <strong className="text-2xl text-[#ffb45f]">
          {formatMoney(amount)}
        </strong>
      </button>
      <div className="mt-2 flex justify-between text-[0.625rem] font-bold text-[#748078]">
        <span>
          {copy.outstanding} {formatMoney(party.currentBalance)}
        </span>
        <span>
          {copy.remaining} {formatMoney(Math.max(0, party.currentBalance - amount))}
        </span>
      </div>
      <div
        className="mt-3 grid grid-cols-4 gap-2"
        role="group"
        aria-label={copy.paymentMethod}
      >
        {paymentModes.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`min-h-11 rounded-xl border px-1 text-[0.625rem] font-black ${mode === value ? "border-[#173f35] bg-[#173f35] text-white" : "border-[#d8d2c6] bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder={copy.paymentReference}
        className="mt-3 h-12 w-full rounded-xl border border-[#d8d2c6] bg-white px-3 text-sm"
      />
      {!isSupplier && invoices.length > 0 && (
        <label className="mt-4 flex items-center justify-between rounded-xl bg-[#f1eee7] p-3 text-xs font-black">
          <span>{copy.chooseBillsManually}</span>
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
          <p className="text-[0.625rem] font-bold text-[#748078]">
            {copy.allocationHelp(formatMoney(selectedDue))}
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
                  <p className="text-[0.5625rem] text-[#7b837f]">
                    {formatLocalizedDate(invoice.date, language)}
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
          ? copy.savingPayment
          : isSupplier
            ? copy.saveSupplierPayment
            : copy.saveCustomerPayment}
      </button>
    </SheetFrame>
  );
}

const itemsScreenCopy = {
  en: {
    eyebrow: "Product catalogue",
    title: "Items",
    addProduct: "Add product",
    helper: "Add, edit and photograph products. Every change is saved offline first.",
    active: (count: number) => `${count} active`,
    archived: (count: number) => `${count} archived`,
    catalogueViews: "Product catalogue views",
    activeProducts: "Active products",
    archivedProducts: "Archived products",
    archivedHelper: "Archived products stay safe here. Restore one to make it available for billing again.",
    searchLabel: "Search product catalogue",
    searchPlaceholder: "Name, SKU, Hindi or Bengali",
    variantFamilies: "Variant families",
    familySummary: (groups: number, skus: number) =>
      `${groups} groups across ${skus} matching SKUs`,
    grouped: "Grouped",
    flatList: "Flat list",
    variants: (count: number) => `${count} variants`,
    addPhoto: (name: string) => `Add photo for ${name}`,
    replacePhoto: (name: string) => `Replace photo for ${name}`,
    removePhotoConfirm: (name: string) => `Remove the photo for ${name}?`,
    saving: "Saving…",
    changePhoto: "Change",
    photo: "Photo",
    edit: "Edit product details",
    removePhoto: "Remove photo",
    wholesale: "Wholesale",
    bulk: "Bulk",
    addToBill: "Add to current bill",
    restore: "Restore product",
    restoreProduct: (name: string) => `Restore ${name}`,
    archivedStatus: "Archived",
    archivedOn: (date: string) => `Archived ${date}`,
    loadMore: (remaining: number) => `Load 90 more · ${remaining} remaining`,
    noMatch: "No matching product",
    noArchived: "No archived products yet.",
    addManually: "Add it manually",
  },
  hi: {
    eyebrow: "प्रोडक्ट कैटलॉग",
    title: "सामान",
    addProduct: "प्रोडक्ट जोड़ें",
    helper: "सामान जोड़ें, बदलें और फोटो लगाएँ। हर बदलाव पहले ऑफलाइन सेव होता है।",
    active: (count: number) => `${count} चालू`,
    archived: (count: number) => `${count} आर्काइव`,
    catalogueViews: "प्रोडक्ट कैटलॉग के प्रकार",
    activeProducts: "चालू प्रोडक्ट",
    archivedProducts: "आर्काइव प्रोडक्ट",
    archivedHelper: "आर्काइव किए प्रोडक्ट यहाँ सुरक्षित रहते हैं। उन्हें फिर से बिलिंग में लाने के लिए वापस लाएँ।",
    searchLabel: "प्रोडक्ट कैटलॉग में खोजें",
    searchPlaceholder: "नाम, SKU, हिंदी या बंगाली",
    variantFamilies: "वेरिएंट ग्रुप",
    familySummary: (groups: number, skus: number) =>
      `${skus} मिलते-जुलते SKU के ${groups} ग्रुप`,
    grouped: "ग्रुप में",
    flatList: "पूरी लिस्ट",
    variants: (count: number) => `${count} वेरिएंट`,
    addPhoto: (name: string) => `${name} की फोटो जोड़ें`,
    replacePhoto: (name: string) => `${name} की फोटो बदलें`,
    removePhotoConfirm: (name: string) => `${name} की फोटो हटाएँ?`,
    saving: "सेव हो रहा है…",
    changePhoto: "बदलें",
    photo: "फोटो",
    edit: "प्रोडक्ट की जानकारी बदलें",
    removePhoto: "फोटो हटाएँ",
    wholesale: "होलसेल",
    bulk: "बल्क",
    addToBill: "मौजूदा बिल में जोड़ें",
    restore: "प्रोडक्ट वापस लाएँ",
    restoreProduct: (name: string) => `${name} को वापस लाएँ`,
    archivedStatus: "आर्काइव",
    archivedOn: (date: string) => `${date} को आर्काइव`,
    loadMore: (remaining: number) => `90 और दिखाएँ · ${remaining} बाकी`,
    noMatch: "मिलता-जुलता कोई प्रोडक्ट नहीं मिला",
    noArchived: "अभी कोई आर्काइव किया हुआ प्रोडक्ट नहीं है।",
    addManually: "खुद जोड़ें",
  },
  bn: {
    eyebrow: "পণ্যের ক্যাটালগ",
    title: "পণ্য",
    addProduct: "পণ্য যোগ করুন",
    helper: "পণ্য যোগ করুন, বদলান ও ছবি দিন। প্রতিটি বদল আগে অফলাইনে সেভ হয়।",
    active: (count: number) => `${count}টি চালু`,
    archived: (count: number) => `${count}টি আর্কাইভ`,
    catalogueViews: "পণ্যের ক্যাটালগের ধরন",
    activeProducts: "চালু পণ্য",
    archivedProducts: "আর্কাইভ করা পণ্য",
    archivedHelper: "আর্কাইভ করা পণ্য এখানে নিরাপদে থাকে। আবার বিলিংয়ে আনতে ফিরিয়ে আনুন।",
    searchLabel: "পণ্যের ক্যাটালগে খুঁজুন",
    searchPlaceholder: "নাম, SKU, হিন্দি বা বাংলা",
    variantFamilies: "ভ্যারিয়েন্ট গ্রুপ",
    familySummary: (groups: number, skus: number) =>
      `${skus}টি মিলছে এমন SKU-এর ${groups}টি গ্রুপ`,
    grouped: "গ্রুপে",
    flatList: "পুরো লিস্ট",
    variants: (count: number) => `${count}টি ভ্যারিয়েন্ট`,
    addPhoto: (name: string) => `${name}-এর ছবি যোগ করুন`,
    replacePhoto: (name: string) => `${name}-এর ছবি বদলান`,
    removePhotoConfirm: (name: string) => `${name}-এর ছবি সরাবেন?`,
    saving: "সেভ হচ্ছে…",
    changePhoto: "বদলান",
    photo: "ছবি",
    edit: "পণ্যের তথ্য বদলান",
    removePhoto: "ছবি সরান",
    wholesale: "হোলসেল",
    bulk: "বাল্ক",
    addToBill: "চলতি বিলে যোগ করুন",
    restore: "পণ্য ফিরিয়ে আনুন",
    restoreProduct: (name: string) => `${name} ফিরিয়ে আনুন`,
    archivedStatus: "আর্কাইভ",
    archivedOn: (date: string) => `${date}-এ আর্কাইভ`,
    loadMore: (remaining: number) => `আরও 90টি দেখান · ${remaining}টি বাকি`,
    noMatch: "মিলছে এমন পণ্য পাওয়া যায়নি",
    noArchived: "এখনও কোনো আর্কাইভ করা পণ্য নেই।",
    addManually: "নিজে যোগ করুন",
  },
} satisfies Record<Language, Record<string, string | ((...args: never[]) => string)>>;

function localizedVariantFamilyName(item: Item, language: Language) {
  const taggedFamily = item.festivalTags
    .find((value) => value.startsWith("family:"))
    ?.slice(7)
    .trim();
  if (taggedFamily) return taggedFamily;
  const colorWords =
    language === "hi"
      ? /\b(लाल|सुनहरा|हरा|चांदी|गुलाबी|नीला|सफेद|नारंगी|काला|पीला)\b/giu
      : language === "bn"
        ? /\b(লাল|সোনালি|সবুজ|রুপালি|গোলাপি|নীল|সাদা|কমলা|কালো|হলুদ)\b/giu
        : /\b(red|gold|green|silver|pink|blue|white|orange|black|yellow)\b/giu;
  return (
    localizedItemName(language, item)
      .replace(colorWords, "")
      .replace(/\b\d+\s*(inch|in|ft)\b/giu, "")
      .replace(/\s+/g, " ")
      .trim() || tr(language, "Other", "बाकी", "অন্যান্য")
  );
}

function ItemsScreen({
  items,
  archivedItems,
  language,
  ownerMode,
  onOwnerMode,
  onInventory,
  onFestival,
  onAdd,
  onCreate,
  onEdit,
  onRestore,
  onPhoto,
}: {
  items: Item[];
  archivedItems: Item[];
  language: Language;
  ownerMode: boolean;
  onOwnerMode: (enabled: boolean) => void;
  onInventory: () => void;
  onFestival: () => void;
  onAdd: (item: Item) => void;
  onCreate: () => void;
  onEdit: (item: Item) => void;
  onRestore: (item: Item) => Promise<void>;
  onPhoto: (item: Item, file?: File) => Promise<void>;
}) {
  const copy = itemsScreenCopy[language];
  const [catalogueView, setCatalogueView] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [photoBusy, setPhotoBusy] = useState("");
  const [restoreBusy, setRestoreBusy] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(90);
  const [groupVariants, setGroupVariants] = useState(true);
  const activeMatches = useMemo(() => items
    .map((item) => ({ item, score: fuzzyScore(query, item) }))
    .filter((x) => !query || x.score > 0)
    .sort((a, b) => b.score - a.score || variantFamily(a.item).localeCompare(variantFamily(b.item))), [items, query]);
  const archivedMatches = useMemo(() => archivedItems
    .map((item) => ({ item, score: fuzzyScore(query, item) }))
    .filter((x) => !query || x.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt)), [archivedItems, query]);
  const matches = catalogueView === "active" ? activeMatches : archivedMatches;
  const visibleMatches = matches.slice(0, visibleLimit);
  const familyCount = useMemo(() => new Set(activeMatches.map(({ item }) => variantFamily(item))).size, [activeMatches]);
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
    if (!confirm(copy.removePhotoConfirm(localizedItemName(language, item))))
      return;
    setPhotoBusy(item.id);
    try {
      await onPhoto(item);
    } catch {
    } finally {
      setPhotoBusy("");
    }
  }
  async function restore(item: Item) {
    if (restoreBusy) return;
    setRestoreBusy(item.id);
    try {
      await onRestore(item);
    } finally {
      setRestoreBusy("");
    }
  }
  return (
    <section className="mx-auto max-w-5xl px-3 py-5 md:px-7">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 className="page-title">{copy.title}</h2>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onInventory}
            className="items-workspace-shortcut"
          >
            ▦ {inventoryText(language, "Inventory", "इन्वेंटरी", "ইনভেন্টরি")}
          </button>
          <button
            type="button"
            onClick={onFestival}
            className="items-workspace-shortcut"
          >
            ◷ {festivalCopy(language).title}
          </button>
          <button
            type="button"
            onClick={() => {
              setCatalogueView("active");
              onCreate();
            }}
            className="col-span-2 min-h-11 rounded-lg bg-[#014921] px-4 text-xs font-black text-white sm:col-span-1"
          >
            ＋ {copy.addProduct}
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[0.6875rem] font-semibold text-[#6f7773]">
          {catalogueView === "active" ? copy.helper : copy.archivedHelper}
        </p>
        <span className="shrink-0 rounded-xl bg-[#e9f3ed] px-3 py-2 text-xs font-black text-[#286c52]">
          {catalogueView === "active"
            ? copy.active(items.length)
            : copy.archived(archivedItems.length)}
        </span>
      </div>
      <div
        className="item-catalogue-tabs mt-4"
        role="group"
        aria-label={copy.catalogueViews}
      >
        <button
          type="button"
          aria-pressed={catalogueView === "active"}
          onClick={() => {
            setCatalogueView("active");
            setQuery("");
            setVisibleLimit(90);
          }}
        >
          <span>{copy.activeProducts}</span>
          <strong>{items.length}</strong>
        </button>
        <button
          type="button"
          aria-pressed={catalogueView === "archived"}
          onClick={() => {
            setCatalogueView("archived");
            setQuery("");
            setVisibleLimit(90);
          }}
        >
          <span>{copy.archivedProducts}</span>
          <strong>{archivedItems.length}</strong>
        </button>
      </div>
      <div className={`owner-mode-panel mt-4 ${ownerMode ? "active" : ""}`}>
        <div className="reports-dashboard-copy min-w-0">
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
        <span aria-hidden="true">⌕</span>
        <input
          aria-label={copy.searchLabel}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisibleLimit(90); }}
          placeholder={
            catalogueView === "active"
              ? copy.searchPlaceholder
              : copy.archivedProducts
          }
        />
      </label>
      {catalogueView === "active" && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#e2e2db] bg-white p-2"><div><strong className="text-[0.625rem]">{copy.variantFamilies}</strong><p className="text-[0.5rem] text-[#747573]">{copy.familySummary(familyCount, activeMatches.length)}</p></div><button type="button" role="switch" aria-checked={groupVariants} onClick={() => { setGroupVariants((value) => !value); setVisibleLimit(90); }} className={`min-h-10 rounded-lg px-3 text-[0.5625rem] font-black ${groupVariants ? "bg-[#014921] text-white" : "border"}`}>{groupVariants ? copy.grouped : copy.flatList}</button></div>
      )}
      {catalogueView === "active" ? (
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {visibleMatches.map(({ item }, index) => {
          const metrics = itemProfitMetrics(item);
          const family = variantFamily(item);
          const showFamily = groupVariants && (index === 0 || variantFamily(visibleMatches[index - 1].item) !== family);
          return (
            <div key={item.id} className="contents">
            {showFamily && <div className="col-span-full mt-2 flex items-center gap-2 border-b border-[#e2e2db] pb-2"><strong className="text-xs text-[#014921]">{localizedVariantFamilyName(item, language)}</strong><span className="rounded-full bg-[#f4faf0] px-2 py-1 text-[0.5rem] font-black">{copy.variants(matches.filter((row) => variantFamily(row.item) === family).length)}</span></div>}
            <article
              className="rounded-2xl border border-[#ddd7ca] bg-white p-3.5 shadow-sm"
            >
            <div className="flex items-start gap-3">
              <label
                className="group relative shrink-0 cursor-pointer"
                aria-label={item.imageUrl ? copy.replacePhoto(localizedItemName(language, item)) : copy.addPhoto(localizedItemName(language, item))}
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
                <ProductThumb item={item} language={language} className="h-[72px] w-[72px]" />
                <span className="absolute inset-x-1 bottom-1 rounded bg-[#014921]/90 py-1 text-center text-[0.5rem] font-black text-white">
                  {photoBusy === item.id
                    ? copy.saving
                    : item.imageUrl
                      ? copy.changePhoto
                      : `＋ ${copy.photo}`}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black">{localizedItemName(language, item)}</h3>
                    <p className="mt-1 truncate text-[0.625rem] text-[#737f78]">
                      {localizedItemSecondaryName(language, item)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-[#f0ede6] px-2 py-1 text-[0.5625rem] font-black">
                    {item.skuCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="mt-2 text-[0.5625rem] font-black text-[#014921] underline underline-offset-2"
                >
                  {copy.edit}
                </button>
                {item.imageUrl && (
                  <button
                    type="button"
                    onClick={() => void removePhoto(item)}
                    className="ml-3 mt-2 text-[0.5625rem] font-black text-[#8b4840] underline underline-offset-2"
                  >
                    {copy.removePhoto}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[0.5rem] font-bold text-[#77817c]">
                  {copy.wholesale}
                </span>
                <strong className="mt-1 block text-xs">
                  {formatMoney(item.priceWholesale)}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[0.5rem] font-bold text-[#77817c]">
                  {copy.bulk}
                </span>
                <strong className="mt-1 block text-xs">
                  {formatMoney(item.priceBulk)}
                </strong>
              </div>
              <div className="rounded-xl bg-[#f6f3ec] p-2">
                <span className="text-[0.5rem] font-bold text-[#77817c]">GST</span>
                <strong className="mt-1 block text-xs">{item.gstRate}%</strong>
              </div>
            </div>
            {ownerMode && (
              <div
                className="item-owner-panel mt-3"
                aria-label={`${t(language, "ownerMode")} · ${localizedItemName(language, item)}`}
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
              ＋ {copy.addToBill}
            </button>
            </article>
            </div>
          );
        })}
      </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleMatches.map(({ item }) => (
            <article key={item.id} className="archived-product-card">
              <div className="flex min-w-0 items-start gap-3">
                <ProductThumb
                  item={item}
                  language={language}
                  className="h-14 w-14 opacity-75 grayscale-[25%]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black">
                        {localizedItemName(language, item)}
                      </h3>
                      <p className="mt-1 truncate text-[0.625rem] text-[#737f78]">
                        {localizedItemSecondaryName(language, item)}
                      </p>
                    </div>
                    <span className="archived-product-card__status">
                      {copy.archivedStatus}
                    </span>
                  </div>
                  <p className="mt-2 text-[0.5625rem] font-bold text-[#737f78]">
                    {item.skuCode} · {copy.archivedOn(
                      formatLocalizedDateTime(item.updatedAt, language),
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-[#f6f3ec] p-2">
                  <span className="text-[0.5rem] font-bold text-[#77817c]">
                    {copy.wholesale}
                  </span>
                  <strong className="mt-1 block text-xs">
                    {formatMoney(item.priceWholesale)}
                  </strong>
                </div>
                <div className="rounded-xl bg-[#f6f3ec] p-2">
                  <span className="text-[0.5rem] font-bold text-[#77817c]">
                    {copy.bulk}
                  </span>
                  <strong className="mt-1 block text-xs">
                    {formatMoney(item.priceBulk)}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                disabled={Boolean(restoreBusy)}
                onClick={() => void restore(item)}
                aria-label={copy.restoreProduct(localizedItemName(language, item))}
                className="counter-primary mt-3 min-h-11 w-full disabled:opacity-55"
              >
                {restoreBusy === item.id ? copy.saving : `↺ ${copy.restore}`}
              </button>
            </article>
          ))}
        </div>
      )}
      {visibleLimit < matches.length && <button type="button" onClick={() => setVisibleLimit((value) => value + 90)} className="counter-secondary mt-4">{copy.loadMore(matches.length - visibleLimit)}</button>}
      {!matches.length && (
        <div className="rounded-xl border border-dashed border-[#cfd3cc] p-8 text-center">
          <p className="text-sm font-black">
            {catalogueView === "archived" && !query
              ? copy.noArchived
              : copy.noMatch}
          </p>
          {catalogueView === "active" && (
            <button
              onClick={onCreate}
              className="mt-3 text-xs font-black text-[#014921] underline"
            >
              {copy.addManually}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const dashboardModeColors: Record<string, string> = {
  cash: "var(--report-mode-cash)",
  upi: "var(--report-mode-upi)",
  credit: "var(--report-money-due)",
  mixed: "var(--report-mode-mixed)",
  bank: "var(--report-mode-bank)",
  cheque: "var(--report-mode-cheque)",
};
const dashboardCategoryNames: Record<string, string> = {
  "cat-mala": "Moti Mala",
  "cat-puja": "Puja Decor",
  "cat-diwali": "Diwali Lights & Torans",
  "cat-christmas": "Christmas Decor",
  "cat-birthday": "Birthday Items",
  "cat-patriotic": "Independence Day / Patriotic",
  "cat-uncategorized": "Uncategorized",
};

function DashboardMetric({
  icon,
  label,
  value,
  note,
  tone,
  valueTone,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  tone: "orange" | "green" | "blue" | "gold";
  valueTone?: "in" | "out" | "due";
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
        <p className="text-[0.625rem] font-black uppercase tracking-[.12em] text-[#8a918d]">
          {label}
        </p>
        <strong
          className={`mt-2 block break-words text-[1.375rem] tracking-tight ${
            valueTone === "in"
              ? "report-money-in"
              : valueTone === "out"
                ? "report-money-out"
                : valueTone === "due"
                  ? "report-money-due"
                  : "text-[#173f35]"
          }`}
        >
          {value}
        </strong>
        <p className="mt-1 text-[0.625rem] font-semibold text-[#7b8580]">{note}</p>
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
    section: "कस्टमर की खरीद हिस्ट्री",
    helper:
      "कस्टमर के सभी सेव बिल और खरीद की तारीख देखने के लिए नाम पर टैप करें।",
    search: "नाम, कोड, पता या फोन खोजें",
    bills: "बिल",
    spent: "कुल खरीदा",
    lastPurchase: "पिछली खरीद",
    noBills: "अभी कोई सेव बिल नहीं है",
    back: "रिपोर्ट पर वापस",
    savedBills: "सेव किए बिल",
    purchaseTotal: "खरीद का कुल",
    paid: "जमा",
    due: "बाकी",
    viewBill: "पूरा बिल देखें",
    items: "खरीदा सामान",
    deleted: "रिकवरी बिन में",
  },
  bn: {
    section: "কাস্টমারের কেনাকাটার হিস্ট্রি",
    helper: "সব সেভ করা বিল ও কেনার তারিখ দেখতে কাস্টমারের নামে চাপুন।",
    search: "নাম, কোড, ঠিকানা বা ফোন খুঁজুন",
    bills: "বিল",
    spent: "মোট কেনাকাটা",
    lastPurchase: "শেষ কেনাকাটা",
    noBills: "এখনও কোনো সেভ করা বিল নেই",
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

const fullInvoiceDate = (date: string, language: Language) =>
  formatLocalizedDate(date, language, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const invoiceRecordedTime = (createdAt: string, language: Language) =>
  formatLocalizedDateTime(createdAt, language, {
    hour: "2-digit",
    minute: "2-digit",
  });
const paymentModeLabel = (mode: Payment["mode"], language: Language) =>
  mode === "cash"
    ? tr(language, "Cash", "कैश", "ক্যাশ")
    : mode === "upi"
      ? tr(language, "Online · UPI", "ऑनलाइन · UPI", "অনলাইন · UPI")
      : mode === "bank"
        ? tr(language, "Online · Bank", "ऑनलाइन · बैंक", "অনলাইন · ব্যাংক")
        : tr(language, "Cheque", "चेक", "চেক");
const invoicePaymentLabel = (invoice: Invoice, language: Language) => {
  const storedBreakdown = (invoice.paymentBreakdown || []).filter((entry) => entry.amount > 0);
  const splitLabel = storedBreakdown.length > 1
    ? storedBreakdown
        .map((entry) => `${paymentModeLabel(entry.mode, language)} ${formatMoney(entry.amount)}`)
        .join(" + ")
    : "";
  const channel =
    invoice.paymentReceivedMode ||
    (paymentChannels.includes(invoice.paymentMode as PaymentChannel)
      ? (invoice.paymentMode as PaymentChannel)
      : undefined);
  if (invoice.amountDue > 0)
    return invoice.amountPaid > 0
      ? `${tr(language, "Part paid", "पार्ट पेमेंट", "পার্ট পেমেন্ট")}${splitLabel ? ` · ${splitLabel}` : channel ? ` · ${paymentModeLabel(channel, language)}` : ""}`
      : tr(language, "Pay later · Credit", "बाद में देंगे · उधार", "পরে দেবেন · বাকি");
  if (splitLabel) return `${tr(language, "Mixed payment", "मिक्स पेमेंट", "মিক্সড পেমেন্ট")} · ${splitLabel}`;
  return channel
    ? paymentModeLabel(channel, language)
    : invoice.paymentMode === "mixed"
      ? tr(language, "Mixed payment", "मिक्स पेमेंट", "মিক্সড পেমেন্ট")
      : tr(language, "Paid", "पेमेंट हो गया", "পেমেন্ট হয়েছে");
};

const duesScreenCopy = {
  en: {
    noAddress: "No address saved", noPhone: "No phone saved", reminder: "WhatsApp reminder", khata: "Account ledger", date: "Date",
    billsStillDue: "Bills still due", billsStillDueHelper: "Oldest unpaid bill first, with the original total, received amount and balance left.",
    bills: (count: number) => `${count} bills`, dueAmount: (amount: string) => `Due ${amount}`, billTotal: "Bill total", receivedSoFar: "Received so far",
    eyebrow: "Customer receivables", listHelper: "Every customer with due history, including outstanding and fully settled accounts.",
    totalToCollect: "Total to collect", customersWithDue: "Customers with due", searchLabel: "Search customers with due history", searchPlaceholder: "Search customer name or code",
    dueHistoryCustomers: "Due-history customers", allAccounts: "All", outstandingAccounts: "Outstanding", paidInFullAccounts: "Paid in full", paidInFull: "Paid in full", statusFilter: "Filter due accounts", noAccounts: "No due-history customers yet",
    actualPayments: "Customer payments", returnCredits: "Return credits", paidCredit: "Paid / credit", refundPaid: "Refund paid",
    lastPayment: "Last payment", noPayment: "No payment recorded yet", due: "Due", forParty: (action: string, party: string) => `${action} for ${party}`,
    noSearchMatch: "No due-history customer matches this search or filter", noDues: "No customer dues right now", searchHint: "Try the customer name or code name, or change the status filter.", noDuesHint: "Customers appear here after a pay-later balance is recorded, even after it is fully settled.",
    exportDone: (party: string, format: string, result: string) => `${party} ${format} due statement ${result}`,
    exportError: (format: string, party: string) => `Could not export the ${format} statement for ${party}.`, shared: "shared", downloaded: "downloaded",
    openingBalance: "Opening balance", salesBill: "Sales bill", paidWithBill: "Payment received with bill", manualDue: "Manual due", customerPayment: "Customer payment received",
    kinds: { opening_balance: "Opening balance", sale_invoice: "Sale bill", return_credit: "Sales return credit", return_refund: "Immediate return refund", manual_due: "Manual due", payment: "Payment", balance_adjustment: "Balance adjustment" },
  },
  hi: {
    noAddress: "पता सेव नहीं है", noPhone: "फोन सेव नहीं है", reminder: "WhatsApp रिमाइंडर", khata: "खाता", date: "तारीख",
    billsStillDue: "जिन बिलों का पेमेंट बाकी है", billsStillDueHelper: "सबसे पुराना बाकी बिल पहले है। हर कार्ड में बिल का कुल, मिली रकम और बचा बैलेंस अलग दिखता है।",
    bills: (count: number) => `${count} बिल`, dueAmount: (amount: string) => `बाकी ${amount}`, billTotal: "बिल का कुल", receivedSoFar: "अब तक मिला",
    eyebrow: "कस्टमर से लेना है", listHelper: "बाकी हिस्ट्री वाले सभी कस्टमर—बाकी और पूरा सेटल, दोनों खाते।",
    totalToCollect: "कुल लेना है", customersWithDue: "बाकी वाले कस्टमर", searchLabel: "बाकी हिस्ट्री वाले कस्टमर खोजें", searchPlaceholder: "कस्टमर का नाम या कोड खोजें",
    dueHistoryCustomers: "बाकी हिस्ट्री वाले कस्टमर", allAccounts: "सभी", outstandingAccounts: "बाकी", paidInFullAccounts: "पूरा भुगतान", paidInFull: "पूरा भुगतान", statusFilter: "बाकी खाते फ़िल्टर करें", noAccounts: "अभी कोई बाकी हिस्ट्री नहीं है",
    actualPayments: "कस्टमर पेमेंट", returnCredits: "रिटर्न क्रेडिट", paidCredit: "पेमेंट / क्रेडिट", refundPaid: "रिफंड दिया",
    lastPayment: "पिछला पेमेंट", noPayment: "अभी कोई पेमेंट दर्ज नहीं है", due: "बाकी", forParty: (action: string, party: string) => `${party} के लिए ${action}`,
    noSearchMatch: "इस खोज या फ़िल्टर से कोई बाकी हिस्ट्री वाला कस्टमर नहीं मिला", noDues: "अभी किसी कस्टमर का बाकी नहीं है", searchHint: "कस्टमर का नाम/कोड डालें या स्टेटस फ़िल्टर बदलें।", noDuesHint: "बाद में पेमेंट वाला बैलेंस दर्ज होने पर, पूरा सेटल होने के बाद भी कस्टमर यहाँ दिखेगा।",
    exportDone: (party: string, format: string, result: string) => `${party} का ${format} बाकी स्टेटमेंट ${result}`,
    exportError: (format: string, party: string) => `${party} का ${format} स्टेटमेंट एक्सपोर्ट नहीं हो सका।`, shared: "शेयर हो गया", downloaded: "डाउनलोड हो गया",
    openingBalance: "शुरुआती बैलेंस", salesBill: "सेल बिल", paidWithBill: "बिल के साथ पेमेंट मिला", manualDue: "हाथ से जोड़ा बाकी", customerPayment: "कस्टमर पेमेंट मिला",
    kinds: { opening_balance: "शुरुआती बैलेंस", sale_invoice: "सेल बिल", return_credit: "बिक्री वापसी क्रेडिट", return_refund: "तुरंत वापसी रिफंड", manual_due: "हाथ से जोड़ा बाकी", payment: "पेमेंट", balance_adjustment: "बैलेंस में बदलाव" },
  },
  bn: {
    noAddress: "ঠিকানা সেভ করা নেই", noPhone: "ফোন সেভ করা নেই", reminder: "WhatsApp রিমাইন্ডার", khata: "খাতা", date: "তারিখ",
    billsStillDue: "যে বিলগুলোর টাকা বাকি", billsStillDueHelper: "সবচেয়ে পুরনো বাকি বিল আগে আছে। প্রতিটি কার্ডে বিলের মোট, পাওয়া টাকা ও বাকি ব্যালেন্স আলাদা দেখা যাবে।",
    bills: (count: number) => `${count}টি বিল`, dueAmount: (amount: string) => `বাকি ${amount}`, billTotal: "বিলের মোট", receivedSoFar: "এখনও পর্যন্ত পাওয়া",
    eyebrow: "কাস্টমারের কাছ থেকে পাওনা", listHelper: "বাকি ইতিহাস থাকা সব ক্রেতা—বাকি ও সম্পূর্ণ মেটানো দুই ধরনের হিসাব।",
    totalToCollect: "মোট পাওনা", customersWithDue: "বাকি থাকা কাস্টমার", searchLabel: "বাকি ইতিহাস থাকা ক্রেতা খুঁজুন", searchPlaceholder: "কাস্টমারের নাম বা কোড খুঁজুন",
    dueHistoryCustomers: "বাকি ইতিহাস থাকা ক্রেতা", allAccounts: "সব", outstandingAccounts: "বাকি", paidInFullAccounts: "সম্পূর্ণ পরিশোধ", paidInFull: "সম্পূর্ণ পরিশোধ", statusFilter: "বাকি হিসাব ফিল্টার করুন", noAccounts: "এখনও কোনো বাকি ইতিহাস নেই",
    actualPayments: "ক্রেতার পেমেন্ট", returnCredits: "ফেরত ক্রেডিট", paidCredit: "পেমেন্ট / ক্রেডিট", refundPaid: "রিফান্ড দেওয়া",
    lastPayment: "শেষ পেমেন্ট", noPayment: "এখনও কোনো পেমেন্ট লেখা নেই", due: "বাকি", forParty: (action: string, party: string) => `${party}-এর জন্য ${action}`,
    noSearchMatch: "এই খোঁজ বা ফিল্টারে বাকি ইতিহাস থাকা কোনো ক্রেতা মেলেনি", noDues: "এখন কোনো কাস্টমারের বাকি নেই", searchHint: "ক্রেতার নাম/কোড লিখুন বা স্ট্যাটাস ফিল্টার বদলান।", noDuesHint: "পরে পেমেন্টের ব্যালেন্স লেখা হলে, সম্পূর্ণ মেটানোর পরেও ক্রেতা এখানে থাকবে।",
    exportDone: (party: string, format: string, result: string) => `${party}-এর ${format} বাকি স্টেটমেন্ট ${result}`,
    exportError: (format: string, party: string) => `${party}-এর ${format} স্টেটমেন্ট এক্সপোর্ট করা যায়নি।`, shared: "শেয়ার হয়েছে", downloaded: "ডাউনলোড হয়েছে",
    openingBalance: "শুরুর ব্যালেন্স", salesBill: "সেল বিল", paidWithBill: "বিলের সঙ্গে পেমেন্ট পাওয়া", manualDue: "নিজে যোগ করা বাকি", customerPayment: "কাস্টমার পেমেন্ট পাওয়া",
    kinds: { opening_balance: "শুরুর ব্যালেন্স", sale_invoice: "সেল বিল", return_credit: "বিক্রি ফেরতের ক্রেডিট", return_refund: "তাৎক্ষণিক ফেরত রিফান্ড", manual_due: "নিজে যোগ করা বাকি", payment: "পেমেন্ট", balance_adjustment: "ব্যালেন্সে বদল" },
  },
} satisfies Record<Language, object>;

type DueStatementRow = ReturnType<typeof partyDueStatement>["rows"][number];

function localizedDueActivity(row: DueStatementRow, language: Language) {
  const copy = duesScreenCopy[language];
  if (row.kind === "manual_due" && row.reference.startsWith("MKDUES1|"))
    return importedDueActivityLabel(language);
  if (row.activity === "Opening balance") return copy.openingBalance;
  if (row.activity === "Sales bill") return copy.salesBill;
  if (row.activity === "Payment received with bill") return copy.paidWithBill;
  if (row.activity === "Manual due") return copy.manualDue;
  if (row.activity === "Customer payment received") return copy.customerPayment;
  if (row.activity === "Balance adjustment") return copy.kinds.balance_adjustment;
  return row.activity;
}

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
  onBackup,
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
  onBackup: () => void;
  onToast: (message: string) => void;
}) {
  const copy = duesScreenCopy[language];
  const backupCopy = dueBackupCopy(language);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "outstanding" | "paid_in_full">("all");
  const allDueRows = useMemo(
    () => dueCustomerRows(parties, payments, "", invoices, accountEntries, true),
    [parties, payments, invoices, accountEntries],
  );
  const visibleRows = useMemo(() => {
    const searched = dueCustomerRows(parties, payments, query, invoices, accountEntries, true);
    return statusFilter === "all" ? searched : searched.filter((row) => row.status === statusFilter);
  }, [parties, payments, invoices, accountEntries, query, statusFilter]);
  const outstandingCount = allDueRows.filter((row) => row.status === "outstanding").length;
  const settledCount = allDueRows.filter((row) => row.status === "paid_in_full").length;
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
    const formatLabel =
      format === "pdf" ? "PDF" : tr(language, "text", "टेक्स्ट", "টেক্সট");
    try {
      const result =
        format === "pdf"
          ? await downloadDueStatementPdf(statement, business, language)
          : await downloadDueStatementText(statement, business, language);
      onToast(
        copy.exportDone(
          partyStatementLabel(current),
          formatLabel,
          result === "shared" ? copy.shared : copy.downloaded,
        ),
      );
    } catch {
      onToast(copy.exportError(formatLabel, partyStatementLabel(current)));
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
    const settled = statement.remainingDue <= 0;
    return (
      <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
        <button
          onClick={onBack}
          className="mb-3 text-sm font-black text-[#b65d25]"
        >
          ‹ {t(language, "backToDues")}
        </button>
        <div className="due-customer-hero overflow-hidden rounded-3xl bg-[#173f35] text-white shadow-sm" data-status={settled ? "settled" : "outstanding"}>
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {current.codeName && (
                    <span className="rounded-lg bg-[#ffb45f] px-2 py-1 text-[0.5625rem] font-black uppercase text-[#173f35]">
                      {current.codeName}
                    </span>
                  )}
                  <span className="text-[0.625rem] font-semibold text-[#c2d3cc]">
                    {t(language, "customerAccount")}
                  </span>
                </div>
                <h2 className="mt-2 break-words text-2xl font-black">
                  {partyStatementLabel(current)}
                </h2>
                <p className="mt-1 break-words text-[0.625rem] text-[#c5d6d0]">
                  ⌖ {current.address || copy.noAddress}
                </p>
                <p className="mt-1 text-[0.625rem] text-[#c5d6d0]">
                  {current.phone || copy.noPhone}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.5625rem] font-black uppercase tracking-wide text-[#bdd0c8]">
                  {settled ? copy.paidInFull : t(language, "amountToPayNext")}
                </p>
                <strong className="mt-1 block text-2xl text-[#ffb45f]">
                  {settled ? `✓ ${formatMoney(0)}` : formatMoney(statement.remainingDue)}
                </strong>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <button
                type="button"
                onClick={() => onAddDue(current)}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[0.625rem] font-black text-[#014921]"
              >
                ＋ {t(language, "addManualDue")}
              </button>
              <button
                onClick={() => onPayment(current)}
                disabled={statement.remainingDue <= 0}
                className="min-h-12 rounded-xl border border-white/20 bg-[#309d4b] px-2 text-[0.625rem] font-black text-white disabled:opacity-45"
              >
                ₹ {t(language, "paymentReceived")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(current, "pdf")}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[0.625rem] font-black text-[#014921]"
              >
                ↓ {t(language, "exportPdf")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(current, "text")}
                className="min-h-12 rounded-xl border border-white/25 bg-white px-2 text-[0.625rem] font-black text-[#014921]"
              >
                ↓ {t(language, "exportText")}
              </button>
              <button
                type="button"
                disabled={!current.phone || settled}
                onClick={() => {
                  const message = renderMessageTemplate(dueTemplate, { party_name: current.name, party_code: current.codeName, due: formatMoney(statement.remainingDue), shop_name: business.name });
                  const url = `https://wa.me/${current.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
                  void openExternalUrl(url).then((opened) => { if (!opened) window.open(url, "_blank", "noopener,noreferrer"); });
                }}
                className="min-h-12 rounded-xl border border-white/25 bg-[#309d4b] px-2 text-[0.625rem] font-black text-white disabled:opacity-40"
              >
                {copy.reminder}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/10 bg-white/5 text-center sm:grid-cols-6">
            <div className="p-3">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
                {t(language, "dueAdded")}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalDueAdded)}
              </strong>
            </div>
            <div className="border-l border-white/10 p-3">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
                {copy.actualPayments}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalPaid)}
              </strong>
            </div>
            <div className="border-t border-white/10 p-3 sm:border-l sm:border-t-0">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
                {copy.returnCredits}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalReturnCredits)}
              </strong>
            </div>
            <div className="border-l border-t border-white/10 p-3 sm:border-t-0">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
                {copy.refundPaid}
              </span>
              <strong className="mt-1 block text-sm">
                {formatMoney(statement.totalRefunded)}
              </strong>
            </div>
            <div className="border-t border-white/10 p-3 sm:border-l sm:border-t-0">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
                {t(language, "lastPayment")}
              </span>
              <strong className="mt-1 block text-[0.625rem]">
                {lastPayment
                  ? `${formatMoney(lastPayment.amount)} · ${fullInvoiceDate(lastPayment.date, language)}`
                  : t(language, "noPaymentRecorded")}
              </strong>
            </div>
            <div className="border-l border-t border-white/10 p-3 sm:border-t-0">
              <span className="text-[0.5rem] font-black uppercase text-[#b9cbc4]">
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
            <p className="eyebrow">{copy.khata}</p>
            <h3 className="mt-1 text-xl font-black">
              {t(language, "dueStatement")}
            </h3>
            <p className="mt-1 text-[0.6875rem] font-black text-[#335f50]">
              {partyStatementLabel(current)}
            </p>
            <p className="mt-1 text-[0.625rem] text-[#748078]">
              {t(language, "dueStatementHelp")}
            </p>
          </div>
          <span className="shrink-0 text-[0.625rem] font-black text-[#748078]">
            {statement.rows.length} {t(language, "accountEntries")}
          </span>
        </div>
        {lastPayment && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ddd7ca] bg-white p-3">
            <div>
              <span className="field-caption">{t(language, "lastPayment")}</span>
              <strong className="mt-1 block text-xs">
                {fullInvoiceDate(lastPayment.date, language)} · {invoiceRecordedTime(lastPayment.createdAt, language)}
              </strong>
              <p className="mt-1 text-[0.5625rem] text-[#748078]">
                {paymentModeLabel(lastPayment.mode, language)}
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
                <th>{copy.date}</th>
                <th>{t(language, "activity")}</th>
                <th>{t(language, "referenceMode")}</th>
                <th className="amount-column">{t(language, "dueAdded")} (+)</th>
                <th className="amount-column">{copy.paidCredit} (−)</th>
                <th className="amount-column">{copy.refundPaid}</th>
                <th className="amount-column">{t(language, "runningBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{fullInvoiceDate(row.date, language)}</strong>
                    <small>{invoiceRecordedTime(row.timestamp, language)}</small>
                  </td>
                  <td>
                    <strong>{localizedDueActivity(row, language)}</strong>
                    <small>
                      {partyStatementLabel(current)} · {copy.kinds[row.kind]}
                    </small>
                  </td>
                  <td>
                    <strong>{row.reference || "—"}</strong>
                    {row.paymentMode && <small>{paymentModeLabel(row.paymentMode, language)}</small>}
                  </td>
                  <td className="amount-column due-added">
                    {row.dueAdded ? `+${formatMoney(row.dueAdded)}` : "—"}
                  </td>
                  <td className="amount-column payment-received">
                    {row.paymentReceived ? `−${formatMoney(row.paymentReceived)}` : "—"}
                  </td>
                  <td className="amount-column payment-received">
                    {row.refundPaid ? formatMoney(row.refundPaid) : "—"}
                  </td>
                  <td className="amount-column running-balance">
                    {formatMoney(row.runningBalance)}
                  </td>
                </tr>
              ))}
              {!statement.rows.length && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    {t(language, "noPaymentRecorded")}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>{t(language, "totalRemaining")}</th>
                <td className="amount-column">{formatMoney(statement.totalDueAdded)}</td>
                <td className="amount-column">{formatMoney(statement.totalBalanceReductions)}</td>
                <td className="amount-column">{formatMoney(statement.totalRefunded)}</td>
                <td className="amount-column">{formatMoney(statement.remainingDue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="due-statement-total mt-3" data-status={settled ? "settled" : "outstanding"}>
          <div>
            <span>{settled ? `✓ ${copy.paidInFull}` : t(language, "amountToPayNext")}</span>
            <small>{settled ? copy.paidInFull : t(language, "totalRemaining")}</small>
          </div>
          <strong>{formatMoney(statement.remainingDue)}</strong>
        </div>
        {outstandingBills.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-end justify-between">
              <div>
                <h3 className="text-sm font-black">{copy.billsStillDue}</h3>
                <p className="mt-1 text-[0.625rem] text-[#748078]">
                  {copy.billsStillDueHelper}
                </p>
              </div>
              <span className="text-[0.625rem] font-black text-[#748078]">
                {copy.bills(outstandingBills.length)}
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
                      <p className="mt-1 text-[0.5625rem] text-[#7b837f]">
                        {invoice.invoiceNumber} · {fullInvoiceDate(invoice.date, language)} ·{" "}
                        {invoicePaymentLabel(invoice, language)}
                      </p>
                    </div>
                    <strong className="text-sm text-[#b75b2b]">
                      {copy.dueAmount(formatMoney(invoice.amountDue))}
                    </strong>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-[#f4faf0] p-2">
                      <span className="block text-[0.5rem] font-black uppercase text-[#718077]">
                        {copy.billTotal}
                      </span>
                      <strong className="mt-1 block text-[0.625rem]">
                        {formatMoney(invoice.grandTotal)}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-[#eaf4ee] p-2">
                      <span className="block text-[0.5rem] font-black uppercase text-[#567268]">
                        {copy.receivedSoFar}
                      </span>
                      <strong className="mt-1 block text-[0.625rem] text-[#267055]">
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
            {copy.eyebrow}
          </p>
          <h2 className="page-title">{t(language, "dues")}</h2>
          <p className="mt-1 text-[0.6875rem] font-semibold text-[#6f7773]">
            {copy.listHelper}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAddDue()}
          className="min-h-12 shrink-0 rounded-xl bg-[#309d4b] px-3 text-[0.625rem] font-black text-white"
        >
          ＋ {t(language, "addManualDue")}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
        <div className="rounded-2xl bg-[#173f35] p-4 text-white">
          <span className="text-[0.5625rem] font-black uppercase tracking-wide text-[#bdd0c8]">
            {copy.totalToCollect}
          </span>
          <strong className="mt-1 block text-xl text-[#ffb45f]">
            {formatMoney(totalDue)}
          </strong>
        </div>
        <div className="rounded-2xl border border-[#ddd7ca] bg-white p-4">
          <span className="text-[0.5625rem] font-black uppercase tracking-wide text-[#748078]">
            {copy.customersWithDue}
          </span>
          <strong className="mt-1 block text-xl text-[#173f35]">
            {outstandingCount}
          </strong>
        </div>
        <div className="due-paid-metric rounded-2xl border p-4">
          <span className="text-[0.6875rem] font-black text-[#267055]">
            ✓ {copy.paidInFullAccounts}
          </span>
          <strong className="mt-1 block text-xl text-[#267055]">
            {settledCount}
          </strong>
        </div>
      </div>
      <button
        type="button"
        onClick={onBackup}
        className="due-backup-launch mt-3"
      >
        <span aria-hidden="true">⇅</span>
        <span>
          <strong>{backupCopy.title}</strong>
          <small>{backupCopy.helper}</small>
        </span>
        <b aria-hidden="true">›</b>
      </button>
      <div className="due-status-filter mt-4" role="group" aria-label={copy.statusFilter}>
        {([
          ["all", copy.allAccounts, allDueRows.length],
          ["outstanding", copy.outstandingAccounts, outstandingCount],
          ["paid_in_full", copy.paidInFullAccounts, settledCount],
        ] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={statusFilter === value}
            onClick={() => setStatusFilter(value)}
          >
            <span>{label}</span>
            <b>{count}</b>
          </button>
        ))}
      </div>
      <label className="search-box my-4">
        <span aria-hidden="true">⌕</span>
        <input
          aria-label={copy.searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
        />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleRows.map(({ party, lastPayment, status }) => (
          <article
            key={party.id}
            className="due-customer-card rounded-2xl border border-[#ddd7ca] bg-white p-3.5 text-left shadow-sm"
            data-status={status === "paid_in_full" ? "settled" : "outstanding"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block break-words text-sm" title={partyStatementLabel(party)}>
                  {partyStatementLabel(party)}
                </strong>
                <span className="due-customer-status mt-1" data-status={status === "paid_in_full" ? "settled" : "outstanding"}>
                  {status === "paid_in_full" ? `✓ ${copy.paidInFull}` : copy.outstandingAccounts}
                </span>
                <p className="mt-2 text-[0.5625rem] font-black uppercase text-[#898f8b]">
                  {copy.lastPayment}
                </p>
                {lastPayment ? (
                  <p className="mt-1 text-[0.625rem] font-semibold text-[#53635c]">
                    {formatMoney(lastPayment.amount)} ·{" "}
                    {fullInvoiceDate(lastPayment.date, language)}
                  </p>
                ) : (
                  <p className="mt-1 text-[0.625rem] font-semibold text-[#9a6b50]">
                    {copy.noPayment}
                  </p>
                )}
                {lastPayment && (
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-1 text-[0.5rem] font-black ${lastPayment.mode === "cash" ? "bg-[#fff0df] text-[#a95221]" : "bg-[#e6f4ed] text-[#246b50]"}`}
                  >
                    {paymentModeLabel(lastPayment.mode, language)}
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className="text-[0.6875rem] font-black text-[#68756e]">
                  {status === "paid_in_full" ? copy.paidInFull : copy.due}
                </span>
                <strong className="due-customer-card__balance mt-1 block text-base">
                  {formatMoney(party.currentBalance)}
                </strong>
              </div>
            </div>
            <div className="due-list-actions mt-3 grid grid-cols-3 gap-2 border-t border-[#e2e2db] pt-3">
              <button
                type="button"
                onClick={() => onParty(party)}
                className="due-list-action due-list-action-primary"
                aria-label={copy.forParty(t(language, "viewStatement"), partyStatementLabel(party))}
              >
                {t(language, "viewStatement")}
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(party, "pdf")}
                className="due-list-action due-list-action-secondary"
                aria-label={copy.forParty(t(language, "exportPdf"), partyStatementLabel(party))}
              >
                ↓ PDF
              </button>
              <button
                type="button"
                onClick={() => void exportPartyStatement(party, "text")}
                className="due-list-action due-list-action-secondary"
                aria-label={copy.forParty(t(language, "exportText"), partyStatementLabel(party))}
              >
                ↓ {tr(language, "Text", "टेक्स्ट", "টেক্সট")}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!visibleRows.length && (
        <div className="rounded-2xl border-2 border-dashed border-[#d8d1c3] bg-[#f8f5ee] p-8 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm font-black">
            {query || statusFilter !== "all"
              ? copy.noSearchMatch
              : copy.noAccounts}
          </p>
          <p className="mt-1 text-[0.625rem] text-[#748078]">
            {query || statusFilter !== "all"
              ? copy.searchHint
              : copy.noDuesHint}
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
    saving: string;
    saveError: string;
    removeError: string;
    restoreError: string;
    miscellaneous: string;
    paymentModes: Record<ExpensePaymentMode, string>;
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
    saving: "Saving…",
    saveError: "Could not save this expense.",
    removeError: "Could not remove this expense.",
    restoreError: "Could not restore this expense.",
    miscellaneous: "miscellaneous",
    paymentModes: { cash: "Cash", upi: "UPI", bank: "Bank" },
  },
  hi: {
    eyebrow: "दुकान का खर्च",
    helper:
      "चाय, कॉफी, कस्टमर के खाने और दुकान के छोटे खर्च दर्ज करें। हर एंट्री पहले ऑफलाइन सेव होती है।",
    today: "आज",
    month: "इस महीने",
    all: "कुल दर्ज",
    category: "खर्च का प्रकार",
    amount: "रकम",
    date: "खर्च की तारीख",
    description: "खर्च किसलिए था?",
    descriptionPlaceholder: "जैसे कस्टमर के लिए चाय",
    method: "भुगतान का तरीका",
    reference: "रेफरेंस (जरूरी नहीं)",
    referencePlaceholder: "रसीद या UPI रेफरेंस",
    save: "खर्च सेव करें",
    saved: "खर्च ऑफलाइन सेव हुआ",
    history: "खर्च की हिस्ट्री",
    search: "खर्च, प्रकार, तारीख या रेफरेंस खोजें",
    none: "अभी दुकान का कोई खर्च सेव नहीं है।",
    removed: "हाल में हटाए गए",
    restore: "वापस लाएँ",
    entries: "एंट्री",
    formHelper: "चाय, खाना और रोज़ का दुकान खर्च",
    offlineFirst: "पहले ऑफलाइन सेव",
    historyHelper: "नया खर्च पहले · तारीख और पेमेंट का तरीका",
    recorded: "सेव हुआ",
    ref: "रेफरेंस",
    remove: "हटाएँ",
    removeConfirm: "यह खर्च हटाएँ? इसे बाद में वापस लाया जा सकता है।",
    moved: "खर्च रिकवरी लिस्ट में गया",
    restored: "खर्च वापस आ गया",
    saving: "सेव हो रहा है…",
    saveError: "यह खर्च सेव नहीं हो सका।",
    removeError: "यह खर्च हट नहीं सका।",
    restoreError: "यह खर्च वापस नहीं आ सका।",
    miscellaneous: "दुकान का खर्च",
    paymentModes: { cash: "कैश", upi: "UPI", bank: "बैंक" },
  },
  bn: {
    eyebrow: "দোকানের খরচ",
    helper:
      "চা, কফি, কাস্টমারের খাবার ও দোকানের ছোট খরচ লিখুন। প্রতিটি এন্ট্রি আগে অফলাইনে সেভ হয়।",
    today: "আজ",
    month: "এই মাস",
    all: "সব সেভ করা",
    category: "খরচের ধরন",
    amount: "টাকার পরিমাণ",
    date: "খরচের তারিখ",
    description: "কেন খরচ হয়েছে?",
    descriptionPlaceholder: "যেমন কাস্টমারের জন্য চা",
    method: "যেভাবে পেমেন্ট হয়েছে",
    reference: "রেফারেন্স (দরকার নেই)",
    referencePlaceholder: "রসিদ বা UPI রেফারেন্স",
    save: "খরচ সেভ করুন",
    saved: "খরচ অফলাইনে সেভ হয়েছে",
    history: "খরচের হিস্ট্রি",
    search: "বিবরণ, ধরন, তারিখ বা রেফারেন্স খুঁজুন",
    none: "এখনও দোকানের কোনো খরচ সেভ হয়নি।",
    removed: "সম্প্রতি সরানো",
    restore: "ফিরিয়ে আনুন",
    entries: "এন্ট্রি",
    formHelper: "চা, খাবার ও প্রতিদিনের দোকান খরচ",
    offlineFirst: "আগে অফলাইনে সেভ",
    historyHelper: "নতুন খরচ আগে · তারিখ ও পেমেন্টের মাধ্যম",
    recorded: "সেভ হয়েছে",
    ref: "রেফারেন্স",
    remove: "সরান",
    removeConfirm: "এই খরচ সরাবেন? পরে ফিরিয়ে আনা যাবে।",
    moved: "খরচ রিকভারি লিস্টে গেছে",
    restored: "খরচ ফিরিয়ে আনা হয়েছে",
    saving: "সেভ হচ্ছে…",
    saveError: "এই খরচ সেভ করা যায়নি।",
    removeError: "এই খরচ সরানো যায়নি।",
    restoreError: "এই খরচ ফিরিয়ে আনা যায়নি।",
    miscellaneous: "দোকানের খরচ",
    paymentModes: { cash: "ক্যাশ", upi: "UPI", bank: "ব্যাংক" },
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
    customer_food: "कस्टमर का खाना",
    shop_supplies: "दुकान का सामान",
    transport: "लोकल ट्रांसपोर्ट",
    other: "बाकी",
  },
  bn: {
    refreshments: "চা ও কফি",
    customer_food: "কাস্টমারের খাবার",
    shop_supplies: "দোকানের জিনিস",
    transport: "লোকাল ট্রান্সপোর্ট",
    other: "অন্যান্য",
  },
};

const localizedExpenseDescription = (expense: Expense, language: Language) =>
  !expense.description || expense.description === expenseCategoryLabels[expense.category]
    ? expenseCategoryCopy[language][expense.category]
    : expense.description;

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
        description: description || expenseCategoryCopy[language][category],
        paymentMode,
        reference,
      });
      setAmount(0);
      setDescription("");
      setReference("");
      await onChanged(copy.saved);
    } catch {
      setError(copy.saveError);
    } finally {
      setSaving(false);
    }
  }
  async function remove(expense: Expense) {
    if (
      !confirm(
        `${copy.removeConfirm}\n${localizedExpenseDescription(expense, language)} · ${formatMoney(expense.amount)}`,
      )
    )
      return;
    try {
      await removeExpense(expense.id);
      await onChanged(copy.moved);
    } catch {
      setError(copy.removeError);
    }
  }
  async function restore(expense: Expense) {
    try {
      await restoreExpense(expense.id);
      await onChanged(copy.restored);
    } catch {
      setError(copy.restoreError);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-3 py-4 md:px-7 md:py-6">
      <div>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 className="page-title">{t(language, "miscellaneous")}</h2>
        <p className="mt-1 max-w-2xl text-[0.6875rem] font-semibold leading-5 text-[#6f7773]">
          {copy.helper}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DashboardMetric
          icon="↘"
          label={copy.today}
          value={`−${formatMoney(todayTotal)}`}
          note={`${active.filter((expense) => expense.date === localDate()).length} ${copy.entries}`}
          tone="orange"
          valueTone="out"
        />
        <DashboardMetric
          icon="◫"
          label={copy.month}
          value={`−${formatMoney(monthTotal)}`}
          note={`${active.filter((expense) => expense.date.startsWith(month)).length} ${copy.entries}`}
          tone="green"
          valueTone="out"
        />
        <DashboardMetric
          icon="Σ"
          label={copy.all}
          value={`−${formatMoney(allTotal)}`}
          note={`${active.length} ${copy.entries}`}
          tone="gold"
          valueTone="out"
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
                  className={`min-h-14 rounded-xl border px-2 text-[0.625rem] font-black ${category === option ? "border-[#014921] bg-[#e8f3e9] text-[#014921]" : "border-[#ddd8ce] bg-white text-[#68746e]"}`}
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
                    title: `${copy.amount} · ${copy.miscellaneous}`,
                    value: amount,
                    decimal: true,
                    apply: setAmount,
                  })
                }
                className="flex min-h-14 w-full items-center justify-between rounded-xl border-2 border-[#efb17f] bg-[#fff8ef] px-3 text-left"
              >
                <span className="text-[0.625rem] font-black text-[#9a6a49]">₹</span>
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
                className={`min-h-11 rounded-xl border text-[0.625rem] font-black uppercase ${paymentMode === mode ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d4c9] bg-white"}`}
              >
                {copy.paymentModes[mode]}
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
              className="mt-3 rounded-xl bg-[#fff0e8] p-3 text-[0.625rem] font-bold text-[#a9502b]"
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
            {saving ? copy.saving : `＋ ${copy.save}`}
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
              <span aria-hidden="true" className="text-[#66736d]">⌕</span>
              <input
                aria-label={copy.search}
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
                    <span className="rounded-full bg-[#fff0df] px-2 py-1 text-[0.5rem] font-black text-[#a95221]">
                      {expenseCategoryCopy[language][expense.category]}
                    </span>
                    <span className="rounded-full bg-[#e7f3ec] px-2 py-1 text-[0.5rem] font-black uppercase text-[#25684f]">
                      {copy.paymentModes[expense.paymentMode]}
                    </span>
                  </div>
                  <strong className="mt-2 block text-sm">
                    {localizedExpenseDescription(expense, language)}
                  </strong>
                  <p className="mt-1 text-[0.625rem] font-semibold text-[#65716b]">
                    {fullInvoiceDate(expense.date, language)} · {copy.recorded}{" "}
                    {invoiceRecordedTime(expense.createdAt, language)}
                  </p>
                  {expense.reference && (
                    <p className="mt-1 text-[0.5625rem] text-[#7c8580]">
                      {copy.ref}: {expense.reference}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <strong className="report-money-out text-base">
                    −{formatMoney(expense.amount)}
                  </strong>
                  <button
                    type="button"
                    onClick={() => void remove(expense)}
                    className="mt-2 block min-h-9 rounded-lg border border-[#e2c6b9] bg-white px-3 text-[0.5625rem] font-black text-[#9e4d2d]"
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
              <h4 className="text-[0.625rem] font-black uppercase tracking-wide text-[#737d78]">
                {copy.removed}
              </h4>
              <div className="mt-2 space-y-2">
                {removed.map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white p-3"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-[0.625rem]">
                        {localizedExpenseDescription(expense, language)}
                      </strong>
                      <p className="mt-1 text-[0.5625rem] text-[#7a837e]">
                        {formatMoney(expense.amount)} ·{" "}
                        {fullInvoiceDate(expense.date, language)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restore(expense)}
                      className="min-h-9 rounded-lg bg-[#e7f3ec] px-3 text-[0.5625rem] font-black text-[#25684f]"
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
    allRecordedDates: string;
    firstRecord: string;
    rangeTo: string;
    exportPdfDone: string;
    exportTextDone: string;
    exportPdfError: string;
    exportTextError: string;
    paymentFrom: (name: string) => string;
    paymentTo: (name: string) => string;
    billAllocations: (count: number) => string;
    accountPayment: string;
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
    allRecordedDates: "All recorded dates",
    firstRecord: "First record",
    rangeTo: "to",
    exportPdfDone: "PDF cash-flow report exported",
    exportTextDone: "Text cash-flow report exported",
    exportPdfError: "Could not export the PDF report.",
    exportTextError: "Could not export the text report.",
    paymentFrom: (name: string) => `Payment from ${name}`,
    paymentTo: (name: string) => `Payment to ${name}`,
    billAllocations: (count: number) =>
      `${count} bill allocation${count === 1 ? "" : "s"}`,
    accountPayment: "Account payment",
  },
  hi: {
    title: "पैसा आया · पैसा गया",
    helper:
      "जो पैसा सच में मिला या दिया गया। उधार बिक्री अलग दिखती है और बाद का पेमेंट सिर्फ एक बार गिना जाता है।",
    period: "एक्सपोर्ट की तारीखें",
    from: "शुरू की तारीख",
    to: "आखिरी तारीख",
    today: "आज",
    seven: "7 दिन",
    thirty: "30 दिन",
    month: "यह महीना",
    all: "सभी तारीखें",
    calculation: "पूरा कैश हिसाब",
    receivedBills: "बिल के साथ मिली रकम",
    customerPayments: "बाद में मिले कस्टमर पेमेंट",
    supplierPaid: "सप्लायर को पेमेंट",
    misc: "दुकान के खर्च",
    salesBilled: "बिल की कुल बिक्री",
    supplierBills: "सेव किए सप्लायर बिल",
    customerDue: "कस्टमर से लेना है",
    supplierDue: "सप्लायर को देना है",
    movements: "कैश की पूरी डिटेल",
    movementHelper: "चुनी तारीखों में मिली और दी गई हर रकम",
    noMovement: "इन तारीखों में कोई पैसा आया या गया नहीं।",
    actualReceipts: "वाकई मिली रकम",
    actualPayments: "वाकई दी गई रकम",
    netHelper: "आया पैसा घटा गया पैसा",
    separated: "बिल की रकम और असल कैश अलग रखे गए हैं",
    paidPurchases: "खरीद के साथ भुगतान",
    entries: "एंट्री",
    dateHeader: "तारीख",
    directionHeader: "आया / गया",
    typeHeader: "टाइप",
    detailsHeader: "डिटेल",
    modeHeader: "तरीका",
    amountHeader: "रकम",
    newest: "नई 100 एंट्री दिखाई गई हैं। PDF और टेक्स्ट में सभी शामिल हैं",
    allRecordedDates: "सभी सेव तारीखें",
    firstRecord: "पहली एंट्री",
    rangeTo: "से",
    exportPdfDone: "PDF कैश-फ्लो रिपोर्ट एक्सपोर्ट हो गई",
    exportTextDone: "टेक्स्ट कैश-फ्लो रिपोर्ट एक्सपोर्ट हो गई",
    exportPdfError: "PDF रिपोर्ट एक्सपोर्ट नहीं हो सकी।",
    exportTextError: "टेक्स्ट रिपोर्ट एक्सपोर्ट नहीं हो सकी।",
    paymentFrom: (name: string) => `${name} से पेमेंट`,
    paymentTo: (name: string) => `${name} को पेमेंट`,
    billAllocations: (count: number) => `${count} बिल में लगाया गया`,
    accountPayment: "खाते का पेमेंट",
  },
  bn: {
    title: "টাকা এসেছে · টাকা গেছে",
    helper:
      "যে টাকা সত্যি পাওয়া বা দেওয়া হয়েছে। বাকির বিক্রি আলাদা দেখা যায় এবং পরের পেমেন্ট একবারই ধরা হয়।",
    period: "এক্সপোর্টের তারিখ",
    from: "শুরুর তারিখ",
    to: "শেষ তারিখ",
    today: "আজ",
    seven: "7 দিন",
    thirty: "30 দিন",
    month: "এই মাস",
    all: "সব তারিখ",
    calculation: "পুরো ক্যাশ হিসাব",
    receivedBills: "বিলের সঙ্গে পাওয়া",
    customerPayments: "পরে পাওয়া ক্রেতার পেমেন্ট",
    supplierPaid: "সাপ্লায়ারকে পেমেন্ট",
    misc: "দোকানের খরচ",
    salesBilled: "মোট বিল করা বিক্রি",
    supplierBills: "সেভ করা সাপ্লায়ার বিল",
    customerDue: "কাস্টমারের কাছ থেকে পাওনা",
    supplierDue: "সাপ্লায়ারকে দেনা",
    movements: "ক্যাশের পুরো ডিটেল",
    movementHelper: "বাছা তারিখে পাওয়া ও দেওয়া প্রতিটি টাকা",
    noMovement: "এই তারিখে কোনো টাকা আসেনি বা যায়নি।",
    actualReceipts: "আসল পাওয়া টাকা",
    actualPayments: "আসল দেওয়া টাকা",
    netHelper: "আসা টাকা থেকে যাওয়া টাকা বাদ",
    separated: "বিলের অঙ্ক ও আসল ক্যাশ আলাদা রাখা হয়েছে",
    paidPurchases: "কেনার সঙ্গে পেমেন্ট",
    entries: "এন্ট্রি",
    dateHeader: "তারিখ",
    directionHeader: "এসেছে / গেছে",
    typeHeader: "ধরন",
    detailsHeader: "বিবরণ",
    modeHeader: "মাধ্যম",
    amountHeader: "টাকার পরিমাণ",
    newest: "নতুন 100টি এন্ট্রি দেখানো হয়েছে। PDF ও টেক্সটে সবগুলো থাকবে",
    allRecordedDates: "সেভ করা সব তারিখ",
    firstRecord: "প্রথম এন্ট্রি",
    rangeTo: "থেকে",
    exportPdfDone: "PDF ক্যাশ-ফ্লো রিপোর্ট এক্সপোর্ট হয়েছে",
    exportTextDone: "টেক্সট ক্যাশ-ফ্লো রিপোর্ট এক্সপোর্ট হয়েছে",
    exportPdfError: "PDF রিপোর্ট এক্সপোর্ট করা যায়নি।",
    exportTextError: "টেক্সট রিপোর্ট এক্সপোর্ট করা যায়নি।",
    paymentFrom: (name: string) => `${name}-এর কাছ থেকে পেমেন্ট`,
    paymentTo: (name: string) => `${name}-কে পেমেন্ট`,
    billAllocations: (count: number) => `${count}টি বিলে ধরা হয়েছে`,
    accountPayment: "খাতার পেমেন্ট",
  },
};

function localizedCashFlowDateRange(
  fromDate: string,
  toDate: string,
  language: Language,
) {
  if (language === "en") return dateRangeLabel(fromDate, toDate);
  const copy = cashFlowCopy[language];
  if (!fromDate && !toDate) return copy.allRecordedDates;
  const pretty = (value: string) =>
    value ? formatLocalizedDate(value, language) : copy.firstRecord;
  if (fromDate && fromDate === toDate) return pretty(fromDate);
  return `${pretty(fromDate)} ${copy.rangeTo} ${toDate ? pretty(toDate) : copy.today}`;
}

const localizedPaymentModeName = (mode: string, language: Language) => {
  if (mode === "cash") return tr(language, "Cash", "कैश", "ক্যাশ");
  if (mode === "upi") return "UPI";
  if (mode === "bank") return tr(language, "Bank", "बैंक", "ব্যাংক");
  if (mode === "cheque") return tr(language, "Cheque", "चेक", "চেক");
  if (mode === "credit") return tr(language, "Credit", "उधार", "বাকি");
  if (mode === "mixed") return tr(language, "Mixed", "मिक्स", "মিক্সড");
  return mode;
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
    purchase_return: "खरीद रिटर्न",
    customer_payment: "कस्टमर पेमेंट",
    supplier_payment: "सप्लायर पेमेंट",
    misc_expense: "दुकान का खर्च",
  },
  bn: {
    sale: "বিক্রি",
    purchase: "কেনা",
    sale_return: "বিক্রি ফেরত",
    purchase_return: "কেনা রিটার্ন",
    customer_payment: "কাস্টমার পেমেন্ট",
    supplier_payment: "সাপ্লায়ার পেমেন্ট",
    misc_expense: "দোকানের খরচ",
  },
};

function CashFlowPanel({
  invoices,
  payments,
  parties,
  accountEntries,
  expenses,
  fromDate,
  toDate,
  onRangeChange,
  business,
  language,
  onToast,
}: {
  invoices: Invoice[];
  payments: Payment[];
  parties: Party[];
  accountEntries: AccountEntry[];
  expenses: Expense[];
  fromDate: string;
  toDate: string;
  onRangeChange: (fromDate: string, toDate: string) => void;
  business: BusinessSettings;
  language: Language;
  onToast: (message: string) => void;
}) {
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
  const changeFrom = (value: string) => {
    onRangeChange(value, value && toDate && value > toDate ? value : toDate);
  };
  const changeTo = (value: string) => {
    onRangeChange(value && fromDate && value < fromDate ? value : fromDate, value);
  };
  async function exportPdf() {
    try {
      await downloadCashFlowPdf(report, business, language);
      onToast(copy.exportPdfDone);
    } catch {
      onToast(copy.exportPdfError);
    }
  }
  async function exportText() {
    try {
      await downloadCashFlowText(report, business, language);
      onToast(copy.exportTextDone);
    } catch {
      onToast(copy.exportTextError);
    }
  }
  const movementType = (source: string) =>
    movementTypeCopy[language][source] || source;
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const movementDisplay = (movement: (typeof report.movements)[number]) => {
    if (movement.invoiceId) {
      const invoice = invoiceById.get(movement.invoiceId);
      return {
        title: invoice
          ? `${movementType(movement.source)} ${invoice.invoiceNumber}`
          : movementType(movement.source),
        details: invoice
          ? localizedInvoicePartyName(language, invoice)
          : movement.details,
      };
    }
    if (movement.paymentId) {
      const payment = paymentById.get(movement.paymentId);
      const party = payment ? partyById.get(payment.partyId) : undefined;
      return {
        title: party
          ? party.type === "customer"
            ? copy.paymentFrom(party.name)
            : copy.paymentTo(party.name)
          : movementType(movement.source),
        details:
          payment?.reference ||
          (payment?.allocatedTo.length
            ? copy.billAllocations(payment.allocatedTo.length)
            : copy.accountPayment),
      };
    }
    if (movement.expenseId) {
      const expense = expenseById.get(movement.expenseId);
      return {
        title: expense
          ? localizedExpenseDescription(expense, language)
          : movementType(movement.source),
        details: expense
          ? `${expenseCategoryCopy[language][expense.category]}${expense.reference ? ` · ${expense.reference}` : ""}`
          : movement.details,
      };
    }
    return { title: movementType(movement.source), details: movement.details };
  };

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
                <p className="mt-1 text-[0.625rem] font-semibold leading-4 text-[#6f7974]">
                  {copy.helper}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportPdf()}
              className="min-h-11 rounded-xl bg-[#014921] px-4 text-[0.625rem] font-black text-white"
            >
              ↓ {t(language, "exportPdf")}
            </button>
            <button
              type="button"
              onClick={exportText}
              className="min-h-11 rounded-xl border border-[#8fbd9f] bg-white px-4 text-[0.625rem] font-black text-[#014921]"
            >
              ↓ {t(language, "exportText")}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-[#f7f5ef] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.5625rem] font-black uppercase tracking-[.13em] text-[#7a837e]">
              {copy.period} · {localizedCashFlowDateRange(fromDate, toDate, language)}
            </p>
          </div>
          <div className="report-date-grid mt-3">
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
        <div
          className="report-flow-comparison"
          role="img"
          aria-label={`${copy.actualReceipts}: ${formatMoney(report.moneyIn)}. ${copy.actualPayments}: ${formatMoney(report.moneyOut)}.`}
        >
          {([
            ["in", copy.actualReceipts, report.moneyIn],
            ["out", copy.actualPayments, report.moneyOut],
          ] as const).map(([direction, label, amount]) => {
            const largest = Math.max(report.moneyIn, report.moneyOut, 1);
            return (
              <div key={direction} className="report-flow-comparison__row">
                <div>
                  <span>{direction === "in" ? "+" : "−"} {label}</span>
                  <strong className={direction === "in" ? "report-money-in" : "report-money-out"}>
                    {formatMoney(amount)}
                  </strong>
                </div>
                <div className="report-flow-comparison__track" aria-hidden="true">
                  <span
                    data-direction={direction}
                    style={{ width: `${(amount / largest) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-2xl border border-[#ddd9cf] bg-[#fbfaf6] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-black">{copy.calculation}</h4>
              <p className="mt-1 text-[0.5625rem] text-[#78817d]">{copy.separated}</p>
            </div>
            <span className="dashboard-chip">
              {localizedCashFlowDateRange(fromDate, toDate, language)}
            </span>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-2 text-[0.625rem] sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <span>{copy.salesBilled}</span>
              <strong>{formatMoney(report.salesBilled)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span>{copy.supplierBills}</span>
              <strong>{formatMoney(report.supplierBillsRecorded)}</strong>
            </div>
            <div className="report-calculation-row report-money-in">
              <span>{copy.receivedBills}</span>
              <strong>+{formatMoney(report.receivedWithBills)}</strong>
            </div>
            <div className="report-calculation-row report-money-out">
              <span>{copy.paidPurchases}</span>
              <strong>−{formatMoney(report.paidWithPurchases)}</strong>
            </div>
            <div className="report-calculation-row report-money-in">
              <span>{copy.customerPayments}</span>
              <strong>+{formatMoney(report.customerPayments)}</strong>
            </div>
            <div className="report-calculation-row report-money-out">
              <span>{copy.supplierPaid}</span>
              <strong>−{formatMoney(report.supplierPayments)}</strong>
            </div>
            <div className="report-calculation-row report-money-due">
              <span>{copy.customerDue}</span>
              <strong>{formatMoney(report.customerOutstanding)}</strong>
            </div>
            <div className="report-calculation-row report-money-out">
              <span>{copy.supplierDue}</span>
              <strong>{formatMoney(report.supplierOutstanding)}</strong>
            </div>
            <div className="report-calculation-row report-money-out sm:col-span-2">
              <span>{copy.misc}</span>
              <strong>−{formatMoney(report.miscellaneousExpenses)}</strong>
            </div>
          </div>
          {report.expenseBreakdown.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#e4e0d6] pt-3">
              {report.expenseBreakdown.map((row) => (
                <span
                  key={row.category}
                  className="report-expense-chip"
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
              <p className="mt-1 text-[0.5625rem] text-[#78817d]">
                {copy.movementHelper}
              </p>
            </div>
            <span className="dashboard-chip">
              {report.movements.length} {copy.entries}
            </span>
          </div>
          <div className="report-table-scroller" role="region" aria-label={copy.movements} tabIndex={0}>
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
                {visibleMovements.map((movement) => {
                  const display = movementDisplay(movement);
                  return <tr key={movement.id}>
                    <td>{fullInvoiceDate(movement.date, language)}</td>
                    <td>
                      <span
                        className={`report-movement-direction report-movement-direction--${movement.direction}`}
                      >
                        {movement.direction === "in"
                          ? t(language, "moneyIn")
                          : t(language, "moneyOut")}
                      </span>
                    </td>
                    <td>{movementType(movement.source)}</td>
                    <td>
                      <strong className="block text-[0.625rem]">
                        {display.title}
                      </strong>
                      <span className="text-[0.5rem] text-[#7d8581]">
                        {display.details}
                      </span>
                    </td>
                    <td>{localizedPaymentModeName(movement.mode, language)}</td>
                    <td
                      className={`text-right font-black ${movement.direction === "in" ? "report-money-in" : "report-money-out"}`}
                    >
                      {movement.direction === "in" ? "+" : "−"}
                      {formatMoney(movement.amount)}
                    </td>
                  </tr>;
                })}
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
            <p className="border-t border-[#e7e3da] bg-[#f8f6f1] p-3 text-center text-[0.5625rem] font-semibold text-[#707a75]">
              {language === "hi"
                ? `नई 100 एंट्री दिखाई गई हैं। PDF और टेक्स्ट एक्सपोर्ट में सभी ${report.movements.length} एंट्री हैं।`
                : language === "bn"
                  ? `নতুন 100টি এন্ট্রি দেখানো হয়েছে। PDF ও টেক্সট এক্সপোর্টে সব ${report.movements.length}টি এন্ট্রি আছে।`
                  : `Showing the newest 100 entries. PDF and text exports include all ${report.movements.length} entries.`}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

const reportsDashboardCopy = {
  en: {
    periods: { "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" },
    periodControl: "Report period",
    breadcrumb: "Business dashboard", title: "Business dashboard", helper: "See actual money in, money out, sales collection and current dues in one place.", newBill: "New bill",
    financialSnapshot: "Financial snapshot", financialSnapshotHelper: (period: string) => `Actual recorded receipts and payments · ${period}`,
    moneyReceived: "Money in", moneyReceivedNote: "Actually received in this period", moneySpent: "Money out", moneySpentNote: "Actually paid or spent in this period",
    netMovement: "Net cash flow", netPositive: "More came in than went out", netNegative: "More went out than came in", netNotProfit: "Cash movement · not profit",
    dueToCollect: "Customer due", dueCurrentNote: "Current balance · all dates", supplierPayableNote: (amount: string) => `Supplier payables ${amount}`,
    grossSales: "Gross sales", grossSalesNote: (count: number, period: string) => `${count} bills · before returns · ${period}`,
    grossToday: "Gross today", grossTodayNote: "Bills recorded today · before returns", outstanding: "Outstanding", outstandingNote: "Total customer credit",
    estimatedProfit: "Est. gross profit", bills: "Bills", costMissing: "Cost missing", missingCostNote: "Add purchase costs for every sold item", ownerProfitNote: "Owner-only · before expenses", recordedIn: (period: string) => `Recorded in ${period}`,
    counterControl: "Counter control", closingOwnerOnly: "Daily closing is owner-only", closingHelper: "Unlock Owner Mode to count the drawer or replace a saved closing record.", unlockClosing: "Unlock daily closing",
    settlement: "Sales collection status", settlementHelper: (period: string) => `How sales billed in ${period} stand today`, billCount: (count: number) => `${count} bills`, totalSales: "Total sales", noSales: "No sales in this period yet.",
    collected: "Collected", stillDue: "Still due", collectionRate: "collected", paymentBreakdown: "Collected by payment method", shareOfSales: "of sales", noCollections: "No collections recorded yet.",
    settlementChartLabel: (total: string, collected: string, due: string, percent: number) => `Sales collection status. ${percent}% collected. Total sales ${total}, collected ${collected}, still due ${due}.`,
    recentInvoices: "Recent invoices", recentHelper: "Open a bill to see that customer's full history", live: "Live", recentTable: "Recent invoices table",
    invoice: "Invoice", party: "Party", date: "Date", mode: "Mode", total: "Total", due: "Due", openInvoice: (number: string, party: string) => `Open invoice ${number} for ${party}`, noSavedBills: "Your saved bills will appear here.",
    noAddress: "No address", noPhone: "No phone", noCustomerAccount: "No customer account", walkInSale: "Walk-in sale", noCustomer: "No matching customer.",
    trend: "Gross sales trend", trendHelper: (period: string) => `Up to seven equal intervals · ${period}`, trendLabel: "Gross sales before returns trend chart",
    outstandingByParty: "Outstanding by party", outstandingHelper: "Current all-date balances · open a customer to see every bill", topFive: "Top 5", noOutstanding: "No outstanding balances.",
    topProducts: "Top products", byRevenue: "By billed revenue", byActivity: "By recorded catalogue activity", sales: (count: number) => `${count} sales`, other: "Other",
  },
  hi: {
    periods: { "7d": "7 दिन", "30d": "30 दिन", "90d": "90 दिन", all: "अब तक" },
    periodControl: "रिपोर्ट की अवधि",
    breadcrumb: "बिज़नेस डैशबोर्ड", title: "बिज़नेस डैशबोर्ड", helper: "आया पैसा, गया पैसा, बिक्री की वसूली और अभी का बाकी एक जगह देखें।", newBill: "नया बिल",
    financialSnapshot: "पैसे का सार", financialSnapshotHelper: (period: string) => `वास्तव में मिला और दिया गया पैसा · ${period}`,
    moneyReceived: "पैसा आया", moneyReceivedNote: "इस अवधि में वास्तव में मिला", moneySpent: "पैसा गया", moneySpentNote: "इस अवधि में वास्तव में दिया या खर्च किया",
    netMovement: "शुद्ध कैश फ्लो", netPositive: "गए पैसे से ज्यादा पैसा आया", netNegative: "आए पैसे से ज्यादा पैसा गया", netNotProfit: "कैश की चाल · मुनाफ़ा नहीं",
    dueToCollect: "कस्टमर से लेना है", dueCurrentNote: "अभी का बैलेंस · सभी तारीखें", supplierPayableNote: (amount: string) => `सप्लायर को देना है ${amount}`,
    grossSales: "कुल बिक्री", grossSalesNote: (count: number, period: string) => `${count} बिल · रिटर्न से पहले · ${period}`,
    grossToday: "आज की कुल बिक्री", grossTodayNote: "आज सेव बिल · रिटर्न से पहले", outstanding: "कुल बाकी", outstandingNote: "कस्टमर का कुल उधार",
    estimatedProfit: "अनुमानित ग्रॉस मुनाफ़ा", bills: "बिल", costMissing: "खरीद रेट नहीं है", missingCostNote: "बेचे गए हर सामान का खरीद रेट जोड़ें", ownerProfitNote: "सिर्फ मालिक · खर्च से पहले", recordedIn: (period: string) => `${period} में दर्ज`,
    counterControl: "काउंटर कंट्रोल", closingOwnerOnly: "डेली क्लोज़िंग सिर्फ मालिक के लिए है", closingHelper: "दराज़ का कैश गिनने या सेव क्लोज़िंग बदलने के लिए Owner Mode खोलें।", unlockClosing: "डेली क्लोज़िंग खोलें",
    settlement: "बिक्री की वसूली", settlementHelper: (period: string) => `${period} में बने बिलों में आज कितना मिला और बाकी है`, billCount: (count: number) => `${count} बिल`, totalSales: "कुल बिक्री", noSales: "इस समय में कोई बिक्री नहीं है।",
    collected: "मिल चुका", stillDue: "अभी बाकी", collectionRate: "वसूला", paymentBreakdown: "पेमेंट के तरीके से मिली रकम", shareOfSales: "बिक्री का", noCollections: "अभी कोई रकम दर्ज नहीं है।",
    settlementChartLabel: (total: string, collected: string, due: string, percent: number) => `बिक्री की वसूली। ${percent}% मिला। कुल बिक्री ${total}, मिला ${collected}, बाकी ${due}।`,
    recentInvoices: "हाल के बिल", recentHelper: "पूरा कस्टमर हिस्ट्री देखने के लिए बिल खोलें", live: "लाइव", recentTable: "हाल के बिलों की टेबल",
    invoice: "बिल", party: "पार्टी", date: "तारीख", mode: "तरीका", total: "कुल", due: "बाकी", openInvoice: (number: string, party: string) => `${party} का बिल ${number} खोलें`, noSavedBills: "सेव किए बिल यहाँ दिखेंगे।",
    noAddress: "पता नहीं है", noPhone: "फोन नहीं है", noCustomerAccount: "कस्टमर खाता नहीं", walkInSale: "काउंटर बिक्री", noCustomer: "कोई मिलता कस्टमर नहीं मिला।",
    trend: "कुल बिक्री का ट्रेंड", trendHelper: (period: string) => `अधिकतम 7 बराबर हिस्से · ${period}`, trendLabel: "रिटर्न से पहले की कुल बिक्री का ट्रेंड चार्ट",
    outstandingByParty: "पार्टी के हिसाब से बाकी", outstandingHelper: "आज का सभी तारीखों का बैलेंस · सभी बिल देखने के लिए कस्टमर खोलें", topFive: "टॉप 5", noOutstanding: "कोई बाकी बैलेंस नहीं है।",
    topProducts: "सबसे ज्यादा बिके सामान", byRevenue: "बिल की बिक्री के हिसाब से", byActivity: "कैटलॉग में दर्ज बिक्री के हिसाब से", sales: (count: number) => `${count} बिक्री`, other: "बाकी",
  },
  bn: {
    periods: { "7d": "7 দিন", "30d": "30 দিন", "90d": "90 দিন", all: "এখনও পর্যন্ত" },
    periodControl: "রিপোর্টের সময়কাল",
    breadcrumb: "বিজনেস ড্যাশবোর্ড", title: "বিজনেস ড্যাশবোর্ড", helper: "আসা টাকা, যাওয়া টাকা, বিক্রির আদায় ও এখনকার বাকি এক জায়গায় দেখুন।", newBill: "নতুন বিল",
    financialSnapshot: "টাকার সারাংশ", financialSnapshotHelper: (period: string) => `সত্যি পাওয়া ও দেওয়া টাকা · ${period}`,
    moneyReceived: "টাকা এসেছে", moneyReceivedNote: "এই সময়ে সত্যি পাওয়া", moneySpent: "টাকা গেছে", moneySpentNote: "এই সময়ে সত্যি দেওয়া বা খরচ করা",
    netMovement: "নিট ক্যাশ ফ্লো", netPositive: "যাওয়া টাকার চেয়ে বেশি এসেছে", netNegative: "আসা টাকার চেয়ে বেশি গেছে", netNotProfit: "ক্যাশের চলাচল · লাভ নয়",
    dueToCollect: "কাস্টমারের কাছ থেকে পাওনা", dueCurrentNote: "এখনকার ব্যালেন্স · সব তারিখ", supplierPayableNote: (amount: string) => `সাপ্লায়ারকে দিতে হবে ${amount}`,
    grossSales: "মোট বিক্রি", grossSalesNote: (count: number, period: string) => `${count}টি বিল · রিটার্নের আগে · ${period}`,
    grossToday: "আজকের মোট বিক্রি", grossTodayNote: "আজ সেভ করা বিল · রিটার্নের আগে", outstanding: "মোট বাকি", outstandingNote: "কাস্টমারের মোট বাকি",
    estimatedProfit: "আনুমানিক গ্রস লাভ", bills: "বিল", costMissing: "কেনা দাম নেই", missingCostNote: "বিক্রি হওয়া প্রতিটি পণ্যের কেনা দাম যোগ করুন", ownerProfitNote: "শুধু মালিক · খরচের আগে", recordedIn: (period: string) => `${period}-এ লেখা`,
    counterControl: "কাউন্টার কন্ট্রোল", closingOwnerOnly: "ডেইলি ক্লোজিং শুধু মালিকের জন্য", closingHelper: "ড্রয়ারের ক্যাশ গুনতে বা সেভ করা ক্লোজিং বদলাতে Owner Mode খুলুন।", unlockClosing: "ডেইলি ক্লোজিং খুলুন",
    settlement: "বিক্রির টাকা আদায়", settlementHelper: (period: string) => `${period}-এ করা বিলের কতটা আজ পাওয়া ও বাকি`, billCount: (count: number) => `${count}টি বিল`, totalSales: "মোট বিক্রি", noSales: "এই সময়ে কোনো বিক্রি নেই।",
    collected: "পাওয়া হয়েছে", stillDue: "এখনও বাকি", collectionRate: "পাওয়া", paymentBreakdown: "পেমেন্ট মাধ্যম অনুযায়ী পাওয়া", shareOfSales: "বিক্রির", noCollections: "এখনও কোনো টাকা পাওয়া লেখা নেই।",
    settlementChartLabel: (total: string, collected: string, due: string, percent: number) => `বিক্রির টাকা আদায়। ${percent}% পাওয়া। মোট বিক্রি ${total}, পাওয়া ${collected}, বাকি ${due}।`,
    recentInvoices: "সাম্প্রতিক বিল", recentHelper: "কাস্টমারের পুরো হিস্ট্রি দেখতে বিল খুলুন", live: "লাইভ", recentTable: "সাম্প্রতিক বিলের টেবিল",
    invoice: "বিল", party: "পার্টি", date: "তারিখ", mode: "মাধ্যম", total: "মোট", due: "বাকি", openInvoice: (number: string, party: string) => `${party}-এর বিল ${number} খুলুন`, noSavedBills: "সেভ করা বিল এখানে দেখা যাবে।",
    noAddress: "ঠিকানা নেই", noPhone: "ফোন নেই", noCustomerAccount: "কাস্টমার খাতা নেই", walkInSale: "কাউন্টার বিক্রি", noCustomer: "মিলছে এমন কাস্টমার পাওয়া যায়নি।",
    trend: "মোট বিক্রির ট্রেন্ড", trendHelper: (period: string) => `সর্বোচ্চ 7টি সমান ভাগ · ${period}`, trendLabel: "রিটার্নের আগের মোট বিক্রির ট্রেন্ড চার্ট",
    outstandingByParty: "পার্টি অনুযায়ী বাকি", outstandingHelper: "আজকের সব তারিখের ব্যালেন্স · সব বিল দেখতে কাস্টমার খুলুন", topFive: "টপ 5", noOutstanding: "কোনো বাকি ব্যালেন্স নেই।",
    topProducts: "সবচেয়ে বেশি বিক্রি হওয়া পণ্য", byRevenue: "বিলের বিক্রি অনুযায়ী", byActivity: "ক্যাটালগে লেখা বিক্রি অনুযায়ী", sales: (count: number) => `${count}টি বিক্রি`, other: "অন্যান্য",
  },
} satisfies Record<Language, object>;

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
  catalogueTemplate,
  onNewBill,
  onToast,
  onConverted,
  ownerMode,
  cloudConfigured,
  onOwnerUnlock,
  onMasterRestoringChange,
  initialAdvancedReport,
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
  catalogueTemplate: string;
  onNewBill: () => void;
  onToast: (message: string) => void;
  onConverted: (invoice: Invoice) => void;
  ownerMode: boolean;
  cloudConfigured: boolean;
  onOwnerUnlock: () => void;
  onMasterRestoringChange: (restoring: boolean) => void;
  initialAdvancedReport?: ReportKey;
}) {
  const copy = reportsDashboardCopy[language];
  const initialRange = dashboardPeriodRange("30d", localDate());
  const [period, setPeriod] = useState<DashboardPeriod | "custom">("30d");
  const [reportFromDate, setReportFromDate] = useState(initialRange.fromDate);
  const [reportToDate, setReportToDate] = useState(initialRange.toDate);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [selectedHistoryInvoice, setSelectedHistoryInvoice] =
    useState<Invoice | null>(null);
  const choosePeriod = (next: DashboardPeriod) => {
    const range = dashboardPeriodRange(next, localDate());
    setPeriod(next);
    setReportFromDate(range.fromDate);
    setReportToDate(range.toDate);
  };
  const changeReportRange = (fromDate: string, toDate: string) => {
    const matched = (["7d", "30d", "90d", "all"] as DashboardPeriod[]).find(
      (candidate) => {
        const range = dashboardPeriodRange(candidate, localDate());
        return range.fromDate === fromDate && range.toDate === toDate;
      },
    );
    setPeriod(matched || "custom");
    setReportFromDate(fromDate);
    setReportToDate(toDate);
  };
  const data = useMemo(() => {
    const allSales = invoices.filter(
      (invoice) => !invoice.deletedAt && invoice.type === "sale",
    );
    const todayDate = localDate();
    const sales = allSales.filter(
      (invoice) =>
        inDateRange(
          invoice.date,
          reportFromDate,
          reportToDate,
        ),
    );
    const settlement = buildSalesSettlementReport(sales, payments, todayDate);
    const cashFlow = buildCashFlowReport({
      invoices,
      payments,
      parties,
      accountEntries,
      expenses,
      fromDate: reportFromDate,
      toDate: reportToDate,
    });
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const salesTotal = settlement.totalSales;
    const todayTotal = allSales
      .filter((invoice) => invoice.date === todayDate)
      .reduce((sum, invoice) => sum + invoice.grandTotal, 0);
    let profit = 0;
    let profitComplete = true;
    for (const invoice of sales)
      for (const line of invoice.lineItems) {
        const item = itemMap.get(line.itemId);
        const costPerUnit =
          line.unitCost != null
            ? line.unitCost
            : item
              ? convertUnitRate(item.purchasePrice, item.baseUnit, line.unit)
              : null;
        if (costPerUnit != null && costPerUnit > 0)
          profit += line.taxableAmount - costPerUnit * line.qty;
        else
          profitComplete = false;
      }

    const modeRows = settlement.modes.map((row) => ({
      name: row.mode,
      value: row.amount,
      color: dashboardModeColors[row.mode],
    }));

    const productMap = new Map<string, { name: string; value: number }>();
    const categoryMap = new Map<string, number>();
    for (const invoice of sales)
      for (const line of invoice.lineItems) {
        const existing = productMap.get(line.itemId);
        productMap.set(line.itemId, {
          name: localizedItemName(language, {
            name: line.itemName,
            nameHi: line.itemNameHi || "",
            nameBn: line.itemNameBn || "",
          }),
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
      : items
          .filter((item) => item.isActive)
          .sort((a, b) => b.saleCount - a.saleCount)
          .slice(0, 5)
          .map((item) => ({
            name: localizedItemName(language, item),
            value: item.saleCount,
          }));
    const categories = [...categoryMap.entries()]
      .map(([id, value]) => ({
        name: localizedCategoryName(
          language,
          dashboardCategoryNames[id] || "Uncategorized",
        ),
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

    const trendRows = buildDashboardTrendBuckets(
      sales,
      reportFromDate,
      reportToDate,
      todayDate,
    );
    const bucketCount = trendRows.length;
    const buckets = trendRows.map((bucket) => ({
      label: formatLocalizedDate(bucket.labelDate, language, {
          day: "numeric",
          month: "short",
        }),
      value: bucket.value,
    }));
    const maxTrend = Math.max(...buckets.map((bucket) => bucket.value), 1);
    const points = buckets
      .map(
        (bucket, index) =>
          `${bucketCount === 1 ? 50 : (index * 100) / (bucketCount - 1)},${88 - (bucket.value / maxTrend) * 68}`,
      )
      .join(" ");
    return {
      sales,
      salesTotal,
      todayTotal,
      profit: profitComplete ? profit : null,
      cashFlow,
      settlement,
      modeRows,
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
  }, [
    invoices,
    payments,
    accountEntries,
    expenses,
    parties,
    items,
    language,
    reportFromDate,
    reportToDate,
  ]);
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
        phone: copy.noCustomerAccount,
        address: copy.walkInSale,
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
  }, [copy.noCustomerAccount, copy.walkInSale, invoices, language, parties]);
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
  const periodLabel =
    period === "custom"
      ? localizedCashFlowDateRange(
          reportFromDate,
          reportToDate,
          language,
        )
      : copy.periods[period];
  const collectionPercent = Math.round(data.settlement.collectionPercent);
  const duePercent = data.settlement.totalSales
    ? Math.max(0, 100 - data.settlement.collectionPercent)
    : 0;
  const displayedDuePercent = data.settlement.totalSales
    ? 100 - collectionPercent
    : 0;
  const settlementChartLabel = copy.settlementChartLabel(
    formatMoney(data.settlement.totalSales),
    formatMoney(data.settlement.collected),
    formatMoney(data.settlement.due),
    collectionPercent,
  );
  const trendChartLabel = `${copy.trendLabel}. ${data.buckets
    .map((bucket) => `${bucket.label}: ${formatMoney(bucket.value)}`)
    .join("; ")}`;
  return (
    <section className="mx-auto max-w-[1380px] px-3 py-4 md:px-5 md:py-5">
      <div className="reports-dashboard-header mb-4">
        <div className="reports-dashboard-copy min-w-0">
          <p className="flex items-center gap-2 text-[0.625rem] font-bold text-[#8b918d]">
            <span>{t(language, "reports")}</span>
            <span>›</span>
            <span className="text-[#3b4944]">{copy.breadcrumb}</span>
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight md:text-[1.75rem]">
            {copy.title}
          </h2>
          <p className="mt-1 text-xs text-[#7a837f]">
            {copy.helper}
          </p>
        </div>
        <div className="reports-dashboard-decoration" aria-hidden="true">
          <DotmSquare12
            size={108}
            dotSize={16}
            speed={1.35}
            pattern="full"
            colorPreset="solid-mint"
            animated
            opacityBase={0.12}
            opacityMid={0.42}
            opacityPeak={1}
          />
        </div>
        <div className="reports-dashboard-actions flex flex-wrap items-center gap-2">
          <div
            className="flex rounded-xl border border-[#dcd8cf] bg-white p-1"
            role="group"
            aria-label={copy.periodControl}
          >
            {(["7d", "30d", "90d", "all"] as DashboardPeriod[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => choosePeriod(value)}
                className={`min-h-9 rounded-lg px-3 text-[0.625rem] font-black uppercase ${period === value ? "bg-[#173f35] text-white" : "text-[#737d78]"}`}
              >
                {copy.periods[value]}
              </button>
            ))}
          </div>
          <button
            onClick={onNewBill}
            className="min-h-11 rounded-xl bg-[#ef7d32] px-4 text-xs font-black text-white shadow-sm"
          >
            ＋ {copy.newBill}
          </button>
        </div>
      </div>
      <article
        className="report-financial-overview dashboard-card"
        aria-labelledby="report-financial-snapshot-title"
      >
        <div className="report-financial-overview__header">
          <div>
            <p className="eyebrow">{copy.financialSnapshot}</p>
            <h3 id="report-financial-snapshot-title" className="dashboard-title mt-1">
              {copy.financialSnapshot}
            </h3>
            <p className="dashboard-subtitle">
              {copy.financialSnapshotHelper(periodLabel)}
            </p>
          </div>
          <span className="dashboard-chip">{periodLabel}</span>
        </div>
        <div className="report-financial-overview__grid">
          <div className="report-summary-metric" data-tone="in">
            <span className="report-summary-metric__icon" aria-hidden="true">＋</span>
            <div>
              <p>{copy.moneyReceived}</p>
              <strong className="report-money-in">
                +{formatMoney(data.cashFlow.moneyIn)}
              </strong>
              <small>{copy.moneyReceivedNote}</small>
            </div>
          </div>
          <div className="report-summary-metric" data-tone="out">
            <span className="report-summary-metric__icon" aria-hidden="true">−</span>
            <div>
              <p>{copy.moneySpent}</p>
              <strong className="report-money-out">
                −{formatMoney(data.cashFlow.moneyOut)}
              </strong>
              <small>{copy.moneySpentNote}</small>
            </div>
          </div>
          <div
            className="report-summary-metric"
            data-tone={data.cashFlow.netCashFlow >= 0 ? "in" : "out"}
          >
            <span className="report-summary-metric__icon" aria-hidden="true">↕</span>
            <div>
              <p>{copy.netMovement}</p>
              <strong
                className={
                  data.cashFlow.netCashFlow >= 0
                    ? "report-money-in"
                    : "report-money-out"
                }
              >
                {data.cashFlow.netCashFlow > 0 ? "+" : ""}
                {formatMoney(data.cashFlow.netCashFlow)}
              </strong>
              <small>
                {data.cashFlow.netCashFlow >= 0
                  ? copy.netPositive
                  : copy.netNegative} · {copy.netNotProfit}
              </small>
            </div>
          </div>
          <div className="report-summary-metric" data-tone="due">
            <span className="report-summary-metric__icon" aria-hidden="true">◎</span>
            <div>
              <p>{copy.dueToCollect}</p>
              <strong className="report-money-due">
                {formatMoney(data.cashFlow.customerOutstanding)}
              </strong>
              <small>
                {copy.dueCurrentNote} · {copy.supplierPayableNote(
                  formatMoney(data.cashFlow.supplierOutstanding),
                )}
              </small>
            </div>
          </div>
        </div>
      </article>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DashboardMetric
          icon="₹"
          label={copy.grossSales}
          value={formatMoney(data.salesTotal)}
          note={copy.grossSalesNote(data.sales.length, periodLabel)}
          tone="orange"
        />
        <DashboardMetric
          icon="↗"
          label={copy.grossToday}
          value={formatMoney(data.todayTotal)}
          note={copy.grossTodayNote}
          tone="green"
        />
        <DashboardMetric
          icon={ownerMode ? "◈" : "▤"}
          label={ownerMode ? copy.estimatedProfit : copy.bills}
          value={ownerMode ? data.profit == null ? copy.costMissing : formatMoney(data.profit) : String(data.sales.length)}
          note={ownerMode ? data.profit == null ? copy.missingCostNote : copy.ownerProfitNote : copy.recordedIn(periodLabel)}
          tone="blue"
          valueTone={
            ownerMode && data.profit != null
              ? data.profit >= 0
                ? "in"
                : "out"
              : undefined
          }
        />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-12">
        <CashFlowPanel
          invoices={invoices}
          payments={payments}
          parties={parties}
          accountEntries={accountEntries}
          expenses={expenses}
          fromDate={reportFromDate}
          toDate={reportToDate}
          onRangeChange={changeReportRange}
          business={business}
          language={language}
          onToast={onToast}
        />
        <article className="dashboard-card p-4 xl:col-span-12">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">{copy.settlement}</h3>
              <p className="dashboard-subtitle">
                {copy.settlementHelper(periodLabel)}
              </p>
            </div>
            <span className="dashboard-chip">{copy.billCount(data.sales.length)}</span>
          </div>
          <div className="report-settlement-layout mt-5">
            <figure className="report-settlement-figure">
              <div className="report-settlement-donut">
                <svg
                  viewBox="0 0 120 120"
                  role="img"
                  aria-label={settlementChartLabel}
                >
                  <title>{settlementChartLabel}</title>
                  <circle
                    className="report-settlement-donut__track"
                    cx="60"
                    cy="60"
                    r="48"
                    pathLength="100"
                  />
                  {data.settlement.totalSales > 0 && (
                    <>
                      <circle
                        className="report-settlement-donut__collected"
                        cx="60"
                        cy="60"
                        r="48"
                        pathLength="100"
                        strokeDasharray={`${data.settlement.collectionPercent} ${100 - data.settlement.collectionPercent}`}
                      />
                      {data.settlement.due > 0 && (
                        <circle
                          className="report-settlement-donut__due"
                          cx="60"
                          cy="60"
                          r="48"
                          pathLength="100"
                          strokeDasharray={`${duePercent} ${100 - duePercent}`}
                          strokeDashoffset={-data.settlement.collectionPercent}
                        />
                      )}
                    </>
                  )}
                </svg>
                <div className="report-settlement-donut__center" aria-hidden="true">
                  <strong>{collectionPercent}%</strong>
                  <span>{copy.collectionRate}</span>
                  <small>{formatMoney(data.settlement.totalSales)}</small>
                </div>
              </div>
              <figcaption className="report-settlement-summary">
                <div>
                  <span className="report-status-dot report-status-dot--in" aria-hidden="true" />
                  <p>{copy.collected}</p>
                  <strong className="report-money-in">
                    {formatMoney(data.settlement.collected)}
                  </strong>
                  <small>{collectionPercent}% {copy.shareOfSales}</small>
                </div>
                <div>
                  <span className="report-status-dot report-status-dot--due" aria-hidden="true" />
                  <p>{copy.stillDue}</p>
                  <strong className="report-money-due">
                    {formatMoney(data.settlement.due)}
                  </strong>
                  <small>{displayedDuePercent}% {copy.shareOfSales}</small>
                </div>
              </figcaption>
            </figure>
            <div className="report-payment-breakdown">
              <p className="field-caption">{copy.paymentBreakdown}</p>
              {data.modeRows.length ? (
                <div className="mt-3 space-y-3">
                  {data.modeRows.map((row) => {
                    const share = data.settlement.totalSales
                      ? (row.value / data.settlement.totalSales) * 100
                      : 0;
                    return (
                      <div key={row.name} className="report-payment-row">
                        <div>
                          <span>
                            <i style={{ background: row.color }} aria-hidden="true" />
                            {localizedPaymentModeName(row.name, language)}
                          </span>
                          <strong className="report-money-in">
                            {formatMoney(row.value)}
                          </strong>
                        </div>
                        <div className="report-payment-row__track" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.min(100, share)}%`,
                              background: row.color,
                            }}
                          />
                        </div>
                        <small>{share.toFixed(1)}% {copy.shareOfSales}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="report-payment-breakdown__empty">
                  {data.salesTotal ? copy.noCollections : copy.noSales}
                </p>
              )}
            </div>
          </div>
        </article>
        <AdvancedReports
          invoices={invoices}
          parties={parties}
          items={items}
          accountEntries={accountEntries}
          fromDate={reportFromDate}
          toDate={reportToDate}
          onRangeChange={changeReportRange}
          language={language}
          business={business}
          format={format}
          catalogueTemplate={catalogueTemplate}
          onToast={onToast}
          onConverted={onConverted}
          ownerMode={ownerMode}
          initialReport={initialAdvancedReport}
        />
        <MasterBackupPanel
          language={language}
          ownerMode={ownerMode}
          cloudConfigured={cloudConfigured}
          onOwnerUnlock={onOwnerUnlock}
          onToast={onToast}
          onRestoringChange={onMasterRestoringChange}
        />
        {ownerMode ? (
          <DailyClosePanel language={language} invoices={invoices} payments={payments} expenses={expenses} parties={parties} onToast={onToast} />
        ) : (
          <article className="dashboard-card p-4 xl:col-span-12">
            <p className="eyebrow">{copy.counterControl}</p>
            <h3 className="mt-1 text-xl text-[#014921]">{copy.closingOwnerOnly}</h3>
            <p className="mt-2 text-xs leading-5 text-[#68736e]">
              {copy.closingHelper}
            </p>
            <button type="button" onClick={onOwnerUnlock} className="counter-secondary mt-3 max-w-xs">
              {copy.unlockClosing}
            </button>
          </article>
        )}
        <article className="dashboard-card overflow-hidden xl:col-span-12">
          <div className="flex items-center justify-between border-b border-[#e7e3da] px-4 py-4">
            <div>
              <h3 className="dashboard-title">{copy.recentInvoices}</h3>
              <p className="dashboard-subtitle">
                {copy.recentHelper}
              </p>
            </div>
            <span className="dashboard-chip">{copy.live}</span>
          </div>
          <div
            className="report-recent-invoice-list"
            role="list"
            aria-label={copy.recentTable}
          >
            {data.recent.length ? (
              data.recent.map((invoice) => (
                <div key={invoice.id} role="listitem" className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openInvoiceHistory(invoice)}
                    className="report-recent-invoice-card"
                  >
                    <span className="report-recent-invoice-card__identity">
                      <strong>{invoice.invoiceNumber}</strong>
                      <small>{fullInvoiceDate(invoice.date, language)}</small>
                    </span>
                    <span className="report-recent-invoice-card__party">
                      {localizedInvoicePartyName(language, invoice)}
                    </span>
                    <span className="report-recent-invoice-card__mode">
                      <i
                        style={{
                          background:
                            dashboardModeColors[invoice.paymentMode] ||
                            "#8b918d",
                        }}
                        aria-hidden="true"
                      />
                      {localizedPaymentModeName(invoice.paymentMode, language)}
                    </span>
                    <span className="report-recent-invoice-card__amounts">
                      <span>
                        <small>{copy.total}</small>
                        <strong>{formatMoney(invoice.grandTotal)}</strong>
                      </span>
                      <span>
                        <small>{copy.due}</small>
                        <strong
                          className={
                            invoice.amountDue > 0
                              ? "report-money-due"
                              : "report-money-in"
                          }
                        >
                          {formatMoney(invoice.amountDue)}
                        </strong>
                      </span>
                    </span>
                    <span className="sr-only">
                      {copy.openInvoice(
                        invoice.invoiceNumber,
                        localizedInvoicePartyName(language, invoice),
                      )}
                    </span>
                  </button>
                </div>
              ))
            ) : (
              <p className="col-span-full py-12 text-center text-xs text-[#858c88]">
                {copy.noSavedBills}
              </p>
            )}
          </div>
          <div
            className="report-recent-invoice-table-region"
            role="region"
            aria-label={copy.recentTable}
          >
            <table className="dashboard-table report-recent-invoice-table">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[25%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>{copy.invoice}</th>
                  <th>{copy.party}</th>
                  <th>{copy.date}</th>
                  <th>{copy.mode}</th>
                  <th className="text-right">{copy.total}</th>
                  <th className="text-right">{copy.due}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.length ? (
                  data.recent.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="transition hover:bg-[#f4faf0] focus-within:bg-[#f4faf0]"
                    >
                      <td>
                        <button
                          type="button"
                          onClick={() => openInvoiceHistory(invoice)}
                          aria-label={copy.openInvoice(
                            invoice.invoiceNumber,
                            localizedInvoicePartyName(language, invoice),
                          )}
                          className="rounded-md text-left font-black text-[#014921] underline decoration-[#abd49e] underline-offset-4"
                        >
                          {invoice.invoiceNumber}
                        </button>
                      </td>
                      <td>{localizedInvoicePartyName(language, invoice)}</td>
                      <td>{fullInvoiceDate(invoice.date, language)}</td>
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
                          {localizedPaymentModeName(invoice.paymentMode, language)}
                        </span>
                      </td>
                      <td className="report-recent-invoice-table__money text-right font-bold">
                        {formatMoney(invoice.grandTotal)}
                      </td>
                      <td
                        className={`report-recent-invoice-table__money text-right font-bold ${invoice.amountDue > 0 ? "report-money-due" : "report-money-in"}`}
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
                      {copy.noSavedBills}
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
              <span aria-hidden="true" className="text-[#66736d]">⌕</span>
              <input
                aria-label={reportHistoryCopy[language].search}
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
                    {row.codeName && (
                      <span className="shrink-0 rounded-md bg-[#e7f3ec] px-1.5 py-1 text-[0.5rem] font-black text-[#25684f]">
                        {row.codeName}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[0.625rem] font-semibold text-[#5f6e67]">
                    {row.address || copy.noAddress}
                  </p>
                  <p className="mt-1 truncate text-[0.5625rem] text-[#77817c]">
                    {row.phone || copy.noPhone}
                  </p>
                  <p className="mt-2 text-[0.5625rem] font-black uppercase tracking-wide text-[#6f7974]">
                    {row.billCount} {reportHistoryCopy[language].bills}
                    {row.last
                      ? ` · ${reportHistoryCopy[language].lastPurchase} ${fullInvoiceDate(row.last.date, language)}`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <strong className="text-sm text-[#173f35]">
                    {formatMoney(row.total)}
                  </strong>
                  <p className="mt-1 text-[0.5625rem] font-bold text-[#7b847f]">
                    {reportHistoryCopy[language].spent} ›
                  </p>
                </div>
              </button>
            ))}
            {!visibleCustomerRows.length && (
              <p className="col-span-full py-10 text-center text-xs font-semibold text-[#858c88]">
                {copy.noCustomer}
              </p>
            )}
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <h3 className="dashboard-title">{copy.trend}</h3>
          <p className="dashboard-subtitle">
            {copy.trendHelper(periodLabel)}
          </p>
          <div className="mt-5 h-[175px]">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-[132px] w-full overflow-visible"
              aria-label={trendChartLabel}
              role="img"
            >
              <title>{trendChartLabel}</title>
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
                  cx={data.buckets.length === 1 ? 50 : (index * 100) / (data.buckets.length - 1)}
                  cy={88 - (bucket.value / data.maxTrend) * 68}
                  r="1.6"
                  fill="#f9f9f9"
                  stroke="#309d4b"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div
              className="grid gap-1 text-center text-[0.5rem] font-bold text-[#8b918d]"
              style={{ gridTemplateColumns: `repeat(${data.buckets.length}, minmax(0, 1fr))` }}
            >
              {data.buckets.map((bucket) => (
                <span key={bucket.label}>{bucket.label}</span>
              ))}
            </div>
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">{copy.outstandingByParty}</h3>
              <p className="dashboard-subtitle">
                {copy.outstandingHelper}
              </p>
            </div>
            <span className="dashboard-chip">{copy.topFive}</span>
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
                    <span className="truncate text-[0.6875rem] font-bold text-[#014921]">
                      {party.name} ›
                    </span>
                    <strong className="report-money-due shrink-0 text-[0.6875rem]">
                      {formatMoney(party.currentBalance)}
                    </strong>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eeeae2]">
                    <div
                      className="report-due-bar h-full rounded-full"
                      style={{
                        width: `${(party.currentBalance / data.maxReceivable) * 100}%`,
                      }}
                    />
                  </div>
                </button>
              ))
            ) : (
              <p className="py-16 text-center text-xs text-[#858c88]">
                {copy.noOutstanding}
              </p>
            )}
          </div>
        </article>
        <article className="dashboard-card p-4 xl:col-span-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="dashboard-title">{copy.topProducts}</h3>
              <p className="dashboard-subtitle">
                {data.hasProductSales
                  ? copy.byRevenue
                  : copy.byActivity}
              </p>
            </div>
            <span className="dashboard-chip">{copy.topFive}</span>
          </div>
          <div className="mt-4 space-y-3">
            {data.topProducts.map((row, index) => (
              <div
                key={row.name}
                className="grid grid-cols-[22px_1fr_auto] items-center gap-2"
              >
                <span className="grid h-5 w-5 place-items-center rounded-md bg-[#f1eee7] text-[0.5625rem] font-black text-[#737b77]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[0.6875rem] font-bold">{row.name}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eeeae2]">
                    <div
                      className="h-full rounded-full bg-[#309d4b]"
                      style={{ width: `${(row.value / topProductMax) * 100}%` }}
                    />
                  </div>
                </div>
                <strong className="text-[0.625rem]">
                  {data.hasProductSales
                    ? formatMoney(row.value)
                    : copy.sales(row.value)}
                </strong>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

const purchaseHistoryCopy = {
  en: {
    noPhone: "No phone number", noAddress: "No address saved", grossNote: "Gross billed totals before imported sales returns. Return cash movements remain visible in Cash flow.",
    allBills: "All purchase bills", newestFirst: "Newest first · exact billed date and recorded time", totalCount: (total: number, deleted: number) => `${total} total${deleted ? ` · ${deleted} deleted` : ""}`,
    paidInFull: "Paid in full", futureBills: "Future bills saved for this customer will appear here automatically.",
    salesInvoice: "Sales invoice", recoverable: "This bill is currently in the 30-day recoverable bin.", itemHelper: "Quantity, unit, negotiated rate, GST and line total", noSku: "No SKU",
    quantity: "Quantity", rate: "Rate", subtotal: "Subtotal", discount: "Discount", grandTotal: "Grand total", print: "Print this bill", share: "Share PDF on WhatsApp",
  },
  hi: {
    noPhone: "फोन नंबर सेव नहीं है", noAddress: "पता सेव नहीं है", grossNote: "इम्पोर्ट किए सेल रिटर्न से पहले के कुल बिल। रिटर्न का कैश कैश-फ्लो में अलग दिखता है।",
    allBills: "खरीद के सभी बिल", newestFirst: "नया पहले · बिल की सही तारीख और सेव होने का समय", totalCount: (total: number, deleted: number) => `${total} कुल${deleted ? ` · ${deleted} हटाए गए` : ""}`,
    paidInFull: "पूरा पेमेंट हो गया", futureBills: "इस कस्टमर के आगे सेव होने वाले बिल यहाँ अपने-आप दिखेंगे।",
    salesInvoice: "सेल बिल", recoverable: "यह बिल अभी 30 दिन वाली रिकवरी बिन में है।", itemHelper: "मात्रा, यूनिट, तय रेट, GST और लाइन का कुल", noSku: "SKU नहीं है",
    quantity: "मात्रा", rate: "रेट", subtotal: "सबटोटल", discount: "छूट", grandTotal: "कुल रकम", print: "यह बिल प्रिंट करें", share: "PDF WhatsApp पर भेजें",
  },
  bn: {
    noPhone: "ফোন নম্বর সেভ করা নেই", noAddress: "ঠিকানা সেভ করা নেই", grossNote: "ইমপোর্ট করা সেল রিটার্নের আগের মোট বিল। রিটার্নের ক্যাশ ক্যাশ ফ্লো-তে আলাদা দেখা যায়।",
    allBills: "কেনাকাটার সব বিল", newestFirst: "নতুন আগে · বিলের ঠিক তারিখ ও সেভ হওয়ার সময়", totalCount: (total: number, deleted: number) => `${total}টি মোট${deleted ? ` · ${deleted}টি সরানো` : ""}`,
    paidInFull: "পুরো পেমেন্ট হয়েছে", futureBills: "এই কাস্টমারের পরে সেভ হওয়া বিল এখানে নিজে থেকে দেখা যাবে।",
    salesInvoice: "সেল বিল", recoverable: "এই বিলটি এখন 30 দিনের রিকভারি বিনে আছে।", itemHelper: "পরিমাণ, ইউনিট, ঠিক করা রেট, GST ও লাইনের মোট", noSku: "SKU নেই",
    quantity: "পরিমাণ", rate: "রেট", subtotal: "সাবটোটাল", discount: "ছাড়", grandTotal: "মোট টাকা", print: "এই বিল প্রিন্ট করুন", share: "PDF WhatsApp-এ পাঠান",
  },
} satisfies Record<Language, object>;

const localizedInvoiceLineName = (line: InvoiceLine, language: Language) =>
  localizedItemName(language, {
    name: line.itemName,
    nameHi: line.itemNameHi || "",
    nameBn: line.itemNameBn || "",
  });

const localizedInvoiceUnitName = (unit: Unit, language: Language) =>
  localizedUnitName(language, unit) || unitShort(unit);

const localizedInvoiceChargeLabel = (
  charge: InvoiceCharge,
  language: Language,
) =>
  charge.code === "carrier"
    ? t(language, "carrierCharge")
    : charge.code === "packing"
      ? t(language, "packingCharge")
      : charge.code === "big_box"
        ? t(language, "bigBoxCharge")
        : charge.label;

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
  const detailCopy = purchaseHistoryCopy[language];
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
          <p className="text-[0.625rem] font-black uppercase tracking-[.14em] text-[#abd49e]">
            {copy.section}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black md:text-3xl">{customerName}</h2>
            {(!party || party.codeName) && (
              <span className="rounded-lg bg-[#ffbf6f] px-2 py-1 text-[0.5625rem] font-black text-[#014921]">
                {party?.codeName || "CASH"}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-[#d6e5d9]">
            {party?.phone || detailCopy.noPhone}
            {party?.gstin ? ` · GSTIN ${party.gstin}` : ""}
          </p>
          <p className="mt-1 text-[0.625rem] text-[#c7dbc9]">
            ⌖ {party?.address || detailCopy.noAddress}
          </p>
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-[0.625rem] leading-4 text-[#e4efe6]">
            {detailCopy.grossNote}
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
          <div className="border-r border-white/15 p-4">
            <span className="text-[0.5625rem] font-bold uppercase text-[#c3d9c7]">
              {copy.savedBills}
            </span>
            <strong className="mt-1 block text-xl">
              {activeInvoices.length}
            </strong>
          </div>
          <div className="border-r border-white/15 p-4">
            <span className="text-[0.5625rem] font-bold uppercase text-[#c3d9c7]">
              {copy.purchaseTotal}
            </span>
            <strong className="mt-1 block text-xl text-[#ffbf6f]">
              {formatMoney(total)}
            </strong>
          </div>
          <div className="border-r border-t border-white/15 p-4 sm:border-t-0">
            <span className="text-[0.5625rem] font-bold uppercase text-[#c3d9c7]">
              {copy.paid}
            </span>
            <strong className="mt-1 block text-xl">{formatMoney(paid)}</strong>
          </div>
          <div className="border-t border-white/15 p-4 sm:border-t-0">
            <span className="text-[0.5625rem] font-bold uppercase text-[#c3d9c7]">
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
          <h3 className="text-base font-black">{detailCopy.allBills}</h3>
          <p className="mt-1 text-[0.625rem] font-semibold text-[#748078]">
            {detailCopy.newestFirst}
          </p>
        </div>
        <span className="shrink-0 rounded-xl bg-[#e8f3e9] px-3 py-2 text-[0.625rem] font-black text-[#276b50]">
          {detailCopy.totalCount(invoices.length, deletedCount)}
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
                    <span className="rounded-full bg-[#f7e8df] px-2 py-1 text-[0.5rem] font-black uppercase text-[#9a4e2d]">
                      {copy.deleted}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[0.6875rem] font-bold text-[#374a43]">
                  {fullInvoiceDate(invoice.date, language)}
                </p>
                <p className="mt-1 text-[0.5625rem] text-[#7b8580]">
                  {tr(language, "Recorded", "सेव हुआ", "সেভ হয়েছে")} {invoiceRecordedTime(invoice.createdAt, language)} ·{" "}
                  {invoicePaymentLabel(invoice, language)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <strong className="text-base">
                  {formatMoney(invoice.grandTotal)}
                </strong>
                <p
                  className={`mt-1 text-[0.5625rem] font-black ${invoice.amountDue > 0 ? "report-money-due" : "report-money-in"}`}
                >
                  {invoice.amountDue > 0
                    ? `${copy.due} ${formatMoney(invoice.amountDue)}`
                    : detailCopy.paidInFull}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {invoice.lineItems.map((line, index) => (
                <span
                  key={`${invoice.id}-${line.itemId}-${index}`}
                  className="rounded-lg bg-[#f1eee7] px-2 py-1.5 text-[0.5625rem] font-bold text-[#4f5f58]"
                >
                  {line.qty} {localizedInvoiceUnitName(line.unit, language)} × {localizedInvoiceLineName(line, language)}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#ece8de] pt-3">
              <span className="text-[0.5625rem] font-bold text-[#748078]">
                {invoice.lineItems.length} {copy.items.toLowerCase()}
              </span>
              <span className="text-[0.625rem] font-black text-[#014921]">
                {copy.viewBill} ›
              </span>
            </div>
          </button>
        ))}
        {!invoices.length && (
          <div className="rounded-2xl border-2 border-dashed border-[#d8d2c6] bg-[#f8f5ee] p-12 text-center">
            <span className="text-3xl">▤</span>
            <p className="mt-3 text-sm font-black">{copy.noBills}</p>
            <p className="mt-1 text-[0.625rem] text-[#7a837f]">
              {detailCopy.futureBills}
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
  const detailCopy = purchaseHistoryCopy[language];
  return (
    <SheetFrame
      title={`${copy.viewBill} · ${invoice.invoiceNumber}`}
      onClose={onClose}
      full
    >
      <div className="rounded-3xl bg-[#014921] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.625rem] font-black uppercase tracking-[.13em] text-[#abd49e]">
              {detailCopy.salesInvoice}
            </p>
            <h3 className="mt-2 text-xl font-black">
              {localizedInvoicePartyName(language, invoice)}
            </h3>
            <p className="mt-1 text-[0.625rem] text-[#d0e1d3]">
              {fullInvoiceDate(invoice.date, language)} · {tr(language, "recorded", "सेव हुआ", "সেভ হয়েছে")}{" "}
              {invoiceRecordedTime(invoice.createdAt, language)} ·{" "}
              {invoicePaymentLabel(invoice, language)}
            </p>
          </div>
          <strong className="shrink-0 text-xl text-[#ffbf6f]">
            {formatMoney(invoice.grandTotal)}
          </strong>
        </div>
        {invoice.deletedAt && (
          <p className="mt-4 rounded-xl bg-[#fff3e8] p-3 text-[0.625rem] font-black text-[#91471f]">
            {detailCopy.recoverable}
          </p>
        )}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#ddd9cf] bg-white">
        <div className="border-b border-[#e8e4da] px-4 py-3">
          <h4 className="text-sm font-black">{copy.items}</h4>
          <p className="mt-1 text-[0.5625rem] text-[#748078]">
            {detailCopy.itemHelper}
          </p>
        </div>
        <div className="divide-y divide-[#ece8de]">
          {invoice.lineItems.map((line, index) => (
            <div key={`${line.itemId}-${index}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-xs">{localizedInvoiceLineName(line, language)}</strong>
                  <p className="mt-1 text-[0.5625rem] text-[#7a837e]">
                    {line.skuCode || detailCopy.noSku}
                    {line.hsnCode ? ` · HSN ${line.hsnCode}` : ""}
                  </p>
                </div>
                <strong className="shrink-0 text-xs">
                  {formatMoney(line.amount)}
                </strong>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[0.5rem] font-bold text-[#7b837f]">
                    {detailCopy.quantity}
                  </span>
                  <strong className="mt-1 block text-[0.625rem]">
                    {line.qty} {localizedInvoiceUnitName(line.unit, language)}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[0.5rem] font-bold text-[#7b837f]">
                    {detailCopy.rate}
                  </span>
                  <strong className="mt-1 block text-[0.625rem]">
                    {formatMoney(line.rate)}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f6f3ec] p-2">
                  <span className="block text-[0.5rem] font-bold text-[#7b837f]">
                    GST
                  </span>
                  <strong className="mt-1 block text-[0.625rem]">
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
            <span>{detailCopy.subtotal}</span>
            <strong>{formatMoney(invoice.subtotal)}</strong>
          </div>
          <div className="flex justify-between">
            <span>{detailCopy.discount}</span>
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
              <span>{localizedInvoiceChargeLabel(charge, language)}</span>
              <strong>{formatMoney(charge.amount)}</strong>
            </div>
          ))}
          <div className="flex justify-between border-t border-[#e5e1d7] pt-2 text-sm">
            <span className="font-black">{detailCopy.grandTotal}</span>
            <strong>{formatMoney(invoice.grandTotal)}</strong>
          </div>
          <div className="report-money-in flex justify-between">
            <span>
              {copy.paid} · {invoicePaymentLabel(invoice, language)}
            </span>
            <strong>{formatMoney(invoice.amountPaid)}</strong>
          </div>
          <div className="report-money-due flex justify-between">
            <span>{copy.due}</span>
            <strong>{formatMoney(invoice.amountDue)}</strong>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            const preparedWindow = preparePrintWindow();
            void printInvoice(
              invoice,
              business,
              format,
              preparedWindow,
              language,
            ).catch(() => preparedWindow?.close());
          }}
          className="counter-primary"
        >
          {detailCopy.print}
        </button>
        <button
          type="button"
          onClick={() => void shareInvoice(invoice, business, format, null, undefined, language)}
          className="counter-secondary text-[#014921]"
        >
          {detailCopy.share}
        </button>
      </div>
    </SheetFrame>
  );
}

function MoreScreen({
  language,
  theme,
  interfaceScale,
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
  onInterfaceScale,
  onFormat,
  onBusiness,
  onInstall,
  onToast,
  onInventory,
  onFestival,
  onNavigate,
  workspace,
  printerProfiles,
  messageTemplates,
  activityLogs,
  parties,
  items,
  ownerMode,
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
  interfaceScale: InterfaceScale;
  format: InvoiceFormat;
  business: BusinessSettings;
  invoices: Invoice[];
  installable: boolean;
  cloudConfigured: boolean;
  cloudConfig: CloudConfig;
  onCloud: (config: CloudConfig) => Promise<void>;
  onCloudDisconnect: () => Promise<boolean>;
  onLanguage: (x: Language) => void;
  onTheme: (x: Theme) => void;
  onInterfaceScale: (x: InterfaceScale) => void;
  onFormat: (x: InvoiceFormat) => void;
  onBusiness: (x: BusinessSettings) => Promise<void>;
  onInstall: () => void;
  onToast: (m: string) => void;
  onInventory: () => void;
  onFestival: () => void;
  onNavigate: (tab: Tab) => void;
  workspace: WorkspacePreferences;
  printerProfiles: PrinterProfile[];
  messageTemplates: MessageTemplates;
  activityLogs: import("../lib/db").ActivityLog[];
  parties: Party[];
  items: Item[];
  ownerMode: boolean;
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
  const [savingShop, setSavingShop] = useState(false);
  const [renderTime] = useState(() => Date.now());
  const copy = {
    settingsData: tr(language, "Settings & data", "सेटिंग्स और डेटा", "সেটিংস ও ডেটা"),
    duesHelp: tr(
      language,
      "Customer balances and payments",
      "कस्टमर की बाकी और पेमेंट",
      "কাস্টমারের বাকি ও পেমেন্ট",
    ),
    miscHelp: tr(
      language,
      "Tea, transport and shop costs",
      "चाय, ट्रांसपोर्ट और दुकान खर्च",
      "চা, ট্রান্সপোর্ট ও দোকানের খরচ",
    ),
    installPhone: tr(language, "Install on this phone", "इस फोन में इंस्टॉल करें", "এই ফোনে ইনস্টল করুন"),
    installHelp: tr(
      language,
      "Works like an app from the home screen",
      "होम स्क्रीन से ऐप की तरह चलेगा",
      "হোম স্ক্রিন থেকে অ্যাপের মতো চলবে",
    ),
    shopDetails: tr(language, "Shop details", "दुकान की डिटेल", "দোকানের ডিটেল"),
    shopDetailsHelp: tr(
      language,
      "These details appear on every bill and printout.",
      "ये जानकारी हर बिल और प्रिंट में दिखाई देगी।",
      "এই তথ্য প্রতিটি বিল ও প্রিন্টে দেখা যাবে।",
    ),
    shopName: tr(language, "Shop name", "दुकान का नाम", "দোকানের নাম"),
    ownerName: tr(
      language,
      "Shopkeeper / proprietor name",
      "दुकानदार / मालिक का नाम",
      "দোকানদার / মালিকের নাম",
    ),
    shopAddress: tr(language, "Shop address", "दुकान का पता", "দোকানের ঠিকানা"),
    address: tr(language, "Address", "पता", "ঠিকানা"),
    shopPhone: tr(language, "Shop phone", "दुकान का फोन", "দোকানের ফোন"),
    alternatePhone: tr(
      language,
      "Alternate contact number",
      "दूसरा संपर्क नंबर",
      "অন্য যোগাযোগ নম্বর",
    ),
    phone: tr(language, "Phone", "फोन", "ফোন"),
    billEmail: tr(
      language,
      "Email for bills",
      "बिल के लिए ईमेल",
      "বিলের ইমেল",
    ),
    shopGstin: tr(language, "Shop GSTIN", "दुकान का GSTIN", "দোকানের GSTIN"),
    saveShop: tr(language, "Save shop details", "दुकान की डिटेल सेव करें", "দোকানের ডিটেল সেভ করুন"),
    savingShop: tr(language, "Saving...", "सेव हो रहा है...", "সেভ হচ্ছে..."),
    shopSaveFailed: tr(
      language,
      "Shop details could not be saved. Please try again.",
      "दुकान की जानकारी सेव नहीं हुई। दोबारा कोशिश करें।",
      "দোকানের তথ্য সেভ হয়নি। আবার চেষ্টা করুন।",
    ),
    language: tr(language, "Language", "भाषा", "ভাষা"),
    interfaceSize: tr(
      language,
      "Interface size",
      "इंटरफ़ेस साइज़",
      "ইন্টারফেসের আকার",
    ),
    interfaceSizeHelp: tr(
      language,
      "Enlarge app text, icons, buttons and spacing together. Printed bills and PDFs stay unchanged.",
      "ऐप के टेक्स्ट, आइकन, बटन और स्पेसिंग को एक साथ बड़ा करें। प्रिंटेड बिल और PDF नहीं बदलेंगे।",
      "অ্যাপের লেখা, আইকন, বোতাম ও ফাঁক একসঙ্গে বড় করুন। প্রিন্ট করা বিল ও PDF বদলাবে না।",
    ),
    interfaceScaleLabels: {
      100: tr(language, "Default", "सामान्य", "সাধারণ"),
      110: tr(language, "Comfortable", "आरामदायक", "আরামদায়ক"),
      120: tr(language, "Large", "बड़ा", "বড়"),
      130: tr(language, "Extra large", "बहुत बड़ा", "খুব বড়"),
    } satisfies Record<InterfaceScale, string>,
    invoiceSize: tr(language, "Invoice size", "बिल का साइज़", "বিলের সাইজ"),
    invoiceFormats: {
      a4: "A4",
      a5: "A5",
      thermal: tr(language, "Thermal", "थर्मल", "থার্মাল"),
    } satisfies Record<InvoiceFormat, string>,
    cloudBackup: tr(language, "Cloud backup", "क्लाउड बैकअप", "ক্লাউড ব্যাকআপ"),
    supabaseSync: tr(language, "Supabase sync", "Supabase सिंक", "Supabase সিঙ্ক"),
    cloudReady: tr(
      language,
      "Configured; local-first sync is active",
      "सेट है; लोकल-फर्स्ट सिंक चालू है",
      "সেট করা আছে; লোকাল-ফার্স্ট সিঙ্ক চালু",
    ),
    cloudOffline: tr(
      language,
      "Not configured; this device works offline",
      "सेट नहीं है; यह डिवाइस ऑफलाइन चलेगा",
      "সেট করা নেই; এই ডিভাইস অফলাইনে চলবে",
    ),
    cloudHelp: tr(
      language,
      "Every bill is saved on this device first. Use the same private business sync code on every trusted device; no connection problem will block billing.",
      "हर बिल पहले इसी डिवाइस में सेव होता है। सभी भरोसेमंद डिवाइस में एक ही प्राइवेट बिज़नेस सिंक कोड रखें; नेटवर्क न हो तो भी बिलिंग नहीं रुकेगी।",
      "প্রতিটি বিল আগে এই ডিভাইসে সেভ হয়। সব বিশ্বস্ত ডিভাইসে একই প্রাইভেট বিজনেস সিঙ্ক কোড দিন; নেট না থাকলেও বিলিং বন্ধ হবে না।",
    ),
    projectUrl: tr(language, "Supabase project URL", "Supabase प्रोजेक्ट URL", "Supabase প্রজেক্ট URL"),
    anonKey: tr(language, "Anon public key", "Anon पब्लिक की", "Anon পাবলিক কি"),
    pasteAnonKey: tr(language, "Paste anon public key", "Anon पब्लिक की पेस्ट करें", "Anon পাবলিক কি পেস্ট করুন"),
    privateSyncCode: tr(
      language,
      "Private business sync code",
      "प्राइवेट बिज़नेस सिंक कोड",
      "প্রাইভেট বিজনেস সিঙ্ক কোড",
    ),
    sameCode: tr(
      language,
      "Use the same code on every device",
      "हर डिवाइस में यही कोड रखें",
      "প্রতিটি ডিভাইসে একই কোড দিন",
    ),
    generateCode: tr(
      language,
      "Generate a strong sync code",
      "मज़बूत सिंक कोड बनाएँ",
      "শক্ত সিঙ্ক কোড তৈরি করুন",
    ),
    generateCodeFailed: tr(
      language,
      "Could not create a secure sync code",
      "सुरक्षित सिंक कोड नहीं बन सका",
      "নিরাপদ সিঙ্ক কোড তৈরি করা যায়নি",
    ),
    saveSync: tr(language, "Save & sync", "सेव और सिंक", "সেভ ও সিঙ্ক"),
    disconnect: tr(language, "Disconnect", "डिस्कनेक्ट", "ডিসকানেক্ট"),
    ownerUnlockRequired: tr(
      language,
      "Owner unlock required",
      "ओनर अनलॉक ज़रूरी है",
      "ওনার আনলক দরকার",
    ),
    ownerCloudHelp: tr(
      language,
      "Cloud credentials and disconnect controls stay hidden from staff. Background backup continues normally.",
      "क्लाउड लॉगिन और डिस्कनेक्ट कंट्रोल स्टाफ से छिपे रहते हैं। बैकग्राउंड बैकअप चलता रहेगा।",
      "ক্লাউড লগইন ও ডিসকানেক্ট কন্ট্রোল স্টাফের থেকে লুকানো থাকে। ব্যাকগ্রাউন্ড ব্যাকআপ চলবে।",
    ),
    unlockCloud: tr(language, "Unlock cloud settings", "क्लाउड सेटिंग्स अनलॉक करें", "ক্লাউড সেটিংস আনলক করুন"),
    createOwnerPin: tr(
      language,
      "Create owner PIN to manage cloud",
      "क्लाउड मैनेज करने के लिए ओनर PIN बनाएँ",
      "ক্লাউড ম্যানেজ করতে ওনার PIN তৈরি করুন",
    ),
    gstExport: tr(language, "GST export", "GST एक्सपोर्ट", "GST এক্সপোর্ট"),
    gstHelp: tr(
      language,
      "Working CSV for your CA. This does not file a return, generate an IRN or create an e-way bill.",
      "आपके CA के लिए वर्किंग CSV। इससे रिटर्न फाइल, IRN या ई-वे बिल नहीं बनता।",
      "আপনার CA-র জন্য ওয়ার্কিং CSV। এটি রিটার্ন ফাইল, IRN বা ই-ওয়ে বিল তৈরি করে না।",
    ),
    exportGstr: tr(
      language,
      "Export GSTR-1 working CSV",
      "GSTR-1 वर्किंग CSV एक्सपोर्ट करें",
      "GSTR-1 ওয়ার্কিং CSV এক্সপোর্ট করুন",
    ),
    gstrTitle: tr(language, "GSTR-1 working CSV", "GSTR-1 वर्किंग CSV", "GSTR-1 ওয়ার্কিং CSV"),
    gstrDialog: tr(
      language,
      "Save or share GST export",
      "GST एक्सपोर्ट सेव या शेयर करें",
      "GST এক্সপোর্ট সেভ বা শেয়ার করুন",
    ),
    gstrReady: tr(language, "GSTR-1 working CSV ready", "GSTR-1 वर्किंग CSV तैयार है", "GSTR-1 ওয়ার্কিং CSV তৈরি"),
    gstrExported: tr(language, "GSTR-1 working CSV exported", "GSTR-1 वर्किंग CSV एक्सपोर्ट हुई", "GSTR-1 ওয়ার্কিং CSV এক্সপোর্ট হয়েছে"),
    invoiceBin: tr(language, "30-day invoice bin", "30 दिन की बिल रिकवरी लिस्ट", "30 দিনের বিল রিকভারি লিস্ট"),
    restore: tr(language, "Restore", "वापस लाएँ", "ফিরিয়ে আনুন"),
    restored: (number: string) =>
      tr(language, `${number} restored`, `${number} वापस आ गया`, `${number} ফিরিয়ে আনা হয়েছে`),
    restoreFailed: tr(language, "Could not restore this invoice", "यह बिल वापस नहीं आ सका", "এই বিল ফিরিয়ে আনা যায়নি"),
    cashCustomer: tr(language, "Cash customer", "कैश कस्टमर", "ক্যাশ কাস্টমার"),
    csvHeaders: [
      tr(language, "Invoice Number", "बिल नंबर", "বিল নম্বর"),
      tr(language, "Invoice Date", "बिल की तारीख", "বিলের তারিখ"),
      tr(language, "Customer", "कस्टमर", "কাস্টমার"),
      "GSTIN",
      tr(language, "Taxable Value", "टैक्सेबल रकम", "ট্যাক্সযোগ্য টাকা"),
      tr(language, "GST Amount", "GST रकम", "GST-এর টাকা"),
      tr(language, "Other Charges", "दूसरे चार्ज", "অন্য চার্জ"),
      tr(language, "Invoice Total", "बिल का कुल", "বিলের মোট"),
    ],
  };
  const trash = invoices.filter(
    (x) =>
      x.deletedAt &&
      renderTime - new Date(x.deletedAt).getTime() < 30 * 86400000,
  );
  const csvCell = (value: string | number) => {
    const original = String(value);
    const formulaLike =
      typeof value === "string" &&
      (/^[\s\uFEFF]*[=+\-@]/u.test(original) || /^[\t\r\n]/u.test(original));
    const safe = formulaLike ? `'${original}` : original;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  async function exportGstr() {
    const rows = [
      copy.csvHeaders,
      ...invoices
        .filter((x) => !x.deletedAt && x.type === "sale")
        .map((x) => [
          x.invoiceNumber,
          formatLocalizedDate(x.date, language, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }),
          x.partyId ? x.partyName : copy.cashCustomer,
          x.partyGstin || "",
          x.subtotal - x.discountTotal,
          x.gstTotal,
          x.otherChargesTotal || 0,
          x.grandTotal,
        ]),
    ];
    const csv = rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const name = `GSTR1-working-export-${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    if (
      await shareNativeBlob(blob, {
        fileName: name,
        title: copy.gstrTitle,
        dialogTitle: copy.gstrDialog,
      })
    ) {
      onToast(copy.gstrReady);
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
    onToast(copy.gstrExported);
  }
  async function restore(invoice: Invoice) {
    try {
      await restoreInvoice(invoice.id);
      onToast(copy.restored(invoice.invoiceNumber));
    } catch {
      onToast(copy.restoreFailed);
    }
  }
  async function saveShopDetails() {
    if (savingShop) return;
    setSavingShop(true);
    const normalized = normalizeBusinessSettings(draft);
    try {
      await onBusiness(normalized);
      setDraft(normalized);
    } catch {
      onToast(copy.shopSaveFailed);
    } finally {
      setSavingShop(false);
    }
  }
  return (
    <section className="mx-auto max-w-4xl px-3 py-5 md:px-7">
      <p className="eyebrow">{copy.settingsData}</p>
      <h2 className="page-title">{t(language, "more")}</h2>
      <div className="mobile-more-tools mt-4 grid grid-cols-2 gap-2 md:hidden">
        <button
          type="button"
          onClick={onInventory}
          className="more-tool-shortcut"
        >
          <span className="more-tool-icon" aria-hidden="true">▦</span>
          <span className="min-w-0 text-left">
            <strong>{inventoryText(language, "Inventory", "इन्वेंटरी", "ইনভেন্টরি")}</strong>
            <small>{inventoryText(language, "Stock, counts and returns", "स्टॉक, गिनती और रिटर्न", "স্টক, গোনা ও ফেরত")}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button
          type="button"
          onClick={onFestival}
          className="more-tool-shortcut"
        >
          <span className="more-tool-icon" aria-hidden="true">◷</span>
          <span className="min-w-0 text-left">
            <strong>{festivalCopy(language).title}</strong>
            <small>{festivalText(language, "Calendar, tags and reorder suggestions", "कैलेंडर, टैग और दोबारा ऑर्डर सुझाव", "ক্যালেন্ডার, ট্যাগ ও পুনরায় অর্ডারের পরামর্শ")}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {!workspace.hidden.includes("dues") && (
          <button
            type="button"
            onClick={() => onNavigate("dues")}
            className="more-tool-shortcut"
          >
            <span className="more-tool-icon" aria-hidden="true">₹</span>
            <span className="min-w-0 text-left">
              <strong>{t(language, "dues")}</strong>
              <small>{copy.duesHelp}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
        {!workspace.hidden.includes("misc") && (
          <button
            type="button"
            onClick={() => onNavigate("misc")}
            className="more-tool-shortcut"
          >
            <span className="more-tool-icon" aria-hidden="true">↘</span>
            <span className="min-w-0 text-left">
              <strong>{t(language, "misc")}</strong>
              <small>{copy.miscHelp}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
      {installable && (
        <button
          onClick={onInstall}
          className="mt-4 flex min-h-14 w-full items-center justify-between rounded-2xl bg-[#173f35] px-4 text-left text-white"
        >
          <div>
            <strong>{copy.installPhone}</strong>
            <p className="mt-1 text-[0.625rem] text-[#c6d6d0]">
              {copy.installHelp}
            </p>
          </div>
          <span className="text-2xl">↓</span>
        </button>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="settings-card">
          <h3>{copy.shopDetails}</h3>
          <p className="mt-1 text-[0.625rem] leading-5 text-[#6f7a74]">
            {copy.shopDetailsHelp}
          </p>
          <input
            aria-label={copy.shopName}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={copy.shopName}
            autoComplete="organization"
          />
          <input
            aria-label={copy.ownerName}
            value={draft.ownerName || ""}
            onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })}
            placeholder={copy.ownerName}
            autoComplete="name"
          />
          <input
            aria-label={copy.shopAddress}
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder={copy.address}
            autoComplete="street-address"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              aria-label={copy.shopPhone}
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              inputMode="tel"
              placeholder={copy.phone}
              autoComplete="tel"
            />
            <input
              aria-label={copy.alternatePhone}
              value={draft.alternatePhone || ""}
              onChange={(e) =>
                setDraft({ ...draft, alternatePhone: e.target.value })
              }
              inputMode="tel"
              placeholder={copy.alternatePhone}
              autoComplete="tel"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              aria-label={copy.billEmail}
              value={draft.email || ""}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              type="email"
              inputMode="email"
              placeholder={copy.billEmail}
              autoComplete="email"
            />
            <input
              aria-label={copy.shopGstin}
              value={draft.gstin}
              onChange={(e) =>
                setDraft({ ...draft, gstin: e.target.value.toUpperCase() })
              }
              placeholder="GSTIN"
            />
          </div>
          <button
            type="button"
            onClick={() => void saveShopDetails()}
            disabled={savingShop}
            className="counter-primary mt-2"
          >
            {savingShop ? copy.savingShop : copy.saveShop}
          </button>
        </section>
        <QualityOfLifeSettings
          language={language}
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
          <h3>{copy.language}</h3>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={copy.language}
          >
            {(["en", "hi", "bn"] as Language[]).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={language === x}
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
          <h3 className="mt-5">{copy.interfaceSize}</h3>
          <p className="mt-1 text-[0.625rem] leading-5 text-[#6f7a74]">
            {copy.interfaceSizeHelp}
          </p>
          <div
            className="interface-scale-picker mt-3"
            role="group"
            aria-label={copy.interfaceSize}
            style={
              {
                "--interface-scale-index":
                  interfaceScaleOptions.indexOf(interfaceScale),
              } as React.CSSProperties
            }
          >
            <span className="interface-scale-indicator" aria-hidden="true" />
            {interfaceScaleOptions.map((scale) => {
              const optionLabel = copy.interfaceScaleLabels[scale];
              return (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={interfaceScale === scale}
                  aria-label={`${optionLabel} (${scale}%)`}
                  title={`${optionLabel} · ${scale}%`}
                  onClick={() => onInterfaceScale(scale)}
                  className={interfaceScale === scale ? "active" : ""}
                >
                  {scale}%
                </button>
              );
            })}
          </div>
          <div className="interface-scale-preview" aria-live="polite">
            <span className="interface-scale-preview-type" aria-hidden="true">
              Aa
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-none stroke-current"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            <strong>
              {copy.interfaceScaleLabels[interfaceScale]} · {interfaceScale}%
            </strong>
          </div>
          <h3 className="mt-5">{copy.invoiceSize}</h3>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={copy.invoiceSize}
          >
            {(["a4", "a5", "thermal"] as InvoiceFormat[]).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={format === x}
                onClick={() => onFormat(x)}
                className={`h-12 rounded-xl border text-xs font-black ${format === x ? "border-[#ef7d32] bg-[#fff0df] text-[#b75b20]" : "border-[#d8d2c6]"}`}
              >
                {copy.invoiceFormats[x]}
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card">
          <h3>{copy.cloudBackup}</h3>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f2efe8] p-3">
            <div>
              <strong className="text-xs">{copy.supabaseSync}</strong>
              <p className="mt-1 text-[0.5625rem] text-[#748078]">
                {cloudConfigured
                  ? copy.cloudReady
                  : copy.cloudOffline}
              </p>
            </div>
            <span
              className={`h-3 w-3 rounded-full ${cloudConfigured ? "bg-emerald-500" : "bg-stone-400"}`}
            />
          </div>
          <p className="mt-3 text-[0.625rem] leading-5 text-[#6f7a74]">
            {copy.cloudHelp}
          </p>
          {ownerMode ? <>
            <label className="product-field mt-3">
              <span>{copy.projectUrl}</span>
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
              <span>{copy.anonKey}</span>
              <input
                type="password"
                value={cloudDraft.key}
                onChange={(event) =>
                  setCloudDraft({ ...cloudDraft, key: event.target.value })
                }
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={copy.pasteAnonKey}
              />
            </label>
            <label className="product-field mt-2">
              <span>{copy.privateSyncCode}</span>
              <input
                type="password"
                value={cloudDraft.syncCode}
                onChange={(event) =>
                  setCloudDraft({ ...cloudDraft, syncCode: event.target.value })
                }
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={copy.sameCode}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                try {
                  setCloudDraft({
                    ...cloudDraft,
                    syncCode: generateBusinessSyncCode(),
                  });
                } catch {
                  onToast(copy.generateCodeFailed);
                }
              }}
              className="mt-2 text-left text-[0.625rem] font-black text-[#267055]"
            >
              {copy.generateCode}
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onCloud(cloudDraft)}
                className="counter-primary"
              >
                {copy.saveSync}
              </button>
              <button
                type="button"
                disabled={!cloudConfigured}
                onClick={async () => {
                  if (await onCloudDisconnect())
                    setCloudDraft({ url: "", key: "", syncCode: "" });
                }}
                className="counter-secondary disabled:opacity-40"
              >
                {copy.disconnect}
              </button>
            </div>
          </> : <div className="mt-3 rounded-xl border border-[#d8d2c6] bg-[#f8f5ee] p-3">
            <strong className="text-xs text-[#173f35]">
              {copy.ownerUnlockRequired}
            </strong>
            <p className="mt-1 text-[0.625rem] leading-5 text-[#6f7a74]">
              {copy.ownerCloudHelp}
            </p>
            <button type="button" onClick={onOwnerSetup} className="counter-secondary mt-3">
              {ownerConfigured ? copy.unlockCloud : copy.createOwnerPin}
            </button>
          </div>}
        </section>
        <section className="settings-card">
          <h3>{copy.gstExport}</h3>
          <p className="mt-2 text-[0.625rem] leading-5 text-[#6f7a74]">
            {copy.gstHelp}
          </p>
          <button onClick={exportGstr} className="counter-secondary mt-3">
            ↓ {copy.exportGstr}
          </button>
        </section>
        {trash.length > 0 && (
          <section className="settings-card md:col-span-2">
            <h3>{copy.invoiceBin}</h3>
            <div className="mt-3 space-y-2">
              {trash.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between rounded-xl bg-[#f5eee9] p-3"
                >
                  <div>
                    <strong className="text-xs">{invoice.invoiceNumber}</strong>
                    <p className="mt-1 text-[0.5625rem] text-[#7d817e]">
                      {invoice.partyId ? invoice.partyName : copy.cashCustomer} ·{" "}
                      {formatMoney(invoice.grandTotal)}
                    </p>
                  </div>
                  <button
                    onClick={() => restore(invoice)}
                    className="rounded-lg bg-white px-3 py-2 text-[0.625rem] font-black text-[#267055]"
                  >
                    {copy.restore}
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
  language,
  business,
  format,
  onClose,
  onPreview,
  shareMessage,
}: {
  invoice: Invoice;
  language: Language;
  business: BusinessSettings;
  format: InvoiceFormat;
  onClose: () => void;
  onPreview: (format: InvoiceFormat) => void;
  shareMessage: string;
}) {
  const [selectedFormat, setSelectedFormat] = useState<InvoiceFormat>(format);
  const [actionError, setActionError] = useState("");
  const quotation = invoice.type === "quotation";
  const partyName = invoice.partyId
    ? invoice.partyName
    : tr(language, "Cash customer", "कैश कस्टमर", "ক্যাশ কাস্টমার");
  const copy = {
    quotationSaved: tr(
      language,
      "Quotation saved",
      "कोटेशन सेव हुआ",
      "কোটেশন সেভ হয়েছে",
    ),
    billSaved: tr(language, "Bill saved", "बिल सेव हुआ", "বিল সেভ হয়েছে"),
    taxable: tr(language, "Taxable", "टैक्सेबल", "ট্যাক্সযোগ্য"),
    charges: tr(language, "Charges", "चार्ज", "চার্জ"),
    due: tr(language, "Due", "बाकी", "বাকি"),
    estimateHelp: tr(
      language,
      "Estimate only. Customer due and last-sale prices were not changed.",
      "सिर्फ अनुमान। कस्टमर की बाकी और पिछला सेल रेट नहीं बदला।",
      "শুধু আনুমানিক। কাস্টমারের বাকি ও আগের সেল রেট বদলায়নি।",
    ),
    receivedNow: tr(language, "Received now", "अभी मिला", "এখন পাওয়া"),
    addedToDues: (amount: string, party: string) =>
      tr(
        language,
        `${amount} was automatically added to ${party} in Dues.`,
        `${party} की बाकी में ${amount} अपने-आप जुड़ गए।`,
        `${party}-র বাকিতে ${amount} নিজে থেকেই যোগ হয়েছে।`,
      ),
    chooseLayout: tr(
      language,
      "Choose print layout",
      "प्रिंट लेआउट चुनें",
      "প্রিন্ট লেআউট বাছুন",
    ),
    preview: tr(
      language,
      "Preview exact PDF before printing",
      "प्रिंट से पहले सही PDF देखें",
      "প্রিন্টের আগে ঠিক PDF দেখুন",
    ),
    printQuotation: tr(
      language,
      "Print quotation",
      "कोटेशन प्रिंट करें",
      "কোটেশন প্রিন্ট করুন",
    ),
    printFailed: tr(
      language,
      "Could not prepare the print PDF.",
      "प्रिंट PDF तैयार नहीं हो सकी।",
      "প্রিন্ট PDF তৈরি করা যায়নি।",
    ),
    printLayout: (layout: string) =>
      tr(
        language,
        `Print ${layout}`,
        `${layout} प्रिंट करें`,
        `${layout} প্রিন্ট করুন`,
      ),
    shareQuotation: tr(
      language,
      "Share quotation on WhatsApp",
      "कोटेशन WhatsApp पर भेजें",
      "কোটেশন WhatsApp-এ পাঠান",
    ),
    sharePdf: tr(
      language,
      "Share detailed PDF on WhatsApp",
      "डिटेल PDF WhatsApp पर भेजें",
      "ডিটেল PDF WhatsApp-এ পাঠান",
    ),
    backToBilling: tr(
      language,
      "Back to billing",
      "बिलिंग पर वापस",
      "বিলিংয়ে ফিরুন",
    ),
    startNextBill: tr(
      language,
      "Start next bill",
      "अगला बिल शुरू करें",
      "পরের বিল শুরু করুন",
    ),
  };
  const formatLabels: Record<InvoiceFormat, string> = {
    a4: tr(language, "A4 detailed", "A4 डिटेल", "A4 ডিটেল"),
    a5: tr(language, "A5 compact", "A5 कॉम्पैक्ट", "A5 কমপ্যাক্ট"),
    thermal: tr(
      language,
      "3-inch thermal",
      "3-इंच थर्मल",
      "3-ইঞ্চি থার্মাল",
    ),
  };
  async function printSavedInvoice() {
    setActionError("");
    const prepared = preparePrintWindow();
    try {
      await printInvoice(
        invoice,
        business,
        selectedFormat,
        prepared,
        language,
      );
    } catch {
      prepared?.close();
      setActionError(copy.printFailed);
    }
  }
  return (
    <SheetFrame
      title={
        quotation
          ? copy.quotationSaved
          : copy.billSaved
      }
      onClose={onClose}
    >
      <div className="rounded-3xl bg-[#e9f3ed] p-5 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#2f7a5e] text-2xl font-black text-white">
          ✓
        </div>
        <h3 className="mt-3 text-xl font-black">{invoice.invoiceNumber}</h3>
        <p className="mt-1 text-xs text-[#62746c]">{partyName}</p>
        <strong className="mt-3 block text-3xl text-[#173f35]">
          {formatMoney(invoice.grandTotal)}
        </strong>
        <div
          className={`mx-auto mt-3 grid max-w-sm gap-2 text-center ${quotation ? "grid-cols-3" : "grid-cols-4"}`}
        >
          <div>
            <span className="block text-[0.5rem] font-black uppercase text-[#748078]">
              {copy.taxable}
            </span>
            <strong className="text-[0.6875rem]">
              {formatMoney(invoice.subtotal - invoice.discountTotal)}
            </strong>
          </div>
          <div>
            <span className="block text-[0.5rem] font-black uppercase text-[#748078]">
              GST
            </span>
            <strong className="text-[0.6875rem]">
              {formatMoney(invoice.gstTotal)}
            </strong>
          </div>
          <div>
            <span className="block text-[0.5rem] font-black uppercase text-[#748078]">
              {copy.charges}
            </span>
            <strong className="text-[0.6875rem]">
              {formatMoney(invoice.otherChargesTotal || 0)}
            </strong>
          </div>
          {!quotation && (
            <div>
              <span className="block text-[0.5rem] font-black uppercase text-[#748078]">
                {copy.due}
              </span>
              <strong className="text-[0.6875rem] text-[#b65b2b]">
                {formatMoney(invoice.amountDue)}
              </strong>
            </div>
          )}
        </div>
        {quotation && (
          <p className="bill-preview-estimate mx-auto mt-3 max-w-sm">
            {copy.estimateHelp}
          </p>
        )}
        {!quotation && invoice.amountDue > 0 && (
          <div className="mx-auto mt-3 max-w-sm rounded-xl border border-[#e8c69f] bg-[#fff7ed] p-3 text-left">
            <p className="text-[0.625rem] font-black text-[#267055]">
              {copy.receivedNow}: {formatMoney(invoice.amountPaid)}
              {invoice.amountPaid > 0
                ? ` · ${invoicePaymentLabel(invoice, language)}`
                : ""}
            </p>
            <p className="mt-1 text-[0.625rem] font-black text-[#b65b2b]">
              {copy.addedToDues(formatMoney(invoice.amountDue), partyName)}
            </p>
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="field-caption mb-2">{copy.chooseLayout}</p>
        <div
          role="group"
          aria-label={copy.chooseLayout}
          className="grid grid-cols-3 gap-2"
        >
          {(["a4", "a5", "thermal"] as InvoiceFormat[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelectedFormat(option)}
              aria-pressed={selectedFormat === option}
              className={`min-h-12 rounded-lg border px-2 text-[0.625rem] font-black ${selectedFormat === option ? "border-[#014921] bg-[#014921] text-white" : "border-[#d8d2c6] bg-white"}`}
            >
              {formatLabels[option]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        <button
          onClick={() => onPreview(selectedFormat)}
          className="counter-secondary"
        >
          {copy.preview}
        </button>
        <button
          onClick={() => void printSavedInvoice()}
          className="counter-primary"
        >
          {quotation
            ? copy.printQuotation
            : copy.printLayout(formatLabels[selectedFormat])}
        </button>
        <button
          onClick={() =>
            void shareInvoice(
              invoice,
              business,
              selectedFormat,
              null,
              shareMessage,
              language,
            )
          }
          className="counter-secondary text-emerald-700"
        >
          {quotation ? copy.shareQuotation : copy.sharePdf}
        </button>
        <button onClick={onClose} className="counter-secondary">
          {quotation ? copy.backToBilling : copy.startNextBill}
        </button>
        {actionError && (
          <p
            role="alert"
            className="rounded-xl bg-[#fbe9e5] p-3 text-xs font-bold text-[#a74432]"
          >
            {actionError}
          </p>
        )}
      </div>
    </SheetFrame>
  );
}
