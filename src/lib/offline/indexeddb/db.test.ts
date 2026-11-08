import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCachedDriverTrips,
  clearPendingPods,
  deletePendingPod,
  getCachedDriverTrips,
  getPendingPodById,
  getPendingPodBySubmissionId,
  getPendingPods,
  saveDriverTrips,
  savePendingPod,
  updatePendingPod,
  type CachedDriverTrip,
  type PendingPodRecord,
} from "./db";

/**
 * In-memory mock implementation of IDB for unit testing node environment
 */
class MockIDBRequest {
  result: unknown = null;
  error: Error | null = null;
  onsuccess: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
}

class MockIndex {
  constructor(private store: MockObjectStore, private keyPath: string) {}

  get(key: unknown): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      const records = Array.from(this.store.data.values());
      const found = records.find((r) => (r as Record<string, unknown>)[this.keyPath] === key);
      req.result = found || null;
      req.onsuccess?.({});
    });
    return req;
  }

  getAll(query?: unknown): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      const records = Array.from(this.store.data.values());
      if (query && typeof query === "object" && "lower" in query) {
        const val = (query as { lower: unknown }).lower;
        req.result = records.filter((r) => (r as Record<string, unknown>)[this.keyPath] === val);
      } else {
        req.result = records;
      }
      req.onsuccess?.({});
    });
    return req;
  }

  openCursor(query?: unknown): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      const records = Array.from(this.store.data.entries());
      const filtered = query && typeof query === "object" && "lower" in query
        ? records.filter(([, r]) => (r as Record<string, unknown>)[this.keyPath] === (query as { lower: unknown }).lower)
        : records;

      let idx = 0;
      const step = () => {
        if (idx >= filtered.length) {
          req.result = null;
          req.onsuccess?.({});
          return;
        }
        const [k] = filtered[idx];
        req.result = {
          delete: () => {
            this.store.data.delete(k);
          },
          continue: () => {
            idx++;
            step();
          },
        };
        req.onsuccess?.({});
      };
      step();
    });
    return req;
  }
}

class MockObjectStore {
  data = new Map<string, unknown>();
  indexes = new Map<string, MockIndex>();

  constructor(indexesToCreate?: string[]) {
    indexesToCreate?.forEach((idxName) => {
      this.indexes.set(idxName, new MockIndex(this, idxName.replace(/^by_/, "")));
    });
  }

  createIndex(name: string, keyPath: string) {
    const idx = new MockIndex(this, keyPath);
    this.indexes.set(name, idx);
    return idx;
  }

  index(name: string): MockIndex {
    const idx = this.indexes.get(name);
    if (!idx) throw new Error(`Index ${name} not found`);
    return idx;
  }

  put(record: unknown): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      const id = (record as { id: string }).id;
      this.data.set(id, record);
      req.result = id;
      req.onsuccess?.({});
    });
    return req;
  }

  get(id: string): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = this.data.get(id) || null;
      req.onsuccess?.({});
    });
    return req;
  }

  getAll(): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = Array.from(this.data.values());
      req.onsuccess?.({});
    });
    return req;
  }

  delete(id: string): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      this.data.delete(id);
      req.result = undefined;
      req.onsuccess?.({});
    });
    return req;
  }

  clear(): MockIDBRequest {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      this.data.clear();
      req.result = undefined;
      req.onsuccess?.({});
    });
    return req;
  }
}

class MockTransaction {
  error: Error | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  oncomplete: ((ev: unknown) => void) | null = null;

  constructor(private db: MockDatabase) {
    queueMicrotask(() => {
      this.oncomplete?.({});
    });
  }

  objectStore(name: string) {
    return this.db.getStore(name);
  }
}

class MockDatabase {
  private stores = new Map<string, MockObjectStore>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  onversionchange: (() => void) | null = null;

  createObjectStore(name: string) {
    const store = new MockObjectStore();
    this.stores.set(name, store);
    return store;
  }

  getStore(name: string) {
    let s = this.stores.get(name);
    if (!s) {
      s = new MockObjectStore();
      this.stores.set(name, s);
    }
    return s;
  }

  transaction() {
    return new MockTransaction(this);
  }

  close() {}
}

const mockDbInstance = new MockDatabase();
const podStore = mockDbInstance.createObjectStore("pending_pods");
podStore.createIndex("by_clientSubmissionId", "clientSubmissionId");
podStore.createIndex("by_uploadStatus", "uploadStatus");
podStore.createIndex("by_tripId", "tripId");
podStore.createIndex("by_createdAt", "createdAt");

const tripStore = mockDbInstance.createObjectStore("cached_driver_trips");
tripStore.createIndex("by_driverId", "driverId");
tripStore.createIndex("by_cachedAt", "cachedAt");

const mockIndexedDB = {
  open: () => {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = mockDbInstance;
      req.onsuccess?.({});
    });
    return req;
  },
};

const mockIDBKeyRange = {
  only: (val: unknown) => ({ lower: val, upper: val }),
};

