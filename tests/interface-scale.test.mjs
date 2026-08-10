import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

let scaleModulePromise;
function loadScaleModule() {
  scaleModulePromise ||= build({
    entryPoints: [new URL("../lib/interface-scale.ts", import.meta.url).pathname],
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
  return scaleModulePromise;
}

test("interface scale accepts only the supported, safe values", async () => {
  const scale = await loadScaleModule();
  assert.deepEqual(scale.interfaceScaleOptions, [100, 110, 120, 130]);
  for (const value of [100, 110, 120, 130]) {
    assert.equal(scale.parseInterfaceScale(value), value);
    assert.equal(scale.parseInterfaceScale(` ${value} `), value);
  }
  for (const value of [90, 105, 140, NaN, "", "large", "{}", null, undefined]) {
    assert.equal(scale.parseInterfaceScale(value), null);
    assert.equal(scale.normalizeInterfaceScale(value), 100);
  }
});

test("the device cache is resilient and the root attribute is deterministic", async () => {
  const scale = await loadScaleModule();
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  assert.equal(scale.readInterfaceScaleCache(storage), 100);
  assert.equal(scale.writeInterfaceScaleCache(130, storage), true);
  assert.equal(scale.readInterfaceScaleCache(storage), 130);
  entries.set(scale.INTERFACE_SCALE_CACHE, "105");
  assert.equal(scale.readInterfaceScaleCache(storage), 100);
  assert.equal(
    scale.readInterfaceScaleCache({ getItem: () => { throw new Error("denied"); } }),
    100,
  );
  assert.equal(
    scale.writeInterfaceScaleCache(120, { setItem: () => { throw new Error("full"); } }),
    false,
  );

  const root = { dataset: {} };
  scale.applyInterfaceScale(120, root);
  assert.equal(root.dataset.interfaceScale, "120");
});

test("hosted and native apps apply the saved size before visible content", async () => {
  const layout = await read("app/layout.tsx");
  const mobile = await read("mobile/main.tsx");
  assert.match(layout, /midori-interface-scale-v1/);
  assert.match(layout, /dataset\.interfaceScale/);
  assert.match(layout, /scale === "110" \|\| scale === "120" \|\| scale === "130"/);
  assert.ok(
    mobile.indexOf("applyInterfaceScale(readInterfaceScaleCache())") <
      mobile.indexOf("createRoot(root).render"),
  );
});

test("the settings control persists, localizes and scales the complete interface", async () => {
  const source = await read("app/BillingApp.tsx");
  const styles = await read("app/globals.css");
  assert.match(source, /INTERFACE_SCALE_META/);
  assert.match(source, /interfaceScaleOptions\.map/);
  assert.match(source, /aria-pressed=\{interfaceScale === scale\}/);
  assert.match(source, /"इंटरफ़ेस साइज़"/);
  assert.match(source, /"ইন্টারফেসের আকার"/);
  for (const value of [100, 110, 120, 130]) {
    assert.match(
      styles,
      new RegExp(`:root\\[data-interface-scale="${value}"\\] \\{ font-size:${value}%`),
    );
  }
  assert.match(styles, /interface-scale-transitioning/);
  assert.match(styles, /\.interface-scale-indicator[\s\S]*transition:transform/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(source, /text-\[[0-9.]+px\]/);
  assert.doesNotMatch(styles, /font-size:\s*[0-9.]+px/);
  assert.doesNotMatch(styles, /\.cartesia-shell\s*\{[^}]*\b(?:zoom|transform)\s*:/s);
});

test("interface size never changes pinch zoom, PDFs or print dimensions", async () => {
  const mobileHtml = await read("mobile/index.html");
  const styles = await read("app/globals.css");
  assert.doesNotMatch(mobileHtml, /maximum-scale|user-scalable\s*=\s*no/i);
  assert.match(
    styles,
    /@media print[\s\S]*:root\[data-interface-scale\][^{]*\{[^}]*font-size:100%!important/s,
  );
  for (const path of [
    "lib/pdf.ts",
    "lib/payment-receipt.ts",
    "lib/report-export.ts",
    "lib/catalogue-pdf.ts",
    "lib/due-statement-export.ts",
  ]) {
    assert.doesNotMatch(await read(path), /interface[- ]?scale/i, path);
  }
});
