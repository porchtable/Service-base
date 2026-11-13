import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/context";
import { getEstimate } from "@/server/domain/estimates";
import { listPriceBook } from "@/server/domain/pricebook";
import { getOrganization } from "@/server/domain/organizations";
import { AppError } from "@/server/errors";
import { can } from "@/lib/permissions";
import { formatCents, formatDateTime } from "@/lib/format";
import { Alert, PageHeader } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkResultForm } from "@/components/app/link-result-form";
import { EstimateStatusBadge, ESTIMATE_STATUS_LABELS } from "@/components/app/estimate-status";
import {
  addManualLineAction, addPriceBookLineAction, approveAction, createLinkAction, deleteEstimateAction, generateWithAiAction,
  reopenAction, revokeLinksAction, reviseAction, saveDraftDetailsAction, sendAction,
} from "@/app/app/_actions/estimates";
import { LineEditor } from "./line-editor";
import { EstimateFollowUps } from "./follow-ups";

export const metadata: Metadata = { title: "Estimate" };

function TotalsCard({ v }: { v: { subtotalCents: number; taxableSubtotalCents: number; taxCents: number; totalCents: number; taxRateBps: number } }) {
  return (
    <Card>
      <CardHeader title="Totals" description="Calculated on the server from line items and your tax rate." />
      <CardBody>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums" data-testid="subtotal">{formatCents(v.subtotalCents)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Tax ({(v.taxRateBps / 100).toFixed(2)}% on {formatCents(v.taxableSubtotalCents)})</dt><dd className="tabular-nums" data-testid="tax">{formatCents(v.taxCents)}</dd></div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="total">{formatCents(v.totalCents)}</dd></div>
        </dl>
      </CardBody>
    </Card>
  );
}

