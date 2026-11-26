import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

async function createPostgresDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const db = drizzle(new Pool({ connectionString: url }), { schema });
  if (process.env.MIGRATE_ON_START !== "false") await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

declare global {
  var __tripDb: Promise<Db> | undefined;
}

export function getDb(): Promise<Db> {
  globalThis.__tripDb ??= process.env.DATABASE_URL
    ? createPostgresDb(process.env.DATABASE_URL)
    : createPgliteDb(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  return globalThis.__tripDb;
}
