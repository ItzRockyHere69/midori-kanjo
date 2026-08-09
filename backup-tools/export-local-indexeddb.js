/*
 * SENSITIVE DATA TOOL — do not commit its generated JSON.
 *
 * Open Midori Kanjo in the browser/profile that contains the authoritative
 * local data, open DevTools Console, paste this entire file and press Enter.
 * It exports every Dexie object store but deliberately excludes localStorage,
 * so the Supabase key and private sync code are never copied into the file.
 */
(async () => {
  const databaseName = "BurrabazarBillingDB";
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === databaseName)) {
      throw new Error(`No ${databaseName} database exists in this browser profile/origin.`);
    }
  }

  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  try {
    const storeNames = Array.from(database.objectStoreNames);
    const transaction = database.transaction(storeNames, "readonly");
    const stores = {};

    await Promise.all(storeNames.map((storeName) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        stores[storeName] = request.result;
        resolve();
      };
    })));

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Export transaction aborted."));
    });

    const exportedAt = new Date().toISOString();
    const payload = {
      format: "midori-kanjo-indexeddb-backup-v1",
      exportedAt,
      sourceOrigin: location.origin,
      databaseName,
      databaseVersion: database.version,
      stores,
      excluded: ["localStorage", "sessionStorage", "Supabase credentials", "business sync code"],
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `midori-kanjo-local-data-${exportedAt.replace(/[:.]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    console.info("Midori Kanjo local data exported. Treat the downloaded JSON as confidential.");
  } finally {
    database.close();
  }
})().catch((error) => console.error("Midori Kanjo local export failed:", error));
