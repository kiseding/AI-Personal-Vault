/**
 * AI Personal Vault - 共享类型定义
 *
 * 前端（React）与后端（Cloudflare Worker）共用此模块。
 * 所有正文内容在浏览器端 AES-GCM 加密后，以密文形式存储到 D1。
 * 服务器永远不接触明文（Zero Knowledge）。
 */

// ----------------------------------------------------------------------------
// 1. Entry 类型枚举（第六章「支持类型」）
// ----------------------------------------------------------------------------

export const ENTRY_TYPES = [
  "password",
  "note",
  "api",
  "ssh",
  "server",
  "docker",
  "database",
  "wifi",
  "identity",
  "bank",
  "license",
  "prompt",
  "document",
  "other",
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];

// 类型 → 中文标签 + Emoji 图标
export const ENTRY_TYPE_META: Record<
  EntryType,
  { label: string; icon: string }
> = {
  password: { label: "密码", icon: "🔑" },
  note: { label: "笔记", icon: "📝" },
  api: { label: "API Key", icon: "🔌" },
  ssh: { label: "SSH Key", icon: "🖥️" },
  server: { label: "服务器", icon: "🗄️" },
  docker: { label: "Docker", icon: "🐳" },
  database: { label: "数据库", icon: "🗃️" },
  wifi: { label: "WiFi", icon: "📶" },
  identity: { label: "身份", icon: "🪪" },
  bank: { label: "银行卡", icon: "💳" },
  license: { label: "许可证", icon: "📜" },
  prompt: { label: "Prompt", icon: "✨" },
  document: { label: "文档", icon: "📄" },
  other: { label: "其他", icon: "📦" },
};

// ----------------------------------------------------------------------------
// 2. AI 访问权限（第十五章「AI Access」）
// ----------------------------------------------------------------------------

export const AI_PERMISSIONS = ["never", "ask", "always"] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

// 受支持的 AI Agent 列表
export const AI_AGENTS = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "cursor",
  "opencode",
  "github-copilot",
] as const;
export type AiAgent = (typeof AI_AGENTS)[number];

// 临时 Token TTL 选项（第十五章）
export const AI_TOKEN_TTLS = [30, 60, 300] as const; // 秒：30s / 60s / 5min

// ----------------------------------------------------------------------------
// 3. Entry 数据模型（第五章「数据结构」）
// ----------------------------------------------------------------------------

/**
 * 服务器存储的 Entry（D1 行）。
 * 正文以 AES-GCM 密文存储，服务器无法解密。
 */
export interface Entry {
  id: string;
  title: string;
  type: EntryType;
  tags: string[];
  favorite: boolean;
  icon: string | null;
  /** base64 编码的 AES-GCM 密文 */
  encrypted_content: string;
  /** base64 编码的 12 字节 IV */
  iv: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * 客户端解密后的明文正文。
 * 由「结构化字段 + 可选 Markdown 备注」组成，统一序列化为 JSON 后加密。
 */
export interface EntryContent {
  /** 按模板定义的键值字段 */
  fields: Record<string, string>;
  /** 自由 Markdown 备注（笔记类可直接放正文） */
  notes: string;
  /** 关联附件 ID 列表 */
  attachment_ids: string[];
}

// ----------------------------------------------------------------------------
// 4. 正文模板（第七章「正文模板」）
// ----------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "password"
  | "secret"
  | "textarea"
  | "markdown"
  | "url"
  | "email"
  | "multiline";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
}

