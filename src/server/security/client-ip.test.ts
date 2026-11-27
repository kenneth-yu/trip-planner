import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const headers = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

describe("clientIp", () => {
  it("ignores a spoofed x-forwarded-for unless the proxy is trusted", () => {
    expect(clientIp(headers("198.51.100.9"), false)).toBe("direct");
    expect(clientIp(headers(), false)).toBe("direct");
  });

  it("uses the address the trusted proxy appended, not what the client claimed first", () => {
    expect(clientIp(headers("6.6.6.6, 203.0.113.7"), true)).toBe("203.0.113.7");
    expect(clientIp(headers("203.0.113.7"), true)).toBe("203.0.113.7");
  });

  it("keys IPv6 clients on their /64 so rotating the host part does not help", () => {
    const a = clientIp(headers("2001:db8:1:2::1"), true);
    expect(clientIp(headers("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), true)).toBe(a);
    expect(clientIp(headers("2001:0DB8:0001:0002::ffff"), true)).toBe(a);
    expect(clientIp(headers("2001:db8:1:3::1"), true)).not.toBe(a);
    expect(a).toBe("2001:0db8:0001:0002::/64");
  });

  it("treats IPv4 mapped IPv6 addresses as IPv4", () => {
    expect(clientIp(headers("::ffff:203.0.113.7"), true)).toBe("203.0.113.7");
  });

  it("falls back to one shared bucket when a trusted proxy sent nothing usable", () => {
    expect(clientIp(headers(), true)).toBe("direct");
    expect(clientIp(headers(" , "), true)).toBe("direct");
  });
});
