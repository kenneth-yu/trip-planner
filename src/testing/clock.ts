import { vi } from "vitest";

const realDateNow = Date.now.bind(Date);

export const FROZEN_INSTANT = "2026-12-01T10:07:30.000Z";
export const FROZEN_NOW_MS = Date.parse(FROZEN_INSTANT);

export function frozenNow(): Date {
  return new Date(FROZEN_NOW_MS);
}

export function freezeClock(): void {
  if (vi.isFakeTimers()) vi.setSystemTime(FROZEN_NOW_MS);
  else vi.useFakeTimers({ toFake: ["Date"], now: FROZEN_NOW_MS });
}

export function nowMs(): number {
  return Date.now();
}

export function tick(ms = 1000): void {
  vi.setSystemTime(Date.now() + ms);
}

export function realNow(): number {
  return realDateNow();
}

export async function withRealClock<T>(run: () => Promise<T> | T): Promise<T> {
  vi.useRealTimers();
  try {
    return await run();
  } finally {
    freezeClock();
  }
}
