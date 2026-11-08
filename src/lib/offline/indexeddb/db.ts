/**
 * Offline-First IndexedDB Storage for POD Captures and Cached Trip Summaries.
 *
 * Implements robust browser persistence without external dependencies.
 * Handles storage errors, quota limits, and requests persistent storage where supported.
 */

export type LocalUploadStatus = "PENDING" | "UPLOADING" | "UPLOADED" | "FAILED";

export interface PendingPodRecord {
  /** Unique local ID (UUID) */
  id: string;
  /** Server-side idempotency UUID. Reused on all retries. */
  clientSubmissionId: string;
  /** Trip identifier */
  tripId: string;
  /** Trip code / display label */
  tripCode?: string;
  /** Compressed photo Blob */
  image: Blob;
  /** Original file name or generated name */
  filename: string;
  /** MIME type (e.g., 'image/jpeg') */
  mediaType: string;
  /** Device capture timestamp (ISO string) */
  capturedAt: string;
  /** GPS latitude if permission was granted */
  gpsLat: number | null;
  /** GPS longitude if permission was granted */
  gpsLng: number | null;
  /** Local status of upload attempt */
  uploadStatus: LocalUploadStatus;
  /** Number of retry attempts made */
  retryCount: number;
  /** Timestamp of most recent upload attempt */
  lastAttemptAt: string | null;
  /** Local creation timestamp */
  createdAt: string;
  /** Last error message if failed */
  lastError: string | null;
}

export interface CachedDriverTrip {
  id: string;
  tripCode: string;
  origin: string;
  destination: string;
  client?: { name: string } | null;
  lrNumber: string;
  goodsDescription: string;
  expectedQuantity: number | string;
  quantityUnit: string;
  status: string;
  statusReason?: string | null;
  driverId: string;
  cachedAt: number;
  podSubmissions: Array<{
    id: string;
    status: string;
    retakeReason: string | null;
    attemptsLeft: number | null;
  }>;
}

const DB_NAME = "fleetproof_offline_db";
const DB_VERSION = 2;
const POD_STORE = "pending_pods";
const TRIP_STORE = "cached_driver_trips";

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initializes and opens the IndexedDB database.
 */
