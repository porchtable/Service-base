"use client";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button, type ButtonVariant } from "./button";
import { useFormContext } from "./action-form";

export function SubmitButton({ children, pendingLabel, variant = "primary", ...props }: ComponentProps<"button"> & { pendingLabel?: string; variant?: ButtonVariant; size?: "sm" | "md" }) {
  const status = useFormStatus();
  const form = useFormContext();
  const pending = status.pending || form.pending;
  return (
    <Button type="submit" variant={variant} disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
