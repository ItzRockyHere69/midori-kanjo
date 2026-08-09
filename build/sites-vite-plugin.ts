import { randomUUID } from "node:crypto";
import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function packageSitesMetadata(root: string) {
  const distDirectory = resolve(root, "dist");
  const outputDirectory = resolve(distDirectory, ".openai");
  const stagingDirectory = resolve(
    distDirectory,
    `.openai-stage-${process.pid}-${randomUUID()}`,
  );
  const hostingConfig = resolve(root, ".openai", "hosting.json");
  const drizzleSource = resolve(root, "drizzle");

  await mkdir(stagingDirectory, { recursive: true });
  try {
    if (await exists(hostingConfig)) {
      await cp(hostingConfig, resolve(stagingDirectory, "hosting.json"));
    }
    if (await exists(drizzleSource)) {
      await cp(drizzleSource, resolve(stagingDirectory, "drizzle"), {
        recursive: true,
      });
    }

    // Publish the complete metadata tree in one rename. The verified build
    // removes dist before Vite starts, so readers never observe a half-copied
    // hosting manifest or migration directory.
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, outputDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();
  let packaging: Promise<void> | undefined;

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    closeBundle() {
      // Vinext can invoke closeBundle for more than one Vite environment.
      // Share one promise so those hooks cannot concurrently replace .openai.
      packaging ??= packageSitesMetadata(root);
      return packaging;
    },
  };
}
