import "server-only";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "validation" | "conflict" | "rate_limited" | "configuration" | "unauthenticated",
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new AppError("forbidden", msg);
export const conflict = (msg: string) => new AppError("conflict", msg);
export const invalid = (msg: string, fieldErrors?: Record<string, string[]>) => new AppError("validation", msg, fieldErrors);

/** Translate low-level errors into safe, user-facing AppErrors. Never leaks SQL or secrets. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return invalid("Please correct the highlighted fields", fieldErrors);
  }
  const pg = err as { code?: string; message?: string; name?: string };
  if (pg && typeof pg.code === "string") {
    switch (pg.code) {
      case "42501": return forbidden();
      case "23505": return conflict("A record with these details already exists");
      case "23503": return invalid("A related record is missing or belongs to another organization");
      case "23514": return invalid(pg.message?.includes("check constraint") ? "One or more values are out of range" : (pg.message ?? "Invalid value"));
      case "22P02": return invalid("Invalid identifier or value");
      case "P0002": return notFound();
      case "P0001": return invalid(pg.message ?? "Operation not allowed");
    }
  }
  if (pg?.name === "ConfigurationError") return new AppError("configuration", pg.message ?? "Integration not configured");
  return new AppError("validation", "Something went wrong. Please try again.");
}

import type { ActionResult } from "@/lib/action-result";
export type { ActionResult };

/** Wrap a server action body: converts thrown errors into a safe ActionResult. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    // Next.js control-flow errors (redirect/notFound) must propagate.
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR"))) {
      throw err;
    }
    const appErr = toAppError(err);
    if (!(err instanceof AppError) && !(err instanceof ZodError) && !(err as { code?: string })?.code) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[action-error ${ref}]`, err);
      return { ok: false, code: appErr.code, error: `Something went wrong (ref ${ref}). Please try again.` };
    }
    return { ok: false, code: appErr.code, error: appErr.message, fieldErrors: appErr.fieldErrors };
  }
}
