/**
 * 分享对话框（百度网盘模式）：链接 + 4 位提取码
 *
 * 两种模式：
 *  - 单条分享（entryId）：原有流程，加密单个 entry 明文上传
 *  - 批量分享（entryIds + entryTitles）：解密 N 个 entry + 可选附件 → bundle JSON
 *    → 提取码派生密钥加密 bundle → 上传
 *
 * 零知识流程：
 *  1. 浏览器用主密钥解密 entry → 提取码派生临时密钥 → AES-GCM 加密 → 上传
 *  2. 服务器只存 SHA-256(提取码) + 密文 + salt + IV（零知识）
 *  3. AI 用提取码本地派生密钥解密
 *
 * 批量模式下附件处理：浏览器用主密钥解密附件 → 重新用 share key 加密 → 嵌入 bundle
 *   AI 用同一 share key 解密 bundle 后再解密每个附件（同一 salt/key，不同 IV）
 */
import { useState } from "react";
import { api } from "../lib/api";
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
  /** 单条分享：entry id */
  entryId?: string;
  /** 批量分享：entry id 列表 */
  entryIds?: string[];
  /** 批量分享：entry 标题列表（仅用于 UI 显示） */
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

const MAX_BUNDLE_BYTES = 5 * 1024 * 1024; // 5 MB 上限（明文 bundle 字节数）

export function ShareDialog({
  entryId,
  entryIds,
  entryTitles,
  onClose,
}: ShareDialogProps) {
  const isBatch = !!entryIds;
  const ids = isBatch ? entryIds! : entryId ? [entryId] : [];
  const titleList = isBatch
    ? entryTitles ?? []
    : [];

  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const generate = async () => {
    if (ids.length === 0) {
      setError("未选择任何条目");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // -------- 1) 解密所有 entry 明文 --------
      const items: Array<{
        entry_id: string;
        title: string;
        type: string;
        tags: string[];
        fields: Record<string, string>;
        notes: string;
      }> = [];
      let plaintextBytes = 0;
      for (let i = 0; i < ids.length; i++) {
        setProgress(`解密 entry ${i + 1}/${ids.length}…`);
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
        });
        plaintextBytes +=
          JSON.stringify(plain).length + e.title.length + 200;
        if (plaintextBytes > MAX_BUNDLE_BYTES) {
          throw new Error(
            `条目明文超过 ${MAX_BUNDLE_BYTES / 1024 / 1024}MB 上限，请减少批量大小`,
          );
        }
      }

      // -------- 2) 收集附件（可选） --------
      // 文件数组中保留 re-encrypted ciphertext + iv，AI 用同一 share key 解密
      const files: Array<{
        name: string;
        mime: string;
        size: number;
        ciphertext: string;
        iv: string;
      }> = [];
      if (includeAttachments) {
        for (let i = 0; i < ids.length; i++) {
          setProgress(`扫描附件 ${i + 1}/${ids.length}…`);
          const atts = await api.listAttachments(ids[i]);
          for (const att of atts) {
            setProgress(`下载并解密 ${att.name}…`);
            const raw = await api.downloadAttachmentRaw(att.id);
            const plain = await decryptBytes(session.key(), {
              ciphertext: bytesToBase64(raw.ciphertext),
              iv: raw.iv,
            });
            plaintextBytes += plain.length;
            if (plaintextBytes > MAX_BUNDLE_BYTES) {
              throw new Error(
                `附件累计超过 ${MAX_BUNDLE_BYTES / 1024 / 1024}MB 上限`,
              );
            }
            // 临时存 plaintext，下面统一用 share key 重新加密
            (files as any).push({ ...att, __plaintext: plain });
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
        });
        const { code, payload } = await encryptWithShareCode(singleText);
        const codeHash = await hashShareCode(code);
        const r = await api.createShare({
          entry_id: ids[0],
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          salt: payload.salt,
          code_hash: codeHash,
        });
        setResult({
          share_id: r.share_id,
          code,
          expires_at: r.expires_at,
          max_uses: r.max_uses,
          item_count: 1,
          origin: window.location.origin,
        });
        return;
      }

      // -------- 4) 批量分享：派生 share key + 加密 --------
      setProgress("生成提取码与密钥…");
      const code = generateShareCode();
      const salt = generateShareSalt();
      const shareKey = await deriveShareKey(code, salt);

      // 加密附件（用 share key）
      const fileMetas: typeof files = [];
      for (const f of files as any[]) {
        setProgress(`重新加密附件 ${f.name}…`);
        const enc = await encryptBytesWithShareKey(f.__plaintext, shareKey);
        fileMetas.push({
          name: f.name,
          mime: f.mime,
          size: f.size,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
        });
      }

      // bundle JSON：包含 items + files（含密文）
      const bundle = {
        version: 2,
        items,
        files: fileMetas,
      };
      setProgress("加密 bundle…");
      const bundleEnc = await encryptWithShareKey(
        JSON.stringify(bundle),
        shareKey,
      );

      // -------- 5) 上传 --------
      setProgress("上传分享…");
      const codeHash = await hashShareCode(code);
      const r = await api.createShare({
        entry_ids: ids,
        ciphertext: bundleEnc.ciphertext,
        iv: bundleEnc.iv,
        salt,
        code_hash: codeHash,
        files: fileMetas,
      });

      setResult({
        share_id: r.share_id,
        code,
        expires_at: r.expires_at,
        max_uses: r.max_uses,
        item_count: r.item_count,
        origin: window.location.origin,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
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
        {/* 头部 */}
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
            {/* 批量条目预览 */}
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
              生成一个临时分享链接 + 4 位提取码。AI 用此链接获取密文，再用提取码本地解密。
            </p>

            {/* 批量模式才显示附件开关 */}
            {isBatch && (
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
                    bundle 明文上限 {MAX_BUNDLE_BYTES / 1024 / 1024}MB
                  </div>
                </div>
              </label>
            )}

            <div className="text-xs text-ink-500 space-y-1 leading-relaxed">
              <div>• 链接 5 分钟内有效</div>
              <div>• 最多提取 5 次（防爆破）</div>
              <div>• 提取码仅存在你的浏览器，服务器只存 SHA-256 哈希</div>
              <div>• 零知识：服务器永远不知道明文密码</div>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {busy && progress && (
              <div className="text-xs text-accent">{progress}</div>
            )}

            <button
              onClick={generate}
              disabled={busy}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors"
            >
              {busy ? "处理中…" : isBatch ? `生成分享（${ids.length} 条）` : "生成分享"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300">
              ✓ {result.item_count > 1 ? `批量分享（${result.item_count} 条）已生成` : "分享已生成"}，
              链接 {new Date(result.expires_at).toLocaleTimeString()} 前有效，最多 {result.max_uses} 次提取
            </div>

            {/* 提取码 */}
            <div className="text-center py-4 bg-ink-900/60 rounded-xl">
              <div className="text-xs text-ink-400 mb-2">提取码（4 位）</div>
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

            {/* 链接 */}
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

            {/* AI curl 示例 */}
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

            {/* 重新生成 */}
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
