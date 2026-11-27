import { afterAll } from "vitest";
import { closeIsolatedPostgresDbs } from "./test-db";

afterAll(closeIsolatedPostgresDbs);
