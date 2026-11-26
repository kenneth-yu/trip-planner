import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requestContext } from "@/server/app-context";
import { resolveAssistantToken } from "@/server/services/assistant-service";
import { createMcpServer } from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(request: Request, pathToken: string[] | undefined): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return pathToken?.[0] ?? null;
}

async function handle(request: Request, { params }: { params: Promise<{ token?: string[] }> }) {
  const ctx = await requestContext();
  const who = await resolveAssistantToken(ctx, tokenFrom(request, (await params).token));
  if (!who) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "This connection link is not valid. Make a new one in the trip's Connect page." }, id: null },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="trip-planner"' } },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createMcpServer(ctx, who).connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
