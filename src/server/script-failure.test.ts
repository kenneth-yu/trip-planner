import { describe, expect, it } from "vitest";
import { SealError } from "./crypto/sealed";
import { SetupError } from "./env";
import { failureMessage } from "./script-failure";

describe("script failure message", () => {
  it("names the task and a driver code, nothing else", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432 hunter2"), { code: "ECONNREFUSED" });
    const wrapped = new Error('Failed query: select * from "users" where email = $1 params: a@b.test', { cause: driver });
    const message = failureMessage("Migration", wrapped);
    expect(message).toContain("Migration failed (ECONNREFUSED)");
    for (const leak of ["10.1.2.3", "hunter2", "select", "a@b.test"]) expect(message).not.toContain(leak);
  });

  it("omits a code that does not look like one", () => {
    const odd = Object.assign(new Error("x"), { code: "postgres://u:p@host/db" });
    expect(failureMessage("Seeding", odd)).not.toContain("postgres");
    expect(failureMessage("Seeding", "plain")).toContain("Seeding failed.");
  });

  it("keeps the fixed setup hints, which hold no values", () => {
    expect(failureMessage("Import", new SetupError("AUTH_SECRET is not set"))).toBe("AUTH_SECRET is not set\n");
    expect(failureMessage("Import", new SealError("DATA_ENCRYPTION_KEY is not set"))).toBe("DATA_ENCRYPTION_KEY is not set\n");
  });
});
