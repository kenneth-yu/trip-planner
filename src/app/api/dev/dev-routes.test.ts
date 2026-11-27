import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as devSignIn } from "./sign-in/route";
import { GET as outboxRoute } from "./outbox/route";
import { devOutbox } from "@/server/auth/email";
import { currentUser } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { testContext } from "@/server/testing";
import * as t from "@/server/db/schema";
import { present } from "@/testing/present";
import { USERS } from "@/fixtures/december-trip";
import type { Db } from "@/server/db/client";

const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
const database: { current: Promise<Db> | null } = { current: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: present(jar.get(name)).value } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
  }),
}));

vi.mock("@/server/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db/client")>()),
  getDb: () => present(database.current),
}));

beforeAll(async () => {
  database.current = testContext({ withItems: false }).then((c) => c.db);
  await database.current;
});

beforeEach(async () => {
  jar.clear();
  await (await present(database.current)).delete(t.authSessions);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev sign in route", () => {
  const url = (query: string) => new Request(`http://localhost:3000/api/dev/sign-in?${query}`);

  it("is 404 and sets no cookie when DEV_SIGN_IN is unset", async () => {
    vi.stubEnv("DEV_SIGN_IN", "");
    const response = await devSignIn(url("as=kenny"));
    expect(response.status).toBe(404);
    expect(jar.size).toBe(0);
  });

  it("throws and sets no cookie in production", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "production");
    await expect(devSignIn(url("as=kenny"))).rejects.toThrow(/DEV_SIGN_IN/);
    expect(jar.size).toBe(0);
  });

  it("creates a real hashed session row, sets the Auth.js cookie and redirects to a safe next path", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    const response = await devSignIn(url("as=jacob&next=%2Ftrips%2Fx%3Fday%3D2026-12-05"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/trips/x?day=2026-12-05");
    const cookie = present(jar.get("authjs.session-token"));
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const rows = await (await present(database.current)).select().from(t.authSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(cookie.value));
    expect(rows[0].userId).toBe(USERS.jacob.id);
    expect((await currentUser())?.id).toBe(USERS.jacob.id);
  });

  it("sets a Secure prefixed cookie on a production preview", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await devSignIn(url("as=kenny"))).status).toBe(303);
    expect(present(jar.get("__Secure-authjs.session-token")).options).toMatchObject({ secure: true, httpOnly: true });
  });

  it("drops an open redirect in next and rejects an unknown user", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await devSignIn(url("as=kenny&next=https%3A%2F%2Fevil.com"))).headers.get("location")).toBe("/");
    expect((await devSignIn(url("as=mallory"))).status).toBe(400);
  });
});

describe("outbox route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is 404 when dev sign in is off", async () => {
    vi.stubEnv("DEV_SIGN_IN", "");
    expect((await outboxRoute(new Request("http://x.test/api/dev/outbox?to=kenny@example.com"))).status).toBe(404);
  });

  it("returns the last link in development and 404 when there is none", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    await devOutbox().sender.sendSignInLink("outbox-test@example.com", "https://x.test/l?token=z");
    const found = await outboxRoute(new Request("http://x.test/api/dev/outbox?to=outbox-test@example.com"));
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ url: "https://x.test/l?token=z" });
    expect((await outboxRoute(new Request("http://x.test/api/dev/outbox?to=nobody@example.com"))).status).toBe(404);
    expect((await outboxRoute(new Request("http://x.test/api/dev/outbox"))).status).toBe(400);
  });

  it("never answers in production, it throws instead", async () => {
    vi.stubEnv("DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "production");
    await expect(outboxRoute(new Request("http://x.test/api/dev/outbox?to=kenny@example.com"))).rejects.toThrow(/DEV_SIGN_IN/);
  });
});
