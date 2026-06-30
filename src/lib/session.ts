/**
 * 内存会话：主密钥仅存于内存，刷新页面后立即消失（第四章安全要求）。
 * 非响应式 —— 仅用于存放 CryptoKey 与保险库配置，UI 状态由 React 管理。
 */

let _masterKey: CryptoKey | null = null;
let _salt = "";
let _verifier: { ciphertext: string; iv: string } | null = null;

export const session = {
  setKey(key: CryptoKey): void {
    _masterKey = key;
  },
  key(): CryptoKey {
    if (!_masterKey) throw new Error("保险库已锁定");
    return _masterKey;
  },
  isUnlocked(): boolean {
    return _masterKey !== null;
  },
  lock(): void {
    _masterKey = null;
  },
  setConfig(salt: string, verifier: { ciphertext: string; iv: string }): void {
    _salt = salt;
    _verifier = verifier;
  },
  salt(): string {
    return _salt;
  },
  verifier(): { ciphertext: string; iv: string } | null {
    return _verifier;
  },
};
