/**
 * AI Personal Vault - Cloudflare Worker 主入口
 *
 * 架构：
 *  - /api/*  → Hono API（鉴权后访问 D1 / R2 / KV）
 *  - 其余路径 → 静态资源（React SPA，由 @cloudflare/vite-plugin 托管，
 *               wrangler.jsonc 中 not_found_handling=single-page-application）
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppContext } from "./env";
import {
  authMiddleware,
  ipMiddleware,
  securityHeaders,
  rateLimit,
  DEFAULT_RULES,
} from "./middleware";
import { entries } from "./routes/entries";
import { vault } from "./routes/vault";
import { attachments } from "./routes/attachments";
import { ai } from "./routes/ai";

const app = new Hono<AppContext>();

app.use("*", logger());

// 所有 API 依次经过：IP 提取 → 安全响应头 → 限流 → 鉴权
// 安全头放在最前，确保 401/429 响应也带上 CSP/HSTS 等头
app.use("/api/*", ipMiddleware);
app.use("/api/*", securityHeaders());
app.use("/api/*", rateLimit(DEFAULT_RULES));
app.use("/api/*", authMiddleware);

// 健康检查
app.get("/api/health", (c) =>
  c.json({ ok: true, time: new Date().toISOString() }),
);

// 保险库配置 / 标签 / 统计 / 审计
app.route("/api/vault", vault);

// Entry CRUD + 版本 + 回收站
app.route("/api/entries", entries);

// 附件（路径含 /entries/:id/attachments 与 /attachments/:aid）
app.route("/api", attachments);

// AI Access：授权 / Token / 读取
app.route("/api/ai", ai);

export default app;
