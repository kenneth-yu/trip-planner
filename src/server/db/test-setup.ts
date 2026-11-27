import { readFile } from "node:fs/promises";
import { afterAll, inject } from "vitest";
import { startFromMigratedSnapshot } from "./client";
import { closeIsolatedPostgresDbs } from "./test-db";

startFromMigratedSnapshot(new Blob([await readFile(inject("migratedPgliteSnapshot"))]));

afterAll(closeIsolatedPostgresDbs);
