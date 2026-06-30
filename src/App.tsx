import { useEffect, useState } from "react";
import { Auth } from "./components/Auth";
import { AppRouter } from "./components/AppRouter";
import { session } from "./lib/session";

/**
 * 根组件：
 *  - 未解锁 → 显示 Auth（解锁界面始终可用，无论路径）
 *  - 已解锁 → AppRouter 接管，根据 URL 决定渲染
 *  - 默认 URL 是 /open；根路径 / 显示 404
 */
export default function App() {
  const [unlocked, setUnlocked] = useState(session.isUnlocked());

  // 监听来自 Vault 的锁定事件（"vault:lock" 已在 Vault 内处理 session.lock()）
  // 这里只关注 unlock（用户重新解锁）
  useEffect(() => {
    const onUnlock = () => setUnlocked(session.isUnlocked());
    const onLock = () => setUnlocked(false);
    window.addEventListener("app:lock", onLock);
    // 周期检查（解锁时 session.isUnlocked 会变 true）
    const t = setInterval(onUnlock, 500);
    return () => {
      window.removeEventListener("app:lock", onLock);
      clearInterval(t);
    };
  }, []);

  if (!unlocked) {
    return <Auth onUnlocked={() => setUnlocked(true)} />;
  }
  return <AppRouter />;
}