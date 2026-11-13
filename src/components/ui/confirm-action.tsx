"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonVariant } from "./button";
import { Alert } from "./feedback";

/**
 * A button that opens an accessible confirmation dialog, then invokes a server
 * action with the given hidden fields.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "secondary",
  confirmVariant = "danger",
  size = "md",
  children,
}: {
  action: (prev: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  fields: Record<string, string>;
  label: string;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  confirmVariant?: ButtonVariant;
  size?: "sm" | "md";
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => { setError(null); dialog.current?.showModal(); }}>
        {label}
      </Button>
      <dialog ref={dialog} aria-labelledby="confirm-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-brand-950/50">
        <form
          className="space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            for (const [k, v] of Object.entries(fields)) fd.set(k, v);
            start(async () => {
              const res = await action({ ok: true }, fd);
              if (res.ok) dialog.current?.close();
              else setError(res.error);
            });
          }}
        >
          <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
          {description ? <div className="text-sm text-ink-muted">{description}</div> : null}
          {children}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()} disabled={pending}>Cancel</Button>
            <Button type="submit" variant={confirmVariant} disabled={pending} aria-busy={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
