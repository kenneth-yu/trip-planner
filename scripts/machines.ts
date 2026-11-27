import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Machine } from "../src/domain/state/machine";

const machineShape = z.object({
  name: z.string(),
  title: z.string(),
  initial: z.string(),
  finals: z.array(z.string()),
  transitions: z.array(z.object({ from: z.string(), event: z.string(), to: z.string(), guard: z.string().optional() })),
});

const moduleShape = z.object({ machine: machineShape });

export const STATE_DIR = path.resolve(import.meta.dirname, "../src/domain/state");

export async function loadMachines(dir: string = STATE_DIR): Promise<Machine<string, string>[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".machine.ts"))
    .sort();
  const machines: Machine<string, string>[] = [];
  for (const file of files) {
    const loaded = await import(pathToFileURL(path.join(dir, file)).href);
    machines.push(moduleShape.parse(loaded).machine);
  }
  return machines;
}
