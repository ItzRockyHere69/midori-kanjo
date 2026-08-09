# Midori Kanjo — setup and disaster-recovery guide

**Generated:** 2026-08-10 (Asia/Kolkata)  
**Application version:** 0.1.1  
**Android version:** 0.1.1, version code 2  
**Source snapshot:** `main` at base commit `f77e9e8bfd86d5d155cdf9b59bd759d6778c4b42`, plus the verified 2026-08-10 feature working tree  
**Repository at generation:** OpenAI Sites project `appgprj_6a76356b6e7c8191bbe5a03637a9ac77`

This guide is written for a person with no memory of the project. Follow the
sections in order. Do not place a real key, password, connection string, sync
code, customer export or signing certificate in this repository.

> **Data warning:** the source archive is designed to be safe to store more
> casually because it contains no secret values. The separately generated
> business-data export is confidential and must be encrypted. See
> `backup/DATA_EXPORT_STATUS.md` before calling this a complete disaster-
> recovery backup.

## 1. What this snapshot actually contains

Midori Kanjo has one React/TypeScript application shared by:

- the hosted/PWA web build;
- Tauri 2 desktop shells for Windows and macOS; and
- a Capacitor 6 Android shell.

Dexie/IndexedDB is the local source of truth. The app can create records while
offline; Supabase is an optional synchronization and cloud-copy layer.

The repository contains billing, parties, dues, payments, items, product
photos, inventory-related stores, reports, PDFs, expenses, quotations, PWA
assets, native wrappers and automated billing/sync tests. Do not assume that
every feature described in old project conversations exists: the checked-in
README at this snapshot says Phase 2 counting and Phase 3 festival planning are
not fully built, which conflicts with some earlier project descriptions. The
source and tests at the commit above are authoritative.

## 2. External services and accounts

### Required for the current operating model

| Service/account | What it does | Minimum/recommended level |
|---|---|---|
| GitHub | Source control and the Windows/macOS Tauri build workflow. Actions artifacts contain MSI, NSIS EXE and DMG installers for 14 days. | Any account with repository and Actions access. Create the replica as a **private** repository. Hosted-runner usage is subject to the account's current Actions allowance. |
| Supabase | Postgres database, Anonymous Auth, Row Level Security, REST API and Realtime change notifications for cloud sync. | **Free works functionally** for a small/test replica within quotas, but it has no automatic database backups and may pause after inactivity. **Pro is recommended for production shop data** because paid projects do not pause and receive daily backups. Verify current limits at `https://supabase.com/pricing` and `https://supabase.com/docs/guides/platform/backups`. Use separate production and E2E test projects. |
| OpenAI/ChatGPT Sites | Hosts the current public web/PWA deployment represented by `.openai/hosting.json`. | Required only to reproduce that exact hosting route. It is not required for local web, Tauri or Android builds. A new account/workspace must create a new Sites project; the archived project ID does not grant ownership. |

### Used without a service account

| Service/tool | Use |
|---|---|
| WhatsApp | Invoice, receipt, catalogue and due-reminder sharing uses the device share sheet or a `wa.me` link. There is no WhatsApp Business API integration, account token or webhook. |
| npm registry | Downloads the exact JavaScript dependency graph from `package-lock.json`. No account is normally needed. |
| crates.io | Downloads Tauri/Rust crates. No account is normally needed. The missing `Cargo.lock` is a reproducibility risk discussed below. |
| Google Maven / Maven Central / Gradle distributions | Downloads Android Gradle and native dependencies. No account is normally needed. |
| Microsoft developer tools | MSVC C++ Build Tools and Edge WebView2 are required to build/run Tauri on Windows. No Microsoft Store account is required for an internal unsigned build. |
| Apple developer tools | Xcode Command Line Tools are required for a macOS Tauri build. An Apple Developer account is not required for an ad-hoc internal build, but is required for Developer ID signing/notarization or store distribution. |
| Android Studio / Android SDK | Builds and tests the Capacitor project. A Google Play developer account is needed only for later store publication. |

### Present in the tree but not an active account dependency

- `app/chatgpt-auth.ts` is unused scaffolding; the main page does not require a
  ChatGPT sign-in.
- `db/index.ts` and `db/schema.ts` are unused Cloudflare D1 starter scaffolding.
  `.openai/hosting.json` has `d1: null` and `r2: null`.
