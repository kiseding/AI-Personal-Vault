/**
 * Entry 路由：CRUD + 收藏 + 回收站 + 历史版本（第二/五/九/十二/十三/十四章）
 *
 * 服务器只接收/返回密文，永远不解密正文。
 */
import { Hono } from "hono";
import type { AppContext } from "../env";
import { audit } from "../middleware";
import type { Entry, EntryType } from "../../src/shared/types";

export const entries = new Hono<AppContext>();

type E = Entry;
type ET = EntryType;

interface EntryRow {
  id: string;
  title: string;
  type: string;
  favorite: number;
  icon: string | null;
  encrypted_content: string;
  iv: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 读取某 entry 的标签名列表 */
async function getTags(db: D1Database, entryId: string): Promise<string[]> {
  const res = await db
    .prepare(
      "SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ?",
    )
    .bind(entryId)
    .all<{ name: string }>();
  return res.results.map((r) => r.name);
}

/** 写入标签（重建关联）：upsert tag 名 → 重置 entry_tags */
async function setTags(db: D1Database, entryId: string, tags: string[]) {
  await db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").bind(entryId).run();
  for (const name of tags) {
    if (!name) continue;
    let tag = await db
      .prepare("SELECT id FROM tags WHERE name = ?")
      .bind(name)
      .first<{ id: string }>();
    if (!tag) {
      const tagId = crypto.randomUUID();
      await db
        .prepare("INSERT INTO tags (id, name) VALUES (?, ?)")
        .bind(tagId, name)
        .run();
      tag = { id: tagId };
    }
    await db
      .prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)")
      .bind(entryId, tag.id)
      .run();
  }
}

function rowToEntry(row: EntryRow, tags: string[]): E {
  return {
    id: row.id,
    title: row.title,
    type: row.type as ET,
    tags,
    favorite: row.favorite === 1,
    icon: row.icon,
    encrypted_content: row.encrypted_content,
    iv: row.iv,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

// --- 列表（支持筛选：type / favorite / trashed / tag）-------------------------
entries.get("/", async (c) => {
  const trashed = c.req.query("trashed") === "true";
  const favorite = c.req.query("favorite") === "true";
  const type = c.req.query("type");
  const tag = c.req.query("tag");

  let sql = "SELECT * FROM entries";
  const where: string[] = [];
  const binds: string[] = [];
  if (trashed) {
    where.push("deleted_at IS NOT NULL");
  } else {
    where.push("deleted_at IS NULL");
  }
  if (favorite) where.push("favorite = 1");
  if (type) {
    where.push("type = ?");
    binds.push(type);
  }
  sql += " WHERE " + where.join(" AND ");

  if (tag) {
    sql =
      "SELECT e.* FROM entries e JOIN entry_tags et ON et.entry_id = e.id " +
      "JOIN tags t ON t.id = et.tag_id WHERE " +
      (trashed ? "e.deleted_at IS NOT NULL" : "e.deleted_at IS NULL") +
      " AND t.name = ?";
    binds.unshift(tag);
  }
  sql += " ORDER BY updated_at DESC";

  const stmt = c.env.DB.prepare(sql);
  const res = await (binds.length ? stmt.bind(...binds) : stmt).all<EntryRow>();
  const data = await Promise.all(
    res.results.map(async (r) => rowToEntry(r, await getTags(c.env.DB, r.id))),
  );
  return c.json({ ok: true, data });
});

// --- 详情 --------------------------------------------------------------------
entries.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id = ?")
    .bind(id)
    .first<EntryRow>();
  if (!row) {
    audit(c, id, "read", false);
    return c.json({ ok: false, error: "未找到" }, 404);
  }
  audit(c, id, "read", true);
  return c.json({ ok: true, data: rowToEntry(row, await getTags(c.env.DB, id)) });
});

