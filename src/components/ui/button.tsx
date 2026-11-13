import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "accent" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-control)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-900 text-white hover:bg-brand-700",
  secondary: "bg-surface text-ink border border-border hover:bg-surface-muted",
  accent: "bg-accent-400 text-brand-900 hover:bg-accent-500",
  danger: "bg-danger-600 text-white hover:bg-danger-700",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-muted",
};
const sizes: Record<ButtonSize, string> = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" };

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