- Android Gradle conditionally notices `google-services.json`, but no such file,
  Firebase SDK or Firebase application configuration is tracked.
- `desktop/` contains a legacy Electron-era shell/configuration, but the active
  desktop implementation and CI use Tauri. Electron is not a required build
  dependency.

### Integrations explicitly not found

The tracked source contains no Razorpay, Twilio, MSG91, Stripe, Sentry, PostHog,
email delivery, SMS/OTP, Firebase, AWS, Google Maps, Auth0, Clerk, payroll,
e-invoice/IRN or e-way-bill integration. No account or secret for those
services is currently required. Do not create one merely because it appeared in
an earlier wish list.

## 3. Secrets and environment variables

The canonical value-free inventory is `backup/REQUIRED_SECRETS.md`.

### Application cloud configuration

Preferred build-time names:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_SYNC_CODE
```

Supported Node/Vinext fallback aliases:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_SYNC_CODE
```

Obtain the URL and publishable/legacy anon key from **Supabase project →
Project Settings → API**. Never use the Supabase `service_role` key in a client
build. Generate the business sync code yourself; it must be at least 20
characters and must be identical on every trusted device for the same business.
It is effectively the tenant password used by the current RLS policies.

For public web builds, leave `VITE_SUPABASE_SYNC_CODE` blank and enter the
configuration per trusted device in **More → Cloud backup**. A `VITE_*` value is
compiled into readable browser JavaScript; embedding the private sync code in a
public build defeats its secrecy.

Create an ignored local file only when a preconfigured internal build is needed:

```bash
cp .env.example .env.local
```

Fill it locally and never commit it. The repository's `.gitignore` ignores
`.env*` except `.env.example`.

### GitHub Actions secrets

The normal installer build needs no application secret. The optional real
desktop offline-sync test needs three repository Actions secrets:

```text
MIDORI_E2E_SUPABASE_URL
MIDORI_E2E_SUPABASE_ANON_KEY
MIDORI_E2E_SYNC_CODE
```

These must point to a dedicated test Supabase project with an empty application
dataset. Add them at **GitHub repository → Settings → Secrets and variables →
Actions → New repository secret**. `MIDORI_E2E_RUN_KEY` is generated by the
workflow; do not create it manually.

### Data export/restore variables

The supplied terminal tools use:

```text
SUPABASE_DB_URL
MIDORI_BUSINESS_ID
NEW_MIDORI_BUSINESS_ID
```

Get the Postgres connection string from **Supabase → Project Settings →
Database → Connection string**. It contains a password. Export it only in the
current terminal session, clear the shell history if necessary, and never save
it in `.env.local` or GitHub.

### Non-secret internal variables

`CODEX_SANDBOX`, `SITES_*`, `WRANGLER_*` and `MINIFLARE_REGISTRY_PATH` are
hosting/build-runner controls. The scripts set their own safe defaults. Normal
developers do not need to configure them. `MANTU_STATIC_ROOT` belongs to the
unused legacy desktop shell and is not needed for Tauri.

## 4. Exact dependency and toolchain snapshot

### JavaScript/TypeScript

- `package-lock.json` is npm lockfile version 3 and contains 1,251 package
  entries with resolved versions and integrity hashes.
- `npm ci` is the supported install command. Do not use `npm install` merely to
  set up an unchanged checkout because that can rewrite the lockfile.
- `package.json` requires Node.js `>=22.13.0`; GitHub Actions uses Node.js 24.
  Use the latest maintained Node 24.x release for the closest replica.
- Important resolved versions include React 19.2.8, Vite 8.2.1, TypeScript
  5.9.3, Vinext 0.0.50, Dexie 4.4.4, Supabase JS 2.112.2, Tauri CLI 2.11.4 and
  Capacitor 6.2.1.

The JS dependency graph is reproducible as long as registry artifacts remain
available. One weakness: `scripts/generate-android-assets.mjs` imports `sharp`
without declaring it as a direct dependency; it currently arrives transitively
through the locked graph.

### Tauri/Rust

- `src-tauri/Cargo.toml` declares Rust edition 2021 and `rust-version = 1.77.2`.
- CI installs the moving `stable` Rust toolchain, not an exact compiler.
- There is no committed `Cargo.lock`, and several crate specifications are
  ranges (`tauri-plugin-window-state = "2"`, for example). A future resolution
  may therefore differ from this snapshot. Generate and commit a reviewed
  `Cargo.lock`, then use `cargo build --locked`, before treating desktop builds
  as bit-for-bit reproducible.
