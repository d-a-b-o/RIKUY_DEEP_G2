export function CompanyStatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        active ? "border-ok/40 bg-ok/10 text-ok" : "border-border bg-surface text-muted-foreground"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-ok" : "bg-muted-foreground"}`} />
      {active ? "Activa" : "Desactivada"}
    </span>
  );
}
