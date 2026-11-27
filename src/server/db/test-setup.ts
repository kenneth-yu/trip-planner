import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, inject } from "vitest";
import { startFromMigratedSnapshot } from "./client";
import { closeIsolatedPostgresDbs } from "./test-db";
import { finishFile, finishTest, startTest } from "./test-closers";

startFromMigratedSnapshot(new Blob([await readFile(inject("migratedPgliteSnapshot"))]));

beforeEach(startTest);
afterEach(finishTest);
afterAll(finishFile);
afterAll(closeIsolatedPostgresDbs);
