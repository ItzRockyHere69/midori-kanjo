# Midori Kanjo — Chat Handoff

> Verified against the local repository and the project conversation on 2026-08-09. This document intentionally contains environment-variable names but no secret values. Where the conversation or repository does not establish a fact, the document says so instead of guessing.

## 1. Project name and purpose

**Project name:** Midori Kanjo  
**Package/display version:** `0.1.1`

Midori Kanjo is an offline-first wholesale billing, party-account, inventory-support and reporting application for a festival-decoration business in Burrabazar, Kolkata. The business context includes 1,000+ SKUs, item variants, customer-specific negotiated rates, multiple wholesale units, customer credit/udhaar and strong festival seasonality. The counter workflow is intended to make a normal bill in under 30 seconds and must never depend on internet availability to save a sale.

The current implemented product is primarily the Phase 1 billing system, with the reporting and quotation slice of Phase 4 also included. Full Phase 2 inventory counting and Phase 3 festival planning have not been built.

The same React application is delivered as:

- a hosted installable PWA;
- a Capacitor Android application;
- a Tauri desktop application for Windows and macOS.

## 2. Repository URL and current branch

| Item | Verified value |
| --- | --- |
| Repository | <https://github.com/ItzRockyHere69/midori-kanjo> |
| Git remote | `origin` |
| Current branch | `main` |
| Upstream | `origin/main` |
| Current committed baseline | `d1ae7b48338dc35c743db873561f73db47388aa0` |
| Baseline commit subject | `Add Tauri desktop packaging and native offline sync tests` |

At handoff time, `main` matches `origin/main` at the committed baseline, but the phone optimization is still an **uncommitted local change set**. It has not been pushed to GitHub and has not been published to the shared site.

## 3. Complete technology stack

### Application and web delivery

| Layer | Technology | Verified version/details |
| --- | --- | --- |
| UI | React / React DOM | `19.2.8` |
| Language | TypeScript | `5.9.3` |
| Main build tool | Vite | `8.2.1` |
| Hosted app compatibility | Next.js App Router | `16.3.0` |
| Next-to-Cloudflare adapter | Vinext | `0.0.50` |
| Styling | Tailwind CSS through PostCSS | Tailwind `4.2.1`, `@tailwindcss/postcss` `4.2.1` |
| Hosted runtime | Cloudflare Worker through `@cloudflare/vite-plugin` and Wrangler | Plugin `1.51.1`, Wrangler `4.120.0` |
| PWA | Web App Manifest and custom service worker | Cache name `midori-kanjo-v5` |
| PDF generation | jsPDF | `4.2.1` |
| Internationalization | In-repository English, Hindi and Bengali label map | `lib/i18n.ts` |

### Data and synchronization

| Layer | Technology | Verified version/details |
| --- | --- | --- |
| Local database | Dexie.js over IndexedDB | Dexie `4.4.4`, `dexie-react-hooks` `1.1.7` |
| Cloud backup/sync | Supabase Postgres, anonymous Auth, Realtime and RLS | `@supabase/supabase-js` `2.112.2` |
| Optional hosted database scaffold | Drizzle ORM + Cloudflare D1 | Drizzle `0.45.2`, Drizzle Kit `0.31.10`; schema is intentionally empty and the application does not currently use D1 |

### Native packaging

| Target | Technology | Verified version/details |
| --- | --- | --- |
| Android | Capacitor | Core/Android `6.2.1`; App `6.0.3`; Browser `6.0.6`; Filesystem `6.0.4`; Share `6.0.4` |
| Windows/macOS | Tauri 2 + Rust | Tauri Rust crate `2.11.3`, Tauri CLI `2.11.4`, minimum Rust `1.77.2`, window-state plugin `2` |
| Desktop installer CI | GitHub Actions + `tauri-apps/tauri-action` | Windows x64 MSI/NSIS EXE and universal macOS DMG |
| Legacy desktop scaffold | Electron/electron-builder files under `desktop/` | Retained and covered by the desktop shell regression check; the active installer workflow is Tauri |

### Testing and quality tools

- Node's built-in test runner.
- `esbuild` bundling for the TypeScript core test suite.
- `fake-indexeddb` `6.2.5` for IndexedDB tests.
- ESLint `9.39.4` with `eslint-config-next` `16.2.6`.
- WebdriverIO `9.30.1`, `@wdio/tauri-service` `1.3.0` and a feature-gated Tauri WebDriver plugin for the optional native round-trip test.
- Android Gradle tooling; the documented local requirement is Android SDK 35, AGP 8.6.1, Gradle 8.7 and Java 17. The app rejects System WebView versions below 92 rather than starting with missing browser APIs.

### Design fonts and tokens

The CSS stack declares `PP Kyoto` for display text, `ABC Diatype` for UI text and `IBM Plex Mono` for mono labels, with Georgia, Arial, system, Bengali and Devanagari fallbacks. No separate font asset files are present in the repository.

