# AI Personal Vault — MCP Server

让 AI Agent（Claude Code / Codex CLI / Cursor / OpenCode / Gemini CLI / GitHub Copilot）通过 [Model Context Protocol](https://modelcontextprotocol.io) 直接读取你用 AI Personal Vault 显式分享的内容。

**零知识保持**：MCP Server 只与 Vault 的 share-read 端点通信，下载密文后**在本地**用 4 位提取码派生密钥解密，Vault 服务器从未接触明文。

## Tools

| Tool | 用途 |
| --- | --- |
| `vault_fetch_share` | 提取并解密一个分享（链接 + 4 位提取码），返回明文 |
| `vault_inspect_share` | 仅查询分享元数据（剩余次数、过期、类型），不下发密文 |

## 安装与运行

```bash
cd mcp-server
npm install
npm run build

# stdio 模式（被 AI Agent CLI 拉起）
node dist/index.js

# HTTP 模式（远程 Agent 通过 streamable HTTP 调用）
MCP_TRANSPORT=http PORT=8789 node dist/index.js
```

## 与 AI Agent 集成

### Claude Code / Codex CLI

在项目的 MCP 配置（`.mcp.json` 或 `~/.config/claude-code/mcp_servers.json` 等）加入：

```json
{
  "mcpServers": {
    "vault": {
      "command": "node",
      "args": ["/abs/path/to/AI-Personal-Vault/mcp-server/dist/index.js"],
      "env": {
        "VAULT_URL": "https://your-vault.example.workers.dev"
      }
    }
  }
}
```

### Cursor

`Settings → MCP → Add new global MCP server`，command 同上。

### HTTP 模式远程接入

```bash
MCP_TRANSPORT=http PORT=8789 \
  VAULT_URL=https://your-vault.example.workers.dev \
  node dist/index.js
```

远程 Agent 通过 `http://host:8789/mcp` 调用。生产环境建议：

- 前置 Cloudflare Access 做身份层
 或只在受信内网暴露 8789 端口
- 必须 HTTPS 终结（Cloudflare Tunnel / nginx / Caddy）

## 工作流示例

1. 在 Vault Web UI 打开某个 entry → 🔗 分享 → 选 TTL / max_uses → 生成链接
2. 把 `share_id`（从链接里取最后一段）和 4 位提取码告诉 AI Agent
3. Agent 调用 `vault_fetch_share(share_id, code)` → 拿到明文
4. 链接用尽或过期后自动失效

Agent 端的伪代码：

```
// 1) 让用户告知 share_id 和 code（或从环境变量读）
const code = process.env.VAULT_SHARE_CODE;
const shareId = process.env.VAULT_SHARE_ID;

// 2) 通过 MCP 调用
const result = await mcp.call("vault_fetch_share", { share_id: shareId, code });
console.log(result.data); // { title, fields, notes }

// 3) 用完后立即丢弃
delete process.env.VAULT_SHARE_CODE;
```

## 安全说明

- MCP Server 仅作为本地解密代理，**不持久化任何密钥或密文**
- 4 位提取码空间 10000，配合服务端 PBKDF2 100k 迭代（约 100ms/次）+ 限流（10/min/IP+share_id），纯暴力不可行
- 提取后立即 `used_count + 1`，达到 `max_uses` 后服务端自动删除
- Vault 仍保持零知识：服务器只存密文 + salt + iv + code_hash

## 限制

- 当前仅支持 share-link（百度网盘）模式；`X-AI-Token` 模式需要 AI 持有主密钥的派生密钥，尚未实现
- stdio 模式下，AI Agent 与 Vault 之间无中间人；HTTP 模式必须部署在内网或加 Cloudflare Access
- 不支持离线缓存：每次 fetch_share 都会触发 Vault 端的一次 share-read

## 开发

```bash
npm install
npm run dev      # tsx 热跑
npm run build    # tsc 编译到 dist/
```