- Tauri core is declared as 2.11.3 and the CLI resolves to 2.11.4.

Windows builds require Microsoft C++ Build Tools with **Desktop development
with C++** and Edge WebView2. macOS builds require Xcode Command Line Tools
(`xcode-select --install`). Tauri's current official prerequisites are at
`https://v2.tauri.app/start/prerequisites/`.

### Android

- Java/JDK: 17
- Android Gradle Plugin: 8.2.1
- Gradle wrapper: 8.2.1
- compile SDK: 34
- target SDK: 34
- minimum SDK: 22 (Android 5.1)
- Android package/application ID: `com.mantu.billing`

Install Android Studio 2023.1.1 or newer, SDK Platform 34 and SDK Build Tools
34.0.0. The checked-in Capacitor version supports API 22+, as documented at
`https://capacitorjs.com/docs/v6/android`.

### Other command-line tools

- Git 2.x
- Bash for repository scripts
- PostgreSQL client (`psql`) for the filtered business-data tools
- `sha256sum` for verification
- Optional Supabase CLI 2.113.0, the current npm release when this guide was
  generated; use `npx supabase@2.113.0 ...` if following the CLI route exactly

## 5. Start from an empty laptop

### 5.1 Install base tools

1. Install Git.
2. Install Node.js 24.x and confirm `node --version` and `npm --version`.
3. Install Rust through rustup and confirm `rustc --version` is at least 1.77.2.
4. Install platform-specific native tools from section 4.
5. Install PostgreSQL client tools if cloud data will be exported/restored.
6. Keep system date/time correct; invoice and sync timestamps depend on it.

### 5.2 Recover the source

From the source repository, when you have access:

```bash
git clone YOUR_AUTHORIZED_SOURCE_REPOSITORY_URL
cd midori-kanjo
git checkout f77e9e8bfd86d5d155cdf9b59bd759d6778c4b42
npm ci
```

The base commit alone does not include the 2026-08-10 feature working tree.
Use the dated backup ZIP below to recover the exact verified snapshot:

```bash
unzip midori-kanjo-full-backup-2026-08-09.zip
cd midori-kanjo
npm ci
```

Verify the supplied archive against the SHA-256 printed alongside the download
before running any script.

### 5.3 Validate the unmodified application

```bash
npm run lint
npm run test:unit
npm run build
npm run test:tauri:config
```

`npm run build` produces the hosted Vinext/Cloudflare Worker artifact. The
native wrappers use the shared `mobile-dist` bundle generated by their own
commands.

## 6. Create Supabase from zero

### 6.1 Create two projects

1. Sign in at `https://supabase.com/dashboard`.
2. Create a **production** project for real shop data. Save the database
   password in a password manager.
3. Create a separate **E2E test** project for GitHub Actions fixtures.
4. Free works for development/small use, but choose Pro for production if
   automatic daily backups, non-pausing operation and higher quotas are needed.

### 6.2 Enable the authentication mode the code expects

In each project, open **Authentication → Providers / Sign In methods →
Anonymous Sign-Ins** and enable it. The app calls `signInAnonymously()` and puts
the private business sync code in anonymous-user metadata. Anonymous users use
the `authenticated` Postgres role, which is why the policies target that role.

Review Supabase's current anonymous-auth guidance at
`https://supabase.com/docs/guides/auth/auth-anonymous`. A public deployment can
be abused to create anonymous users; consider the provider's CAPTCHA/rate-limit
controls before broad distribution.

### 6.3 Apply the schema and RLS policies

The migration chain is now self-contained. The added baseline
`supabase/migrations/202608080000_initial_complete_schema.sql` creates all seven
cloud tables, relationships, indexes, RLS state and policies. The later three
migrations are idempotent historical changes and apply in filename order.

Recommended CLI route:

```bash
npx supabase@2.113.0 init
npx supabase@2.113.0 login
npx supabase@2.113.0 link --project-ref YOUR_NEW_PROJECT_REF
npx supabase@2.113.0 db push --dry-run
npx supabase@2.113.0 db push
```

