import { describe, expect, it } from "vitest";
import { isRemoteDatabase, looksLikeProduction, parseServerEnv, SetupError } from "./env";

const secrets = {
  AUTH_SECRET: "auth-secret-value-0000000000000000000",
  SESSION_SECRET: "session-secret-value-000000000000000000",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};

const production = {
  ...secrets,
  VERCEL_ENV: "production",
  NODE_ENV: "production",
  APP_URL: "https://trips.example.test",
  DATABASE_URL: "postgres://user:hunter2@db.example.test/trips",
};

const selfHosted = { ...production, VERCEL_ENV: undefined };

function failure(env: Record<string, string | undefined>): SetupError {
  try {
    parseServerEnv(env);
  } catch (e) {
    if (e instanceof SetupError) return e;
    throw e;
  }
  throw new Error("expected the environment to be refused");
}

describe("recognising a production shell", () => {
  it("treats a database host that is not local as remote", () => {
    expect(isRemoteDatabase("postgres://u:p@ep-cool.neon.tech/trips")).toBe(true);
    expect(isRemoteDatabase("not a url")).toBe(true);
    expect(isRemoteDatabase("postgres://u:p@localhost:5432/trips")).toBe(false);
    expect(isRemoteDatabase("postgres://u:p@127.0.0.1/trips")).toBe(false);
    expect(isRemoteDatabase(undefined)).toBe(false);
    expect(isRemoteDatabase("")).toBe(false);
  });

  it("looks like production from the deployment variables or a remote database", () => {
    expect(looksLikeProduction({})).toBe(false);
    expect(looksLikeProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(looksLikeProduction({ NODE_ENV: "production" })).toBe(true);
    expect(looksLikeProduction({ DATABASE_URL: "postgres://u:p@ep-cool.neon.tech/trips" })).toBe(true);
    expect(looksLikeProduction({ DATABASE_URL: "postgres://u:p@localhost/trips" })).toBe(false);
  });
});

describe("server environment", () => {
  it("accepts a complete production environment", () => {
    expect(parseServerEnv(production).deployment).toBe("production");
  });

  it.each(["AUTH_SECRET", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "DATA_ENCRYPTION_KEY", "APP_URL", "DATABASE_URL"])(
    "refuses production without %s and names it",
    (name) => {
      expect(failure({ ...production, [name]: undefined }).message).toContain(name);
      expect(failure({ ...production, [name]: "" }).message).toContain(name);
    },
  );

  it("refuses a short session secret", () => {
    expect(failure({ ...production, SESSION_SECRET: "short" }).message).toContain("SESSION_SECRET");
  });

  it("refuses an app url that is not https in production", () => {
    expect(failure({ ...production, APP_URL: "http://trips.example.test" }).message).toContain("APP_URL");
    expect(failure({ ...production, APP_URL: "not a url" }).message).toContain("APP_URL");
  });

  it("never prints a value", () => {
    const message = failure({ ...production, DEV_SIGN_IN: "1", APP_URL: "http://leaky.example.test", SESSION_SECRET: "short" }).message;
    for (const value of ["hunter2", "short", "leaky.example.test", production.AUTH_SECRET, production.DATA_ENCRYPTION_KEY]) {
      expect(message).not.toContain(value);
    }
  });

  it("refuses dev sign in on a production deployment", () => {
    expect(failure({ ...production, DEV_SIGN_IN: "1" }).message).toContain("DEV_SIGN_IN");
  });

  it("refuses dev sign in with NODE_ENV=production and no VERCEL_ENV", () => {
    expect(failure({ ...selfHosted, DEV_SIGN_IN: "1" }).message).toContain("DEV_SIGN_IN");
  });

  it("allows dev sign in on a preview deployment", () => {
    const env = parseServerEnv({ ...production, VERCEL_ENV: "preview", APP_URL: undefined, DEV_SIGN_IN: "1" });
    expect(env.deployment).toBe("preview");
    expect(env.devSignIn).toBe(true);
  });

  it("does not require an app url on a preview deployment", () => {
    expect(parseServerEnv({ ...production, VERCEL_ENV: "preview", APP_URL: undefined }).appUrl).toBe("http://localhost:3000");
  });

  it("refuses any Vercel deployment without a database url", () => {
    expect(failure({ ...production, VERCEL_ENV: "preview", DATABASE_URL: undefined }).message).toContain("DATABASE_URL");
  });

  it("requires the secrets on a preview deployment too", () => {
    expect(failure({ ...production, VERCEL_ENV: "preview", AUTH_SECRET: undefined }).message).toContain("AUTH_SECRET");
  });

  it("names every problem at once", () => {
    const message = failure({ VERCEL_ENV: "production", NODE_ENV: "production" }).message;
    for (const name of ["AUTH_SECRET", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "DATA_ENCRYPTION_KEY", "APP_URL", "DATABASE_URL"]) {
      expect(message).toContain(name);
    }
  });

  it("does not require a database url when self hosted outside Vercel", () => {
    expect(parseServerEnv({ ...selfHosted, DATABASE_URL: undefined }).databaseUrl).toBeUndefined();
  });

  it("asks for nothing in development and tests", () => {
    const env = parseServerEnv({ NODE_ENV: "development", DEV_SIGN_IN: "1" });
    expect(env.deployment).toBe("local");
    expect(env.databaseUrl).toBeUndefined();
    expect(env.devSignIn).toBe(true);
    expect(parseServerEnv({ NODE_ENV: "test" }).deployment).toBe("local");
  });

  it("leaves TRUST_PROXY to its own check", () => {
    expect(parseServerEnv({ ...production, TRUST_PROXY: undefined }).deployment).toBe("production");
  });
});
