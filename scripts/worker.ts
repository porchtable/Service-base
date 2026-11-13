/**
 * Long-running background worker (alternative to the HTTP cron endpoint), e.g. on
 * a VM, container or Railway/Fly/Render worker:
 *
 *   npm run worker
 *
 * Runs `processFollowUps` every WORKER_INTERVAL_SECONDS (default 60). Several
 * workers can run at once; jobs are claimed with FOR UPDATE SKIP LOCKED.
 * Requires the same server environment variables as the web app.
 */
import "dotenv/config";
import { processFollowUps } from "@/server/jobs/follow-ups";
import { db } from "@/server/db/client";

const intervalMs = Math.max(15, Number(process.env.WORKER_INTERVAL_SECONDS ?? 60)) * 1000;
let stopping = false;

async function tick() {
  try {
    const s = await processFollowUps({ limit: 50, workerId: `worker-${process.pid}` });
    if (s.claimed || s.expired) console.log(new Date().toISOString(), JSON.stringify(s));
  } catch (err) {
    console.error(new Date().toISOString(), "worker tick failed", err);
  }
}

async function main() {
  console.log(`worker started (every ${intervalMs / 1000}s)`);
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await db().end();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; });
main();
