/**
 * 分享对话框（百度网盘模式）：链接 + 4 位提取码
 *
 * 流程：
 *  1. 浏览器解密 entry 明文 → 用提取码派生密钥 → AES-GCM 加密 → 上传密文
 *  2. 服务器只存 SHA-256(提取码) + 密文 + salt + IV（零知识）
 *  3. AI 端用提取码本地派生密钥解密
 */
import { useState } from "react";
import { api } from "../lib/api";
import { session } from "../lib/session";
import { decryptContent, encryptWithShareCode, hashShareCode } from "@/web/crypto";

interface ShareDialogProps {
  entryId: string;
  onClose: () => void;
}

export function ShareDialog({ entryId, onClose }: ShareDialogProps) {
  const [result, setResult] = useState<{
    share_id: string;
    code: string;
    expires_at: string;
    max_uses: number;
    origin: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const e = await api.getEntry(entryId);
      const plain = await decryptContent(session.key(), {
        ciphertext: e.encrypted_content,
        iv: e.iv,
      });
      const { code, payload } = await encryptWithShareCode(
        JSON.stringify({ title: e.title, fields: plain.fields, notes: plain.notes }),
      );
      const codeHash = await hashShareCode(code);
      const r = await api.createShare({
        entry_id: entryId,
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
        origin: window.location.origin,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
          <h2 className="text-lg font-semibold">分享给 AI</h2>
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
            <p className="text-sm text-ink-300">
              生成一个临时分享链接 + 4 位提取码。AI 用此链接获取密文，再用提取码本地解密。
            </p>
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
            <button
              onClick={generate}
              disabled={busy}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl py-3 text-sm font-medium transition-colors"
            >
              {busy ? "生成中…" : "生成分享"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300">
              ✓ 分享已生成，链接 5 分钟内有效，最多 5 次提取
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