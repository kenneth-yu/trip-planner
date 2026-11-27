import type { Metadata } from "next";
import { headers } from "next/headers";
import { OFFLINE_COPY, OFFLINE_STYLES, RELOAD_SCRIPT } from "./offline-copy";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

export default async function OfflinePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <main className="offline">
      <style>{OFFLINE_STYLES}</style>
      <h1>{OFFLINE_COPY.heading}</h1>
      <p>{OFFLINE_COPY.reconnect}</p>
      <p className="secondary">{OFFLINE_COPY.screenshots}</p>
      <button type="button" id="try-again">
        {OFFLINE_COPY.retry}
      </button>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: RELOAD_SCRIPT }} />
    </main>
  );
}
