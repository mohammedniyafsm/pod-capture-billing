import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const guard = vi.fn();
  return {
    guard,
    requireRole: vi.fn(() => guard),
    prisma: {
      trip: { count: vi.fn(), findMany: vi.fn() },
    },
  };
});

vi.mock("@/src/lib/auth/requireRole", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/src/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET as getReviews } from "./route";

describe("Executive POD Review API - GET /api/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({
      ok: true,
      session: { userId: "exec-1", role: "BILLING_EXEC" },
    });
  });

  it("requires BILLING_EXEC role", async () => {
    mocks.guard.mockResolvedValueOnce({
      ok: false,
      response: new Response("Unauthorized", { status: 403 }),
    });

    const res = await getReviews(new Request("https://example.com/api/review"));
    expect(res.status).toBe(403);
  });

  it("returns paginated review trips with default pagination", async () => {
    mocks.prisma.trip.count.mockResolvedValueOnce(35);
    mocks.prisma.trip.findMany.mockResolvedValueOnce([
      {
        id: "trip-1",
        tripCode: "TRP-REV-001",
        status: "NEEDS_REVIEW",
        goodsDescription: "Steel coils",
        lrNumber: "LR-001",
        quantityUnit: "MT",
        expectedQuantity: 20,
        deliveredQuantity: null,
        retakeCount: 0,
        createdAt: new Date("2026-11-05T09:00:00Z"),
        client: { id: "c-1", name: "Tata Steel" },
        branch: { id: "b-1", name: "Pune" },
        vehicle: { vehicleNo: "MH12AB1234" },
        podSubmissions: [
          {
            id: "pod-1",
            attemptNo: 1,
            uploadedAt: new Date("2026-11-05T10:00:00Z"),
            extraction: {
              verdict: "NEEDS_REVIEW",
              reasons: ["stamp_not_visible"],
              fields: {},
              confidences: {},
            },
          },
        ],
      },
    ]);

    const res = await getReviews(new Request("https://example.com/api/review"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.trips).toHaveLength(1);
    expect(json.trips[0].tripCode).toBe("TRP-REV-001");
    expect(json.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 35,
      totalPages: 4,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    expect(mocks.prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        where: { status: "NEEDS_REVIEW" },
      }),
    );
    expect(mocks.prisma.trip.count).toHaveBeenCalledWith({
      where: { status: "NEEDS_REVIEW" },
    });
  });

  it("handles custom page and limit, and calculates pagination correctly", async () => {
    mocks.prisma.trip.count.mockResolvedValueOnce(55);
    mocks.prisma.trip.findMany.mockResolvedValueOnce([]);

    const res = await getReviews(
      new Request("https://example.com/api/review?page=2&limit=15"),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.pagination).toEqual({
      page: 2,
      limit: 15,
      total: 55,
      totalPages: 4,
      hasNextPage: true,
      hasPreviousPage: true,
    });

    expect(mocks.prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 15,
        take: 15,
      }),
    );
  });

  it("applies filters (reason, branch, search) to both count and findMany queries", async () => {
    mocks.prisma.trip.count.mockResolvedValueOnce(5);
    mocks.prisma.trip.findMany.mockResolvedValueOnce([]);

    const res = await getReviews(
      new Request(
        "https://example.com/api/review?reason=blurry&branch=b-1&search=MH12",
      ),
    );
    expect(res.status).toBe(200);

    const expectedWhere = {
      status: "NEEDS_REVIEW",
      AND: [
        {
          OR: [
            { branchId: "b-1" },
            { branch: { name: { equals: "b-1", mode: "insensitive" } } },
          ],
        },
        {
          OR: [
            { tripCode: { contains: "MH12", mode: "insensitive" } },
            { lrNumber: { contains: "MH12", mode: "insensitive" } },
            { client: { name: { contains: "MH12", mode: "insensitive" } } },
            { vehicleNo: { contains: "MH12", mode: "insensitive" } },
          ],
        },
      ],
      podSubmissions: {
        some: {
          extraction: {
            reasons: { has: "blurry" },
          },
        },
      },
    };

    expect(mocks.prisma.trip.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mocks.prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });

  it("returns validation error for invalid page or limit", async () => {
    const res = await getReviews(
      new Request("https://example.com/api/review?page=-1"),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("validation_error");
  });
});

