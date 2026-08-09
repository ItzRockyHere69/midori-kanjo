import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(serviceWorker, /midori-kanjo-v5/);
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
  assert.match(styles, /input,select,textarea,\.app-language-select select \{ font-size:16px!important; \}/);
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
    /aria-label=\{copy\.recentTable\} tabIndex=\{0\}/,
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
  assert.match(ledger, /const payableInvoiceType: Invoice\["type"\]/);
  assert.match(
    ledger,
    /!entry\.deletedAt && entry\.type === payableInvoiceType/,
  );
  assert.match(ledger, /delta: entry\.grandTotal/);
  assert.match(ledger, /entry\.initialAmountPaid \?\? entry\.amountPaid - laterAllocated/);
  assert.match(ledger, /id: `invoice-payment-\$\{entry\.id\}`/);
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
  assert.match(source, /const reportItems = useLiveQuery\(\(\) => db\.items\.toArray\(\)/);
  assert.match(source, /<ReportsDashboard[\s\S]*?items=\{reportItems\}/);
  assert.match(dashboard, /const value = sales\s*\.filter/);
  assert.match(
    dashboard,
    /const startOffset = Math\.floor\(\(index \* trendDays\) \/ bucketCount\)/,
  );
  assert.match(
    dashboard,
    /const endOffset = Math\.floor\(\(\(index \+ 1\) \* trendDays\) \/ bucketCount\)/,
  );
  assert.doesNotMatch(dashboard, /const bucketDays =/);
  assert.match(dashboard, /invoice\.initialAmountPaid \?\? invoice\.amountPaid - laterAllocated/);
  assert.match(dashboard, /addSettlement\(payment\.mode, applied\)/);
  assert.match(dashboard, /addSettlement\("credit", unsettled\)/);
  assert.doesNotMatch(
    dashboard,
    /modeMap\.set\([\s\S]{0,200}?invoice\.paymentMode[\s\S]{0,200}?invoice\.grandTotal/,
  );
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
    /\[copy\.close\.summaryLabels\.supplierCash, -summary\.supplierCash\]/,
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
