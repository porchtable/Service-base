import "server-only";
import postgres from "postgres";
import { env } from "@/server/env";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/** int8 → number, refusing values that would lose precision. */
export function parseSafeBigint(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("bigint value exceeds safe integer range");
  return n;
}

const globalForDb = globalThis as unknown as { __fsaSql?: Sql };

/**
 * Single connection pool per server instance. Use the Supabase *transaction*
 * pooler URL in serverless deployments; prepared statements are disabled for
 * pooler compatibility. All tenant-scoped settings use SET LOCAL semantics
 * (transaction-scoped), which is safe with transaction pooling.
 */
export function db(): Sql {
  if (!globalForDb.__fsaSql) {
    const e = env();
    globalForDb.__fsaSql = postgres(e.DATABASE_URL, {
      max: e.DATABASE_POOL_MAX,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      types: {
        bigint: {
          to: 20,
          from: [20],
          serialize: (v: number | bigint) => String(v),
          parse: parseSafeBigint,
        },
      },
      transform: { undefined: null },
    });
  }
  return globalForDb.__fsaSql;
}
