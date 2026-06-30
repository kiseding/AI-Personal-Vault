import { useEffect, useState } from "react";
import { Auth } from "./components/Auth";
import { Vault } from "./components/Vault";
import { NotFound, usePath } from "./components/AppRouter";
import { session } from "./lib/session";

/**
 * 根组件：
 *  - / 路径 → 永远显示 404（隐藏真实入口，不暴露登录页）
 *  - /open 路径：
 *      · 未解锁 → 显示 Auth（解锁界面）
 *      · 已解锁 → 显示 Vault
 *  - 其它路径 → 404
 */
export default function App() {
  const path = usePath();
  const [unlocked, setUnlocked] = useState(session.isUnlocked());

  // 监听锁定 / 解锁状态变化
  useEffect(() => {
    const onUnlock = () => setUnlocked(session.isUnlocked());
    const onLock = () => setUnlocked(false);
    window.addEventListener("app:lock", onLock);
    const t = setInterval(onUnlock, 500);
    return () => {
      window.removeEventListener("app:lock", onLock);
      clearInterval(t);
    };
  }, []);

  // 根路径：永远 404（不暴露登录入口）
  if (path === "/" || path === "") {
    return <NotFound />;
  }
  // /open 路径：根据解锁状态显示 Auth 或 Vault
  if (path === "/open" || path.startsWith("/open/")) {
    if (!unlocked) return <Auth onUnlocked={() => setUnlocked(true)} />;
    return <Vault />;
  }
  // 其它路径：404
  return <NotFound />;
}
