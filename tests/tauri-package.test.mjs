import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Tauri wraps the existing production SPA with stable desktop identity", async () => {
  const config = JSON.parse(await read("src-tauri/tauri.conf.json"));
  assert.equal(config.productName, "Midori Kanjo");
  assert.equal(config.identifier, "com.sayanfinance.midorikanjo");
  assert.equal(config.build.frontendDist, "../mobile-dist");
  assert.equal(config.build.beforeBuildCommand, "npm run mobile:build");
  assert.equal(config.app.windows[0].width, 1280);
  assert.equal(config.app.windows[0].height, 800);
  assert.equal(config.app.windows[0].resizable, true);
  assert.deepEqual(config.bundle.targets, ["msi", "nsis", "dmg"]);
  assert.equal(config.bundle.macOS.minimumSystemVersion, "12.0");
  assert.ok(config.app.security.csp.includes("https:"));
});

test("desktop icons and window persistence plugin are configured", async () => {
  for (const icon of [
    "src-tauri/icons/32x32.png",
    "src-tauri/icons/128x128.png",
    "src-tauri/icons/128x128@2x.png",
    "src-tauri/icons/icon.ico",
    "src-tauri/icons/icon.icns",
  ]) assert.ok(existsSync(new URL(icon, root)), `${icon} must exist`);
  const rust = await read("src-tauri/src/main.rs");
  const cargo = await read("src-tauri/Cargo.toml");
  assert.match(rust, /tauri_plugin_window_state/);
  assert.match(rust, /cfg\(feature = "desktop-e2e"\)/);
  assert.match(
    cargo,
    /desktop-e2e = \["dep:tauri-plugin-wdio-webdriver"\]/,
  );
  assert.match(
    cargo,
    /tauri-plugin-wdio-webdriver = \{ version = "1", optional = true \}/,
  );
});

test("production frontend is offline-local and excludes the runner harness", async () => {
  const html = await read("mobile-dist/index.html");
  assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.(js|css)/i);
  const assets = await readdir(new URL("mobile-dist/assets/", root));
  const javascript = await Promise.all(
    assets.filter((file) => file.endsWith(".js"))
      .map((file) => read(`mobile-dist/assets/${file}`)),
  );
  const bundle = javascript.join("\n");
  assert.doesNotMatch(bundle, /__MIDORI_DESKTOP_E2E__/);
  assert.doesNotMatch(bundle, /desktop-e2e-records:/);
});

test("GitHub Actions produces both requested installer artifact groups", async () => {
  const workflow = await read(".github/workflows/tauri-desktop.yml");
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /--bundles msi,nsis/);
  assert.match(workflow, /--target universal-apple-darwin --bundles dmg/);
  assert.match(workflow, /midori-kanjo-windows-x64-installers/);
  assert.match(workflow, /midori-kanjo-macos-universal-dmg/);
  assert.match(workflow, /run_native_offline_sync_test/);
  assert.match(workflow, /test:tauri:e2e/);
});
