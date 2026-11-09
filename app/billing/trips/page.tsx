import TripsManagementPage from "./TripsManagement";

export const instant = false;

type SearchParams = {
  search?: string | string[];
  clientId?: string | string[];
  branchId?: string | string[];
  vehicleType?: string | string[];
  podStatus?: string | string[];
  preset?: string | string[];
  from?: string | string[];
  to?: string | string[];
  page?: string | string[];
};

export default async function TripsRoute({
  searchParams,
}: PageProps<"/billing/trips">) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const initialFilters = {
    search: typeof params.search === "string" ? params.search : "",
    clientId: typeof params.clientId === "string" ? params.clientId : "",
    branchId: typeof params.branchId === "string" ? params.branchId : "",
    vehicleType:
      typeof params.vehicleType === "string" ? params.vehicleType : "ALL",
    podStatus: typeof params.podStatus === "string" ? params.podStatus : "",
    preset: typeof params.preset === "string" ? params.preset : "ALL",
    from: typeof params.from === "string" ? params.from : "",
    to: typeof params.to === "string" ? params.to : "",
    page:
      typeof params.page === "string" && Number(params.page) > 0
        ? Number(params.page)
        : 1,
  };

  return <TripsManagementPage initialFilters={initialFilters} />;
}

