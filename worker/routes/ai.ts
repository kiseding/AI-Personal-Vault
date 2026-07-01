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
 *
 * 批量分享（0003 迁移）：
 *   POST /api/ai/share 增加 kind=batch 分支，支持一次性分享多个 entry + 可选附件。
 *   bundle 在浏览器侧用提取码派生密钥加密后整体上传，服务器零知识保持。
 *
 * feat/mobile-hardening：
 *  - DEFAULT_MAX_USES 5→3：单分享可提取次数降低（与 4→6 位提取码搭配收紧）
 *  - MAX_BUNDLE_B64=5MB：客户端 / 服务端统一"明文 ≈ 5MB"的上限，
 *    服务端按 base64 长度硬卡，413 早返
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
//   - kind=single: 浏览器用主密钥解密 entry → 提取码派生密钥加密密文 → 上传
//   - kind=batch:  浏览器解密 N 个 entry + 可选附件 → 打包成 bundle JSON
//                  → 用提取码派生密钥加密 bundle → 上传
//   - 服务器只存密文，code 只存 SHA-256 哈希（避免 DB 泄露泄露提取码）
//   - 提取后 used_count+1，到 max_uses 后删除
//   - 过期后返回 410
//
// 安全（feat/mobile-hardening）：
//  - 提取码 4→6 位（生成端在 src/web/crypto.ts，校验端放宽为 4-6 位兼容旧分享）
//  - DEFAULT_MAX_USES 5→3（防 botnet 在 5 分钟 TTL 内爆破）
//  - bundle 上限以 base64 长度计算，与客户端估算口径一致

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
  kind: string;
  item_count: number;
  entry_ids_json: string | null;
  entry_titles_json: string | null;
  files_json: string | null;
}

interface FileMetaInput {
  name: string;
  mime: string;
  size: number;
  ciphertext: string;
  iv: string;
}

const DEFAULT_TTL_SEC = 300; // 5 分钟
const DEFAULT_MAX_USES = 3; // feat/mobile-hardening: 5→3，与 6 位提取码共同收紧抗爆破
const MAX_BUNDLE_B64 = 5 * 1024 * 1024; // 5 MB base64 密文，与客户端估算口径一致

