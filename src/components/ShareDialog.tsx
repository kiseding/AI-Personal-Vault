/**
 * 分享对话框（百度网盘模式）：链接 + 提取码
 *
 * 两种模式：
 *  - 单条分享：加密单个 entry 明文上传（默认包含附件）
 *  - 批量分享：解密 N 个 entry + 可选附件 → bundle JSON → 上传
 *
 * feat/share-ux 的 AbortController / 进度条 / retry / safe mounted-guard 已合并。
 *
 * feat/ux-polish 增量：
 *  - 每个 item 加入 `attached_attachment_ids: string[]`，记录该 entry 关联的附件
 *  - 每个 file 加入 `owner_entry_id: string`，让 AI 能反查附件归属（P2-3 / L8）
 *  - 这样 AI 拿到 bundle 后无需再去 listAttachments 二查
 */
import { useEffect, useRef, useState } from "react";
import { api, getAppToken } from "../lib/api";
import { session } from "../lib/session";
import {
  decryptContent,
  decryptBytes,
  generateShareCode,
  generateShareSalt,
  deriveShareKey,
  encryptWithShareKey,
  encryptBytesWithShareKey,
  hashShareCode,
  encryptWithShareCode,
  bytesToBase64,
} from "@/web/crypto";

interface ShareDialogProps {
  entryId?: string;
  entryIds?: string[];
  entryTitles?: string[];
  onClose: () => void;
}

interface ShareResult {
  share_id: string;
  code: string;
  expires_at: string;
  max_uses: number;
  item_count: number;
  origin: string;
}

const MAX_BUNDLE_B64 = 5 * 1024 * 1024;

function base64SizeOfEncrypted(plainBytes: number): number {
  return Math.ceil((plainBytes + 16) / 3) * 4;
}

function makeAbortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts: number,
  signal: AbortSignal,
): Promise<Response> {
  let lastErr: Error | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal.aborted) throw makeAbortError();
    try {
      const res = await fetch(url, { ...init, signal });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`HTTP ${res.status}`);
        }
        throw new Error(`HTTP ${res.status}（可重试）`);
      }
      return res;
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") throw err;
      lastErr = err;
      if (i === maxAttempts - 1) break;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr ?? new Error("请求失败");
}

interface Progress {
  step: string;
  ratio: number;
}

