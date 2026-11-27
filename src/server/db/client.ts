import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { sealLegacyRows } from "../crypto/backfill";
import { assertDataKey } from "../crypto/sealed";
import { serverEnv } from "../env";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const POOL_SIZE = 3;
const POOL_IDLE_MS = 10_000;

async function migratedPglite(dataDir?: string) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS });
  return client;
}

let migratedSnapshot: Promise<Blob> | undefined;

async function takeMigratedSnapshot(): Promise<Blob> {
  const template = await migratedPglite();
  const snapshot = await template.dumpDataDir("none");
  await template.close();
  return snapshot;
}

async function migratedInMemorySnapshot(): Promise<Blob> {
  migratedSnapshot ??= takeMigratedSnapshot();
  try {
    return await migratedSnapshot;
  } catch (e) {
    migratedSnapshot = undefined;
    throw e;
  }
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = dataDir ? await migratedPglite(dataDir) : new PGlite({ loadDataDir: await migratedInMemorySnapshot() });
  return drizzle(client, { schema });
}

export async function createPostgresDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(new Pool({ connectionString: url, max: POOL_SIZE, idleTimeoutMillis: POOL_IDLE_MS }), { schema });
}

declare global {
  var __tripDb: Promise<Db> | undefined;
}

async function openDb(): Promise<Db> {
  const env = serverEnv();
  assertDataKey();
  const db = env.databaseUrl
    ? await createPostgresDb(env.databaseUrl)
    : await createPgliteDb(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  const sealed = await sealLegacyRows(db);
  if (sealed.itemPrivate + sealed.activity + sealed.imported > 0) console.error("sealed legacy rows", sealed);
  return db;
}

async function openDbOrForget(): Promise<Db> {
  try {
    return await openDb();
  } catch (e) {
    globalThis.__tripDb = undefined;
    throw e;
  }
}

export function getDb(): Promise<Db> {
  globalThis.__tripDb ??= openDbOrForget();
  return globalThis.__tripDb;
}
