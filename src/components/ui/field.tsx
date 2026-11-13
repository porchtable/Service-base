"use client";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { useFormContext } from "./action-form";

const control =
  "block w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-surface-muted aria-[invalid=true]:border-danger-600";

interface FieldProps {
  label: string;
  name: string;
  /** Defaults to `name`; set when the same field name appears several times on a page. */
  id?: string;
  hint?: ReactNode;
  errors?: string[];
  required?: boolean;
  className?: string;
}

function FieldShell({ label, fieldId, hint, errors, required, className, children }: Omit<FieldProps, "name" | "id"> & { fieldId: string; children: ReactNode }) {
  const errId = errors?.length ? `${fieldId}-error` : undefined;
  const hintId = hint && !errId ? `${fieldId}-hint` : undefined;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger-600" aria-hidden> *</span> : null}
      </label>
      {children}
      {hintId ? <p id={hintId} className="text-xs text-ink-subtle">{hint}</p> : null}
      {errId ? <p id={errId} className="text-xs text-danger-700" role="alert">{errors!.join(" ")}</p> : null}
    </div>
  );
}

function useField(name: string, id: string | undefined, explicit: string[] | undefined, hint: ReactNode) {
  const ctx = useFormContext();
  const errors = explicit ?? ctx.fieldErrors[name];
  const fieldId = id ?? name;
  const describedBy = errors?.length ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return { errors, fieldId, a11y: { "aria-invalid": errors?.length ? true : undefined, "aria-describedby": describedBy } };
}

export function TextField({ label, name, id, hint, errors: explicit, required, className, ...input }: FieldProps & Omit<ComponentProps<"input">, "name" | "id">) {
  const f = useField(name, id, explicit, hint);
  return (
    <FieldShell label={label} fieldId={f.fieldId} hint={hint} errors={f.errors} required={required} className={className}>
      <input id={f.fieldId} name={name} required={required} {...f.a11y} className={control} {...input} />
    </FieldShell>
  );
}

export function TextAreaField({ label, name, id, hint, errors: explicit, required, className, ...input }: FieldProps & Omit<ComponentProps<"textarea">, "name" | "id">) {
  const f = useField(name, id, explicit, hint);
  return (
    <FieldShell label={label} fieldId={f.fieldId} hint={hint} errors={f.errors} required={required} className={className}>
      <textarea id={f.fieldId} name={name} required={required} {...f.a11y} className={cn(control, "min-h-20")} {...input} />
    </FieldShell>
  );
}

export function SelectField({ label, name, id, hint, errors: explicit, required, className, children, ...input }: FieldProps & Omit<ComponentProps<"select">, "name" | "id">) {
  const f = useField(name, id, explicit, hint);
  return (
    <FieldShell label={label} fieldId={f.fieldId} hint={hint} errors={f.errors} required={required} className={className}>
      <select id={f.fieldId} name={name} required={required} {...f.a11y} className={control} {...input}>
        {children}
      </select>
    </FieldShell>
  );
}

export const controlClass = control;
