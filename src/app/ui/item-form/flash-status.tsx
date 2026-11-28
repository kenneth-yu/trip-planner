"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import styles from "./item-form.module.css";
import { FLASH_COOKIE, FLASH_KINDS, FLASH_MESSAGE, flashPath, type FlashKind, type FlashLink } from "./flash";

const subscribeNever = () => () => undefined;

function readCookie(): string {
  const prefix = `${FLASH_COOKIE}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function parseFlash(raw: string): FlashKind | null {
  return FLASH_KINDS.find((kind) => kind === raw) ?? null;
}

function statusHost(): HTMLElement | null {
  const host = document.createElement("div");
  const nav = document.querySelector("main nav");
  if (nav) nav.after(host);
  else document.querySelector("main")?.prepend(host);
  return host.isConnected ? host : null;
}

export function StatusLine({ text, link }: { text: string | null; link?: FlashLink }) {
  return (
    <p role="status" className={text ? styles.flash : undefined}>
      {text && link ? (
        <>
          {text} <Link href={link.href}>{link.label}</Link>.
        </>
      ) : (
        text
      )}
    </p>
  );
}

export function FlashStatus({ kind, tripId, focusId }: { kind: FlashKind; tripId: string; focusId?: string }) {
  const raw = useSyncExternalStore(subscribeNever, readCookie, () => "");
  const matches = parseFlash(raw) === kind;
  const holder = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    if (!host) return;
    const timer = window.setTimeout(() => setAnnounced(true), 150);
    return () => window.clearTimeout(timer);
  }, [host]);

  useEffect(() => {
    if (!matches) return;
    const shown = (holder.current?.getClientRects().length ?? 0) > 0;
    if (shown && !hostRef.current) {
      hostRef.current = statusHost();
      setHost(hostRef.current);
      if (focusId) document.getElementById(focusId)?.focus();
    }
    const timer = window.setTimeout(() => {
      document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=${flashPath(tripId)}`;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [matches, focusId, tripId]);

  useEffect(
    () => () => {
      hostRef.current?.remove();
      hostRef.current = null;
    },
    [],
  );

  return <div ref={holder}>{host && createPortal(<StatusLine text={announced ? FLASH_MESSAGE[kind].lead : null} link={FLASH_MESSAGE[kind].link} />, host)}</div>;
}
