import { BillingCycle } from "@prisma/client";

export interface BillingWindow {
  label: string;
  start: Date;
  end: Date;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getBillingWindow(date: Date, cycle: BillingCycle): BillingWindow {
  const day = dateOnly(date);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth();

  if (cycle === BillingCycle.WEEKLY) {
    const start = new Date(day);
    const mondayOffset = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return {
      label: `WEEKLY-${start.toISOString().slice(0, 10)}`,
      start,
      end,
    };
  }

  if (cycle === BillingCycle.FORTNIGHTLY) {
    const halfStart = day.getUTCDate() <= 15 ? 1 : 16;
    const start = new Date(Date.UTC(year, month, halfStart));
    const end =
      halfStart === 1
        ? new Date(Date.UTC(year, month, 16))
        : new Date(Date.UTC(year, month + 1, 1));
    return {
      label: `FORTNIGHTLY-${start.toISOString().slice(0, 10)}`,
      start,
      end,
    };
  }

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return {
    label: `MONTHLY-${start.toISOString().slice(0, 10)}`,
    start,
    end,
  };
}

export function getCycleStartForLabel(label: string): Date | null {
  const match = /^(?:WEEKLY|FORTNIGHTLY|MONTHLY)-(\d{4}-\d{2}-\d{2})$/.exec(
    label,
  );
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
