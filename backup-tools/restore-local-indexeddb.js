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
  if (!confirm("This will replace Midori Kanjo data in this browser profile. Continue?")) return;

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  try {
    const available = new Set(Array.from(database.objectStoreNames));
    const storeNames = Object.keys(payload.stores).filter((name) => available.has(name));
    const unknown = Object.keys(payload.stores).filter((name) => !available.has(name));
    if (!storeNames.length) throw new Error("No backup stores exist in this app version.");
    if (unknown.length) console.warn("Skipped stores not present in this app version:", unknown);

    const transaction = database.transaction(storeNames, "readwrite");
    for (const storeName of storeNames) {
      const store = transaction.objectStore(storeName);
      store.clear();
      const records = payload.stores[storeName];
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
