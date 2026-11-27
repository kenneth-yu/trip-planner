import { isIPv6 } from "node:net";

const SHARED_BUCKET = "direct";
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function ipv6Prefix(address: string): string {
  const compressed = address.includes("::");
  const [head, tail = ""] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const groups = compressed ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().padStart(4, "0"))
    .join(":");
}

function bucketFor(hop: string): string {
  const mapped = MAPPED_IPV4.exec(hop);
  if (mapped) return mapped[1];
  const unzoned = hop.split("%")[0];
  return isIPv6(unzoned) ? `${ipv6Prefix(unzoned)}::/64` : hop;
}

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return SHARED_BUCKET;
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  const last = hops.at(-1);
  return last ? bucketFor(last) : SHARED_BUCKET;
}
