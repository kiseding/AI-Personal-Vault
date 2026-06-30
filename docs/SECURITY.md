# 安全设计

## 1. Zero Knowledge 原则（最高优先级）

- 主密码**永远不上传**服务器，仅在浏览器派生加密密钥
- Worker **永远不保存任何明文**，只存储 AES-GCM 密文
- Worker 永远不知道：密码、API Key、Token、SSH Key、笔记内容
- 主密钥仅存内存，**刷新页面后立即消失**
- 所有密码学操作使用 **Web Crypto API**，不自行实现算法

## 2. 密钥派生

```
主密码 + salt(16B) --PBKDF2-SHA256 / 600,000 次--> 主密钥 (AES-GCM CryptoKey, 不可导出)
```

- `salt` 随机生成，明文存服务器（非秘密，防彩虹表）
- 派生出的 `CryptoKey` 设 `extractable=false`，降低被导出泄露风险
- 迭代次数 600,000，符合 OWASP 2023 推荐下限
- **Argon2id** 为更优方案（抗 GPU 爆破），可后续接入 WASM 库；当前以 PBKDF2 为零依赖兼容实现

## 3. 正文加密

```
EntryContent(JSON) --AES-GCM-256 + 随机 IV(12B)--> {ciphertext, iv}
```

- 每次加密生成**新的随机 IV**，即使内容相同密文也不同
- AES-GCM 提供机密性 + 完整性认证（防篡改）
- IV 与密文一同存 D1

## 4. 主密码校验（解密自检）

- 首次设置时生成 `verifier = encrypt("vault-ok")`
- 解锁时派生密钥后尝试 `decrypt(verifier)`，成功则密码正确
- 校验**完全在浏览器本地**完成，服务器不参与验证主密码

## 5. 访问控制

| 层 | 机制 |
| --- | --- |
| MVP | `APP_TOKEN`（部署者设置的随机令牌），前端 `Authorization: Bearer` |
| 生产推荐 | 叠加 **Cloudflare Access** 做身份层，Worker 在 Access 之后 |

> `APP_TOKEN` 通过 `wrangler secret put` 设置，不进代码仓库。本地开发用 `.dev.vars`（已 gitignore）。

## 6. AI 访问安全（第十五章）

- 每个 Entry 对每个 Agent 可设 `never` / `ask` / `always`
- 临时 Token：**单次有效** + TTL（30s / 60s / 5min）
- 服务器**只存 Token 的 SHA-256 哈希**，不存明文
- AI 读取端点 `/api/ai/fetch/:id` 用 `X-AI-Token` 鉴权，不走 APP_TOKEN
- 返回的仍是密文 —— AI 用用户预先派生的共享密钥本地解密（服务器零知识不破）

## 7. 审计日志

所有访问记录到 `audit_logs`：

- 时间、Actor（web / AI Agent 名）、IP、Entry、动作、成功/失败
- 用 `executionCtx.waitUntil` 异步写入，不阻塞响应

## 8. 附件安全

- 附件在浏览器用同一主密钥加密后上传
- 密文存 R2，IV 存 D1
- 下载返回密文，客户端解密

## 9. 已知限制（MVP）

| 项 | 现状 | 后续 |
| --- | --- | --- |
| KDF | PBKDF2 | 接入 Argon2id WASM |
| 离线 | 暂无 Service Worker 缓存 | SW + IndexedDB 缓存最近数据 |
| 回收站清理 | 软删除，无自动 30 天清理 | Cron Trigger 定时清理 |
| Token 清理 | 手动/查询时过滤 | Cron 清理过期 Token |
| 身份 | APP_TOKEN | Cloudflare Access / Passkey |

## 10. 部署检查清单

- [ ] `APP_TOKEN` 已通过 `wrangler secret put` 设置（非默认值）
- [ ] `wrangler.jsonc` 中 D1 `database_id` / KV `id` 已替换为真实值
- [ ] `.dev.vars` 不被提交（已 gitignore）
- [ ] 已配置 Cloudflare Access（生产）
- [ ] D1 迁移已在远端应用
