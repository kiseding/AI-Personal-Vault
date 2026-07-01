/**
 * 认证组件：首次设置主密码 / 解锁（第四章 Zero Knowledge）
 *
 * 流程：
 *  1. 加载 vault 配置（公开接口，无需 App Token）
 *  2a. 若未初始化 → 设置主密码：本地派生密钥，生成 salt + verifier，上传
 *  2b. 若已初始化 → 输入主密码：本地派生密钥，用 verifier 自检
 *  3. 主密钥仅存内存，解锁成功
 *
 * App Token 仅在 vault 未初始化时由中间件强制要求；初始化完成后
 * 所有接口均跳过 App Token 校验（用户已用主密码自证身份）。
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
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // setup 阶段错误通常是网络 / APP_TOKEN / 派生失败，细化提示便于排查
      const msg = (e as Error).message;
      setError(
        msg.includes("401") || msg.includes("未授权")
          ? "APP_TOKEN 无效：请检查 .dev.vars 或 Cloudflare Secret"
          : "设置失败：" + msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    // 配置未就绪时禁用提交，避免 race 触发空 salt 派生
    if (loading || !session.salt() || !session.verifier()) {
      setError("保险库配置加载中…");
      return;
    }
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
      // AEAD 解密失败可能是主密码错，也可能是 verifier 数据损坏
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
                : "创建你的保险库主密码"}
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
            {error}
          </div>
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
              autoFocus
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
