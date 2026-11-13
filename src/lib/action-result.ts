export type ActionErrorCode = "not_found" | "forbidden" | "validation" | "conflict" | "rate_limited" | "configuration" | "unauthenticated";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code: ActionErrorCode; fieldErrors?: Record<string, string[]> };
