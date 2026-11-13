/**
 * Explicitly grant (or revoke) platform administration. There is no in-app way to
 * become a platform administrator.
 *
 *   DATABASE_URL=... npm run grant-platform-admin -- operator@example.com [--revoke]
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const revoke = process.argv.includes("--revoke");
  if (!email || !process.env.DATABASE_URL) {
    console.error("usage: DATABASE_URL=... npm run grant-platform-admin -- <email> [--revoke]");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const [user] = await sql`select id from auth.users where lower(email) = lower(${email})`;
    if (!user) throw new Error(`No user with email ${email}. They must register first.`);
    if (revoke) {
      await sql`delete from public.platform_administrators where user_id = ${user.id}`;
      console.log(`Revoked platform administration from ${email}`);
    } else {
      await sql`insert into public.platform_administrators (user_id, note) values (${user.id}, 'granted via CLI') on conflict do nothing`;
      await sql`insert into public.audit_events (actor_type, action, entity_type, entity_id) values ('system', 'platform.admin_granted', 'user', ${user.id})`;
      console.log(`Granted platform administration to ${email}`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
