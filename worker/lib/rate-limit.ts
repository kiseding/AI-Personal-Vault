/**
 * 基于 Cloudflare KV 的固定窗口限流中间件。
 *
 * 设计要点：
 *  - 固定窗口（窗口大小 = windowSec 秒），key 内含窗口起点便于 TTL 自清理
 *  - 每次匹配限流规则消耗 1 次 KV 读 + 1 次 KV 写
 *  - 可选 paramGroup：通过正则捕获组提取 path 中的 ID（如 share_id），
 *    用于「同一 share_id 的失败尝试独立计数」
 *  - 超限返回 429 + Retry-After + 标准 X-RateLimit-* 头
 *
 * 配额提示：KV 免费配额为 1K 写/天。本规则只覆盖写/高风险接口，
 * 单用户日活通常 < 100 次写，远低于限额。若运行在 Workers Paid
 * （$5/月，1M 写/天）可继续扩展到读路径。
 */
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../env";

export interface RateLimitRule {
  /** 名称：用于 key 命名空间隔离 */
  name: string;
  /** HTTP 方法，"ANY" 表示任意 */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";
  /** 路径匹配正则（必须以 ^\/api\/... 开头） */
  pathPattern: RegExp;
  /** 正则捕获组索引（1-based）；命中后该组内容作为 key 的一部分 */
  paramGroup?: number;
  /** 窗口内允许的最大请求数 */
  max: number;
  /** 窗口大小（秒） */
  windowSec: number;
}

export function rateLimit(rules: RateLimitRule[]) {
  return createMiddleware<AppContext>(async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;
    const rule = rules.find(
      (r) =>
        (r.method === "ANY" || r.method === method) &&
        r.pathPattern.test(path),
    );
    if (!rule) {
      await next();
      return;
    }

    const ip = c.get("ip") || c.req.header("CF-Connecting-IP") || "unknown";
    const idPart =
      rule.paramGroup != null
        ? (path.match(rule.pathPattern)?.[rule.paramGroup] ?? "")
        : "";
    const windowStart =
      Math.floor(Date.now() / 1000 / rule.windowSec) * rule.windowSec;
    const key = `rl:${rule.name}:${ip}:${idPart}:${windowStart}`;
    const cur = parseInt((await c.env.KV.get(key)) ?? "0", 10) + 1;
    // TTL 留 2 倍窗口，避免跨边界请求读到空窗口导致计数错乱
    await c.env.KV.put(key, String(cur), {
      expirationTtl: rule.windowSec * 2,
    });

    c.header("X-RateLimit-Limit", String(rule.max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, rule.max - cur)));
    c.header("X-RateLimit-Reset", String(windowStart + rule.windowSec));

    if (cur > rule.max) {
      c.header("Retry-After", String(rule.windowSec));
      return c.json(
        { ok: false, error: "请求过于频繁，请稍后再试" },
        429,
      );
    }
    await next();
  });
}

/**
 * 默认限流规则。
 *
 * 策略说明：
 *  - 4 位提取码爆破：share_read 单 share_id 10/min，配合服务端 PBKDF2 100k 迭代
 *    大幅拉高单次失败成本（每次哈希 ~100ms），纯暴力破解基本不可行
 *  - setup：5/h 防止有人拿到 URL 后反复重置盐值
 *  - 其余按敏感度分级
 */
export const DEFAULT_RULES: RateLimitRule[] = [
  // ----- 写 / 高风险操作 -----
  {
    name: "vault-setup",
    method: "POST",
    pathPattern: /^\/api\/vault\/setup$/,
    max: 5,
    windowSec: 3600,
  },
  {
    name: "ai-share-create",
    method: "POST",
    pathPattern: /^\/api\/ai\/share$/,
    max: 10,
    windowSec: 60,
  },
  {
    name: "ai-share-read",
    method: "GET",
    pathPattern: /^\/api\/ai\/share\/([^/]+)$/,
    paramGroup: 1,
    max: 10,
    windowSec: 60,
  },
  {
    name: "ai-token",
    method: "POST",
    pathPattern: /^\/api\/ai\/token$/,
    max: 30,
    windowSec: 60,
  },
];
