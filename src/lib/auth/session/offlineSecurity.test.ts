import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { requireRole } from "../rbac/requireRole";

describe("Security review: offline session metadata and backend authorization", () => {
  it("rejects unauthorized requests when only client-side metadata is sent without a valid session cookie", async () => {
    const requireDriver = requireRole(UserRole.DRIVER);

    // Simulated request with client-spoofed local session metadata in headers or body
    const req = new Request("http://localhost:3000/api/my-trips", {
      method: "GET",
      headers: {
        "x-fake-user-id": "spoofed-driver-id",
        "x-fake-role": "DRIVER",
      },
    });

    const auth = await requireDriver(req);
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
    }
  });

  it("rejects request if session has an invalid role or signature", async () => {
    const requireDriver = requireRole(UserRole.DRIVER);

    const req = new Request("http://localhost:3000/api/my-trips", {
      method: "GET",
      headers: {
        cookie: "fp_session=invalid.tampered.token",
      },
    });

    const auth = await requireDriver(req);
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
    }
  });
});