If `supabase init` reports that configuration already exists, do not delete the
`supabase/migrations` directory; keep the migrations and use the generated
`supabase/config.toml`.

Alternative SQL-editor route: concatenate/apply every file in
`supabase/migrations` in lexical order with **Stop on error** behavior. Do not
paste real data into the SQL editor. `supabase/schema.sql` is a current
idempotent schema snapshot for inspection, but the timestamped migration chain
should be the operational source of truth going forward.

Verify tables and RLS in the SQL editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'parties', 'items', 'party_item_prices', 'invoices',
    'payments', 'account_entries', 'expenses'
  )
order by tablename;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Every listed table should have RLS enabled and one `business ...` policy for
the `authenticated` role.

### 6.4 Enable Realtime for synchronized tables

In **Database → Publications / Replication**, include the seven public tables
above in the `supabase_realtime` publication. The app still performs explicit
push/pull sync without Realtime, but another device's changes will not trigger
an immediate refresh unless the tables publish changes.

### 6.5 Obtain the application values

From **Project Settings → API**, record the project URL and publishable/legacy
anon key in the password manager. Generate a strong private business sync code
of at least 20 characters. Do not use the database password or service-role key
inside the app.

### 6.6 Check live-schema parity

This package confirms that the repository schema covers every Supabase table
and column mapped by `lib/sync.ts`. It does **not** prove that an existing live
project had no dashboard-only changes because no authorized production database
connection was available during generation. Before retiring the old project,
run a schema-only dump and compare it:

```bash
npx supabase@2.113.0 link --project-ref OLD_PROJECT_REF
npx supabase@2.113.0 db dump --linked --schema public --file old-live-schema.sql
```

Treat any difference as a migration gap; review it before applying anything to
production.

## 7. Restore real business data

Read `backup/DATA_EXPORT_STATUS.md` first. The code archive intentionally has no
real business data.

### 7.1 Export one business from the old Supabase project

On a trusted machine with `psql`:

```bash
export SUPABASE_DB_URL='set-in-this-terminal-only'
export MIDORI_BUSINESS_ID='set-in-this-terminal-only'
./backup-tools/export-supabase-business-data.sh /secure/path/midori-cloud-export
unset SUPABASE_DB_URL MIDORI_BUSINESS_ID
```

The script filters every synchronized table by one `business_id`, writes CSV
files with mode 600 and creates `SHA256SUMS.txt`. It deliberately does not dump
all tenants or Auth users.

### 7.2 Export device-local IndexedDB

Supabase omits categories, stock movements, count sessions, activity logs,
daily closes and `meta`. It may also be missing offline rows not yet synced.

For each authoritative browser profile/device:

1. Open Midori Kanjo and let it finish loading.
2. Open that browser's developer console.
3. Paste the complete contents of
   `backup-tools/export-local-indexeddb.js` and press Enter.
4. Save the downloaded JSON with the sensitive cloud export.

The tool exports every Dexie store but deliberately excludes localStorage,
sessionStorage, the Supabase key and the business sync code. Production Tauri
and Android containers may not expose DevTools conveniently; if the only
authoritative data is inside one of those containers, do not uninstall it.
First sync every supported store to Supabase and plan an app-level encrypted
export feature for the remaining local-only stores.

### 7.3 Restore cloud rows into the new empty project

Apply the schema first. Confirm the seven application tables contain zero rows.
Then:

```bash
export SUPABASE_DB_URL='new-project-connection-string'
export NEW_MIDORI_BUSINESS_ID='private-code-for-the-new-project'
./backup-tools/restore-supabase-business-data.sh /secure/path/midori-cloud-export
unset SUPABASE_DB_URL NEW_MIDORI_BUSINESS_ID
```

The restore verifies CSV checksums, refuses a nonempty destination, loads rows
in foreign-key order in one transaction and rebinds them to the new business
code.

### 7.4 Restore local-only data

1. Open the new app once so Dexie creates the current database version.
2. Open the developer console on that same origin/profile.
3. Paste `backup-tools/restore-local-indexeddb.js`.
4. Choose the local JSON export and approve the destructive replacement prompt.
5. Reload the app.
6. Re-enter the new Supabase URL, publishable key and business sync code in
   **More → Cloud backup**.
7. Sync twice and verify counts/balances before using the replica for sales.

