import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

test("Sites metadata packaging is one-shot and atomically replaces its tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "midori-sites-plugin-"));
  await mkdir(join(root, ".openai"), { recursive: true });
  await mkdir(join(root, "drizzle", "meta"), { recursive: true });
  await writeFile(
    join(root, ".openai", "hosting.json"),
    JSON.stringify({ project_id: "test-project" }),
  );
  await writeFile(join(root, "drizzle", "meta", "journal.json"), "first");

  const { sites } = await import(
    `${pathToFileURL(join(repositoryRoot, "build/sites-vite-plugin.ts")).href}?test=${Date.now()}`
  );
  const plugin = sites();
  plugin.configResolved({ root });

  await Promise.all([plugin.closeBundle(), plugin.closeBundle()]);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "dist", ".openai", "hosting.json"))),
    { project_id: "test-project" },
  );
  assert.equal(
    await readFile(
      join(root, "dist", ".openai", "drizzle", "meta", "journal.json"),
      "utf8",
    ),
    "first",
  );

  await writeFile(join(root, "drizzle", "meta", "journal.json"), "second");
  await plugin.closeBundle();
  assert.equal(
    await readFile(
      join(root, "dist", ".openai", "drizzle", "meta", "journal.json"),
      "utf8",
    ),
    "first",
    "later environment hooks reuse the original packaging promise",
  );
  assert.deepEqual(
    (await readdir(join(root, "dist"))).filter((name) =>
      name.startsWith(".openai-stage-"),
    ),
    [],
  );
});

test("verified hosted builds serialize and remove stale output", async (t) => {
  if (process.platform !== "linux") {
    t.skip("the hosted Sites build runner is Linux-only");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "midori-sites-lock-"));
  const bin = join(root, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  await mkdir(join(root, "dist", "client"), { recursive: true });
  await writeFile(join(root, "dist", "client", "stale.js"), "orphan");
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(root, "hosting-source.json"),
    JSON.stringify({ project_id: "concurrency-test" }),
  );

  const fakeVinext = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'project="${SITES_PROJECT_ROOT:?}"',
    'if ! mkdir "${project}/.fake-build-active" 2>/dev/null; then',
    '  echo "overlapping build detected" >&2',
    "  exit 91",
    "fi",
    "cleanup() { rmdir \"${project}/.fake-build-active\"; }",
    "trap cleanup EXIT INT TERM",
    'printf "start\\n" >> "${project}/build-order.log"',
    "sleep 0.25",
    'mkdir -p "${project}/dist/server" "${project}/dist/.openai"',
    'printf "%s\\n" "export default { fetch() { return new Response(\"ok\"); } };" > "${project}/dist/server/index.js"',
    'cp "${project}/hosting-source.json" "${project}/dist/.openai/hosting.json"',
    'printf "end\\n" >> "${project}/build-order.log"',
  ].join("\n");
  await writeFile(join(bin, "vinext"), `${fakeVinext}\n`, { mode: 0o755 });

  const environment = {
    ...process.env,
    SITES_ENV_READY: "1",
    SITES_PROJECT_ROOT: root,
    SITES_BUILD_LOCK_TIMEOUT_SECONDS: "10",
    SITES_BUILD_TIMEOUT: "30s",
  };
  const script = join(repositoryRoot, "scripts", "build-verified.sh");
  const results = await Promise.all([
    run("bash", [script], { env: environment }),
    run("bash", [script], { env: environment }),
  ]);

  for (const result of results) {
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Validated Sites artifact/);
  }
  assert.deepEqual(
    (await readFile(join(root, "build-order.log"), "utf8")).trim().split("\n"),
    ["start", "end", "start", "end"],
  );
  await assert.rejects(readFile(join(root, "dist", "client", "stale.js")));
});

