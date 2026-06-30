/**
 * AI Personal Vault - 浏览器端零知识加密层（第四章「安全要求」）
 *
 * 核心原则：
 * - 主密码永远不上传服务器，刷新页面后立即从内存消失
 * - 密钥派生使用 PBKDF2-SHA256（高迭代 60 万次，Web Crypto 原生）
 *   Argon2id 为更优方案，但需独立 WASM 库；当前以 PBKDF2 为零依赖兼容实现
 * - 正文加密使用 AES-GCM 256，每次随机 12 字节 IV
 * - 全部使用 Web Crypto API，不自行实现密码学算法
 *
 * 服务器永远只能看到密文。
 */

import type { EntryContent } from "@/shared/types";

// ----------------------------------------------------------------------------
// 常量
// ----------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 推荐下限
const SALT_LENGTH = 16; // 字节
const IV_LENGTH = 12; // AES-GCM 推荐 96 位
const KEY_LENGTH = 256; // 位

// ----------------------------------------------------------------------------
// Base64 <-> Uint8Array 工具
// ----------------------------------------------------------------------------
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** 返回 ArrayBuffer 支持的 Uint8Array（TS 5.7 BufferSource 兼容） */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把任意 Uint8Array 转为 ArrayBuffer，确保可赋给 Web Crypto 的 BufferSource */
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
    return u.buffer as ArrayBuffer;
  }
  return u.slice().buffer as ArrayBuffer;
}

// ----------------------------------------------------------------------------
// Salt 生成（账号级，明文存服务器）
// ----------------------------------------------------------------------------
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return bytesToBase64(salt);
}

// ----------------------------------------------------------------------------
// 主密钥派生：主密码 + salt → AES-GCM CryptoKey（PBKDF2-SHA256）
// ----------------------------------------------------------------------------
export async function deriveMasterKey(
  password: string,
  saltB64: string,
): Promise<CryptoKey> {
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

// ----------------------------------------------------------------------------
// AES-GCM 加解密原语
// ----------------------------------------------------------------------------
export interface EncryptedPayload {
  /** base64 密文 */
  ciphertext: string;
  /** base64 IV */
  iv: string;
}

/** 生成随机 IV（base64） */
export function generateIv(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(IV_LENGTH)));
}

/** 加密字符串 */
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

/** 解密字符串 */
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
// Entry 正文加解密（结构化字段序列化为 JSON 后加密）
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

// ----------------------------------------------------------------------------
// 附件（二进制）加解密
// ----------------------------------------------------------------------------
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
