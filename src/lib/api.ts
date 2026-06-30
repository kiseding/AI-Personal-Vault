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
};
