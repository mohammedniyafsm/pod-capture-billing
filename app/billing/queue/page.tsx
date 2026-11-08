import BillingQueuePage from "./BillingQueue";

type SearchParams = {
  client?: string | string[];
  cycle?: string | string[];
  branch?: string | string[];
};

export default async function BillingQueueRoute({
  searchParams,
}: PageProps<"/billing/queue">) {
  const params = (await searchParams) as SearchParams;
  const initialFilters = {
    client: typeof params.client === "string" ? params.client : "",
    cycle: typeof params.cycle === "string" ? params.cycle : "",
    branch: typeof params.branch === "string" ? params.branch : "",
  };

  return (
    <BillingQueuePage
      initialFilters={initialFilters}
    />
  );
}
