import { describe, expect, it, vi } from "vitest";
import { isPublicAddress } from "./address";
import { fetchCalendar, FetchRefused, type Resolver, type Transport, type TransportRequest, type TransportResponse } from "./fetch-guard";

const PUBLIC = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";
const resolverTo = (...addresses: string[]): Resolver => async () => addresses;

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): TransportResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers,
    body: (async function* () {
      yield bytes;
    })(),
    destroy: () => undefined,
  };
}

function scripted(responses: TransportResponse[]): { transport: Transport; seen: TransportRequest[] } {
  const seen: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    seen.push(request);
    const next = responses[seen.length - 1];
    if (!next) throw new Error("no more scripted responses");
    return next;
  };
  return { transport, seen };
}

async function refusal(run: () => Promise<unknown>): Promise<FetchRefused> {
  try {
    await run();
  } catch (e) {
    if (e instanceof FetchRefused) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("which addresses count as public", () => {
  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888"])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.5",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fe80::a:b:c:d",
    "febf::1",
    "fc00::1",
    "fd00:ec2::254",
    "fdff::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:10.1.2.3",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["not an address", "", "999.1.1.1", "1.2.3", "1.2.3.4.5", "::g", "1::2::3"])("refuses the unreadable value %j", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("what the guard refuses before it connects", () => {
  it.each([
    ["http://example.com/cal.ics", "scheme"],
    ["ftp://example.com/cal.ics", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["//example.com/cal.ics", "invalid"],
    ["example.com/cal.ics", "invalid"],
    ["", "invalid"],
    ["https://user:secret@example.com/cal.ics", "credentials"],
    ["https://user@example.com/cal.ics", "credentials"],
    ["https://example.com:8443/cal.ics", "port"],
    ["https://example.com:80/cal.ics", "port"],
  ])("%s is refused as %s without any lookup or connection", async (url, reason) => {
    const { transport, seen } = scripted([]);
    let looked = 0;
    const resolve: Resolver = async () => {
      looked += 1;
      return [PUBLIC];
    };
    const refused = await refusal(() => fetchCalendar(url, { resolve, transport }));
    expect(refused.reason).toBe(reason);
    expect(looked).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it.each([
    "https://127.0.0.1/cal.ics",
    "https://[::1]/cal.ics",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/cal.ics",
    "https://192.168.0.1/cal.ics",
    "https://[::ffff:127.0.0.1]/cal.ics",
    "https://[fd00:ec2::254]/cal.ics",
    "https://0.0.0.0/cal.ics",
    "https://2130706433/cal.ics",
    "https://0x7f.0.0.1/cal.ics",
    "https://127.1/cal.ics",
    "https://017700000001/cal.ics",
  ])("%s is refused as an address, with no lookup", async (url) => {
    const { transport, seen } = scripted([]);
    let looked = 0;
    const resolve: Resolver = async () => {
      looked += 1;
      return [PUBLIC];
    };
    const refused = await refusal(() => fetchCalendar(url, { resolve, transport }));
    expect(refused.reason).toBe("address");
    expect(looked).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it.each([
    [["127.0.0.1"]],
    [["169.254.169.254"]],
    [["10.1.1.1"]],
    [["::1"]],
    [["fe80::1"]],
    [[PUBLIC, "192.168.1.9"]],
    [["192.168.1.9", PUBLIC]],
    [[PUBLIC_V6, "::ffff:10.0.0.1"]],
    [[]],
  ])("a name that resolves to %j is refused, even when only one address is private", async (addresses) => {
    const { transport, seen } = scripted([]);
    const refused = await refusal(() => fetchCalendar("https://calendar.example.test/trip.ics", { resolve: resolverTo(...addresses), transport }));
    expect(refused.reason).toBe("address");
    expect(seen).toHaveLength(0);
  });

  it("a name that does not resolve is unreachable", async () => {
    const resolve: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    const refused = await refusal(() => fetchCalendar("https://nothing.example.test/trip.ics", { resolve, transport: scripted([]).transport }));
    expect(refused.reason).toBe("unreachable");
  });
});

describe("what the guard sends", () => {
  it("connects to the address it checked, never resolving the name again, and sends no cookies or credentials", async () => {
    const { transport, seen } = scripted([textResponse("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")]);
    let looked = 0;
    const resolve: Resolver = async () => {
      looked += 1;
      return [PUBLIC];
    };
    const text = await fetchCalendar("https://calendar.example.test/trip.ics?token=abc", { resolve, transport });
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(looked).toBe(1);
    const sent = seen[0];
    expect(sent?.address).toBe(PUBLIC);
    expect(sent?.url.hostname).toBe("calendar.example.test");
    expect(Object.keys(sent?.headers ?? {}).map((k) => k.toLowerCase()).sort()).toEqual(["accept", "user-agent"]);
  });

  it("prefers an IPv6 or IPv4 address as the resolver gave them, and checks every one", async () => {
    const { transport, seen } = scripted([textResponse("x")]);
    await fetchCalendar("https://calendar.example.test/trip.ics", { resolve: resolverTo(PUBLIC_V6, PUBLIC), transport });
    expect(seen[0]?.address).toBe(PUBLIC_V6);
    expect(seen[0]?.family).toBe(6);
  });
});

describe("redirects", () => {
  it("follows up to three, checking each target again", async () => {
    const { transport, seen } = scripted([
      textResponse("", 302, { location: "https://b.example.test/one" }),
      textResponse("", 301, { location: "/two" }),
      textResponse("", 307, { location: "https://c.example.test/three" }),
      textResponse("done"),
    ]);
    const hosts: string[] = [];
    const resolve: Resolver = async (host) => {
      hosts.push(host);
      return [PUBLIC];
    };
    expect(await fetchCalendar("https://a.example.test/start", { resolve, transport })).toBe("done");
    expect(hosts).toEqual(["a.example.test", "b.example.test", "b.example.test", "c.example.test"]);
    expect(seen.map((s) => s.url.pathname)).toEqual(["/start", "/one", "/two", "/three"]);
  });

  it("refuses a fourth redirect", async () => {
    const hop = (n: number) => textResponse("", 302, { location: `https://h${n}.example.test/` });
    const { transport } = scripted([hop(1), hop(2), hop(3), hop(4), textResponse("never")]);
    const refused = await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport }));
    expect(refused.reason).toBe("redirects");
  });

  it.each([
    ["http://b.example.test/", "scheme"],
    ["https://127.0.0.1/", "address"],
    ["https://169.254.169.254/latest/meta-data/", "address"],
    ["https://user:pw@b.example.test/", "credentials"],
    ["https://b.example.test:8443/", "port"],
    ["file:///etc/passwd", "scheme"],
  ])("a redirect to %s is refused as %s and the target is never contacted", async (location, reason) => {
    const { transport, seen } = scripted([textResponse("", 302, { location }), textResponse("secret")]);
    const refused = await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport }));
    expect(refused.reason).toBe(reason);
    expect(seen).toHaveLength(1);
  });

  it("a redirect whose name now resolves to a private address is refused", async () => {
    const { transport, seen } = scripted([textResponse("", 302, { location: "https://rebind.example.test/" }), textResponse("secret")]);
    const resolve: Resolver = async (host) => (host === "rebind.example.test" ? ["10.0.0.9"] : [PUBLIC]);
    const refused = await refusal(() => fetchCalendar("https://a.example.test/", { resolve, transport }));
    expect(refused.reason).toBe("address");
    expect(seen).toHaveLength(1);
  });

  it("a redirect without a location is refused", async () => {
    const { transport } = scripted([textResponse("", 302)]);
    expect((await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport }))).reason).toBe("status");
  });
});

