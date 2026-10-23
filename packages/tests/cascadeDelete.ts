// FK-aware teardown for fixtures: a test that creates a row through a real *DB method (a user_discoteca copy, an auction bid, a trade...) shouldn't have to remember to delete it before its fixture parent can go.
import { db } from "@girae/database/index";
import { sql, type SQL } from "drizzle-orm";

type Ref = { tbl: string; col: string; refCol: string };

const refCache = new Map<string, Ref[]>();
const MAX_DEPTH = 6;
const FK_VIOLATION = '23503';

async function refsTo(table: string): Promise<Ref[]> {
  const cached = refCache.get(table);
  if (cached) return cached;

  // single-column FKs only - composite ones can't be expressed as `col IN (subquery)`
  const result = await db.execute<{ tbl: string; col: string; refcol: string }>(sql`
    SELECT cl.relname AS tbl, a.attname AS col, ra.attname AS refcol
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.confrelid = to_regclass(${table})
  `);
  const refs = result.rows.map(r => ({ tbl: r.tbl, col: r.col, refCol: r.refcol }));
  refCache.set(table, refs);
  return refs;
}

// deletes rows matching `where` plus everything that references them, children first.
export async function deleteCascade(table: string, where: SQL, path: string[] = []): Promise<void> {
  if (path.length > MAX_DEPTH) throw new Error(`deleteCascade: FK chain too deep at ${[...path, table].join(' > ')}`);
  const nextPath = [...path, table];

  for (const ref of await refsTo(table)) {
    // a table already on the path is a cycle - skip it rather than loop forever
    if (nextPath.includes(ref.tbl)) continue;
    const childWhere = sql`${sql.identifier(ref.col)} IN (SELECT ${sql.identifier(ref.refCol)} FROM ${sql.identifier(table)} WHERE ${where})`;
    await deleteCascade(ref.tbl, childWhere, nextPath);
  }

  await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${where}`);
}

const isFkViolation = (e: unknown) =>
  ((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === FK_VIOLATION;

// plain delete first (the common case, one query); only a blocked FK pays for the cascade walk.
export async function deleteById(table: string, id: number): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE id = ${id}`);
  } catch (e) {
    if (!isFkViolation(e)) throw e;
    await deleteCascade(table, sql`id = ${id}`);
  }
}
