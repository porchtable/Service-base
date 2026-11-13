"use client";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { useFormContext } from "./action-form";

const control =
  "block w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-surface-muted aria-[invalid=true]:border-danger-600";

interface FieldProps {
  label: string;
  name: string;
  hint?: ReactNode;
  errors?: string[];
  required?: boolean;
  className?: string;
}

function FieldShell({ label, name, hint, errors, required, className, children }: FieldProps & { children: ReactNode }) {
  const errId = errors?.length ? `${name}-error` : undefined;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={name} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger-600" aria-hidden> *</span> : null}
      </label>
      {children}
      {hint && !errId ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
      {errId ? (
        <p id={errId} className="text-xs text-danger-700" role="alert">
          {errors!.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function useErrors(name: string, explicit?: string[]) {
  const ctx = useFormContext();
  return explicit ?? ctx.fieldErrors[name];
}

export function TextField({ label, name, hint, errors: explicit, required, className, ...input }: FieldProps & Omit<ComponentProps<"input">, "name">) {
  const errors = useErrors(name, explicit);
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors} required={required} className={className}>
      <input id={name} name={name} required={required} aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${name}-error` : undefined} className={control} {...input} />
    </FieldShell>
  );
}

export function TextAreaField({ label, name, hint, errors: explicit, required, className, ...input }: FieldProps & Omit<ComponentProps<"textarea">, "name">) {
  const errors = useErrors(name, explicit);
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors} required={required} className={className}>
      <textarea id={name} name={name} required={required} aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${name}-error` : undefined} className={cn(control, "min-h-24")} {...input} />
    </FieldShell>
  );
}

export function SelectField({ label, name, hint, errors: explicit, required, className, children, ...input }: FieldProps & Omit<ComponentProps<"select">, "name">) {
  const errors = useErrors(name, explicit);
  return (
    <FieldShell label={label} name={name} hint={hint} errors={errors} required={required} className={className}>
      <select id={name} name={name} required={required} aria-invalid={errors?.length ? true : undefined} className={control} {...input}>
        {children}
      </select>
    </FieldShell>
  );
}

export const controlClass = control;
