/*
 * DESTRUCTIVE SENSITIVE DATA TOOL.
 *
 * Run this from DevTools Console while Midori Kanjo is open on the destination
 * origin/profile. It clears and restores the stores present in the selected
 * export. Use only on a fresh installation or after making another backup.
 */
(async () => {
  const databaseName = "BurrabazarBillingDB";
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === databaseName)) {
      throw new Error(`Open Midori Kanjo once before restoring so ${databaseName} is created.`);
    }
  }

  const file = await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
  if (!file) return;

  const payload = JSON.parse(await file.text());
  if (payload?.format !== "midori-kanjo-indexeddb-backup-v1" || payload.databaseName !== databaseName) {
    throw new Error("The selected file is not a supported Midori Kanjo local backup.");
  }
  if (!payload.stores || typeof payload.stores !== "object") {
    throw new Error("Backup has no object-store data.");
  }
  if (!Number.isInteger(payload.databaseVersion) || payload.databaseVersion < 1) {
    throw new Error("Backup has no valid database version.");
  }
  if (!confirm("This will replace Midori Kanjo data in this browser profile. Continue?")) return;

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  try {
    const available = new Set(Array.from(database.objectStoreNames));
    if (payload.databaseVersion > database.version) {
      throw new Error("This backup was made by a newer Midori Kanjo version. Update the app before restoring it.");
    }
    const stores = { ...payload.stores };
    if (payload.databaseVersion < 6) {
      const fallbackStamp = typeof payload.exportedAt === "string"
        ? payload.exportedAt
        : new Date().toISOString();
      stores.categories = (Array.isArray(stores.categories) ? stores.categories : []).map((row) => ({
        ...row,
        createdAt: row.createdAt || fallbackStamp,
        updatedAt: row.updatedAt || row.createdAt || fallbackStamp,
        isSynced: false,
      }));
      stores.stockMovements = (Array.isArray(stores.stockMovements) ? stores.stockMovements : []).map((row) => {
        const occurredAt = row.createdAt || fallbackStamp;
        return {
          ...row,
          kind: row.kind || "manual_adjustment",
          reason: row.reason || "legacy_adjustment",
          note: row.note || (row.countedBy ? `Counted by ${row.countedBy}` : "Imported legacy stock movement"),
          qtyChange: typeof row.qtyChange === "number" && Number.isFinite(row.qtyChange) ? row.qtyChange : null,
          stockBefore: row.stockBefore ?? null,
          stockAfter: row.stockAfter ?? null,
          applied: row.applied ?? true,
          date: row.date || occurredAt.slice(0, 10),
          actor: row.actor || "staff",
          createdAt: occurredAt,
          updatedAt: row.updatedAt || occurredAt,
          isSynced: false,
          countedBy: undefined,
        };
      });
      const itemById = new Map((Array.isArray(stores.items) ? stores.items : []).map((item) => [item.id, item]));
      const baselined = new Set(stores.stockMovements.filter((row) => row.kind === "baseline").map((row) => row.itemId));
      for (const item of itemById.values()) {
        if (item.currentStock === null || baselined.has(item.id)) continue;
        const sourceMillis = Date.parse(item.updatedAt || item.createdAt || "1970-01-01T00:00:00.000Z");
        const baselineStamp = Number.isFinite(sourceMillis)
          ? new Date(sourceMillis + 1).toISOString()
          : "1970-01-01T00:00:00.001Z";
        stores.stockMovements.push({
          id: `baseline:${item.id}`,
          itemId: item.id,
          kind: "baseline",
          reason: "phase2_baseline",
          note: "Opening tracked stock at Phase 2 upgrade",
          qtyChange: null,
          stockBefore: null,
          stockAfter: item.currentStock,
          applied: true,
          date: baselineStamp.slice(0, 10),
          actor: "owner",
          createdAt: baselineStamp,
          updatedAt: baselineStamp,
          isSynced: false,
        });
      }
      const countLines = [];
      stores.countSessions = (Array.isArray(stores.countSessions) ? stores.countSessions : []).map((row) => {
        const itemIds = row.itemIds || row.itemsCounted || [];
        const startedAt = row.startedAt || fallbackStamp;
        for (const itemId of itemIds) {
          const item = itemById.get(itemId);
          if (!item) continue;
          countLines.push({
            id: `${row.id}::${itemId}`,
            sessionId: row.id,
            itemId,
            itemName: item.name,
            skuCode: item.skuCode,
            baseUnit: item.baseUnit,
            systemStockAtStart: item.currentStock,
            countedStock: null,
            createdAt: startedAt,
            updatedAt: row.updatedAt || startedAt,
            isSynced: false,
          });
        }
        return {
          id: row.id,
          categoryId: row.categoryId,
          categoryName: row.categoryName || "Inventory count",
          status: row.completedAt ? "completed" : "in_progress",
          itemIds,
          startedAt,
          completedAt: row.completedAt,
          updatedAt: row.updatedAt || row.completedAt || startedAt,
          isSynced: false,
        };
      });
      stores.countLines = countLines;
    }
    const storeNames = Array.from(available);
    const unknown = Object.keys(payload.stores).filter((name) => !available.has(name));
    if (!Object.keys(stores).some((name) => available.has(name))) throw new Error("No backup stores exist in this app version.");
    if (unknown.length) console.warn("Skipped stores not present in this app version:", unknown);

    const transaction = database.transaction(storeNames, "readwrite");
    for (const storeName of storeNames) {
      const store = transaction.objectStore(storeName);
      store.clear();
      const records = stores[storeName] || [];
      if (!Array.isArray(records)) throw new Error(`Store ${storeName} is not an array.`);
      for (const record of records) store.put(record);
    }

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Restore transaction aborted."));
    });
    console.info("Midori Kanjo local restore completed. Reload the app now.");
  } finally {
    database.close();
  }
})().catch((error) => console.error("Midori Kanjo local restore failed:", error));
