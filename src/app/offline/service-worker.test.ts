import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_COPY, offlineHtml } from "./offline-html";

const publicDir = path.join(import.meta.dirname, "..", "..", "..", "public");
const source = readFileSync(path.join(publicDir, "sw.js"), "utf8");
const ICON_FILES = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "icon.svg"];

function expectedCacheName() {
  const hash = createHash("sha256");
  hash.update(offlineHtml(null));
  for (const file of ICON_FILES) hash.update(readFileSync(path.join(publicDir, file)));
  return `trips-offline-${hash.digest("hex").slice(0, 12)}`;
}

type Listener = (event: Record<string, unknown>) => void;

function load(networkUp: boolean, offlineStatus = 200, stalled = false, delayMs = 0) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, string>>();
  const fetched: string[] = [];
  let up = true;
  const cacheFor = (name: string) => {
    const store = stores.get(name) ?? new Map<string, string>();
    stores.set(name, store);
    return {
      match: async (p: string) => store.get(p),
      add: async (p: string) => {
        const response = await context.fetch({ url: `https://trips.test${p}` });
        if (!response.ok) throw new TypeError(`bad response for ${p}`);
        store.set(p, `cached ${p}`);
      },
      addAll: async (paths: string[]) => {
        for (const p of paths) {
          const response = await context.fetch({ url: `https://trips.test${p}` });
          if (!response.ok) throw new TypeError(`bad response for ${p}`);
          store.set(p, `cached ${p}`);
        }
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
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: (request: { url: string }, init?: { signal?: AbortSignal }): Promise<{ ok: boolean; body: string }> => {
      fetched.push(request.url);
      if (stalled && !request.url.endsWith("/offline") && !request.url.endsWith(".png") && !request.url.endsWith(".svg")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (!up) return Promise.reject(new TypeError("network down"));
      const ok = request.url.endsWith("/offline") ? offlineStatus === 200 : true;
      if (delayMs > 0 && !request.url.endsWith("/offline") && !request.url.endsWith(".png") && !request.url.endsWith(".svg")) {
        return new Promise((resolve) => setTimeout(() => resolve({ ok, body: `network ${request.url}` }), delayMs));
      }
      return Promise.resolve({ ok, body: `network ${request.url}` });
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
    if (type === "install") up = networkUp;
    return responded === undefined ? undefined : { value: await responded };
  };
  return { run, stores, fetched };
}

const request = (url: string, mode = "cors", method = "GET") => ({ url: `https://trips.test${url}`, mode, method });

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(result?.value).toEqual({ ok: true, body: "network https://trips.test/trips/abc" });
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

  it("fails the install when the offline page cannot be fetched", async () => {
    const sw = load(true, 500);
    await expect(sw.run("install", {})).rejects.toThrow("bad response for /offline");
  });

  it("falls back to the offline page when a navigation stalls for 15 seconds and never caches the late page", async () => {
    vi.useFakeTimers();
    const sw = load(true, 200, true);
    await sw.run("install", {});
    const before = JSON.stringify([...sw.stores]);
    const pending = sw.run("fetch", { request: request("/trips/abc", "navigate") });
    await vi.advanceTimersByTimeAsync(14999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)?.value).toBe("cached /offline");
    expect(JSON.stringify([...sw.stores])).toBe(before);
  });

  it("passes through a page that answers after 10 seconds", async () => {
    vi.useFakeTimers();
    const sw = load(true, 200, false, 10_000);
    await sw.run("install", {});
    const pending = sw.run("fetch", { request: request("/trips/abc", "navigate") });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending)?.value).toEqual({ ok: true, body: "network https://trips.test/trips/abc" });
  });

  it("refills the cache when the browser evicted it, on activate and on the next navigation", async () => {
    const sw = load(true);
    await sw.run("install", {});
    sw.stores.clear();
    await sw.run("activate", {});
    expect([...(sw.stores.values().next().value?.keys() ?? [])]).toContain("/offline");
    sw.stores.clear();
    await sw.run("fetch", { request: request("/trips/abc", "navigate") });
    expect([...(sw.stores.values().next().value?.keys() ?? [])]).toHaveLength(6);
  });

  it("names its cache after a hash of the offline page and icons, so changing either needs a new name", () => {
    expect(source).toContain(`const CACHE = "${expectedCacheName()}";`);
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

describe("offline page", () => {
  it("uses the exact words from the spec", () => {
    expect(OFFLINE_COPY).toEqual({
      heading: "Your trip can't load right now.",
      reconnect: "You may be offline, or the connection is too slow. Try again in a moment.",
      screenshots: "If you saved screenshots of your bookings, they are in your photos.",
      retry: "Try again",
    });
    const html = offlineHtml(null);
    for (const text of Object.values(OFFLINE_COPY)) expect(html).toContain(text);
    expect(html).toContain("<h1>Your trip can't load right now.</h1>");
    expect(html).toContain('<button type="button"');
  });

  it("references nothing under /_next/ and no stylesheet, font or image link", () => {
    const html = offlineHtml("abc");
    expect(html).not.toContain("/_next/");
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/\b(src|href)=/);
  });

  it("styles itself for light, dark and safe areas", () => {
    const html = offlineHtml(null);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("env(safe-area-inset-top)");
    expect(html).toContain("min-height: 44px");
    expect(html).toContain("font-family: system-ui, sans-serif");
    expect(html).toContain("--ground: #0f1113");
    expect(html).toContain("background: var(--text)");
  });
});

describe("offline route", () => {
  it("answers the same bytes for anyone, whatever cookies or session they send, nonce aside", async () => {
    const { GET } = await import("./route");
    const anonymous = await (await GET(new Request("https://trips.test/offline", { headers: { "x-nonce": "AAAA" } }))).text();
    const signedIn = await (
      await GET(new Request("https://trips.test/offline", { headers: { "x-nonce": "BBBB", cookie: "session=whatever", authorization: "Bearer x" } }))
    ).text();
    expect(signedIn.replace("BBBB", "AAAA")).toBe(anonymous);
  });

  it("carries the request nonce on its inline script", async () => {
    const { GET } = await import("./route");
    const html = await (await GET(new Request("https://trips.test/offline", { headers: { "x-nonce": "N0nce" } }))).text();
    expect(html).toContain('<script nonce="N0nce">');
  });
});
