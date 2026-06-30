/**
 * 附件路由：加密附件存 R2（第八章）
 * 客户端加密后上传密文，服务器只存储/转发密文。
 */
import { Hono } from "hono";
import type { AppContext } from "../env";
import { audit } from "../middleware";

export const attachments = new Hono<AppContext>();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface AttRow {
  id: string;
  entry_id: string;
  name: string;
  mime: string;
  size: number;
  r2_key: string;
  iv: string;
  created_at: string;
}

/** 列出某 entry 的附件元数据 */
attachments.get("/entries/:id/attachments", async (c) => {
  const entryId = c.req.param("id");
  const res = await c.env.DB
    .prepare("SELECT * FROM attachments WHERE entry_id=? ORDER BY created_at DESC")
    .bind(entryId)
    .all<AttRow>();
  return c.json({ ok: true, data: res.results });
});

/** 上传加密附件（base64 密文 + iv） */
attachments.post("/entries/:id/attachments", async (c) => {
  const entryId = c.req.param("id");
  const body = await c.req.json<{
    name: string;
    mime: string;
    ciphertext: string;
    iv: string;
  }>();
  const id = crypto.randomUUID();
  const r2Key = `attachments/${id}`;
  const bytes = b64ToBytes(body.ciphertext);
  await c.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  await c.env.DB
    .prepare(
      "INSERT INTO attachments (id, entry_id, name, mime, size, r2_key, iv) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(id, entryId, body.name, body.mime, bytes.byteLength, r2Key, body.iv)
    .run();
  audit(c, entryId, "upload-attachment", true);
  return c.json({ ok: true, data: { id, size: bytes.byteLength } });
});

/** 下载附件（返回密文，客户端用 iv 解密） */
attachments.get("/attachments/:aid", async (c) => {
  const aid = c.req.param("aid");
  const meta = await c.env.DB
    .prepare("SELECT * FROM attachments WHERE id=?")
    .bind(aid)
    .first<AttRow>();
  if (!meta) return c.json({ ok: false, error: "未找到" }, 404);
  const obj = await c.env.BUCKET.get(meta.r2_key);
  if (!obj) return c.json({ ok: false, error: "R2 对象丢失" }, 404);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  audit(c, meta.entry_id, "download-attachment", true);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.name)}"`,
      "X-Attachment-IV": meta.iv,
      "X-Attachment-Size": String(meta.size),
    },
  });
});

/** 删除附件 */
attachments.delete("/attachments/:aid", async (c) => {
  const aid = c.req.param("aid");
  const meta = await c.env.DB
    .prepare("SELECT r2_key, entry_id FROM attachments WHERE id=?")
    .bind(aid)
    .first<{ r2_key: string; entry_id: string }>();
  if (!meta) return c.json({ ok: false, error: "未找到" }, 404);
  await c.env.BUCKET.delete(meta.r2_key);
  await c.env.DB.prepare("DELETE FROM attachments WHERE id=?").bind(aid).run();
  audit(c, meta.entry_id, "delete-attachment", true);
  return c.json({ ok: true });
});
