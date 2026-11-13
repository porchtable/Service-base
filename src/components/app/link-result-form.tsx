"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/feedback";
import type { ActionResult } from "@/lib/action-result";

/** Runs an action that returns a one-time customer link and displays it once. */
export function LinkResultForm({ action, children, className }: {
  action: (p: ActionResult<unknown>, fd: FormData) => Promise<ActionResult<unknown>>;
  children: ReactNode;
  className?: string;
}) {
  const [result, setResult] = useState<{ link: string; emailQueued: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  return (
    <div className="space-y-3">
      <ActionForm action={action} className={className} showSuccess={false}
        onSuccess={(r) => { setCopied(false); setResult((r.ok ? r.data : null) as { link: string; emailQueued: boolean } | null); }}>
        {children}
      </ActionForm>
      {result ? (
        <Alert tone="success" title={result.emailQueued ? "Sent — email queued for delivery" : "Customer link created"}>
          <p>Share this secure link with the customer. It is shown only once; you can create a new one later.</p>
          <p className="mt-2 break-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink" data-testid="customer-link">{result.link}</p>
          <div className="mt-2 flex gap-4">
            <button type="button" className="text-sm font-medium underline"
              onClick={() => navigator.clipboard?.writeText(result.link).then(() => setCopied(true))}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" className="text-sm font-medium underline" onClick={() => { setResult(null); router.refresh(); }}>
              Done
            </button>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
