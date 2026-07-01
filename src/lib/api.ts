/**
 * API 客户端：与 Cloudflare Worker 通信。
 * App Token 存 sessionStorage（刷新前有效），主密码永不传输。
 */
import type {
  ApiResponse,
  Entry,
  EntryType,
  AiAgent,
  AiPermission,
} from "../shared/types";

const TOKEN_KEY = "vault_app_token";

export function getAppToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setAppToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearAppToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAppToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init?.body && typeof init.body === "string")
    headers["Content-Type"] = "application/json";

  const res = await fetch(path, { ...init, headers });
  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new Error(`服务器错误 (${res.status})`);
  }
  if (!json.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

export interface VaultConfig {
  setup: boolean;
  salt?: string;
  verifier?: { ciphertext: string; iv: string };
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

export interface AttachmentDownload {
  /** 解密后的明文字节 */
  data: Uint8Array;
  name: string;
  mime: string;
  size: number;
  /** 加密用的 IV（base64） */
  iv: string;
}

export const api = {
  health: () => req<{ ok: boolean; time: string }>("/api/health"),

  // --- 保险库配置 ---
  vaultConfig: () => req<VaultConfig>("/api/vault/config"),
  setup: (body: { salt: string; verifier: { ciphertext: string; iv: string } }) =>
    req<VaultConfig>("/api/vault/setup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  tags: () => req<string[]>("/api/vault/tags"),
  stats: () =>
    req<{ total: number; trashed: number; favorite: number }>("/api/vault/stats"),
  audit: () =>
    req<
      Array<{
        id: string;
        actor: string;
        ip: string | null;
        action: string;
        success: boolean;
        created_at: string;
      }>
    >("/api/vault/audit"),

  // --- Entry CRUD ---
  listEntries: (params?: {
    type?: EntryType;
    favorite?: boolean;
    trashed?: boolean;
    tag?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.favorite) q.set("favorite", "true");
    if (params?.trashed) q.set("trashed", "true");
    if (params?.tag) q.set("tag", params.tag);
    const qs = q.toString();
    return req<Entry[]>(`/api/entries${qs ? "?" + qs : ""}`);
  },
  getEntry: (id: string) => req<Entry>(`/api/entries/${id}`),
  createEntry: (body: Partial<Entry> & { id: string }) =>
    req<Entry>("/api/entries", { method: "POST", body: JSON.stringify(body) }),
  updateEntry: (id: string, body: Partial<Entry>) =>
    req<Entry>(`/api/entries/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  toggleFavorite: (id: string, favorite: boolean) =>
    req<null>(`/api/entries/${id}/favorite`, {
      method: "PATCH",
      body: JSON.stringify({ favorite }),
    }),
  deleteEntry: (id: string) =>
    req<null>(`/api/entries/${id}`, { method: "DELETE" }),
  restoreEntry: (id: string) =>
    req<null>(`/api/entries/${id}/restore`, { method: "POST" }),
  purgeEntry: (id: string) =>
    req<null>(`/api/entries/${id}/purge`, { method: "DELETE" }),
  versions: (id: string) =>
    req<
      Array<{
        id: string;
        entry_id: string;
        encrypted_content: string;
        iv: string;
        created_at: string;
      }>
    >(`/api/entries/${id}/versions`),
  restoreVersion: (id: string, vid: string) =>
    req<null>(`/api/entries/${id}/versions/${vid}/restore`, { method: "POST" }),

  // --- 附件 ---
  listAttachments: (entryId: string) =>
    req<AttachmentMeta[]>(`/api/entries/${entryId}/attachments`),
  /**
   * 下载附件密文（不自动解密；调用方用 master key 解密）
   * 返回原始 ciphertext 字节 + IV/Name/Mime 等元数据
   */
  downloadAttachmentRaw: async (aid: string): Promise<{
    ciphertext: Uint8Array;
    iv: string;
    size: number;
    name: string;
    mime: string;
  }> => {
    const token = getAppToken();
    const res = await fetch(`/api/attachments/${aid}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`附件下载失败 (${res.status})`);
    const iv = res.headers.get("X-Attachment-IV") ?? "";
    const size = Number(res.headers.get("X-Attachment-Size") ?? 0);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const nameMatch = disposition.match(/filename="([^"]+)"/);
    const name = nameMatch ? decodeURIComponent(nameMatch[1]) : "file";
    const mime = res.headers.get("Content-Type") ?? "application/octet-stream";
    const ciphertext = new Uint8Array(await res.arrayBuffer());
    return { ciphertext, iv, size, name, mime };
  },

  // --- AI Access ---
  getGrants: (entryId: string) =>
    req<
      Array<{ id: string; agent: string; permission: string; created_at: string }>
    >(`/api/ai/grants/${entryId}`),
  setGrant: (entryId: string, agent: AiAgent, permission: AiPermission) =>
    req<null>(`/api/ai/grants/${entryId}`, {
      method: "PUT",
      body: JSON.stringify({ agent, permission }),
    }),
  deleteGrant: (entryId: string, agent: AiAgent) =>
    req<null>(`/api/ai/grants/${entryId}/${agent}`, { method: "DELETE" }),
  issueToken: (entryId: string, agent: AiAgent, ttl: number) =>
    req<{ token: string; expires_at: string }>("/api/ai/token", {
      method: "POST",
      body: JSON.stringify({ entry_id: entryId, agent, ttl }),
    }),

  // --- AI 分享（百度网盘模式）---
  /**
   * 创建分享（同时支持单条与批量）：
   *   - 单条：传 entry_id
   *   - 批量：传 entry_ids（数组）+ 可选 files（附件密文）
   * 密文 + salt + code_hash 由浏览器侧用 share key 加密后传入。
   */
  createShare: (body: {
    entry_id?: string;
    entry_ids?: string[];
    ciphertext: string;
    iv: string;
    salt: string;
    code_hash: string;
    files?: Array<{
      name: string;
      mime: string;
      size: number;
      ciphertext: string;
      iv: string;
    }>;
    ttl?: number;
    max_uses?: number;
  }) => {
    const kind: "single" | "batch" = body.entry_ids ? "batch" : "single";
    return req<{
      share_id: string;
      expires_at: string;
      max_uses: number;
      ttl: number;
      kind: "single" | "batch";
      item_count: number;
    }>("/api/ai/share", {
      method: "POST",
      body: JSON.stringify({ ...body, kind }),
    });
  },

  fetchShare: (shareId: string, code: string) =>
    fetch(`/api/ai/share/${shareId}?code=${encodeURIComponent(code)}`).then(
      async (res) => {
        const json = (await res.json()) as ApiResponse<{
          entry_id?: string;
          entry_title?: string | null;
          kind?: "single" | "batch";
          item_count?: number;
          entry_ids?: string[];
          entry_titles?: string[];
          file_names?: string[];
          ciphertext: string;
          iv: string;
          salt: string;
          used_count: number;
          max_uses: number;
          remaining: number;
        }>;
        if (!json.ok) throw new Error(json.error ?? "提取失败");
        return json.data;
      },
    ),

  listShares: () =>
    req<
      Array<{
        id: string;
        entry_id: string;
        entry_title: string | null;
        expires_at: string;
        max_uses: number;
        used_count: number;
        created_at: string;
        is_expired: number;
        kind: string;
        item_count: number;
      }>
    >("/api/ai/shares"),

  revokeShare: (shareId: string) =>
    req<null>(`/api/ai/share/${shareId}`, { method: "DELETE" }),
};
