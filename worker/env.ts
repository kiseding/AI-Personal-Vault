/**
 * Cloudflare Worker 环境绑定类型
 * 对应 wrangler.jsonc 中的 D1 / R2 / KV / Assets 绑定
 */
export interface Env {
  /** D1 数据库：Entry 元数据、标签、版本、审计日志（仅密文） */
  DB: D1Database;
  /** R2 对象存储：加密附件 */
  BUCKET: R2Bucket;
  /** KV：保险库配置、AI 临时 Token 缓存 */
  KV: KVNamespace;
  /** 静态资源 Fetcher（由 @cloudflare/vite-plugin 注入） */
  ASSETS: Fetcher;
  /**
   * 应用访问令牌：部署时通过 `wrangler secret put APP_TOKEN` 设置。
   * 用于 API 访问控制（主密码永不上传，仅在浏览器派生密钥）。
   * 生产环境建议叠加 Cloudflare Access。
   */
  APP_TOKEN: string;
}

/** Hono 上下文变量：解析后的客户端 IP */
type ClientIp = { ip: string };

export type AppContext = {
  Bindings: Env;
  Variables: ClientIp;
};
