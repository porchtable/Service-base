/** Role → capability matrix. Mirrors docs/ARCHITECTURE.md §3 and the RLS policies. */
export type Role = "owner" | "admin" | "technician";

export const PERMISSIONS = {
  "customer.create": ["owner", "admin", "technician"],
  "customer.update": ["owner", "admin", "technician"],
  "customer.archive": ["owner", "admin"],
  "job.create": ["owner", "admin", "technician"],
  "job.manage": ["owner", "admin"],
  "job.update_assigned": ["owner", "admin", "technician"],
  "job.attach": ["owner", "admin", "technician"],
  "pricebook.manage": ["owner", "admin"],
  "estimate.draft": ["owner", "admin", "technician"],
  "estimate.approve": ["owner", "admin"],
  "estimate.send": ["owner", "admin"],
  "estimate.revoke": ["owner", "admin"],
  "followup.manage": ["owner", "admin"],
  "org.settings": ["owner", "admin"],
  "member.invite": ["owner", "admin"],
  "member.manage_roles": ["owner"],
  "billing.manage": ["owner"],
  "data.export": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", technician: "Technician" };
