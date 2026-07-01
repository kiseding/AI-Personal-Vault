/**
 * HTTP 传输：把 MCP Server 暴露为 HTTP 端点（默认 :8789/mcp）。
 *
 * 使用 StreamableHTTPServerTransport 的无状态模式（sessionIdGenerator=undefined）：
 *  - 适合远程 Agent 短期调用
 *  - 无会话状态，每次请求独立
 *  - 生产环境建议前面套 Cloudflare Access / TLS 终结
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export async function startHttp(server: McpServer, port: number): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );
      if (url.pathname === "/mcp" || url.pathname === "/") {
        await handleMcp(req, res, transport);
      } else if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
      } else {
        res.writeHead(404).end("Not Found");
      }
    } catch (err) {
      console.error("[vault-mcp] http handler error:", err);
      if (!res.headersSent) res.writeHead(500).end("internal error");
    }
  });

  httpServer.listen(port, () => {
    console.error(
      `[vault-mcp] HTTP transport listening on http://localhost:${port}/mcp`,
    );
  });
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  transport: StreamableHTTPServerTransport,
): Promise<void> {
  // StreamableHTTPServerTransport 内部会接管 req/res，调用方不需要手动读取 body
  await transport.handleRequest(req, res);
}
