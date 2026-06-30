/**
 * 主界面：侧栏导航（第九章）+ 列表 + 详情查看
 * 正文搜索在浏览器本地完成（第十一章：服务器不能搜索正文）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { session } from "../lib/session";
import { decryptContent } from "@/web/crypto";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_META,
  type Entry,
  type EntryType,
  type EntryContent,
} from "@/shared/types";
import { EntryEditor } from "./EntryEditor";

type Filter =
  | { kind: "all" }
  | { kind: "favorite" }
  | { kind: "recent" }
  | { kind: "trashed" }
  | { kind: "type"; type: EntryType };

const NAV: { key: string; label: string; icon: string; filter: Filter }[] = [
  { key: "all", label: "全部", icon: "🗂️", filter: { kind: "all" } },
  { key: "favorite", label: "收藏", icon: "⭐", filter: { kind: "favorite" } },
  { key: "recent", label: "最近", icon: "🕐", filter: { kind: "recent" } },
  ...ENTRY_TYPES.map((t) => ({
    key: t,
    label: ENTRY_TYPE_META[t].label,
    icon: ENTRY_TYPE_META[t].icon,
    filter: { kind: "type" as const, type: t },
  })),
];

export function Vault({ onLock }: { onLock: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let list: Entry[];
      if (filter.kind === "favorite")
        list = await api.listEntries({ favorite: true });
      else if (filter.kind === "trashed")
        list = await api.listEntries({ trashed: true });
      else if (filter.kind === "type")
        list = await api.listEntries({ type: filter.type });
      else list = await api.listEntries();
      // 「最近」按 updated_at 已排序
      setEntries(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const refresh = () => void load();

  if (editing) {
    return (
      <EntryEditor
        entry={editing === "new" ? null : editing}
        onDone={refresh}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex h-screen">
      {/* 侧栏 */}
      <aside className="w-60 shrink-0 glass border-r border-white/5 flex flex-col">
        <div className="p-4 flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            <span>🔐</span> Vault
          </span>
          <button
            onClick={onLock}
            className="text-xs text-ink-400 hover:text-ink-100 px-2 py-1 rounded-lg hover:bg-white/5"
          >
            锁定
          </button>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="mx-3 mb-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-xl py-2 font-medium"
        >
          + 新建
        </button>
        <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {NAV.map((item) => (
            <NavBtn
              key={item.key}
              active={JSON.stringify(item.filter) === JSON.stringify(filter)}
              onClick={() => {
                setFilter(item.filter);
                setSelectedId(null);
              }}
              icon={item.icon}
              label={item.label}
            />
          ))}
          <div className="h-px bg-white/5 my-2" />
          <NavBtn
            active={filter.kind === "trashed"}
            onClick={() => {
              setFilter({ kind: "trashed" });
              setSelectedId(null);
            }}
            icon="🗑️"
            label="回收站"
          />
        </nav>
      </aside>

      {/* 列表 */}
      <section className="w-80 shrink-0 border-r border-white/5 flex flex-col">
        <div className="p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或标签…"
            className="w-full bg-ink-900/80 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading && (
            <div className="text-center text-sm text-ink-500 py-8">加载中…</div>
          )}
          {error && (
            <div className="text-sm text-red-400 px-3 py-2">{error}</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center text-sm text-ink-500 py-8">暂无内容</div>
          )}
          {filtered.map((e) => (
            <ListItem
              key={e.id}
              entry={e}
              active={e.id === selectedId}
              onClick={() => setSelectedId(e.id)}
            />
          ))}
        </div>
      </section>

      {/* 详情 */}
      <main className="flex-1 overflow-y-auto">
        {selected ? (
          <EntryDetail entry={selected} onEdit={() => setEditing(selected)} onChanged={refresh} />
        ) : (
          <div className="h-full flex items-center justify-center text-ink-600">
            <div className="text-center space-y-2">
              <div className="text-5xl">🔓</div>
              <p className="text-sm">选择一个条目查看，或点击「新建」</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-accent/15 text-accent"
          : "text-ink-300 hover:bg-white/5 hover:text-ink-100"
      }`}
    >
      <span className="text-base">{icon}</span>
      {label}
    </button>
  );
}

function ListItem({
  entry,
  active,
  onClick,
}: {
  entry: Entry;
  active: boolean;
  onClick: () => void;
}) {
  const meta = ENTRY_TYPE_META[entry.type];
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-colors ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{entry.icon ?? meta.icon}</span>
        <span className="flex-1 truncate text-sm font-medium">{entry.title}</span>
        {entry.favorite && <span className="text-amber-400 text-xs">★</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-1 pl-7">
        <span className="text-[10px] text-ink-500">{meta.label}</span>
        {entry.tags.slice(0, 2).map((t) => (
          <span
            key={t}
            className="text-[10px] bg-white/5 text-ink-400 px-1.5 py-0.5 rounded"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}

function EntryDetail({
  entry,
  onEdit,
  onChanged,
}: {
  entry: Entry;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [content, setContent] = useState<EntryContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const dec = await decryptContent(session.key(), {
          ciphertext: entry.encrypted_content,
          iv: entry.iv,
        });
        if (!cancelled) setContent(dec);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.encrypted_content, entry.iv]);

  const meta = ENTRY_TYPE_META[entry.type];

  const handleDelete = async () => {
    if (!confirm(`将「${entry.title}」移入回收站？`)) return;
    await api.deleteEntry(entry.id);
    onChanged();
  };

  const handleFavorite = async () => {
    await api.toggleFavorite(entry.id, !entry.favorite);
    onChanged();
  };

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div className="flex items-start gap-4">
        <span className="text-3xl">{entry.icon ?? meta.icon}</span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{entry.title}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-ink-400">
            <span>{meta.label}</span>
            <span>·</span>
            <span>{new Date(entry.updated_at).toLocaleString()}</span>
          </div>
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {entry.tags.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-white/5 text-ink-300 px-2 py-0.5 rounded-md"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <IconBtn onClick={handleFavorite} title="收藏">
            {entry.favorite ? "★" : "☆"}
          </IconBtn>
          <IconBtn onClick={onEdit} title="编辑">
            ✏️
          </IconBtn>
          <IconBtn onClick={handleDelete} title="删除">
            🗑️
          </IconBtn>
        </div>
      </div>

      {loading && <div className="text-ink-500">解密中…</div>}
      {error && <div className="text-red-400">{error}</div>}

      {content && (
        <div className="space-y-3">
          {Object.entries(content.fields).length > 0 && (
            <div className="glass rounded-2xl divide-y divide-white/5">
              {Object.entries(content.fields).map(([k, v]) => (
                <FieldView key={k} name={k} value={v} />
              ))}
            </div>
          )}
          {content.notes && (
            <div className="glass rounded-2xl p-4">
              <div className="text-xs text-ink-400 mb-2">备注</div>
              <pre className="text-sm whitespace-pre-wrap font-sans text-ink-200">
                {content.notes}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldView({ name, value }: { name: string; value: string }) {
  const [show, setShow] = useState(false);
  const secret = /password|secret|key|cvv|private/i.test(name);
  const display = secret && !show ? "••••••••" : value;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="text-xs text-ink-400 w-24 shrink-0">{name}</div>
      <div className="flex-1 text-sm font-mono break-all">{display}</div>
      {secret && (
        <button
          onClick={() => setShow((s) => !s)}
          className="text-xs text-accent hover:underline"
        >
          {show ? "隐藏" : "显示"}
        </button>
      )}
      <button
        onClick={() => navigator.clipboard?.writeText(value)}
        className="text-xs text-ink-400 hover:text-ink-100"
      >
        复制
      </button>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 text-sm"
    >
      {children}
    </button>
  );
}