## 4. Current architecture

### Shared application

- `app/page.tsx` renders the single shared `BillingApp` client application.
- `app/BillingApp.tsx` contains the main workspace shell and the Bill, Parties, Dues, Items, Miscellaneous, Reports and More workspaces.
- Reusable domain behavior is under `lib/`: billing, IndexedDB, sync, PDFs, reports, cash flow, product images, QoL helpers, receipts, catalogue export and i18n.
- The application writes to Dexie/IndexedDB first. Supabase is optional and is never in the sale-save path.

### Hosted PWA

- Next App Router metadata and the viewport are defined in `app/layout.tsx`.
- Vinext and Vite compile the app to a Cloudflare Worker in `dist/`.
- `worker/index.ts` is the Worker entry point.
- `.openai/hosting.json` has a project ID, with `d1: null` and `r2: null`.
- `public/manifest.webmanifest` and `public/sw.js` provide installability and an offline shell.
- `db/schema.ts` is intentionally empty. The Cloudflare D1 helper exists as a scaffold but is not part of the current application data path.

### Android

- `mobile/main.tsx` mounts the same `BillingApp` and shared CSS in a standalone Vite SPA.
- `vite.mobile.config.ts` writes the self-contained bundle to `mobile-dist/`.
- Capacitor copies that bundle into `android/app/src/main/assets/public`.
- Android package ID: `com.mantu.billing`.
- Native Filesystem and Share plugins are used for PDF/report/catalogue sharing. Browser support is used for external URLs, and the hardware back button closes active billing UI before exit.

### Windows and macOS

- Tauri wraps the same `mobile-dist/` bundle.
- Tauri application identifier: `com.sayanfinance.midorikanjo`.
- Configured bundles: MSI, NSIS EXE and DMG.
- The production Rust shell only initializes Tauri and window-state persistence. The WebDriver server is feature-gated to the `desktop-e2e` build.
- GitHub Actions builds Windows x64 installers and a universal Intel/Apple Silicon macOS DMG.

### Local-to-cloud data flow

1. UI actions save stable-ID records to IndexedDB with `isSynced: false`.
2. Billing remains usable with no cloud configuration or network connection.
3. When sync runs, the client authenticates anonymously with the business sync code in user metadata.
4. Remote rows are pulled first to avoid overwriting newer cloud data with stale offline edits.
5. Locally newer unsynced records survive the pull; newer remote records replace older local records.
6. Remaining unsynced local records are upserted by stable `id`.
7. Records are marked synced only if their `updatedAt` value did not change while the upload was running.
8. Realtime database events debounce for 400 ms and trigger another full sync.

## 5. Features completed and verified

### Billing and catalogue

- One-screen wholesale billing with large counter controls and a custom number pad.
- English, Hindi, Bengali and SKU search, including fuzzy matches.
- Seed data: six sample customers, two sample suppliers and 14 items across eight categories.
- Units: piece, dozen, gross, bundle, box and packet, with unit conversion behavior.
- Inline customer and item creation without leaving the bill.
- A visible New Customer action that saves and immediately selects the customer.
- Product add/edit/archive behavior and offline item photos with compression/thumbnails.
- Customer-specific last-price autofill and persistent locked prices.
- Full, partial and credit/pay-later payment plans.
- Cash, UPI, bank, credit and mixed payment representation.
- Bill-level GST on/off, default 18%, selectable 18%/25%, and custom rates from 0–25%.
- Independently toggleable carrier, packing and big-box charges with editable amounts.
- Charges persist through balances, reports, CSV, PDF, print and sharing.
- Save-only, print and WhatsApp invoice actions.
- A4, A5 and 3-inch thermal PDF invoice layouts.
- Recoverable 30-day invoice deletion bin.
- Quotations that do not affect stock, balances or remembered prices until idempotent conversion to a sale.
- Working GSTR-1 CSV export for a CA; this is not direct filing.

### Parties, dues and payments

- Separate customer and supplier account views.
- Searchable code names plus editable name, phone, address, GSTIN, notes and price tier.
- Customer receivables, supplier payables, opening balances and running ledgers.
- Searchable Dues workspace with latest payment and dated cash/online activity.
- Manual customer dues and supplier purchase-bill entries.
- Manual due creation for any customer, including a zero-balance customer.
- Customer receipts and supplier payments with date/time, mode and remaining balance.
- Oldest-first or manually selected invoice allocation.
- Prevention of overpayment and invalid manual allocations.
- WhatsApp outstanding reminders.
- Detailed due-statement PDF and text exports.
- Payment receipt generation and sharing.
- Balance reconciliation from canonical invoices, payments and manual due events.

### Reports, expenses and exports

