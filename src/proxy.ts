import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { clientIp } from "@/server/security/client-ip";
import { trustProxy } from "@/server/security/trust-proxy";
import { securityHeaders } from "@/server/security/headers";
import { consumeRateLimit, ruleForRequest, type RateRule } from "@/server/security/rate-limit";
import { REQUEST_PATH_HEADER } from "@/server/security/request-path";

type Verdict = { allowed: boolean; retryAfterS: number } | "unavailable";

async function checkRateLimit(rule: RateRule, request: NextRequest): Promise<Verdict> {
  try {
    const ip = clientIp(request.headers, trustProxy(process.env));
    return await consumeRateLimit(await getDb(), rule, ip, new Date());
  } catch {
    console.error(`rate limit unavailable for rule ${rule.name}`);
    return "unavailable";
  }
}

function plain(body: string, status: number, headers: Headers, retryAfterS: number): NextResponse {
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("retry-after", String(retryAfterS));
  return new NextResponse(body, { status, headers });
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const nonce = randomBytes(16).toString("base64");
  const headers = securityHeaders(path, nonce, process.env.NODE_ENV === "production");

  const rule = ruleForRequest(request.method, path);
  if (rule) {
    const verdict = await checkRateLimit(rule, request);
    if (verdict === "unavailable") return plain("This page is unavailable right now. Try again in a moment.", 503, headers, 30);
    if (!verdict.allowed) {
      const visitor = path.startsWith("/v/");
      return plain(visitor ? "Too many visits from this connection. Wait a minute and try again." : "Too many requests. Wait a little while and try again.", 429, headers, verdict.retryAfterS);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_PATH_HEADER, `${path}${request.nextUrl.search}`);
  const policy = headers.get("content-security-policy");
  if (policy) requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
