import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestOptions } from "node:https";

interface FakeRequest {
  on: (event: string, listener: (error: Error) => void) => FakeRequest;
  end: () => void;
  destroy: () => void;
  fail: (error: Error) => void;
}

const net = vi.hoisted(() => {
  const state: {
    options: RequestOptions | null;
    answer: ((message: unknown) => void) | null;
    request: FakeRequest | null;
    destroyed: string[];
  } = { options: null, answer: null, request: null, destroyed: [] };
  return state;
});

vi.mock("node:https", () => ({
  request: (options: RequestOptions, answer: (message: unknown) => void) => {
    net.options = options;
    net.answer = answer;
    const listeners: Record<string, (error: Error) => void> = {};
    const request: FakeRequest = {
      on: (event, listener) => {
        listeners[event] = listener;
        return request;
      },
      end: () => undefined,
      destroy: () => {
        net.destroyed.push("request");
      },
      fail: (error) => listeners.error?.(error),
    };
    net.request = request;
    return request;
  },
}));

import { httpsTransport } from "./https-transport";

const PUBLIC = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

function ask(url: string, address = PUBLIC, family: 4 | 6 = 4) {
  return httpsTransport({ url: new URL(url), address, family, headers: { accept: "text/calendar", "user-agent": "trip-planner-calendar-import" }, signal: new AbortController().signal });
}

function lookupOf(options: RequestOptions | null) {
  const lookup = options?.lookup;
  if (typeof lookup !== "function") throw new Error("the request has no lookup override");
  return lookup;
}

function lookedUp(options: RequestOptions | null, hostname: string, ask: { all?: boolean }) {
  return new Promise<unknown[]>((resolve) => {
    lookupOf(options)(hostname, ask, (...args: unknown[]) => resolve(args));
  });
}

beforeEach(() => {
  net.options = null;
  net.answer = null;
  net.request = null;
  net.destroyed = [];
});

describe("the https transport connects only to the address the guard checked", () => {
  it("overrides the lookup so any name resolves to the checked address, in both call shapes", async () => {
    void ask("https://calendar.example.test/trip.ics?x=1");
    expect(await lookedUp(net.options, "calendar.example.test", { all: true })).toEqual([null, [{ address: PUBLIC, family: 4 }]]);
    expect(await lookedUp(net.options, "calendar.example.test", {})).toEqual([null, PUBLIC, 4]);
    expect(await lookedUp(net.options, "somewhere-else.example.test", { all: true })).toEqual([null, [{ address: PUBLIC, family: 4 }]]);
  });

  it("pins an IPv6 address with its family", async () => {
    void ask("https://calendar.example.test/trip.ics", PUBLIC_V6, 6);
    expect(await lookedUp(net.options, "calendar.example.test", { all: true })).toEqual([null, [{ address: PUBLIC_V6, family: 6 }]]);
  });

  it("keeps the name for the certificate check and the Host header, and the path and query for the request", () => {
    void ask("https://calendar.example.test/trip.ics?x=1");
    expect(net.options).toMatchObject({
      method: "GET",
      host: "calendar.example.test",
      servername: "calendar.example.test",
      path: "/trip.ics?x=1",
      agent: false,
    });
    expect(net.options?.headers).toMatchObject({ host: "calendar.example.test", accept: "text/calendar" });
    expect(net.options?.rejectUnauthorized).toBeUndefined();
    expect(net.options?.checkServerIdentity).toBeUndefined();
  });

  it("takes the abort signal and sends no cookie or authorization header", () => {
    void ask("https://calendar.example.test/trip.ics");
    expect(net.options?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(net.options?.headers ?? {}).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(["cookie"]));
    expect(Object.keys(net.options?.headers ?? {}).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(["authorization"]));
  });

  it("uses the bare IPv6 literal as the host, with no server name, and keeps the brackets in Host", () => {
    void ask(`https://[${PUBLIC_V6}]/trip.ics`, PUBLIC_V6, 6);
    expect(net.options?.host).toBe(PUBLIC_V6);
    expect(net.options?.servername).toBeUndefined();
    expect(net.options?.headers).toMatchObject({ host: `[${PUBLIC_V6}]` });
  });
});

describe("what comes back", () => {
  function answerWith(headers: Record<string, string | string[]>, statusCode = 200) {
    const message = {
      statusCode,
      headers,
      destroy: () => {
        net.destroyed.push("message");
      },
      [Symbol.asyncIterator]: async function* () {
        yield new Uint8Array([1]);
      },
    };
    net.answer?.(message);
    return message;
  }

  it("hands back the status and headers but never a cookie", async () => {
    const pending = ask("https://calendar.example.test/trip.ics");
    answerWith({ "set-cookie": ["session=SECRET"], "content-length": "5", location: "/next", "x-other": ["a", "b"] }, 302);
    const response = await pending;
    expect(response.status).toBe(302);
    expect(response.headers).toEqual({ "content-length": "5", location: "/next", "x-other": "a" });
    expect(JSON.stringify(response.headers)).not.toContain("SECRET");
  });

  it("destroys both the response and the request when asked to", async () => {
    const pending = ask("https://calendar.example.test/trip.ics");
    answerWith({});
    (await pending).destroy();
    expect(net.destroyed.sort()).toEqual(["message", "request"]);
  });

  it("rejects when the connection fails", async () => {
    const pending = ask("https://calendar.example.test/trip.ics");
    net.request?.fail(new Error("ECONNRESET"));
    await expect(pending).rejects.toThrow("ECONNRESET");
  });

  it("treats a missing status as 0, which the guard refuses", async () => {
    const pending = ask("https://calendar.example.test/trip.ics");
    net.answer?.({ headers: {}, destroy: () => undefined });
    expect((await pending).status).toBe(0);
  });
});