// --- 创建 --------------------------------------------------------------------
entries.post("/", async (c) => {
  const body = await c.req.json<{
    id: string;
    title: string;
    type: EntryType;
    tags?: string[];
    favorite?: boolean;
    icon?: string | null;
    encrypted_content: string;
    iv: string;
  }>();

  await c.env.DB.prepare(
    `INSERT INTO entries (id, title, type, favorite, icon, encrypted_content, iv)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.id,
      body.title,
      body.type,
      body.favorite ? 1 : 0,
      body.icon ?? null,
      body.encrypted_content,
      body.iv,
    )
    .run();

  if (body.tags?.length) await setTags(c.env.DB, body.id, body.tags);
  audit(c, body.id, "create", true);
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id = ?")
    .bind(body.id)
    .first<EntryRow>();
  return c.json({ ok: true, data: rowToEntry(row!, await getTags(c.env.DB, body.id)) });
});

// --- 更新（同时存历史版本）---------------------------------------------------
entries.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    title: string;
    type: EntryType;
    tags?: string[];
    favorite?: boolean;
    icon?: string | null;
    encrypted_content: string;
    iv: string;
  }>();

  // 存旧版本
  const old = await c.env.DB.prepare("SELECT * FROM entries WHERE id = ?")
    .bind(id)
    .first<EntryRow>();
  if (!old) return c.json({ ok: false, error: "未找到" }, 404);
  await c.env.DB.prepare(
    "INSERT INTO versions (id, entry_id, encrypted_content, iv) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), id, old.encrypted_content, old.iv)
    .run();

  await c.env.DB.prepare(
    `UPDATE entries SET title=?, type=?, favorite=?, icon=?, encrypted_content=?, iv=?, updated_at=datetime('now')
     WHERE id=?`,
  )
    .bind(
      body.title,
      body.type,
      body.favorite ? 1 : 0,
      body.icon ?? null,
      body.encrypted_content,
      body.iv,
      id,
    )
    .run();

  if (body.tags) await setTags(c.env.DB, id, body.tags);
  audit(c, id, "update", true);
  const row = await c.env.DB.prepare("SELECT * FROM entries WHERE id = ?")
    .bind(id)
    .first<EntryRow>();
  return c.json({ ok: true, data: rowToEntry(row!, await getTags(c.env.DB, id)) });
});

// --- 收藏切换 ----------------------------------------------------------------
entries.patch("/:id/favorite", async (c) => {
  const id = c.req.param("id");
  const { favorite } = await c.req.json<{ favorite: boolean }>();
  await c.env.DB.prepare(
    "UPDATE entries SET favorite=?, updated_at=datetime('now') WHERE id=?",
  )
    .bind(favorite ? 1 : 0, id)
    .run();
  audit(c, id, "favorite", true);
  return c.json({ ok: true });
});

// --- 软删除（进回收站，第十三章保留 30 天）---------------------------------
entries.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE entries SET deleted_at=datetime('now') WHERE id=?",
  )
    .bind(id)
    .run();
  audit(c, id, "delete", true);
  return c.json({ ok: true });
});

// --- 恢复 -------------------------------------------------------------------
entries.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE entries SET deleted_at=NULL WHERE id=?")
    .bind(id)
    .run();
  audit(c, id, "restore", true);
  return c.json({ ok: true });
});

// --- 彻底删除 ---------------------------------------------------------------
entries.delete("/:id/purge", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  audit(c, id, "purge", true);
  return c.json({ ok: true });
});

// --- 历史版本列表 -----------------------------------------------------------
entries.get("/:id/versions", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    "SELECT id, entry_id, encrypted_content, iv, created_at FROM versions WHERE entry_id=? ORDER BY created_at DESC",
  )
    .bind(id)
    .all();
  return c.json({ ok: true, data: res.results });
});

// --- 恢复到某历史版本 -------------------------------------------------------
entries.post("/:id/versions/:vid/restore", async (c) => {
  const id = c.req.param("id");
  const vid = c.req.param("vid");
  const v = await c.env.DB.prepare(
    "SELECT encrypted_content, iv FROM versions WHERE id=? AND entry_id=?",
  )
    .bind(vid, id)
    .first<{ encrypted_content: string; iv: string }>();
  if (!v) return c.json({ ok: false, error: "版本未找到" }, 404);
  // 先把当前存为新版本
  const cur = await c.env.DB.prepare("SELECT * FROM entries WHERE id=?")
    .bind(id)
    .first<EntryRow>();
  if (cur) {
    await c.env.DB.prepare(
      "INSERT INTO versions (id, entry_id, encrypted_content, iv) VALUES (?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), id, cur.encrypted_content, cur.iv)
      .run();
  }
  await c.env.DB.prepare(
    "UPDATE entries SET encrypted_content=?, iv=?, updated_at=datetime('now') WHERE id=?",
  )
    .bind(v.encrypted_content, v.iv, id)
    .run();
  audit(c, id, "restore-version", true);
  return c.json({ ok: true });
});
