/**
 * AI Access 路由（第十五章「AI Access」- 本项目最大特色）
 *
 * 流程：
 *   1. 用户为每个 Entry 设置 Agent 权限（never / ask / always）
 *   2. 用户通过 Web 生成临时 Token（TTL 30s/60s/5min，单次有效）
 *   3. AI Agent 用 Token 调用 /api/ai/fetch/:entryId 读取密文
 *   4. 所有访问记录审计日志（时间/Agent/IP/Entry/成功失败）
 *
 * 服务器始终只返回密文；AI Agent 用用户预先派生的共享密钥本地解密。
 */
import { Hono } from "hono";
import type { AppContext } from "../env";
import { audit } from "../middleware";
import type { AiAgent, AiPermission } from "../../src/shared/types";

export const ai = new Hono<AppContext>();

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface GrantRow {
  id: string;
  entry_id: string;
  agent: string;
  permission: string;
  created_at: string;
  expires_at: string | null;
}

interface TokenRow {
  token_hash: string;
  entry_id: string;
  agent: string;
  expires_at: string;
  used: number;
  created_at: string;
}

// --- 查看 entry 的所有 Agent 授权 -------------------------------------------
ai.get("/grants/:entryId", async (c) => {
  const entryId = c.req.param("entryId");
  const res = await c.env.DB
    .prepare("SELECT * FROM ai_grants WHERE entry_id=?")
    .bind(entryId)
    .all<GrantRow>();
  return c.json({ ok: true, data: res.results });
});

// --- 设置/更新授权（upsert）--------------------------------------------------
ai.put("/grants/:entryId", async (c) => {
  const entryId = c.req.param("entryId");
  const { agent, permission } = await c.req.json<{
    agent: AiAgent;
    permission: AiPermission;
  }>();
  await c.env.DB
    .prepare("DELETE FROM ai_grants WHERE entry_id=? AND agent=?")
    .bind(entryId, agent)
    .run();
  await c.env.DB
    .prepare(
      "INSERT INTO ai_grants (id, entry_id, agent, permission) VALUES (?,?,?,?)",
    )
    .bind(crypto.randomUUID(), entryId, agent, permission)
    .run();
  audit(c, entryId, `ai-grant:${agent}:${permission}`, true);
  return c.json({ ok: true });
});

// --- 删除授权 ---------------------------------------------------------------
ai.delete("/grants/:entryId/:agent", async (c) => {
  const entryId = c.req.param("entryId");
  const agent = c.req.param("agent");
  await c.env.DB
    .prepare("DELETE FROM ai_grants WHERE entry_id=? AND agent=?")
    .bind(entryId, agent)
    .run();
  audit(c, entryId, `ai-grant-delete:${agent}`, true);
  return c.json({ ok: true });
});

// --- 生成临时 Token（用户通过 Web 生成，需主鉴权）-------------------------
ai.post("/token", async (c) => {
  const { entry_id, agent, ttl } = await c.req.json<{
    entry_id: string;
    agent: AiAgent;
    ttl: number;
  }>();
  const grant = await c.env.DB
    .prepare("SELECT permission FROM ai_grants WHERE entry_id=? AND agent=?")
    .bind(entry_id, agent)
    .first<{ permission: string }>();
  if (!grant || grant.permission === "never") {
    return c.json({ ok: false, error: "该 Agent 无访问权限" }, 403);
  }
  const token =
    crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await c.env.DB
    .prepare(
      "INSERT INTO ai_tokens (token_hash, entry_id, agent, expires_at) VALUES (?,?,?,?)",
    )
    .bind(tokenHash, entry_id, agent, expiresAt)
    .run();
  audit(c, entry_id, `ai-token:${agent}`, true);
  return c.json({ ok: true, data: { token, expires_at: expiresAt } });
});

// --- AI 读取（用临时 Token 鉴权，返回密文 entry）--------------------------
// 此端点不经 APP_TOKEN 鉴权（见 middleware.ts 放行逻辑），改用临时 Token。
ai.get("/fetch/:entryId", async (c) => {
  const entryId = c.req.param("entryId");
  const token =
    c.req.header("X-AI-Token") ?? c.req.query("token") ?? "";
  if (!token) {
    audit(c, entryId, "ai-fetch", false, "ai");
    return c.json({ ok: false, error: "缺少 X-AI-Token" }, 401);
  }
  const tokenHash = await sha256Hex(token);
  const tk = await c.env.DB
    .prepare("SELECT * FROM ai_tokens WHERE token_hash=? AND used=0")
    .bind(tokenHash)
    .first<TokenRow>();
  if (!tk) {
    audit(c, entryId, "ai-fetch", false, "ai");
    return c.json({ ok: false, error: "Token 无效或已使用" }, 401);
  }
  if (new Date(tk.expires_at) < new Date()) {
    audit(c, entryId, "ai-fetch-expired", false, tk.agent);
    return c.json({ ok: false, error: "Token 已过期" }, 401);
  }
  if (tk.entry_id !== entryId) {
    audit(c, entryId, "ai-fetch-mismatch", false, tk.agent);
    return c.json({ ok: false, error: "Token 与 Entry 不匹配" }, 403);
  }
  // 标记已使用（单次授权）
  await c.env.DB
    .prepare("UPDATE ai_tokens SET used=1 WHERE token_hash=?")
    .bind(tokenHash)
    .run();
  const entry = await c.env.DB
    .prepare("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL")
    .bind(entryId)
    .first();
  audit(c, entryId, "ai-fetch", true, tk.agent);
  return c.json({ ok: true, data: entry });
});
