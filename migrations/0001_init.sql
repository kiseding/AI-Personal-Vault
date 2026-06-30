-- ============================================================================
-- AI Personal Vault - 初始数据库结构
-- ============================================================================
-- 设计原则：服务器只存储 AES-GCM 密文，永远不接触明文（Zero Knowledge）。
-- 所有正文写入 entries.encrypted_content，附件写入 R2（加密）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- entries：核心条目表（第五章数据结构）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entries (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,
  favorite          INTEGER NOT NULL DEFAULT 0,
  icon              TEXT,
  encrypted_content TEXT NOT NULL,
  iv                TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_type
  ON entries(type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_favorite
  ON entries(favorite) WHERE deleted_at IS NULL AND favorite = 1;
CREATE INDEX IF NOT EXISTS idx_entries_updated
  ON entries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_deleted
  ON entries(deleted_at) WHERE deleted_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- tags / entry_tags：无限标签（第十章）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

-- ----------------------------------------------------------------------------
-- attachments：附件元数据（密文存 R2，第八章）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,
  iv         TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);

-- ----------------------------------------------------------------------------
-- versions：历史版本（第十四章，每次修改自动保存）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS versions (
  id                TEXT PRIMARY KEY,
  entry_id          TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  encrypted_content TEXT NOT NULL,
  iv                TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_versions_entry ON versions(entry_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- audit_logs：访问审计日志（第十五章，所有访问必须记录）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  ip         TEXT,
  entry_id   TEXT,
  action     TEXT NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entry   ON audit_logs(entry_id);

-- ----------------------------------------------------------------------------
-- ai_grants：AI Agent 授权（第十五章，每个 Entry 可设置权限）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_grants (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,
  permission  TEXT NOT NULL DEFAULT 'never',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_grants_entry ON ai_grants(entry_id);

-- ----------------------------------------------------------------------------
-- ai_tokens：临时访问 Token（第十五章，只存哈希）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_tokens (
  token_hash TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  agent      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_tokens_entry ON ai_tokens(entry_id);
CREATE INDEX IF NOT EXISTS idx_ai_tokens_exp   ON ai_tokens(expires_at);
