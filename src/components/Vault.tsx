/**
 * 主界面：侧栏导航（第九章）+ 列表 + 详情查看
 * 正文搜索在浏览器本地完成（第十一章：服务器不能搜索正文）
 *
 * 多选分享（0003 迁移）：
 *  - 侧栏点 📦 多选 → 进入多选模式（列表项左侧显示 checkbox）
 *  - 勾选 N 个条目 → 底部出现浮动操作栏
 *  - 点"生成分享" → 打开 ShareDialog 的批量模式
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
import { ShareDialog } from "./ShareDialog";
import { ShareCenter } from "./ShareCenter";

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

export function Vault() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"vault" | "shares">("vault");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 移动端：列表 ↔ 详情 全屏切换（桌面端忽略）
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // 多选模式（批量分享用）
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchShareOpen, setBatchShareOpen] = useState(false);

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

  // 监听侧栏的 filter 切换事件（解耦，避免 prop drilling）
  useEffect(() => {
    const filterHandler = (e: Event) => {
      const detail = (e as CustomEvent<Filter>).detail;
      setFilter(detail);
      setSelectedId(null);
      // 切换 filter 时退出多选
      setMultiSelectMode(false);
      setSelectedIds(new Set());
    };
    const newHandler = () => setEditing("new");
    const lockHandler = () => {
      session.lock();
      window.dispatchEvent(new Event("app:lock"));
    };
    window.addEventListener("vault:set-filter", filterHandler);
    window.addEventListener("vault:new-entry", newHandler);
    window.addEventListener("vault:lock", lockHandler);
    return () => {
      window.removeEventListener("vault:set-filter", filterHandler);
      window.removeEventListener("vault:new-entry", newHandler);
      window.removeEventListener("vault:lock", lockHandler);
    };
  }, []);

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

  // 进入多选模式时清空普通选中
  const toggleMultiSelectMode = () => {
    if (multiSelectMode) {
      setMultiSelectMode(false);
      setSelectedIds(new Set());
    } else {
      setMultiSelectMode(true);
      setSelectedId(null);
      setSelectedIds(new Set());
    }
  };

  // 切换某条选中状态
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 多选时，整行点击也切换勾选；非多选时点击进入详情
  const handleItemClick = (e: Entry) => {
    if (multiSelectMode) {
      toggleSelect(e.id);
    } else {
      setSelectedId(e.id);
      setMobileView("detail");
    }
  };

  if (editing) {
    return (
      <EntryEditor
        entry={editing === "new" ? null : editing}
        onDone={refresh}
        onCancel={() => setEditing(null)}
      />
    );
  }

  if (view === "shares") {
    return (
      <div className="flex h-screen">
        <Sidebar
          view={view}
          onChangeView={setView}
          multiSelectMode={multiSelectMode}
          onToggleMultiSelect={toggleMultiSelectMode}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        <ShareCenter onBack={() => setView("vault")} />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      {/* 侧栏 */}
      <Sidebar
        view={view}
        onChangeView={setView}
        multiSelectMode={multiSelectMode}
        onToggleMultiSelect={toggleMultiSelectMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      {/* 列表（移动端：详情页时整列隐藏；桌面端始终显示） */}
      <section
        className={
          mobileView === "detail"
            ? "hidden sm:flex w-full sm:w-80 shrink-0 border-r border-white/5 flex flex-col"
            : "flex w-full sm:w-80 shrink-0 border-r border-white/5 flex-col"
        }
      >
        <div className="p-3 flex items-center gap-2">
          {/* 移动端汉堡菜单 */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10"
            title="菜单"
          >
            ☰
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或标签…"
            className="flex-1 bg-ink-900/80 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        {multiSelectMode && (
          <div className="px-3 pb-2 text-xs text-accent flex items-center gap-2">
            <span>📦 多选模式</span>
            <span className="text-ink-500">已选 {selectedIds.size} 项</span>
            <button
              className="ml-auto text-ink-400 hover:text-ink-100"
              onClick={() => setSelectedIds(new Set())}
            >
              清空
            </button>
          </div>
        )}
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
              active={multiSelectMode ? selectedIds.has(e.id) : e.id === selectedId}
              multiSelectMode={multiSelectMode}
              onClick={() => handleItemClick(e)}
            />
          ))}
        </div>
      </section>

      {/* 详情（移动端：列表页时整块隐藏；桌面端始终显示） */}
      <main
        className={
          mobileView === "list"
            ? "hidden sm:flex flex-1 overflow-y-auto"
            : "flex sm:flex flex-1 overflow-y-auto"
        }
      >
        {multiSelectMode ? (
          <MultiSelectEmpty />
        ) : selected ? (
          <EntryDetail
            entry={selected}
            onEdit={() => setEditing(selected)}
            onChanged={refresh}
            onBack={() => {
              setSelectedId(null);
              setMobileView("list");
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-ink-600">
            <div className="text-center space-y-2">
              <div className="text-5xl">🔓</div>
              <p className="text-sm">选择一个条目查看，或点击「新建」</p>
            </div>
          </div>
        )}
      </main>

      {/* 多选浮动操作栏 */}
      {multiSelectMode && selectedIds.size > 0 && (
        <MultiSelectBar
          count={selectedIds.size}
          onShare={() => setBatchShareOpen(true)}
          onCancel={toggleMultiSelectMode}
        />
      )}

      {/* 批量分享对话框 */}
      {batchShareOpen && (
        <ShareDialog
          entryIds={Array.from(selectedIds)}
          entryTitles={entries
            .filter((e) => selectedIds.has(e.id))
            .map((e) => e.title)}
          onClose={() => setBatchShareOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 侧栏（移动端为 drawer，桌面端为常驻）
 */
function Sidebar({
  view,
  onChangeView,
  multiSelectMode,
  onToggleMultiSelect,
  mobileOpen,
  onCloseMobile,
}: {
  view: "vault" | "shares";
  onChangeView: (v: "vault" | "shares") => void;
  multiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const [filter, setFilterLocal] = useState<Filter>({ kind: "all" });

  // 移动端 drawer
  const drawerClasses = mobileOpen
    ? "fixed inset-y-0 left-0 z-40 w-72 sm:relative sm:inset-auto sm:z-auto sm:w-60 sm:shrink-0"
    : "hidden sm:flex sm:w-60 sm:shrink-0";

  return (
    <>
      {/* 移动端 backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 sm:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`${drawerClasses} glass border-r border-white/5 flex-col ${
          mobileOpen ? "flex" : ""
        }`}
      >
        <div className="p-4 flex items-center justify-between">
          <span className="font-semibold flex items-center gap-2">
            <span>🔐</span> Vault
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => window.dispatchEvent(new Event("vault:lock"))}
              className="text-xs text-ink-400 hover:text-ink-100 px-2 py-1 rounded-lg hover:bg-white/5"
            >
              锁定
            </button>
            {/* 移动端关闭按钮 */}
            <button
              onClick={onCloseMobile}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"
              title="关闭"
            >
              ✕
            </button>
          </div>
        </div>
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent("vault:new-entry"));
            onCloseMobile();
          }}
          className={`mx-3 mb-2 text-sm rounded-xl py-2 font-medium transition-colors ${
            view === "vault"
              ? "bg-accent text-white"
              : "bg-white/5 text-ink-200 hover:bg-white/10"
          }`}
        >
          + 新建
        </button>
        {view === "vault" && (
          <button
            onClick={() => {
              onToggleMultiSelect();
              onCloseMobile();
            }}
            className={`mx-3 mb-2 text-sm rounded-xl py-2 transition-colors flex items-center justify-center gap-2 ${
              multiSelectMode
                ? "bg-accent/15 text-accent border border-accent/40"
                : "bg-white/5 text-ink-200 hover:bg-white/10"
            }`}
          >
            📦 {multiSelectMode ? "退出多选" : "多选分享"}
          </button>
        )}
        <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
          {view === "vault" && (
            <>
              {NAV.map((item) => (
                <NavBtn
                  key={item.key}
                  active={JSON.stringify(item.filter) === JSON.stringify(filter)}
                  onClick={() => {
                    setFilterLocal(item.filter);
                    window.dispatchEvent(
                      new CustomEvent("vault:set-filter", { detail: item.filter }),
                    );
                    onCloseMobile();
                  }}
                  icon={item.icon}
                  label={item.label}
                />
              ))}
              <div className="h-px bg-white/5 my-2" />
              <NavBtn
                active={filter.kind === "trashed"}
                onClick={() => {
                  setFilterLocal({ kind: "trashed" });
                  window.dispatchEvent(
                    new CustomEvent("vault:set-filter", { detail: { kind: "trashed" } }),
                  );
                  onCloseMobile();
                }}
                icon="🗑️"
                label="回收站"
              />
            </>
          )}
          <div className="h-px bg-white/5 my-2" />
          <NavBtn
            active={view === "shares"}
            onClick={() => {
              onChangeView("shares");
              onCloseMobile();
            }}
            icon="🔗"
            label="分享中心"
          />
        </nav>
      </aside>
    </>
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
  multiSelectMode,
  onClick,
}: {
  entry: Entry;
  active: boolean;
  multiSelectMode: boolean;
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
        {multiSelectMode && (
          <span
            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
              active
                ? "bg-accent border-accent text-white"
                : "border-white/30"
            }`}
          >
            {active ? "✓" : ""}
          </span>
        )}
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

function MultiSelectEmpty() {
  return (
    <div className="h-full flex items-center justify-center text-ink-600">
      <div className="text-center space-y-3 max-w-sm px-6">
        <div className="text-5xl">📦</div>
        <p className="text-sm">多选模式已开启</p>
        <p className="text-xs text-ink-500 leading-relaxed">
          在左侧列表点选多个条目，然后点击底部「生成分享」按钮，
          可以一次性把所选条目（+ 可选附件）打包成单个链接交付给 AI。
        </p>
      </div>
    </div>
  );
}

function MultiSelectBar({
  count,
  onShare,
  onCancel,
}: {
  count: number;
  onShare: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 glass rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl">
      <span className="text-sm">
        已选 <span className="text-accent font-semibold">{count}</span> 项
      </span>
      <button
        onClick={onShare}
        className="bg-accent hover:bg-accent-hover text-white text-sm rounded-xl px-4 py-1.5 font-medium"
      >
        🔗 生成分享
      </button>
      <button
        onClick={onCancel}
        className="text-xs text-ink-400 hover:text-ink-100 px-2 py-1"
      >
        取消
      </button>
    </div>
  );
}

function EntryDetail({
  entry,
  onEdit,
  onChanged,
  onBack,
}: {
  entry: Entry;
  onEdit: () => void;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const [content, setContent] = useState<EntryContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

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
    <div className="max-w-2xl mx-auto p-4 sm:p-8 space-y-6">
      {/* 移动端返回按钮 */}
      {onBack && (
        <button
          onClick={onBack}
          className="sm:hidden -ml-2 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 text-base"
          title="返回列表"
        >
          ← 返回
        </button>
      )}
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="text-3xl shrink-0">{entry.icon ?? meta.icon}</span>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold break-words">{entry.title}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs sm:text-sm text-ink-400">
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
        <div className="flex flex-wrap gap-1 shrink-0">
          <IconBtn onClick={handleFavorite} title="收藏">
            {entry.favorite ? "★" : "☆"}
          </IconBtn>
          <IconBtn onClick={() => setShowShare(true)} title="分享给 AI">
            🔗
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
      {showShare && (
        <ShareDialog entryId={entry.id} onClose={() => setShowShare(false)} />
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
