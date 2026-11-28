import { isIP } from "node:net";

type Range = readonly [string, number];

const V4_REFUSED: readonly Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inV4Range(value: number, [base, bits]: Range): boolean {
  const start = v4ToNumber(base);
  if (start === null) return false;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

function isPublicV4(address: string): boolean {
  const value = v4ToNumber(address);
  if (value === null) return false;
  return !V4_REFUSED.some((range) => inV4Range(value, range));
}

function v6ToWords(address: string): number[] | null {
  const bare = address.split("%")[0] ?? "";
  let text = bare;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = v4ToNumber(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill("0"), ...rest];
  const words = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN));
  return words.some(Number.isNaN) ? null : words;
}

function v4FromWords(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicV6(address: string): boolean {
  const w = v6ToWords(address);
  if (!w) return false;
  const [a, b, c, d, e, f, g, h] = w;
  if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined || f === undefined || g === undefined || h === undefined) return false;
  if (w.every((x) => x === 0)) return false;
  if (w.slice(0, 7).every((x) => x === 0) && h === 1) return false;
  if ((a & 0xfe00) === 0xfc00) return false;
  if ((a & 0xffc0) === 0xfe80) return false;
  if ((a & 0xffc0) === 0xfec0) return false;
  if ((a & 0xff00) === 0xff00) return false;
  if (a === 0x2001 && b === 0x0db8) return false;
  if (a === 0x2001 && b === 0) return false;
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicV4(v4FromWords(g, h));
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return isPublicV4(v4FromWords(g, h));
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isPublicV4(v4FromWords(g, h));
  if (a === 0x2002) return isPublicV4(v4FromWords(b, c));
  return true;
}

export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPublicV4(address);
  if (kind === 6) return isPublicV6(address);
  return false;
}
