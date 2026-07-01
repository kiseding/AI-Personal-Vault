/**
 * 分享中心：列出所有 AI 分享（链接 + 提取码），可撤销
 * 显示批量分享的条目数（kind=batch + item_count）
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface ShareInfo {
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
}

export function ShareCenter({ onBack }: { onBack: () => void }) {
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "expired">("active");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listShares();
      setShares(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    if (!confirm("确定撤销这个分享？撤销后该链接立即失效。")) return;
    try {
      await api.revokeShare(id);
      void load();
    } catch (e) {
      alert("撤销失败：" + (e as Error).message);
    }
  };

  const filtered = shares.filter((s) => {
    if (filter === "active") return !s.is_expired && s.used_count < s.max_uses;
    if (filter === "expired") return !!s.is_expired || s.used_count >= s.max_uses;
    return true;
  });

  const counts = {
    all: shares.length,
    active: shares.filter((s) => !s.is_expired && s.used_count < s.max_uses).length,
    expired: shares.filter((s) => !!s.is_expired || s.used_count >= s.max_uses).length,
  };

  return (
    <div className="h-full flex flex-col">
      {/* 顶部 */}
      <div className="flex items-center gap-3 p-4 border-b border-white/5">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10"
          title="返回"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold flex-1">🔗 分享中心</h1>
        <button
          onClick={load}
          className="text-xs text-ink-400 hover:text-ink-100 px-2 py-1 rounded-lg hover:bg-white/5"
          disabled={loading}
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {/* 过滤标签 */}
      <div className="flex gap-1 p-3 border-b border-white/5">
        {(["active", "expired", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              filter === f
                ? "bg-accent text-white"
                : "bg-white/5 text-ink-400 hover:bg-white/10"
            }`}
          >
            {f === "active" ? "活跃" : f === "expired" ? "已失效" : "全部"}
            <span className="ml-1 text-[10px] opacity-70">({counts[f]})</span>
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="m-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && filtered.length === 0 && (
          <div className="text-center text-sm text-ink-500 py-8">加载中…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-sm text-ink-500 py-12 space-y-2">
            <div className="text-3xl">🔗</div>
            <p>暂无分享</p>
            <p className="text-xs">
              在条目详情页点 🔗 按钮，或在侧栏点 📦 多选分享
            </p>
          </div>
        )}
        {filtered.map((s) => {
          const expired = !!s.is_expired || s.used_count >= s.max_uses;
          const isBatch = s.kind === "batch";
          return (
            <div
              key={s.id}
              className={`glass rounded-xl p-3 space-y-2 ${
                expired ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span>{s.entry_title ?? "(已删除条目)"}</span>
                    {isBatch && (
                      <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded shrink-0">
                        批量 · {s.item_count} 条
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 font-mono truncate">
                    {s.id.slice(0, 16)}…
                  </div>
                </div>
                <button
                  onClick={() => revoke(s.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10"
                >
                  撤销
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink-400">
                <span>
                  创建于 {new Date(s.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {expired ? (
                  <span className="text-red-400">
                    {s.is_expired ? "已过期" : "已用完"}
                  </span>
                ) : (
                  <span className="text-ink-400">
                    过期于 {new Date(s.expires_at).toLocaleTimeString()}
                  </span>
                )}
                <span className="text-ink-600">·</span>
                <span className="text-ink-400">
                  已用 {s.used_count}/{s.max_uses} 次
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
