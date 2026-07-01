-- ============================================================================
-- 0003_batch_share: AI 批量分享 + 多文件打包
-- ============================================================================
-- 把现有 ai_shares 扩展为支持「多个 entry + 可选附件」一次性分享：
--   - kind:              'single'（向后兼容，默认）或 'batch'
--   - item_count:        批量包含的 entry 数量（默认 1）
--   - entry_ids_json:    批量包含的 entry_id 列表（JSON 数组）
--   - entry_titles_json: 批量包含的 entry 标题列表（用于列表展示 / 审计）
--   - files_json:        附件元数据（name/mime/size；密文内嵌于 bundle JSON）
--
-- bundle 加密方案：
--   浏览器用主密钥解密 N 个 entry 明文 → bundle JSON
--   → 附件先用主密钥解密，再用提取码派生密钥重新加密 → 嵌入 bundle JSON
--   → bundle 整体用提取码 AES-GCM 加密 → 上传密文到现有 ciphertext/iv/salt 字段
--   AI 收到后用提取码本地解密 bundle → 拿到所有 entry 明文 + 附件密文
--   → 附件再用同一 share key 解密（bundle 里包含各附件的 iv）
--
-- 零知识保持：服务器只看到密文 + entry_id 列表 + 文件名列表，从未接触明文。
-- ============================================================================

ALTER TABLE ai_shares ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';
ALTER TABLE ai_shares ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_shares ADD COLUMN entry_ids_json TEXT;
ALTER TABLE ai_shares ADD COLUMN entry_titles_json TEXT;
ALTER TABLE ai_shares ADD COLUMN files_json TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_shares_kind ON ai_shares(kind);
