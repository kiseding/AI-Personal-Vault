/**
 * 调用 Vault Worker 的 share-read 端点。
 * 鉴权方式：4 位提取码（无 APP_TOKEN，server-side 校验 SHA-256 + 限流 + max_uses）。
 *
 * 返回的字段对应 worker/routes/ai.ts 中 GET /api/ai/share/:shareId 的 data 字段，
 * 单条分享与批量分享共用同一接口，由 kind 字段区分。
 */

export interface ShareFetchResult {
  /** "single" | "batch"，向前兼容默认 "single" */
  kind?: string;
  /** 单条分享：关联的 entry_id；批量分享：未使用（见 entry_ids） */
  entry_id?: string;
  /** 单条分享：entry 标题（仅审计用） */
  entry_title?: string | null;
  /** 批量分享：本批包含的 entry 数量 */
  item_count?: number;
  /** 批量分享：本批包含的 entry_id 列表 */
  entry_ids?: string[];
  /** 批量分享：本批包含的文件名列表（仅元信息） */
  file_names?: string[];
  /** base64 密文（用提取码加密的明文 JSON） */
  ciphertext: string;
  /** base64 IV */
  iv: string;
  /** base64 salt */
  salt: string;
  /** 本次提取后已使用次数 */
  used_count: number;
  /** 最大使用次数 */
  max_uses: number;
  /** 剩余使用次数 */
  remaining: number;
}

const DEFAULT_BASE_URL = process.env.VAULT_URL ?? "http://localhost:8788";

export async function fetchShare(
  shareId: string,
  code: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<ShareFetchResult> {
  const url = new URL(
    `/api/ai/share/${encodeURIComponent(shareId)}`,
    baseUrl,
  );
  url.searchParams.set("code", code);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "vault-mcp/0.1.0",
    },
  });
  const text = await res.text();
  let json: { ok?: boolean; data?: ShareFetchResult; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `vault 返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok || !json.ok || !json.data) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data;
}
