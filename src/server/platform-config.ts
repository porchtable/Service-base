import "server-only";
import { withService } from "@/server/db/service";

export const CONFIG_KEYS = {
  enforceSubscription: "billing.enforce_subscription",
  aiDrafting: "features.ai_drafting",
  signup: "features.signup",
  workerLastRun: "worker.last_run",
} as const;

export async function getConfigBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    const [row] = await withService((tx) => tx`select value from public.platform_config where key = ${key}`);
    return typeof row?.value === "boolean" ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function recordWorkerRun(): Promise<void> {
  await withService((tx) => tx`
    insert into public.platform_config (key, value) values (${CONFIG_KEYS.workerLastRun}, ${tx.json(new Date().toISOString())})
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
}
