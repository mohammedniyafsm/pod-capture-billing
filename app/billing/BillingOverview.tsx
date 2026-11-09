"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchJson,
  formatCurrency,
  formatNumber,
} from "@/src/lib/fleetproof";
import type { DashboardRange } from "@/src/lib/dashboard/analytics";

type Branch = { id: string; name: string };
type AgeingTrip = {
  id: string;
  tripCode: string;
  status: string;
  ageDays: number;
};
type DashboardBranch = {
  branchId: string;
  branch: string;
  avgPodToInvoiceDays: number | null;
  invoiceTargetDays: number;
  withinTarget: boolean | null;
  tripsWithoutPod: {
    total: number;
    buckets: { "0-3": number; "4-10": number; over10: number };
    trips: AgeingTrip[];
  };
};
type DashboardData = {
  range: DashboardRange;
  branch: string | null;
  from: string;
  to: string;
  timezone: "Asia/Kolkata";
  granularity: "day" | "month";
  branches: Branch[];
  statusCounts: Record<string, number>;
  series: Array<{
    period: string;
    label: string;
    delivered: number;
    podReceived: number;
    invoicedCount: number;
    podToInvoiceSampleSize: number;
    within24hCount: number;
    within24hEligible: number;
    avgPodToInvoiceDays: number | null;
  }>;
  summary: {
    deliveredCount: number;
    podReceivedCount: number;
    invoicedCount: number;
    avgPodToInvoiceDays: number | null;
    podToInvoiceSampleSize: number;
    podWithin24Hours: {
      eligible: number;
      count: number;
      percentage: number | null;
      targetPercentage: number;
    };
    invoiceTargetDays: number;
  };
  byBranch: DashboardBranch[];
};
type BillingQueueData = {
  groups: Array<{
    client: { id: string; name: string };
    count: number;
    totalAmount: number;
  }>;
};
type PanelState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string; data?: T };

const rangeOptions: Array<{ value: DashboardRange; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
];
const activeStatusOrder = [
  "ASSIGNED",
  "IN_TRANSIT",
  "POD_PENDING",
  "AI_CHECKING",
  "RETAKE_REQUESTED",
  "NEEDS_REVIEW",
  "DISPUTED",
];

const completedStatusOrder = [
  "VERIFIED",
  "EXPORTED",
  "INVOICED",
];

const statusColors: Record<string, string> = {
  ASSIGNED: "#cfd6d9",
  IN_TRANSIT: "#cfd6d9",
  POD_PENDING: "#cfd6d9",
  AI_CHECKING: "#cfd6d9",
  UNASSIGNED: "#cfd6d9",
  RETAKE_REQUESTED: "#d97706",
  NEEDS_REVIEW: "#d97706",
  DISPUTED: "#b42318",
  VERIFIED: "#15803d",
  EXPORTED: "#0B4044",
  INVOICED: "#0B4044",
};

const statusDisplayNames: Record<string, string> = {
  ASSIGNED: "Assigned",
  IN_TRANSIT: "In transit",
  POD_PENDING: "POD pending",
  AI_CHECKING: "AI checking",
  RETAKE_REQUESTED: "Retake requested",
  NEEDS_REVIEW: "Needs review",
  DISPUTED: "Disputed",
  VERIFIED: "Verified",
  EXPORTED: "Exported",
  INVOICED: "Invoiced",
  UNASSIGNED: "Unassigned",
};

function formatStatus(status: string) {
  return statusDisplayNames[status] ?? status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function dashboardDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
  }).format(new Date(value));
}

