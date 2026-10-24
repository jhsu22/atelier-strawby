export type Value = string | number | null;
export interface Statement {
  sql: string;
  params: Value[];
}
export interface Store {
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: Value[],
  ): Promise<T[]>;
  batch(statements: Statement[]): Promise<void>;
}
export const statement = (sql: string, ...params: Value[]): Statement => ({
  sql,
  params,
});
export function d1Store(binding: D1Database): Store {
  return {
    async all<T extends Record<string, unknown>>(
      sql: string,
      params: Value[] = [],
    ) {
      return (
        await binding
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results;
    },
    async batch(statements) {
      if (statements.length)
        await binding.batch(
          statements.map((s) => binding.prepare(s.sql).bind(...s.params)),
        );
    },
  };
}
export async function revision(db: Store) {
  return Number(
    (await db.all("SELECT revision FROM collection_state WHERE id=1"))[0]
      ?.revision ?? 0,
  );
}
// A failed CHECK aborts the entire atomic D1 batch, including catalog changes.
export const revisionGuard = (expected: number, increment = true) =>
  statement(
    "UPDATE collection_state SET revision=CASE WHEN revision=? THEN revision+? ELSE -1 END WHERE id=1",
    expected,
    increment ? 1 : 0,
  );
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
