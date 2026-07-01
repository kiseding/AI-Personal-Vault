/**
 * AI Personal Vault - 浏览器端加密层（第四章「安全要求」）
 *
 * feat/perf: 600K 次 PBKDF2 派生迁到 crypto.worker（P0-1），
 * 主线程不再被 1-5s 的派生阻塞；移动端解锁体验显著改善。
 *
 * 其它加密操作（AES-GCM）继续在主线程 —— 它足够快，不值得引入 worker
 * round-trip 延迟。
 *
 * 其它功能不变：分享提取码 6 位（feat/mobile-hardening）、
 * 批量分享复用 share key（feat/batch-share）、AES-GCM 256 / PBKDF2 600k。
 */

import type { EntryContent } from "@/shared/types";

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------
const SHARE_PBKDF2_ITERATIONS = 100_000; // 4-6 位提取码派生（码空间小，需高迭代防爆破）
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

// ----------------------------------------------------------------------------
// Base64 <-> Uint8Array 工具
// ----------------------------------------------------------------------------
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
    return u.buffer as ArrayBuffer;
  }
  return u.slice().buffer as ArrayBuffer;
}

// ----------------------------------------------------------------------------
// Salt 生成
// ----------------------------------------------------------------------------
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return bytesToBase64(salt);
}

// ----------------------------------------------------------------------------
// 主密钥派生（feat/perf: 迁到 Worker，60 万次 PBKDF2 不再阻塞主线程）
// ----------------------------------------------------------------------------
type PendingCb = {
  resolve: (raw: ArrayBuffer) => void;
  reject: (e: Error) => void;
};
let _worker: Worker | null = null;
let _workerReady: Promise<Worker> | null = null;
let _nextId = 0;
const _pending = new Map<number, PendingCb>();

function getCryptoWorker(): Promise<Worker> {
  if (!_workerReady) {
    _workerReady = new Promise<Worker>((resolve, reject) => {
      try {
        const w = new Worker(
          new URL("./crypto.worker.ts", import.meta.url),
          { type: "module" },
        );
        w.onmessage = (e: MessageEvent) => {
          const msg = e.data as {
            id: number;
            ok: boolean;
            raw?: ArrayBuffer;
            error?: string;
          };
          const p = _pending.get(msg.id);
          if (!p) return; // 已超时或取消
          _pending.delete(msg.id);
          if (msg.ok && msg.raw) {
            p.resolve(msg.raw);
          } else {
            p.reject(new Error(msg.error ?? "worker error"));
          }
        };
        w.onerror = (e) => {
          const msg = `crypto worker error: ${e.message}`;
          for (const [, p] of _pending) p.reject(new Error(msg));
          _pending.clear();
          reject(new Error(msg));
        };
        _worker = w;
        resolve(w);
      } catch (e) {
        reject(e as Error);
      }
    });
  }
  return _workerReady;
}

export async function deriveMasterKey(
  password: string,
  saltB64: string,
): Promise<CryptoKey> {
  const w = await getCryptoWorker();
  const id = ++_nextId;
  const raw = await new Promise<ArrayBuffer>((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({
      id,
      type: "deriveMasterKey",
      payload: { password, saltB64 },
    });
  });
  // 把 raw 字节导入为非 extractable AES-GCM key。raw buffer 立即覆写随机数据
  // 防止后续被内存分析读到。导出回主线程的窗口约数毫秒，是该方案的主要权衡。
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
  crypto.getRandomValues(new Uint8Array(raw));
  return key;
}

// ----------------------------------------------------------------------------
// AES-GCM 加解密原语
// ----------------------------------------------------------------------------
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

export function generateIv(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(IV_LENGTH)));
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function decryptString(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ciphertext);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  );
  return new TextDecoder().decode(plainBuf);
}

// ----------------------------------------------------------------------------
// Entry 正文 / 附件
// ----------------------------------------------------------------------------
export async function encryptContent(
  key: CryptoKey,
  content: EntryContent,
): Promise<EncryptedPayload> {
  return encryptString(key, JSON.stringify(content));
}

export async function decryptContent(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<EntryContent> {
  const json = await decryptString(key, payload);
  return JSON.parse(json) as EntryContent;
}

export async function encryptBytes(
  key: CryptoKey,
  data: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function decryptBytes(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  );
  return new Uint8Array(plain);
}

// ----------------------------------------------------------------------------
// 验证主密码：派生密钥后尝试解密校验密文，成功则密码正确。
// ----------------------------------------------------------------------------
export async function verifyPassword(
  password: string,
  saltB64: string,
  verifier: EncryptedPayload,
): Promise<CryptoKey | null> {
  const key = await deriveMasterKey(password, saltB64);
  try {
    await decryptString(key, verifier);
    return key;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// 分享（百度网盘模式）：用 6 位提取码派生临时密钥加密明文
// ----------------------------------------------------------------------------

export function generateShareCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}

export function generateShareSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(SALT_LENGTH)));
}

export async function hashShareCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function deriveShareKey(
  code: string,
  saltB64: string,
): Promise<CryptoKey> {
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: SHARE_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SharePayload extends EncryptedPayload {
  salt: string;
}

export async function encryptWithShareCode(
  plaintext: string,
): Promise<{ code: string; payload: SharePayload }> {
  const code = generateShareCode();
  const salt = generateShareSalt();
  const key = await deriveShareKey(code, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return {
    code,
    payload: {
      ciphertext: bytesToBase64(new Uint8Array(ct)),
      iv: bytesToBase64(iv),
      salt,
    },
  };
}

export async function decryptWithShareCode(
  code: string,
  payload: SharePayload,
): Promise<string> {
  if (!/^\d{4,6}$/.test(code)) {
    throw new Error("提取码格式错误（4-6 位数字）");
  }
  const key = await deriveShareKey(code, payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ciphertext);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  );
  return new TextDecoder().decode(plainBuf);
}

// ----------------------------------------------------------------------------
// 批量分享：复用同一 share key 多次加密
// ----------------------------------------------------------------------------

export async function encryptWithShareKey(
  plaintext: string,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function encryptBytesWithShareKey(
  data: Uint8Array,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}
