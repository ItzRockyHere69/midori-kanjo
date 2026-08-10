# Midori Kanjo — Chat Handoff

> Updated 2026-08-11 (Asia/Kolkata) for complete dues-ledger recovery, owner-locked master recovery, the dark-mode readability release and the desktop CI artifact-verification repair. This file contains no secret values. The source, migrations and tests are authoritative when an older conversation disagrees.

## Current status

**Product:** Midori Kanjo

**Display/package version:** `0.1.2`

**Current completed scope:** Phase 1 billing, Phase 2 inventory, Phase 3 festival planning, complete customer-dues history backup/restore, owner-locked 16-store master backup/restore, the expanded calendar, the implemented reporting/quotation slice of Phase 4, verified dark-mode readability across the primary application workspaces, and hardened Windows/macOS installer artifact verification

**Delivery model:** one React/TypeScript application for the hosted PWA, Capacitor Android and Tauri Windows/macOS shells

Phase 3 is additive to the existing billing, inventory and reporting app. The calendar and its task completion state are device-local; existing product festival tags still participate in optional item sync. Do not change the site's audience or distribute signed installers without the owner's explicit approval.

## Product decisions confirmed by the owner

1. **Ordinary sales:** deduct known stock, allow stock to become negative and never block billing. If stock is unknown, save the bill and an unapplied audit movement while stock stays unknown.
2. **Inward receipt against unknown stock:** log the receipt but keep stock unknown until counted. An Owner may explicitly choose “start from zero” to apply that receipt immediately.
3. **Return greater than the party balance:** apply only up to the outstanding balance, keep the balance nonnegative, and record the excess as an immediate refund for a sales return or immediate receipt for a purchase return.
4. **Festival sales history:** a season's inclusive historical window runs from its lead-time start through its festival end date.
5. **Initial festival lead time:** seed every festival with four weeks of lead time because shop sales normally begin about one month early; each festival/year remains independently editable.
6. **Overlapping seasons:** show every active planning window. One primary next-festival card must not hide another puja or event that is already selling.
7. **Significant post-season stock:** include known stock above the item's low-stock threshold, or any positive known stock when no threshold exists. Never adjust stock automatically.
8. **Carry before put-away:** if a leftover product is also tagged to a different festival whose planning window is already open, recommend carrying/reassigning it to that event before generic discount/put-away guidance.
9. **Wedding Season:** seed November 1 through the last day of February as an editable Kolkata business estimate, not a verified religious date.
10. **Dues recovery:** new `MKDUES2` files preserve and restore the original customer, invoices/returns, payment allocations, manual account entries, exact timestamps and settled status. Restore replays raw source records atomically and blocks every write on an identity, invoice-number or immutable-history collision. Older `MKDUES1` balance-only files remain supported through the clearly labelled legacy path.
11. **Calendar meaning:** the organizing/sales-start date is always the existing lead-time-derived `planningWindowStart(entry)`. The wider calendar must not introduce a second competing schedule field.
12. **Master recovery:** the Reports master file is an all-or-nothing replacement of all 16 local stores, not a merge. Owner PIN and cloud credentials/fingerprint are never exported or imported; the destination owner PIN is preserved, and cloud sync must be disconnected before restore.
13. **Theme contract:** interactive foregrounds must use a readable semantic text token instead of the dark fill token. Hosted and native shells must apply the saved/system theme before React renders, and each theme change must update the root theme, browser-native `color-scheme`, local cache and theme-color metadata together.

These are invariants, not optional UI preferences.

## Implemented Phase 2 behavior

### Stock model

- `Item.currentStock` is always expressed in the item's `baseUnit`.
- `null` means unknown; `0` means known and empty. Code must use explicit null checks, never truthiness.
- Piece, dozen and gross quantities use a dedicated six-decimal quantity converter. Price conversion remains separate.
- Every stock-changing command writes an immutable `StockMovement` in the same IndexedDB transaction as the item update.
- Movement `createdAt`/`updatedAt` use actual causal time. The operator-selected date is retained separately as the business date, so backdated entries still replay correctly.
- Product base units cannot change after known stock, an inventory/count movement or invoice history exists.
- Merged product aliases resolve to the active target for sales, quotations, returns, inward, outward, adjustment, deletion and restoration.

### Billing integration

