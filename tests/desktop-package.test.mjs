import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("desktop shell is branded, offline and hardened", async () => {
  const source = await read("desktop/main.cjs");
  assert.match(source, /const APP_NAME = "Midori Kanjo"/);
  assert.match(source, /const DATA_DIRECTORY_NAME = "Mantu Billing Software"/);
  assert.match(source, /mantu:\/\/app/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setPermissionRequestHandler/);
  assert.match(source, /will-attach-webview/);
  assert.doesNotMatch(source, /Frameboard|HisaabDesk/);

  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("desktop/main.cjs", root)), "--self-test"],
    {
      encoding: "utf8",
      cwd: fileURLToPath(new URL(".", root)),
      env: {
        ...process.env,
        MANTU_STATIC_ROOT: fileURLToPath(new URL("mobile-dist", root)),
      },
    },
  ).trim();
  const result = JSON.parse(output.split("\n").at(-1));
  assert.deepEqual(result, {
    status: "ok",
    appName: "Midori Kanjo",
    origin: "mantu://app",
    requiredFiles: 3,
  });
});
