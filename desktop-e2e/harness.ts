import {
  createParty,
  createQuickItem,
  saveSale,
} from "../lib/billing";
import {
  db,
  priceKey,
  type InvoiceLine,
} from "../lib/db";
import {
  clearCloudConfig,
  configureCloud,
  pendingBreakdown,
  supabaseClient,
  syncDiagnostics,
  syncNow,
  type CloudConfig,
} from "../lib/sync";

interface TestRecordIds {
  partyId: string;
  itemId: string;
  invoiceIds: string[];
  priceId: string;
  expectedDue: number;
}

interface DesktopE2EHarness {
  setOnline(online: boolean): Promise<boolean>;
  createOfflineRecords(runKey: string): Promise<unknown>;
  configureCloud(config: CloudConfig): Promise<void>;
  snapshot(runKey: string): Promise<unknown>;
  syncRoundTrip(runKey: string): Promise<unknown>;
  purgeLocalTestRecords(runKey: string): Promise<unknown>;
  cleanupRemote(runKey: string): Promise<unknown>;
}

declare global {
  interface Window {
    __MIDORI_DESKTOP_E2E__?: DesktopE2EHarness;
  }
}

const markerKey = (runKey: string) => `desktop-e2e-records:${runKey}`;

async function recordIds(runKey: string): Promise<TestRecordIds> {
  const marker = await db.meta.get(markerKey(runKey));
  if (!marker?.value) throw new Error(`No desktop test marker exists for ${runKey}.`);
  return JSON.parse(String(marker.value)) as TestRecordIds;
}

function overrideOnlineState(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
  return window.navigator.onLine;
}

async function snapshot(runKey: string) {
  const ids = await recordIds(runKey);
  const [party, item, invoices, price, pending, diagnostics] = await Promise.all([
    db.parties.get(ids.partyId),
    db.items.get(ids.itemId),
    db.invoices.bulkGet(ids.invoiceIds),
    db.partyItemPrices.get(ids.priceId),
    pendingBreakdown(),
    syncDiagnostics(),
  ]);
  const presentInvoices = invoices.filter(Boolean);
  return {
    ids,
    online: window.navigator.onLine,
    partyPresent: Boolean(party),
    partySynced: party?.isSynced ?? null,
    partyBalance: party?.currentBalance ?? null,
    itemPresent: Boolean(item),
    itemSynced: item?.isSynced ?? null,
    invoiceCount: presentInvoices.length,
    uniqueInvoiceCount: new Set(presentInvoices.map((invoice) => invoice?.id)).size,
    syncedInvoiceCount: presentInvoices.filter((invoice) => invoice?.isSynced).length,
    pricePresent: Boolean(price),
    priceSynced: price?.isSynced ?? null,
    pending,
    lastSyncError: diagnostics.lastError || null,
  };
}

async function remoteCounts(ids: TestRecordIds) {
  const client = supabaseClient();
  if (!client) throw new Error("Supabase is not configured in the desktop test app.");
  const queries = await Promise.all([
    client.from("parties").select("id").eq("id", ids.partyId),
    client.from("items").select("id").eq("id", ids.itemId),
    client.from("party_item_prices").select("id").eq("id", ids.priceId),
    client.from("invoices").select("id").in("id", ids.invoiceIds),
  ]);
  const error = queries.find((query) => query.error)?.error;
  if (error) throw error;
  return {
    parties: queries[0].data?.length || 0,
    items: queries[1].data?.length || 0,
    prices: queries[2].data?.length || 0,
    invoices: queries[3].data?.length || 0,
    uniqueInvoices: new Set((queries[3].data || []).map((row) => row.id)).size,
  };
}

const harness: DesktopE2EHarness = {
  async setOnline(online) {
    await db.open();
    return overrideOnlineState(online);
  },

  async createOfflineRecords(runKey) {
    await db.open();
    overrideOnlineState(false);
    if (await db.meta.get(markerKey(runKey))) {
      throw new Error(`Desktop test records already exist for ${runKey}.`);
    }
    const party = await createParty({
      name: `Desktop Offline Customer ${runKey}`,
      codeName: `E2E-${runKey}`,
      phone: "9000000000",
      address: "Burrabazar, Kolkata",
      type: "customer",
      priceTier: "wholesale",
    });
    const item = await createQuickItem(`Desktop Offline Item ${runKey}`, 280);
    const line: InvoiceLine = {
      itemId: item.id,
      itemName: item.name,
      skuCode: item.skuCode,
      hsnCode: "",
      qty: 2,
      unit: item.baseUnit,
      baseUnit: item.baseUnit,
      rate: 280,
      discount: 0,
      taxableAmount: 0,
      gstRate: 18,
      gstAmount: 0,
      amount: 0,
    };
    const invoices = [];
    for (let index = 1; index <= 3; index += 1) {
      invoices.push(await saveSale({
        party,
        lines: [line],
        paid: 0,
        paymentMode: "credit",
        paymentPlan: "credit",
        notes: `Native offline round-trip ${runKey} #${index}`,
        idempotencyKey: `desktop-e2e-${runKey}-invoice-${index}`,
      }));
    }
    const ids: TestRecordIds = {
      partyId: party.id,
      itemId: item.id,
      invoiceIds: invoices.map((invoice) => invoice.id),
      priceId: priceKey(party.id, item.id),
      expectedDue: invoices.reduce((sum, invoice) => sum + invoice.amountDue, 0),
    };
    await db.meta.put({ key: markerKey(runKey), value: JSON.stringify(ids) });
    const offlineState = await syncNow();
    return { offlineState, ...(await snapshot(runKey)) };
  },

  async configureCloud(config) {
    await db.open();
    overrideOnlineState(false);
    await configureCloud(config);
  },

  snapshot,

  async syncRoundTrip(runKey) {
    overrideOnlineState(true);
    // A second pass proves the upserts are idempotent and also consumes a
    // realtime-triggered sync if the online event started one first.
    const firstState = await syncNow();
    const secondState = await syncNow();
    const ids = await recordIds(runKey);
    return {
      firstState,
      secondState,
      local: await snapshot(runKey),
      remote: await remoteCounts(ids),
    };
  },

  async purgeLocalTestRecords(runKey) {
    const ids = await recordIds(runKey);
    await db.transaction(
      "rw",
      [db.partyItemPrices, db.invoices, db.items, db.parties],
      async () => {
        await db.partyItemPrices.delete(ids.priceId);
        await db.invoices.bulkDelete(ids.invoiceIds);
        await db.items.delete(ids.itemId);
        await db.parties.delete(ids.partyId);
      },
    );
    return snapshot(runKey);
  },

  async cleanupRemote(runKey) {
    const ids = await recordIds(runKey);
    const client = supabaseClient();
    if (!client) throw new Error("Supabase is not configured in the desktop test app.");
    const results = await Promise.all([
      client.from("party_item_prices").delete().eq("id", ids.priceId),
      client.from("invoices").delete().in("id", ids.invoiceIds),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const itemResult = await client.from("items").delete().eq("id", ids.itemId);
    if (itemResult.error) throw itemResult.error;
    const partyResult = await client.from("parties").delete().eq("id", ids.partyId);
    if (partyResult.error) throw partyResult.error;
    const remaining = await remoteCounts(ids);
    await clearCloudConfig();
    return remaining;
  },
};

window.__MIDORI_DESKTOP_E2E__ = harness;
