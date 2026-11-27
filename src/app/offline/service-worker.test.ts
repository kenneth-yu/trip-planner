import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { OFFLINE_COPY } from "./offline-copy";

const source = readFileSync(path.join(import.meta.dirname, "..", "..", "..", "public", "sw.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

function load(networkUp: boolean) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, string>>();
  const fetched: string[] = [];
  const cacheFor = (name: string) => {
    const store = stores.get(name) ?? new Map<string, string>();
    stores.set(name, store);
    return {
      addAll: async (paths: string[]) => {
        for (const p of paths) store.set(p, `cached ${p}`);
      },
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | { url: string }) => {
      const p = typeof request === "string" ? request : new URL(request.url).pathname;
      for (const store of stores.values()) if (store.has(p)) return store.get(p);
      return undefined;
    },
  };
  const context = {
    self: { addEventListener: (type: string, fn: Listener) => listeners.set(type, fn), location: { origin: "https://trips.test" } },
    caches,
    URL,
    Promise,
    fetch: async (request: { url: string }) => {
      fetched.push(request.url);
      if (!networkUp) throw new TypeError("network down");
      return `network ${request.url}`;
    },
  };
  vm.runInNewContext(source, context);
  const run = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<unknown> | undefined;
    listeners.get(type)?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<unknown>) => {
        responded = p;
      },
    });
    await Promise.all(waits);
    return responded === undefined ? undefined : { value: await responded };
  };
  return { run, stores, fetched };
}

const request = (url: string, mode = "cors", method = "GET") => ({ url: `https://trips.test${url}`, mode, method });

describe("service worker", () => {
  it("caches only the offline page and the icons", async () => {
    const sw = load(true);
    await sw.run("install", {});
    expect([...sw.stores.keys()]).toHaveLength(1);
    const [paths] = [...sw.stores.values()].map((s) => [...s.keys()].sort());
    expect(paths).toEqual(["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/icon.svg", "/offline"]);
  });

  it("never stores a trip page, api response or any fetched response", async () => {
    const sw = load(true);
    await sw.run("install", {});
    const before = JSON.stringify([...sw.stores]);
    await sw.run("fetch", { request: request("/trips/abc", "navigate") });
    await sw.run("fetch", { request: request("/api/mcp") });
    expect(JSON.stringify([...sw.stores])).toBe(before);
  });

  it("passes a navigation through while online", async () => {
    const sw = load(true);
    await sw.run("install", {});
    const result = await sw.run("fetch", { request: request("/trips/abc", "navigate") });
    expect(result?.value).toBe("network https://trips.test/trips/abc");
  });

  it("serves the offline page when a navigation fails for lack of a network", async () => {
    const sw = load(false);
    await sw.run("install", {});
    const result = await sw.run("fetch", { request: request("/trips/abc", "navigate") });
    expect(result?.value).toBe("cached /offline");
  });

  it("does not answer api requests or posts", async () => {
    const sw = load(false);
    await sw.run("install", {});
    expect(await sw.run("fetch", { request: request("/api/mcp") })).toBeUndefined();
    expect(await sw.run("fetch", { request: request("/trips/abc", "navigate", "POST") })).toBeUndefined();
  });

  it("serves icons from the cache without the network", async () => {
    const sw = load(false);
    await sw.run("install", {});
    const result = await sw.run("fetch", { request: request("/icon-192.png") });
    expect(result?.value).toBe("cached /icon-192.png");
  });

  it("removes caches from older versions on activate", async () => {
    const sw = load(true);
    sw.stores.set("old", new Map([["/trips/abc", "stale"]]));
    await sw.run("install", {});
    await sw.run("activate", {});
    expect([...sw.stores.keys()]).not.toContain("old");
  });
});

describe("offline copy", () => {
  it("uses the exact words from the spec", () => {
    expect(OFFLINE_COPY).toEqual({
      heading: "You are offline.",
      reconnect: "Your trip will show again when you have a connection.",
      screenshots: "If you saved screenshots of your bookings, they are in your photos.",
      retry: "Try again",
    });
  });
});
