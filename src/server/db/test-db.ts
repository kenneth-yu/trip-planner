import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";
import type { Db } from "./client";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

export interface IsolatedDb {
  db: Db;
  schemaName: string;
  close: () => Promise<void>;
}

const open = new Set<() => Promise<void>>();

export async function closeIsolatedPostgresDbs(): Promise<void> {
  await Promise.all([...open].map((close) => close()));
}

export async function createIsolatedPostgresDb(url: string): Promise<IsolatedDb> {
  const schemaName = `t_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schemaName}` });
  for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS })) {
    for (const statement of migration.sql) await pool.query(statement.replaceAll(`"public".`, `"${schemaName}".`));
  }
  const close = async () => {
    open.delete(close);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin.end();
  };
  open.add(close);
  return { db: drizzle(pool, { schema }), schemaName, close };
}

export async function schemaExists(url: string, schemaName: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await pool.query("select 1 from information_schema.schemata where schema_name = $1", [schemaName]);
    return result.rowCount === 1;
  } finally {
    await pool.end();
  }
}
