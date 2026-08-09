import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

test("desktop E2E secrets are available only to explicitly gated E2E steps", async () => {
  const workflow = await read(".github/workflows/tauri-desktop.yml");
  const jobEnv = workflow.match(/\n    env:\n([\s\S]*?)\n    steps:/)?.[1] ?? "";
  assert.doesNotMatch(jobEnv, /secrets\.MIDORI_E2E_/);

  const secretSteps = [
    "Validate native sync-test secrets",
    "Test offline create, restart, reconnect and idempotent sync",
  ];
  for (const name of secretSteps) {
    const step = workflowStep(workflow, name);
    assert.match(step, /if: \$\{\{ inputs\.run_native_offline_sync_test \}\}/);
    assert.match(step, /MIDORI_E2E_SUPABASE_URL: \$\{\{ secrets\.MIDORI_E2E_SUPABASE_URL \}\}/);
    assert.match(step, /MIDORI_E2E_SUPABASE_ANON_KEY: \$\{\{ secrets\.MIDORI_E2E_SUPABASE_ANON_KEY \}\}/);
    assert.match(step, /MIDORI_E2E_SYNC_CODE: \$\{\{ secrets\.MIDORI_E2E_SYNC_CODE \}\}/);
  }

  const buildStep = workflowStep(workflow, "Build native runner test binary");
  assert.match(buildStep, /if: \$\{\{ inputs\.run_native_offline_sync_test \}\}/);
  assert.doesNotMatch(buildStep, /secrets\.MIDORI_E2E_/);

  const withoutSecretSteps = secretSteps.reduce(
    (text, name) => text.replace(workflowStep(workflow, name), ""),
    workflow,
  );
  assert.doesNotMatch(withoutSecretSteps, /secrets\.MIDORI_E2E_/);
});

test("desktop CI enforces clean mobile packaging before native release", async () => {
  const workflow = await read(".github/workflows/tauri-desktop.yml");
  const step = workflowStep(workflow, "Test clean mobile and Android packaging");
  assert.match(step, /run: npm run test:mobile/);
});

test("desktop workflow executes immutable reviewed action revisions", async () => {
  const workflow = await read(".github/workflows/tauri-desktop.yml");
  const actionRefs = [...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)/gm)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(actionRefs, [
    ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
    ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
    ["dtolnay/rust-toolchain", "e97e2d8cc328f1b50210efc529dca0028893a2d9"],
    ["Swatinem/rust-cache", "6323deb102c322ba6fcbdcafc7e3dddab59af2b6"],
    ["tauri-apps/tauri-action", "1deb371b0cd8bd54025b384f1cd735e725c4060f"],
    ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ]);
  for (const [, revision] of actionRefs) {
    assert.match(revision, /^[a-f0-9]{40}$/, `${revision} must be a full commit SHA`);
  }
  assert.match(workflow, /dtolnay\/rust-toolchain@[a-f0-9]{40} # v1[\s\S]*toolchain: stable/);
});