- Saving a sale deducts tracked stock and may take it below zero.
- A sale with unknown stock is never rejected and does not invent a quantity.
- Quotation creation has no stock effect. Its idempotent conversion to a sale deducts stock exactly once.
- Invoice deletion and restoration create fresh compensating audit movements on every lifecycle transition.
- Item merges create an absolute target movement so later inventory reconciliation preserves the combined quantity.

### Inventory workspace

- Inventory is nested under the existing **Items** tab; the five phone tabs remain Bill, Parties, Items, Reports and More.
- **More → Inventory** is a shortcut into that same nested workspace, not a sixth tab.
- Inward receipts support ordinary quantities, carton/pack count × units per pack, supplier, supplier reference, date and note.
- Purchase-cost updates and unknown-stock start-from-zero require Owner unlock and resume the original action after PIN entry.
- Inward, outward and manual-adjustment commands use idempotency IDs to prevent retry/double-submit duplication.
- Outward reasons include damage, sample, internal use and other; an “other” entry requires a note.
- Owner-only absolute adjustment records before/after quantities and a required reason.
- Product creation from an inward form returns to the saved inward draft and preselects the new product.
- Product editor shows stock read-only and offers an opt-in nonnegative low-stock threshold; blank is invalid while explicit zero remains valid.

### Returns

- Sales and purchase returns may link to an original invoice or be entered manually.
- Linked returns require a valid original line and enforce cumulative returned quantity.
- A linked cash sale may be returned without attaching it to a different customer.
- Return balance credit is stored in `Invoice.returnDetails.balanceApplied` and immediate money movement in `settlementAmount` plus the invoice's initial payment breakdown.
- A return does not create a `Payment`, avoiding duplicate cash flow and duplicate balance reduction.
- Return submission is idempotent.

### Physical counts, alerts and reports

- Counts start or resume by category; only one in-progress session exists per category.
- Draft count lines preserve `null` versus `0`, autosave on blur, pause/reopen and show live progress.
- Review is read-only and warns when system stock changed while the count was paused.
- Owner commit rechecks current stock and base units, writes all adjustments atomically and is idempotent.
- Android Back closes the count-review sheet before leaving the count route.
- Low-stock reporting includes only products that explicitly opted into a threshold and have known stock.
- Inventory valuation is Owner-only and reports unknown stock, negative stock and missing purchase costs separately.
- Dead-stock reporting distinguishes dormant positive stock from unknown, negative and empty stock, and shows recent movement context.

## Implemented Phase 3 behavior

### Calendar and navigation

- **Items → Season Planner** opens the dedicated workspace; **More → Season Planner** is a phone shortcut. The five phone tabs remain Bill, Parties, Items, Reports and More.
- Dashboard, Calendar, Product tags, Year comparison and Leftovers are separate views inside the workspace.
- The dashboard shows one primary next festival plus every overlapping planning window whose four-week lead period has begun.
- Countdown state refreshes while the app is open and uses local calendar-day arithmetic rather than UTC timestamp parsing.
- Android Back returns from the Season Planner to the product catalogue before leaving Items.
- Calendar records store English, Hindi and Bengali names and independently editable start/end dates and lead weeks for every year. A row's start date is constrained to its record year; only Wedding Season may end in the following year.
- Editing a date immediately changes planning windows, countdowns, task due dates, history ranges and comparisons. Seed rows are never overwritten on restart.

### Kolkata/West Bengal seed policy

- The seeded list covers New Year, Saraswati Puja, Republic Day, Holi/Dol Jatra, Poila Boishakh, Rath Yatra, Independence Day, Janmashtami, Vishwakarma Puja, Durga Puja, Kojagari Lakshmi Puja, Kali Puja/Diwali, Bhai Phota, Christmas and Wedding Season.
- Historical 2024 and 2025 rows are explicitly seeded rather than generated by shifting another lunar year. Startup repairs only untouched auto-seeded rows from the early Phase 3 preview; any row marked as owner-edited is preserved. The 2026 dates use the West Bengal holiday calendar as the planning baseline. Sources: <https://par.wb.gov.in/holidaylist.php>, <https://wb.gov.in/pdf/Holiday-2026.pdf> and the corroborating list <https://wbchse.wb.gov.in/annual-working-plan/list-of-holidays/>.
- Fixed-date 2027 events are marked verified. Lunar/regional 2027 events are visibly provisional because no official West Bengal 2027 holiday notification was available on 2026-08-10; the owner should review them when the official calendar is released.
- Provisional core dates currently include Durga Puja October 6–10, 2027; Kojagari Lakshmi Puja October 14; Kali Puja/Diwali October 28–29; and Bhai Phota October 31. These are editable planning seeds, not authoritative observance guarantees.
- Wedding Season crosses the calendar year and is always labelled “Business estimate — editable.”