- Responsive dashboard with sales, payment-mode, udhaar, trend and product analytics.
- Clickable party purchase history and historical invoice reopening/reprinting/resharing.
- Miscellaneous expense workspace for refreshments, customer food, shop supplies, transport and other expenses.
- Cash, UPI and bank expense modes, references, search, offline save and recoverable deletion.
- Cash-flow reporting that separates sales billed, money received, supplier payments and miscellaneous money out.
- Today, recent-period, current-month, all-time and custom date filters.
- Daily sales and party-wise sales reports.
- Item-wise gross profit with missing-cost warnings.
- Receivables aging for 0–30, 30–60 and 60+ days.
- Six-month dead-stock report.
- Top-20 revenue report.
- Margin-by-party warnings based on rates paid by other buyers for the same item.
- Wholesale, bulk and retail WhatsApp catalogue PDFs with photos when available.
- Multi-page PDF and plain-text report exports.

### Quality-of-life and security features

- Persistent English/Hindi/Bengali switch.
- Light and dark themes with reduced-motion support.
- Owner-only profit view protected by a 4–8 digit PIN hashed with PBKDF2-SHA-256; plaintext is not stored.
- Automatic bill drafts with idempotent final save.
- Unit-aware quantity presets.
- Product variant-family metadata.
- Reviewed duplicate party and item merge workflows that preserve ledger ownership and archive the source.
- Workspace preferences, printer profiles, message templates and favourite products stored locally.
- Activity logs and daily cash closing.
- Stable, device-safe invoice numbers and stable record IDs.

### Phone and responsive work completed in the current change set

- Five primary phone tabs: Bill, Parties, Items, Reports and More.
- Dues and Miscellaneous remain one tap inside More.
- Compact narrow-phone header and phone language select.
- SVG navigation/search/undo controls plus accessible labels for icon-only controls.
- Minimum 44 px phone touch targets, with 48 px primary counter actions.
- Safe-area handling for notches, translucent status bars, bottom navigation, the bill dock, sheets and the number pad.
- Zoomable viewport; the previous maximum-scale restriction was removed.
- Portrait lock removed from both the PWA and Android.
- Landscape-phone rules keep the mobile navigation/workspace instead of switching to the desktop sidebar solely because width is large.
- Touch momentum scrolling for wide ledgers/tables and pointer-based sheet dismissal.
- Responsive behavior retained for tablets and desktop windows.

### Packaging and offline delivery

- Installable PWA with offline service-worker shell.
- Self-contained Capacitor Android bundle that does not depend on the hosted site at startup.
- Native Android sharing and safe permissions; no broad storage or location permissions.
- Tauri Windows/macOS packaging configuration and installer CI.
- Production Tauri bundle excludes the native test harness.
- Optional real native offline → restart → reconnect → Supabase → re-download test workflow is implemented.

## 6. Features partially completed

| Area | Present foundation | What is not complete |
| --- | --- | --- |
| Phase 2 inventory | Item stock and low-stock fields, inventory-facing item UI, plus local `stockMovements` and `countSessions` tables | Full inventory counting, inward/outward/returns/adjustment workflows are explicitly not built |
| Phase 3 festival planning | Categories and festival tags/seasons exist in the model and seed data | The festival-planning product workflow is explicitly not built |
| Phase 4 | Reporting and quotation slice is implemented | The conversation does not define or verify the rest of Phase 4, so no further scope should be inferred |
| Cloud synchronization | Seven operational tables sync to Supabase | Categories, stock movements, count sessions, activity logs, daily closes and meta/preferences remain local-only |
| Android public release | Debug packaging and a release-bundle command exist; the project currently targets API 35 | A Play Store build still requires the owner's signing key and store account, and new apps/updates must target API 36 beginning 2026-08-31 |
| Desktop release | Tauri installer workflow exists for Windows and macOS | Local builds require Rust plus MSVC on Windows or Xcode on macOS; public installers are not commercially code-signed or Apple-notarized, and hardware/network acceptance remains manual |
| Current integration | The phone pass has been combined with accounting, sync, schema, platform and security hardening | The working tree remains uncommitted, unpushed and unpublished; use `git status` and `git diff` rather than a frozen file count |

## 7. Earlier phone-pass files and the current source of truth

The earlier phone-specific checkpoint touched the following tracked files. This is
historical context, not a complete inventory of the current integrated working tree:

| File | Status | Purpose of current change |
| --- | --- | --- |
| `README.md` | Modified | Documents five-tab phone navigation and safe-area/landscape support |
| `android/app/src/main/AndroidManifest.xml` | Modified | Removes the forced portrait orientation while retaining `adjustResize` for the software keyboard |
| `app/BillingApp.tsx` | Modified | Implements five phone tabs, More shortcuts for Dues/Miscellaneous, compact header/language control, SVG navigation icons, accessibility labels, larger tap targets, mobile/landscape layout hooks and touch-safe controls |
| `app/QolPanels.tsx` | Modified | Uses pointer dismissal for sheets and adds the shared scroll-safe sheet class |
| `app/globals.css` | Modified | Adds safe-area variables and spacing, phone/landscape breakpoints, 44 px touch rules, bill-dock/page padding, bottom-sheet constraints, compact header behavior, mobile More cards and touch scrolling |
| `app/layout.tsx` | Modified | Enables zoom by removing `maximumScale` and uses a translucent iOS status-bar style |
| `mobile/index.html` | Modified | Removes the maximum-scale lock and declares light/dark color-scheme support |
| `public/manifest.webmanifest` | Modified | Changes PWA orientation from portrait-only to `any` |
| `tests/mobile-package.test.mjs` | Modified | Adds assertions for five tabs, touch targets, safe areas, zoom and landscape support |

