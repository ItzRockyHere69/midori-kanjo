import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = join(projectRoot, "mobile-dist");
const androidOutputDirectory = join(
  projectRoot,
  "android/app/src/main/assets/public",
);
const lockDirectory = join(projectRoot, ".mobile-build-lock");
const syncAndroid = process.argv.includes("--sync");
let activeChild;

if (
  dirname(outputDirectory) !== projectRoot ||
  basename(outputDirectory) !== "mobile-dist"
) {
  throw new Error("Refusing to clean an unexpected mobile output directory.");
}

const wait = (milliseconds) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export async function clearGeneratedAndroidWebAssets({
  projectDirectory = projectRoot,
  webAssetsDirectory = androidOutputDirectory,
} = {}) {
  const resolvedProjectDirectory = resolve(projectDirectory);
  const resolvedWebAssetsDirectory = resolve(webAssetsDirectory);
  const expectedWebAssetsDirectory = join(
    resolvedProjectDirectory,
    "android/app/src/main/assets/public",
  );
  if (
    !isAbsolute(projectDirectory) ||
    !isAbsolute(webAssetsDirectory) ||
    dirname(resolvedProjectDirectory) === resolvedProjectDirectory ||
    resolvedWebAssetsDirectory !== expectedWebAssetsDirectory
  )
    throw new Error(
      "Refusing to clean an unexpected Android web-assets directory.",
    );

  // Capacitor's config and plugin manifests are siblings of `public`, so this
  // removes only generated web output and leaves native project metadata intact.
  await rm(resolvedWebAssetsDirectory, { recursive: true, force: true });
}

const LOCK_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validToken(value) {
  return typeof value === "string" && LOCK_TOKEN_PATTERN.test(value);
}

/**
 * Create an inter-process build lock backed by a renewable filesystem lease.
 *
 * PID liveness is deliberately not consulted: a PID can refer to an unrelated
 * process after reuse, and processes in another PID namespace can be invisible
 * even while they are actively building. A fresh token-specific heartbeat is
 * the portable proof that the owner is still active.
 */
