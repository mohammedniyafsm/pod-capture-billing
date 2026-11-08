import { TripStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionDriverTrip } from "./driverLifecycle";

const mocks = vi.hoisted(() => {
  const transaction = {
    trip: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    },
  };
});

vi.mock("../../prisma", () => ({ prisma: mocks.prisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("driver trip lifecycle", () => {
  it("starts only an assigned trip and records the server timestamp", async () => {
    const now = new Date("2026-11-04T08:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.transaction.trip.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.auditLog.create.mockResolvedValue({});

    await expect(
      transitionDriverTrip("trip-1", "driver-1", "start"),
    ).resolves.toEqual({
      ok: true,
      status: TripStatus.IN_TRANSIT,
      timestamp: now,
    });
    expect(mocks.transaction.trip.updateMany).toHaveBeenCalledWith({
      where: {
        id: "trip-1",
        driverId: "driver-1",
        status: TripStatus.ASSIGNED,
      },
      data: { status: TripStatus.IN_TRANSIT, startedAt: now },
    });
    expect(mocks.transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: "driver-1",
        action: "TRIP_STARTED",
        entity: "Trip",
        entityId: "trip-1",
      },
    });
  });

  it("completes only an in-transit trip and records the server timestamp", async () => {
    const now = new Date("2026-11-04T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.transaction.trip.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.auditLog.create.mockResolvedValue({});

    await expect(
      transitionDriverTrip("trip-1", "driver-1", "complete"),
    ).resolves.toEqual({
      ok: true,
      status: TripStatus.POD_PENDING,
      timestamp: now,
    });
    expect(mocks.transaction.trip.updateMany).toHaveBeenCalledWith({
      where: {
        id: "trip-1",
        driverId: "driver-1",
        status: TripStatus.IN_TRANSIT,
      },
      data: { status: TripStatus.POD_PENDING, deliveredAt: now },
    });
  });

  it("returns not-found for trips not owned by the driver", async () => {
    mocks.transaction.trip.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.trip.findFirst.mockResolvedValue(null);

    await expect(
      transitionDriverTrip("trip-1", "driver-1", "start"),
    ).resolves.toEqual({ ok: false, code: "trip_not_found" });
    expect(mocks.transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a repeated or out-of-order transition with the current status", async () => {
    mocks.transaction.trip.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.trip.findFirst.mockResolvedValue({
      status: TripStatus.POD_PENDING,
    });

    await expect(
      transitionDriverTrip("trip-1", "driver-1", "complete"),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_transition",
      currentStatus: TripStatus.POD_PENDING,
    });
    expect(mocks.transaction.auditLog.create).not.toHaveBeenCalled();
  });
});
