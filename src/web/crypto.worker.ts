/**
 * AI Personal Vault - 浏览器端 PBKDF2 Web Worker
 *
 * feat/perf：把 600K 次 PBKDF2 派生从主线程迁到 Worker，
 * 解决移动端解锁时 UI 冻结 1-5 秒的问题（P0-1）。
 *
 * 协议：
 *   主 → worker: { id: number, type: 'deriveMasterKey', payload: { password, saltB64 } }
 *   worker → 主: { id, ok: true, raw: ArrayBuffer }
 *                     或 { id, ok: false, error: string }
 *
 * 安全说明：
 *  worker 内的 AES-GCM key 在派生时显式标记 extractable=true，
 *  仅用于 export 一次后丢弃。回到主线程后立刻 importKey 为
 *  extractable=false，再覆盖 raw buffer。这一窗口（≈ms 级别）
 *  是 raw AES 字节在主线程堆里存在的唯一机会，主要风险已写 PR 描述。
 *
 * 协议 ID 由主线程分配，允许多个并发请求各自关联。
 */

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256;

declare const self: DedicatedWorkerGlobalScope;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
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

async function derive(password: string, saltB64: string): Promise<ArrayBuffer> {
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  // extractable=true：worker 需要 export 给主线程
  // 主线程 importKey 时设为 false，并把 raw buffer 覆写
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
  return crypto.subtle.exportKey("raw", aesKey);
}

self.addEventListener("message", async (e: MessageEvent) => {
  const { id, type, payload } = e.data as {
    id: number;
    type: string;
    payload: { password: string; saltB64: string };
  };
  try {
    if (type === "deriveMasterKey") {
      const raw = await derive(payload.password, payload.saltB64);
      self.postMessage({ id, ok: true, raw });
    } else {
      self.postMessage({ id, ok: false, error: `unknown type: ${type}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, ok: false, error: msg });
  }
});