### Product assignment and scale

- Existing `Item.festivalTags` remains the source of product membership. Product Editor exposes accessible multi-select festival checkboxes.
- Bulk tagging supports festival, category, search and tagged-only filters; “select all filtered” applies to all matching active products. Product and reorder lists load in bounded pages with explicit Show next controls, so a large catalogue remains reviewable without rendering every card at once.
- Bulk updates run in one IndexedDB transaction with one timestamp, mark item rows pending for optional sync and do not partially update a large selection.
- `family:`, `aliasOf:`, unknown/custom and legacy representations are preserved. Existing managed festival tags on an inactive merged source move once onto its active target and are removed from the source, so the target remains editable and removing a tag does not make it reappear. New merges perform the same transfer. The combined Kali Puja/Diwali event recognizes both `kali_puja` and `diwali` without collapsing an existing representation.
- Inactive merged source products do not appear as assignable products; their historical invoice lines resolve to the active target.

### History, reorder and closeout

- Festival sales include non-deleted sales and net linked sales returns inside the inclusive lead-start-to-festival-end window. A linked return is attributed to its source sale's season even when the return is recorded later. Unlinked manual returns are excluded because the app cannot safely infer which historical season they belong to.
- Invoice lines convert piece/dozen/gross quantities into each item's base unit using the inventory converter. Incompatible units are not guessed.
- A season counts as covered only if the app's sale history spans the full window. Missing history is not displayed as zero sales.
- Startup seeds two prior calendar years, the current year and the next year without overwriting edits. Zero-history, one-covered-season and two-or-more-covered-season states have distinct copy; year-over-year comparison appears only when two fully covered windows exist.
- Item comparison shows base-unit quantity and revenue. Category comparison uses revenue only because adding pieces, dozens, packets and other incompatible units would be misleading.
- Reorder suggestions equal the last fully covered season's net quantity minus current known nonnegative stock, floored at zero. Unknown or negative stock asks for count/reconciliation; suggestions never create a purchase order or modify stock.
- Festival totals are independent planning views. A multi-tagged sale may legitimately appear in more than one festival window, so totals must never be summed across festivals.
- Leftovers use movement `createdAt` as the causal clock, reconstruct stock traceable at season end, reduce it by later outward movements and do not inflate it with later/backdated inward receipts. A later linked sales return or sale void from that festival adds the returned stock back; unattributed positive movements do not. The confirmed threshold rule applies to that traceable remainder, with owner-only value. A different festival tag whose planning window is already open produces “Carry/reassign to …”; otherwise the app suggests review for discount, selling push, put-away or holding.
- “Open dead-stock report” opens, scrolls to and focuses the existing Dead Stock report with sticky-header clearance. The seasonal leftover list itself remains broader because recent post-season stock may not yet meet the six-month dormant-stock rule.
- Calendar tasks and completion state work offline and survive close/reopen. They do not upload to Supabase.

## Portable dues backup and restore

