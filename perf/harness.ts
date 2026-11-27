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
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (high === undefined) throw new Error("Cannot take the median of no samples.");
  return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

export function measureSync(fn: () => unknown, opts: { samples: number; batch: number; warmup: number }): number {
  for (let i = 0; i < opts.warmup; i++) fn();
  const perCall: number[] = [];
  for (let s = 0; s < opts.samples; s++) {
    const start = performance.now();
    for (let i = 0; i < opts.batch; i++) fn();
    perCall.push((performance.now() - start) / opts.batch);
  }
  return median(perCall);
}

export async function measureAsync(fn: () => Promise<unknown>, opts: { samples: number; warmup: number }): Promise<number> {
  for (let i = 0; i < opts.warmup; i++) await fn();
  const perCall: number[] = [];
  for (let s = 0; s < opts.samples; s++) {
    const start = performance.now();
    await fn();
    perCall.push(performance.now() - start);
  }
  return median(perCall);
}

const recorded: Measurement[] = [];

export function check(file: string, name: string, medianMs: number, budgetMs: number, samples: number): void {
  recorded.push({ name, medianMs, budgetMs, samples });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `${file}.json`), `${JSON.stringify(recorded, null, 2)}\n`);
  expect(medianMs, `${name}: median ${medianMs.toFixed(3)} ms is over the ${budgetMs} ms budget in perf/budgets.json`).toBeLessThanOrEqual(budgetMs);
}
