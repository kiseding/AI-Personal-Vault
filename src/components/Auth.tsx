/**
 * 认证组件：首次设置主密码 / 解锁（第四章 Zero Knowledge）
 *
 * 流程：
 *  1. 输入 App Token（部署时设置）→ 加载保险库配置（salt + verifier）
 *  2a. 若未初始化 → 设置主密码：本地派生密钥，生成 salt + verifier，上传
 *  2b. 若已初始化 → 输入主密码：本地派生密钥，用 verifier 自检
 *  3. 主密钥仅存内存，解锁成功
 */
import { useEffect, useState } from "react";
import { api, type VaultConfig } from "../lib/api";
import { session } from "../lib/session";
import {
  deriveMasterKey,
  encryptString,
  generateSalt,
  verifyPassword,
} from "@/web/crypto";

export function Auth({ onUnlocked }: { onUnlocked: () => void }) {
  const [appToken, setAppTokenState] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsToken = !sessionStorage.getItem("vault_app_token");

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await api.vaultConfig();
      setConfig(c);
      if (c.setup && c.salt && c.verifier) {
        session.setConfig(c.salt, c.verifier);
      }
    } catch (e) {
      sessionStorage.removeItem("vault_app_token");
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!appToken.trim()) return setError("请输入应用令牌");
    sessionStorage.setItem("vault_app_token", appToken.trim());
    await loadConfig();
  };

  useEffect(() => {
    if (!needsToken) {
      void loadConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetup = async () => {
    setError(null);
    if (password.length < 8) return setError("主密码至少 8 位");
    if (password !== confirm) return setError("两次输入不一致");
    setLoading(true);
    try {
      const salt = generateSalt();
      const key = await deriveMasterKey(password, salt);
      const verifier = await encryptString(key, "vault-ok");
      await api.setup({ salt, verifier });
      session.setKey(key);
      session.setConfig(salt, verifier);
      onUnlocked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    setLoading(true);
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
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const isSetup = config?.setup === true;

  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-sm glass rounded-2xl p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-4xl">🔐</div>
          <h1 className="text-xl font-semibold">AI Personal Vault</h1>
          <p className="text-sm text-ink-400">
            {needsToken
              ? "输入应用访问令牌"
              : isSetup
                ? "输入主密码解锁"
                : "创建你的保险库主密码"}
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {needsToken ? (
          <>
            <Field
              label="应用令牌 (App Token)"
              type="password"
              value={appToken}
              onChange={setAppTokenState}
              placeholder="部署时设置的 APP_TOKEN"
            />
            <Button onClick={handleConnect} loading={loading}>
              连接
            </Button>
          </>
        ) : isSetup ? (
          <>
            <Field
              label="主密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoFocus
            />
            <Button onClick={handleUnlock} loading={loading}>
              解锁
            </Button>
          </>
        ) : (
          <>
            <Field
              label="设置主密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="至少 8 位"
              autoFocus
            />
            <Field
              label="确认主密码"
              type="password"
              value={confirm}
              onChange={setConfirm}
              placeholder="再次输入"
            />
            <Button onClick={handleSetup} loading={loading}>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
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
