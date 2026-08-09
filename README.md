# Midori Kanjo

Phase 1 is a mobile-first, installable billing PWA for a wholesale festival-decoration counter in Burrabazar. IndexedDB is the local source of truth, so billing keeps working without internet. Supabase is an optional sync layer and never sits in the save path.

## Phase 1 included

- One-screen wholesale billing with large touch controls
- Five-action phone navigation (Bill, Parties, Items, Reports and More), with Dues and Miscellaneous kept one tap inside More
- Notch, home-indicator, gesture-bar and landscape-safe layouts across compact phones, tablets and desktop windows
- Search across English, Hindi, Bengali and SKU codes, including fuzzy matches
- Six sample customers, two sample suppliers and 14 supplied festival-decoration items across eight business categories
- Full offline product editor with item-specific photo upload, compression and thumbnails
- Add, edit, archive and adjust bill quantities without leaving the counter workflow
- Customer-specific last-price autofill and persistent locked prices
- Inline party and item creation without leaving the bill
- Visible New Customer action on the billing screen that saves and immediately selects the customer for the current bill
- Custom numeric keypad for quantities, rates, discounts and payments
- Separate customer and supplier account views with fast manual creation
- Unique searchable customer/supplier code names, editable addresses, and lookup by name, code, address or phone
- Customer receivables, supplier payables, opening balances and running ledgers
- Dedicated searchable Dues workspace showing every customer with an outstanding balance, latest payment and full dated cash/online payment history
- Manual customer dues and supplier purchase-bill entries
- Dues workspace action to choose any customer, including a zero-balance customer, and add a dated manual due without creating a bill
- Payments received from customers and paid to suppliers, with exact date/time, payment mode and the remaining balance shown after every activity
- Editable party phone, address, GSTIN and price tier
- Payments allocated oldest-first or manually to selected bills
- WhatsApp outstanding reminders
- Detailed, print-refined A4, A5 and 3-inch thermal PDF invoice layouts
- Bill-level GST switch, default 18%, with 18%, 25% and custom 0–25% rates
- Per-bill carrier, packing and big-box charges with independent add/remove switches and editable amounts
- Extra charges are saved with the bill and carried through balances, history, reports, CSV export, A4/A5/thermal print and WhatsApp PDF sharing
- Save-only, print and WhatsApp invoice actions
- Persistent header language switch for English, Hindi and Bengali
- Cartesia-inspired serif/sans visual system with the exact extracted green, off-white, charcoal and grey reference palette
- Recoverable 30-day invoice bin
- GSTR-1 working CSV export for a CA
- Responsive business dashboard with live sales, payment-mode, udhaar, trend and product analytics
- Clickable customer purchase history in Reports with every saved bill, exact bill date and recorded time
- Reopen any historical invoice to review all purchased items, GST, paid amount and remaining due, then print or share it again
- Dedicated Miscellaneous workspace for dated tea, coffee, customer food, shop supplies, transport and other expenses
- Cash, UPI and bank expense modes, references, search, offline saving and recoverable deletion
- Date-filtered cash-flow reporting that separates sales billed from actual money received, supplier payments and miscellaneous money out
- Today, recent-period, current-month, all-time and exact custom date-range report filters
- Daily and party-wise sales reports, item-wise gross profit with missing-cost warnings, receivables aging, six-month dead stock and top-20 revenue reports
- Margin-by-party warnings that compare each customer's effective item rate with what other buyers paid for the same item
- Selectable wholesale, bulk or retail WhatsApp catalogue PDF export with product photos when available
- Quotation saving that does not affect balances, stock activity or remembered sale prices, plus idempotent one-tap conversion to a sales invoice
- Polished multi-page A4 PDF and plain-text exports containing the full calculation, dues/payables, expense breakdown and transaction detail
- PWA manifest and offline service-worker shell
- Supabase idempotent upsert, pull and Realtime refresh logic

Phase 2 inventory counting and Phase 3 festival planning are deliberately not built yet. The requested reporting and quotation slice of Phase 4 is now included.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm run test:unit
npm run build
```

## Android phone app

The repository includes a Capacitor Android application with package ID
`com.mantu.billing`. It embeds the complete offline-first billing bundle, so the
installed app starts and saves bills without depending on the hosted website. Native
Android sharing is used for invoice PDFs, catalogue PDFs and report exports; the
hardware back button closes the active billing sheet before leaving the app.

Android packaging validation:

```bash
npm run test:mobile
```

Build an installable debug APK on a machine with Android Studio, Android SDK 35 and
Java 17 installed. The repository pins AGP 8.6.1 and the Gradle 8.7 wrapper:

```bash
npm run mobile:android:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. A public
Play Store build requires the owner's signing key and store account; those secrets
must never be committed to this repository.

