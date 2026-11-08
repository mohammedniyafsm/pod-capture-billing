import BillingReviewPage from "./BillingReview";

type SearchParams = {
  reason?: string | string[];
  branch?: string | string[];
  search?: string | string[];
  page?: string | string[];
};

export default async function ReviewRoute({
  searchParams,
}: PageProps<"/billing/review">) {
  const params = (await searchParams) as SearchParams;
  const initialFilters = {
    search: typeof params.search === "string" ? params.search : "",
    reason: typeof params.reason === "string" ? params.reason : "",
    branch: typeof params.branch === "string" ? params.branch : "",
    page: typeof params.page === "string" && Number(params.page) > 0 ? Number(params.page) : 1,
  };

  return (
    <BillingReviewPage
      initialFilters={initialFilters}
    />
  );
}
