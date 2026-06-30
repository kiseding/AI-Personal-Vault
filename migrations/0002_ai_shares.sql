-- ============================================================================
-- 0002_ai_shares: AI 分享链接（百度网盘模式）
-- ============================================================================
-- 用户在浏览器中用主密钥解密 entry 明文，再用提取码（4 位数字）
-- AES-GCM 加密后上传到这里。AI 用提取码本地解密，服务器始终零知识。
--
-- 关键安全属性：
--   - code 字段不存明文提取码，只存 SHA-256 哈希（防止数据库泄露泄露提取码）
--   - max_uses 限制最大使用次数（默认 5）
--   - expires_at 限制有效期（默认 5 分钟）
--   - entry_id 仅用于审计追踪，不用于解密
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_shares (
  id          TEXT PRIMARY KEY,            -- share_id，公开
  entry_id    TEXT NOT NULL,               -- 关联 Entry（仅用于审计）
  entry_title TEXT,                        -- 关联 Entry 标题（仅用于审计）
  code_hash   TEXT NOT NULL,               -- 提取码 SHA-256 哈希
  ciphertext  TEXT NOT NULL,               -- 用提取码加密的明文内容（base64）
  iv          TEXT NOT NULL,               -- AES-GCM IV（base64）
  salt        TEXT NOT NULL,               -- PBKDF2 salt（base64，服务器原样返回给 AI）
  expires_at  TEXT NOT NULL,               -- ISO 时间，过期后失效
  max_uses    INTEGER NOT NULL DEFAULT 5,  -- 最大使用次数
  used_count  INTEGER NOT NULL DEFAULT 0,  -- 已使用次数
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_shares_exp ON ai_shares(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_shares_entry ON ai_shares(entry_id);