- The Dues dashboard has **Outstanding**, **Paid in full** and **All** views. A customer appears only after real due history; fully paid histories stay visible with an explicit green `Paid in full` label, while cash-only customers who never owed money are excluded.
- **Dues → Backup & restore dues** creates an `MKDUES2` PDF or UTF-8 text archive for all due-history customers, including those now settled. Each customer card also creates its own complete PDF/text archive without initiating a multi-download batch.
- Human sections show customer identity, GSTIN, price tier, notes and tags; exact business date and recorded date/time; every sale, split initial receipt, later payment, allocation, manual due, return credit, immediate refund, mode/reference and running balance; and a full invoice/return appendix with line, tax, charge, tender, allocation, note and void details.
- Both formats contain the same versioned, checksummed, integer-paise machine payload. TXT uses one exact restore block; PDF uses the dedicated XMP namespace. A marker-like customer reference is ordinary text, while duplicate true restore blocks are rejected.
- Export reads parties, invoices, payments and account entries in one IndexedDB read transaction and validates the finished archive before download. Import validates schema, timestamps, arithmetic, relationships, payment/return caps and event/summary parity before previewing any write.
- File selection only opens a preview. Committing complete financial history requires Owner Mode and is all-or-nothing. Identity conflicts, immutable-history drift, missing archived records, invoice-number collisions, cross-customer allocations, overpayments or any malformed row block the entire restore.
- A successful restore writes the original party and raw invoice/return/payment/account-entry records in one transaction and raises the matching device invoice counter when required. Close/reopen plus startup reconciliation leaves the restored records and statements stable.
- Reimporting an unchanged archive is a no-op. Legitimate later payments remain allowed and do not invalidate the original archive; changing an archived invoice line, total, note or deleted state does.
- Legacy `MKDUES1` PDF/text files still import through the labelled balance-only compatibility path. They create canonical brought-forward due entries and never pretend to contain historical invoices or payments.
- Dues files contain private customer and accounting information and are unencrypted. The checksum detects damage/editing but is not a digital signature; share the file only with trusted recipients and keep the original export unchanged.

## Owner-locked master backup and restore

- **Reports → Master backup & restore** is visible as a locked card to staff. Export, file selection and restore controls appear only after Owner Mode is unlocked with the app's owner code.
- `MKMASTER1` is a human-labelled, checksummed UTF-8 text archive containing every row from all 16 current Dexie stores: categories, parties, items, customer prices, invoices/returns/quotations, payments, account entries, expenses, stock movements, count sessions/lines, festival entries/tasks, activity logs, daily closes and portable meta/settings.
- Portable device settings include theme and interface size. Owner PIN verifier/lockout, Supabase URL/key/private sync code, cloud tenant fingerprint/diagnostics and device invoice code are deliberately excluded. Restore preserves the destination owner PIN.
- Export validates store parity, row schemas, dates/timestamps, enums, money and invoice arithmetic, canonical/composite IDs, unique invoice numbers and daily closes, references, allocation caps, party balances, stock movement chains, count membership and festival relationships. The app will not emit an archive it would reject on import.
- Import performs size, marker, version, checksum, store-count, schema and referential validation before showing the source time and replacement totals. The owner must explicitly acknowledge that current local data will be replaced.
- Restore is destructive replacement, never merge: it rechecks a full-content destination fingerprint and cloud-disconnected state inside one transaction, clears and repopulates all stores, preserves the owner PIN, appends an audit event and verifies every count before commit. Any failure rolls the complete transaction back.
- All 11 cloud-synchronized store rows are marked pending after restore. Active Cloud backup blocks restore so an in-flight/pull-first sync cannot overwrite the recovered local snapshot; reconnect only after reviewing the restored business.
- Theme/size are applied only after the database commit and are rolled back locally if either write fails. The app reloads immediately after success and blocks tab changes, Android Back and unload while replacement is running.
- The master file is confidential and unencrypted. Owner Mode protects access inside the app; it does not encrypt a downloaded file. Store it in an encrypted location and never edit the restore block.

## Expanded Season Planner calendar

- Calendar now opens as a wider year spectrum plus a stable six-week month grid instead of a long list of date-editor cards.
- Month navigation includes previous/next, Today and year selection. Adjacent years are ensured before display so December planning for next January and Wedding Season spillover remain visible.
- Organizing periods and festival/puja dates use distinct labeled colors; overlaps show stacked activities and a count, so meaning never depends on color alone.
- Every date cell, including muted previous/next-month spillover dates, is a keyboard and touch target. Selecting a date opens a non-modal inline detail region with every overlapping event, its organizing start, festival range, full sales window, lead weeks and date status.
- Schedule editing still reuses the canonical `FestivalEntry` editor. Changes immediately alter month bands and detail ranges; the complete per-year editor list remains available behind **Edit all festival dates**.
- The calendar keeps a bounded inner horizontal scroller at very narrow widths, has 44-pixel date targets, supports dark mode and reduced motion, and expands to 1440 pixels without widening unrelated app screens.

## Dark-mode readability and theme lifecycle

