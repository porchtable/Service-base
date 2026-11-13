import type { Metadata } from "next";
import { loadCustomerEstimate } from "@/server/domain/customer-estimates";
import { rateLimit } from "@/server/ratelimit";
import { clientIp } from "@/server/request";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { Alert } from "@/components/ui/feedback";
import { DecisionForms } from "./decision-forms";
import { decideAction } from "./actions";

export const metadata: Metadata = { title: "Estimate", robots: { index: false, follow: false }, referrer: "no-referrer" };

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
    </main>
  );
}

export default async function CustomerEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await rateLimit("estimateView", await clientIp()))) {
    return <Unavailable title="Too many requests" body="Please wait a few minutes and try again." />;
  }
  const view = await loadCustomerEstimate(token);
  if (view.kind === "unavailable") {
    return <Unavailable title="This estimate link is not available" body="The link may have expired, been replaced by a newer version, or been withdrawn. Please contact the company that sent it for an updated link." />;
  }
  const s = view.snapshot;
  const tz = s.organization.timezone;
  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <p className="text-lg font-semibold">{s.organization.name}</p>
          <p className="text-sm text-brand-100">{[s.organization.phone, s.organization.email, s.organization.website].filter(Boolean).join(" · ")}</p>
          {s.organization.address ? <p className="text-sm text-brand-100">{s.organization.address}</p> : null}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-subtle">Estimate #{s.estimate.number}{s.estimate.version > 1 ? ` (revision ${s.estimate.version})` : ""}</p>
              <h1 className="text-2xl font-semibold text-ink">{s.estimate.title}</h1>
            </div>
            <div className="text-right text-sm text-ink-muted">
              <p>Issued {formatDate(s.estimate.issuedAt, tz)}</p>
              <p>Valid until {formatDate(s.estimate.expiresAt, tz)}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div><p className="font-medium text-ink">Prepared for</p><p className="text-ink-muted">{s.customer.name}{s.customer.companyName ? `, ${s.customer.companyName}` : ""}</p>{s.customer.address ? <p className="text-ink-muted">{s.customer.address}</p> : null}</div>
            {s.job.serviceAddress ? <div><p className="font-medium text-ink">Service location</p><p className="text-ink-muted">{s.job.serviceAddress}</p></div> : null}
          </div>
          {s.estimate.summary ? <div className="mt-6"><h2 className="text-sm font-semibold text-ink">Scope of work</h2><p className="mt-1 whitespace-pre-wrap text-sm text-ink">{s.estimate.summary}</p></div> : null}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-border text-left text-ink-muted"><tr>
                <th scope="col" className="py-2 pr-2 font-medium">Description</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Price</th>
                <th scope="col" className="py-2 pl-2 text-right font-medium">Amount</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {s.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-2 text-ink">{l.description}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{l.quantity} {l.unit}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatCents(l.unit_price_cents)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{formatCents(l.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{formatCents(s.totals.subtotal_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">Tax ({(s.totals.tax_rate_bps / 100).toFixed(2)}%)</dt><dd className="tabular-nums">{formatCents(s.totals.tax_cents)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="customer-total">{formatCents(s.totals.total_cents)}</dd></div>
          </dl>
          {s.terms ? <div className="mt-6 border-t border-border pt-4"><h2 className="text-sm font-semibold text-ink">Terms</h2><p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{s.terms}</p></div> : null}
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-8">
          {view.decision ? (
            <Alert tone={view.decision.decision === "accepted" ? "success" : "info"} title={view.decision.decision === "accepted" ? "You accepted this estimate" : "You declined this estimate"}>
              Recorded {formatDateTime(view.decision.createdAt, tz)}{view.decision.signerName ? ` — ${view.decision.signerName}` : ""}. Your response is now visible to {s.organization.name}.
            </Alert>
          ) : view.status === "expired" ? (
            <Alert tone="warning" title="This estimate has expired">Please contact {s.organization.name} for an updated estimate.</Alert>
          ) : view.canDecide ? (
            <>
              <h2 className="mb-4 text-lg font-semibold text-ink">Your response</h2>
              <DecisionForms token={token} total={formatCents(s.totals.total_cents)} action={decideAction} />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
