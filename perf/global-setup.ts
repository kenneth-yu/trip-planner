import type { TestProject } from "vitest/node";
import { startPerfServer } from "./server";

declare module "vitest" {
  export interface ProvidedContext {
    perfBaseUrl: string;
    perfToken: string;
  }
}

export default async function setup(project: TestProject) {
  const server = await startPerfServer();
  project.provide("perfBaseUrl", server.baseUrl);
  project.provide("perfToken", server.token);
  return server.stop;
}
