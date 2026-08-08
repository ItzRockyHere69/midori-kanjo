import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile build is a self-contained offline startup bundle", async () => {
  const html = await read("mobile-dist/index.html");
  assert.match(html, /<title>Midori Kanjo<\/title>/);
  assert.match(html, /\.\/assets\//);
  assert.doesNotMatch(html, /https:\/\/burrabazar-billing\./);
  const assets = await readdir(
    new URL("../mobile-dist/assets/", import.meta.url),
  );
  assert.ok(
    assets.some((name) => name.endsWith(".js")),
    "compiled JavaScript is bundled",
  );
  assert.ok(
    assets.some((name) => name.endsWith(".css")),
    "compiled styles are bundled",
  );
});

test("the visible product credit is branded for Sayan Finance", async () => {
  const source = await read("app/BillingApp.tsx");
  assert.match(source, /Made by Sayan Finance/);
});

test("hosted phone install has a complete offline PWA manifest", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Midori Kanjo");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.ok(
    manifest.icons.some(
      (icon) => icon.sizes === "192x192" && icon.type === "image/png",
    ),
  );
  assert.ok(
    manifest.icons.some(
      (icon) => icon.sizes === "512x512" && icon.type === "image/png",
    ),
  );
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /midori-kanjo-v4/);
  assert.match(serviceWorker, /caches\.match\("\/"\)/);
});

test("Android package embeds the mobile build instead of depending on a website", async () => {
  const config = JSON.parse(
    await read("android/app/src/main/assets/capacitor.config.json"),
  );
  assert.equal(config.appId, "com.mantu.billing");
  assert.equal(config.appName, "Midori Kanjo");
  assert.equal(config.webDir, "mobile-dist");
  assert.equal(config.server?.url, undefined);
  const embedded = await read("android/app/src/main/assets/public/index.html");
  assert.match(embedded, /Midori Kanjo/);
  const activity = await read(
    "android/app/src/main/java/com/mantu/billing/MainActivity.java",
  );
  assert.match(activity, /extends\s+BridgeActivity/);
  assert.doesNotMatch(activity, /narraleaf|WebViewClient/);
});

test("Android package includes native sharing, files, browser and back-button support", async () => {
  const plugins = JSON.parse(
    await read("android/app/src/main/assets/capacitor.plugins.json"),
  );
  const classes = plugins.map((plugin) => plugin.classpath);
  assert.ok(classes.some((value) => value.includes("FilesystemPlugin")));
  assert.ok(classes.some((value) => value.includes("SharePlugin")));
  assert.ok(classes.some((value) => value.includes("BrowserPlugin")));
  assert.ok(classes.some((value) => value.includes("AppPlugin")));
});

test("Android manifest requests no broad storage or location permissions", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(
    manifest,
    /MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|ACCESS_FINE_LOCATION/,
  );
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  const icon = new URL(
    "../android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml",
    import.meta.url,
  );
  assert.ok(
    (await stat(icon)).size > 100,
    "custom Midori Kanjo launcher artwork is present",
  );
});

test("cloud backup is isolated by a strong per-business sync code", async () => {
  const schema = await read("supabase/schema.sql");
  const sync = await read("lib/sync.ts");
  assert.doesNotMatch(schema, /using\s*\(true\)/i);
  assert.match(
    schema,
    /business_id\s*=\s*\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'sync_code'\)/,
  );
  assert.match(schema, /length\(business_id\)\s*>=\s*20/);
  assert.match(sync, /syncCode\.length\s*<\s*20/);
  assert.match(
    sync,
    /signInAnonymously\(\{\s*options:\s*\{\s*data:\s*\{\s*sync_code:\s*syncCode/,
  );
});
