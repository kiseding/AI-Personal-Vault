#!/usr/bin/env node
/**
 * AI Personal Vault MCP Server - 入口
 *
 * 启动方式：
 *  - stdio（默认）：被 AI Agent CLI 拉起，通过 stdin/stdout 通信
 *      npx -y ai-personal-vault-mcp
 *
 *  - HTTP：暴露为 HTTP 端点供远程 Agent 通过 streamable HTTP 调用
 *      MCP_TRANSPORT=http PORT=8789 npx -y ai-personal-vault-mcp
 *
 * 关键环境变量：
 *  - VAULT_URL       Vault Worker 部署地址，默认 http://localhost:8788
 *  - MCP_TRANSPORT   "stdio" | "http"，默认 stdio
 *  - PORT            HTTP 模式监听端口，默认 8789
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { startHttp } from "./http.js";

async function main(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT ?? "stdio";
  const server = buildServer();

  if (transport === "stdio") {
    const t = new StdioServerTransport();
    await server.connect(t);
    console.error("[vault-mcp] running on stdio");
  } else if (transport === "http") {
    const port = Number(process.env.PORT ?? 8789);
    await startHttp(server, port);
  } else {
    console.error(`[vault-mcp] unknown MCP_TRANSPORT=${transport}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[vault-mcp] fatal:", err);
  process.exit(1);
});