This handoff document itself was initially added as one new file:

| File | Status | Purpose |
| --- | --- | --- |
| `docs/CHAT_HANDOFF.md` | Created | Complete continuation context for a new developer or ChatGPT chat |

The current repair pass also changes accounting, synchronization, Supabase migrations,
accessibility, PWA/native packaging, CI, backup tooling and regression coverage. Run
`git status --short` and inspect `git diff`; they are the authoritative file set.

## 8. Important database tables, migrations and synchronization rules

### IndexedDB/Dexie database

Database name: `BurrabazarBillingDB`  
Current Dexie schema version: `5`

| Local table | Purpose | Cloud-synced now? |
| --- | --- | --- |
| `parties` | Customers/suppliers, code, contact fields, price tier and balances | Yes, to `parties` |
| `items` | Product identity, translated names, SKU, unit, prices, stock fields, GST, photo and sales metadata | Yes, to `items` |
| `categories` | Product hierarchy and festival seasons | No |
| `partyItemPrices` | Per-party/per-item remembered and locked rates | Yes, to `party_item_prices` |
| `invoices` | Sales, purchases, returns and quotations, including lines, GST, charges, payments and soft deletion | Yes, to `invoices` |
| `payments` | Customer/supplier payments and invoice allocations | Yes, to `payments` |
| `accountEntries` | Manual due ledger entries | Yes, to `account_entries` |
| `expenses` | Miscellaneous cash/UPI/bank expenses with soft deletion | Yes, to `expenses` |
| `stockMovements` | Stock deltas and reasons | No |
| `countSessions` | Inventory-counting sessions | No |
| `activityLogs` | Owner/staff actions and merge history | No |
| `dailyCloses` | Daily expected/count cash and discrepancy | No |
| `meta` | Settings, drafts, sync diagnostics/conflicts, preferences and other local metadata | No |

Dexie schema history:

- **v1:** parties, items, categories, party-item prices, invoices, payments, stock movements, count sessions and meta.
- **v2:** added `accountEntries`.
- **v3:** added/indexed party `codeName`; existing parties receive generated customer/supplier codes and are marked unsynced.
- **v4:** added `expenses`.
- **v5:** added `activityLogs` and `dailyCloses`.

### Supabase tables

`supabase/schema.sql` defines:

- `parties`
- `items`
- `party_item_prices`
- `invoices`
- `payments`
- `account_entries`
- `expenses`

Every table has a composite `(business_id, id)` primary key. `business_id` is the SHA-256 tenant identifier derived from the authenticated anonymous user's private `sync_code`; the raw credential is not stored in table rows. RLS is enabled for every table and compares the row tenant identifier with `public.current_business_id()` while also requiring a code of at least 20 characters.

SKU and invoice-number uniqueness is scoped per business with:

- `(business_id, sku_code)`
- `(business_id, invoice_number)`

### Supabase migrations

| Migration | Purpose |
| --- | --- |
| `supabase/migrations/202608080000_initial_complete_schema.sql` | Complete composite-key, hashed-tenant baseline for a blank project |
| `supabase/migrations/202608080630_add_expenses.sql` | Creates expenses, its user/date index and the original per-user RLS policies |
| `supabase/migrations/202608080830_add_invoice_payment_received_mode.sql` | Adds invoice `payment_received_mode` constrained to cash, UPI or bank |
| `supabase/migrations/202608081200_secure_business_sync.sql` | Adds `business_id` to all synced tables, removes older policies and applies sync-code-isolated RLS |
| `supabase/migrations/202608091900_harden_multi_tenant_sync.sql` | Hashes legacy tenant codes, repairs unambiguous legacy relationships, adds composite keys/FKs and immutable initial-payment snapshots |

`supabase/schema.sql` is the consolidated schema for a fresh, blank project. Enable
anonymous sign-in, run that file once in the SQL editor, and do not replay the
migration directory over the same fresh install.

The hardening migration maps unresolved legacy rows to a quarantined tenant, repairs relationships only when the tenant is unambiguous, and leaves any remaining historical composite FK unvalidated while enforcing it for all new writes. Review its warnings and use the supplied backup/export tools before applying it to an old database.

#### Existing project with later migrations already recorded

This is a history-repair and rollout procedure for a populated project; it is not
the fresh `schema.sql` procedure above.

