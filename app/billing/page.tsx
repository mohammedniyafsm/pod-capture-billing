import BillingOverview from "./BillingOverview";

type SearchParams = {
  range?: string | string[];
  branch?: string | string[];
};

function isRange(value: string | undefined): value is "7d" | "30d" | "6m" | "12m" {
  return value === "7d" || value === "30d" || value === "6m" || value === "12m";
}

export const instant = false;

export default async function BillingOverviewPage({
  searchParams,
}: PageProps<"/billing">) {
  const params = await searchParams as SearchParams;
  const rangeValue = typeof params.range === "string" ? params.range : undefined;
  const branch = typeof params.branch === "string" ? params.branch : "";

  return (
    <BillingOverview
      initialRange={isRange(rangeValue) ? rangeValue : "30d"}
      initialBranch={branch}
    />
  );
}
