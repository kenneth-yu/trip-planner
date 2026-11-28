import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { fetchCalendar, type GuardOptions, type Resolver, type Transport, type TransportResponse } from "./fetch-guard";

export const resolveHost: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function headersOf(message: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (name === "set-cookie") continue;
    out[name] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

export const httpsTransport: Transport = ({ url, address, family, headers, signal }) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const pinned: LookupAddress = { address, family };
    const req = request(
      {
        method: "GET",
        host: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
        servername: url.hostname.startsWith("[") ? undefined : url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        agent: false,
        signal,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (message) => {
        resolve({
          status: message.statusCode ?? 0,
          headers: headersOf(message),
          body: message,
          destroy: () => {
            message.destroy();
            req.destroy();
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

export function guardedFetchOptions(): GuardOptions {
  return { resolve: resolveHost, transport: httpsTransport };
}

export function fetchCalendarText(rawUrl: string): Promise<string> {
  return fetchCalendar(rawUrl, guardedFetchOptions());
}
