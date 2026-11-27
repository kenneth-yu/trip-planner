const DEV_PHONE_FRAME = "http://localhost:8766";
const NO_REFERRER_PREFIXES = ["/v/", "/invite/"];

function contentSecurityPolicy(nonce: string, isProduction: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    isProduction ? "connect-src 'self'" : "connect-src 'self' ws: wss:",
    `frame-ancestors ${isProduction ? "'none'" : DEV_PHONE_FRAME}`,
    "base-uri 'none'",
    "form-action 'self' https://accounts.google.com https://appleid.apple.com",
    "object-src 'none'",
  ];
  return directives.join("; ");
}

export function securityHeaders(pathname: string, nonce: string, isProduction: boolean): Headers {
  const quiet = NO_REFERRER_PREFIXES.some((p) => pathname.startsWith(p));
  const headers = new Headers({
    "content-security-policy": contentSecurityPolicy(nonce, isProduction),
    "x-content-type-options": "nosniff",
    "referrer-policy": quiet ? "no-referrer" : "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
  });
  if (quiet) headers.set("x-robots-tag", "noindex, nofollow");
  if (isProduction) headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  return headers;
}
