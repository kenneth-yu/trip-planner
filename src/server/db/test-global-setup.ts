import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { takeMigratedSnapshot } from "./client";

declare module "vitest" {
  export interface ProvidedContext {
    migratedPgliteSnapshot: string;
  }
}

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(tmpdir(), "trip-planner-pglite-"));
  const file = path.join(dir, "migrated.tar");
  const snapshot = await takeMigratedSnapshot();
  await writeFile(file, Buffer.from(await snapshot.arrayBuffer()));
  project.provide("migratedPgliteSnapshot", file);
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}
