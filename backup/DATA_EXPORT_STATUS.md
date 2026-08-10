# Sensitive business-data export status

Generated: **2026-08-10 (Asia/Kolkata)**  
Source snapshot: verified Phase 3 baseline `4133653` plus the completed 2026-08-10 dues-backup and expanded-calendar working tree

## Important: actual business rows are not in the source archive

No authorized Supabase database connection, private business sync code, or
browser/desktop/Android IndexedDB profile was available in the packaging
environment. Therefore this package does **not** pretend to contain the owner's
real parties, items, invoices, payments, expenses, photos, or local settings.

This is the one incomplete part of the continuity backup until the owner runs:

1. `backup-tools/export-supabase-business-data.sh` against the production
   Supabase project; and
2. `backup-tools/export-local-indexeddb.js` from every authoritative device or
   browser profile that may contain unsynced or local-only records.

The resulting CSV directory and JSON files are highly sensitive. They can
contain customer names, phones, addresses, GSTINs, supplier details, invoices,
dues, payments, purchase prices, expenses, product images, activity history and
owner settings. Keep them encrypted and separate from a public source archive.

## Why both exports are required

Supabase currently mirrors only these IndexedDB stores:

- `categories`
- `parties`
- `items`
- `partyItemPrices`
- `invoices`
- `payments`
- `accountEntries`
- `expenses`
- `countSessions`
- `countLines`
- `stockMovements`

These stores remain device-local in this source snapshot and are not included
in the Supabase sync layer:

- `festivalEntries`
- `festivalTasks`
- `activityLogs`
- `dailyCloses`
- `meta` (drafts, preferences, shop settings, PIN verifier and other device state)

A Supabase SQL/CSV dump alone is consequently not a complete operational
backup. The private sync code and Supabase session are also device-local but are
intentionally excluded; regenerate or re-enter them during restoration.

## Secure storage recommendation

- Encrypt the sensitive export with a password manager-backed passphrase or an
  age/PGP recipient before copying it to cloud storage.
- Store at least two encrypted copies on different media.
- Record a SHA-256 checksum next to—but not inside—the encrypted container.
- Test restore into a throwaway Supabase project and clean browser profile.
- Never commit the export directory or JSON file to GitHub, even if the
  repository is private.