- **Items → Inventory** and **Items → Season Planner** use one paired semantic shortcut style. The former hard-coded pale background can no longer remain light while a broad dark-mode rule turns its label white.
- Inventory back/action controls, progress, unknown-stock/warning/error notices and native product fields use theme-aware foreground, surface, border, option and focus tokens.
- Season Planner Dashboard, Calendar, Product tags, Year comparison, Leftovers and the full festival editor use readable interactive/status colors on dark surfaces. Selected outlines, calendar bands, task states, business estimates and compact labels no longer reuse the dark green fill token as text.
- The same audit repaired related unpaired pale surfaces in payment receipts, daily closing and quotation estimates, plus dark interactive text in party controls, interface-size previews and report actions.
- `lib/theme.ts` owns safe saved/system theme selection, root application and cache writes. `mobile/main.tsx` applies it before `createRoot`; the hosted pre-paint bootstrap does the equivalent; and the runtime effect keeps `data-theme` and inline `color-scheme` synchronized for native inputs, selects and options.
- The contrast regression calculates representative light/dark pairs, rejects the original hard-coded failures, verifies semantic selector coverage and asserts native theme-bootstrap ordering.

## Desktop installer CI artifact verification

- The macOS matrix now requests both explicit Tauri targets, `app,dmg`. The old
  job requested only `dmg` and then assumed Tauri retained its intermediate
  `.app`, which is not part of the `dmg`-only output contract.
- The space in `Midori Kanjo.app` was not the failure: the former Bash step
  quoted the complete path. The failed path was one argument to `lipo`; the
  hard-coded executable path was absent. The supplied error alone cannot
  distinguish an intermediate-app cleanup from a bundle-name, executable-name
  or output-path mismatch, so the repair no longer assumes any of them.
- Before the macOS build, only the cached universal `bundle/macos` and
  `bundle/dmg` outputs are cleared. Rust dependency cache entries remain intact,
  while stale installer files cannot satisfy or confuse exact-one checks.
- Before the Windows build, only cached MSI and NSIS bundle outputs are cleared.
  Verification requires exactly one MSI and exactly one NSIS EXE separately, so
  two files of one type can never masquerade as the requested installer pair.
- `scripts/verify-macos-universal.mjs` requires exactly one emitted `.app` and
  one DMG, discovers the app name, reads `CFBundleExecutable` from `Info.plist`,
  checks that the executable exists and is runnable, and passes every path as
  an `execFile` argument so spaces are never shell-split.
- Both `arm64` and `x86_64` must be present. The verifier validates the disk
  image, mounts it read-only, repeats the architecture check on the enclosed
  application, and requires the retained and shipped executable bytes to
  match before writing a portable filename-only SHA-256 entry.
- The fixture regression uses a directory, app and DMG name with spaces plus a
  deliberately different `CFBundleExecutable`; it also rejects a missing app
  and a single-architecture binary. Static workflow tests prevent restoration
  of the former hard-coded path and enforce build → verify → upload order.

## Local database and cloud sync

**Dexie database:** `BurrabazarBillingDB`

**Current schema version:** `7`

Phase 2 adds/expands:

- `categories`
- `stockMovements`
- `countSessions`
- `countLines`

Phase 3 adds device-local stores:

- `festivalEntries`
- `festivalTasks`

The v7 migration is additive. It does not change the Supabase schema or its 11 synchronized tables. Local IndexedDB export enumerates these stores automatically.

The v6 upgrade backfills timestamps/sync flags and creates an opening baseline for known legacy stock. Same-stock baseline events from two independently upgraded replicas converge even when their replica-local timestamps differ; a different opening quantity remains an explicit audit conflict.

Supabase now synchronizes 11 tables:

1. `categories`
2. `parties`
3. `items`
4. `party_item_prices`
5. `invoices`
6. `payments`
7. `account_entries`
8. `expenses`
9. `count_sessions`
10. `count_session_lines`
11. `stock_movements`

`activityLogs`, `dailyCloses`, `festivalEntries`, `festivalTasks` and `meta` remain device-local. Unsynced rows can temporarily exist in synchronized IndexedDB stores.

Sync remains pull-first, tenant-scoped, paginated and batched. After every pull, legacy festival tags found on an inactive merged source move to the active target before that sync's item upload batch is collected, so a fresh cloud-first device is repaired in the same cycle. Parent rows upload before child rows. Nothing from a captured upload batch is marked synced until all uploads succeed, and a row changed during upload remains pending. Categories/sessions/lines use client-clock last-write-wins with conflict diagnostics; stock movements are append-only and same-ID payload conflicts stop inventory upload.

