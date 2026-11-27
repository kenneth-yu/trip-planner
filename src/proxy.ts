import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { clientIp } from "@/server/security/client-ip";
import { securityHeaders } from "@/server/security/headers";
import { consumeRateLimit, ruleForPath } from "@/server/security/rate-limit";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const nonce = randomBytes(16).toString("base64");
  const headers = securityHeaders(path, nonce, process.env.NODE_ENV === "production");

  const rule = ruleForPath(path);
  if (rule) {
    const ip = clientIp(request.headers, process.env.TRUST_PROXY === "1");
    const verdict = await consumeRateLimit(await getDb(), rule, ip, new Date());
    if (!verdict.allowed) {
      headers.set("retry-after", String(verdict.retryAfterS));
      headers.set("content-type", "text/plain; charset=utf-8");
      return new NextResponse("Too many requests. Wait a little while and try again.", { status: 429, headers });
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const policy = headers.get("content-security-policy");
  if (policy) requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  headers.forEach((value, name) => response.headers.set(name, value));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
