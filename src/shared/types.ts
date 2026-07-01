/**
 * AI Personal Vault - 共享类型定义
 *
 * 前端（React）与后端（Cloudflare Worker）共用此模块。
 * 所有正文内容在浏览器端 AES-GCM 加密后，以密文形式存储到 D1。
 * 服务器永远不接触明文（Zero Knowledge）。
 *
 * feat/ux-polish：FieldDef 增加 inputMode 字段，EntryEditor 透传到 input，
 * 让移动端键盘自动按字段类型弹出（数字键盘 / 邮箱键盘等）—— P2-8。
 */

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

export const AI_PERMISSIONS = ["never", "ask", "always"] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

export const AI_AGENTS = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "cursor",
  "opencode",
  "github-copilot",
] as const;
export type AiAgent = (typeof AI_AGENTS)[number];

export const AI_TOKEN_TTLS = [30, 60, 300] as const;

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
  /**
   * feat/ux-polish：移动端虚拟键盘类型提示
   * - "text"        默认
   * - "numeric"     数字键盘
   * - "email"       @ 符号键盘
   * - "url"         URL 键盘（含 . / 等）
   * - "tel"         电话数字键盘
   * - "decimal"     数字 + 小数点
   * 详见 https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode
   */
  inputMode?:
    | "text"
    | "numeric"
    | "email"
    | "url"
    | "tel"
    | "decimal"
    | "search"
    | "none";
  /** 浏览器自动填充提示（autocorrect / spellcheck 关 / autocomplete 等） */
  autoComplete?: string;
}

export const TEMPLATES: Record<EntryType, FieldDef[]> = {
  password: [
    { key: "username", label: "用户名", type: "text", autoComplete: "username" },
    { key: "password", label: "密码", type: "password", required: true, autoComplete: "current-password" },
    { key: "otp", label: "OTP", type: "text", placeholder: "TOTP secret", inputMode: "text" },
    { key: "email", label: "邮箱", type: "email", inputMode: "email", autoComplete: "email" },
    { key: "url", label: "网站", type: "url", inputMode: "url", autoComplete: "url" },
  ],
  api: [
    { key: "provider", label: "Provider", type: "text", required: true },
    { key: "api_key", label: "API Key", type: "secret", required: true },
    { key: "secret", label: "Secret", type: "secret" },
    { key: "endpoint", label: "Endpoint", type: "url", inputMode: "url" },
  ],
  server: [
    { key: "ip", label: "IP", type: "text", inputMode: "decimal" },
    { key: "domain", label: "域名", type: "text", inputMode: "url" },
    { key: "username", label: "用户名", type: "text" },
    { key: "password", label: "密码", type: "password" },
    { key: "ssh", label: "SSH 信息", type: "text" },
    { key: "docker_compose", label: "Docker Compose", type: "multiline" },
  ],
  ssh: [
    { key: "host", label: "Host", type: "text", required: true, inputMode: "url" },
    { key: "user", label: "User", type: "text" },
    { key: "port", label: "Port", type: "text", placeholder: "22", inputMode: "numeric" },
    { key: "private_key", label: "Private Key", type: "multiline" },
    { key: "public_key", label: "Public Key", type: "multiline" },
  ],
  note: [{ key: "body", label: "正文", type: "markdown" }],
  identity: [
    { key: "type", label: "类型", type: "text", placeholder: "身份证/护照/驾照" },
    { key: "number", label: "号码", type: "text", required: true },
    { key: "name", label: "姓名", type: "text" },
    { key: "phone", label: "手机号", type: "text", inputMode: "tel", autoComplete: "tel" },
    { key: "address", label: "地址", type: "textarea" },
  ],
  bank: [
    { key: "card_number", label: "银行卡号", type: "text", required: true, inputMode: "numeric" },
    { key: "cvv", label: "CVV", type: "secret" },
    { key: "expiry", label: "有效期", type: "text", placeholder: "MM/YY", inputMode: "numeric" },
    { key: "bank", label: "开户行", type: "text" },
  ],
  wifi: [
    { key: "ssid", label: "SSID", type: "text", required: true },
    { key: "password", label: "密码", type: "password" },
    { key: "security", label: "加密方式", type: "text", placeholder: "WPA2/WPA3" },
  ],
  database: [
    { key: "engine", label: "引擎", type: "text", placeholder: "MySQL/PG/SQLite" },
    { key: "host", label: "Host", type: "text", inputMode: "url" },
    { key: "port", label: "Port", type: "text", inputMode: "numeric" },
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
    { key: "seats", label: "授权数", type: "text", inputMode: "numeric" },
  ],
  prompt: [
    { key: "title", label: "标题", type: "text" },
    { key: "body", label: "Prompt 正文", type: "markdown", required: true },
  ],
  document: [{ key: "body", label: "文档内容", type: "markdown", required: true }],
  other: [{ key: "body", label: "内容", type: "markdown" }],
};

export interface Entry {
  id: string;
  title: string;
  type: EntryType;
  tags: string[];
  favorite: boolean;
  icon: string | null;
  encrypted_content: string;
  iv: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EntryContent {
  fields: Record<string, string>;
  notes: string;
  /**
   * 关联附件 ID 列表。feat/ux-polish：之前一直是 []（死字段），
   * 详见 P2-3 / L8 的审计意见。现在由写入端（EntryEditor / ShareDialog）
   * 自动用当前的 attachments 表条目 ID 填充。
   *
   * AI 端读取 entry 时可以通过此字段知道哪些附件属于该 entry，
   * 避免去 /api/entries/:id/attachments 二查。
   */
  attachment_ids: string[];
}

export interface AttachmentMeta {
  id: string;
  entry_id: string;
  name: string;
  mime: string;
  size: number;
  r2_key: string;
  iv: string;
  created_at: string;
}

export interface EntryVersion {
  id: string;
  entry_id: string;
  encrypted_content: string;
  iv: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  ip: string | null;
  entry_id: string | null;
  action: string;
  success: boolean;
  created_at: string;
}

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
  token_hash: string;
  entry_id: string;
  agent: AiAgent;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function generateId(): string {
  return crypto.randomUUID();
}