The current Android package targets API 35. Google Play requires new apps and app
updates to target Android 16 / API 36 beginning **2026-08-31**, so the compile/target
SDK and validated Android build toolchain must be upgraded before a submission on
or after that date.

The hosted PWA remains the zero-install phone option. In Android Chrome, open the
site, choose **Install app** (or **Add to Home screen**), and accept the prompt. It
uses the same IndexedDB data model and offline service-worker shell.

The core regression suite exercises billing, offline recovery, tenant-safe sync, payment reconciliation, historical-cost reporting, quotations, backups and the complete cash-flow/ledger model, including prevention of overpayments, duplicate sync records, deleted paid bills, double-counted receipts and stale-balance updates.

## Supabase connection

### Fresh project

1. Create a dedicated, blank Supabase project and enable anonymous sign-ins under Authentication.
2. Run `supabase/schema.sql` once in the Supabase SQL editor. It is the consolidated fresh-install schema; do not replay the migration directory over the same blank install.
3. In **More → Cloud backup**, enter the project URL and anon public key, then generate a private business sync code after owner-PIN unlock.
4. Enter that same private code separately on every trusted device. Keep it out of source control, build logs and client-public environment variables.

For managed builds, `.env.local` may prefill only the public Supabase URL and anon key. Enter the private sync code separately on each trusted device after owner-PIN unlock; never place it in a `VITE_` or `NEXT_PUBLIC_` variable because those values are extractable from client bundles. Do not configure a raw `business_id`: the database derives a SHA-256 tenant identifier from the authenticated session and stores only that identifier in synced rows.

### Existing project and migration history

Back up the Supabase database and make an in-app data export before changing an
existing project. If the remote migration history already records later
`20260808...` migrations but does not record the newly added fresh-install baseline,
do not execute the baseline against the populated database. Link the Supabase CLI,
inspect both histories, and record only that baseline as already applied:

```bash
supabase link --project-ref <project-ref>
supabase migration list
supabase migration repair 202608080000 --status applied
supabase db push --include-all --dry-run
```

Review the dry run. It should schedule the unapplied hardening migration
`202608091900_harden_multi_tenant_sync.sql` (and no unexplained migration). Then run:

```bash
supabase db push --include-all
supabase migration list
```

`migration repair` changes migration history only; it does not execute SQL. Use it
for the baseline only after confirming the populated project already has the older
schema, and never mark the hardening migration applied unless its SQL completed.
Stop and reconcile unexpected history instead of guessing. A fresh project created
from `schema.sql` does not need this legacy rollout.

Remote changes are pulled into IndexedDB before local unsynced rows are uploaded with tenant-scoped idempotent keys. Realtime database events trigger another sync. Without a per-device private code, the app remains fully usable on one device and correctly shows Offline.

Mutable cloud rows currently resolve concurrent edits with client-clock
last-write-wins. Immutable payment events are reconciled, but there is no server-side
compare-and-swap/revision check for other mutable rows yet; operators should avoid
editing the same record concurrently on devices with inaccurate clocks.

## Native release prerequisites

- Android release distribution requires a private signing key and Play Console account, plus an API 36 toolchain before the 2026-08-31 target-SDK deadline.
- Local Tauri builds require Rust and the target platform's native tools (MSVC on Windows or Xcode on macOS). Public Windows distribution still needs commercial code signing; public macOS distribution needs Apple signing credentials and notarization.
- Unsigned internal installers can trigger SmartScreen or Gatekeeper. Automated packaging does not replace acceptance testing on the intended computers, phones, printers and shop network.

## Billing assumptions

- Negotiated item rates are entered before GST.
- Cash and UPI bills default to fully paid for faster billing. Choose Credit for udhaar, or enter a smaller received amount for a mixed payment.
- Unknown or zero stock never blocks a sale.
- A locked party-item price does not change from a one-off negotiated bill unless staff first unlock it.
- The GSTR-1 CSV is a working export, not direct filing, IRN generation or e-way-bill integration.

## Shop setup

Open **More** to enter the shop name, address, phone and GSTIN, choose the invoice size, select the interface language and install the PWA on Android, macOS or Windows where the browser supports app installation.