describe("limits", () => {
  it.each([404, 403, 500, 204, 401])("a %i answer is refused", async (status) => {
    const { transport } = scripted([textResponse("nope", status)]);
    expect((await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport }))).reason).toBe("status");
  });

  it("accepts a body of exactly the cap and refuses one byte more", async () => {
    const ok = scripted([textResponse("a".repeat(100))]);
    expect((await fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport: ok.transport, maxBytes: 100 })).length).toBe(100);
    const over = scripted([textResponse("a".repeat(101))]);
    expect((await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport: over.transport, maxBytes: 100 }))).reason).toBe("size");
  });

  it("refuses by the declared length without reading the body", async () => {
    let read = false;
    const response: TransportResponse = {
      status: 200,
      headers: { "content-length": "999999999" },
      body: (async function* () {
        read = true;
        yield new Uint8Array(1);
      })(),
      destroy: () => undefined,
    };
    const refused = await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport: scripted([response]).transport }));
    expect(refused.reason).toBe("size");
    expect(read).toBe(false);
  });

  it("stops reading and destroys the connection when a streamed body passes the cap, whatever it declared", async () => {
    let destroyed = false;
    let chunks = 0;
    const response: TransportResponse = {
      status: 200,
      headers: {},
      body: (async function* () {
        for (;;) {
          chunks += 1;
          yield new Uint8Array(40);
          if (chunks > 50) return;
        }
      })(),
      destroy: () => {
        destroyed = true;
      },
    };
    const refused = await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport: scripted([response]).transport, maxBytes: 100 }));
    expect(refused.reason).toBe("size");
    expect(destroyed).toBe(true);
    expect(chunks).toBeLessThan(10);
  });

  it("gives up after the time limit even when the server never answers", async () => {
    const transport: Transport = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const refused = await refusal(() => fetchCalendar("https://slow.example.test/", { resolve: resolverTo(PUBLIC), transport, timeoutMs: 30 }));
    expect(refused.reason).toBe("timeout");
  });

  it("gives up when the body stalls", async () => {
    const response: TransportResponse = {
      status: 200,
      headers: {},
      body: (async function* () {
        yield new TextEncoder().encode("BEGIN");
        await new Promise((resolve) => setTimeout(resolve, 500));
        yield new TextEncoder().encode("END");
      })(),
      destroy: () => undefined,
    };
    const refused = await refusal(() => fetchCalendar("https://slow.example.test/", { resolve: resolverTo(PUBLIC), transport: scripted([response]).transport, timeoutMs: 40 }));
    expect(refused.reason).toBe("timeout");
  });

  it("a connection failure is unreachable", async () => {
    const transport: Transport = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect((await refusal(() => fetchCalendar("https://a.example.test/", { resolve: resolverTo(PUBLIC), transport }))).reason).toBe("unreachable");
  });
});

