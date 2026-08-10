import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

let accountingLogicPromise;
const loadAccountingLogic = () => {
  accountingLogicPromise ||= build({
    stdin: {
      contents: [
        'export { invoiceInitialPaymentBreakdown, partyDueStatement } from "./lib/billing";',
        'export { buildCashFlowReport } from "./lib/cashflow";',
        'export { buildDashboardTrendBuckets, buildSalesSettlementReport, dashboardPeriodRange } from "./lib/report-dashboard";',
        'export { dailyCashSummary } from "./lib/qol";',
      ].join("\n"),
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      sourcefile: "mobile-package-accounting-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    treeShaking: true,
    write: false,
    logLevel: "silent",
  }).then(({ outputFiles }) =>
    import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
    ),
  );
  return accountingLogicPromise;
};

const splitPaymentFixture = () => {
  const createdAt = "2026-08-10T10:00:00.000Z";
  const party = {
    id: "party-split",
    type: "customer",
    name: "Split Tender Customer",
    codeName: "",
    phone: "9000000000",
    address: "Burrabazar",
    gstin: "",
    notes: "",
    priceTier: "wholesale",
    openingBalance: 0,
    currentBalance: 200,
    isActive: true,
    createdAt,
    updatedAt: "2026-08-10T11:00:00.000Z",
    isSynced: false,
  };
  const invoice = {
    id: "invoice-split",
    invoiceNumber: "MK-1000",
    type: "sale",
    partyId: party.id,
    partyName: party.name,
    partyCode: party.codeName,
    date: "2026-08-10",
    lineItems: [],
    subtotal: 1000,
    taxableAmount: 1000,
    gstEnabled: false,
    gstRate: 0,
    gstAmount: 0,
    discountAmount: 0,
    otherCharges: [],
    otherChargesTotal: 0,
    grandTotal: 1000,
    initialAmountPaid: 600,
    amountPaid: 800,
    amountDue: 200,
    paymentMode: "mixed",
    paymentBreakdown: [
      { mode: "cash", amount: 250 },
      { mode: "upi", amount: 200, reference: "UPI-1000" },
      { mode: "cheque", amount: 150, reference: "CHQ-1000" },
    ],
    notes: "",
    isSynced: false,
    createdAt,
    updatedAt: createdAt,
  };
  const laterPayment = {
    id: "payment-bank",
    partyId: party.id,
    amount: 200,
    date: "2026-08-10",
    mode: "bank",
    reference: "BANK-1000",
    allocatedTo: [{ invoiceId: invoice.id, amount: 200 }],
    createdAt: "2026-08-10T11:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
    isSynced: false,
  };
  return { party, invoice, laterPayment };
};

test("mobile build is a self-contained offline startup bundle", async () => {
  const html = await read("mobile-dist/index.html");
  assert.match(html, /<title>Midori Kanjo<\/title>/);
  assert.match(html, /\.\/assets\//);
  assert.doesNotMatch(html, /https:\/\/burrabazar-billing\./);
  const assets = await readdir(
    new URL("../mobile-dist/assets/", import.meta.url),
  );
  assert.ok(
    assets.some((name) => name.endsWith(".js")),
    "compiled JavaScript is bundled",
  );
  assert.ok(
    assets.some((name) => name.endsWith(".css")),
    "compiled styles are bundled",
  );
});

test("mobile and Android packages contain no orphaned hashed asset generations", async () => {
  const assetUrl = new URL("../mobile-dist/assets/", import.meta.url);
  const androidAssetUrl = new URL(
    "../android/app/src/main/assets/public/assets/",
    import.meta.url,
  );
  const allAssets = (await readdir(assetUrl)).sort();
  assert.deepEqual((await readdir(androidAssetUrl)).sort(), allAssets);

  const reachable = new Set();
  const pending = [
    ...(await read("mobile-dist/index.html")).matchAll(
      /assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g,
    ),
  ].map((match) => match[1]);
  while (pending.length) {
    const name = pending.pop();
    if (!name || reachable.has(name)) continue;
    assert.ok(allAssets.includes(name), `referenced asset ${name} must exist`);
    reachable.add(name);
    const content = await readFile(new URL(name, assetUrl), "utf8");
    for (const match of content.matchAll(
      /(?:\.\/)?([A-Za-z0-9_.-]+\.(?:js|css))/g,
    )) {
      if (allAssets.includes(match[1]) && !reachable.has(match[1]))
        pending.push(match[1]);
    }
  }
  assert.deepEqual([...reachable].sort(), allAssets);

  const buildScript = await read("scripts/mobile-build-verified.mjs");
  assert.match(buildScript, /await buildLock\.acquire\(\)/);
  assert.match(buildScript, /fresh token-specific heartbeat/);
  assert.doesNotMatch(buildScript, /process\.kill\(/);
  assert.match(buildScript, /owner\?\.token !== token/);
  assert.match(buildScript, /await rm\(outputDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(buildScript, /await clearGeneratedAndroidWebAssets\(\)/);
});

test("the visible product credit is branded for Sayan Finance", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /Made by Sayan Finance/);
});

test("hosted phone install has a complete offline PWA manifest", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Midori Kanjo");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.ok(
    manifest.icons.some(
      (icon) => icon.sizes === "192x192" && icon.type === "image/png",
    ),
  );
  assert.ok(
    manifest.icons.some(
      (icon) => icon.sizes === "512x512" && icon.type === "image/png",
    ),
  );
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /midori-kanjo-v6/);
  assert.match(serviceWorker, /caches\.match\("\/"\)/);
});

