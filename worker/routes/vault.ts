/**
 * Vault 路由：保险库初始化、标签列表、统计、审计日志
 */
import { Hono } from "hono";
import type { AppContext } from "../env";
import type { AuditLog } from "../../src/shared/types";

export const vault = new Hono<AppContext>();

const SETUP_KEY = "vault:setup";

interface VaultSetup {
  salt: string;
  verifier: { ciphertext: string; iv: string };
  created_at: string;
}

/** 读取保险库初始化信息（salt + verifier，均非秘密） */
vault.get("/config", async (c) => {
  const setup = await c.env.KV.get<VaultSetup>(SETUP_KEY, "json");
  return c.json({
    ok: true,
    data: setup ? { setup: true, ...setup } : { setup: false },
  });
});

/** 首次创建保险库：写入 salt + verifier */
vault.post("/setup", async (c) => {
  const existing = await c.env.KV.get(SETUP_KEY);
  if (existing) {
    return c.json({ ok: false, error: "保险库已初始化，无法重复创建" }, 409);
  }
  const body = await c.req.json<VaultSetup>();
  const data: VaultSetup = {
    salt: body.salt,
    verifier: body.verifier,
    created_at: new Date().toISOString(),
  };
  await c.env.KV.put(SETUP_KEY, JSON.stringify(data));
  return c.json({ ok: true, data });
});

/** 全部标签列表 */
vault.get("/tags", async (c) => {
  const res = await c.env.DB.prepare("SELECT name FROM tags ORDER BY name").all<{
    name: string;
  }>();
  return c.json({ ok: true, data: res.results.map((r) => r.name) });
});

/** 统计：总数 / 回收站 / 收藏 */
vault.get("/stats", async (c) => {
  const [total, trashed, favorite] = await Promise.all([
    c.env.DB
      .prepare("SELECT COUNT(*) as c FROM entries WHERE deleted_at IS NULL")
      .first<{ c: number }>(),
    c.env.DB
      .prepare("SELECT COUNT(*) as c FROM entries WHERE deleted_at IS NOT NULL")
      .first<{ c: number }>(),
    c.env.DB
      .prepare(
        "SELECT COUNT(*) as c FROM entries WHERE favorite=1 AND deleted_at IS NULL",
      )
      .first<{ c: number }>(),
  ]);
  return c.json({
    ok: true,
    data: {
      total: total?.c ?? 0,
      trashed: trashed?.c ?? 0,
      favorite: favorite?.c ?? 0,
    },
  });
});

/** 审计日志（最近 200 条） */
vault.get("/audit", async (c) => {
  const res = await c.env.DB
    .prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200")
    .all<AuditLog>();
  return c.json({ ok: true, data: res.results });
});
