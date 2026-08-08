# GitHub setup for Midori Kanjo desktop builds

The repository contains one shared React/Vite application and one in-place
Tauri shell. The workflow at `.github/workflows/tauri-desktop.yml` builds:

- Windows x64 MSI and NSIS EXE installers on `windows-latest`
- A universal Intel + Apple Silicon DMG on `macos-latest`

## 1. Create the repository

Create an **empty private** GitHub repository named `midori-kanjo`. Do not add a
README, license or `.gitignore` in GitHub, because all three are already handled
by the prepared source tree.

From the prepared source directory, run:

```bash
git init -b main
git add .
git commit -m "Add Tauri desktop packaging and native offline sync test"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/midori-kanjo.git
git push -u origin main
```

If this source is already a Git checkout with another `origin`, use:

```bash
git remote rename origin sites
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/midori-kanjo.git
git push -u origin main
```

## 2. First installer build

The push starts **Build and test Tauri desktop installers** automatically. Open:

`GitHub repository → Actions → Build and test Tauri desktop installers`

When both matrix jobs are green, open the run and download these artifacts:

- `midori-kanjo-windows-x64-installers`
- `midori-kanjo-macos-universal-dmg`

Artifacts are retained for 14 days. These internal-test installers are not yet
commercially code-signed or Apple-notarized, so Windows SmartScreen and macOS
Gatekeeper may show warnings.

## 3. Enable the real native offline-sync run

Use a dedicated Supabase test project, enable anonymous sign-in, and apply
`supabase/schema.sql` in its SQL editor. Do not use production shop data.

In `GitHub repository → Settings → Secrets and variables → Actions`, add:

- `MIDORI_E2E_SUPABASE_URL` — the test project's HTTPS URL
- `MIDORI_E2E_SUPABASE_ANON_KEY` — the test project's public anon key
- `MIDORI_E2E_SYNC_CODE` — a stable random string of at least 20 characters

Never put these values in the repository or in a chat message.

Then open the workflow, choose **Run workflow**, enable
`run_native_offline_sync_test`, and run it on `main`.

On both native runners the test will:

1. start the compiled Tauri application;
2. force its browser connectivity state offline;
3. create one customer, one item and three credit bills in Dexie;
4. restart the native app and confirm IndexedDB persisted;
5. reconnect it to the real Supabase test project and sync twice;
6. verify one party, one item, one party price and exactly three unique bills;
7. remove those local rows, sync again, and verify all rows download intact;
8. clean up only that run's remote fixtures.

The test-only WebDriver server and harness are feature-gated and are absent from
the production installers uploaded by the final workflow step.

## 4. Manual acceptance after the automated run

Install the downloaded packages on one Windows 10/11 PC and one Intel or Apple
Silicon Mac. With a non-production sync code, repeat one real airplane/network-
off flow and verify printing. Hosted runners verify native WebView storage and
Supabase round-trip behavior, but they cannot validate your physical printer,
shop firewall/proxy, Windows SmartScreen policy, or macOS Gatekeeper policy.
