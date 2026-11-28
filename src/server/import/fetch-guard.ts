import { isIP } from "node:net";
import { isPublicAddress } from "./address";

export type RefusalReason = "invalid" | "scheme" | "credentials" | "port" | "address" | "redirects" | "timeout" | "size" | "status" | "unreachable";

export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

const MESSAGES: Record<RefusalReason, string> = {
  invalid: "Paste a full link that starts with https://.",
  scheme: "Paste a full link that starts with https://.",
  credentials: "Paste a link without a user name or password in it.",
  port: "Paste a link without a port number.",
  address: "We could not get a calendar from that link.",
  redirects: "We could not get a calendar from that link.",
  timeout: "That link took too long to answer.",
  size: "That calendar is bigger than 2 MB.",
  status: "We could not get a calendar from that link.",
  unreachable: "We could not get a calendar from that link.",
};

export class FetchRefused extends Error {
  constructor(readonly reason: RefusalReason) {
    super(MESSAGES[reason]);
    this.name = "FetchRefused";
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export interface TransportRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy: () => void;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface GuardOptions {
  resolve: Resolver;
  transport: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const REQUEST_HEADERS = { accept: "text/calendar, text/plain;q=0.9, */*;q=0.1", "user-agent": "trip-planner-calendar-import" };
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (e) {
    if (e instanceof TypeError) throw new FetchRefused("invalid");
    throw e;
  }
  if (url.protocol !== "https:") throw new FetchRefused("scheme");
  if (url.username !== "" || url.password !== "") throw new FetchRefused("credentials");
  if (url.port !== "") throw new FetchRefused("port");
  if (url.hostname === "") throw new FetchRefused("invalid");
  return url;
}

function bareHost(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
}

async function chooseAddress(url: URL, resolve: Resolver): Promise<{ address: string; family: 4 | 6 }> {
  const host = bareHost(url);
  const literal = isIP(host);
  if (literal !== 0) {
    if (!isPublicAddress(host)) throw new FetchRefused("address");
    return { address: host, family: literal === 6 ? 6 : 4 };
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch (e) {
    if (e instanceof Error) throw new FetchRefused("unreachable");
    throw e;
  }
  const first = addresses[0];
  if (first === undefined || !addresses.every(isPublicAddress)) throw new FetchRefused("address");
  return { address: first, family: isIP(first) === 6 ? 6 : 4 };
}

function raced<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new FetchRefused("timeout"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readCapped(response: TransportResponse, maxBytes: number, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new FetchRefused("size");
  }
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await raced(iterator.next(), signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new FetchRefused("size");
      chunks.push(next.value);
    }
  } catch (e) {
    response.destroy();
    void iterator.return?.();
    if (e instanceof FetchRefused) throw e;
    throw new FetchRefused(signal.aborted ? "timeout" : "unreachable");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchCalendar(rawUrl: string, options: GuardOptions): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  let url = parseTarget(rawUrl);
  for (let followed = 0; ; followed++) {
    const { address, family } = await raced(chooseAddress(url, options.resolve), deadline);
    let response: TransportResponse;
    try {
      response = await raced(options.transport({ url, address, family, headers: { ...REQUEST_HEADERS }, signal: deadline }), deadline);
    } catch (e) {
      if (e instanceof FetchRefused) throw e;
      throw new FetchRefused(deadline.aborted ? "timeout" : "unreachable");
    }
    if (REDIRECTS.has(response.status)) {
      response.destroy();
      const location = response.headers.location;
      if (!location) throw new FetchRefused("status");
      if (followed >= maxRedirects) throw new FetchRefused("redirects");
      try {
        url = parseTarget(new URL(location, url).href);
      } catch (e) {
        if (e instanceof TypeError) throw new FetchRefused("invalid");
        throw e;
      }
      continue;
    }
    if (response.status !== 200) {
      response.destroy();
      throw new FetchRefused("status");
    }
    return readCapped(response, maxBytes, deadline);
  }
}
