import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  resolveMacArtifacts,
  verifyMacArtifacts,
} from "../scripts/verify-macos-universal.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "midori macos bundle-"));
  temporaryDirectories.push(root);
  const appPath = join(root, "macos", "Midori Kanjo.app");
  const executableName = "actual-tauri-executable";
  const binaryPath = join(appPath, "Contents", "MacOS", executableName);
  const dmgPath = join(root, "dmg", "Midori Kanjo_0.1.2_universal.dmg");

  await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(join(root, "dmg"), { recursive: true });
  await writeFile(
    join(appPath, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>${executableName}</string>
</dict></plist>`,
    "utf8",
  );
  await writeFile(binaryPath, "universal-binary-fixture", "utf8");
  await chmod(binaryPath, 0o755);
  await writeFile(dmgPath, "dmg-fixture", "utf8");

  return { root, appPath, binaryPath, dmgPath, executableName };
}

test("macOS verifier resolves app and executable paths containing spaces", async () => {
  const fixture = await createFixture();
  const checksumPath = join(fixture.root, "SHA256SUMS-macos.txt");
  const mountedRoot = join(fixture.root, "mounted volume");
  const mountedAppPath = join(mountedRoot, "Midori Kanjo.app");
  await mkdir(mountedRoot, { recursive: true });
  await cp(fixture.appPath, mountedAppPath, { recursive: true });
  const mountedBinaryPath = join(
    mountedAppPath,
    "Contents",
    "MacOS",
    fixture.executableName,
  );
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === "lipo") return { stdout: "x86_64 arm64\n", stderr: "" };
    if (command === "hdiutil") return { stdout: "verified\n", stderr: "" };
    throw new Error(`Unexpected command: ${command}`);
  };

  const result = await verifyMacArtifacts({
    bundleRoot: fixture.root,
    checksumPath,
    run,
    mount: async () => ({
      mountPath: mountedRoot,
      cleanup: async () => {},
    }),
  });

  assert.equal(result.appPath, fixture.appPath);
  assert.equal(result.binaryPath, fixture.binaryPath);
  assert.equal(result.dmgPath, fixture.dmgPath);
  assert.deepEqual(calls, [
    { command: "lipo", args: ["-archs", fixture.binaryPath] },
    { command: "hdiutil", args: ["verify", fixture.dmgPath] },
    { command: "lipo", args: ["-archs", mountedBinaryPath] },
  ]);
  const expectedHash = createHash("sha256").update("dmg-fixture").digest("hex");
  assert.equal(
    await readFile(checksumPath, "ascii"),
    `${expectedHash}  Midori Kanjo_0.1.2_universal.dmg\n`,
  );
});

test("macOS verifier fails clearly when no retained app bundle exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "midori-macos-bundle-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "macos"), { recursive: true });
  await mkdir(join(root, "dmg"), { recursive: true });
  await writeFile(join(root, "dmg", "Midori Kanjo.dmg"), "dmg", "utf8");

  await assert.rejects(
    resolveMacArtifacts(root),
    /Expected exactly one macOS application bundle.*found 0: none/,
  );
});

test("macOS verifier rejects a non-universal application binary", async () => {
  const fixture = await createFixture();
  const run = async (command) => {
    if (command === "lipo") return { stdout: "arm64\n", stderr: "" };
    throw new Error("hdiutil must not run after architecture failure");
  };

  await assert.rejects(
    verifyMacArtifacts({ bundleRoot: fixture.root, run }),
    /missing x86_64.*lipo reported: arm64/,
  );
});

test("macOS verifier rejects a DMG that ships a different app binary", async () => {
  const fixture = await createFixture();
  const mountedRoot = join(fixture.root, "mounted volume");
  const mountedAppPath = join(mountedRoot, "Midori Kanjo.app");
  await mkdir(mountedRoot, { recursive: true });
  await cp(fixture.appPath, mountedAppPath, { recursive: true });
  await writeFile(
    join(
      mountedAppPath,
      "Contents",
      "MacOS",
      fixture.executableName,
    ),
    "different-shipped-binary",
    "utf8",
  );
  let cleaned = false;
  const run = async (command) => {
    if (command === "lipo") return { stdout: "arm64 x86_64\n", stderr: "" };
    if (command === "hdiutil") return { stdout: "verified\n", stderr: "" };
    throw new Error(`Unexpected command: ${command}`);
  };

  await assert.rejects(
    verifyMacArtifacts({
      bundleRoot: fixture.root,
      run,
      mount: async () => ({
        mountPath: mountedRoot,
        cleanup: async () => { cleaned = true; },
      }),
    }),
    /retained application binary differs from the binary shipped in the DMG/,
  );
  assert.equal(cleaned, true, "mounted DMG cleanup must run after a mismatch");
});