### Supabase schema rollout

- Fresh project: run `supabase/schema.sql` once.
- Existing populated project: back up first, preserve migration history, and apply migrations in lexical order. The Phase 2 migration is `supabase/migrations/202608101500_phase2_inventory_sync.sql`.
- Both the consolidated schema and initial fresh-install migration describe the same final 11-table state.
- All application tables use composite `(business_id, id)` keys, tenant-scoped foreign keys, authenticated RLS and hashed business identifiers.
- The SQL adds all 11 synchronized tables to `supabase_realtime` when that publication exists.
- Apply the remote migration before running this app against an older seven-table Supabase project; otherwise inventory remains local/pending and sync reports the missing remote schema.

## Backup and restore

- Cloud export/restore format is version 3 and contains 11 tenant-filtered CSV files plus a manifest and SHA-256 checksums.
- Restore verifies exact headers and checksums, stages rows, requires an empty destination and inserts in foreign-key-safe order in one transaction.
- Invoice backup includes both `payment_breakdown` and `return_details`.
- Local IndexedDB export enumerates every store, including `countLines`.
- Local restore migrates supported older payloads in memory and rejects payloads from a newer database version. The store enumeration includes Phase 3 calendar and task rows.
- The Dues `MKDUES2` PDF/text archive is customer-ledger scoped: it restores complete due-contributing sales/returns, receipts, allocations and manual entries for due-history customers, but it is not an inventory, expense, product/settings or whole-business backup.
- The Reports `MKMASTER1` text archive is the canonical complete local replacement backup for all 16 stores and portable settings. It deliberately excludes the owner PIN and cloud/device credentials.
- Actual business rows and secrets are not included in the source package. Keep cloud CSV, local JSON and downloaded master/dues files encrypted at rest.

## Important files

| Area | Files |
| --- | --- |
| Inventory domain | `lib/inventory.ts`, `lib/db.ts` |
| Festival domain | `lib/festivals.ts`, `lib/db.ts` |
| Billing/ledger integration | `lib/billing.ts`, `lib/due-backup.ts`, `lib/due-statement-export.ts`, `lib/dues-ledger-archive.ts` |
| Inventory UI | `app/InventoryWorkspace.tsx`, `app/inventory-copy.ts`, `app/BillingApp.tsx`, `app/globals.css` |
| Dues backup UI | `app/DueBackupSheet.tsx`, `app/due-backup-copy.ts`, `app/BillingApp.tsx`, `app/globals.css` |
| Master recovery | `lib/master-backup.ts`, `app/MasterBackupPanel.tsx`, `app/BillingApp.tsx`, `app/globals.css` |
| Festival UI | `app/FestivalWorkspace.tsx`, `app/festival-copy.ts`, `app/BillingApp.tsx`, `app/globals.css` |
| Theme/readability | `lib/theme.ts`, `app/layout.tsx`, `mobile/main.tsx`, `app/globals.css`, `tests/dark-mode-contrast.test.mjs` |
| Desktop packaging CI | `.github/workflows/tauri-desktop.yml`, `scripts/verify-macos-universal.mjs`, `tests/macos-bundle-verifier.test.mjs`, `tests/tauri-package.test.mjs` |
| Reports | `lib/reports.ts`, `app/AdvancedReports.tsx` |
| Sync | `lib/sync.ts`, `app/QolPanels.tsx` |
| Supabase | `supabase/schema.sql`, `supabase/migrations/202608101500_phase2_inventory_sync.sql` |
| Backup tools | `backup-tools/` |
| Regression tests | `tests/billing-core.test.ts`, `tests/due-backup.test.ts`, `tests/dues-ledger-archive.test.ts`, `tests/master-backup.test.ts`, `tests/dues-backup-platform.test.mjs`, `tests/dark-mode-contrast.test.mjs`, `tests/festival-planning.test.ts`, `tests/festival-platform.test.mjs`, `tests/macos-bundle-verifier.test.mjs`, `tests/tauri-package.test.mjs`, `tests/supabase-schema.test.mjs`, `tests/mobile-package.test.mjs`, `backup-tools/backup-tools.test.mjs` |

## Verification boundary

### Executed for the V2 source plus desktop CI repair

