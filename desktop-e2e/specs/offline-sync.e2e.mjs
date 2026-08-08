import assert from "node:assert/strict";
import { browser } from "@wdio/globals";

const runKey = process.env.MIDORI_E2E_RUN_KEY;
const cloudConfig = {
  url: process.env.MIDORI_E2E_SUPABASE_URL,
  key: process.env.MIDORI_E2E_SUPABASE_ANON_KEY,
  syncCode: process.env.MIDORI_E2E_SYNC_CODE,
};

async function waitForHarness() {
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(window.__MIDORI_DESKTOP_E2E__)),
    { timeout: 30_000, timeoutMsg: "The native desktop test harness did not load." },
  );
}

async function callHarness(method, ...args) {
  return browser.execute(
    async (methodName, methodArgs) => {
      const harness = window.__MIDORI_DESKTOP_E2E__;
      if (!harness) throw new Error("The desktop test harness is unavailable.");
      const callable = harness[methodName];
      if (typeof callable !== "function") throw new Error(`Unknown harness method ${methodName}.`);
      return callable(...methodArgs);
    },
    method,
    args,
  );
}

describe("Midori Kanjo native offline-first round trip", () => {
  let cloudWasConfigured = false;
  let cleanupCompleted = false;

  before(async () => {
    assert.ok(runKey, "MIDORI_E2E_RUN_KEY is required.");
    await waitForHarness();
  });

  after(async () => {
    if (!cloudWasConfigured || cleanupCompleted) return;
    try {
      await waitForHarness();
      await callHarness("cleanupRemote", runKey);
    } catch (error) {
      console.warn("Best-effort test-data cleanup failed after the main test.", error);
    }
  });

  it("creates a party, item and three bills while offline", async () => {
    const result = await callHarness("createOfflineRecords", runKey);
    assert.equal(result.online, false);
    assert.equal(result.offlineState, "offline");
    assert.equal(result.partyPresent, true);
    assert.equal(result.itemPresent, true);
    assert.equal(result.invoiceCount, 3);
    assert.equal(result.uniqueInvoiceCount, 3);
    assert.equal(result.syncedInvoiceCount, 0);
    assert.equal(result.pricePresent, true);
    assert.ok(result.partyBalance > 0);
  });

  it("persists those unsynced records across a native app restart", async () => {
    await browser.reloadSession();
    await waitForHarness();
    await callHarness("setOnline", false);
    const persisted = await callHarness("snapshot", runKey);
    assert.equal(persisted.online, false);
    assert.equal(persisted.partyPresent, true);
    assert.equal(persisted.itemPresent, true);
    assert.equal(persisted.invoiceCount, 3);
    assert.equal(persisted.uniqueInvoiceCount, 3);
    assert.equal(persisted.syncedInvoiceCount, 0);
  });

  it("reconnects to Supabase with no duplicates or data loss", async () => {
    await callHarness("configureCloud", cloudConfig);
    cloudWasConfigured = true;
    const synced = await callHarness("syncRoundTrip", runKey);
    assert.equal(synced.firstState, "synced");
    assert.equal(synced.secondState, "synced");
    assert.equal(synced.local.partyPresent, true);
    assert.equal(synced.local.partySynced, true);
    assert.equal(synced.local.itemPresent, true);
    assert.equal(synced.local.itemSynced, true);
    assert.equal(synced.local.invoiceCount, 3);
    assert.equal(synced.local.uniqueInvoiceCount, 3);
    assert.equal(synced.local.syncedInvoiceCount, 3);
    assert.equal(synced.local.priceSynced, true);
    assert.equal(synced.remote.parties, 1);
    assert.equal(synced.remote.items, 1);
    assert.equal(synced.remote.prices, 1);
    assert.equal(synced.remote.invoices, 3);
    assert.equal(synced.remote.uniqueInvoices, 3);
  });

  it("downloads the same records into an emptied local store and remains idempotent", async () => {
    const empty = await callHarness("purgeLocalTestRecords", runKey);
    assert.equal(empty.partyPresent, false);
    assert.equal(empty.itemPresent, false);
    assert.equal(empty.invoiceCount, 0);
    assert.equal(empty.pricePresent, false);

    const restored = await callHarness("syncRoundTrip", runKey);
    assert.equal(restored.firstState, "synced");
    assert.equal(restored.secondState, "synced");
    assert.equal(restored.local.partyPresent, true);
    assert.equal(restored.local.itemPresent, true);
    assert.equal(restored.local.invoiceCount, 3);
    assert.equal(restored.local.uniqueInvoiceCount, 3);
    assert.equal(restored.remote.invoices, 3);
    assert.equal(restored.remote.uniqueInvoices, 3);
  });

  it("removes only this run's isolated cloud fixtures", async () => {
    const remaining = await callHarness("cleanupRemote", runKey);
    assert.deepEqual(remaining, {
      parties: 0,
      items: 0,
      prices: 0,
      invoices: 0,
      uniqueInvoices: 0,
    });
    cleanupCompleted = true;
  });
});
