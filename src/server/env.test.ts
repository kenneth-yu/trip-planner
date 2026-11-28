import { describe, expect, it } from "vitest";
import { appUrlRequired, isRemoteDatabase, isReviewServer, looksLikeProduction, parseServerEnv, SetupError } from "./env";

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

  it("refuses the fake Google import flag on a production deployment, and allows it elsewhere", () => {
    expect(failure({ ...production, GOOGLE_IMPORT_FAKE: "1" }).message).toContain("GOOGLE_IMPORT_FAKE");
    expect(() => parseServerEnv({ ...production, GOOGLE_IMPORT_FAKE: "0" })).not.toThrow();
  });

  it("refuses dev sign in on a production deployment", () => {
    expect(failure({ ...production, DEV_SIGN_IN: "1" }).message).toContain("DEV_SIGN_IN");
  });

  it("refuses dev sign in with NODE_ENV=production and no VERCEL_ENV", () => {
    expect(failure({ ...selfHosted, DEV_SIGN_IN: "1" }).message).toContain("DEV_SIGN_IN");
  });

  describe("the review server flag", () => {
    const review = { NODE_ENV: "production", REVIEW_SERVER: "1", DEV_SIGN_IN: "1", TRUST_PROXY: "0" };

    it("allows the embedded database and dev sign in under NODE_ENV=production", () => {
      const env = parseServerEnv(review);
      expect(env.deployment).toBe("local");
      expect(env.devSignIn).toBe(true);
      expect(env.databaseUrl).toBeUndefined();
      expect(isReviewServer(review)).toBe(true);
    });

    it.each([
      ["VERCEL", { VERCEL: "1" }],
      ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
      ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
      ["DATABASE_URL", { DATABASE_URL: "postgres://u:p@localhost:5432/x" }],
    ])("is refused when %s is present", (_name, extra) => {
      const env = { ...review, ...extra };
      expect(isReviewServer(env)).toBe(false);
      expect(failure(env).message).toContain("REVIEW_SERVER");
    });

    it("never turns a full production environment into a review server", () => {
      const env = { ...production, REVIEW_SERVER: "1", DEV_SIGN_IN: "1" };
      const message = failure(env).message;
      expect(message).toContain("REVIEW_SERVER");
      expect(message).toContain("DEV_SIGN_IN");
      expect(failure({ ...production, REVIEW_SERVER: "1" }).message).toContain("REVIEW_SERVER");
    });

    it("does nothing without the exact value 1", () => {
      expect(isReviewServer({ NODE_ENV: "production", REVIEW_SERVER: "true" })).toBe(false);
      expect(failure({ ...selfHosted, REVIEW_SERVER: "true", DEV_SIGN_IN: "1" }).message).toContain("DEV_SIGN_IN");
    });
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

  it("requires a database url when self hosted outside Vercel in production", () => {
    expect(failure({ ...selfHosted, DATABASE_URL: undefined }).message).toContain("DATABASE_URL");
  });

  it("lets the local review server run a production build on the embedded database", () => {
    expect(parseServerEnv({ ...selfHosted, DATABASE_URL: undefined, REVIEW_SERVER: "1" }).databaseUrl).toBeUndefined();
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

describe("the app url rule has one source", () => {
  it("treats an unrecognised VERCEL_ENV under NODE_ENV=production as production", () => {
    expect(failure({ ...production, VERCEL_ENV: "staging", APP_URL: undefined }).message).toContain("APP_URL");
    expect(parseServerEnv({ ...production, VERCEL_ENV: "staging" }).deployment).toBe("production");
  });

  it("refuses at startup a preview that sends email links but has no app url", () => {
    const preview = { ...production, VERCEL_ENV: "preview", APP_URL: undefined };
    expect(parseServerEnv(preview).deployment).toBe("preview");
    const email = { ...preview, EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.test" };
    expect(failure(email).message).toContain("APP_URL");
    expect(parseServerEnv({ ...email, APP_URL: "https://preview.example.test" }).appUrl).toBe("https://preview.example.test");
  });

  it("answers the same for startup and for the auth config under the production env shape", () => {
    expect(appUrlRequired(production)).toBe(true);
    expect(appUrlRequired({ ...production, APP_URL: undefined })).toBe(true);
    expect(appUrlRequired({ ...production, VERCEL_ENV: "preview" })).toBe(false);
    expect(appUrlRequired({ ...production, VERCEL_ENV: "preview", EMAIL_API_KEY: "k", EMAIL_FROM: "a@example.test" })).toBe(true);
    expect(appUrlRequired({ NODE_ENV: "development" })).toBe(false);
  });
});
