import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { failureMessage } from "../src/server/script-failure";

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is not set, so there is no database to migrate. On Vercel, connect the Neon database to this environment.\n");
  process.exit(1);
}

let exitCode = 0;
try {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    process.stdout.write("Migrations are up to date.\n");
  } finally {
    await pool.end();
  }
} catch (e) {
  process.stderr.write(failureMessage("Migration", e));
  exitCode = 1;
}
process.exit(exitCode);
