/**
 * Hono 中间件：API 鉴权 + 审计日志 + 统一错误处理
 */
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppContext } from "./env";

/**
 * 访问控制中间件。
 *
 * MVP 采用「应用令牌」方案：部署者通过 `wrangler secret put APP_TOKEN`
 * 设置随机令牌，前端在请求头携带 `Authorization: Bearer <token>`。
 * 主密码本身永不上传，仅用于浏览器端派生加密密钥（Zero Knowledge）。
 *
 * 生产环境强烈建议叠加 Cloudflare Access 做身份层防护。
 */
export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
  // AI 读取端点使用独立的临时 Token 鉴权（见 routes/ai.ts），不走 APP_TOKEN
  if (
    c.req.path.startsWith("/api/ai/fetch") ||
    (c.req.method === "GET" && c.req.path.startsWith("/api/ai/share/"))
  ) {
    await next();
    return;
  }
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