1. Stop writes and take a restorable Supabase database backup. Also make an in-app
   export, but do not treat the app export as a replacement for the database backup.
2. Link the intended project and compare local and remote history:

   ```bash
   supabase link --project-ref <project-ref>
   supabase migration list
   ```

3. If the remote history records the later `20260808...` migrations but omits
   `202608080000`, confirm that this is the existing populated schema, then repair
   only the new baseline's history row. Do **not** execute the blank-project baseline
   against the populated database:

   ```bash
   supabase migration repair 202608080000 --status applied
   ```

4. Preview the out-of-order local migrations and stop if the plan contains anything
   unexplained. The expected unapplied change is the hardening migration:

   ```bash
   supabase db push --include-all --dry-run
   ```

5. Apply the reviewed plan, inspect migration warnings, and confirm both the baseline
   history row and hardening migration are recorded remotely:

   ```bash
   supabase db push --include-all
   supabase migration list
   ```

`supabase migration repair` changes history only; it never executes or reverses the
migration SQL. Never mark `202608091900` applied unless its SQL actually completed.
If other versions are missing or SQL was run manually, verify the live schema before
repairing any history row instead of assuming it is safe.

### Synchronization rules

- IndexedDB is the source of truth for live counter operation.
- Cloud settings may be viewed or changed only after owner-PIN unlock in **More → Cloud backup**. A saved per-device configuration takes precedence over public URL/key build variables.
- A sync code must be at least 20 characters.
- Supabase URLs must use HTTPS.
- The same Supabase URL, anon key and sync code must be used on each trusted device for one business.
- A matching anonymous session is reused. If its metadata contains a different sync code, the client signs out and starts a new anonymous session with the configured code.
- Sync pulls all seven remote tables first, in pages of 500.
- Remote rows replace a local row when the local row is already synced or the remote `updatedAt` is at least as new.
- A newer unsynced local row is preserved.
- Detected newer-remote/unsynced-local conflicts are retained in `meta` under `sync-conflicts-v1`, capped at 100 records.
- Party balances are rebuilt from invoices, payments and manual dues after the pull. A corrected balance is marked unsynced for upload.
- Only `isSynced: false` rows are pushed.
- Pushes use tenant-scoped idempotent `upsert(..., { onConflict: "business_id,id" })` in batches capped at 100 rows and 900 kB.
- A pushed row is marked synced only if it was not edited again during the request.
- Only one sync can run at a time.
- Realtime listens to all public-schema Postgres changes and triggers a debounced sync.
- Sync errors are recorded locally with key/sync-code-like content redacted. Billing remains available and the state remains pending/offline.

## 9. Environment-variable names required

No environment variable is required for **local-only** billing. Without cloud settings, the app remains usable on one device and reports Offline.

### Cloud sync in managed builds

The checked-in `.env.example` contains these names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`lib/sync.ts` also accepts these server/Next alternatives:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The private business sync code deliberately has no supported `VITE_` or
`NEXT_PUBLIC_` variable. Client-public build variables are extractable; enter the
code separately on each trusted device after owner-PIN unlock. There is no raw
business-ID setting or environment variable: `public.current_business_id()` derives
the stored SHA-256 tenant identifier from the authenticated session.

The public URL and anon key may also be entered at runtime. The private code is always
a per-device runtime entry. Do not commit `.env.local` or copy the code into a public
build variable.

### Optional real Tauri offline-sync test

These are required only when running `npm run test:tauri:e2e`:

- `MIDORI_E2E_RUN_KEY`
- `MIDORI_E2E_SUPABASE_URL`
- `MIDORI_E2E_SUPABASE_ANON_KEY`
- `MIDORI_E2E_SYNC_CODE`

GitHub Actions sets `MIDORI_E2E_RUN_KEY` from the workflow run and expects the other three as repository secrets.

### Optional path/build overrides

- `MIDORI_TAURI_BINARY` — overrides the Tauri executable tested by WebdriverIO.
- `MANTU_STATIC_ROOT` — overrides the legacy Electron shell's static bundle path; used by its self-test.
- `SITES_RUNTIME_ROOT`
- `SITES_NPM_CACHE_SEED`
- `SITES_INSTALL_TIMEOUT`
- `SITES_INSTALL_KILL_AFTER`
- `SITES_BUILD_TIMEOUT`
- `SITES_BUILD_KILL_AFTER`

The `SITES_*` names are helper overrides, not normal app runtime requirements. Wrangler/Cloudflare binding names such as `ASSETS`, `IMAGES` and optional `DB` are platform bindings, not application secrets.

## 10. Current bugs and unresolved technical problems

The current uncommitted integration must be revalidated as a whole before release.
Regardless of automated test results, these limitations and release prerequisites
remain:

