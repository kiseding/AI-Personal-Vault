/**
 * 顶层路由：根据 URL 路径选择渲染。
 * - /            → 显示 404（隐藏真实入口）
 * - /open        → vault
 * - /open/*      → vault 内部视图（分享中心、详情等）
 *
 * 本文件现在主要导出 NotFound 和 usePath 供 App.tsx 使用。
 * 实际鉴权 + 路由分发由 App.tsx 完成（Auth 拦截 /open，未解锁不让进）。
 */
import { useEffect, useState } from "react";

export function NotFound() {
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

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}
