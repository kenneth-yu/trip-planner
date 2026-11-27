"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./item-form.module.css";
import { FLASH_COOKIE, FLASH_TEXT, flashKind, flashPath, type FlashKind } from "./flash";

const subscribeNever = () => () => undefined;

function readCookie(): string {
  const prefix = `${FLASH_COOKIE}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function parseFlash(raw: string): FlashKind | null {
  const parsed = flashKind.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function FlashStatus({ kind, tripId, focusId }: { kind: FlashKind; tripId: string; focusId?: string }) {
  const raw = useSyncExternalStore(subscribeNever, readCookie, () => "");
  const matches = parseFlash(raw) === kind;
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!matches) return;
    const shown = (holder.current?.getClientRects().length ?? 0) > 0;
    setVisible(shown);
    if (shown) {
      holder.current?.scrollIntoView({ block: "nearest" });
      if (focusId) document.getElementById(focusId)?.focus();
    }
    const timer = window.setTimeout(() => {
      document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=${flashPath(tripId)}`;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [matches, focusId, tripId]);

  return (
    <div ref={holder}>
      {visible && (
        <p role="status" className={styles.flash}>
          {FLASH_TEXT[kind]}
        </p>
      )}
    </div>
  );
}
