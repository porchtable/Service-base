export function formatCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}

export function formatAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p && p.trim()).join(", ");
}

export function humanize(action: string): string {
  return action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
