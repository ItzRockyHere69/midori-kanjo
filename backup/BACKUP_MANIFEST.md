# Backup manifest

| Field | Value |
|---|---|
| Product | Midori Kanjo |
| Publisher | Sayan Finance |
| Generated | 2026-08-11, Asia/Kolkata |
| Source repository | OpenAI Sites project `appgprj_6a76356b6e7c8191bbe5a03637a9ac77` |
| Branch | `main` |
| Verified pre-change baseline | `f063b5d` (dark-mode readability and native theme-persistence release) |
| Snapshot state | Desktop universal-macOS artifact verification repair on the V2 source snapshot |
| Application version | `0.1.2` across hosted, Android and desktop packages |
| Source visibility at generation | Public deployment; source access is workspace-controlled |
| JavaScript lockfile | npm lockfile v3, 1,251 package entries |
| Rust lockfile | Missing; see maintenance warnings in `SETUP_FROM_SCRATCH.md` |
| Actual business data | Not included; see `backup/DATA_EXPORT_STATUS.md` |

## What was added for this replication package

- Explicit macOS `app,dmg` production bundles plus cache-safe, dynamically
  resolved verification of the retained app and the app shipped inside the DMG.
- Space-safe `CFBundleExecutable`, universal-architecture, DMG integrity,
  retained-versus-shipped binary and portable checksum regression coverage.
- Paired semantic dark-mode colors for the Items shortcuts, Inventory controls
  and notices, every Season Planner view/editor, and related pale status panels.
- One safe hosted/native theme lifecycle: saved/system theme is applied before
  visible React content and each toggle synchronizes browser-native controls.
- Complete `MKDUES2` PDF and UTF-8 text archives for every due-history customer,
  preserving raw invoices/returns, payments, allocations and manual entries.
- Owner-reviewed atomic raw-ledger restore, legacy `MKDUES1` compatibility, and
  Owner-locked `MKMASTER1` replacement recovery for all 16 local stores.
- A wide 12-month spectrum plus six-week calendar grid with distinct organising
  and festival phases, overlap labels and localized inline day details.
- Complete Phase 2 stock workflows: sale deduction without blocking, inward,
  outward, returns, Owner adjustment, physical counts, history, alerts and
  valuation.
- Explicit unknown-versus-zero stock semantics, negative-stock billing and
  immediate settlement of return value above a party's outstanding balance.
- Dexie v6 inventory audit/count tables and 11-table tenant-safe Supabase sync.
- The incremental Phase 2 schema/RLS/Realtime migration for populated projects.
- Version 3 tenant-filtered 11-table cloud backup/restore with invoice return
  details and count/stock audit data.
- Reports-header mint dot/ripple decoration with reduced-motion and print-safe
  behavior.
- Optional shop proprietor/contact details and first-page-only full invoice
  identity with compact continuation headers.
- Measured A4/A5/thermal invoice pagination for long bills.
- Atomic free-typed billing customers with optional phone, address and code
  name.
- Cash, UPI, bank and cheque split-tender allocations, references, cloud
  migration and exact invoice/report breakdowns.
- A redesigned Reports financial snapshot with semantic green money-in, red
  money-out and amber due/payable values in light and dark themes.
- One shared Reports date range for cash movement, settlement and advanced
  reports, with current all-time balances labelled separately.
- A reconciled sales-collection donut, exact collected/due values and a
  separate payment-channel breakdown that counts split and later payments once.
- Matching financial colors in report PDFs plus regression coverage for
  settlement calculations, movement source IDs and accessible chart labels.
- A complete baseline Supabase migration, because the previous migration chain
  contained only later incremental changes and could not create an empty project.
- Secret-name documentation with no values.
- Supabase business-scoped CSV export and empty-project restore tools.
- Full IndexedDB export and schema-aware restore console tools for device-local data.
- This manifest and `SETUP_FROM_SCRATCH.md`.

## Verification boundary

The repository schema was compared with every row mapper and table used by
`lib/sync.ts`. Live Supabase schema parity could not be confirmed without owner
database access. A secret-pattern scan over all tracked text at the source
snapshot found no private key, GitHub token, AWS access key, live Stripe key,
Supabase JWT, credential-bearing database URL, or assigned generic secret.

The final archive has its own SHA-256 checksum reported outside the archive so
the downloaded bytes can be verified independently.