1. **Release state:** the integrated working tree is still uncommitted, unpushed and unpublished.
2. **Large JavaScript bundle:** Vite still reports a large-chunk warning. This is an optimization issue, not by itself a build failure.
3. **Cloud conflict model:** immutable payment events are reconciled, but other mutable rows still use client-clock last-write-wins. There is no server-side compare-and-swap or revision check for those rows; that requires a future database/RPC migration.
4. **Cloud sync scope:** categories, stock movements, count sessions, activity logs, daily closes and meta/preferences do not sync between devices.
5. **Android target deadline:** the project currently targets API 35. Google Play requires new apps and updates to target Android 16 / API 36 beginning 2026-08-31; upgrade the compile/target SDK and validated Android toolchain before a submission on or after that date.
6. **Native toolchains:** Android builds require Android Studio/SDK and Java 17. Tauri builds require Rust plus the target platform's native tools (MSVC on Windows or Xcode on macOS); those tools are not provided merely by installing npm dependencies.
7. **Native signing/distribution:** Android store signing, Windows commercial code-signing, Apple signing and notarization are not complete. SmartScreen/Gatekeeper warnings are expected for internal unsigned builds.
8. **Manual hardware acceptance:** CI cannot validate physical printers, shop firewall/proxy behavior, SmartScreen policy or Gatekeeper policy.
9. **Real native cloud round-trip:** the workflow exists, but it requires dedicated Supabase test variables. Do not claim it ran unless a workflow/test log is available.
10. **Physical phone evidence:** responsive browser/device dimensions are covered, but a named physical Android handset or iPhone still requires release acceptance.

## 11. Important design and product decisions

- **Offline first:** every counter operation must work through IndexedDB without waiting for Supabase.
- **Never block a sale:** unknown or zero stock does not prevent billing.
- **Fast billing:** the core user is a wholesale counter operator; inline customer/item creation and the number pad avoid navigation away from the bill.
- **Negotiated prices:** per-customer item rates are essential. A locked remembered rate stays unchanged until staff explicitly unlocks it.
- **GST behavior:** rates are entered before GST. GST can be disabled per bill; 18% is the default, and 18–25% plus custom 0–25% are supported.
- **Payment behavior:** cash and UPI default to fully paid. Credit creates udhaar, while a smaller received amount creates a mixed/partial payment.
- **Extra charges:** carrier, packing and big-box charges are independent bill-level switches and must flow through every total, ledger and export.
- **Quotation isolation:** quotations do not change balances, stock activity or remembered prices until conversion.
- **Phone navigation:** keep five primary tabs. Dues and Miscellaneous are secondary but remain one tap away under More.
- **Device support:** allow zoom and both orientations; use viewport safe areas and 44 px touch targets.
- **One codebase:** hosted PWA, Android and Tauri desktop reuse the same `BillingApp`, CSS, Dexie model and mobile production bundle.
- **Languages:** manual English, Hindi and Bengali switching is retained.
- **Brand:** product name is Midori Kanjo; visible product credit is Sayan Finance. Existing legacy identifiers/data-directory names are retained where needed to avoid hiding existing local data.
- **Design palette:** canvas `#F9F9F9`, surface `#FFFFFF`, ink `#211F1D`, border `#E2E2DB`, forest `#014921`, primary green `#004E23`, deep green `#004014`, accent `#309D4B`, on-dark `#F9F9F9`, muted on-dark `#CAD4CC`.
- **Current phase boundaries:** Phase 1 billing first; Phase 2 inventory counting and Phase 3 festival planning remain deferred.

## 12. Decisions that were rejected and why

| Rejected/deferred decision | Verified reason |
| --- | --- |
| Seven equal-priority phone tabs | They crowded a 6-inch/narrow screen; five primary tabs fit, while Dues and Miscellaneous remain reachable under More |
| Portrait-only PWA/Android | It prevented the requested landscape and all-device support |
| `maximum-scale=1` zoom lock | It prevented user zoom and reduced accessibility |
| Treating a short landscape phone as desktop based on width alone | Landscape phone width can exceed the tablet breakpoint; a height/orientation rule now keeps the mobile workspace |
| Supabase in the sale-save path | Sales must work offline and must never be blocked by connectivity |
| Blocking sales when stock is zero or unknown | Explicit product rule: never block a sale |
| Updating a locked party price from every one-off negotiation | A locked rate is intentionally persistent until explicitly unlocked |
| Letting a quotation affect ledgers or remembered prices | A quotation is non-posting until conversion |
| Full double-entry accounting, payroll/attendance, loyalty/marketing automation, foreign currency and barcode scanning in Phase 1 | Explicitly excluded/deferred from the billing-first phase; no more specific reason is recorded for each item |
| Direct GSTR filing, IRN generation, e-invoicing or e-way-bill integration | Current scope is a working CSV export for a CA; direct integrations are explicitly not implemented |

## 13. Current task we were working on

The active task was to optimize Midori Kanjo for phones and all screen sizes, with special attention to icons and interactive controls rather than only resizing the layout.

