import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { expect } from "vitest";

export const RESULTS_DIR = path.join(".next", "perf");

export interface Measurement {
  name: string;
  medianMs: number;
  budgetMs: number;
  samples: number;
  referenceMs: number;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (high === undefined) throw new Error("Cannot take the median of no samples.");
  return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

export const SAMPLES = 21;
export const MIN_SAMPLES = 9;
export const SAMPLE_TARGET_MS = 25;
export const CAP_MS = 12_000;
const WARMUP_CALLS = 8;
const MAX_BATCH = 50;

export class TooSlow extends Error {
  constructor(name: string, taken: number, capMs: number) {
    super(`${name} took the whole ${capMs} ms cap and gave only ${taken} samples. That is far beyond its budget, so it is a regression and not a noisy runner.`);
    this.name = "TooSlow";
  }
}

export interface Measured {
  medianMs: number;
  samples: number;
}

function elapsed(since: number): number {
  return performance.now() - since;
}

export function measureSync(fn: () => unknown, opts: { name: string; samples?: number; capMs?: number }): Measured {
  const samples = opts.samples ?? SAMPLES;
  const capMs = opts.capMs ?? CAP_MS;
  const started = performance.now();
  const probe: number[] = [];
  for (let i = 0; i < WARMUP_CALLS && elapsed(started) < capMs / 4; i++) {
    const t = performance.now();
    fn();
    probe.push(elapsed(t));
  }
  const batch = Math.max(1, Math.min(MAX_BATCH, Math.floor(SAMPLE_TARGET_MS / Math.max(median(probe.slice(-3)), 0.001))));
  const perCall: number[] = [];
  while (perCall.length < samples && elapsed(started) < capMs) {
    const t = performance.now();
    for (let i = 0; i < batch; i++) fn();
    perCall.push(elapsed(t) / batch);
  }
  if (perCall.length < MIN_SAMPLES) throw new TooSlow(opts.name, perCall.length, capMs);
  return { medianMs: median(perCall), samples: perCall.length };
}

export async function measureAsync(fn: () => Promise<unknown>, opts: { name: string; samples?: number; capMs?: number }): Promise<Measured> {
  const samples = opts.samples ?? SAMPLES;
  const capMs = opts.capMs ?? CAP_MS;
  const started = performance.now();
  for (let i = 0; i < WARMUP_CALLS && elapsed(started) < capMs / 4; i++) await fn();
  const perCall: number[] = [];
  while (perCall.length < samples && elapsed(started) < capMs) {
    const t = performance.now();
    await fn();
    perCall.push(elapsed(t));
  }
  if (perCall.length < MIN_SAMPLES) throw new TooSlow(opts.name, perCall.length, capMs);
  return { medianMs: median(perCall), samples: perCall.length };
}

export function referenceMs(): number {
  const numbers = Array.from({ length: 60_000 }, (_, i) => (i * 2654435761) % 1_000_003);
  return measureSync(() => [...numbers].sort((x, y) => x - y), { name: "reference", samples: 9, capMs: 4000 }).medianMs;
}

const recorded: Measurement[] = [];

let reference: number | undefined;

export function check(file: string, name: string, measured: Measured, budgetMs: number): void {
  const { medianMs, samples } = measured;
  reference ??= referenceMs();
  recorded.push({ name, medianMs, budgetMs, samples, referenceMs: reference });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `${file}.json`), `${JSON.stringify(recorded, null, 2)}\n`);
  expect(medianMs, `${name}: median ${medianMs.toFixed(3)} ms is over the ${budgetMs} ms budget in perf/budgets.json`).toBeLessThanOrEqual(budgetMs);
}
