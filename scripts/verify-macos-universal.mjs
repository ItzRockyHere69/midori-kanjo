#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function decodeXmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export async function readBundleExecutable(infoPlistPath, run = execFileAsync) {
  const plist = await readFile(infoPlistPath, "utf8");
  const match = plist.match(
    /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>([^<]+)<\/string>/,
  );
  let executable = match ? decodeXmlText(match[1].trim()) : "";
  if (!executable) {
    const result = await run(
      "/usr/bin/plutil",
      ["-extract", "CFBundleExecutable", "raw", "-o", "-", infoPlistPath],
      { encoding: "utf8" },
    ).catch((error) => {
      throw new Error(
        `Cannot read CFBundleExecutable from ${infoPlistPath}: ${error.message}`,
      );
    });
    executable = String(result.stdout ?? "").trim();
  }

  if (!executable || executable.includes("/") || executable.includes("\\")) {
    throw new Error(
      `Invalid CFBundleExecutable in ${infoPlistPath}: ${executable || "(empty)"}`,
    );
  }
  return executable;
}

async function requireSingleEntry(directory, predicate, label) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot inspect ${label} directory ${directory}: ${error.message}`);
  }

  const matches = entries.filter(predicate).map((entry) => entry.name).sort();
  if (matches.length !== 1) {
    const found = matches.length ? matches.join(", ") : "none";
    throw new Error(
      `Expected exactly one ${label} in ${directory}; found ${matches.length}: ${found}`,
    );
  }
  return join(directory, matches[0]);
}

async function resolveAppBundle(appDirectory, run) {
  const appPath = await requireSingleEntry(
    appDirectory,
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
    "macOS application bundle",
  );
  const infoPlistPath = join(appPath, "Contents", "Info.plist");
  const executableName = await readBundleExecutable(infoPlistPath, run);
  const binaryPath = join(appPath, "Contents", "MacOS", executableName);

  const binary = await stat(binaryPath).catch(() => null);
  if (!binary?.isFile()) {
    throw new Error(
      `CFBundleExecutable points to a missing file: ${binaryPath}`,
    );
  }
  await access(binaryPath, constants.X_OK).catch(() => {
    throw new Error(`Application binary is not executable: ${binaryPath}`);
  });

  return { appPath, binaryPath, executableName };
}

export async function resolveMacArtifacts(
  bundleRoot,
  { run = execFileAsync } = {},
) {
  const app = await resolveAppBundle(join(bundleRoot, "macos"), run);
  const dmgPath = await requireSingleEntry(
    join(bundleRoot, "dmg"),
    (entry) => entry.isFile() && entry.name.endsWith(".dmg"),
    "macOS DMG",
  );
  return { ...app, dmgPath };
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

function writeToolOutput(result) {
  if (result.stdout) process.stdout.write(String(result.stdout));
  if (result.stderr) process.stderr.write(String(result.stderr));
}

async function requireUniversalBinary(binaryPath, run) {
  const result = await run("lipo", ["-archs", binaryPath], {
    encoding: "utf8",
  });
  const architectures = new Set(
    String(result.stdout ?? "").trim().split(/\s+/).filter(Boolean),
  );

  for (const required of ["arm64", "x86_64"]) {
    if (!architectures.has(required)) {
      throw new Error(
        `Universal binary ${binaryPath} is missing ${required}; lipo reported: ${
          [...architectures].join(" ") || "no architectures"
        }`,
      );
    }
  }
  return [...architectures];
}

export async function mountDmgReadOnly(dmgPath, run = execFileAsync) {
  const mountPath = await mkdtemp(join(tmpdir(), "midori-kanjo-dmg-"));
  try {
    const result = await run(
      "hdiutil",
      [
        "attach",
        "-readonly",
        "-nobrowse",
        "-noautoopen",
        "-mountpoint",
        mountPath,
        dmgPath,
      ],
      { encoding: "utf8" },
    );
    writeToolOutput(result);
  } catch (error) {
    await rm(mountPath, { recursive: true, force: true });
    throw error;
  }

  let cleaned = false;
  return {
    mountPath,
    async cleanup() {
      if (cleaned) return;
      const result = await run("hdiutil", ["detach", mountPath], {
        encoding: "utf8",
      });
      writeToolOutput(result);
      await rm(mountPath, { recursive: true, force: true });
      cleaned = true;
    },
  };
}

export async function verifyMacArtifacts({
  bundleRoot = resolve(
    "src-tauri/target/universal-apple-darwin/release/bundle",
  ),
  checksumPath = resolve("SHA256SUMS-macos.txt"),
  run = execFileAsync,
  mount = mountDmgReadOnly,
} = {}) {
  const artifacts = await resolveMacArtifacts(bundleRoot, { run });
  const architectures = await requireUniversalBinary(artifacts.binaryPath, run);

  const verifyResult = await run("hdiutil", ["verify", artifacts.dmgPath], {
    encoding: "utf8",
  });
  writeToolOutput(verifyResult);

  const mounted = await mount(artifacts.dmgPath, run);
  let shippedApp;
  let shippedArchitectures;
  try {
    shippedApp = await resolveAppBundle(mounted.mountPath, run);
    shippedArchitectures = await requireUniversalBinary(
      shippedApp.binaryPath,
      run,
    );
    const [retainedBinaryHash, shippedBinaryHash] = await Promise.all([
      sha256File(artifacts.binaryPath),
      sha256File(shippedApp.binaryPath),
    ]);
    if (retainedBinaryHash !== shippedBinaryHash) {
      throw new Error(
        "The retained application binary differs from the binary shipped in the DMG.",
      );
    }
  } finally {
    await mounted.cleanup();
  }

  const checksum = await sha256File(artifacts.dmgPath);
  await writeFile(
    checksumPath,
    `${checksum}  ${basename(artifacts.dmgPath)}\n`,
    "ascii",
  );

  return {
    ...artifacts,
    architectures,
    shippedAppPath: shippedApp.appPath,
    shippedBinaryPath: shippedApp.binaryPath,
    shippedArchitectures,
    checksum,
    checksumPath,
  };
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  verifyMacArtifacts()
    .then((result) => {
      console.log(`Verified universal app: ${result.appPath}`);
      console.log(`Verified application binary: ${result.binaryPath}`);
      console.log(`Verified DMG application: ${result.shippedAppPath}`);
      console.log(`Verified DMG binary: ${result.shippedBinaryPath}`);
      console.log(`Verified DMG: ${result.dmgPath}`);
      console.log(`Wrote checksum: ${result.checksumPath}`);
    })
    .catch((error) => {
      console.error(`macOS artifact verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
