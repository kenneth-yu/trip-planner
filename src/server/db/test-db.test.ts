import { describe, expect, it } from "vitest";
import { createIsolatedPostgresDb, schemaExists, type IsolatedDb } from "./test-db";
import { users } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("isolated postgres test databases", () => {
  const open = async (): Promise<IsolatedDb> => {
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    return createIsolatedPostgresDb(url);
  };

  it("gives each context its own migrated schema", async () => {
    const a = await open();
    const b = await open();
    expect(a.schemaName).not.toEqual(b.schemaName);
    await a.db.insert(users).values({ email: "ada@example.test", name: "Ada" });
    expect(await a.db.select().from(users)).toHaveLength(1);
    expect(await b.db.select().from(users)).toHaveLength(0);
  });

  it("drops the schema on close", async () => {
    const a = await open();
    if (!url) throw new Error("TEST_DATABASE_URL is not set");
    expect(await schemaExists(url, a.schemaName)).toBe(true);
    await a.close();
    expect(await schemaExists(url, a.schemaName)).toBe(false);
  });
});
