import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./test-db";

const safe = "postgres://postgres:pw@localhost:5432/trip_test";

describe("test database safety guard", () => {
  it("accepts a local database whose name ends in _test", () => {
    expect(() => assertSafeTestDatabaseUrl(safe, undefined)).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@127.0.0.1/app_test", "postgres://u:p@db.example.com/app")).not.toThrow();
  });

  it("refuses the production database url", () => {
    expect(() => assertSafeTestDatabaseUrl(safe, safe)).toThrow("must not equal DATABASE_URL");
  });

  it("refuses a database name that does not end in _test", () => {
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@localhost/trips", undefined)).toThrow("ending in _test");
  });

  it("refuses a remote host even when the name ends in _test", () => {
    expect(() => assertSafeTestDatabaseUrl("postgres://u:p@db.example.com/trips_test", undefined)).toThrow("localhost");
  });

  it("refuses text that is not a url", () => {
    expect(() => assertSafeTestDatabaseUrl("not a url", undefined)).toThrow("not a valid URL");
  });
});