test("phone layout keeps five primary tabs and billing actions inline", async () => {
  const source = await read("app/BillingApp.tsx");
  const styles = await read("app/globals.css");
  const billScreen = source.slice(
    source.indexOf("function BillScreen("),
    source.indexOf("function GstControl("),
  );
  const actionClass = billScreen.match(
    /className="bill-payment-actions[^"]*"/,
  )?.[0];
  assert.match(
    source,
    /const mobilePrimaryKeys: Tab\[\] = \["bill", "parties", "items", "reports", "more"\]/,
  );
  assert.match(source, /onNavigate\("dues"\)/);
  assert.match(source, /onNavigate\("misc"\)/);
  assert.match(styles, /\.app-main-nav-mobile\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(source, /className="bill-payment-actions mt-4 grid gap-2"/);
  assert.ok(actionClass, "billing actions remain inside the payment summary");
  assert.doesNotMatch(actionClass, /hidden|fixed|sticky/);
  for (const action of ["print", "whatsapp", "save"]) {
    assert.equal(
      [...billScreen.matchAll(new RegExp(`onSave\\(\\"${action}\\"\\)`, "g"))]
        .length,
      1,
      `${action} has one in-flow billing action`,
    );
  }
  assert.doesNotMatch(source, /<BillDock|function BillDock|bill-dock/);
  assert.doesNotMatch(
    styles,
    /--bill-dock-height|\.bill-dock|\.has-bill-dock|\.bill-payment-actions\s*\{[^}]*display\s*:\s*none/,
  );
  assert.match(source, /function NavigationIcon/);
  assert.match(source, /className="app-language-select"/);
});