The pass covered narrow phones, normal phones, landscape phones, tablets and desktop windows. It replaced the crowded phone navigation, corrected safe-area/gesture-bar behavior, enlarged touch targets, improved sheets and billing controls, enabled zoom and rotation, and added automated mobile assertions.

## 14. Exact point where the work stopped

Implementation and verification are complete locally.

The final verified interaction audit reported:

- `320 × 568`, `390 × 844` and `844 × 390` viewports with zero horizontal overflow;
- five fitted phone tabs;
- no visible phone control below the 44 px target;
- successful interaction with Parties, Reports, More, Dues, Miscellaneous, search, language switching, favourites, charge toggles, the number pad and Add Item;
- no app console errors.

The work stopped immediately after the assistant asked for approval to publish the updated version to the existing shared site's current audience. No approval response is recorded. Therefore:

- the shared site was not updated;
- the changes were not committed;
- the changes were not pushed to GitHub.

## 15. Acceptance criteria for the current task

The current mobile task is accepted locally when all of the following remain true:

- Five phone tabs are visible and fit: Bill, Parties, Items, Reports and More.
- Dues and Miscellaneous are reachable with one additional tap from More.
- No horizontal page overflow at 320 px, 390 px and landscape-phone widths.
- Visible phone controls are at least 44 × 44 px; primary billing actions remain at least 48 px high.
- Header controls fit narrow phones without obscuring brand, search, language or sync state.
- Notches, translucent status bars, home indicators and gesture bars do not cover navigation, sheets, the number pad or the billing dock.
- The keyboard can resize the Android view instead of covering the active form.
- Pinch zoom is allowed.
- Portrait and landscape are both supported in the PWA and Android manifest.
- Landscape phones retain the phone workspace rather than incorrectly switching to the desktop sidebar.
- Parties, Reports, More, Dues, Miscellaneous, search, language, favourites, charge toggles, number pad and Add Item respond correctly to touch/click.
- Icon-only controls have accessible labels and focus-visible behavior.
- Light/dark themes and reduced-motion behavior remain usable.
- Core offline billing, sync idempotency, invoices, reports, Android packaging and desktop packaging do not regress.
- The current lint, unit, hosted, platform, mobile, desktop and Tauri configuration commands pass.
- The hosted production build and rendered preview test pass.
- Publication occurs only after explicit user approval because the current site is shared.

## 16. Installation, development, testing and build commands

Run commands from the repository root.

### Prerequisite

```bash
node --version
```

Node.js `22.13.0` or newer is required. GitHub Actions currently uses Node 24.

### Install

```bash
npm ci
```

In the ChatGPT Sites workspace, use the repository's bounded installer:

```bash
npm run install:ci
```

### Develop and serve

```bash
npm run dev
```

Build and serve the hosted production output:

```bash
npm run build
npm run start
```

### Core validation

