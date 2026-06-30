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

// ============================================================================
// AI 分享（百度网盘模式）：用户生成 share_id + 提取码，AI 本地解密
// ============================================================================
// POST /api/ai/share       用户创建分享（APP_TOKEN 鉴权）
// GET  /api/ai/share/:id   AI 提取（不需要 APP_TOKEN，需要正确提取码）
//
// 关键点：
//   - 浏览器用主密钥解密 entry 明文 → 提取码派生临时密钥 → 加密后上传
//   - 服务器只存密文，code 只存 SHA-256 哈希（避免 DB 泄露泄露提取码）
//   - 提取后 used_count+1，到 max_uses 后删除
//   - 过期后返回 410

interface ShareRow {
  id: string;
  entry_id: string;
  entry_title: string | null;
  code_hash: string;
  ciphertext: string;
  iv: string;
  salt: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  created_at: string;
}

const DEFAULT_TTL_SEC = 300; // 5 分钟
const DEFAULT_MAX_USES = 5;

// --- 用户创建分享（需 APP_TOKEN） ------------------------------------------
ai.post("/share", async (c) => {
  const body = await c.req.json<{
    entry_id: string;
    ciphertext: string;
    iv: string;
    salt: string;
    code_hash: string;
    ttl?: number;
    max_uses?: number;
  }>();

  const entry = await c.env.DB
    .prepare("SELECT id, title, deleted_at FROM entries WHERE id=?")
    .bind(body.entry_id)
    .first<{ id: string; title: string; deleted_at: string | null }>();
  if (!entry || entry.deleted_at) {
    return c.json({ ok: false, error: "Entry 不存在" }, 404);
  }

  const id = crypto.randomUUID().replaceAll("-", "");
  const ttl = body.ttl ?? DEFAULT_TTL_SEC;
  const maxUses = body.max_uses ?? DEFAULT_MAX_USES;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await c.env.DB
    .prepare(
      `INSERT INTO ai_shares
       (id, entry_id, entry_title, code_hash, ciphertext, iv, salt, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      body.entry_id,
      entry.title,
      body.code_hash,
      body.ciphertext,
      body.iv,
      body.salt,
      expiresAt,
      maxUses,
    )
    .run();

  audit(c, body.entry_id, `ai-share-create`, true);
  return c.json({
    ok: true,
    data: {
      share_id: id,
      expires_at: expiresAt,
      max_uses: maxUses,
      ttl,
    },
  });
});

// --- AI 提取分享（不要 APP_TOKEN，用提取码） --------------------------------
ai.get("/share/:shareId", async (c) => {
  const shareId = c.req.param("shareId");
  const code = c.req.query("code") ?? c.req.header("X-Share-Code") ?? "";
  if (!code) {
    audit(c, null, "ai-share-fetch", false, "ai");
    return c.json({ ok: false, error: "缺少 code 提取码" }, 401);
  }

  const row = await c.env.DB
    .prepare("SELECT * FROM ai_shares WHERE id=?")
    .bind(shareId)
    .first<ShareRow>();
  if (!row) {
    audit(c, null, "ai-share-fetch:not-found", false, "ai");
    return c.json({ ok: false, error: "分享链接不存在或已删除" }, 404);
  }
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare("DELETE FROM ai_shares WHERE id=?").bind(shareId).run();
    audit(c, row.entry_id, "ai-share-fetch:expired", false, "ai");
    return c.json({ ok: false, error: "分享链接已过期" }, 410);
  }
  if (row.used_count >= row.max_uses) {
    await c.env.DB.prepare("DELETE FROM ai_shares WHERE id=?").bind(shareId).run();
    audit(c, row.entry_id, "ai-share-fetch:exhausted", false, "ai");
    return c.json({ ok: false, error: "提取次数已用完" }, 410);
  }

  // 验证提取码（SHA-256 哈希比对，常时比较避免时序攻击）
  const codeHash = await sha256Hex(code);
  if (
    codeHash.length !== row.code_hash.length ||
    !constantTimeEqual(codeHash, row.code_hash)
  ) {
    audit(c, row.entry_id, "ai-share-fetch:bad-code", false, "ai");
    return c.json({ ok: false, error: "提取码错误" }, 401);
  }

  // 递增使用次数
  const newCount = row.used_count + 1;
  if (newCount >= row.max_uses) {
    await c.env.DB.prepare("DELETE FROM ai_shares WHERE id=?").bind(shareId).run();
  } else {
    await c.env.DB
      .prepare("UPDATE ai_shares SET used_count=? WHERE id=?")
      .bind(newCount, shareId)
      .run();
  }
  audit(c, row.entry_id, `ai-share-fetch:ok[${newCount}/${row.max_uses}]`, true, "ai");

  return c.json({
    ok: true,
    data: {
      entry_id: row.entry_id,
      entry_title: row.entry_title,
      ciphertext: row.ciphertext,
      iv: row.iv,
      salt: row.salt,
      used_count: newCount,
      max_uses: row.max_uses,
      remaining: row.max_uses - newCount,
    },
  });
});

/** 常时字符串比较，避免时序攻击泄露哈希前缀 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