function PanelStateMessage({
  state,
  onRetry,
  empty,
}: {
  state: PanelState<unknown>;
  onRetry: () => void;
  empty?: string;
}) {
  if (state.status === "loading") {
    return (
      <div className="billing-chart" role="status" aria-label="Loading chart data">
        <div className="billing-skeleton-block h-full w-full" aria-hidden="true" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="billing-empty" role="alert">
        <p>{state.message}</p>
        <button type="button" className="billing-button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (empty) return <div className="billing-empty" role="status">{empty}</div>;
  return null;
}

function Metric({
  label,
  value,
  helper,
  state,
  onRetry,
  isAccent,
  showDot,
}: {
  label: string;
  value: string;
  helper: string;
  state: "ready" | "loading" | "error";
  onRetry: () => void;
  isAccent?: boolean;
  showDot?: boolean;
}) {
  return (
    <section className="billing-metric" aria-label={label}>
      <div className="billing-metric-label">
        <span>{label}</span>
      </div>
      {state === "loading" ? (
        <div className="billing-skeleton-block mt-3 h-8 w-24" aria-hidden="true" />
      ) : state === "error" ? (
        <button type="button" className="billing-button mt-3" onClick={onRetry}>
          Retry
        </button>
      ) : (
        <>
          <div className={`billing-metric-value${isAccent ? " is-accent" : ""}`}>
            {value}
          </div>
          <p className="billing-metric-helper">
            {showDot ? <span className="billing-metric-dot" aria-hidden="true" /> : null}
            {helper}
          </p>
        </>
      )}
    </section>
  );
}

function ChartHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="billing-panel-heading">
      <div>
        <h2 className="billing-panel-title">{title}</h2>
        <p className="billing-panel-description">{description}</p>
      </div>
    </div>
  );
}

function retryDashboard(state: PanelState<DashboardData>, retry: () => void) {
  if (state.status === "error") {
    return (
      <div className="billing-empty" role="status">
        Dashboard data is unavailable. Use the retry control above.
      </div>
    );
  }
  return <PanelStateMessage state={state} onRetry={retry} />;
}

