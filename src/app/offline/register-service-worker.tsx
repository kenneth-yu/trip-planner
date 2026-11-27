"use client";

import { useEffect } from "react";

async function register() {
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (error) {
    console.error("service worker registration failed", error instanceof Error ? error.name : "unknown");
  }
}

export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void register();
  }, []);
  return null;
}
