import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { LinkButton } from "@/components/ui/button";
import { centsToInput } from "@/lib/money";
import type { PriceBookItem } from "@/server/domain/pricebook";
import type { ActionResult } from "@/lib/action-result";

export function PriceBookForm({ action, item, categories }: {
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  item?: PriceBookItem;
  categories: string[];
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Service name" name="name" required defaultValue={item?.name} className="sm:col-span-2"
          hint="Use clear names — AI matching uses the name, category and description." />
        <TextField label="Category" name="category" defaultValue={item?.category ?? ""} list="pb-categories" />
        <datalist id="pb-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <TextField label="SKU / code" name="sku" defaultValue={item?.sku ?? ""} />
        <TextField label="Unit price ($)" name="unitPrice" inputMode="decimal" required defaultValue={item ? centsToInput(item.unitPriceCents) : ""} />
        <TextField label="Unit" name="unit" required defaultValue={item?.unit ?? "each"} hint="e.g. each, hour, ft, lb" />
        <SelectField label="Tax" name="taxClass" defaultValue={item?.taxClass ?? "taxable"}>
          <option value="taxable">Taxable</option>
          <option value="non_taxable">Not taxable</option>
        </SelectField>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="isActive" defaultChecked={item ? item.isActive : true} className="h-4 w-4" />
            Active (available for new estimates)
          </label>
        </div>
        <TextAreaField label="Description" name="description" defaultValue={item?.description ?? ""} className="sm:col-span-2"
          hint="Shown on estimates when this item is used." />
      </div>
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…">{item ? "Save changes" : "Add item"}</SubmitButton>
        <LinkButton href="/app/price-book">Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