Do not merge multiple device JSON files blindly. Choose one authoritative local
snapshot, then let the stable IDs and Supabase sync reconcile supported stores.
Manually review local-only differences from secondary devices.

## 8. Run the web/PWA version locally

```bash
npm ci
npm run dev
```

Open the address printed by Vite. To test installability and service-worker
offline behavior outside localhost, serve it over HTTPS. Test this sequence:

1. Load once while online.
2. Add one test party and item.
3. Go offline and create three uniquely numbered bills.
4. Close and reopen the installed PWA; confirm records remain.
5. Reconnect and sync twice.
6. Confirm the cloud contains exactly three bills and the local party balance
   did not change on the second sync.

The checked-in Sites project is a convenience, not a portable account
credential. To reproduce Sites hosting under a new OpenAI workspace, create a
new Midori Kanjo Site through the Sites workflow and let it write a new
`project_id` to `.openai/hosting.json`. Do not expect the archived ID to grant
access to the old deployment.

## 9. Create a new GitHub repository and CI

Create an empty **private** repository named `midori-kanjo`. From the recovered
source directory:

```bash
git init -b main
git add .
git commit -m "Restore Midori Kanjo from 2026-08-09 backup"
git remote add origin https://github.com/YOUR_ACCOUNT/midori-kanjo.git
git push -u origin main
```

If the directory already has an old remote, inspect `git remote -v` and replace
only the intended remote; do not paste access tokens into a remote URL.

The push triggers `.github/workflows/tauri-desktop.yml`. It runs the Windows
and macOS jobs, lints and unit-tests the shared code, validates the Tauri bundle
and uploads:

- `midori-kanjo-windows-x64-installers`
- `midori-kanjo-macos-universal-dmg`

Download them from **GitHub → Actions → Build and test Tauri desktop installers
→ completed run → Artifacts** within 14 days.

To run the real native Supabase round-trip, add the three E2E secrets from
section 3, open **Actions → workflow → Run workflow**, enable
`run_native_offline_sync_test`, and run it on `main`. The test project must have
Anonymous Auth, the schema and RLS configured. It creates isolated fixtures,
tests offline create → native restart → reconnect → two idempotent syncs →
local purge → cloud download, then removes its own fixtures.

## 10. Build Tauri desktop packages manually

### Windows 10/11 x64

Run on Windows with Node, rustup, MSVC Build Tools and WebView2 installed:

```powershell
npm ci
rustup target add x86_64-pc-windows-msvc
npm run test:tauri:config
npm run lint
npm run test:unit
npm run tauri:build -- --bundles msi,nsis
```

Expected output directories:

