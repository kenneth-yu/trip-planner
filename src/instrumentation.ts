import { serverEnv } from "@/server/env";
import { trustProxy } from "@/server/security/trust-proxy";

export function register() {
  trustProxy(process.env);
  serverEnv();
}
