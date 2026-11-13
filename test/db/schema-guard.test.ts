import { afterAll, describe, expect, it } from "vitest";
import { adminSql } from "../support/db";

afterAll(async () => {
  await adminSql.end();
});

/** Structural security checks over the whole schema, so new tables can't silently skip them. */
describe("schema security guard", () => {
  it("enables RLS on every table in public", async () => {
    const rows = await adminSql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("grants anon nothing on public tables", async () => {
    const rows = await adminSql`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'`;
    expect(rows).toEqual([]);
  });

  it("grants authenticated only the intended privileges on sensitive tables", async () => {
    const rows = await adminSql`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
      group by table_name order by table_name`;
    const grants = Object.fromEntries(rows.map((r) => [r.table_name, r.privs]));
    expect(grants.estimate_decisions).toBe("SELECT");
    expect(grants.platform_administrators).toBe("SELECT");
    expect(grants.rate_limit_buckets).toBeUndefined();
    expect(grants.estimate_access_tokens).toBe("INSERT,SELECT,UPDATE");
    for (const [table, privs] of Object.entries(grants)) {
      expect(privs, table).not.toMatch(/TRUNCATE|REFERENCES|TRIGGER/);
    }
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const rows = await adminSql`
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'app')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`;
    expect(rows.map((r) => r.fn)).toEqual([]);
  });

  it("has an index starting with the columns of every foreign key", async () => {
    const rows = await adminSql`
      select c.conrelid::regclass::text || '.' || c.conname as fk from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)`;
    expect(rows.map((r) => r.fk)).toEqual([]);
  });

  it("does not expose helper functions to anon", async () => {
    const rows = await adminSql`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')`;
    expect(rows).toEqual([]);
  });
});
