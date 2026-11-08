export function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="fp-driver-info-card">
      <div className="fp-driver-info-label">{label}</div>
      <div className="fp-driver-info-value">{value}</div>
    </div>
  );
}
