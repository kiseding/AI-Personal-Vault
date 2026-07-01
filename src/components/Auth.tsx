/**
 * 认证组件：首次设置主密码 / 解锁（第四章 Zero Knowledge）
 *
 * 流程：
 *  1. 加载 vault 配置（公开接口，无需 App Token）
 *  2a. 若未初始化 → 同时设置 App Token + 主密码
 *  2b. 若已初始化 → 用本地存储的 App Token + 主密码解锁
 *  3. 主密钥仅存内存，解锁成功
 *
 * feat/auth-hardening（P1-3）：
 *  - App Token 在 setup 之后仍被中间件要求，所以这里把 Token 字段一直显示
 *  - Token 输入后会同时写入 sessionStorage 与 localStorage，浏览器重启后仍可用
 *  - 首次访问的用户看到空 Token 字段；老用户看到已填好，无需每次输入
 *
 * 注意：localStorage 是 XSS-可读；本 SPA 没有 dangerouslySetInnerHTML 或 eval，
 * 风险面很低。若日后引入第三方脚本，需重新审视。
 */
import { useEffect, useState } from "react";
import { api, type VaultConfig, setAppToken, clearAppToken } from "../lib/api";
import { session } from "../lib/session";
import {
  deriveMasterKey,
  encryptString,
  generateSalt,
  verifyPassword,
} from "@/web/crypto";

export function Auth({ onUnlocked }: { onUnlocked: () => void }) {
  const [config, setConfig] = useState<VaultConfig | null>(null);
  // 优先从 localStorage 持久层预填；空字符串表示尚未设置
  const [appToken, setAppTokenState] = useState(
    () => localStorage.getItem("vault_app_token_persistent") ?? "",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  // 把 appToken 同步到 sessionStorage + localStorage，方便后续 api.ts 读取
  // 用 effect 而非 onBlur：避免用户输入完毕不点别处时未写入；浏览器关闭时也会丢失状态
  useEffect(() => {
    if (appToken) setAppToken(appToken);
    else clearAppToken();
  }, [appToken]);

  // 启动时立即拉 vault config（接口在白名单，无需 App Token）
  useEffect(() => {
    void (async () => {
      try {
        const c = await api.vaultConfig();
        setConfig(c);
        if (c.setup && c.salt && c.verifier) {
          session.setConfig(c.salt, c.verifier);
        }
      } catch (e) {
        setError("无法连接服务器：" + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isSetup = config?.setup === true;

  const handleSetup = async () => {
    setError(null);
    if (!appToken.trim()) return setError("请输入 APP 访问令牌");
    if (password.length < 8) return setError("主密码至少 8 位");
    if (password !== confirm) return setError("两次输入不一致");
    setBusy(true);
    try {
      const salt = generateSalt();
      const key = await deriveMasterKey(password, salt);
      const verifier = await encryptString(key, "vault-ok");
      await api.setup({ salt, verifier });
      session.setKey(key);
      session.setConfig(salt, verifier);
      onUnlocked();
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg.includes("401") || msg.includes("未授权") || msg.includes("令牌")
          ? "APP_TOKEN 无效：请重新粘贴并确认 .dev.vars / Cloudflare Secret"
          : "设置失败：" + msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    if (loading || !session.salt() || !session.verifier()) {
      setError("保险库配置加载中…");
      return;
    }
    if (!appToken.trim()) return setError("缺少 APP 访问令牌");
    setBusy(true);
    try {
      const key = await verifyPassword(
        password,
        session.salt(),
        session.verifier()!,
      );
      if (!key) {
        setError("主密码错误");
        return;
      }
      session.setKey(key);
      onUnlocked();
    } catch (e) {
      setError("解锁失败：保险库数据可能损坏，请刷新页面重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-sm glass rounded-2xl p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h1 className="text-xl font-semibold">AI Personal Vault</h1>
          <p className="text-sm text-ink-400">
            {loading
              ? "加载中…"
              : isSetup
                ? "输入主密码解锁"
                : "创建你的保险库"}
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* 任何一个分支前都先显示 APP Token 字段（feat/auth-hardening） */}
        {!loading && (
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-400">APP 访问令牌</span>
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="text-xs text-ink-500 hover:text-ink-200"
              >
                {showToken ? "隐藏" : "显示"}
              </button>
            </div>
            <div className="flex gap-1.5">
              <input
                type={showToken ? "text" : "password"}
                value={appToken}
                onChange={(e) => setAppTokenState(e.target.value)}
                placeholder="APP_TOKEN"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:bg-ink-900 font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  setAppTokenState("");
                  clearAppToken();
                }}
                className="px-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs text-ink-400"
                title="清除令牌（下次访问重新输入）"
              >
                清
              </button>
            </div>
            <p className="text-[10px] text-ink-500 leading-relaxed">
              浏览器会记住令牌。清除将强制下次重新输入。
            </p>
          </label>
        )}

        {!loading && isSetup && (
          <>
            <Field
              label="主密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoFocus
              onSubmit={handleUnlock}
            />
            <Button onClick={handleUnlock} loading={busy || loading}>
              解锁
            </Button>
          </>
        )}

        {!loading && !isSetup && (
          <>
            <Field
              label="设置主密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="至少 8 位"
            />
            <Field
              label="确认主密码"
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="再次输入"
              onSubmit={handleSetup}
            />
            <Button onClick={handleSetup} loading={busy || loading}>
              创建保险库
            </Button>
            <p className="text-xs text-ink-500 leading-relaxed">
              主密码仅在浏览器派生加密密钥，永不上传服务器。请务必牢记，丢失后无法找回。
            </p>
          </>
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
  autoFocus,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-ink-400">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter") onSubmit();
        }}
        className="w-full bg-ink-900/80 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:bg-ink-900"
      />
    </label>
  );
}

function Button({
  children,
  onClick,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
    >
      {loading ? "处理中…" : children}
    </button>
  );
}