export default async function EstimatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const sp = await searchParams;
  const e = await getEstimate(ctx, id, sp.version).catch((err) => { if (err instanceof AppError) notFound(); throw err; });
  const v = e.version;
  const isCurrent = v.id === e.currentVersionId;
  const manager = can(ctx.role, "estimate.approve");
  const editable = v.status === "draft" && isCurrent;
  const [priceBook, org] = await Promise.all([editable ? listPriceBook(ctx, { status: "active" }) : Promise.resolve([]), getOrganization(ctx)]);
  const unresolved = v.lines.filter((l) => l.needsReview || l.unitPriceCents === null).length;
  const hidden = { estimateId: e.id, versionId: v.id };

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2"><span className="text-ink-subtle">Estimate #{e.estimateNumber}</span> {e.title} <EstimateStatusBadge status={v.status} /></span>}
        description={<>
          <Link href={`/app/customers/${e.customer.id}`} className="text-brand-500 hover:underline">{e.customer.name}</Link>
          {" · "}
          <Link href={`/app/jobs/${e.job.id}`} className="text-brand-500 hover:underline">Job #{e.job.number}</Link>
          {" · "}Version {v.versionNumber}{isCurrent ? "" : " (older version)"}
        </>}
        back={<Link href="/app/estimates" className="text-brand-500 hover:underline">← Estimates</Link>}
        actions={<>
          {isCurrent && ["sent", "declined", "expired"].includes(v.status) && (manager || v.status !== "sent") ? (
            <ConfirmAction action={reviseAction} fields={hidden} label="Revise" confirmVariant="primary" confirmLabel="Create revision"
              title="Create a new version?"
              description={v.status === "sent"
                ? "The sent version will be marked superseded and its customer links will stop working. Your changes go into a new draft that must be approved and sent again."
                : "A new draft version will be created from this one. The previous version stays in the history unchanged."} />
          ) : null}
          {manager && e.versions.every((x) => x.status === "draft") ? (
            <ConfirmAction action={deleteEstimateAction} fields={hidden} label="Delete" title="Delete this draft estimate?" confirmLabel="Delete"
              description="Drafts that were never approved or sent can be deleted permanently." />
          ) : null}
        </>}
      />

      {!isCurrent ? <div className="mb-4"><Alert tone="info">You are viewing version {v.versionNumber} ({ESTIMATE_STATUS_LABELS[v.status]}). <Link className="underline" href={`/app/estimates/${e.id}`}>View the current version</Link>.</Alert></div> : null}
      {v.status === "approved" ? <div className="mb-4"><Alert tone="info" title="Approved — not yet sent">Approved by {v.approvedByName ?? "an admin"} on {formatDateTime(v.approvedAt, org.timezone)}. Content is locked.</Alert></div> : null}
      {v.decision ? (
        <div className="mb-4">
          <Alert tone={v.decision.decision === "accepted" ? "success" : "danger"} title={v.decision.decision === "accepted" ? "Accepted by the customer" : "Declined by the customer"}>
            {v.decision.signerName ? <>Signed by <strong>{v.decision.signerName}</strong> </> : null}on {formatDateTime(v.decision.createdAt, org.timezone)}.
            {v.decision.comment ? <p className="mt-1">Comment: “{v.decision.comment}”</p> : null}
            {v.decision.decision === "accepted" ? <p className="mt-1 text-xs">This is the customer&apos;s approval of the estimate, not a payment.</p> : null}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {editable ? (
            <Card>
              <CardHeader title="Draft with AI" description="Describe what was found. AI proposes lines using only your price book; anything without an approved price is flagged." />
              <CardBody className="space-y-3">
                {v.aiStatus === "failed" ? <Alert tone="warning" title="Last AI attempt failed">{v.aiError} Your notes below were kept.</Alert> : null}
                {v.aiStatus === "succeeded" && v.aiWarnings.length > 0 ? (
                  <Alert tone="info" title="AI notes for the reviewer"><ul className="list-disc pl-5">{v.aiWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Alert>
                ) : null}
                <ActionForm action={generateWithAiAction} className="space-y-3">
                  <input type="hidden" name="estimateId" value={e.id} />
                  <input type="hidden" name="versionId" value={v.id} />
                  <TextAreaField label="Technician notes and required work" name="technicianNotes" rows={6} defaultValue={v.technicianNotes ?? ""} required
                    hint="Saved before the AI runs, so nothing is lost if drafting fails." />
                  <SubmitButton variant="accent" pendingLabel="Drafting… this can take up to a minute">Draft line items with AI</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={`Line items (${v.lines.length})`}
              description={editable && unresolved > 0 ? `${unresolved} line${unresolved === 1 ? "" : "s"} need${unresolved === 1 ? "s" : ""} a price or review before approval.` : undefined} />
            <CardBody className="space-y-4">
              {editable ? (
                <>
                  {v.lines.length === 0 ? <p className="text-sm text-ink-muted">No line items yet. Draft with AI or add lines below.</p> : (
                    <ol className="space-y-3">{v.lines.map((l, i) => <LineEditor key={l.id} line={l} index={i} estimateId={e.id} priceBook={priceBook} manager={manager} />)}</ol>
                  )}
                  <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                    <ActionForm action={addPriceBookLineAction} className="space-y-3" resetOnSuccess showSuccess={false}>
                      <input type="hidden" name="estimateId" value={e.id} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <p className="text-sm font-semibold text-ink">Add from price book</p>
                      {priceBook.length === 0 ? <p className="text-sm text-ink-muted">Your price book has no active items. <Link className="underline" href="/app/price-book">Add some</Link>.</p> : (
                        <>
                          <SelectField label="Item" name="priceBookItemId" id="add-pb-item" defaultValue="" required>
                            <option value="" disabled>Choose…</option>
                            {priceBook.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatCents(p.unitPriceCents)}/{p.unit}</option>)}
                          </SelectField>
                          <TextField label="Quantity" name="quantity" id="add-pb-qty" defaultValue="1" inputMode="decimal" />
                          <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">Add item</SubmitButton>
                        </>
                      )}
                    </ActionForm>
                    <ActionForm action={addManualLineAction} className="space-y-3" resetOnSuccess showSuccess={false}>
                      <input type="hidden" name="estimateId" value={e.id} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <p className="text-sm font-semibold text-ink">Add a custom line</p>
                      <TextField label="Description" name="description" id="add-manual-desc" required />
                      <div className="grid grid-cols-2 gap-3">
                        <TextField label="Quantity" name="quantity" id="add-manual-qty" defaultValue="1" inputMode="decimal" />
                        <TextField label="Unit" name="unit" id="add-manual-unit" defaultValue="each" />
                      </div>
                      <SelectField label="Tax" name="taxClass" id="add-manual-tax" defaultValue="taxable">
                        <option value="taxable">Taxable</option>
                        <option value="non_taxable">Not taxable</option>
                      </SelectField>
                      {manager ? <TextField label="Unit price ($)" name="unitPrice" id="add-manual-price" inputMode="decimal" hint="Leave empty to flag for pricing." /> : (
                        <p className="text-xs text-ink-subtle">Custom lines are flagged until an owner or admin sets the price.</p>
                      )}
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">Add line</SubmitButton>
                    </ActionForm>
                  </div>
                </>
              ) : v.lines.length === 0 ? <p className="text-sm text-ink-muted">No line items.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="text-left text-ink-muted"><tr>
                      <th scope="col" className="py-2 pr-2 font-medium">Description</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Unit price</th>
                      <th scope="col" className="py-2 pl-2 text-right font-medium">Amount</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {v.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-2 pr-2 text-ink">{l.description}{l.taxClass === "non_taxable" ? <span className="text-ink-subtle"> (not taxed)</span> : null}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{l.quantity} {l.unit}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatCents(l.unitPriceCents)}</td>
                          <td className="py-2 pl-2 text-right tabular-nums">{formatCents(l.lineTotalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {editable ? (
            <Card>
              <CardHeader title="Estimate details" />
              <CardBody>
                <ActionForm action={saveDraftDetailsAction} className="space-y-4">
                  <input type="hidden" name="estimateId" value={e.id} />
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="technicianNotes" value={v.technicianNotes ?? ""} />
                  <TextField label="Title" name="title" defaultValue={e.title} required />
                  <TextAreaField label="Scope of work (shown to the customer)" name="customerSummary" defaultValue={v.customerSummary ?? ""} rows={4}
                    hint="Review any AI-written text. Don't promise warranties or prices here; your company terms are added automatically." />
                  <TextAreaField label="Internal notes" name="internalNotes" defaultValue={v.internalNotes ?? ""} hint="Never shown to the customer." />
                  {manager ? <TextField label="Tax rate for this estimate (%)" name="taxRatePercent" inputMode="decimal" defaultValue={(v.taxRateBps / 100).toFixed(2)} /> : null}
                  <SubmitButton variant="secondary" pendingLabel="Saving…">Save details</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Scope of work" />
              <CardBody><p className="whitespace-pre-wrap text-sm text-ink">{v.customerSummary || "—"}</p>
                {v.internalNotes ? <p className="mt-3 text-sm text-ink-muted"><strong>Internal:</strong> {v.internalNotes}</p> : null}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <TotalsCard v={v} />

          {editable && manager ? (
            <Card>
              <CardHeader title="Approval" />
              <CardBody className="space-y-3">
                {unresolved > 0 || v.lines.length === 0 ? (
                  <Alert tone="warning">{v.lines.length === 0 ? "Add at least one line item." : `Resolve ${unresolved} flagged or unpriced line${unresolved === 1 ? "" : "s"} first.`}</Alert>
                ) : (
                  <ActionForm action={approveAction}>
                    <input type="hidden" name="estimateId" value={e.id} />
                    <input type="hidden" name="versionId" value={v.id} />
                    <p className="mb-3 text-sm text-ink-muted">Approving locks this version so it can be sent. Total: <strong>{formatCents(v.totalCents)}</strong>.</p>
                    <SubmitButton pendingLabel="Approving…">Approve estimate</SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}
          {editable && !manager ? <Alert tone="info">An owner or admin will review, approve and send this estimate.</Alert> : null}

          {v.status === "approved" && isCurrent && manager ? (
            <Card>
              <CardHeader title="Send to customer" description={`Valid for ${org.estimateValidityDays} days from sending.`} />
              <CardBody className="space-y-3">
                <LinkResultForm action={sendAction} className="space-y-3">
                  <input type="hidden" name="estimateId" value={e.id} />
                  <input type="hidden" name="versionId" value={v.id} />
                  {e.customer.email ? (
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" name="sendEmail" defaultChecked className="h-4 w-4" /> Email it to {e.customer.email}
                    </label>
                  ) : <p className="text-sm text-ink-muted">This customer has no email address; you&apos;ll get a link to share.</p>}
                  <SubmitButton variant="accent" pendingLabel="Sending…">Send estimate</SubmitButton>
                </LinkResultForm>
                <ConfirmAction action={reopenAction} fields={hidden} size="sm" variant="ghost" label="Reopen for editing" confirmVariant="primary"
                  title="Reopen this estimate?" confirmLabel="Reopen" description="It returns to draft and must be approved again before sending." />
              </CardBody>
            </Card>
          ) : null}

          {v.sentAt ? (
            <Card>
              <CardHeader title="Customer access" />
              <CardBody className="space-y-3 text-sm">
                <p className="text-ink-muted">Sent {formatDateTime(v.sentAt, org.timezone)}{v.sentByName ? ` by ${v.sentByName}` : ""}. {v.status === "sent" ? "Expires" : "Expiry"}: {formatDateTime(v.expiresAt, org.timezone)}.</p>
                {manager && v.links.length > 0 ? (
                  <ul className="space-y-1 text-xs text-ink-muted">
                    {v.links.map((l) => (
                      <li key={l.id}>Link created {formatDateTime(l.createdAt, org.timezone)} — {l.revokedAt ? "revoked" : new Date(l.expiresAt) <= new Date() ? "expired" : l.lastUsedAt ? `last opened ${formatDateTime(l.lastUsedAt, org.timezone)}` : "not opened yet"}</li>
                    ))}
                  </ul>
                ) : null}
                {manager && v.status === "sent" && isCurrent ? (
                  <>
                    <LinkResultForm action={createLinkAction}>
                      <input type="hidden" name="estimateId" value={e.id} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Creating…">Create a new customer link</SubmitButton>
                    </LinkResultForm>
                    <ConfirmAction action={revokeLinksAction} fields={hidden} size="sm" label="Revoke all links" confirmLabel="Revoke links"
                      title="Revoke all customer links?" description="Existing links stop working immediately. You can create a new link afterwards." />
                  </>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <EstimateFollowUps ctx={ctx} versionId={v.id} status={v.status} timeZone={org.timezone} estimateId={e.id} />

          <Card>
            <CardHeader title="Version history" />
            <ul className="divide-y divide-border">
              {e.versions.map((x) => (
                <li key={x.id}>
                  <Link href={`/app/estimates/${e.id}?version=${x.id}`} aria-current={x.id === v.id ? "true" : undefined}
                    className={`flex items-center justify-between gap-2 px-5 py-2 text-sm hover:bg-surface-muted ${x.id === v.id ? "bg-brand-50" : ""}`}>
                    <span>v{x.versionNumber} · {ESTIMATE_STATUS_LABELS[x.status]}</span>
                    <span className="tabular-nums text-ink-muted">{formatCents(x.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
