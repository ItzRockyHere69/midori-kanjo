# Midori Kanjo

Phase 1 is a mobile-first, installable billing PWA for a wholesale festival-decoration counter in Burrabazar. IndexedDB is the local source of truth, so billing keeps working without internet. Supabase is an optional sync layer and never sits in the save path.

## Phase 1 included

- One-screen wholesale billing with large touch controls
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

Build an installable debug APK on a machine with Android Studio, Android SDK 34 and
Java 17 installed:

```bash
npm run mobile:android:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. A public
Play Store build requires the owner's signing key and store account; those secrets
must never be committed to this repository.

The hosted PWA remains the zero-install phone option. In Android Chrome, open the
site, choose **Install app** (or **Add to Home screen**), and accept the prompt. It
uses the same IndexedDB data model and offline service-worker shell.

The 21-test core regression suite exercises a complete dozen/piece/packet/bundle bill, explicit full/part/pay-later behavior, a ₹10,000 bill with ₹5,000 automatically added to customer Dues, inline item and customer creation, negotiated PartyItemPrice memory, three-bill offline reconnect with idempotent cloud upserts, unique device-safe invoice numbers, A4/A5/thermal invoice generation, unit conversion, GST calculations, cash/credit behavior, product-photo isolation, searchable dues, dated payments, receivables, payables, miscellaneous expenses, exact-date cash-flow exports, all seven advanced report engines, branded catalogue PDFs, quotation isolation and duplicate-safe conversion, plus prevention of overpayments, duplicate sync records, double-counted receipts or stale-balance updates.

## Supabase connection

1. Create a dedicated Supabase project and enable anonymous sign-ins under Authentication.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. In **More → Cloud backup**, enter the project URL and anon public key, then generate a private business sync code.
4. Use exactly the same URL, key and sync code on every trusted device. Keep the sync code private.

For managed builds, copy `.env.example` to `.env.local` and set the same three values before building. The database policies bind every row to the strong sync code carried in the anonymous session, so another authenticated device cannot list or modify the business data without that code.

The local tables are pushed with idempotent `upsert` operations keyed by stable IDs, then remote changes are pulled into IndexedDB. Realtime database events trigger another sync. Without these environment values, the app remains fully usable on one device and correctly shows Offline.

## Billing assumptions

- Negotiated item rates are entered before GST.
- Cash and UPI bills default to fully paid for faster billing. Choose Credit for udhaar, or enter a smaller received amount for a mixed payment.
- Unknown or zero stock never blocks a sale.
- A locked party-item price does not change from a one-off negotiated bill unless staff first unlock it.
- The GSTR-1 CSV is a working export, not direct filing, IRN generation or e-way-bill integration.

## Shop setup

Open **More** to enter the shop name, address, phone and GSTIN, choose the invoice size, select the interface language and install the PWA on Android, macOS or Windows where the browser supports app installation.
