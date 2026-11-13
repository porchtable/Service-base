"use client";
import { createContext, startTransition, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Alert } from "./feedback";

interface FormCtx {
  fieldErrors: Record<string, string[]>;
  pending: boolean;
}
const FormContext = createContext<FormCtx>({ fieldErrors: {}, pending: false });

export function useFormContext() {
  return use(FormContext);
}

const initial: ActionResult<unknown> = { ok: true };

/**
 * Submits a server action without React's automatic form reset, so a failed
 * validation keeps the user's input. Field components read errors by name.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showSuccess = true,
  onSuccess,
  encType,
}: {
  action: (prev: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  onSuccess?: (result: ActionResult<unknown>) => void;
  encType?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  const lastHandled = useRef<ActionResult<unknown> | null>(null);

  useEffect(() => {
    if (state === initial || lastHandled.current === state) return;
    lastHandled.current = state;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  return (
    <FormContext value={{ fieldErrors: !state.ok ? state.fieldErrors ?? {} : {}, pending }}>
      <form
        ref={ref}
        className={className}
        encType={encType}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => dispatch(fd));
        }}
        aria-busy={pending}
      >
        {!state.ok ? (
          <div className="mb-4">
            <Alert tone="danger">{state.error}</Alert>
          </div>
        ) : state !== initial && showSuccess && state.message ? (
          <div className="mb-4">
            <Alert tone="success">{state.message}</Alert>
          </div>
        ) : null}
        {children}
      </form>
    </FormContext>
  );
}
