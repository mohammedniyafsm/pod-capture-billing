import { describe, expect, it, vi } from "vitest";
import { TripStatus, UserRole } from "@prisma/client";
import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";

vi.mock("@/src/lib/auth/rbac/requireRole", () => ({
  requireRole: (role: string) => async (req: Request) => {
    const roleHeader = req.headers.get("x-mock-role");
    if (!roleHeader || roleHeader !== role) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ error: "Forbidden", code: "forbidden" }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      };
    }
    return {
      ok: true,
      session: {
        userId: "test-billing-user-id",
        role: UserRole.BILLING_EXEC,
      },
    };
  },
}));

vi.mock("@/src/lib/prisma", () => {
  return {
    prisma: {
      trip: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: {
        createMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        return cb(prisma);
      }),
    },
  };
});

describe("POST /api/trips/invoice", () => {
  it("rejects non-BILLING_EXEC roles with 403", async () => {
    const request = new Request("http://localhost/api/trips/invoice", {
      method: "POST",
      headers: { "x-mock-role": "DRIVER", "content-type": "application/json" },
      body: JSON.stringify({
        tripIds: ["00000000-0000-4000-8000-000000000001"],
        invoiceDate: "2026-11-05T00:00:00Z",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("rejects non-EXPORTED trips with 409", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRIP-001",
        status: TripStatus.VERIFIED, // Not EXPORTED
        podReceivedAt: new Date("2026-11-01T00:00:00Z"),
        invoicedAt: null,
        invoiceNumber: null,
      } as any,
    ]);

    const request = new Request("http://localhost/api/trips/invoice", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC, "content-type": "application/json" },
      body: JSON.stringify({
        tripIds: ["00000000-0000-4000-8000-000000000001"],
        invoiceDate: "2026-11-05T00:00:00Z",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.code).toBe("ineligible_status");
  });

  it("rejects invoice date before podReceivedAt with 400", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRIP-001",
        status: TripStatus.EXPORTED,
        podReceivedAt: new Date("2026-11-05T00:00:00Z"),
        invoicedAt: null,
        invoiceNumber: null,
      } as any,
    ]);

    const request = new Request("http://localhost/api/trips/invoice", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC, "content-type": "application/json" },
      body: JSON.stringify({
        tripIds: ["00000000-0000-4000-8000-000000000001"],
        invoiceDate: "2026-11-02T00:00:00Z", // before POD date
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.code).toBe("invoice_before_pod");
  });

  it("handles double-submit/idempotent submission safely", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRIP-001",
        status: TripStatus.INVOICED,
        podReceivedAt: new Date("2026-11-01T00:00:00Z"),
        invoicedAt: new Date("2026-11-05T00:00:00Z"),
        invoiceNumber: "INV-123",
      } as any,
    ]);

    const request = new Request("http://localhost/api/trips/invoice", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC, "content-type": "application/json" },
      body: JSON.stringify({
        tripIds: ["00000000-0000-4000-8000-000000000001"],
        invoiceDate: "2026-11-05T00:00:00Z",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.alreadyInvoicedCount).toBe(1);
    expect(data.updatedCount).toBe(0);
  });

  it("marks exported trip as invoiced and creates audit log", async () => {
    vi.mocked(prisma.trip.findMany).mockResolvedValueOnce([
      {
        id: "00000000-0000-4000-8000-000000000001",
        tripCode: "TRIP-001",
        status: TripStatus.EXPORTED,
        podReceivedAt: new Date("2026-11-01T00:00:00Z"),
        invoicedAt: null,
        invoiceNumber: null,
      } as any,
    ]);

    const request = new Request("http://localhost/api/trips/invoice", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC, "content-type": "application/json" },
      body: JSON.stringify({
        tripIds: ["00000000-0000-4000-8000-000000000001"],
        invoiceNumber: "INV/2026-27/001",
        invoiceDate: "2026-11-05T00:00:00Z",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.updatedCount).toBe(1);
    expect(prisma.trip.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["00000000-0000-4000-8000-000000000001"] } },
      data: {
        status: TripStatus.INVOICED,
        invoicedAt: expect.any(Date),
        invoiceNumber: "INV/2026-27/001",
      },
    });
    expect(prisma.auditLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "test-billing-user-id",
          action: "TRIP_MARKED_INVOICED",
          entity: "Trip",
          entityId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    });
  });
});

