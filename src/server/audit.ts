import "server-only";
import type { Tx } from "@/server/db/client";
import type { TenantCtx } from "@/server/auth/tenant-context";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Append an audit event as the acting user (runs inside the caller's RLS transaction). */
export async function audit(
  tx: Tx,
  ctx: TenantCtx,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, JsonValue> = {},
): Promise<void> {
  await tx`
    insert into public.audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
    values (${ctx.organizationId}, ${ctx.userId}, 'user', ${action}, ${entityType}, ${entityId}, ${tx.json(metadata)})`;
}

/** Audit from privileged contexts (customer decisions, webhooks, worker, platform admin). */
export async function auditSystem(
  tx: Tx,
  args: {
    organizationId: string | null;
    actorType: "customer" | "system" | "platform_admin" | "stripe";
    actorUserId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string | null;
    metadata?: Record<string, JsonValue>;
    ipAddress?: string | null;
  },
): Promise<void> {
  await tx`
    insert into public.audit_events (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata, ip_address)
    values (${args.organizationId}, ${args.actorUserId ?? null}, ${args.actorType}, ${args.action},
            ${args.entityType ?? null}, ${args.entityId ?? null}, ${tx.json(args.metadata ?? {})}, ${args.ipAddress ?? null})`;
}
