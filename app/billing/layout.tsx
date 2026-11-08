import "./billing.css";
import BillingWorkspace from "./BillingWorkspace";

export default function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <BillingWorkspace>{children}</BillingWorkspace>;
}
