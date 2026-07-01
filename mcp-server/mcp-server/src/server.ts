/**
 * MCP Server 构建：注册 vault 分享读取相关的 tools。
 *
 * 注册的工具：
 *  - vault_fetch_share   提取并解密一个分享，返回明文
 *  - vault_inspect_share 仅查询分享元数据（剩余次数 / 过期 / 类型），不下发密文
 *
 * 零知识保证：
 *  MCP Server 只与 Vault 的 share-read 端点通信，下载密文后**在本地**用 4 位提取码
 *  派生密钥解密。整个过程中 Vault 服务器从未接触明文。
 *
 * 工作流：
 *  1. 用户在 Vault Web UI 生成 share_id + 4 位提取码
 *  2. 用户把 share_id 和 code 告诉 AI Agent（或通过 MCP 配置传入）
 *  3. Agent 调用 vault_fetch_share → Vault 返回密文 + salt + iv
 *  4. MCP server 本地用 PBKDF2 + AES-GCM 解密，返回明文
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchShare } from "./vault-client.js";
import { decryptWithShareCode } from "./crypto.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "ai-personal-vault",
    version: "0.1.0",
  });

  const shareIdSchema = z
    .string()
    .min(8)
    .describe("Vault 分享 ID（来自分享链接的最后一段路径）");

  const codeSchema = z
    .string()
    .regex(/^\d{4}$/, "提取码必须是 4 位数字")
    .describe("4 位数字提取码（百度网盘模式）");

  const vaultUrlSchema = z
    .string()
    .url()
    .optional()
    .describe(
      "Vault Worker URL，默认从 VAULT_URL 环境变量读取，否则 http://localhost:8788",
    );

  server.tool(
    "vault_fetch_share",
    [
      "从 AI Personal Vault 提取并解密一个分享。",
      "需要 share_id（来自分享链接）和 4 位提取码。",
      "Vault 服务器只返回密文 + IV + salt；本工具在本地用 PBKDF2 + AES-GCM 解密，",
      "整个过程中 Vault 服务器不会看到明文（零知识）。",
      "返回的 JSON：kind=single 时 data 是 {title, fields, notes}；",
      "kind=batch 时 data 是 {items: [...], files?: [...]}。",
    ].join(" "),
    {
      share_id: shareIdSchema,
      code: codeSchema,
      vault_url: vaultUrlSchema,
    },
    async ({ share_id, code, vault_url }) => {
      try {
        const fetched = await fetchShare(share_id, code, vault_url);
        const plaintext = await decryptWithShareCode(code, {
          ciphertext: fetched.ciphertext,
          iv: fetched.iv,
          salt: fetched.salt,
        });
        let parsed: unknown;
        try {
          parsed = JSON.parse(plaintext);
        } catch {
          parsed = plaintext;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  kind: fetched.kind ?? "single",
                  used_count: fetched.used_count,
                  remaining: fetched.remaining,
                  max_uses: fetched.max_uses,
                  entry_id: fetched.entry_id,
                  entry_title: fetched.entry_title,
                  item_count: fetched.item_count,
                  entry_ids: fetched.entry_ids,
                  data: parsed,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text", text: `提取失败：${(err as Error).message}` },
          ],
        };
      }
    },
  );

  server.tool(
    "vault_inspect_share",
    [
      "查询分享的元数据（剩余次数、过期、内容类型），不下发密文。",
      "适合在解密前先确认链接是否还有效、属于哪种分享类型。",
    ].join(" "),
    {
      share_id: shareIdSchema,
      code: codeSchema,
      vault_url: vaultUrlSchema,
    },
    async ({ share_id, code, vault_url }) => {
      try {
        const fetched = await fetchShare(share_id, code, vault_url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  kind: fetched.kind ?? "single",
                  used_count: fetched.used_count,
                  max_uses: fetched.max_uses,
                  remaining: fetched.remaining,
                  entry_id: fetched.entry_id,
                  entry_title: fetched.entry_title,
                  item_count: fetched.item_count,
                  entry_ids: fetched.entry_ids,
                  file_names: fetched.file_names,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            { type: "text", text: `查询失败：${(err as Error).message}` },
          ],
        };
      }
    },
  );

  return server;
}
