"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const ZONE_COOKIE = "tp_zone";

export function ZoneHint() {
  const router = useRouter();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/v; Max-Age=86400; SameSite=Lax${secure}`;
    router.refresh();
  }, [router]);
  return null;
}