test("inventory stays nested under Items with accessible Phase 2 routes and Android unwind", async () => {
  const source = await read("app/BillingApp.tsx");
  const inventory = await read("app/InventoryWorkspace.tsx");
  const copy = await read("app/inventory-copy.ts");

  assert.match(source, /type ItemsMode = "catalogue" \| "inventory"/);
  assert.match(source, /itemsMode === "inventory" \? \(/);
  assert.match(source, /<InventoryWorkspace/);
  assert.doesNotMatch(source, /type Tab\s*=.*inventory/);
  assert.match(source, /onInventory=\{\(\) => \{/);
  assert.match(source, /setTab\("items"\)/);
  assert.match(source, /inventoryRoute\.page === "count" && inventoryRoute\.reviewOpen/);
  assert.match(source, /lowStockThreshold\.trim\(\) === ""/);

  assert.match(inventory, /data-inventory-action=/);
  for (const action of ["inward", "outward", "saleReturn", "purchaseReturn", "adjustment", "count"])
    assert.match(inventory, new RegExp(`key: "${action}"`));
  assert.match(inventory, /data-inventory-view="hub"/);
  assert.match(inventory, /data-stock-state=\{stockState\(selected\)\}/);
  assert.match(inventory, /role="status" aria-live="polite"/);
  assert.match(inventory, /<AccessibleSheet/);
  assert.match(inventory, /currentStock === null/);
  assert.match(inventory, /reviewOpen: true/);
  assert.match(copy, /Every change is logged/);
  assert.match(copy, /हर बदलाव दर्ज होता है/);
  assert.match(copy, /প্রতিটি পরিবর্তন লেখা থাকে/);
});

test("billing exposes a full same-invoice split flow without treating it as due", async () => {
  const source = await read("app/BillingApp.tsx");
  const billScreen = source.slice(
    source.indexOf("function BillScreen("),
    source.indexOf("function GstControl("),
  );
  assert.match(
    billScreen,
    /paymentPlan === "full" \? !splitPayment \|\| \(splitMatchesTotal && splitHasMultipleMethods\)/,
  );
  assert.match(billScreen, /"Split methods", "कई तरीकों से", "একাধিক মাধ্যমে"/);
  assert.match(
    billScreen,
    /This settles the bill now and creates no due\./,
  );
  assert.match(billScreen, /paymentChannels\.map\(\(mode\) =>/);
  assert.match(billScreen, /Set \$\{t\(language, mode\)\} to half of the bill/);
  assert.match(billScreen, /aria-label=\{tr\([\s\S]*?transaction reference/);
  assert.match(billScreen, /className="mt-2 min-h-11 w-full rounded-lg border/);
  assert.match(billScreen, /role="status" aria-live="polite"/);
  assert.match(
    billScreen,
    /bill-workspace-grid grid gap-4 xl:grid-cols-\[1\.45fr_\.75fr\]/,
  );
  assert.doesNotMatch(
    billScreen,
    /bill-workspace-grid grid gap-4 md:grid-cols/,
  );
});

test("phone controls have touch targets and landscape phones keep the mobile workspace", async () => {
  const source = await read("app/BillingApp.tsx");
  const styles = await read("app/globals.css");
  assert.match(
    styles,
    /@media \(max-width:767px\)[\s\S]*?\.cartesia-shell button \{ min-height:44px; \}/,
  );
  assert.match(
    styles,
    /@media \(max-width:1024px\) and \(max-height:600px\) and \(orientation:landscape\)/,
  );
  assert.match(styles, /\.app-main-nav-mobile \{[^}]*display:grid!important;[^}]*grid-template-columns:/);
  assert.match(styles, /\.bill-workspace-grid \{ grid-template-columns:minmax\(0,1fr\)!important; \}/);
  assert.match(source, /className="charge-toggle-button grid h-11/);
  assert.doesNotMatch(source, /onMouseDown=/);
});

test("mobile viewport remains zoomable and both orientations are supported", async () => {
  const mobileHtml = await read("mobile/index.html");
  const layout = await read("app/layout.tsx");
  assert.doesNotMatch(mobileHtml, /maximum-scale/i);
  assert.doesNotMatch(layout, /maximumScale/);
  assert.match(mobileHtml, /name="color-scheme" content="light dark"/);
  assert.match(layout, /statusBarStyle: "black-translucent"/);
});

test("Android package embeds the mobile build instead of depending on a website", async () => {
  const config = JSON.parse(
    await read("android/app/src/main/assets/capacitor.config.json"),
  );
  assert.equal(config.appId, "com.mantu.billing");
  assert.equal(config.appName, "Midori Kanjo");
  assert.equal(config.webDir, "mobile-dist");
  assert.equal(config.server?.url, undefined);
  const embedded = await read("android/app/src/main/assets/public/index.html");
  assert.match(embedded, /Midori Kanjo/);
  const activity = await read(
    "android/app/src/main/java/com/mantu/billing/MainActivity.java",
  );
  assert.match(activity, /extends\s+BridgeActivity/);
  assert.doesNotMatch(activity, /narraleaf|WebViewClient/);
});

test("Android package includes native sharing, files, browser and back-button support", async () => {
  const plugins = JSON.parse(
    await read("android/app/src/main/assets/capacitor.plugins.json"),
  );
  const classes = plugins.map((plugin) => plugin.classpath);
  assert.ok(classes.some((value) => value.includes("FilesystemPlugin")));
  assert.ok(classes.some((value) => value.includes("SharePlugin")));
  assert.ok(classes.some((value) => value.includes("BrowserPlugin")));
  assert.ok(classes.some((value) => value.includes("AppPlugin")));
});

test("Android manifest requests no broad storage or location permissions", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(
    manifest,
    /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|ACCESS_FINE_LOCATION/,
  );
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.doesNotMatch(manifest, /android:screenOrientation="portrait"/);
  const icon = new URL(
    "../android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml",
    import.meta.url,
  );
  assert.ok(
    (await stat(icon)).size > 100,
    "custom Midori Kanjo launcher artwork is present",
  );
});

test("cloud backup is isolated by a strong per-business sync code", async () => {
  const schema = await read("supabase/schema.sql");
  const sync = await read("lib/sync.ts");
  assert.doesNotMatch(schema, /using\s*\(true\)/i);
  assert.match(schema, /create or replace function public\.current_business_id\(\)/);
  assert.match(
    schema,
    /extensions\.digest\([\s\S]*?auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'sync_code'[\s\S]*?'sha256'/,
  );
  assert.match(schema, /business_id\s*=\s*public\.current_business_id\(\)/);
  assert.match(
    schema,
    /length\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'sync_code'\)\s*>=\s*20/,
  );
  assert.match(sync, /syncCode\.length\s*<\s*20/);
  assert.match(
    sync,
    /signInAnonymously\(\{\s*options:\s*\{\s*data:\s*\{\s*sync_code:\s*syncCode/,
  );
});

test("sheets and the number pad provide complete keyboard dialog behavior", async () => {
  const source = await read("app/BillingApp.tsx");
  const qol = await read("app/QolPanels.tsx");
  const dialog = await read("app/AccessibleDialog.tsx");
  assert.match(source, /<AccessibleSheet[\s\S]*?title=\{title\}/);
  assert.match(source, /const panelRef = useDialogFocus\(onClose\)/);
  assert.match(source, /data-dialog-backdrop/);
  assert.match(source, /data-dialog-initial-focus/);
  assert.match(qol, /<AccessibleSheet/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /element\.inert = true/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /restoreFocus\.focus\(\{ preventScroll: true \}\)/);
});

test("interactive controls retain typography, visible focus and phone-safe input sizing", async () => {
  const styles = await read("app/globals.css");
  assert.match(styles, /button,input,select,textarea \{ font-family:inherit; \}/);
  assert.doesNotMatch(styles, /button,input,select,textarea \{ font:inherit; \}/);
  assert.match(styles, /--color-focus-ring:#005a2b/);
  assert.match(styles, /focus-visible \{ outline:3px solid var\(--color-focus-ring\)!important;/);
  assert.match(styles, /@media \(max-width:1024px\) and \(pointer:coarse\)/);
  assert.match(styles, /input,select,textarea,\.app-language-select select \{ font-size:1rem!important; \}/);
  assert.match(styles, /--color-border:#858b86/);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*?--color-border:#647369/);
});

test("billing controls, searches and settings expose meaningful accessible state", async () => {
  const source = await read("app/BillingApp.tsx");
  const qol = await read("app/QolPanels.tsx");
  const reports = await read("app/AdvancedReports.tsx");
  assert.match(
    source,
    /aria-label=\{`\$\{tr\(language,\s*"Remove from bill",\s*"बिल से हटाएँ",\s*"বিল থেকে সরান"\)\}: \$\{displayName\}`\}/,
  );
  assert.match(
    source,
    /aria-label=\{tr\(\s*language,\s*`Unit for \$\{displayName\}`,\s*`\$\{displayName\} की यूनिट`,\s*`\$\{displayName\}-এর ইউনিট`,?\s*\)\}/,
  );
  assert.match(
    source,
    /aria-label=\{tr\(language, "Search products to add to bill", "बिल में जोड़ने के लिए आइटम खोजें", "বিলে যোগ করতে আইটেম খুঁজুন"\)\}/,
  );
  assert.match(
    source,
    /shopGstin: tr\(language, "Shop GSTIN", "दुकान का GSTIN", "দোকানের GSTIN"\)/,
  );
  assert.match(source, /aria-label=\{copy\.shopGstin\}/);
  assert.match(source, /aria-pressed=\{language === x\}/);
  assert.match(qol, /printerName: "Printer profile name"/);
  assert.match(qol, /printerName: "प्रिंटर प्रोफाइल का नाम"/);
  assert.match(qol, /printerName: "প্রিন্টার প্রোফাইলের নাম"/);
  assert.match(qol, /aria-label=\{copy\.settings\.printerName\}/);
  assert.match(qol, /aria-pressed=\{section === key\}/);
  assert.match(reports, /aria-pressed=\{report === key\}/);
  assert.match(reports, /aria-pressed=\{tier === value\}/);
});

test("status updates and report tables are announced and keyboard reachable", async () => {
  const source = await read("app/BillingApp.tsx");
  const qol = await read("app/QolPanels.tsx");
  const reports = await read("app/AdvancedReports.tsx");
  assert.match(source, /role="status"[\s\S]*?aria-live="polite"/);
  assert.match(source, /recentTable: "Recent invoices table"/);
  assert.match(source, /recentTable: "हाल के बिलों की टेबल"/);
  assert.match(source, /recentTable: "সাম্প্রতিক বিলের টেবিল"/);
  assert.match(
    source,
    /className="report-recent-invoice-list"[\s\S]*?role="list"[\s\S]*?aria-label=\{copy\.recentTable\}/,
  );
  assert.match(
    source,
    /className="report-recent-invoice-table-region"[\s\S]*?role="region"[\s\S]*?aria-label=\{copy\.recentTable\}/,
  );
  assert.match(
    source,
    /openInvoice: \(number: string, party: string\) => `Open invoice \$\{number\} for \$\{party\}`/,
  );
  assert.match(
    source,
    /aria-label=\{copy\.openInvoice\(\s*invoice\.invoiceNumber,\s*localizedInvoicePartyName\(language, invoice\),\s*\)\}/,
  );
  assert.doesNotMatch(source, /<tr[^>]*role="button"/);
  assert.match(qol, /activityTable: "Activity history table"/);
  assert.match(qol, /activityTable: "काम की हिस्ट्री"/);
  assert.match(qol, /activityTable: "কাজের হিস্ট্রি"/);
  assert.match(
    qol,
    /aria-label=\{copy\.settings\.activityTable\}\s*tabIndex=\{0\}/,
  );
  assert.match(reports, /className="report-table-scroller"[\s\S]*?role="region"[\s\S]*?tabIndex=\{0\}/);
});

test("archived products are searchable, restorable and never confuse merged aliases", async () => {
  const [source, qol, styles, activity] = await Promise.all([
    read("app/BillingApp.tsx"),
    read("lib/qol.ts"),
    read("app/globals.css"),
    read("app/QolPanels.tsx"),
  ]);
  assert.match(source, /archivedItems=\{reportItems\.filter\(isRestorableArchivedItem\)\}/);
  assert.match(source, /role="group"\s+aria-label=\{copy\.catalogueViews\}/);
  assert.match(source, /aria-pressed=\{catalogueView === "active"\}/);
  assert.match(source, /aria-pressed=\{catalogueView === "archived"\}/);
  assert.match(source, /aria-label=\{copy\.restoreProduct\(localizedItemName\(language, item\)\)\}/);
  assert.match(source, /className="counter-primary mt-3 min-h-11 w-full/);
  assert.match(source, /activeProducts: "Active products"/);
  assert.match(source, /archivedProducts: "Archived products"/);
  assert.match(source, /restore: "Restore product"/);
  assert.match(source, /activeProducts: "चालू प्रोडक्ट"/);
  assert.match(source, /archivedProducts: "आर्काइव प्रोडक्ट"/);
  assert.match(source, /restore: "प्रोडक्ट वापस लाएँ"/);
  assert.match(source, /activeProducts: "চালু পণ্য"/);
  assert.match(source, /archivedProducts: "আর্কাইভ করা পণ্য"/);
  assert.match(source, /restore: "পণ্য ফিরিয়ে আনুন"/);
  assert.match(qol, /export function isRestorableArchivedItem/);
  assert.match(qol, /!item\.isActive[\s\S]*?!item\.festivalTags\.some\(\(tag\) => tag\.startsWith\("aliasOf:"\)\)/);
  assert.match(qol, /export async function restoreArchivedItem/);
  assert.match(qol, /isActive: true[\s\S]*?isSynced: false/);
  assert.match(qol, /action: "item\.restored"/);
  assert.match(styles, /\.item-catalogue-tabs button \{[\s\S]*?min-height:44px/);
  assert.match(activity, /"item\.restored": "Item restored"/);
  assert.match(activity, /"item\.restored": "सामान वापस लाया"/);
  assert.match(activity, /"item\.restored": "পণ্য ফিরিয়ে আনা"/);
});

test("recent invoices use the full report width and keep totals visible without sideways scrolling", async () => {
  const [source, styles] = await Promise.all([
    read("app/BillingApp.tsx"),
    read("app/globals.css"),
  ]);
  const start = source.indexOf('<h3 className="dashboard-title">{copy.recentInvoices}</h3>');
  const end = source.indexOf("{reportHistoryCopy[language].section}", start);
  assert.ok(start >= 0 && end > start);
  const recent = source.slice(source.lastIndexOf("<article", start), end);
  assert.match(recent, /xl:col-span-12/);
  assert.doesNotMatch(recent, /xl:col-span-7/);
  assert.doesNotMatch(recent, /min-w-\[650px\]/);
  assert.match(recent, /className="report-recent-invoice-list"[\s\S]*?role="list"/);
  assert.match(recent, /className="report-recent-invoice-card__amounts"[\s\S]*?\{copy\.total\}[\s\S]*?\{copy\.due\}/);
  assert.match(recent, /className="report-recent-invoice-table-region"[\s\S]*?<table className="dashboard-table report-recent-invoice-table">/);
  assert.match(styles, /\.report-recent-invoice-table-region \{ display:none; overflow-x:hidden; \}/);
  assert.match(styles, /\.report-recent-invoice-table \{ width:100%; table-layout:fixed; \}/);
  assert.match(styles, /@media \(min-width:1280px\)[\s\S]*?\.report-recent-invoice-list \{ display:none; \}[\s\S]*?\.report-recent-invoice-table-region \{ display:block; \}/);
});

test("startup, durable storage and the one-shot install prompt fail safely", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(
    source,
    /await seedIfNeeded\(\);\s*await reconcilePartyBalances\(\);/,
  );
  assert.ok(
    source.indexOf("await reconcilePartyBalances();") <
      source.indexOf("setReady(true);"),
    "legacy accounting data is reconciled before the UI becomes ready",
  );
  assert.match(source, /catch \(error\)[\s\S]*?setStartupError/);
  assert.match(source, /role="alert"[\s\S]*?Offline data could not open/);
  assert.match(source, /Do not uninstall or clear site data/);
  assert.match(source, /navigator\.storage\.persist\(\)/);
  assert.match(source, /window\.addEventListener\("appinstalled", installed\)/);
  assert.match(source, /setInstallEvent\(undefined\)[\s\S]*?await event\.prompt\(\)/);
  assert.match(source, /await event\.userChoice/);
});

test("party ledgers show complete bills, initial receipts and later payments", async () => {
  const source = await read("app/BillingApp.tsx");
  const ledger = source.slice(
    source.indexOf("function PartyLedger("),
    source.indexOf("function ItemsScreen("),
  );
  const { partyDueStatement } = await loadAccountingLogic();
  const { party, invoice, laterPayment } = splitPaymentFixture();
  const statement = partyDueStatement(
    party,
    [invoice],
    [laterPayment],
    [],
  );

  assert.deepEqual(
    statement.rows.map((row) => ({
      kind: row.kind,
      mode: row.paymentMode,
      due: row.dueAdded,
      paid: row.paymentReceived,
      balance: row.runningBalance,
    })),
    [
      { kind: "sale_invoice", mode: undefined, due: 1000, paid: 0, balance: 1000 },
      { kind: "payment", mode: "cash", due: 0, paid: 250, balance: 750 },
      { kind: "payment", mode: "upi", due: 0, paid: 200, balance: 550 },
      { kind: "payment", mode: "cheque", due: 0, paid: 150, balance: 400 },
      { kind: "payment", mode: "bank", due: 0, paid: 200, balance: 200 },
    ],
  );
  assert.equal(statement.totalDueAdded, 1000);
  assert.equal(statement.totalPaid, 800);
  assert.equal(statement.remainingDue, 200);

  assert.match(ledger, /const payableInvoiceType: Invoice\["type"\]/);
  assert.match(
    ledger,
    /!entry\.deletedAt && entry\.type === payableInvoiceType/,
  );
  assert.match(ledger, /delta: entry\.grandTotal/);
  assert.match(ledger, /invoiceInitialPaymentBreakdown\(/);
  assert.match(ledger, /\.\.\.initialBreakdown\.map\(/);
  assert.match(ledger, /paymentModeLabel\(allocation\.mode, language\)/);
  assert.match(ledger, /delta: -allocation\.amount/);
  assert.match(ledger, /id: `invoice-payment-\$\{entry\.id\}-\$\{index\}`/);
  assert.match(ledger, /priority: 2,[\s\S]*?type: copy\.payment/);
  assert.match(
    ledger,
    /a\.timestamp\.localeCompare\(b\.timestamp\)[\s\S]*?a\.priority - b\.priority[\s\S]*?a\.id\.localeCompare\(b\.id\)/,
  );
  assert.doesNotMatch(
    ledger,
    /entry\.amountDue \+ \(allocationByInvoice\.get\(entry\.id\)/,
  );
});

test("dashboard periods and settlement chart reconcile to selected sales", async () => {
  const source = await read("app/BillingApp.tsx");
  const dashboard = source.slice(
    source.indexOf("function ReportsDashboard("),
    source.indexOf("function CustomerPurchaseHistory("),
  );
  const {
    buildCashFlowReport,
    buildDashboardTrendBuckets,
    buildSalesSettlementReport,
    dashboardPeriodRange,
    dailyCashSummary,
    invoiceInitialPaymentBreakdown,
  } = await loadAccountingLogic();
  const { party, invoice, laterPayment } = splitPaymentFixture();
  const initialBreakdown = invoiceInitialPaymentBreakdown(invoice, 200);
  assert.deepEqual(initialBreakdown, [
    { mode: "cash", amount: 250 },
    { mode: "upi", amount: 200, reference: "UPI-1000" },
    { mode: "cheque", amount: 150, reference: "CHQ-1000" },
  ]);

  const daily = dailyCashSummary(
    invoice.date,
    [invoice],
    [laterPayment],
    [],
    0,
    [party],
  );
  assert.equal(daily.sales, 1000);
  assert.equal(daily.invoiceCash, 250);
  assert.equal(daily.upiIn, 200);
  assert.equal(daily.bankIn, 200);
  assert.equal(daily.chequeIn, 150);

  const cashFlow = buildCashFlowReport({
    invoices: [invoice],
    payments: [laterPayment],
    parties: [party],
    accountEntries: [],
    expenses: [],
  });
  const settlementByMode = cashFlow.movements.reduce(
    (totals, movement) => ({
      ...totals,
      [movement.mode]: (totals[movement.mode] || 0) + movement.amount,
    }),
    { credit: invoice.amountDue },
  );
  assert.deepEqual(settlementByMode, {
    credit: 200,
    cash: 250,
    upi: 200,
    cheque: 150,
    bank: 200,
  });
  assert.equal(
    Object.values(settlementByMode).reduce((sum, amount) => sum + amount, 0),
    invoice.grandTotal,
  );
  assert.equal(
    cashFlow.movements.find((movement) => movement.source === "sale")?.invoiceId,
    invoice.id,
  );
  assert.equal(
    cashFlow.movements.find((movement) => movement.source === "customer_payment")
      ?.paymentId,
    laterPayment.id,
  );
  const cashFlowWithExpense = buildCashFlowReport({
    invoices: [invoice],
    payments: [laterPayment],
    parties: [party],
    accountEntries: [],
    expenses: [
      {
        id: "expense-with-prefix-like-hyphens",
        category: "transport",
        amount: 50,
        date: invoice.date,
        description: "Delivery van",
        paymentMode: "cash",
        reference: "VAN-50",
        isSynced: false,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
      },
    ],
  });
  assert.equal(
    cashFlowWithExpense.movements.find(
      (movement) => movement.source === "misc_expense",
    )?.expenseId,
    "expense-with-prefix-like-hyphens",
  );
  const settlement = buildSalesSettlementReport([invoice], [laterPayment]);
  assert.deepEqual(
    {
      total: settlement.totalSales,
      collected: settlement.collected,
      due: settlement.due,
      percent: settlement.collectionPercent,
      modes: settlement.modes,
    },
    {
      total: 1000,
      collected: 800,
      due: 200,
      percent: 80,
      modes: [
        { mode: "cash", amount: 250 },
        { mode: "upi", amount: 200 },
        { mode: "bank", amount: 200 },
        { mode: "cheque", amount: 150 },
      ],
    },
  );
  assert.deepEqual(dashboardPeriodRange("7d", "2026-08-10"), {
    fromDate: "2026-08-04",
    toDate: "2026-08-10",
  });
  assert.deepEqual(dashboardPeriodRange("all", "2026-08-10"), {
    fromDate: "",
    toDate: "",
  });
  assert.deepEqual(buildSalesSettlementReport([], []), {
    totalSales: 0,
    collected: 0,
    due: 0,
    collectionPercent: 0,
    modes: [],
  });
  const historicalTrend = buildDashboardTrendBuckets(
    [
      { ...invoice, id: "historic-start", date: "2026-07-01", grandTotal: 100 },
      { ...invoice, id: "historic-end", date: "2026-07-07", grandTotal: 700 },
    ],
    "2026-07-01",
    "2026-07-07",
    "2026-08-10",
  );
  assert.equal(historicalTrend.length, 7);
  assert.deepEqual(
    historicalTrend.map((bucket) => [bucket.labelDate, bucket.value]),
    [
      ["2026-07-01", 100],
      ["2026-07-02", 0],
      ["2026-07-03", 0],
      ["2026-07-04", 0],
      ["2026-07-05", 0],
      ["2026-07-06", 0],
      ["2026-07-07", 700],
    ],
  );

  assert.match(source, /const reportItems = useLiveQuery\(\(\) => db\.items\.toArray\(\)/);
  assert.match(source, /<ReportsDashboard[\s\S]*?items=\{reportItems\}/);
  assert.match(dashboard, /buildDashboardTrendBuckets\(/);
  assert.match(
    dashboard,
    /buildSalesSettlementReport\(sales, payments, todayDate\)/,
  );
  assert.match(dashboard, /const cashFlow = buildCashFlowReport\(/);
  assert.match(dashboard, /aria-pressed=\{period === value\}/);
  assert.match(dashboard, /role="img"[\s\S]*?aria-label=\{settlementChartLabel\}/);
  assert.match(dashboard, /data\.settlement\.collected/);
  assert.match(dashboard, /data\.settlement\.due/);
  assert.match(dashboard, /<CashFlowPanel[\s\S]*?fromDate=\{reportFromDate\}[\s\S]*?onRangeChange=\{changeReportRange\}/);
  assert.match(dashboard, /<AdvancedReports[\s\S]*?fromDate=\{reportFromDate\}[\s\S]*?onRangeChange=\{changeReportRange\}/);
  assert.match(dashboard, /items\s*\.filter\(\(item\) => item\.isActive\)/);
  const customerHistory = source.slice(
    source.indexOf("function CustomerPurchaseHistory("),
    source.indexOf("function ReportInvoiceDetail("),
  );
  assert.match(source, /grossNote: "Gross billed totals before imported sales returns/);
  assert.match(source, /grossNote: "इम्पोर्ट किए सेल रिटर्न से पहले के कुल बिल/);
  assert.match(source, /grossNote: "ইমপোর্ট করা সেল রিটার্নের আগের মোট বিল/);
  assert.match(customerHistory, /\{detailCopy\.grossNote\}/);
});

test("report money colors and accessible charts preserve financial meaning", async () => {
  const [source, styles, cashFlow, reportExport, advancedReports] = await Promise.all([
    read("app/BillingApp.tsx"),
    read("app/globals.css"),
    read("lib/cashflow.ts"),
    read("lib/report-export.ts"),
    read("app/AdvancedReports.tsx"),
  ]);
  const legacyRemap = styles.indexOf(
    "Transfer the exact token palette over legacy utility colours",
  );
  const semanticRules = styles.indexOf(".report-money-in");
  assert.ok(legacyRemap >= 0 && semanticRules > legacyRemap);
  assert.match(styles, /--report-money-in:#0b6f38/);
  assert.match(styles, /--report-money-out:#b42318/);
  assert.match(styles, /--report-money-due:#8a5a00/);
  assert.match(
    styles,
    /:root\[data-theme="dark"\][\s\S]*?--report-money-in:#79e59a[\s\S]*?--report-money-out:#ff9b91[\s\S]*?--report-money-due:#f7c66b/,
  );
  assert.match(
    styles,
    /\.report-money-in \{ color:var\(--report-money-in\)!important/,
  );
  assert.match(
    styles,
    /\.report-money-out \{ color:var\(--report-money-out\)!important/,
  );
  assert.match(
    styles,
    /\.report-money-due \{ color:var\(--report-money-due\)!important/,
  );
  assert.match(
    source,
    /className="report-money-out text-base"[\s\S]*?−\{formatMoney\(expense\.amount\)\}/,
  );
  assert.match(
    source,
    /report-movement-direction--\$\{movement\.direction\}/,
  );
  assert.match(source, /role="img"[\s\S]*?aria-label=\{settlementChartLabel\}/);
  assert.match(source, /aria-pressed=\{period === value\}/);
  assert.match(advancedReports, /report-money-in text-right/);
  assert.match(advancedReports, /report-money-due text-right/);
  assert.match(cashFlow, /invoiceId: invoice\.id/);
  assert.match(cashFlow, /paymentId: payment\.id/);
  assert.match(cashFlow, /expenseId: expense\.id/);
  assert.match(
    reportExport,
    /const outRed: \[number, number, number\] = \[180, 35, 24\]/,
  );
  assert.match(
    reportExport,
    /movement\.direction === "in" \? accent : outRed/,
  );
});

test("daily closing starts on the device-local business date", async () => {
  const source = await read("app/QolPanels.tsx");
  assert.match(
    source,
    /import \{[^}]*\blocalDate\b[^}]*\} from "\.\.\/lib\/db"/s,
  );
  assert.match(source, /const \[date, setDate\] = useState\(localDate\)/);
  assert.match(source, /const \[closeSaving, setCloseSaving\] = useState\(false\)/);
  assert.match(source, /const requestId = \+\+saveRequestRef\.current/);
  assert.match(
    source,
    /saveRequestRef\.current !== requestId\s*\|\|\s*selectedDateRef\.current !== savingDate/,
  );
  assert.match(
    source,
    /<input\s+disabled=\{closeSaving\}\s+type="date"/,
  );
  assert.doesNotMatch(
    source,
    /const \[date, setDate\] = useState\(\(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/,
  );
});

test("owner dashboard preserves real losses and flags missing historical cost", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /profit: profitComplete \? profit : null/);
  assert.doesNotMatch(source, /profit: profitComplete \? Math\.max\(0, profit\)/);
  assert.match(source, /Cost missing/);
});

test("cloud credentials and disconnect controls require owner unlock", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /privateSyncCode: tr\([\s\S]*?"Private business sync code"/);
  assert.match(source, /ownerUnlockRequired: tr\([\s\S]*?"Owner unlock required"/);
  assert.match(source, /ownerCloudHelp: tr\([\s\S]*?"Cloud credentials and disconnect controls stay hidden from staff/);
  assert.match(source, /unlockCloud: tr\(language, "Unlock cloud settings"/);
  assert.match(source, /ownerMode \? <>[\s\S]*?\{copy\.privateSyncCode\}/);
  assert.match(source, /\{copy\.ownerUnlockRequired\}/);
  assert.match(source, /\{copy\.ownerCloudHelp\}/);
  assert.match(source, /onClick=\{onOwnerSetup\}[\s\S]*?copy\.unlockCloud/);
  assert.match(source, /generateBusinessSyncCode\(\)/);
  const sync = await read("lib/sync.ts");
  assert.doesNotMatch(sync, /VITE_SUPABASE_SYNC_CODE|NEXT_PUBLIC_SUPABASE_SYNC_CODE/);
  assert.doesNotMatch(sync, /env\?: Record<string, string>/);
  assert.match(sync, /function restoreCloudStorage\(/);
  assert.match(sync, /cloudDisabledForSession = !disconnectPersisted/);
  assert.match(
    source,
    /async function disconnectCloud\(\)[\s\S]*?try \{[\s\S]*?await clearCloudConfig\(\)[\s\S]*?catch \(error\)/,
  );
  for (const configPath of ["vite.config.ts", "vite.mobile.config.ts"]) {
    const config = await read(configPath);
    assert.match(
      config,
      /envPrefix: \["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"\]/,
    );
  }
});

test("daily closing creation and replacement require owner unlock", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /ownerMode \? \([\s\S]*?<DailyClosePanel/);
  assert.match(source, /closingOwnerOnly: "Daily closing is owner-only"/);
  assert.match(source, /closingOwnerOnly: "डेली क्लोज़िंग सिर्फ मालिक के लिए है"/);
  assert.match(source, /closingOwnerOnly: "ডেইলি ক্লোজিং শুধু মালিকের জন্য"/);
  assert.match(source, /\{copy\.closingOwnerOnly\}/);
  assert.match(source, /onClick=\{onOwnerUnlock\}[\s\S]*?\{copy\.unlockClosing\}/);
  const panels = await read("app/QolPanels.tsx");
  assert.match(panels, /supplierCash: "Supplier cash"/);
  assert.match(
    panels,
    /\[copy\.close\.summaryLabels\.supplierCash, -summary\.supplierCash, "out"\]/,
  );
});

test("party account direction locks after any financial history", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /const typeLocked =[\s\S]*?accountEntries\.length > 0/);
  assert.match(source, /typeChangeLocked: tx\([\s\S]*?"Account type cannot change after a balance, bill, due or payment is recorded\."/);
  assert.match(source, /accountTypeLocked: tx\([\s\S]*?"Account type is locked because this party has financial history\."/);
  assert.match(source, /return onToast\(copy\.typeChangeLocked\)/);
  assert.match(source, /\{copy\.accountTypeLocked\}/);
});
