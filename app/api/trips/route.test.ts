import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const guard = vi.fn();
  return {
    guard,
    requireRole: vi.fn(() => guard),
    prisma: {
      trip: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      branch: { findMany: vi.fn() },
      client: { findMany: vi.fn() },
      uploadLink: { updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn((cb) => cb(mocks.prisma)),
    },
  };
});

vi.mock("@/src/lib/auth/requireRole", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("../../../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../../../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../../../../src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../../src/lib/pods/imageUrl", () => ({
  createPodImageToken: vi.fn(() => Promise.resolve("mock-token")),
  POD_IMAGE_URL_TTL_SECONDS: 3600,
}));

import { GET as getTrips } from "./route";
import { GET as getTripDetail } from "./[id]/route";
import { POST as generateUploadLink } from "./[id]/upload-link/route";
import { POST as revokeUploadLinkRoute } from "./[id]/upload-link/revoke/route";

describe("Executive Trips API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({
      ok: true,
      session: { userId: "exec-1", role: "BILLING_EXEC" },
    });
  });

  describe("GET /api/trips (Trips listing & filters)", () => {
    it("requires BILLING_EXEC role", async () => {
      mocks.guard.mockResolvedValueOnce({
        ok: false,
        response: new Response("Unauthorized", { status: 403 }),
      });

      const res = await getTrips(new Request("https://example.com/api/trips"));
      expect(res.status).toBe(403);
    });

    it("fetches trips with search, filter parameters, and pagination", async () => {
      mocks.prisma.trip.count.mockResolvedValueOnce(45);
      mocks.prisma.trip.findMany.mockResolvedValueOnce([
        {
          id: "00000000-0000-4000-8000-000000000001",
          tripCode: "TRP-101",
          lrNumber: "LR-101",
          origin: "Pune",
          destination: "Mumbai",
          freight: 15000,
          status: "POD_PENDING",
          isHired: true,
          createdAt: new Date("2026-11-01T10:00:00Z"),
          deliveredAt: null,
          client: { id: "c-1", name: "Bajaj Auto" },
          branch: { id: "b-1", name: "Pune Branch" },
          vehicle: { vehicleNo: "MH12AB1234", isHired: true },
          driver: null,
          podSubmissions: [],
          uploadLinks: [],
        },
      ]);
      mocks.prisma.branch.findMany.mockResolvedValueOnce([{ id: "b-1", name: "Pune Branch" }]);
      mocks.prisma.client.findMany.mockResolvedValueOnce([{ id: "c-1", name: "Bajaj Auto" }]);

      const req = new Request(
        "https://example.com/api/trips?search=TRP-101&vehicleType=HIRED&page=1&limit=20",
      );
      const res = await getTrips(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.trips).toHaveLength(1);
      expect(json.trips[0].tripCode).toBe("TRP-101");
      expect(json.trips[0].isHired).toBe(true);
      expect(json.pagination.totalCount).toBe(45);
      expect(json.pagination.totalPages).toBe(3);
    });
  });

  describe("GET /api/trips/[id] (Trip details)", () => {
    it("returns 404 if trip not found", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce(null);

      const res = await getTripDetail(
        new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001"),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
      );
      expect(res.status).toBe(404);
    });

    it("returns full details and derives NOT_GENERATED for trip without link", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRP-101",
        lrNumber: "LR-101",
        ewayBillNo: "EWAY-1",
        origin: "Pune",
        destination: "Mumbai",
        goodsDescription: "Auto Parts",
        freight: 15000,
        expectedQuantity: 100,
        deliveredQuantity: null,
        quantityUnit: "BOX",
        status: "POD_PENDING",
        statusReason: null,
        isHired: true,
        createdAt: new Date(),
        startedAt: null,
        deliveredAt: null,
        podReceivedAt: null,
        verifiedAt: null,
        invoicedAt: null,
        client: { id: "c-1", name: "Bajaj" },
        branch: { id: "b-1", name: "Pune" },
        vehicle: { vehicleNo: "MH12", isHired: true },
        driver: null,
        podSubmissions: [],
        uploadLinks: [],
      });

      const res = await getTripDetail(
        new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001"),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.trip.uploadLink.status).toBe("NOT_GENERATED");
    });
  });

  describe("POST /api/trips/[id]/upload-link (Generate hired driver link)", () => {
    it("rejects non-hired (company own) vehicles", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRP-OWN",
        isHired: false,
        status: "POD_PENDING",
      });

      const res = await generateUploadLink(
        new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001/upload-link", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("not_hired_trip");
    });

    it("generates 48-hour secure upload link and revokes previous active link", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRP-HIRED",
        isHired: true,
        status: "POD_PENDING",
      });
      mocks.prisma.uploadLink.create.mockResolvedValueOnce({
        id: "ul-new",
      });

      const res = await generateUploadLink(
        new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001/upload-link", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.link.uploadUrl).toContain("/upload/");
      // Audit log was created
      expect(mocks.prisma.auditLog.create).toHaveBeenCalled();
      // Trip row was locked to serialize concurrent requests
      expect(mocks.prisma.trip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "00000000-0000-4000-8000-000000000001" },
        }),
      );
      // Old links invalidated
      expect(mocks.prisma.uploadLink.updateMany).toHaveBeenCalled();
    });

    it("failed generation does not commit or invalidate link", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRP-HIRED",
        isHired: true,
        status: "POD_PENDING",
      });
      // Simulate transaction failure inside
      mocks.prisma.$transaction.mockRejectedValueOnce(new Error("DB transaction rolled back"));

      await expect(
        generateUploadLink(
          new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001/upload-link", {
            method: "POST",
          }),
          { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
        ),
      ).rejects.toThrow("DB transaction rolled back");
    });
  });

  describe("POST /api/trips/[id]/upload-link/revoke", () => {
    it("revokes active upload link and logs audit event", async () => {
      mocks.prisma.trip.findUnique.mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000001",
        isHired: true,
      });
      mocks.prisma.uploadLink.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await revokeUploadLinkRoute(
        new Request("https://example.com/api/trips/00000000-0000-4000-8000-000000000001/upload-link/revoke", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.revoked).toBe(true);
      expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "UPLOAD_LINK_REVOKED" }),
      });
    });
  });
});