export function ShareDialog({
  entryId,
  entryIds,
  entryTitles,
  onClose,
}: ShareDialogProps) {
  const isBatch = !!entryIds;
  const ids = isBatch ? entryIds! : entryId ? [entryId] : [];
  const titleList = isBatch ? entryTitles ?? [] : [];
  const [includeAttachments, setIncludeAttachments] = useState(
    !isBatch ? true : false,
  );
  const [result, setResult] = useState<ShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const safeSet = (state: Partial<{ busy: boolean; error: string | null; progress: Progress | null; result: ShareResult | null }>) => {
    if (!mountedRef.current) return;
    if ("busy" in state) setBusy(state.busy!);
    if ("error" in state) setError(state.error!);
    if ("progress" in state) setProgress(state.progress!);
    if ("result" in state) setResult(state.result!);
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const generate = async () => {
    if (ids.length === 0) {
      safeSet({ error: "未选择任何条目" });
      return;
    }
    const signal = (abortRef.current = new AbortController()).signal;
    safeSet({ busy: true, error: null, result: null, progress: { step: "初始化…", ratio: 0 } });
    try {
      // -------- 1) 解密所有 entry 明文 --------
      const items: Array<{
        entry_id: string;
        title: string;
        type: string;
        tags: string[];
        fields: Record<string, string>;
        notes: string;
        /** feat/ux-polish：附件 ID 列表 —— 让 AI 知道哪些附件属于这条 entry */
        attached_attachment_ids: string[];
      }> = [];
      let estimatedB64 = 0;
      for (let i = 0; i < ids.length; i++) {
        if (signal.aborted) throw makeAbortError();
        const e = await api.getEntry(ids[i]);
        const plain = await decryptContent(session.key(), {
          ciphertext: e.encrypted_content,
          iv: e.iv,
        });
        items.push({
          entry_id: ids[i],
          title: e.title,
          type: e.type,
          tags: e.tags,
          fields: plain.fields,
          notes: plain.notes,
          attached_attachment_ids: [],
        });
        estimatedB64 +=
          ids[i].length + e.title.length + JSON.stringify(plain).length + 200;
        safeSet({
          progress: {
            step: `解密 entry ${i + 1}/${ids.length}`,
            ratio: (i + 1) / (ids.length * (includeAttachments ? 4 : 2)),
          },
        });
        if (estimatedB64 > MAX_BUNDLE_B64) {
          throw new Error(
            `条目总大小超过 ${MAX_BUNDLE_B64 / 1024 / 1024}MB 上限，请减少批量`,
          );
        }
      }

      // -------- 2) 收集附件（可选） --------
      const files: Array<{
        name: string;
        mime: string;
        size: number;
        ciphertext: string;
        iv: string;
        __plaintext?: Uint8Array;
        /** feat/ux-polish：关联的 entry id，使 AI 能反查附件归属 */
        owner_entry_id?: string;
      }> = [];
      if (includeAttachments) {
        const token = getAppToken();
        for (let i = 0; i < ids.length; i++) {
          if (signal.aborted) throw makeAbortError();
          const atts = await api.listAttachments(ids[i]);
          for (const att of atts) {
            if (signal.aborted) throw makeAbortError();
            safeSet({
              progress: {
                step: `下载并解密 ${att.name}`,
                ratio: 0.4 + (i / ids.length) * 0.2,
              },
            });
            const res = await fetchWithRetry(
              `/api/attachments/${att.id}`,
              {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              },
              2,
              signal,
            );
            const iv = res.headers.get("X-Attachment-IV") ?? "";
            const size = Number(res.headers.get("X-Attachment-Size") ?? 0);
            const disposition = res.headers.get("Content-Disposition") ?? "";
            const nameMatch = disposition.match(/filename="([^"]+)"/);
            const name = nameMatch ? decodeURIComponent(nameMatch[1]) : att.name;
            const mime = res.headers.get("Content-Type") ?? att.mime;
            const ciphertext = new Uint8Array(await res.arrayBuffer());
            const plain = await decryptBytes(session.key(), {
              ciphertext: bytesToBase64(ciphertext),
              iv,
            });
            estimatedB64 += base64SizeOfEncrypted(plain.length);
            if (estimatedB64 > MAX_BUNDLE_B64) {
              throw new Error(
                `附件累计超过 ${MAX_BUNDLE_B64 / 1024 / 1024}MB 上限`,
              );
            }
            files.push({
              name,
              mime,
              size,
              __plaintext: plain,
              owner_entry_id: ids[i],
            });
            // 同步把 attachment id 注入对应的 item（P2-3）
            const item = items.find((it) => it.entry_id === ids[i]);
            if (item) item.attached_attachment_ids.push(att.id);
          }
        }
      }

      // -------- 3) 单条分享走旧路径 --------
      if (!isBatch) {
        const item = items[0];
        const singleText = JSON.stringify({
          title: item.title,
          fields: item.fields,
          notes: item.notes,
          attached_attachment_ids: item.attached_attachment_ids,
        });
        safeSet({ progress: { step: "加密正文…", ratio: 0.7 } });
        const { code, payload } = await encryptWithShareCode(singleText);
        const codeHash = await hashShareCode(code);
        safeSet({ progress: { step: "上传…", ratio: 0.9 } });
        const r = await api.createShare({
          entry_id: ids[0],
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          salt: payload.salt,
          code_hash: codeHash,
        });
        safeSet({
          progress: { step: "完成", ratio: 1 },
          result: {
            share_id: r.share_id,
            code,
            expires_at: r.expires_at,
            max_uses: r.max_uses,
            item_count: r.item_count,
            origin: window.location.origin,
          },
          busy: false,
        });
        return;
      }

      // -------- 4) 批量分享：派生 share key + 加密 --------
      safeSet({ progress: { step: "生成提取码与密钥…", ratio: 0.7 } });
      const code = generateShareCode();
      const salt = generateShareSalt();
      const shareKey = await deriveShareKey(code, salt);

      const fileMetas: Array<{
        name: string;
        mime: string;
        size: number;
        ciphertext: string;
        iv: string;
        owner_entry_id?: string;
      }> = [];
      for (const f of files) {
        if (signal.aborted) throw makeAbortError();
        safeSet({ progress: { step: `重新加密附件 ${f.name}`, ratio: 0.75 } });
        const enc = await encryptBytesWithShareKey(f.__plaintext!, shareKey);
        fileMetas.push({
          name: f.name,
          mime: f.mime,
          size: f.size,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          owner_entry_id: f.owner_entry_id,
        });
        f.__plaintext = undefined;
      }

      const bundle = { version: 2, items, files: fileMetas };
      safeSet({ progress: { step: "加密 bundle…", ratio: 0.85 } });
      const bundleEnc = await encryptWithShareKey(
        JSON.stringify(bundle),
        shareKey,
      );

      safeSet({ progress: { step: "上传…", ratio: 0.95 } });
      const codeHash = await hashShareCode(code);
      const r = await api.createShare({
        entry_ids: ids,
        ciphertext: bundleEnc.ciphertext,
        iv: bundleEnc.iv,
        salt,
        code_hash: codeHash,
        files: fileMetas,
      });

      safeSet({
        progress: { step: "完成", ratio: 1 },
        result: {
          share_id: r.share_id,
          code,
          expires_at: r.expires_at,
          max_uses: r.max_uses,
          item_count: r.item_count,
          origin: window.location.origin,
        },
        busy: false,
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        safeSet({ busy: false, progress: null });
        return;
      }
      safeSet({ busy: false, error: err.message, progress: null });
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
  };

  const fullLink = result
    ? `${result.origin}/api/ai/share/${result.share_id}?code=${result.code}`
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isBatch ? `分享 ${ids.length} 条给 AI` : "分享给 AI"}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 text-lg"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {!result ? (
          <div className="space-y-3">
            {isBatch && (
              <div className="glass rounded-xl p-3 max-h-48 overflow-y-auto space-y-1">
                {titleList.map((t, i) => (
                  <div key={i} className="text-sm flex items-center gap-2">
                    <span className="text-ink-500 text-xs">{i + 1}.</span>
                    <span className="truncate">{t}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-sm text-ink-300">
              生成一个临时分享链接 + 提取码。AI 用此链接获取密文，再用提取码本地解密。
            </p>

            <label className="flex items-start gap-3 p-3 rounded-xl bg-white/5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAttachments}
                onChange={(e) => setIncludeAttachments(e.target.checked)}
                className="mt-1"
              />
              <div className="text-xs text-ink-300 space-y-1 leading-relaxed">
                <div className="text-ink-100 font-medium">包含附件</div>
                <div>
                  浏览器会下载所有附件并解密 → 用 share key 重加密后嵌入 bundle。
                </div>
                <div className="text-ink-500">
                  bundle 明文上限约 {MAX_BUNDLE_B64 / 1024 / 1024}MB
                </div>
              </div>
            </label>

            <div className="text-xs text-ink-500 space-y-1 leading-relaxed">
              <div>• 链接 5 分钟内有效</div>
              <div>• 最多提取 3 次（防爆破）</div>
              <div>• 提取码仅存在你的浏览器，服务器只存 SHA-256 哈希</div>
              <div>• 零知识：服务器永远不知道明文密码</div>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {busy && progress && (
              <div className="space-y-2">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-200"
                    style={{ width: `${Math.min(100, progress.ratio * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-ink-400 truncate flex-1">
                    {progress.step}
                  </div>
                  <button
                    onClick={cancel}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={generate}
              disabled={busy}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors"
            >
              {busy
                ? "处理中…"
                : isBatch
                  ? `生成分享（${ids.length} 条）`
                  : "生成分享"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300">
              ✓{" "}
              {result.item_count > 1
                ? `批量分享（${result.item_count} 条）已生成`
                : "分享已生成"}
              ，链接 {new Date(result.expires_at).toLocaleTimeString()} 前有效，最多{" "}
              {result.max_uses} 次提取
            </div>

            <div className="text-center py-4 bg-ink-900/60 rounded-xl">
              <div className="text-xs text-ink-400 mb-2">提取码（6 位）</div>
              <div className="text-4xl font-mono font-bold text-emerald-400 tracking-widest">
                {result.code}
              </div>
              <button
                onClick={() => copy(result.code)}
                className="mt-3 text-xs text-accent hover:underline"
              >
                复制提取码
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-ink-400">分享链接</div>
              <div className="bg-ink-900/60 rounded-lg p-2.5 text-xs text-ink-200 break-all font-mono">
                {result.origin}/api/ai/share/{result.share_id}
              </div>
              <button
                onClick={() =>
                  copy(`${result.origin}/api/ai/share/${result.share_id}`)
                }
                className="text-xs text-accent hover:underline"
              >
                复制链接
              </button>
            </div>

            <div className="space-y-1.5 border-t border-white/5 pt-3">
              <div className="text-xs text-ink-400">AI 端调用示例</div>
              <div className="bg-ink-900/60 rounded-lg p-2.5 text-[11px] text-ink-300 break-all font-mono leading-relaxed">
                <div>curl "{fullLink}"</div>
                <div className="mt-1 text-ink-500">
                  # 返回密文后用提取码本地 AES-GCM 解密
                  <br /># （100k 迭代 PBKDF2-SHA256）
                </div>
              </div>
              <button
                onClick={() => copy(fullLink)}
                className="text-xs text-accent hover:underline"
              >
                复制全部（链接 + 提取码）
              </button>
            </div>

            <button
              onClick={() => setResult(null)}
              className="w-full text-sm text-ink-400 hover:text-ink-100 py-2"
            >
              重新生成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