test("service worker precaches rendered assets and awaits runtime cache writes", async () => {
  const source = await readFile(join(repositoryRoot, "public", "sw.js"), "utf8");
  const origin = "https://midori.example";
  const handlers = new Map();
  const stored = new Map();
  const deletedCaches = [];
  let clientsClaimed = false;
  let releaseLazyPut;
  let gateLazyPut = false;

  const keyOf = (input) =>
    new URL(typeof input === "string" ? input : input.url, origin).href;
  const cache = {
    async put(key, response) {
      const normalized = keyOf(key);
      if (gateLazyPut && normalized.endsWith("/assets/lazy.js")) {
        await new Promise((resolvePut) => {
          releaseLazyPut = resolvePut;
        });
      }
      stored.set(normalized, response.clone());
    },
  };
  const caches = {
    async open() {
      return cache;
    },
    async match(key) {
      return stored.get(keyOf(key))?.clone();
    },
    async keys() {
      return ["midori-kanjo-v4", "midori-kanjo-v5", "midori-kanjo-v6"];
    },
    async delete(key) {
      deletedCaches.push(key);
      return true;
    },
  };
  const bodies = new Map([
    [
      `${origin}/`,
      '<!doctype html><script src="/assets/app-abc.js"></script><link rel="stylesheet" href="/assets/app-def.css">',
    ],
    [`${origin}/manifest.webmanifest`, "{}"],
    [`${origin}/app-icon.svg`, "<svg></svg>"],
    [`${origin}/app-icon-192.png`, "192"],
    [`${origin}/app-icon-512.png`, "512"],
    [`${origin}/assets/app-abc.js`, "export {}"],
    [`${origin}/assets/app-def.css`, "body{}"],
    [`${origin}/assets/lazy.js`, "export const lazy = true"],
  ]);
  const fetch = async (input) => {
    const url = keyOf(input);
    if (!bodies.has(url)) return new Response("missing", { status: 404 });
    return new Response(bodies.get(url), { status: 200 });
  };
  const self = {
    location: { origin },
    clients: {
      claim: async () => {
        clientsClaimed = true;
      },
    },
    skipWaiting: async () => undefined,
    addEventListener(name, handler) {
      handlers.set(name, handler);
    },
  };

  vm.runInNewContext(source, {
    caches,
    fetch,
    Request,
    Response,
    Set,
    URL,
    self,
  });

  let installWork;
  handlers.get("install")({
    waitUntil(work) {
      installWork = work;
    },
  });
  await installWork;
  let activateWork;
  handlers.get("activate")({
    waitUntil(work) {
      activateWork = work;
    },
  });
  await activateWork;
  assert.deepEqual(deletedCaches, ["midori-kanjo-v4", "midori-kanjo-v5"]);
  assert.equal(clientsClaimed, true);
  for (const expected of [
    "/",
    "/manifest.webmanifest",
    "/app-icon.svg",
    "/app-icon-192.png",
    "/app-icon-512.png",
    "/assets/app-abc.js",
    "/assets/app-def.css",
  ]) {
    assert.ok(stored.has(`${origin}${expected}`), `${expected} was precached`);
  }

  gateLazyPut = true;
  let responseWork;
  handlers.get("fetch")({
    request: new Request(`${origin}/assets/lazy.js`),
    respondWith(work) {
      responseWork = work;
    },
  });
  let settled = false;
  responseWork.finally(() => {
    settled = true;
  });
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(settled, false, "response remains pending until cache.put finishes");
  releaseLazyPut();
  assert.equal((await responseWork).status, 200);
  assert.ok(stored.has(`${origin}/assets/lazy.js`));
});

test("Mocha parallel workers work with the patched serializer override", async () => {
  const root = await mkdtemp(join(tmpdir(), "midori-mocha-serializer-"));
  const fixture = join(root, "parallel.cjs");
  await writeFile(
    fixture,
    'const assert = require("node:assert/strict"); describe("parallel", () => { it("serializes", () => assert.equal(2 + 2, 4)); });\n',
  );
  const mocha = require.resolve("mocha/bin/mocha.js");
  const result = await run(process.execPath, [mocha, "--parallel", fixture]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 passing/);
});
