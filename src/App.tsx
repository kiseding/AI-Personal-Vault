import { useState } from "react";
import { Auth } from "./components/Auth";
import { Vault } from "./components/Vault";
import { session } from "./lib/session";

/**
 * 根组件：根据解锁状态在认证页与主界面间切换。
 * 主密钥仅存内存（session），锁定后需重新输入主密码。
 */
export default function App() {
  const [unlocked, setUnlocked] = useState(session.isUnlocked());

  if (!unlocked) {
    return <Auth onUnlocked={() => setUnlocked(true)} />;
  }
  return (
    <Vault
      onLock={() => {
        session.lock();
        setUnlocked(false);
      }}
    />
  );
}