describe("what a refusal reveals", () => {
  it("never carries the address, the host, the path or the query in its message", async () => {
    const secretUrl = "https://private-host.example.test/secret-path/cal.ics?token=SECRET123";
    const outcomes = [
      await refusal(() => fetchCalendar(secretUrl, { resolve: resolverTo("10.0.0.1"), transport: scripted([]).transport })),
      await refusal(() => fetchCalendar(secretUrl, { resolve: resolverTo(PUBLIC), transport: scripted([textResponse("", 500)]).transport })),
      await refusal(() => fetchCalendar("http://private-host.example.test/secret-path/cal.ics?token=SECRET123", { resolve: resolverTo(PUBLIC), transport: scripted([]).transport })),
    ];
    for (const refused of outcomes) {
      expect(refused.message).not.toMatch(/private-host|secret-path|SECRET123|10\.0\.0\.1|example\.test/);
      expect(JSON.stringify(refused)).not.toMatch(/private-host|secret-path|SECRET123|10\.0\.0\.1/);
    }
  });

  it("writes nothing to the console while fetching or refusing", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    try {
      await fetchCalendar("https://a.example.test/cal.ics?token=SECRET123", { resolve: resolverTo(PUBLIC), transport: scripted([textResponse("ok")]).transport });
      await refusal(() => fetchCalendar("https://a.example.test/cal.ics?token=SECRET123", { resolve: resolverTo("127.0.0.1"), transport: scripted([]).transport }));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
