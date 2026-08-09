import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearGeneratedAndroidWebAssets,
  createMobileBuildLock,
} from "../scripts/mobile-build-verified.mjs";

const withTemporaryLockDirectory = async (run) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "midori-mobile-lock-"));
  const directory = join(temporaryRoot, ".mobile-build-lock");
  try {
    await run(directory);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const quickLock = (directory, overrides = {}) =>
  createMobileBuildLock({
    directory,
    acquireTimeoutMs: 90,
    pollIntervalMs: 5,
    leaseDurationMs: 75,
    heartbeatIntervalMs: 10,
    ...overrides,
  });

test("a fresh heartbeat protects an active owner hidden by a PID namespace", async () => {
  await withTemporaryLockDirectory(async (directory) => {
    const owner = quickLock(directory, {
      // This PID is intentionally not visible/alive in the test namespace.
      pid: 2_000_000_000,
    });
    const contender = quickLock(directory);
    await owner.acquire();

    await assert.rejects(
      contender.acquire(),
      /Timed out waiting for another mobile build to finish/,
    );
    owner.assertOwned();
    await owner.release();
  });
});

test("a stale lease is reclaimed even when its PID has been reused", async () => {
  await withTemporaryLockDirectory(async (directory) => {
    const staleToken = randomUUID();
    const staleHeartbeatAt = Date.now() - 60_000;
    await mkdir(directory);
    await writeFile(
      join(directory, "owner.json"),
      JSON.stringify({
        version: 2,
        pid: process.pid,
        token: staleToken,
        startedAt: staleHeartbeatAt,
      }),
    );
    await writeFile(
      join(directory, `lease-${staleToken}.json`),
      JSON.stringify({
        token: staleToken,
        sequence: 4,
        heartbeatAt: staleHeartbeatAt,
      }),
    );

    const replacement = quickLock(directory, { acquireTimeoutMs: 200 });
    const startedAt = Date.now();
    await replacement.acquire();
    assert.ok(Date.now() - startedAt < 150, "stale lock is reclaimed promptly");
    const owner = JSON.parse(await readFile(join(directory, "owner.json")));
    assert.notEqual(owner.token, staleToken);
    assert.equal(owner.pid, process.pid);
    await replacement.release();
  });
});

test("lock cleanup is restricted to an exact dedicated lock directory", () => {
  assert.throws(
    () => createMobileBuildLock({ directory: tmpdir() }),
    /unexpected mobile build lock path/,
  );
  assert.throws(
    () => createMobileBuildLock({ directory: "./.mobile-build-lock" }),
    /unexpected mobile build lock path/,
  );
});

test("Android cleanup removes stale web output but preserves Capacitor metadata", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "midori-android-assets-"));
  const webAssetsDirectory = join(
    temporaryRoot,
    "android/app/src/main/assets/public",
  );
  const capacitorConfig = join(
    temporaryRoot,
    "android/app/src/main/assets/capacitor.config.json",
  );
  const capacitorPlugins = join(
    temporaryRoot,
    "android/app/src/main/assets/capacitor.plugins.json",
  );
  const nativeSentinel = join(
    temporaryRoot,
    "android/app/src/main/res/raw/keep.txt",
  );
  try {
    await mkdir(join(webAssetsDirectory, "assets"), { recursive: true });
    await mkdir(join(temporaryRoot, "android/app/src/main/res/raw"), {
      recursive: true,
    });
    await writeFile(join(webAssetsDirectory, "assets/old-hash.js"), "stale");
    await writeFile(capacitorConfig, "config");
    await writeFile(capacitorPlugins, "plugins");
    await writeFile(nativeSentinel, "native");

    await clearGeneratedAndroidWebAssets({
      projectDirectory: temporaryRoot,
      webAssetsDirectory,
    });

    await assert.rejects(readFile(webAssetsDirectory), { code: "ENOENT" });
    assert.equal(await readFile(capacitorConfig, "utf8"), "config");
    assert.equal(await readFile(capacitorPlugins, "utf8"), "plugins");
    assert.equal(await readFile(nativeSentinel, "utf8"), "native");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Android cleanup refuses broader or unrelated directories", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "midori-android-safety-"));
  const broadDirectory = join(temporaryRoot, "android/app/src/main/assets");
  const sentinel = join(broadDirectory, "capacitor.config.json");
  try {
    await mkdir(broadDirectory, { recursive: true });
    await writeFile(sentinel, "keep");

    await assert.rejects(
      clearGeneratedAndroidWebAssets({
        projectDirectory: temporaryRoot,
        webAssetsDirectory: broadDirectory,
      }),
      /unexpected Android web-assets directory/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("an unchanged active token can hand the lock to the next build", async () => {
  await withTemporaryLockDirectory(async (directory) => {
    const first = quickLock(directory);
    const second = quickLock(directory, { acquireTimeoutMs: 250 });
    await first.acquire();
    const waiting = second.acquire();
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    first.assertOwned();
    await first.release();
    await waiting;
    second.assertOwned();
    await second.release();
  });
});
