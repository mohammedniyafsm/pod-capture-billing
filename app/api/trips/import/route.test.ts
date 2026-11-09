import { describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { POST } from "./route";
import { prisma } from "../../../../src/lib/prisma";

vi.mock("../../../../src/lib/auth/rbac/requireRole", () => ({
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

vi.mock("../../../../src/lib/pods/links/uploadLinks", () => ({
  createUploadLinkInTransaction: vi.fn(async () => ({ token: "mock-token-123" })),
}));

vi.mock("../../../../src/lib/prisma", () => {
  return {
    prisma: {
      client: {
        findMany: vi.fn(async () => [
          { id: "c1", name: "Sahyadri Cements Ltd" },
        ]),
      },
      branch: {
        findMany: vi.fn(async () => [
          { id: "b1", name: "Pune" },
        ]),
      },
      trip: {
        findMany: vi.fn(async () => [
          { id: "t0", tripCode: "EXISTING-TRIP", clientId: "c1", lrNumber: "EXISTING-LR" },
        ]),
        create: vi.fn(async ({ data }) => ({ id: "new-trip-id", ...data })),
      },
      vehicle: {
        upsert: vi.fn(async ({ create }) => ({ ...create, defaultDriver: null })),
      },
      user: {
        findUnique: vi.fn(async () => null),
      },
      smsOutbox: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        return cb(prisma);
      }),
    },
  };
});

const CSV_HEADER = "trip_code,client,vehicle_no,is_hired,origin,destination,freight,lr_number,eway_bill_no,goods,quantity,unit,branch,driver_phone";

describe("POST /api/trips/import", () => {
  it("rejects non-BILLING_EXEC with 403", async () => {
    const req = new Request("http://localhost/api/trips/import", {
      method: "POST",
      headers: { "x-mock-role": "DRIVER" },
      body: `${CSV_HEADER}\nTRIP-1,Sahyadri Cements Ltd,MH20 1234,false,Pune,Mumbai,10000,LR-1,123456789012,Cement,10,tonnes,Pune,9000000001`,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns preview results without saving when preview=true", async () => {
    const csvContent = `${CSV_HEADER}
TRIP-101,Sahyadri Cements Ltd,MH20 1234,false,Pune,Mumbai,10000,LR-101,123456789012,Cement,10,tonnes,Pune,9000000001
EXISTING-TRIP,Sahyadri Cements Ltd,MH20 1234,false,Pune,Mumbai,10000,LR-102,123456789012,Cement,10,tonnes,Pune,9000000001
TRIP-103,Unknown Client,MH20 1234,false,Pune,Mumbai,10000,LR-103,123456789012,Cement,10,tonnes,Pune,9000000001`;

    const req = new Request("http://localhost/api/trips/import?preview=true", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC },
      body: csvContent,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preview).toBe(true);
    expect(data.counts.ready).toBe(1);
    expect(data.counts.duplicates).toBe(1);
    expect(data.counts.errors).toBe(1);
    expect(prisma.trip.create).not.toHaveBeenCalled();
  });

  it("rejects formula injection rows in preview", async () => {
    const csvContent = `${CSV_HEADER}
TRIP-101,Sahyadri Cements Ltd,MH20 1234,false,Pune,Mumbai,10000,LR-101,123456789012,=cmd|' /C calc'!A0,10,tonnes,Pune,9000000001`;

    const req = new Request("http://localhost/api/trips/import?preview=true", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC },
      body: csvContent,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts.errors).toBe(1);
    expect(data.errors[0].reason).toContain("Formula injection detected");
  });

  it("confirms import, handles hired upload link, and creates audit log", async () => {
    const csvContent = `${CSV_HEADER}
TRIP-HIRED-1,Sahyadri Cements Ltd,MH20 9999,true,Pune,Goa,15000,LR-HIRED-1,123456789012,Steel,20,tonnes,Pune,9876543210`;

    const req = new Request("http://localhost/api/trips/import", {
      method: "POST",
      headers: { "x-mock-role": UserRole.BILLING_EXEC },
      body: csvContent,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.imported).toBe(1);
    expect(prisma.trip.create).toHaveBeenCalled();
    expect(prisma.smsOutbox.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "TRIPS_IMPORTED",
        }),
      }),
    );
  });
});

