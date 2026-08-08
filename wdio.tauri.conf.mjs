import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const defaultBinary = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "midori-kanjo.exe" : "midori-kanjo",
);
const appBinaryPath = process.env.MIDORI_TAURI_BINARY || defaultBinary;

export const config = {
  runner: "local",
  specs: ["./desktop-e2e/specs/offline-sync.e2e.mjs"],
  maxInstances: 1,
  logLevel: "info",
  bail: 1,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 240_000,
  },
  services: [["@wdio/tauri-service", {
    appBinaryPath,
    driverProvider: "embedded",
    startTimeout: 120_000,
    statusPollTimeout: 10_000,
    captureBackendLogs: false,
    captureFrontendLogs: false,
  }]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: appBinaryPath,
    },
    "wdio:tauriServiceOptions": {
      driverProvider: "embedded",
    },
  }],
};
