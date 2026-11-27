import { writeFileSync } from "node:fs";
import { startPerfServer } from "./server";

const server = await startPerfServer();
const out = process.argv[2];
if (!out) throw new Error("Pass the file to write the server address and token to.");
writeFileSync(out, `${JSON.stringify({ baseUrl: server.baseUrl, token: server.token })}\n`);
process.stdout.write(`serving ${server.baseUrl}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.stop().then(() => process.exit(0));
  });
}
setInterval(() => undefined, 1 << 30);