describe("IndexedDB offline POD & trip summary storage (src/lib/offline/db.ts)", () => {
  beforeEach(async () => {
    (globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown; window: unknown }).indexedDB = mockIndexedDB;
    (globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown; window: unknown }).IDBKeyRange = mockIDBKeyRange;
    (globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown; window: unknown }).window = globalThis;

    await clearPendingPods();
    await clearCachedDriverTrips();
  });

  const createSamplePod = (overrides?: Partial<PendingPodRecord>): PendingPodRecord => ({
    id: "local-rec-1",
    clientSubmissionId: "00000000-0000-4000-8000-000000000001",
    tripId: "00000000-0000-4000-8000-000000000002",
    tripCode: "TRIP-100",
    image: new Blob(["dummy image data"], { type: "image/jpeg" }),
    filename: "TRIP-100.jpg",
    mediaType: "image/jpeg",
    capturedAt: new Date().toISOString(),
    gpsLat: 19.8762,
    gpsLng: 75.3433,
    uploadStatus: "PENDING",
    retryCount: 0,
    lastAttemptAt: null,
    createdAt: new Date().toISOString(),
    lastError: null,
    ...overrides,
  });

  const createSampleTrip = (id: string, tripCode: string): Omit<CachedDriverTrip, "driverId" | "cachedAt"> => ({
    id,
    tripCode,
    origin: "Chhatrapati Sambhajinagar",
    destination: "Pune",
    lrNumber: `LR-${tripCode}`,
    goodsDescription: "Automotive Parts",
    expectedQuantity: 500,
    quantityUnit: "BOX",
    status: "POD_PENDING",
    client: { name: "Bajaj Auto" },
    podSubmissions: [],
  });

  it("saves a POD Blob and metadata to IndexedDB", async () => {
    const sample = createSamplePod();
    await savePendingPod(sample);

    const retrieved = await getPendingPodById(sample.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(sample.id);
    expect(retrieved?.clientSubmissionId).toBe(sample.clientSubmissionId);
    expect(retrieved?.uploadStatus).toBe("PENDING");
    expect(retrieved?.gpsLat).toBe(19.8762);
    expect(retrieved?.gpsLng).toBe(75.3433);
    expect(retrieved?.image).toBeInstanceOf(Blob);
  });

  it("reads pending PODs and filters by uploadStatus", async () => {
    const pod1 = createSamplePod({ id: "p1", clientSubmissionId: "sub-1", uploadStatus: "PENDING" });
    const pod2 = createSamplePod({ id: "p2", clientSubmissionId: "sub-2", uploadStatus: "UPLOADED" });
    const pod3 = createSamplePod({ id: "p3", clientSubmissionId: "sub-3", uploadStatus: "PENDING" });

    await savePendingPod(pod1);
    await savePendingPod(pod2);
    await savePendingPod(pod3);

    const all = await getPendingPods();
    expect(all).toHaveLength(3);

    const pendingOnly = await getPendingPods("PENDING");
    expect(pendingOnly).toHaveLength(2);
    expect(pendingOnly.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("retrieves a pending record by clientSubmissionId (idempotency key)", async () => {
    const sample = createSamplePod();
    await savePendingPod(sample);

    const bySubId = await getPendingPodBySubmissionId(sample.clientSubmissionId);
    expect(bySubId).not.toBeNull();
    expect(bySubId?.id).toBe(sample.id);
  });

  it("updates upload status and retry count safely without changing immutable keys", async () => {
    const sample = createSamplePod();
    await savePendingPod(sample);

    const updated = await updatePendingPod(sample.id, {
      uploadStatus: "UPLOADING",
      retryCount: 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: "Network timeout",
    });

    expect(updated.uploadStatus).toBe("UPLOADING");
    expect(updated.retryCount).toBe(1);
    expect(updated.lastError).toBe("Network timeout");
    expect(updated.id).toBe(sample.id);
    expect(updated.clientSubmissionId).toBe(sample.clientSubmissionId);

    const fromDb = await getPendingPodById(sample.id);
    expect(fromDb?.uploadStatus).toBe("UPLOADING");
    expect(fromDb?.retryCount).toBe(1);
  });

  it("deletes an individual record after server confirmation", async () => {
    const sample = createSamplePod();
    await savePendingPod(sample);

    await deletePendingPod(sample.id);
    const retrieved = await getPendingPodById(sample.id);
    expect(retrieved).toBeNull();
  });

  it("saves, retrieves, and updates driver-specific trip summaries", async () => {
    const driverA = "driver-user-1";
    const driverB = "driver-user-2";

    const tripA1 = createSampleTrip("trip-1", "TR-001");
    const tripA2 = createSampleTrip("trip-2", "TR-002");
    const tripB1 = createSampleTrip("trip-3", "TR-003");

    await saveDriverTrips(driverA, [tripA1, tripA2]);
    await saveDriverTrips(driverB, [tripB1]);

    const cachedA = await getCachedDriverTrips(driverA);
    expect(cachedA).toHaveLength(2);
    expect(cachedA.map((t) => t.id)).toEqual(["trip-1", "trip-2"]);
    expect(cachedA[0].driverId).toBe(driverA);
    expect(cachedA[0].cachedAt).toBeGreaterThan(0);

    const cachedB = await getCachedDriverTrips(driverB);
    expect(cachedB).toHaveLength(1);
    expect(cachedB[0].id).toBe("trip-3");
  });

  it("clears cached trip summaries independently without deleting pending POD images", async () => {
    const driverId = "driver-user-1";
    await saveDriverTrips(driverId, [createSampleTrip("trip-1", "TR-001")]);
    await savePendingPod(createSamplePod({ id: "pod-1", clientSubmissionId: "sub-1" }));

    // Clear trip summaries (e.g. on logout)
    await clearCachedDriverTrips(driverId);

    const remainingTrips = await getCachedDriverTrips(driverId);
    expect(remainingTrips).toHaveLength(0);

    // Pending PODs MUST remain safe and intact
    const remainingPods = await getPendingPods();
    expect(remainingPods).toHaveLength(1);
    expect(remainingPods[0].id).toBe("pod-1");
  });
});
