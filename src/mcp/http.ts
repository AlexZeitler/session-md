/**
 * session-md MCP HTTP Transport
 *
 * Streamable HTTP server with session management, health endpoint,
 * and daemon support. Pattern follows qmd's implementation.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, createSessionStore, type SessionStore } from "./server.ts";

export type HttpServerHandle = {
  httpServer: import("http").Server;
  port: number;
  stop: () => Promise<void>;
};

export async function startMcpHttpServer(
  port: number,
  options?: { quiet?: boolean },
): Promise<HttpServerHandle> {
  const store = await createSessionStore();

  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  async function createSession(): Promise<WebStandardStreamableHTTPServerTransport> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId: string) => {
        sessions.set(sessionId, transport);
        log(`${ts()} New session ${sessionId} (${sessions.size} active)`);
      },
    });
    const server = await createMcpServer(store);
    await server.connect(transport);

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    return transport;
  }

  const startTime = Date.now();
  const quiet = options?.quiet ?? false;

  function ts(): string {
    return new Date().toISOString().slice(11, 23);
  }

  function describeRequest(body: any): string {
    const method = body?.method ?? "unknown";
    if (method === "tools/call") {
      const tool = body.params?.name ?? "?";
      const args = body.params?.arguments;
      if (args?.query) {
        const q = String(args.query).slice(0, 80);
        return `tools/call ${tool} "${q}"`;
      }
      if (args?.id) return `tools/call ${tool} ${args.id}`;
      return `tools/call ${tool}`;
    }
    return method;
  }

  function log(msg: string): void {
    if (!quiet) console.error(msg);
  }

  async function collectBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString();
  }

  const httpServer = createServer(
    async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
      const reqStart = Date.now();
      const pathname = nodeReq.url || "/";

      try {
        // GET /health
        if (pathname === "/health" && nodeReq.method === "GET") {
          const body = JSON.stringify({
            status: "ok",
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessions: sessions.size,
            indexed: store.sessions.length,
          });
          nodeRes.writeHead(200, { "Content-Type": "application/json" });
          nodeRes.end(body);
          log(`${ts()} GET /health (${Date.now() - reqStart}ms)`);
          return;
        }

        // POST /mcp — MCP Streamable HTTP
        if (pathname === "/mcp" && nodeReq.method === "POST") {
          const rawBody = await collectBody(nodeReq);
          const body = JSON.parse(rawBody);
          const label = describeRequest(body);
          const url = `http://localhost:${port}${pathname}`;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(nodeReq.headers)) {
            if (typeof v === "string") headers[k] = v;
          }

          const sessionId = headers["mcp-session-id"];
          let transport: WebStandardStreamableHTTPServerTransport;

          if (sessionId) {
            const existing = sessions.get(sessionId);
            if (!existing) {
              nodeRes.writeHead(404, { "Content-Type": "application/json" });
              nodeRes.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: { code: -32001, message: "Session not found" },
                  id: body?.id ?? null,
                }),
              );
              return;
            }
            transport = existing;
          } else if (isInitializeRequest(body)) {
            transport = await createSession();
          } else {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: Missing session ID",
                },
                id: body?.id ?? null,
              }),
            );
            return;
          }

          const request = new Request(url, {
            method: "POST",
            headers,
            body: rawBody,
          });
          const response = await transport.handleRequest(request, {
            parsedBody: body,
          });

          nodeRes.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          nodeRes.end(Buffer.from(await response.arrayBuffer()));
          log(`${ts()} POST /mcp ${label} (${Date.now() - reqStart}ms)`);
          return;
        }

        // GET/DELETE /mcp — session-bound
        if (pathname === "/mcp") {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(nodeReq.headers)) {
            if (typeof v === "string") headers[k] = v;
          }

          const sessionId = headers["mcp-session-id"];
          if (!sessionId) {
            nodeRes.writeHead(400, { "Content-Type": "application/json" });
            nodeRes.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: Missing session ID",
                },
                id: null,
              }),
            );
            return;
          }

          const transport = sessions.get(sessionId);
          if (!transport) {
            nodeRes.writeHead(404, { "Content-Type": "application/json" });
            nodeRes.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32001, message: "Session not found" },
                id: null,
              }),
            );
            return;
          }

          const url = `http://localhost:${port}${pathname}`;
          const rawBody =
            nodeReq.method !== "GET" && nodeReq.method !== "HEAD"
              ? await collectBody(nodeReq)
              : undefined;
          const request = new Request(url, {
            method: nodeReq.method || "GET",
            headers,
            ...(rawBody ? { body: rawBody } : {}),
          });
          const response = await transport.handleRequest(request);
          nodeRes.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          nodeRes.end(Buffer.from(await response.arrayBuffer()));
          return;
        }

        nodeRes.writeHead(404);
        nodeRes.end("Not Found");
      } catch (err) {
        console.error("HTTP handler error:", err);
        nodeRes.writeHead(500);
        nodeRes.end("Internal Server Error");
      }
    },
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, "localhost", () => resolve());
  });

  const actualPort = (httpServer.address() as import("net").AddressInfo).port;

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const transport of sessions.values()) {
      await transport.close();
    }
    sessions.clear();
    httpServer.close();
    store.searchIndex.close();
  };

  process.on("SIGTERM", async () => {
    console.error("Shutting down (SIGTERM)...");
    await stop();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    console.error("Shutting down (SIGINT)...");
    await stop();
    process.exit(0);
  });

  log(
    `session-md MCP server listening on http://localhost:${actualPort}/mcp`,
  );
  return { httpServer, port: actualPort, stop };
}
