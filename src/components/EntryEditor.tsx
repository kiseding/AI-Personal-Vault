/**
 * Entry 编辑器：按类型模板编辑字段 + 标签 + AI 授权（第七/十/十五章）
 * 保存前在浏览器加密，服务器只接收密文。
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { session } from "../lib/session";
import { decryptContent, encryptContent } from "@/web/crypto";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_META,
  TEMPLATES,
  AI_AGENTS,
  AI_PERMISSIONS,
  generateId,
  type Entry,
  type EntryType,
  type EntryContent,
  type AiAgent,
  type AiPermission,
} from "@/shared/types";

export function EntryEditor({
  entry,
  onDone,
  onCancel,
}: {
  entry: Entry | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<EntryType>(entry?.type ?? "password");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(false);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await decryptContent(session.key(), {
          ciphertext: entry.encrypted_content,
          iv: entry.iv,
        });
        if (!cancelled) {
          setFields(c.fields);
          setNotes(c.notes);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) return setError("请输入标题");
    setLoading(true);
    try {
      const content: EntryContent = {
        fields,
        notes,
        attachment_ids: [],
      };
      const enc = await encryptContent(session.key(), content);
      if (entry) {
        await api.updateEntry(entry.id, {
          title,
          type,
          tags,
          encrypted_content: enc.ciphertext,
          iv: enc.iv,
        });
      } else {
        await api.createEntry({
          id: generateId(),
          title,
          type,
          tags,
          favorite: false,
          icon: null,
          encrypted_content: enc.ciphertext,
          iv: enc.iv,
        });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  const template = TEMPLATES[type];

  return (
    <div className="h-screen overflow-y-auto">
      <div className="max-w-2xl mx-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            {entry ? "编辑条目" : "新建条目"}
          </h1>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-xl hover:bg-white/5"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm rounded-xl px-5 py-2 font-medium"
            >
              {loading ? "保存中…" : "保存"}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* 类型选择 */}
        <div>
          <label className="text-xs text-ink-400">类型</label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mt-1.5">
            {ENTRY_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex flex-col items-center gap-1 py-2 rounded-xl text-xs transition-colors ${
                  type === t
                    ? "bg-accent/15 text-accent"
                    : "hover:bg-white/5 text-ink-300"
                }`}
              >
                <span className="text-lg">{ENTRY_TYPE_META[t].icon}</span>
                {ENTRY_TYPE_META[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* 标题 */}
        <Field
          label="标题"
          value={title}
          onChange={setTitle}
          placeholder="给这个条目起个名字"
        />

        {/* 模板字段 */}
        <div className="space-y-3">
          {template.map((f) => (
            <Field
              key={f.key}
              label={f.label + (f.required ? " *" : "")}
              value={fields[f.key] ?? ""}
              onChange={(v) => setFields({ ...fields, [f.key]: v })}
              type={f.type === "password" || f.type === "secret" ? "password" : "text"}
              multiline={f.type === "multiline" || f.type === "textarea" || f.type === "markdown"}
              placeholder={f.placeholder}
            />
          ))}
        </div>

        {/* 备注 */}
        <div>
          <label className="text-xs text-ink-400">备注（Markdown）</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="mt-1.5 w-full bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent font-mono"
            placeholder="可选的额外说明…"
          />
        </div>

        {/* 标签 */}
        <div>
          <label className="text-xs text-ink-400">标签</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 bg-white/5 text-ink-200 text-xs px-2 py-1 rounded-md"
              >
                {t}
                <button
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="text-ink-500 hover:text-red-400"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="输入标签后回车…"
            className="mt-2 w-full bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {/* AI 授权（第十五章） */}
        {entry && (
          <div>
            <button
              onClick={() => setShowAi((s) => !s)}
              className="flex items-center gap-2 text-sm text-ink-300 hover:text-ink-100"
            >
              <span>🤖</span> AI 访问权限
              <span className="text-ink-500">{showAi ? "▾" : "▸"}</span>
            </button>
            {showAi && <AiPanel entryId={entry.id} />}
          </div>
        )}
      </div>
    </div>
  );
}

function AiPanel({ entryId }: { entryId: string }) {
  const [grants, setGrants] = useState<
    Array<{ agent: string; permission: string }>
  >([]);
  const [tokenInfo, setTokenInfo] = useState<{
    token: string;
    expires_at: string;
  } | null>(null);
  const [selAgent, setSelAgent] = useState<AiAgent>("claude-code");
  const [selTtl, setSelTtl] = useState(60);

  const load = async () => {
    const g = await api.getGrants(entryId);
    setGrants(g.map((x) => ({ agent: x.agent, permission: x.permission })));
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const setPerm = async (agent: AiAgent, permission: AiPermission) => {
    await api.setGrant(entryId, agent, permission);
    void load();
  };

  const issueToken = async () => {
    const t = await api.issueToken(entryId, selAgent, selTtl);
    setTokenInfo(t);
  };

  return (
    <div className="glass rounded-2xl p-4 space-y-4">
      <div className="space-y-2">
        {AI_AGENTS.map((agent) => {
          const perm = grants.find((g) => g.agent === agent)?.permission ?? "never";
          return (
            <div key={agent} className="flex items-center gap-3">
              <span className="text-sm w-32">{agent}</span>
              <div className="flex gap-1">
                {AI_PERMISSIONS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPerm(agent, p)}
                    className={`text-xs px-2 py-1 rounded-md ${
                      perm === p
                        ? "bg-accent text-white"
                        : "bg-white/5 text-ink-400 hover:bg-white/10"
                    }`}
                  >
                    {p === "never" ? "禁止" : p === "ask" ? "询问" : "允许"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/5 pt-4 space-y-2">
        <div className="text-xs text-ink-400">生成临时访问令牌</div>
        <div className="flex gap-2">
          <select
            value={selAgent}
            onChange={(e) => setSelAgent(e.target.value as AiAgent)}
            className="bg-ink-900/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          >
            {AI_AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={selTtl}
            onChange={(e) => setSelTtl(Number(e.target.value))}
            className="bg-ink-900/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value={30}>30 秒</option>
            <option value={60}>60 秒</option>
            <option value={300}>5 分钟</option>
          </select>
          <button
            onClick={issueToken}
            className="bg-accent hover:bg-accent-hover text-white text-xs rounded-lg px-3 py-1.5"
          >
            生成
          </button>
        </div>
        {tokenInfo && (
          <div className="bg-ink-950/60 rounded-lg p-2.5">
            <div className="text-[10px] text-ink-500 mb-1">
              令牌（单次有效，过期 {new Date(tokenInfo.expires_at).toLocaleTimeString()}）
            </div>
            <code className="text-xs text-emerald-400 break-all">
              {tokenInfo.token}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-ink-400">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="w-full bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent font-mono"
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        />
      )}
    </label>
  );
}
