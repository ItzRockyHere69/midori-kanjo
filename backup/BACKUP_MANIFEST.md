# Backup manifest

| Field | Value |
|---|---|
| Product | Midori Kanjo |
| Publisher | Sayan Finance |
| Generated | 2026-08-10, Asia/Kolkata |
| Source repository | OpenAI Sites project `appgprj_6a76356b6e7c8191bbe5a03637a9ac77` |
| Branch | `main` |
| Base source commit | `f77e9e8bfd86d5d155cdf9b59bd759d6778c4b42` |
| Snapshot state | Base commit plus the verified 2026-08-10 feature working tree |
| Application version | `0.1.1` (Android `0.1.1`, version code `2`) |
| Source visibility at generation | Public deployment; source access is workspace-controlled |
| JavaScript lockfile | npm lockfile v3, 1,251 package entries |
| Rust lockfile | Missing; see maintenance warnings in `SETUP_FROM_SCRATCH.md` |
| Actual business data | Not included; see `backup/DATA_EXPORT_STATUS.md` |

## What was added for this replication package

- Reports-header mint dot/ripple decoration with reduced-motion and print-safe
  behavior.
- Optional shop proprietor/contact details and first-page-only full invoice
  identity with compact continuation headers.
- Measured A4/A5/thermal invoice pagination for long bills.
- Atomic free-typed billing customers with optional phone, address and code
  name.
- Cash, UPI, bank and cheque split-tender allocations, references, cloud
  migration and exact invoice/report breakdowns.
- A complete baseline Supabase migration, because the previous migration chain
  contained only later incremental changes and could not create an empty project.
- Secret-name documentation with no values.
- Supabase business-scoped CSV export and empty-project restore tools.
- Full IndexedDB export and restore console tools for local-only data.
- This manifest and `SETUP_FROM_SCRATCH.md`.

## Verification boundary

The repository schema was compared with every row mapper and table used by
`lib/sync.ts`. Live Supabase schema parity could not be confirmed without owner
database access. A secret-pattern scan over all tracked text at the source
commit found no private key, GitHub token, AWS access key, live Stripe key,
Supabase JWT, credential-bearing database URL, or assigned generic secret.

The final archive has its own SHA-256 checksum reported outside the archive so
the downloaded bytes can be verified independently.
