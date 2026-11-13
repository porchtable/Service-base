import Link from "next/link";
import type { DashboardData } from "@/server/domain/dashboard";

function Metric({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</p>
    </>
  );
  const cls = "block rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm";
  return href ? <Link href={href} className={`${cls} hover:border-brand-300`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Metric label="Total customers" value={data.totalCustomers} href="/app/customers" />
      <Metric label="Team members" value={data.teamMembers} href="/app/settings/team" />
    </div>
  );
}
