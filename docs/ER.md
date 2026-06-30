# 数据库 ER 图

对应 `migrations/0001_init.sql`。

```mermaid
erDiagram
    entries ||--o{ entry_tags : "标记"
    tags ||--o{ entry_tags : "被引用"
    entries ||--o{ attachments : "拥有附件"
    entries ||--o{ versions : "历史版本"
    entries ||--o{ ai_grants : "AI 授权"
    entries ||--o{ ai_tokens : "临时令牌"
    audit_logs }o--o| entries : "引用"

    entries {
        TEXT id PK
        TEXT title
        TEXT type
        INTEGER favorite
        TEXT icon
        TEXT encrypted_content "AES-GCM 密文"
        TEXT iv "base64 IV"
        TEXT created_at
        TEXT updated_at
        TEXT deleted_at "软删除标记"
    }
    tags {
        TEXT id PK
        TEXT name UK
    }
    entry_tags {
        TEXT entry_id PK,FK
        TEXT tag_id PK,FK
    }
    attachments {
        TEXT id PK
        TEXT entry_id FK
        TEXT name
        TEXT mime
        INTEGER size
        TEXT r2_key "R2 对象键"
        TEXT iv
        TEXT created_at
    }
    versions {
        TEXT id PK
        TEXT entry_id FK
        TEXT encrypted_content
        TEXT iv
        TEXT created_at
    }
    audit_logs {
        TEXT id PK
        TEXT actor
        TEXT ip
        TEXT entry_id FK
        TEXT action
        INTEGER success
        TEXT created_at
    }
    ai_grants {
        TEXT id PK
        TEXT entry_id FK
        TEXT agent
        TEXT permission "never/ask/always"
        TEXT created_at
        TEXT expires_at
    }
    ai_tokens {
        TEXT token_hash PK "SHA-256 哈希"
        TEXT entry_id FK
        TEXT agent
        TEXT expires_at
        INTEGER used "单次有效"
        TEXT created_at
    }
```

## 表说明

| 表 | 用途 | 敏感字段处理 |
| --- | --- | --- |
| `entries` | 核心条目，统一 Entry 模型 | `encrypted_content` 为密文，`iv` 随每次更新变化 |
| `tags` / `entry_tags` | 无限标签，多对多关联 | 标签名非敏感 |
| `attachments` | 附件元数据 | 内容密文存 R2，`iv` 存表 |
| `versions` | 历史版本，每次更新自动保存 | 同样只存密文 |
| `audit_logs` | 访问审计 | — |
| `ai_grants` | 每个 Entry × Agent 的权限 | — |
| `ai_tokens` | 临时访问 Token | 只存 SHA-256 哈希，单次有效 |

## 关键索引

- `idx_entries_type` / `idx_entries_favorite`：按类型/收藏筛选（仅未删除）
- `idx_entries_updated`：最近排序
- `idx_entries_deleted`：回收站
- `idx_versions_entry`：按 Entry 取历史
- `idx_audit_created` / `idx_audit_entry`：审计查询
- `idx_ai_tokens_exp`：过期清理
