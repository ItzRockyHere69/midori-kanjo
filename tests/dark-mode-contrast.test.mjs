import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function mix(foreground, background, weight) {
  return foreground.map((value, index) =>
    Math.round(value * weight + background[index] * (1 - weight)),
  );
}

function luminance(color) {
  const linear = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("Items launchers and Inventory notices use paired semantic theme styles", async () => {
  const [app, inventory, qol, css] = await Promise.all([
    read("app/BillingApp.tsx"),
    read("app/InventoryWorkspace.tsx"),
    read("app/QolPanels.tsx"),
    read("app/globals.css"),
  ]);

  assert.equal((app.match(/className="items-workspace-shortcut"/g) || []).length, 2);
  assert.doesNotMatch(app, /bg-\[\#eef7f1\][^"\n]*text-\[\#014921\]/);
  assert.match(inventory, /role="alert" className="inventory-error"/);
  assert.doesNotMatch(inventory, /bg-\[\#fff0ec\][^"\n]*text-\[\#8b3429\]/);
  assert.match(app, /className="bill-preview-estimate mx-auto mt-3 max-w-sm"/);
  assert.doesNotMatch(app, /bg-white\/70[^"\n]*text-\[\#014921\]/);
  assert.match(qol, /className="payment-receipt-balance mt-3"/);
  assert.match(qol, /className="daily-close-saved mx-4 mt-4"/);
  assert.doesNotMatch(qol, /bg-\[\#f2f8f3\][^"\n]*text-\[\#285a3d\]/);

  assert.match(css, /--color-interactive-text:#004e23/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--color-interactive-text:#9be5ad/);
  assert.match(css, /\.items-workspace-shortcut \{[^}]*background:color-mix\([^}]*color:var\(--color-interactive-text\)/s);
  assert.match(css, /\.inventory-error \{[^}]*background:var\(--report-money-out-surface\)[^}]*color:var\(--report-money-out\)/s);
  assert.match(css, /\.inventory-warning \{[^}]*background:var\(--report-money-due-surface\)[^}]*color:var\(--report-money-due\)/s);
  assert.match(css, /\.payment-receipt-balance \{[^}]*background:var\(--report-money-due-surface\)[^}]*color:var\(--report-money-due\)/s);
  assert.match(css, /\.daily-close-saved \{[^}]*background:var\(--report-money-in-surface\)[^}]*color:var\(--report-money-in\)/s);
  assert.match(css, /\.bill-preview-estimate \{[^}]*background:color-mix\([^}]*color:var\(--color-interactive-text\)/s);
  assert.match(css, /item-catalogue-tabs button\[aria-pressed="true"\] strong \{[^}]*background:color-mix\(in srgb,#000 14%,transparent\)/s);

  const lightShortcut = mix(rgb("#24783e"), rgb("#ffffff"), 0.09);
  const darkShortcut = mix(rgb("#71da8a"), rgb("#18211b"), 0.09);
  assert.ok(contrast(rgb("#004e23"), lightShortcut) >= 4.5);
  assert.ok(contrast(rgb("#9be5ad"), darkShortcut) >= 4.5);
  assert.ok(contrast(rgb("#ff9b91"), rgb("#3b2220")) >= 4.5);
  assert.ok(contrast(rgb("#f7c66b"), rgb("#382f1d")) >= 4.5);
  assert.ok(contrast(rgb("#f9f9f9"), mix(rgb("#000000"), rgb("#176b38"), 0.14)) >= 4.5);
});

test("Inventory and every Season Planner foreground avoid the dark fill token", async () => {
  const css = await read("app/globals.css");
  for (const selector of [
    "inventory-back",
    "inventory-action>span",
    "inventory-progress",
    "festival-offline-badge",
    "festival-count-badge",
    "festival-task-row.done>b",
    "festival-plan-card dd",
    "festival-name-details summary",
    "festival-carry",
    "festival-product-select>b",
    "festival-product-field legend",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      css,
      new RegExp(`\\.${escaped} \\{[^}]*color:var\\(--color-interactive-text\\)`, "s"),
      selector,
    );
  }
  assert.match(css, /\[data-stock-state="unknown"\] \{ color:var\(--report-money-due\)/);
  assert.match(css, /data-status="provisional"\][^}]*color:var\(--report-money-due\)/);
  assert.match(css, /data-status="business_estimate"\][^}]*color:var\(--report-mode-bank\)/);
  assert.match(css, /festival-year-spectrum>button\[aria-pressed="true"\][^}]*border-color:var\(--color-focus-ring\)/);
  assert.match(css, /festival-calendar-day\[data-selected="true"\][^}]*var\(--color-focus-ring\)/);
  assert.match(css, /festival-product-select\.selected[^}]*border-color:var\(--color-focus-ring\)/);
  assert.ok(contrast(rgb("#e5eee7"), mix(rgb("#176b38"), rgb("#309d4b"), 0.78)) >= 4.5);
});

let themeModulePromise;
function loadThemeModule() {
  themeModulePromise ||= build({
    entryPoints: [new URL("../lib/theme.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  }).then(({ outputFiles }) =>
    import(
      `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
    ),
  );
  return themeModulePromise;
}

test("saved and system themes are applied before native render and stay synchronized", async () => {
  const theme = await loadThemeModule();
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  entries.set(theme.THEME_CACHE, "dark");
  assert.equal(theme.readInitialTheme(storage, () => false), "dark");
  entries.set(theme.THEME_CACHE, "invalid");
  assert.equal(theme.readInitialTheme(storage, () => true), "dark");
  assert.equal(theme.readInitialTheme({ getItem: () => { throw new Error("denied"); } }, () => false), "light");

  const root = { dataset: {}, style: {} };
  theme.applyTheme("dark", root);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(theme.writeThemeCache("light", storage), true);
  assert.equal(entries.get(theme.THEME_CACHE), "light");

  const [mobile, app, layout] = await Promise.all([
    read("mobile/main.tsx"),
    read("app/BillingApp.tsx"),
    read("app/layout.tsx"),
  ]);
  assert.ok(
    mobile.indexOf("applyTheme(readInitialTheme())") <
      mobile.indexOf("createRoot(root).render"),
  );
  assert.match(app, /applyTheme\(theme\);[\s\S]*writeThemeCache\(theme\)/);
  assert.match(layout, /THEME_CACHE/);
});
