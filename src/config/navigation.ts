import type { Permission } from "@/lib/permissions";

/**
 * Main navigation. Only routes that are implemented are listed; each entry may be
 * restricted to roles holding a permission.
 */
export const NAV: Array<{ href: string; label: string; requires?: Permission }> = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/jobs", label: "Jobs" },
  { href: "/app/price-book", label: "Price book" },
  { href: "/app/settings", label: "Company settings", requires: "org.settings" },
  { href: "/app/settings/team", label: "Team" },
];
