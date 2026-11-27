export function trustProxy(env: { NODE_ENV?: string; TRUST_PROXY?: string }): boolean {
  if (env.TRUST_PROXY === "1") return true;
  if (env.TRUST_PROXY === "0") return false;
  if (env.NODE_ENV === "production") throw new Error("Set TRUST_PROXY to 1 behind a proxy that appends the client address (Vercel). 0 makes every client share one rate limit budget.");
  return false;
}
