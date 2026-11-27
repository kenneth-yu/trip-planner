import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";
import type { Db } from "./client";

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface IsolatedDb {
  db: Db;
  schemaName: string;
  close: () => Promise<void>;
}

export function assertSafeTestDatabaseUrl(url: string, productionUrl: string | undefined): void {
  if (productionUrl !== undefined && url === productionUrl) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL");
  }
  const parsed = URL.parse(url);
  if (!parsed) throw new Error("TEST_DATABASE_URL is not a valid URL");
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error("TEST_DATABASE_URL must point at localhost or the CI service");
  if (!parsed.pathname.slice(1).endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test");
}

async function withAdminPool<T>(url: string, run: (pool: Pool) => Promise<T>): Promise<T> {
  const admin = new Pool({ connectionString: url, max: 1 });
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

const open = new Set<() => Promise<void>>();

export async function closeIsolatedPostgresDbs(): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [...open]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

async function migrateInOneTransaction(pool: Pool, schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS })) {
      for (const statement of migration.sql) await client.query(statement.replaceAll(`"public".`, `"${schemaName}".`));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createIsolatedPostgresDb(url: string): Promise<IsolatedDb> {
  assertSafeTestDatabaseUrl(url, process.env.DATABASE_URL);
  const schemaName = `t_${randomUUID().replaceAll("-", "")}`;
  await withAdminPool(url, (admin) => admin.query(`CREATE SCHEMA "${schemaName}"`));
  const pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${schemaName}` });
  const close = async () => {
    open.delete(close);
    await pool.end();
    await withAdminPool(url, (admin) => admin.query(`DROP SCHEMA "${schemaName}" CASCADE`));
  };
  open.add(close);
  try {
    await migrateInOneTransaction(pool, schemaName);
  } catch (error) {
    await close();
    throw error;
  }
  return { db: drizzle(pool, { schema }), schemaName, close };
}

export async function schemaExists(url: string, schemaName: string): Promise<boolean> {
  return withAdminPool(url, async (pool) => {
    const result = await pool.query("select 1 from information_schema.schemata where schema_name = $1", [schemaName]);
    return result.rowCount === 1;
  });
}

export async function withEmptyDatabase<T>(url: string, run: (databaseUrl: string) => Promise<T>): Promise<T> {
  assertSafeTestDatabaseUrl(url, process.env.DATABASE_URL);
  const name = `m_${randomUUID().replaceAll("-", "")}_test`;
  await withAdminPool(url, (admin) => admin.query(`CREATE DATABASE "${name}"`));
  const target = new URL(url);
  target.pathname = `/${name}`;
  try {
    return await run(target.toString());
  } finally {
    await withAdminPool(url, (admin) => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`));
  }
}
