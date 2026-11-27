"use client";

import { useEffect, useSyncExternalStore } from "react";
import styles from "./item-form.module.css";
import { FLASH_COOKIE, flashCookieSchema, type Flash } from "./flash";

const subscribeNever = () => () => undefined;

function readCookie(): string {
  const prefix = `${FLASH_COOKIE}=`;
  const found = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

export function parseFlash(raw: string): Flash | null {
  const parsed = flashCookieSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function FlashStatus({ kind, focusId }: { kind: Flash["kind"]; focusId?: string }) {
  const raw = useSyncExternalStore(subscribeNever, readCookie, () => "");
  const flash = parseFlash(raw);
  const shown = flash?.kind === kind ? flash : null;
  const present = shown !== null;

  useEffect(() => {
    if (!present) return;
    if (focusId) document.getElementById(focusId)?.focus();
    const timer = window.setTimeout(() => {
      document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [present, focusId]);

  if (!shown) return null;
  return (
    <p role="status" className={styles.flash}>
      {kind === "saved" ? "Saved" : `Deleted ${shown.text ?? "the item"}.`}
    </p>
  );
}