| Check | Result |
| --- | --- |
| `npm run lint` | Passed with zero errors |
| `npx tsc --noEmit --incremental false` | Passed |
| `npm run test:unit` | 105/105 passed, including `MKDUES2` all/per-customer TXT/PDF parity, complete raw-history restore, actual close/reopen reconciliation stability, later-payment idempotence, legacy tender/round-off normalization, overpayment/collision rejection, all-16-store master export/preview/fingerprint/cloud block/rollback/reopen restore, the 2,000-customer migration check and the existing 2,501-product sync stress case |
| `npm run test:platform` | 54/54 passed, including the new paired-color and pre-render/native theme lifecycle regressions, current dues-archive/native-permission source contracts and existing responsive/platform hardening |
| `npm run test:mobile` | 28/28 passed after production mobile build and Capacitor sync |
| `npm run test:desktop` | 1/1 passed |
| `npm run test:tauri:config` | 8/8 passed, including four dynamic macOS path/artifact regressions |
| Localization regression | 6/6 passed |
| `npm run build` + `npm run validate:artifact` | Passed; the hosted artifact remains valid and unchanged by the desktop-only repair |
| Agent-preview UI QA | Passed contrast scanning on all seven desktop navigation destinations in dark mode; Inventory hub and form fields; all five Season Planner views; expanded calendar day details and festival editor; paired Items shortcuts in English, Hindi and Bengali; and light/dark theme-toggle synchronization with native `color-scheme` |
| `git diff --check` | Passed after final documentation updates |

The native Windows and macOS installer jobs cannot execute inside this Linux
checkout. GitHub `main` still contains the identical pre-fix V2 source under
commit `1e7f9c4`; pushing or merging this repaired source is therefore required
to start the real `windows-latest` and `macos-latest` matrix. Do not call the
native-runner repair confirmed until that new run shows the shared, Windows and
macOS jobs all succeeded. The macOS job itself now performs the retained-app,
mounted-DMG and checksum assertions described above before it can turn green.

The Android production web bundle and Capacitor project sync passed. A debug APK could not be assembled in this sandbox because the Gradle 8.7 distribution is not cached and the Gradle download host is unreachable here. Build the APK on the documented Java 17/Android SDK 35 workstation; do not treat a stale APK from another source snapshot as this release.

The final package should not be called verified until the following are rerun against the packaged source:

```bash
npm ci
npm run lint
npx tsc --noEmit --incremental false
npm run test:unit
npm run test:platform
npm run test:mobile
npm run test:desktop
npm run test:tauri:config
node --test tests/localization-regression.test.mjs
npm run build
npm run validate:artifact
git diff --check
```

The secret-gated real Supabase/native E2E is conditional. Do not claim it passed unless `MIDORI_E2E_SUPABASE_URL`, `MIDORI_E2E_SUPABASE_ANON_KEY` and a dedicated sync code were actually provided and the run completed. Physical printers, store signing, SmartScreen/Gatekeeper and named physical-phone checks also remain manual acceptance work.

## Known limitations and operational cautions