export function createMobileBuildLock({
  directory,
  acquireTimeoutMs = 5 * 60_000,
  pollIntervalMs = 100,
  leaseDurationMs = 15_000,
  heartbeatIntervalMs = 1_000,
  token = randomUUID(),
  pid = process.pid,
  onLost,
} = {}) {
  if (!directory) throw new Error("A mobile build lock directory is required.");
  if (
    !isAbsolute(directory) ||
    basename(directory) !== ".mobile-build-lock" ||
    dirname(directory) === directory
  )
    throw new Error("Refusing to use an unexpected mobile build lock path.");
  if (!validToken(token)) throw new Error("Invalid mobile build lock token.");
  if (
    !Number.isFinite(leaseDurationMs) ||
    leaseDurationMs <= 0 ||
    !Number.isFinite(heartbeatIntervalMs) ||
    heartbeatIntervalMs <= 0 ||
    heartbeatIntervalMs * 3 >= leaseDurationMs
  )
    throw new Error(
      "The mobile build lock heartbeat must be less than one third of its lease.",
    );

  const ownerFile = join(directory, "owner.json");
  const leaseFileName = (ownerToken) => `lease-${ownerToken}.json`;
  const ownLeaseFile = join(directory, leaseFileName(token));
  const ownLeaseTemporaryFile = `${ownLeaseFile}.tmp`;
  let ownsLock = false;
  let heartbeatTimer;
  let heartbeatSequence = 0;
  let heartbeatWork = Promise.resolve();
  let lockFailure;

  const markLost = (cause) => {
    if (lockFailure) return;
    lockFailure =
      cause instanceof Error
        ? cause
        : new Error("The mobile build lock lease was lost.");
    ownsLock = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      onLost?.(lockFailure);
    } catch {}
  };

  const readJson = async (path) => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return;
      throw error;
    }
  };

  const readSnapshot = async (snapshotDirectory = directory) => {
    const snapshotOwnerFile = join(snapshotDirectory, "owner.json");
    let directoryStat;
    try {
      directoryStat = await stat(snapshotDirectory);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    const owner = await readJson(snapshotOwnerFile);
    const ownerToken = validToken(owner?.token) ? owner.token : undefined;
    if (!ownerToken)
      return {
        identity: `orphan:${directoryStat.mtimeMs}`,
        lastHeartbeatMs: directoryStat.mtimeMs,
      };

    const leasePath = join(snapshotDirectory, leaseFileName(ownerToken));
    const lease = await readJson(leasePath);
    let leaseStat;
    try {
      leaseStat = await stat(leasePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const heartbeatAt = Number.isFinite(lease?.heartbeatAt)
      ? lease.heartbeatAt
      : undefined;
    const heartbeatIsPlausible =
      heartbeatAt !== undefined && heartbeatAt <= Date.now() + leaseDurationMs;
    const lastHeartbeatMs =
      lease?.token === ownerToken && heartbeatIsPlausible
        ? heartbeatAt
        : Math.max(directoryStat.mtimeMs, leaseStat?.mtimeMs ?? 0);
    return {
      identity: `${ownerToken}:${lease?.sequence ?? "missing"}:${heartbeatAt ?? "missing"}`,
      lastHeartbeatMs,
    };
  };

  const snapshotIsStale = (snapshot) =>
    Boolean(snapshot) && Date.now() - snapshot.lastHeartbeatMs > leaseDurationMs;

  const refreshHeartbeat = async () => {
    if (!ownsLock) return;
    const ownerBefore = await readJson(ownerFile);
    if (ownerBefore?.token !== token)
      throw new Error("The mobile build lock is now owned by another process.");
    heartbeatSequence += 1;
    await writeFile(
      ownLeaseTemporaryFile,
      JSON.stringify({
        token,
        sequence: heartbeatSequence,
        heartbeatAt: Date.now(),
      }),
    );
    await rename(ownLeaseTemporaryFile, ownLeaseFile);
    const ownerAfter = await readJson(ownerFile);
    if (ownerAfter?.token !== token)
      throw new Error("The mobile build lock changed during its heartbeat.");
  };

  const queueHeartbeat = () => {
    heartbeatWork = heartbeatWork.then(refreshHeartbeat).catch(markLost);
  };

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(queueHeartbeat, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  };

  const acquire = async () => {
    const deadline = Date.now() + acquireTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await mkdir(directory);
        try {
          const startedAt = Date.now();
          await writeFile(
            ownerFile,
            JSON.stringify({
              version: 2,
              pid,
              token,
              startedAt,
            }),
          );
          ownsLock = true;
          await refreshHeartbeat();
          startHeartbeat();
          return;
        } catch (error) {
          ownsLock = false;
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const firstSnapshot = await readSnapshot();
        if (snapshotIsStale(firstSnapshot)) {
          // Require an unchanged stale observation across multiple expected
          // heartbeats before fencing the owner. This prevents an in-flight
          // atomic heartbeat from being mistaken for abandonment.
          await wait(
            Math.min(Math.max(heartbeatIntervalMs * 2, 10), 1_000),
          );
          const secondSnapshot = await readSnapshot();
          if (
            firstSnapshot?.identity === secondSnapshot?.identity &&
            snapshotIsStale(secondSnapshot)
          ) {
            const staleDirectory = `${directory}.stale-${token}`;
            try {
              await rename(directory, staleDirectory);
              const movedSnapshot = await readSnapshot(staleDirectory);
              if (
                movedSnapshot?.identity !== secondSnapshot.identity ||
                !snapshotIsStale(movedSnapshot)
              ) {
                try {
                  await rename(staleDirectory, directory);
                } catch (restoreError) {
                  if (restoreError?.code !== "EEXIST") throw restoreError;
                }
                throw new Error(
                  "The mobile build lock changed while stale ownership was being reclaimed.",
                );
              }
              await rm(staleDirectory, { recursive: true, force: true });
              continue;
            } catch (reclaimError) {
              if (reclaimError?.code !== "ENOENT") throw reclaimError;
              continue;
            }
          }
        }
        await wait(pollIntervalMs);
      }
    }
    throw new Error("Timed out waiting for another mobile build to finish.");
  };

  const assertOwned = () => {
    if (lockFailure) throw lockFailure;
    if (!ownsLock)
      throw new Error("The current process does not own the mobile build lock.");
  };

  const release = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await heartbeatWork;
    if (lockFailure) throw lockFailure;
    if (!ownsLock) return;
    try {
      const owner = await readJson(ownerFile);
      if (owner?.token !== token)
        throw new Error(
          "Refusing to release a mobile build lock owned by another process.",
        );
      const releasedDirectory = `${directory}.released-${token}`;
      await rename(directory, releasedDirectory);
      const movedOwner = await readJson(join(releasedDirectory, "owner.json"));
      if (movedOwner?.token !== token) {
        try {
          await rename(releasedDirectory, directory);
        } catch (restoreError) {
          if (restoreError?.code !== "EEXIST") throw restoreError;
        }
        throw new Error(
          "Refusing to delete a mobile build lock that changed during release.",
        );
      }
      await rm(releasedDirectory, { recursive: true, force: true });
      try {
        await stat(releasedDirectory);
        throw new Error("Mobile build lock remained after release.");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } finally {
      ownsLock = false;
    }
  };

  return { acquire, assertOwned, release };
}

const buildLock = createMobileBuildLock({
  directory: lockDirectory,
  onLost: () => activeChild?.kill("SIGTERM"),
});

function runNode(script, argumentsList = []) {
  return new Promise((resolveRun, rejectRun) => {
    buildLock.assertOwned();
    const child = spawn(process.execPath, [script, ...argumentsList], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    activeChild = child;
    child.once("error", (error) => {
      activeChild = undefined;
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      try {
        buildLock.assertOwned();
      } catch (error) {
        rejectRun(error);
        return;
      }
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${basename(script)} failed${signal ? ` with ${signal}` : ` with exit ${code}`}.`,
          ),
        );
    });
  });
}

async function main() {
  await buildLock.acquire();
  try {
    if (syncAndroid)
      await runNode(join(projectRoot, "scripts/generate-android-assets.mjs"));

    // Vite/Rolldown has retained prior hashed generations in some builds even
    // with emptyOutDir enabled. Clean only the validated project output while
    // holding the inter-process lock, then keep Capacitor's copy in that lock.
    buildLock.assertOwned();
    await rm(outputDirectory, { recursive: true, force: true });
    await runNode(join(projectRoot, "node_modules/vite/bin/vite.js"), [
      "build",
      "--config",
      "vite.mobile.config.ts",
    ]);

    if (syncAndroid) {
      buildLock.assertOwned();
      await clearGeneratedAndroidWebAssets();
      await runNode(
        join(projectRoot, "node_modules/@capacitor/cli/bin/capacitor"),
        ["sync", "android"],
      );
    }
  } finally {
    await buildLock.release();
  }
}

const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();
