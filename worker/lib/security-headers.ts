/**
 * 安全响应头中间件（部署检查清单补全）
 *
 * 为所有 /api/* 响应附加以下安全头：
 *  - Content-Security-Policy: 严格 CSP，禁外源脚本/样式/连接
 *  - X-Content-Type-Options:   禁止 MIME 嗅探
 *  - X-Frame-Options:          禁止 iframe 嵌入（防 clickjacking）
 *  - Referrer-Policy:          不发送来源信息
 *  - Permissions-Policy:       关闭危险浏览器 API
 *  - Strict-Transport-Security: 强制 HTTPS 两年
 *  - Cross-Origin-Opener-Policy:     跨窗口隔离
 *  - Cross-Origin-Resource-Policy:   限制跨域资源加载
 *
 * 注意：本中间件作用于 Hono 路由（/api/*）。
 * 静态资源（SPA）由 @cloudflare/vite-plugin 通过 ASSETS 绑定直接返回，
 * 不经过 Hono。若需给静态资源也加上安全头，请任选其一：
 *   1) 在 wrangler.jsonc 中移除 not_found_handling: single-page-application，
 *      在 Hono 用 env.ASSETS.fetch 处理 * 路由并附加头；
 *   2) 在 Cloudflare Dashboard → Rules → Transform Rules 添加全局响应头。
 */
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../env";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind 预编译产物 + 组件中可能有少量内联 style 属性；
  // className/内联 style 属性不会触发 style-src 检查（仅 <style>/style=""）
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",        // 解密后的附件预览可能用 blob:
  "font-src 'self' data:",
  "connect-src 'self'",                 // 所有 API 同源
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function securityHeaders() {
  return createMiddleware<AppContext>(async (c, next) => {
    // 在 next() 之前设置，使后续中间件（即便提前 return 401/429）也带上这些头
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    );
    c.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    await next();
  });
}