export const TEMPLATES: Record<EntryType, FieldDef[]> = {
  password: [
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "password", required: true },
    { key: "otp", label: "OTP", type: "text", placeholder: "TOTP secret" },
    { key: "email", label: "邮箱", type: "email" },
    { key: "url", label: "网站", type: "url" },
  ],
  api: [
    { key: "provider", label: "Provider", type: "text", required: true },
    { key: "api_key", label: "API Key", type: "secret", required: true },
    { key: "secret", label: "Secret", type: "secret" },
    { key: "endpoint", label: "Endpoint", type: "url" },
  ],
  server: [
    { key: "ip", label: "IP", type: "text" },
    { key: "domain", label: "域名", type: "text" },
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "password" },
    { key: "ssh", label: "SSH 信息", type: "text" },
    { key: "docker_compose", label: "Docker Compose", type: "multiline" },
  ],
  ssh: [
    { key: "host", label: "Host", type: "text", required: true },
    { key: "user", label: "User", type: "text" },
    { key: "port", label: "Port", type: "text", placeholder: "22" },
    { key: "private_key", label: "Private Key", type: "multiline" },
    { key: "public_key", label: "Public Key", type: "multiline" },
  ],
  note: [{ key: "body", label: "正文", type: "markdown" }],
  identity: [
    { key: "type", label: "类型", type: "text", placeholder: "身份证/护照/驾照" },
    { key: "number", label: "号码", type: "text", required: true },
    { key: "name", label: "姓名", type: "text" },
    { key: "phone", label: "手机号", type: "text" },
    { key: "address", label: "地址", type: "textarea" },
  ],
  bank: [
    { key: "card_number", label: "银行卡号", type: "text", required: true },
    { key: "cvv", label: "CVV", type: "secret" },
    { key: "expiry", label: "有效期", type: "text", placeholder: "MM/YY" },
    { key: "bank", label: "开户行", type: "text" },
  ],
  wifi: [
    { key: "ssid", label: "SSID", type: "text", required: true },
    { key: "password", label: "密码", type: "password" },
    { key: "security", label: "加密方式", type: "text", placeholder: "WPA2/WPA3" },
  ],
  database: [
    { key: "engine", label: "引擎", type: "text", placeholder: "MySQL/PG/SQLite" },
    { key: "host", label: "Host", type: "text" },
    { key: "port", label: "Port", type: "text" },
    { key: "database", label: "Database", type: "text" },
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "password" },
  ],
  docker: [
    { key: "compose", label: "docker-compose.yml", type: "multiline", required: true },
    { key: "env", label: ".env", type: "multiline" },
  ],
  license: [
    { key: "product", label: "产品", type: "text", required: true },
    { key: "license_key", label: "License Key", type: "secret", required: true },
    { key: "seats", label: "授权数", type: "text" },
  ],
  prompt: [
    { key: "title", label: "标题", type: "text" },
    { key: "body", label: "Prompt 正文", type: "markdown", required: true },
  ],
  document: [{ key: "body", label: "文档内容", type: "markdown", required: true }],
  other: [{ key: "body", label: "内容", type: "markdown" }],
};

// ----------------------------------------------------------------------------
// 5. 附件（第八章）
// ----------------------------------------------------------------------------

export interface AttachmentMeta {
  id: string;
  entry_id: string;
  name: string;
  mime: string;
  size: number;
  /** R2 对象 key */
  r2_key: string;
  /** 文件内容加密用的 IV（base64） */
  iv: string;
  created_at: string;
}

// ----------------------------------------------------------------------------
// 6. 历史版本（第十四章）
// ----------------------------------------------------------------------------

export interface EntryVersion {
  id: string;
  entry_id: string;
  encrypted_content: string;
  iv: string;
  created_at: string;
}

// ----------------------------------------------------------------------------
// 7. 审计日志（第十五章）
// ----------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  actor: string;
  ip: string | null;
  entry_id: string | null;
  action: string;
  success: boolean;
  created_at: string;
}

// ----------------------------------------------------------------------------
// 8. AI 授权与临时 Token（第十五章）
// ----------------------------------------------------------------------------

export interface AiGrant {
  id: string;
  entry_id: string;
  agent: AiAgent;
  permission: AiPermission;
  created_at: string;
  expires_at: string | null;
}

export interface AiAccessToken {
  token: string;
  /** SHA-256 哈希，服务器只存哈希 */
  token_hash: string;
  entry_id: string;
  agent: AiAgent;
  expires_at: string;
  used: boolean;
  created_at: string;
}

// ----------------------------------------------------------------------------
// 9. API 响应封装
// ----------------------------------------------------------------------------

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ----------------------------------------------------------------------------
// 10. 工具：生成 ID（客户端用，避免 import crypto 细节差异）
// ----------------------------------------------------------------------------

export function generateId(): string {
  return crypto.randomUUID();
}