export default function BillingOverview({
  initialRange,
  initialBranch,
}: {
  initialRange: DashboardRange;
  initialBranch: string;
}) {
  const router = useRouter();
  const [range, setRange] = useState(initialRange);
  const [branch, setBranch] = useState(initialBranch);
  const [dashboardState, setDashboardState] = useState<PanelState<DashboardData>>({
    status: "loading",
  });
  const [queueState, setQueueState] = useState<PanelState<BillingQueueData>>({
    status: "loading",
  });
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  const [queueRefresh, setQueueRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ range });
    if (branch) params.set("branch", branch);
    void fetchJson<DashboardData>(`/api/dashboard?${params}`)
      .then((data) => {
        if (active) setDashboardState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (active) {
          setDashboardState((current) => ({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load dashboard analytics.",
            data: current.data,
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [branch, dashboardRefresh, range]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    void fetchJson<BillingQueueData>(
      `/api/billing/queue${params.size ? `?${params}` : ""}`,
    )
      .then((data) => {
        if (active) setQueueState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (active) {
          setQueueState((current) => ({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load billing readiness.",
            data: current.data,
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [branch, queueRefresh]);

  const syncUrl = (nextRange: DashboardRange, nextBranch: string) => {
    const params = new URLSearchParams({ range: nextRange });
    if (nextBranch) params.set("branch", nextBranch);
    router.replace(`/billing?${params}`, { scroll: false });
  };

  const updateFilters = (nextRange: DashboardRange, nextBranch: string) => {
    setRange(nextRange);
    setBranch(nextBranch);
    setDashboardState((current) => ({
      status: "loading",
      data: current.data,
    }));
    setQueueState((current) => ({ status: "loading", data: current.data }));
    syncUrl(nextRange, nextBranch);
  };

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const rangeParam = params.get("range");
      const nextRange =
        rangeOptions.find((option) => option.value === rangeParam)?.value ?? "30d";
      const nextBranch = params.get("branch") ?? "";
      setRange(nextRange);
      setBranch(nextBranch);
      setDashboardState((current) => ({
        status: "loading",
        data: current.data,
      }));
      setQueueState((current) => ({ status: "loading", data: current.data }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const dashboard = dashboardState.data ?? null;
  const queue = queueState.data ?? null;
  const readyCount = (queue?.groups ?? []).reduce((sum, group) => sum + group.count, 0);
  const readyAmount = (queue?.groups ?? []).reduce(
    (sum, group) => sum + group.totalAmount,
    0,
  );
  const statusChartData = dashboard
    ? activeStatusOrder.map((status) => ({
        status: formatStatus(status),
        value: dashboard.statusCounts[status] ?? 0,
        color: statusColors[status],
      }))
    : [];
  const completedSummaryText = dashboard
    ? `Completed: ${completedStatusOrder
        .map(
          (status) =>
            `${formatNumber(dashboard.statusCounts[status] ?? 0)} ${formatStatus(status).toLowerCase()}`,
        )
        .join(" · ")}`
    : "";
  const onTimeTrend = dashboard?.series.map((bucket) => ({
    ...bucket,
    percentage:
      bucket.within24hEligible === 0
        ? null
        : (bucket.within24hCount / bucket.within24hEligible) * 100,
  })) ?? [];
  const oldestTrips = dashboard?.byBranch
    .flatMap((item) =>
      item.tripsWithoutPod.trips.map((trip) => ({
        ...trip,
        branch: item.branch,
      })),
    )
    .sort((left, right) => right.ageDays - left.ageDays)
    .slice(0, 6) ?? [];
  const missingPodCount =
    dashboard?.byBranch.reduce(
      (total, item) => total + item.tripsWithoutPod.total,
      0,
    ) ?? 0;
  const rangeLabel =
    rangeOptions.find((option) => option.value === range)?.label ?? "Selected range";

  const retryDashboardData = () => {
    setDashboardState((current) => ({
      status: "loading",
      data: current.data,
    }));
    setDashboardRefresh((revision) => revision + 1);
  };
  const retryQueueData = () => {
    setQueueState((current) => ({ status: "loading", data: current.data }));
    setQueueRefresh((revision) => revision + 1);
  };
  return (
    <div className="space-y-4">
      <div className="billing-page-heading">
        <div>
          <span className="billing-page-kicker">Operations</span>
          <h1 className="billing-page-title">Operations overview</h1>
          <p className="billing-page-description">
            Delivery, POD and billing performance across your branches.
          </p>
        </div>
        <button
          type="button"
          className="billing-button"
          disabled={
            dashboardState.status === "loading" ||
            queueState.status === "loading"
          }
          onClick={() => {
            retryDashboardData();
            retryQueueData();
          }}
        >
          {dashboardState.status === "loading" || queueState.status === "loading"
            ? "Refreshing data…"
            : "Refresh data"}
        </button>
      </div>

      <div className="billing-filter-bar" aria-label="Dashboard filters">
        <label className="billing-filter">
          <span className="billing-filter-label">Date range</span>
          <select
            className="billing-select"
            value={range}
            onChange={(event) =>
              updateFilters(event.target.value as DashboardRange, branch)
            }
          >
            {rangeOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="billing-filter">
          <span className="billing-filter-label">Branch</span>
          <select
            className="billing-select"
            value={branch}
            onChange={(event) => updateFilters(range, event.target.value)}
          >
            <option value="">All branches</option>
            {branch && !dashboard?.branches.some((item) => item.id === branch) ? (
              <option value={branch}>Selected branch</option>
            ) : null}
            {(dashboard?.branches ?? []).map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <p className="billing-filter-note">
          {dashboard
            ? `${dashboardDate(dashboard.from)} – ${dashboardDate(dashboard.to)} · ${dashboard.timezone}`
            : `${rangeLabel} · Asia/Kolkata`}
        </p>
      </div>

      {dashboardState.status === "error" ? (
        <section className="billing-state is-error" role="alert">
          <p>
            {dashboardState.message}
            {dashboard ? " Showing the last loaded dashboard data." : ""}
          </p>
          <button type="button" className="billing-button" onClick={retryDashboardData}>
            Retry dashboard
          </button>
        </section>
      ) : null}
      {queueState.status === "error" ? (
        <section className="billing-state is-error" role="alert">
          <p>
            {queueState.message}
            {queue ? " Showing the last loaded billing data." : ""}
          </p>
          <button type="button" className="billing-button" onClick={retryQueueData}>
            Retry billing data
          </button>
        </section>
      ) : null}

      <div
        className={`billing-metric-strip${dashboardState.status === "loading" || queueState.status === "loading" ? " is-refreshing" : ""}`}
        aria-busy={dashboardState.status === "loading" || queueState.status === "loading"}
      >
        <Metric
          label="Delivered trips awaiting POD"
          value={formatNumber(missingPodCount)}
          helper="Completed deliveries with no POD submission"
          state={dashboard ? "ready" : dashboardState.status}
          onRetry={retryDashboardData}
          isAccent={true}
          showDot={missingPodCount > 0}
        />
        <Metric
          label="Awaiting review"
          value={formatNumber(dashboard?.statusCounts.NEEDS_REVIEW)}
          helper={
            dashboard
              ? "Current status · branch filtered"
              : "Current review queue"
          }
          state={dashboard ? "ready" : dashboardState.status}
          onRetry={retryDashboardData}
        />
        <Metric
          label="Ready for billing"
          value={formatNumber(readyCount)}
          helper={
            queue
              ? `${formatCurrency(readyAmount).replace(/\.00$/, "")} verified freight · current`
              : "Current verified queue"
          }
          state={queue ? "ready" : queueState.status}
          onRetry={retryQueueData}
        />
        <Metric
          label="POD received within 24h"
          value={
            dashboard?.summary.podWithin24Hours.percentage === null ||
            !dashboard
              ? "—"
              : `${dashboard.summary.podWithin24Hours.percentage.toFixed(1)}%`
          }
          helper={
            dashboard
              ? dashboard.summary.podWithin24Hours.eligible === 0
                ? "No eligible POD receipts in this period"
                : `${formatNumber(dashboard.summary.podWithin24Hours.count)} of ${formatNumber(dashboard.summary.podWithin24Hours.eligible)} eligible · ${dashboard.summary.podWithin24Hours.targetPercentage}% target`
              : "Selected date range"
          }
          state={dashboard ? "ready" : dashboardState.status}
          onRetry={retryDashboardData}
        />
      </div>

      <div
        className={`billing-chart-grid${dashboardState.status === "loading" ? " is-refreshing" : ""}`}
        aria-busy={dashboardState.status === "loading"}
      >
        <section className="billing-panel billing-chart-panel">
          <ChartHeading
            title="PODs received within 24 hours"
            description={`Delivery-to-POD response · ${rangeLabel.toLowerCase()} · target ${dashboard?.summary.podWithin24Hours.targetPercentage ?? 80}%`}
          />
          {!dashboard ? (
            retryDashboard(dashboardState, retryDashboardData)
          ) : dashboard.series.every((bucket) => bucket.within24hEligible === 0) ? (
            <PanelStateMessage
              state={dashboardState}
              onRetry={retryDashboardData}
              empty="No POD receipts with delivery timestamps are available for this period."
            />
          ) : (
            <>
              <p className="billing-chart-summary" role="img" aria-label={`PODs received within 24 hours by ${dashboard.granularity}: ${onTimeTrend.map((bucket) => `${bucket.label}: ${bucket.within24hCount} of ${bucket.within24hEligible}${bucket.percentage === null ? "" : `, ${bucket.percentage.toFixed(1)} percent`}`).join("; ")}. Target ${dashboard.summary.podWithin24Hours.targetPercentage} percent.`}>
                {formatNumber(dashboard.summary.podWithin24Hours.count)} of{" "}
                {formatNumber(dashboard.summary.podWithin24Hours.eligible)} eligible POD receipts met the 24-hour target in this range.
              </p>
              <div className="billing-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={onTimeTrend} margin={{ top: 12, right: 20, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke="#e3e6e8" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={20} />
                    <YAxis domain={[0, 100]} tickFormatter={(value: number) => `${value}%`} tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
                    <Tooltip
                      formatter={(value, _name, props) => {
                        const payload = (props as { payload?: { within24hCount?: number; within24hEligible?: number } })?.payload;
                        const countText = payload && payload.within24hEligible !== undefined
                          ? ` (${payload.within24hCount} of ${payload.within24hEligible} PODs)`
                          : "";
                        return [
                          value === null ? "No eligible deliveries" : `${Number(value).toFixed(1)}%${countText}`,
                          "Within 24h",
                        ];
                      }}
                      contentStyle={{
                        border: "1px solid #e3e6e8",
                        borderRadius: 8,
                        fontSize: 12,
                        backgroundColor: "#ffffff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    />
                    <ReferenceLine
                      y={dashboard.summary.podWithin24Hours.targetPercentage}
                      stroke="#9aa4a9"
                      strokeDasharray="4 4"
                      label={{
                        value: `Target ${dashboard.summary.podWithin24Hours.targetPercentage}%`,
                        position: "right",
                        fill: "#5f6b72",
                        fontSize: 10,
                      }}
                    />
                    <Line
                      type="linear"
                      dataKey="percentage"
                      name="Within 24h"
                      stroke="#0B4044"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: "#0B4044" }}
                      activeDot={{ r: 4, fill: "#0B4044" }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>

        <section className="billing-panel billing-chart-panel">
          <ChartHeading
            title="Trip status pipeline"
            description="Active lifecycle stages in progression order · branch filtered"
          />
          {!dashboard ? (
            retryDashboard(dashboardState, retryDashboardData)
          ) : statusChartData.every((item) => item.value === 0) ? (
            <PanelStateMessage
              state={dashboardState}
              onRetry={retryDashboardData}
              empty="No active trips are recorded for this branch."
            />
          ) : (
            <>
              <p className="billing-chart-summary" role="img" aria-label={statusChartData.map((item) => `${item.status}: ${item.value}`).join(", ")}>
                {statusChartData.map((item) => `${item.status}: ${item.value}`).join("; ")}
              </p>
              <div className="billing-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChartData} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }}>
                    <CartesianGrid stroke="#f0f2f3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} hide={true} />
                    <YAxis
                      type="category"
                      dataKey="status"
                      width={112}
                      tick={{ fill: "#5f6b72", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(val) => [val, "Trips"]}
                      contentStyle={{
                        border: "1px solid #e3e6e8",
                        borderRadius: 8,
                        fontSize: 12,
                        backgroundColor: "#ffffff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    />
                    <Bar
                      dataKey="value"
                      name="Trips"
                      radius={[0, 4, 4, 0]}
                      label={{
                        position: "right",
                        fill: "#5f6b72",
                        fontSize: 11,
                        formatter: (val: unknown) => (Number(val) > 0 ? String(val) : ""),
                      }}
                    >
                      {statusChartData.map((item) => <Cell key={item.status} fill={item.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {completedSummaryText ? (
                <div className="px-5 pb-4 pt-1 text-[12px] text-[#5f6b72] border-t border-[#e3e6e8]/60 flex items-center justify-between">
                  <span>{completedSummaryText}</span>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="billing-panel billing-chart-panel">
          <ChartHeading
            title="Trips delivered vs PODs received"
            description={`Event counts by ${dashboard?.granularity ?? "period"} · ${rangeLabel.toLowerCase()}`}
          />
          {!dashboard ? (
            retryDashboard(dashboardState, retryDashboardData)
          ) : dashboard.series.every(
              (bucket) => bucket.delivered === 0 && bucket.podReceived === 0,
            ) ? (
            <PanelStateMessage
              state={dashboardState}
              onRetry={retryDashboardData}
              empty="No delivery or POD events are available for this period."
            />
          ) : (
            <>
              <p className="billing-chart-summary" role="img" aria-label={`Delivered and POD-received event counts: ${dashboard.series.map((bucket) => `${bucket.label}: ${bucket.delivered} delivered, ${bucket.podReceived} PODs received`).join("; ")}.`}>
                {formatNumber(dashboard.summary.deliveredCount)} delivered and{" "}
                {formatNumber(dashboard.summary.podReceivedCount)} PODs received in this range.
              </p>
              <div className="billing-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.series} margin={{ top: 12, right: 16, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke="#e3e6e8" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={20} />
                    <YAxis allowDecimals={false} tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                      contentStyle={{
                        border: "1px solid #e3e6e8",
                        borderRadius: 8,
                        fontSize: 12,
                        backgroundColor: "#ffffff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                    <Bar dataKey="delivered" name="Delivered" fill="#0B4044" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="podReceived" name="POD received" fill="#15803d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>

        <section className="billing-panel billing-chart-panel">
          <ChartHeading
            title="Average POD-to-invoice time"
            description={`Days from POD receipt to invoice · target ${dashboard?.summary.invoiceTargetDays ?? 4} days`}
          />
          {!dashboard ? (
            <PanelStateMessage state={dashboardState} onRetry={retryDashboardData} />
          ) : dashboard.series.every((bucket) => bucket.avgPodToInvoiceDays === null) ? (
            <PanelStateMessage
              state={dashboardState}
              onRetry={retryDashboardData}
              empty="No completed POD-to-invoice samples are available for this period."
            />
          ) : (
            <>
              <p className="billing-chart-summary" role="img" aria-label={`Average POD-to-invoice time by ${dashboard.granularity}: ${dashboard.series.map((bucket) => `${bucket.label}: ${bucket.avgPodToInvoiceDays === null ? "no completed samples" : `${bucket.avgPodToInvoiceDays.toFixed(1)} days across ${bucket.podToInvoiceSampleSize} valid samples`}`).join("; ")}. Target ${dashboard.summary.invoiceTargetDays} days.`}>
                Average time is{" "}
                {dashboard.summary.avgPodToInvoiceDays === null
                  ? "not available"
                  : `${dashboard.summary.avgPodToInvoiceDays.toFixed(1)} days`}{" "}
                across {formatNumber(dashboard.summary.podToInvoiceSampleSize)} completed invoice samples in this range.
              </p>
              <div className="billing-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.series} margin={{ top: 12, right: 16, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke="#e3e6e8" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={20} />
                    <YAxis tickFormatter={(value: number) => `${value}d`} tick={{ fill: "#5f6b72", fontSize: 11 }} tickLine={false} axisLine={false} width={38} />
                    <Tooltip
                      formatter={(value) => [value === null ? "No samples" : `${Number(value).toFixed(1)} days`, "Average"]}
                      contentStyle={{
                        border: "1px solid #e3e6e8",
                        borderRadius: 8,
                        fontSize: 12,
                        backgroundColor: "#ffffff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    />
                    <ReferenceLine
                      y={dashboard.summary.invoiceTargetDays}
                      stroke="#9aa4a9"
                      strokeDasharray="4 4"
                      label={{
                        value: `Target ${dashboard.summary.invoiceTargetDays}d`,
                        position: "right",
                        fill: "#5f6b72",
                        fontSize: 10,
                      }}
                    />
                    <Line
                      type="linear"
                      dataKey="avgPodToInvoiceDays"
                      name="POD to invoice"
                      stroke="#0B4044"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: "#0B4044" }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="billing-panel">
        <ChartHeading
          title="Oldest completed trips awaiting POD"
          description="Age starts when the driver completes delivery."
        />
        {!dashboard ? (
          <PanelStateMessage state={dashboardState} onRetry={retryDashboardData} />
        ) : oldestTrips.length ? (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <caption className="billing-sr-only">The six oldest completed trips without a POD submission</caption>
              <thead>
                <tr>
                  <th scope="col">Trip</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Current status</th>
                  <th scope="col" className="billing-number">Age</th>
                </tr>
              </thead>
              <tbody>
                {oldestTrips.map((trip) => (
                  <tr key={trip.id}>
                    <td className="font-medium text-neutral-900">{trip.tripCode}</td>
                    <td>{trip.branch}</td>
                    <td><span className="billing-status is-warning">{formatStatus(trip.status)}</span></td>
                    <td className="billing-number font-medium">{formatNumber(trip.ageDays)} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="billing-empty">No completed trips are awaiting POD submission.</div>
        )}
      </section>
      <p className="billing-dashboard-updated">
        Dashboard events use their recorded delivery, POD receipt, or invoice timestamp.{" "}
        {dashboard ? `Range: ${dashboardDate(dashboard.from)} to ${dashboardDate(dashboard.to)}.` : ""}
      </p>
    </div>
  );
}
