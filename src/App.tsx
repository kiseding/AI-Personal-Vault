/**
 * 根组件：
 *  - / 路径 → 永远显示 404（隐藏真实入口，不暴露登录页）
 *  - /open 路径：
 *      · 未解锁 → 显示 Auth（解锁界面）
 *      · 已解锁 → 显示 Vault
 *  - 其它路径 → 404
 *
 * 安全加固（feat/mobile-hardening）：
 *  - 移除 500ms 轮询（电池/CPU 浪费）
 *  - 增加 visibilitychange 监听：后台超过 30s 自动锁（P0-3）
 *  - 监听 iOS Safari freeze / pagehide：冻结前同步清掉主密钥
 */
import { useEffect, useState } from "react";
import { Auth } from "./components/Auth";
import { Vault } from "./components/Vault";
import { NotFound, usePath } from "./components/AppRouter";
import { session } from "./lib/session";

// 后台超过此时长自动锁定（毫秒）。30s 兼顾：
//  - 用户正常切 tab / 看消息（<10s）不会被打扰
//  - 手机锁屏 / iOS Safari 冻结场景（≥30s）会被强制重新解锁
const BACKGROUND_LOCK_MS = 30_000;

export default function App() {
  const path = usePath();
  const [unlocked, setUnlocked] = useState(session.isUnlocked());

  useEffect(() => {
    const onLock = () => setUnlocked(false);
    window.addEventListener("app:lock", onLock);

    // 后台时长累计 + 自动锁定
    let hiddenSince: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
      } else if (
        document.visibilityState === "visible" &&
        hiddenSince !== null
      ) {
        if (
          Date.now() - hiddenSince > BACKGROUND_LOCK_MS &&
          session.isUnlocked()
        ) {
          session.lock();
          window.dispatchEvent(new Event("app:lock"));
        }
        hiddenSince = null;
      }
    };

    // iOS Safari 冻结：冻结前是同步上下文，可以安全清密钥
    const onFreezeOrHide = () => {
      if (session.isUnlocked()) session.lock();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("freeze", onFreezeOrHide);
    window.addEventListener("pagehide", onFreezeOrHide);

    return () => {
      window.removeEventListener("app:lock", onLock);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("freeze", onFreezeOrHide);
      window.removeEventListener("pagehide", onFreezeOrHide);
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