test("production Tauri builds omit the optional WebDriver dependency and permission", async () => {
  const [cargo, main, capability] = await Promise.all([
    read("src-tauri/Cargo.toml"),
    read("src-tauri/src/main.rs"),
    read("src-tauri/capabilities/default.json"),
  ]);
  assert.match(cargo, /desktop-e2e = \["dep:tauri-plugin-wdio-webdriver"\]/);
  assert.match(cargo, /tauri-plugin-wdio-webdriver = \{ version = "1", optional = true \}/);
  assert.match(main, /#\[cfg\(feature = "desktop-e2e"\)\][\s\S]*tauri_plugin_wdio_webdriver::init\(\)/);
  assert.match(main, /DESKTOP_E2E_CAPABILITY[\s\S]*wdio-webdriver:default[\s\S]*add_capability\(DESKTOP_E2E_CAPABILITY\)/);
  assert.doesNotMatch(JSON.stringify(JSON.parse(capability)), /wdio-webdriver/);
});

test("Android shares only files from the dedicated export cache directory", async () => {
  const paths = await read("android/app/src/main/res/xml/file_paths.xml");
  assert.match(paths, /<cache-path name="midori_kanjo_exports" path="midori-kanjo-exports\/" \/>/);
  const pathElements = [...paths.matchAll(/<([a-z-]*path)\b/g)].map((match) => match[1]);
  assert.deepEqual(pathElements, ["cache-path"]);
});

test("Android API, build tools and WebView floor form a supported contract", async () => {
  const [variables, mobileConfig, rootBuild, wrapper, capacitor] = await Promise.all([
    read("android/variables.gradle"),
    read("vite.mobile.config.ts"),
    read("android/build.gradle"),
    read("android/gradle/wrapper/gradle-wrapper.properties"),
    read("capacitor.config.ts"),
  ]);
  assert.match(variables, /compileSdkVersion = 35/);
  assert.match(variables, /targetSdkVersion = 35/);
  assert.match(rootBuild, /com\.android\.tools\.build:gradle:8\.6\.1/);
  assert.match(wrapper, /gradle-8\.7-bin\.zip/);
  assert.match(mobileConfig, /target: "es2017"/);
  assert.match(capacitor, /minWebViewVersion: 92/);
});

test("Android Gradle commands select the native wrapper on Windows and Unix", async () => {
  const [scripts, runner] = await Promise.all([
    read("package.json"),
    read("scripts/run-android-gradle.mjs"),
  ]);
  const parsed = JSON.parse(scripts);
  assert.match(parsed.scripts["mobile:android:debug"], /run-android-gradle\.mjs assembleDebug/);
  assert.match(parsed.scripts["mobile:android:bundle"], /run-android-gradle\.mjs bundleRelease/);
  assert.match(runner, /process\.platform === "win32" \? "gradlew\.bat" : "\.\/gradlew"/);
});

test("all packaged applications advertise the same release version", async () => {
  const [web, desktop, tauri, cargo, android] = await Promise.all([
    read("package.json"),
    read("desktop/package.json"),
    read("src-tauri/tauri.conf.json"),
    read("src-tauri/Cargo.toml"),
    read("android/app/build.gradle"),
  ]);
  const version = JSON.parse(web).version;
  assert.equal(JSON.parse(desktop).version, version);
  assert.equal(JSON.parse(tauri).version, version);
  assert.match(cargo, new RegExp(`^version = "${version.replaceAll(".", "\\.")}"$`, "m"));
  assert.match(android, new RegExp(`versionName "${version.replaceAll(".", "\\.")}"`));
});

test("native cache pruning is bounded and runs before writing the share target", async () => {
  const source = await read("lib/native-files.ts");
  assert.match(source, /MAX_NATIVE_EXPORT_FILES = 12/);
  assert.match(source, /MAX_NATIVE_EXPORT_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /Promise\.allSettled\([\s\S]*filesystem\.deleteFile/);
  const prune = source.indexOf("await pruneNativeExportCache(Filesystem, Directory.Cache)");
  const write = source.indexOf("await Filesystem.writeFile", prune);
  const share = source.indexOf("await Share.share", write);
  assert.ok(prune >= 0 && write > prune && share > write, "cleanup must precede write and native share");
  assert.equal(source.indexOf("pruneNativeExportCache", write), -1, "current share must not be pruned after writing");
});

test("hosted and native shells enforce framing and content security policies", async () => {
  const [headers, mobileHtml, electron, tauri, worker] = await Promise.all([
    read("public/_headers"),
    read("mobile/index.html"),
    read("desktop/main.cjs"),
    read("src-tauri/tauri.conf.json"),
    read("worker/index.ts"),
  ]);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Permissions-Policy:/);
  assert.match(mobileHtml, /http-equiv="Content-Security-Policy"/);
  assert.match(electron, /"Content-Security-Policy"/);
  const tauriCsp = JSON.parse(tauri).app.security.csp;
  assert.match(tauriCsp, /object-src 'self' blob:/);
  for (const [source, csp] of [
    ["hosted static headers", headers],
    ["mobile shell", mobileHtml],
    ["Electron shell", electron],
    ["Tauri shell", tauriCsp],
  ]) {
    assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/, `${source} must allow embedded WebAssembly`);
    assert.doesNotMatch(csp, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/, `${source} must not enable JavaScript eval`);
  }
  assert.equal(
    (worker.match(/withSecurityHeaders\(/g) || []).length,
    2,
    "image and SSR responses must use the security wrapper",
  );

  const { withSecurityHeaders } = await import(
    new URL("../worker/security-headers.ts", import.meta.url)
  );
  const secured = withSecurityHeaders(
    new Response("ok", {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
    }),
  );
  assert.equal(secured.headers.get("Cache-Control"), "no-cache");
  const workerCsp = secured.headers.get("Content-Security-Policy") || "";
  assert.match(workerCsp, /frame-ancestors 'none'/);
  assert.match(workerCsp, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.doesNotMatch(workerCsp, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  assert.equal(secured.headers.get("X-Frame-Options"), "DENY");
  assert.equal(secured.headers.get("X-Content-Type-Options"), "nosniff");
});