```text
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

### macOS universal DMG

Run on actual macOS hardware or a macOS GitHub runner:

```bash
npm ci
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run test:tauri:config
npm run lint
npm run test:unit
npm run tauri:build -- --target universal-apple-darwin --bundles dmg
```

Expected output:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

The snapshot's macOS `signingIdentity` is `-` (ad-hoc) and no Windows signing
certificate is configured. These internal-test installers may trigger
Gatekeeper or SmartScreen. Signing/notarization is deliberately outside this
backup and requires owner-controlled certificates and accounts.

The Tauri window uses OS WebView storage and the window-state plugin. After
installing, explicitly test that IndexedDB survives a full app quit/relaunch,
not merely closing and reopening a tab.

## 11. Build the Capacitor Android app

Run on a machine with Node, Java 17, Android Studio and SDK 34:

```bash
npm ci
npm run mobile:sync
npm run test:mobile
npm run mobile:android:debug
```

Debug APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Open the native project when device testing is needed:

```bash
npx cap open android
```

The active native plugins are Capacitor App, Browser, Filesystem and Share.
There is no Camera plugin in `package.json`; product photos use the web file
input. Native invoice/catalogue/report sharing writes a temporary cache file
and invokes the Android share sheet.

`npm run mobile:android:bundle` creates a release bundle task, but this snapshot
does not contain an owner release-signing configuration. Treat the debug APK as
internal testing only. Never commit an Android keystore or its passwords.

On a physical device test:

1. first launch and local seed;
2. inline party and item creation;
3. product image selection and persistence after force-stop;
4. three offline bills and one partial payment;
5. app force-stop/restart while still offline;
6. reconnect and sync twice with zero duplicates;
7. PDF share to WhatsApp and Files;
8. hardware Back behavior and soft-keyboard layout.

## 12. Final restoration acceptance checklist

- [ ] Archive SHA-256 matches the reported value.
- [ ] `npm ci`, lint, unit tests and production web build pass.
- [ ] New Supabase production and E2E projects exist.
- [ ] Anonymous Sign-Ins are enabled.
- [ ] All seven tables, foreign keys, indexes and RLS policies exist.
- [ ] Realtime publication includes the seven synchronized tables.
- [ ] Production URL/key/sync code are stored only in the password manager and
      trusted device configuration.
- [ ] Sensitive Supabase CSV and local IndexedDB JSON exports are encrypted and
      checksummed.
- [ ] Parties, items, invoices, payments, expenses and product images match the
      old system.
- [ ] Local-only categories, stock history, count sessions, daily closes,
      activity logs and device settings were reviewed.
- [ ] Offline create → quit/restart → reconnect → double-sync passes on web,
      Windows, macOS and a physical Android device.
- [ ] Printed A4/A5/thermal output was checked on the actual shop printer.
- [ ] GitHub repository is private and Actions artifacts build successfully.
- [ ] A second person can find this guide and the password-manager entries.

## 13. Known fragile or undocumented areas

1. **This GitHub repository was public at generation time**, while older setup
   documentation says to create it as private. It currently passed a tracked-
   source secret scan, but public visibility increases the cost of any future
   mistake.
2. **Supabase is not a full backup.** Five operational stores plus `meta` are
   local-only. An app-level encrypted export/import should be a future priority.
3. **The production live schema was not readable during packaging.** The new
   baseline closes the obvious repository migration gap, but dashboard-only
   live changes must be captured with `supabase db dump`/`db pull` before the
   old project is retired.
4. **The business sync code is the current tenant boundary.** It is placed in
   anonymous-user metadata and stored in localStorage. This is simpler than
   owner/staff accounts but weaker than real per-user membership and roles.
5. **Anonymous-user buildup is not automatically cleaned.** Supabase documents
   abuse/rate-limit considerations; use a dedicated E2E project and monitor Auth
   user counts.
6. **Rust is not fully locked.** No `Cargo.lock` or fixed CI Rust compiler is
   committed.
7. **CI runners and actions float.** `windows-latest`, `macos-latest`, Rust
   `stable` and action major tags can change. Pin reviewed versions/commit SHAs
   for stricter supply-chain reproducibility.
8. **Installers are unsigned/unnotarized.** This causes SmartScreen/Gatekeeper
   warnings and is not suitable for broad distribution.
9. **Android identity still uses the pre-rebrand package ID**
   `com.mantu.billing`, while desktop uses `com.sayanfinance.midorikanjo`.
   Changing an application ID later affects upgrade continuity.
10. **Product photos are base64 strings in the item row**, so 1,000+ photos can
    make IndexedDB, Postgres pulls and backups large. Supabase Storage with
    thumbnails is not implemented.
11. **`sharp` is an undeclared direct tool dependency**, although the npm
    lockfile currently provides it transitively.
12. **Realtime requires a publication toggle** that SQL files do not currently
    enforce. Document and verify it on every new project.
13. **Real Android offline-sync is not in the GitHub workflow.** The native
    desktop path has a conditional E2E test; Android still needs a physical-
    device acceptance run.
14. **Feature documentation conflicts.** Earlier claims of complete festival
    planning do not match this snapshot's README. Reconcile product scope before
    promising it to another user.
15. **The production mobile/desktop bundle has an 853 kB minified main chunk.**
    Vite reports it above the 500 kB warning threshold. It is functional, but
    lower-end phones would benefit from reviewed code splitting and lazy loading.

## 14. Ongoing backup routine

At least monthly, and before every schema/release change:

1. Tag or record the Git commit and app versions.
2. Run the Supabase business-scoped export.
3. Run the local IndexedDB export on every device with authoritative local-only
   state.
4. Encrypt the sensitive exports and create SHA-256 checksums.
5. Store two copies in separate locations.
6. Run `npm ci`, tests and a native CI build.
7. Restore into an empty test Supabase project and clean browser profile.
8. Update the generated date and findings in this guide.

For Free-tier Supabase, do this more frequently because automatic backups are
not included. Even on Pro, retain independent logical exports; platform backups
are not a replacement for testing your own complete restore path.
