/**
 * Hono 中间件：API 鉴权 + 审计日志 + 统一错误处理
 */
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppContext } from "./env";

/**
 * 访问控制中间件。
 *
 * 鉴权策略：
 *  - vault 未初始化（KV 无 vault:setup）→ 必须 APP_TOKEN（保护首次 setup 流程）
 *  - vault 已初始化                  → 跳过 APP_TOKEN 校验（用户已用主密码自证身份，
 *                                       所有 entry 仍加密，零知识不破）
 *  - AI 读取端点 /api/ai/fetch、/api/ai/share 始终使用独立 Token（见 routes/ai.ts）
 *  - /api/vault/config 也加入白名单（让前端无需 token 就能查 setup 状态决定 UI）
 */
const VAULT_SETUP_KEY = "vault:setup";

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  // 1. AI 读取端点放行
  if (
    c.req.path.startsWith("/api/ai/fetch") ||
    (c.req.method === "GET" && c.req.path.startsWith("/api/ai/share/"))
  ) {
    await next();
    return;
  }

  // 2. config / setup 接口放行（首次初始化流程不要求 Token）
  if (
    c.req.path === "/api/vault/config" ||
    c.req.path === "/api/vault/setup"
  ) {
    await next();
    return;
  }

  // 3. vault 已初始化 → 跳过 App Token 校验
  const setup = await c.env.KV.get(VAULT_SETUP_KEY);
  if (setup) {
    await next();
    return;
  }

  // 4. vault 未初始化 → 必须 App Token
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "未授权：缺少 Bearer 令牌" }, 401);
  }
  const token = auth.slice(7).trim();
  if (!c.env.APP_TOKEN || token !== c.env.APP_TOKEN) {
    return c.json({ ok: false, error: "令牌无效" }, 401);
  }
  await next();
});

/** 记录客户端 IP（从 CF-Connecting-IP 头读取） */
export const ipMiddleware = createMiddleware<AppContext>(async (c, next) => {
  c.set("ip", c.req.header("CF-Connecting-IP") ?? "unknown");
  await next();
});

/**
 * 记录审计日志到 D1（第十五章：所有访问必须记录）。
 * 即使业务失败也应尽量记录，因此用 `c.executionCtx.waitUntil` 异步写入。
 */
export function audit(
  c: Context<AppContext>,
  entryId: string | null,
  action: string,
  success: boolean,
  actor = "web",
): void {
  const ip = c.get("ip") || c.req.header("CF-Connecting-IP") || "unknown";
  const id = crypto.randomUUID();
  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(
        "INSERT INTO audit_logs (id, actor, ip, entry_id, action, success) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, actor, ip, entryId, action, success ? 1 : 0)
      .run(),
  );
}
