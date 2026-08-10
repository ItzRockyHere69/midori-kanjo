# Modern Hindi, Bengali and dashboard update

This backup captures the 2026-08-09 language modernization pass. Hindi and
Bengali are selected-language interfaces, not mixed trilingual headings.
Common shop language is deliberately contemporary and concise; brand names,
GST, PDF, UPI and other familiar business acronyms remain recognizable.

The 2026-08-10 update also adds the requested Square-12 as a restrained Reports
dashboard decoration. It uses the canonical solid-mint color, appears at
laptop/desktop widths without taking phone/tablet space, remains
noninteractive, hides for print and freezes to a meaningful static radial state
when reduced motion is requested.

## Coverage

- Billing, parties, ledgers, items, catalogue, dues, expenses, reports,
  settings, owner controls, search, daily close and saved-invoice flows.
- Labels, placeholders, status messages, confirmations, errors, toast text,
  table descriptions and accessibility names.
- Language-aware product snapshots, units, payment modes, categories, dates,
  cash-customer labels and known built-in expense descriptions.
- Invoices, payment receipts, due statements, catalogues and report exports in
  English, Hindi or Bengali.
- Offline Indic PDF rendering with embedded Noto Devanagari/Bengali font data
  and embedded HarfBuzz shaping. PDFs retain a searchable Unicode text layer.

## Bugs corrected during the audit

- Partial language switching and English leakage across screens and exports.
- Wrong localized product-name priority and English-only date formatting.
- Bengali/Hindi vowel marks being damaged by search and duplicate detection.
- Invalid persisted language values causing missing-label crashes.
- A cancelled bill-line removal still deleting the item.
- Misleading or grammatically broken translated controls and interpolations.
- Cash-customer and built-in expense labels leaking English after persistence.
- Incorrect invoice layout in exact-PDF preview.
- Print and receipt-share popups being blocked after asynchronous PDF work.
- A custom catalogue share message being ignored.
- Spreadsheet formula injection through user-controlled GSTR CSV cells.
- Missing Indic glyph shaping, external WASM packaging and restrictive CSPs.
- Stale mobile-build locks and obsolete hashed Android assets surviving builds.

## Compatibility notes

- The stable stored value `Cash customer` is retained for legacy data and sync
  compatibility, but every supported display/export boundary localizes it.
- Indian business dates intentionally use locale ordering with Latin digits.
- The regular merged Indic font is used for both PDF weights; current templates
  do not rely on rotated or fully justified Indic text.

## Verification

- Unit tests: 99/99 passed.
- Mobile package tests: 28/28 passed.
- Platform, native-security, schema, dues-backup and calendar tests: 51/51 passed.
- Localization regression tests: 6/6 passed.
- Dues TXT/PDF regressions include bulk snapshots and per-customer statements
  in English, Hindi and Bengali.
- Tauri package tests: 4/4 passed; desktop package test: 1/1 passed.
- Recovery-tool mock regression tests: 16/16 passed.
- TypeScript, targeted ESLint, production web build and clean Android sync all
  passed. The only build notice was the expected large-chunk warning caused in
  part by the embedded offline font and shaping payload.