// --- 用户创建分享（需 APP_TOKEN） ------------------------------------------
ai.post("/share", async (c) => {
  const body = await c.req.json<{
    kind?: "single" | "batch";
    // single 模式
    entry_id?: string;
    // batch 模式
    entry_ids?: string[];
    // 通用：密文 + 提取码材料
    ciphertext: string;
    iv: string;
    salt: string;
    code_hash: string;
    // batch 可选附件（仅元信息，密文内嵌 bundle）
    files?: FileMetaInput[];
    // 控制
    ttl?: number;
    max_uses?: number;
  }>();

  const kind = body.kind ?? "single";
  const ttl = body.ttl ?? DEFAULT_TTL_SEC;
  const maxUses = body.max_uses ?? DEFAULT_MAX_USES;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  // 大小硬卡：base64 长度上限 5MB（明文 ≈ 5MB）
  if (body.ciphertext.length > MAX_BUNDLE_B64) {
    return c.json(
      {
        ok: false,
        error: `分享过大（超过 ${MAX_BUNDLE_B64 / 1024 / 1024}MB），请减少条目或附件`,
      },
      413,
    );
  }

  let primaryEntryId: string;
  let primaryEntryTitle: string;
  let itemCount = 1;
  let entryIdsJson: string | null = null;
  let entryTitlesJson: string | null = null;
  let filesJson: string | null = null;

  if (kind === "single") {
    if (!body.entry_id) {
      return c.json({ ok: false, error: "single 分享需要 entry_id" }, 400);
    }
    const entry = await c.env.DB
      .prepare("SELECT id, title, deleted_at FROM entries WHERE id=?")
      .bind(body.entry_id)
      .first<{ id: string; title: string; deleted_at: string | null }>();
    if (!entry || entry.deleted_at) {
      return c.json({ ok: false, error: "Entry 不存在" }, 404);
    }
    primaryEntryId = entry.id;
    primaryEntryTitle = entry.title;
  } else if (kind === "batch") {
    if (!body.entry_ids || body.entry_ids.length === 0) {
      return c.json(
        { ok: false, error: "batch 分享至少需要 1 个 entry_id" },
        400,
      );
    }
    if (body.entry_ids.length > 100) {
      return c.json({ ok: false, error: "批量最多 100 条 entry" }, 400);
    }
    const placeholders = body.entry_ids.map(() => "?").join(",");
    const rows = await c.env.DB
      .prepare(
        `SELECT id, title, deleted_at FROM entries WHERE id IN (${placeholders})`,
      )
      .bind(...body.entry_ids)
      .all<{ id: string; title: string; deleted_at: string | null }>();
    if (rows.results.length !== body.entry_ids.length) {
      return c.json({ ok: false, error: "部分 entry 不存在" }, 404);
    }
    if (rows.results.some((r) => r.deleted_at)) {
      return c.json({ ok: false, error: "包含已删除的 entry" }, 400);
    }
    primaryEntryId = body.entry_ids[0]; // 用于审计
    const titles = rows.results.map((r) => r.title);
    primaryEntryTitle =
      titles.length <= 3
        ? titles.join(", ")
        : `${titles.slice(0, 3).join(", ")} 等 ${titles.length} 条`;
    itemCount = body.entry_ids.length;
    entryIdsJson = JSON.stringify(body.entry_ids);
    entryTitlesJson = JSON.stringify(titles);
    if (body.files && body.files.length > 0) {
      filesJson = JSON.stringify(
        body.files.map((f) => ({
          name: f.name,
          mime: f.mime,
          size: f.size,
        })),
      );
    }
  } else {
    return c.json({ ok: false, error: "未知 kind" }, 400);
  }

  const id = crypto.randomUUID().replaceAll("-", "");

  await c.env.DB
    .prepare(
      `INSERT INTO ai_shares
       (id, entry_id, entry_title, code_hash, ciphertext, iv, salt, expires_at, max_uses,
        kind, item_count, entry_ids_json, entry_titles_json, files_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      primaryEntryId,
      primaryEntryTitle,
      body.code_hash,
      body.ciphertext,
      body.iv,
      body.salt,
      expiresAt,
      maxUses,
      kind,
      itemCount,
      entryIdsJson,
      entryTitlesJson,
      filesJson,
    )
    .run();

  audit(c, primaryEntryId, `ai-share-create:${kind}`, true);
  return c.json({
    ok: true,
    data: {
      share_id: id,
      expires_at: expiresAt,
      max_uses: maxUses,
      ttl,
      kind,
      item_count: itemCount,
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
  audit(
    c,
    row.entry_id,
    `ai-share-fetch:ok[${newCount}/${row.max_uses}]`,
    true,
    "ai",
  );

  const data: Record<string, unknown> = {
    entry_id: row.entry_id,
    entry_title: row.entry_title,
    ciphertext: row.ciphertext,
    iv: row.iv,
    salt: row.salt,
    used_count: newCount,
    max_uses: row.max_uses,
    remaining: row.max_uses - newCount,
  };
  // 批量分享附加元数据
  if (row.kind === "batch") {
    data.kind = "batch";
    data.item_count = row.item_count;
    data.entry_ids = row.entry_ids_json ? JSON.parse(row.entry_ids_json) : [];
    data.entry_titles = row.entry_titles_json
      ? JSON.parse(row.entry_titles_json)
      : [];
    data.file_names = row.files_json
      ? (JSON.parse(row.files_json) as Array<{ name: string }>).map(
          (f) => f.name,
        )
      : [];
  }
  return c.json({ ok: true, data });
});

/** 常时字符串比较，避免时序攻击泄露哈希前缀 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- 列出所有分享（管理用，需主鉴权） ---------------------------------------
// 返回所有未过期的分享，附带是否已用完的标记
ai.get("/shares", async (c) => {
  const res = await c.env.DB
    .prepare(
      `SELECT id, entry_id, entry_title, expires_at, max_uses, used_count, created_at,
              kind, item_count,
              CASE WHEN expires_at < datetime('now') THEN 1 ELSE 0 END as is_expired
       FROM ai_shares
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all<
      Pick<
        ShareRow,
        | "id"
        | "entry_id"
        | "entry_title"
        | "expires_at"
        | "max_uses"
        | "used_count"
        | "created_at"
        | "kind"
        | "item_count"
      > & { is_expired: number }
    >();
  return c.json({ ok: true, data: res.results });
});

// --- 撤销分享（用户主动删除）-------------------------------------------------
ai.delete("/share/:shareId", async (c) => {
  const shareId = c.req.param("shareId");
  const row = await c.env.DB
    .prepare("SELECT entry_id FROM ai_shares WHERE id=?")
    .bind(shareId)
    .first<{ entry_id: string }>();
  if (!row) return c.json({ ok: false, error: "分享不存在" }, 404);
  await c.env.DB.prepare("DELETE FROM ai_shares WHERE id=?").bind(shareId).run();
  audit(c, row.entry_id, `ai-share-revoke`, true);
  return c.json({ ok: true });
});
