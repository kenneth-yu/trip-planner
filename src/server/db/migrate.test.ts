import path from "node:path";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { withEmptyDatabase } from "./test-db";
import * as schema from "./schema";

const url = process.env.TEST_DATABASE_URL;
const migrationsFolder = path.join(process.cwd(), "drizzle");

describe.skipIf(!url)("drizzle migrate on an empty postgres database", () => {
  it("applies every checked-in migration and records each one", async () => {
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    await withEmptyDatabase(url, async (databaseUrl) => {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        await migrate(drizzle(pool, { schema }), { migrationsFolder });
        const applied = await pool.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
        const tables = await pool.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('users', 'trips', 'auth_sessions')",
        );
        expect(applied.rows[0]?.n).toBe(readMigrationFiles({ migrationsFolder }).length);
        expect(tables.rows).toHaveLength(3);
      } finally {
        await pool.end();
      }
    });
  });
});
