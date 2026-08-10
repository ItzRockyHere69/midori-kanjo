# Midori Kanjo 0.1.2 desktop installation

Midori Kanjo uses one verified application and two separate native packages.
The billing, parties, inventory, dues, reports, English/Hindi/Bengali UI,
PDF formats, offline database and optional cloud sync are shared unchanged.

## Windows 10/11

The Windows artifact contains two installers:

- `Midori Kanjo_0.1.2_x64-setup.exe` — recommended for an ordinary shop PC.
- `Midori Kanjo_0.1.2_x64_en-US.msi` — intended for managed/enterprise rollout.

Choose one installer channel and continue using it for later upgrades. The
installer embeds the Edge WebView2 offline payload, so a PC without WebView2
does not need internet during installation. The application itself starts and
stores bills locally without internet.

Until the publisher adds an Authenticode certificate, Windows SmartScreen may
show an unknown-publisher warning. Verify `SHA256SUMS-windows.txt` before
installing:

```powershell
Get-FileHash -Algorithm SHA256 ".\Midori Kanjo_0.1.2_x64-setup.exe"
```

## macOS 12 or newer

The Mac artifact contains `Midori Kanjo_0.1.2_universal.dmg`. It includes both
Apple Silicon and Intel code in one application.

1. Open the DMG.
2. Drag **Midori Kanjo** into **Applications**.
3. Start it from Applications.

The current internal build is ad-hoc signed but not Apple-notarized. Gatekeeper
may therefore require Control-clicking the app, choosing **Open**, and
confirming once. A warning-free public download requires the publisher's Apple
Developer ID signing and notarization credentials.

Verify the download before installing:

```bash
shasum -a 256 "Midori Kanjo_0.1.2_universal.dmg"
```

Compare the result with `SHA256SUMS-macos.txt`.

## Desktop behavior

- PDF, CSV and text exports use the operating system's Save dialog.
- Print opens a temporary PDF in the default PDF viewer, where the normal
  Windows or macOS print dialog and printer drivers are available.
- WhatsApp links open in the default browser and never replace the billing
  window.
- A second launch focuses the existing window instead of opening two database
  sessions.
- On macOS, clicking the Dock icon restores the window after it is closed.

## Existing data and upgrades

An upgrade from the older Tauri 0.1.1 package keeps the same application
identifier (`com.sayanfinance.midorikanjo`) and therefore the same local
WebView profile. Do not change that identifier in future releases.

Browser/PWA, Android, legacy Electron and Tauri installations have different
local storage profiles. Installing the desktop app cannot automatically copy a
browser or phone database. To move billing records, first finish cloud sync on
the old device, then configure the same Supabase project and private business
sync code on the desktop app. Drafts, device preferences, owner PIN, shop
settings, daily closes and activity history are currently device-local and must
be configured or retained on the original device. Categories, stock movements
and count sessions/lines sync after the Phase 2 Supabase migration is applied.

The supplied source backup contains code and recovery tools, not live shop
records. Do not uninstall or clear data on an existing device until the desktop
records have been checked.
