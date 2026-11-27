const SHARED_BUCKET = "direct";

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return SHARED_BUCKET;
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  return hops.at(-1) ?? SHARED_BUCKET;
}
