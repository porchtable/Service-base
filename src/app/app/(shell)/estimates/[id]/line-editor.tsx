import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge } from "@/components/ui/feedback";
import { formatCents } from "@/lib/format";
import { centsToInput } from "@/lib/money";
import type { EstimateLine } from "@/server/domain/estimates";
import type { PriceBookItem } from "@/server/domain/pricebook";
import { deleteLineAction, updateLineAction } from "@/app/app/_actions/estimates";

const SOURCE_LABEL = { ai: "AI draft", manual: "Manual", price_book: "Price book" } as const;

export function LineEditor({ line, index, estimateId, priceBook, manager }: {
  line: EstimateLine;
  index: number;
  estimateId: string;
  priceBook: PriceBookItem[];
  manager: boolean;
}) {
  const id = `line-${line.id}`;
  return (
    <li className={`rounded-[var(--radius-control)] border p-4 ${line.needsReview || line.unitPriceCents === null ? "border-warning-700/40 bg-warning-50" : "border-border bg-surface"}`}
      aria-label={`Line ${index + 1}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">Line {index + 1}</span>
          <Badge>{SOURCE_LABEL[line.source]}</Badge>
          {line.unitPriceCents === null ? <Badge tone="danger">Missing price</Badge> : null}
          {line.needsReview ? <Badge tone="warning">Needs review</Badge> : null}
        </div>
        <span className="text-sm font-semibold tabular-nums text-ink">{formatCents(line.lineTotalCents)}</span>
      </div>
      {line.reviewReason ? <p className="mb-3 text-sm text-warning-700">{line.reviewReason}</p> : null}
      <ActionForm action={updateLineAction} className="grid gap-3 sm:grid-cols-6" showSuccess={false}>
        <input type="hidden" name="lineId" value={line.id} />
        <input type="hidden" name="estimateId" value={estimateId} />
        <TextAreaField label="Description" name="description" defaultValue={line.description} rows={2} className="sm:col-span-6" id={`${id}-desc`} />
        <TextField label={`Quantity (${line.unit})`} name="quantity" inputMode="decimal" defaultValue={line.quantity} className="sm:col-span-1" id={`${id}-qty`} />
        <SelectField label="Price book item" name="priceBookItemId" defaultValue={line.priceBookItemId ?? ""} className="sm:col-span-3" id={`${id}-pb`}>
          <option value="">{line.priceBookItemId ? "—" : "Not linked to the price book"}</option>
          {priceBook.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatCents(p.unitPriceCents)}/{p.unit}</option>)}
        </SelectField>
        {manager ? (
          <>
            <TextField label="Unit price ($)" name="unitPrice" inputMode="decimal" className="sm:col-span-2" id={`${id}-price`}
              defaultValue={line.unitPriceCents === null ? "" : centsToInput(line.unitPriceCents)}
              hint="Owner/admin only. A custom price unlinks the price book item." />
            <input type="hidden" name="originalUnitPrice" value={line.unitPriceCents === null ? "" : centsToInput(line.unitPriceCents)} />
          </>
        ) : (
          <div className="text-sm sm:col-span-2">
            <p className="font-medium text-ink">Unit price</p>
            <p className="mt-2 text-ink-muted">{line.unitPriceCents === null ? "Needs a price book item" : formatCents(line.unitPriceCents)}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
          {manager && line.needsReview ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="markReviewed" className="h-4 w-4" /> I reviewed this line
            </label>
          ) : null}
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">Save line</SubmitButton>
        </div>
      </ActionForm>
      <div className="mt-2 flex justify-end">
        <ConfirmAction action={deleteLineAction} fields={{ lineId: line.id, estimateId }} size="sm" variant="ghost" label="Remove line"
          title="Remove this line?" confirmLabel="Remove" description={line.description} />
      </div>
    </li>
  );
}
