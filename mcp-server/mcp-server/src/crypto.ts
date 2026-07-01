/**
 * AI Personal Vault MCP - 本地解密分享
 *
 * 镜像 src/web/crypto.ts 的 encryptWithShareCode 解密流程，
 * 与 Vault Worker share-read 路径保持一致。
 *
 * 关键参数：
 *  - PBKDF2-SHA256，100,000 次迭代（与 Vault 浏览器端加密完全对齐）
 *  - AES-GCM 256，随机 12 字节 IV
 *  - 全部使用 Web Crypto API（Node 18+ 全局可用）
 */

export interface SharePayload {
  /** base64 密文 */
  ciphertext: string;
  /** base64 IV（12 字节） */
  iv: string;
  /** base64 salt（16 字节，PBKDF2 用） */
  salt: string;
}

const PBKDF2_ITERATIONS = 100_000;

/** 规范化 Uint8Array 到 ArrayBuffer（Web Crypto BufferSource 要求） */
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
    return u.buffer as ArrayBuffer;
  }
  return u.slice().buffer as ArrayBuffer;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 用 4 位提取码 + salt 派生 AES-GCM 临时密钥，并解密密文 */
export async function decryptWithShareCode(
  code: string,
  payload: SharePayload,
): Promise<string> {
  if (!/^\d{4}$/.test(code)) {
    throw new Error("提取码必须是 4 位数字");
  }
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ciphertext);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ct),
  );
  return new TextDecoder().decode(plain);
}
