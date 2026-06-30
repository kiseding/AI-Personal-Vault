/**
 * 顶层路由：根据 URL 路径选择渲染。
 * - /            → 显示 404（隐藏真实入口）
 * - /open        → vault
 * - /open/*      → vault 内部视图（分享中心、详情等）
 */
import { useEffect, useState } from "react";
import { Vault } from "./Vault";

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="text-center space-y-3">
        <div className="text-6xl">404</div>
        <h1 className="text-xl font-semibold">页面不存在</h1>
        <p className="text-sm text-ink-400">
          The page you are looking for does not exist.
        </p>
      </div>
    </div>
  );
}

function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function AppRouter() {
  const path = usePath();

  // 根路径 → 404（不暴露真实入口）
  if (path === "/" || path === "") {
    return <NotFound />;
  }
  // 真实入口
  if (path === "/open" || path.startsWith("/open/")) {
    return <Vault />;
  }
  return <NotFound />;
}