```bash
npm run lint
npm run test:unit
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

The aggregate hosted test command rebuilds first:

```bash
npm test
```

### Android/mobile

```bash
npm run mobile:build
npm run mobile:sync
npm run test:mobile
```

Build a debug APK on a machine with Android Studio, SDK 35 and Java 17. The
repository currently pins AGP 8.6.1 and the Gradle 8.7 wrapper:

```bash
npm run mobile:android:debug
```

Expected debug APK path:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Build a release Android App Bundle after signing configuration is available:

```bash
npm run mobile:android:bundle
```

This project currently targets API 35. Before a Google Play submission on or after
2026-08-31, upgrade and validate the project against API 36.

### Tauri desktop

```bash
npm run tauri:dev
npm run test:tauri:config
npm run tauri:build
```

The standard local Tauri build uses the targets in `src-tauri/tauri.conf.json`. It
requires Rust plus MSVC on Windows or Xcode on macOS. The GitHub workflow is the
configured route for Windows x64 MSI/NSIS EXE and universal macOS DMG artifacts;
code signing and Apple notarization remain separate release prerequisites.

### Legacy desktop shell check

```bash
npm run test:desktop
```

### Optional real native offline/cloud round trip

After setting the four `MIDORI_E2E_*` variables and compiling the feature-gated runner:

```bash
npm run tauri:e2e:build
npm run test:tauri:e2e
```

Use a dedicated Supabase test project, not production shop data.

### Supabase fresh setup

1. Create a dedicated, blank Supabase project.
2. Enable anonymous sign-in.
3. Run `supabase/schema.sql` once in the Supabase SQL editor. Do not replay the
   migration directory over that same fresh install.
4. Public environment variables may prefill only the project URL and anon key. After owner-PIN unlock, enter the private sync code of at least 20 characters separately on each trusted device in **More → Cloud backup**.

For a populated project whose remote history already contains later migrations but
not the new baseline, follow the backup, `migration repair 202608080000`, dry-run and
`db push --include-all` procedure in section 8. History repair does not execute SQL,
and the hardening migration must never be marked applied unless it actually ran.

### Drizzle/D1 scaffold

```bash
npm run db:generate
```

Do not add D1 tables merely because the scaffold exists. `db/schema.ts` is intentionally empty, and D1 is not the current application database.

## 17. Validation checklist and recorded limitations

Suite sizes change as regression coverage grows, so this handoff intentionally does
not freeze numeric pass counts. Before release, rerun the current commands against
the complete integrated working tree and require a zero exit status:

| Command/check | Required result |
| --- | --- |
| `npm run lint` | Exit code 0 |
| `npm run test:unit` | All current unit tests pass |
| `npm run build` | Hosted Worker and packaged hosting manifest validate |
| `node --test tests/rendered-html.test.mjs` | Rendered-host checks pass |
| `npm run test:platform` | Platform, security and Supabase migration contracts pass |
| `npm run test:mobile` | Mobile build, Capacitor sync and package checks pass |
| `npm run test:desktop` | Legacy desktop shell checks pass |
| `npm run test:tauri:config` | Tauri packaging checks pass |
| `npx tsc --noEmit --incremental false` | Type-check exits 0 |
| `git diff --check` | No whitespace errors |

The core suite covers billing, GST, units, PDF formats, charges,
receivables/payables, dues, expenses, reports, quotation isolation, owner PINs,
drafts, merges, daily close, paginated sync, upload batching and ledger
reconciliation. Mobile/platform/desktop coverage includes the offline bundle, PWA
shell, responsive navigation, native permissions and sharing, secure tenant sync,
migration contracts, Tauri production/test separation and installer workflow
configuration.

The earlier final responsive interaction audit also passed at `320 × 568`, `390 × 844` and `844 × 390`, with zero horizontal overflow and no console errors during the listed tap-through actions.

Warnings previously observed but not failures:

- npm reports an inherited unknown `http-proxy` config warning.
- Vite/Vinext reports JavaScript chunks above its configured warning threshold.

Not performed in this handoff session:

- `npm run test:tauri:e2e`, because dedicated Supabase test variables are required.
- Physical printer, Windows SmartScreen, macOS Gatekeeper, shop network and explicitly named physical-phone checks.

## 18. Next steps in their correct order

1. Open this repository, read this handoff and run `git status --short --branch`. Preserve all existing modifications; do not reset or overwrite them.
2. Confirm with the user whether they approve publishing this exact local version to the existing shared site's current audience. Do not publish without explicit approval.
3. If approved, publish the current checkpoint through the existing Sites project without changing its audience.
4. Smoke-test the published site at narrow portrait, normal portrait and landscape-phone sizes. Recheck the five tabs, More → Dues/Miscellaneous, bill dock, Add Item, language select and absence of console errors.
5. Report the live publication result to the user. If deployment fails, keep the local change set intact and diagnose before retrying.
6. Ask for or confirm authorization before GitHub publication. Then review and commit the intended current integration files plus this handoff, and push `main`.
7. Monitor the `Build and test Tauri desktop installers` workflow triggered by the push. Confirm both the Windows and macOS matrix jobs and artifact uploads.
8. If the dedicated Supabase test secrets are configured, manually run the workflow with `run_native_offline_sync_test` enabled and retain the logs.
9. Perform the documented manual acceptance on one Windows 10/11 PC, one Intel or Apple Silicon Mac, relevant printers and representative physical phones before calling the release broadly production-ready.
10. Address the large mobile bundle warning and complete the API 36 upgrade before the 2026-08-31 Play target-SDK deadline.
11. Only after the responsive release is stable, choose the next product phase. The verified deferred priorities are Phase 2 inventory counting and Phase 3 festival planning; do not invent their detailed scope without the user.

## 19. Copy-paste opening prompt for the new ChatGPT chat

```text
Continue my Midori Kanjo software project from the existing repository at https://github.com/ItzRockyHere69/midori-kanjo on branch main.

First read docs/CHAT_HANDOFF.md completely and inspect the current local Git status and diff. Treat that handoff and the repository as the source of truth. Do not discard, reset, rewrite or recreate the existing uncommitted work.

The current phone/responsive optimization is implemented and verified locally. The work stopped after all automated checks and the 320×568, 390×844 and 844×390 interaction audit passed, but before publication. The local mobile changes are not committed, not pushed and not published. The existing site is shared, so do not publish it or change its audience unless I explicitly approve. Also do not commit or push until I explicitly authorize that external publication step.

Start by telling me the exact current status from the handoff and Git diff, including any changed files or test failures you actually observe. If the state still matches the handoff, ask me whether I approve publishing this exact version to the site's current audience. Preserve offline billing, Dexie data, Supabase idempotent sync, the five phone tabs, More access to Dues/Miscellaneous, 44 px touch targets, zoom, landscape support and safe-area spacing. If you make any later code change, rerun the current lint, type-check, unit, hosted build/render, platform, mobile, desktop and Tauri configuration commands without relying on frozen test counts.
```
