import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";
const badgeTones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-border",
  success: "bg-success-50 text-success-700 border-success-700/20",
  warning: "bg-warning-50 text-warning-700 border-warning-700/20",
  danger: "bg-danger-50 text-danger-700 border-danger-700/20",
  info: "bg-info-50 text-info-700 border-info-700/20",
  accent: "bg-accent-100 text-accent-700 border-accent-500/30",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", badgeTones[tone])}>{children}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: Exclude<Tone, "neutral" | "accent">; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] border px-4 py-3 text-sm", badgeTones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back ? <div className="mb-2 text-sm">{back}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-transparent" aria-hidden />
      {label}…
    </div>
  );
}