export function getDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(POD_STORE)) {
          const store = db.createObjectStore(POD_STORE, { keyPath: "id" });
          store.createIndex("by_clientSubmissionId", "clientSubmissionId", { unique: true });
          store.createIndex("by_tripId", "tripId", { unique: false });
          store.createIndex("by_uploadStatus", "uploadStatus", { unique: false });
          store.createIndex("by_createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(TRIP_STORE)) {
          const tripStore = db.createObjectStore(TRIP_STORE, { keyPath: "id" });
          tripStore.createIndex("by_driverId", "driverId", { unique: false });
          tripStore.createIndex("by_cachedAt", "cachedAt", { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };

      request.onblocked = () => {
        console.warn("IndexedDB open request is blocked by another connection");
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });

  return dbPromise;
}

/**
 * Requests persistent storage from the browser to prevent eviction.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    navigator.storage.persist
  ) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pending POD Operations
// ---------------------------------------------------------------------------

/**
 * Saves a pending POD record locally before any network attempt.
 */
export async function savePendingPod(record: PendingPodRecord): Promise<PendingPodRecord> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readwrite");
      const store = tx.objectStore(POD_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error || new Error("Failed to save pending POD to IndexedDB"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed while saving"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Gets all pending POD records, optionally filtered by status.
 */
export async function getPendingPods(status?: LocalUploadStatus): Promise<PendingPodRecord[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readonly");
      const store = tx.objectStore(POD_STORE);

      let request: IDBRequest<PendingPodRecord[]>;
      if (status) {
        const index = store.index("by_uploadStatus");
        request = index.getAll(IDBKeyRange.only(status));
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        const list = request.result || [];
        // Sort oldest first (FIFO upload order)
        list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        resolve(list);
      };
      request.onerror = () => reject(request.error || new Error("Failed to retrieve pending PODs"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves a single pending POD by its local ID.
 */
export async function getPendingPodById(id: string): Promise<PendingPodRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readonly");
      const store = tx.objectStore(POD_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Failed to get pending POD ${id}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves a pending POD by its clientSubmissionId.
 */
export async function getPendingPodBySubmissionId(clientSubmissionId: string): Promise<PendingPodRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readonly");
      const store = tx.objectStore(POD_STORE);
      const index = store.index("by_clientSubmissionId");
      const request = index.get(clientSubmissionId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Failed to get pending POD by clientSubmissionId`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Updates an existing pending POD record with partial updates.
 */
export async function updatePendingPod(
  id: string,
  updates: Partial<Omit<PendingPodRecord, "id" | "clientSubmissionId" | "tripId">>,
): Promise<PendingPodRecord> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readwrite");
      const store = tx.objectStore(POD_STORE);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const current = getReq.result as PendingPodRecord | undefined;
        if (!current) {
          reject(new Error(`Pending POD with id ${id} not found`));
          return;
        }

        const updated: PendingPodRecord = {
          ...current,
          ...updates,
          id: current.id, // Immutable
          clientSubmissionId: current.clientSubmissionId, // Immutable
          tripId: current.tripId, // Immutable
        };

        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error || new Error(`Failed to update pending POD ${id}`));
      };

      getReq.onerror = () => reject(getReq.error || new Error(`Failed to read pending POD ${id} before update`));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed while updating"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Deletes a pending POD record from IndexedDB (e.g. after backend confirmation).
 */
export async function deletePendingPod(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readwrite");
      const store = tx.objectStore(POD_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Failed to delete pending POD ${id}`));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed while deleting"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clears all pending POD records.
 */
export async function clearPendingPods(): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(POD_STORE, "readwrite");
      const store = tx.objectStore(POD_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("Failed to clear pending PODs"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed while clearing"));
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Cached Driver Trips Operations
// ---------------------------------------------------------------------------

/**
 * Saves or updates minimal trip summaries assigned to the current driver.
 */
export async function saveDriverTrips(driverId: string, trips: Omit<CachedDriverTrip, "driverId" | "cachedAt">[]): Promise<void> {
  const db = await getDb();
  const cachedAt = Date.now();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(TRIP_STORE, "readwrite");
      const store = tx.objectStore(TRIP_STORE);

      // Overwrite/update entries for this driver
      for (const trip of trips) {
        const record: CachedDriverTrip = {
          ...trip,
          driverId,
          cachedAt,
        };
        store.put(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save driver trips to IndexedDB"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Retrieves cached trips assigned to the specified driver.
 */
export async function getCachedDriverTrips(driverId: string): Promise<CachedDriverTrip[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(TRIP_STORE, "readonly");
      const store = tx.objectStore(TRIP_STORE);
      const index = store.index("by_driverId");
      const request = index.getAll(IDBKeyRange.only(driverId));

      request.onsuccess = () => {
        const list = (request.result || []) as CachedDriverTrip[];
        resolve(list);
      };
      request.onerror = () => reject(request.error || new Error("Failed to retrieve cached driver trips"));
      tx.onerror = () => reject(tx.error || new Error("Transaction error retrieving cached driver trips"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Clears cached driver trip summaries (e.g. on logout).
 * Note: Does NOT delete pending POD images.
 */
export async function clearCachedDriverTrips(driverId?: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(TRIP_STORE, "readwrite");
      const store = tx.objectStore(TRIP_STORE);

      if (!driverId) {
        // Clear all trips
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error("Failed to clear trip store"));
      } else {
        // Clear only trips belonging to this driver
        const index = store.index("by_driverId");
        const req = index.openCursor(IDBKeyRange.only(driverId));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error || new Error(`Failed to clear cached trips for driver ${driverId}`));
      }

      tx.onerror = () => reject(tx.error || new Error("Transaction error while clearing cached trips"));
    } catch (err) {
      reject(err);
    }
  });
}