1. Mutable synced rows still use client-clock last-write-wins; keep device clocks accurate and avoid editing the same record concurrently.
2. A completed count reaches Supabase as ordered parent/line/movement upserts, not one server-side RPC transaction. Retry converges after a partial network failure, but another device can briefly observe an incomplete remote count.
3. Two devices should not independently create returns against the same original invoice while both are offline. Local quantity/balance checks are transactional, but there is no server-side reservation to arbitrate concurrent offline returns.
4. The business sync code is the current tenant boundary and is stored in anonymous-user metadata/local device configuration. It is not a replacement for full named-user membership and roles.
5. Android currently targets API 35. Revalidate the Android toolchain and upgrade to API 36 before a Play submission subject to the 2026-08-31 target requirement.
6. Store/public installers still require owner signing credentials. Windows/macOS internal installers may trigger SmartScreen or Gatekeeper.
7. Product photos are base64 item fields; a large photo catalogue can make IndexedDB, pulls and backups large.
8. The main JavaScript bundle still produces a size warning. This is an optimization item, not a correctness failure.
9. Festival calendar edits and task completion are per-device. Product tags can sync because they are existing item fields, but calendar/task rows do not cross devices.
10. Historical invoice lines do not snapshot category or festival membership. Reports classify old lines using the current active product's current category/tag assignment.
11. A multi-tagged product's invoice can appear in several overlapping festival views. Those totals are useful independently but are not additive.
12. 2027 lunar/regional seeds and the Wedding Season estimate require owner review; dates remain conspicuously editable in the Calendar view.
13. Automated checks cover responsive contracts, localization and packaged assets, but representative Android/iPhone/tablet/desktop visual acceptance, printers and physical stock workflow remain manual.
14. A leftover needs a known applied stock movement at or before season end. Older legacy stock without that audit point is omitted instead of being guessed; count it first if the shop needs closeout guidance.
15. An unlinked manual sales return is excluded from festival totals because its source season is unknowable. Link the original sale when historical festival attribution matters.
16. Dues PDF/text recovery is complete for each included customer's due-contributing ledger history, but it intentionally does not restore products, stock movements, expenses, settings or every non-due cash-only sale. Use the Reports master backup for whole-application recovery.
17. Re-saving or printing a dues PDF can strip its embedded restore payload. Keep the unmodified exported PDF or text file for later import.
18. Dues and master exports are checksummed but unencrypted. Owner Mode gates in-app access; it cannot protect a downloaded copy. Store exported files in encrypted storage.
19. Master restore currently requires the same supported `MKMASTER1` and Dexie schema version. A future database-version change must add an explicit portable migration before old master files are advertised as restorable by that future release.
20. Master restore is blocked while Cloud backup is configured. After local recovery, reconnect only after reviewing tenant ownership and the intended cloud replacement direction; ordinary pull-first synchronization is not a server-side disaster-recovery restore.
21. The 256 MiB master and 64 MiB dues limits prevent silent truncation, but image-heavy catalogues still create transient string/base64 memory pressure on mobile WebViews. Test the shop's real photo catalogue on its target phone and keep multiple encrypted backups.

## Release boundary and next work

Phase 3 festival planning, the expanded calendar, complete dues-ledger recovery, owner-locked master recovery and the dark-mode readability release are complete. Do not add automatic purchase orders, automatic discounts, stock mutations, cross-device festival-calendar sync, heuristic PDF/OCR debt import or a new public audience without a separate owner decision.

Operational follow-up:

1. In **Items → Season Planner → Calendar**, review every provisional 2027 lunar/regional date when West Bengal publishes its official 2027 notification.
2. Confirm or edit the November–February Wedding Season estimate for the shop's actual buying/selling calendar.
3. Tag the full live catalogue by festival/category; seeded sample tags are only examples.
4. Perform offline sale, bulk tagging, calendar editing, close/reopen, overlapping-window and post-season-leftover acceptance on a representative shop phone.
5. Create an Owner-only Reports master backup before clearing browser/app data or reinstalling; keep the downloaded file encrypted and verify that it can be opened in the restore preview.

## Copy-paste prompt for a future chat

```text
Continue Midori Kanjo from this repository. Read docs/CHAT_HANDOFF.md completely, then inspect git status and the current diff without resetting or discarding anything.

Phase 2 inventory, Phase 3 festival planning, the expanded calendar, complete `MKDUES2` customer-ledger recovery, Owner-locked `MKMASTER1` recovery and the dark-mode readability/theme-lifecycle release are implemented. Preserve these rules: sales deduct known stock, may go negative and never block; unknown inward stays unknown unless an Owner explicitly starts from zero; returns apply only up to the party balance and settle excess immediately while balances stay nonnegative. Festival history runs from lead-time start through festival end; all active windows may overlap; leftovers use the low-stock-threshold rule; Wedding Season is an editable business estimate. New dues files preserve the raw party/invoice/return/payment/account-entry history and restore it atomically after Owner review; legacy `MKDUES1` remains a clearly labelled balance-only path. Master restore replaces all 16 stores atomically, preserves the destination PIN, excludes cloud/device secrets and stays blocked while cloud sync is configured. Keep Inventory and Season Planner nested under Items and preserve the five phone tabs. Keep interactive foregrounds semantic and readable in both themes, and apply saved/system theme plus native color-scheme before React renders.

First report the actual repository/test/deployment state. Do not change the public audience, add automatic stock/purchase actions, alter cloud scope or distribute signed installers unless I explicitly ask. If you change code, rerun lint, TypeScript, unit, platform, mobile, desktop, Tauri, production build/artifact, localization and whitespace checks. Never claim secret-gated real Supabase E2E, physical-device acceptance or official verification of provisional festival dates without evidence.
```
