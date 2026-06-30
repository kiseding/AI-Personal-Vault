# AI Personal Vault

> AI 时代的个人保险库 —— 完全基于 Cloudflare 平台，零知识加密，支持 AI Agent 安全访问。

本仓库按 `README` 中的 22 章设计规范实现。服务器只存储 AES-GCM 密文，主密码永不上传，所有加解密在浏览器完成。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 · TypeScript · TailwindCSS · PWA · Web Crypto API |
| 后端 | Cloudflare Workers · Hono |
| 存储 | D1（元数据/密文）· R2（加密附件）· KV（配置/Token） |
| 加密 | PBKDF2-SHA256 派生 · AES-GCM 256 加密 · 随机 IV |
| 构建 | Vite 6 · @cloudflare/vite-plugin |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 初始化本地数据库（miniflare 自动创建 D1/R2/KV 本地实例）
npx wrangler d1 migrations apply ai-personal-vault --local

# 3. 设置应用访问令牌（本地开发用 .dev.vars）
echo "APP_TOKEN=换成你自己的随机长字符串" > .dev.vars

# 4. 启动开发服务器（前端 HMR + Worker 边端运行时）
npm run dev
```

打开浏览器后：首次输入「应用令牌」→ 创建主密码 → 进入保险库。

## 部署到 Cloudflare

```bash
# 1. 创建云端资源（D1 / R2 / KV）
npx wrangler d1 create ai-personal-vault        # 将返回的 database_id 填入 wrangler.jsonc
npx wrangler r2 bucket create ai-personal-vault-attachments
npx wrangler kv namespace create KV

# 2. 应用远端迁移
npx wrangler d1 migrations apply ai-personal-vault --remote

# 3. 设置应用访问令牌（Secret）
npx wrangler secret put APP_TOKEN

# 4. 构建并部署
npm run deploy
```

> 生产环境强烈建议在 Worker 前叠加 **Cloudflare Access** 做身份层防护。

## 项目结构

```
├── src/
│   ├── shared/types.ts        # 共享类型：Entry 模型、枚举、模板
│   ├── web/
│   │   └── crypto.ts          # 零知识加密层（PBKDF2 + AES-GCM）
│   ├── lib/
│   │   ├── api.ts             # API 客户端
│   │   └── session.ts         # 内存会话（主密钥，刷新即失）
│   ├── components/
│   │   ├── Auth.tsx           # 解锁 / 首次设置
│   │   ├── Vault.tsx          # 主界面（侧栏 + 列表 + 详情）
│   │   └── EntryEditor.tsx    # 编辑器 + AI 授权面板
│   ├── App.tsx
│   └── main.tsx
├── worker/
│   ├── index.ts               # Hono 入口
│   ├── env.ts                # 环境绑定类型
│   ├── middleware.ts          # 鉴权 + 审计日志
│   └── routes/
│       ├── entries.ts        # Entry CRUD + 版本 + 回收站
│       ├── vault.ts           # 配置 / 标签 / 统计 / 审计
│       ├── attachments.ts     # R2 加密附件
│       └── ai.ts              # AI Access（授权 / Token / 读取）
├── migrations/0001_init.sql   # D1 初始结构
├── public/                    # PWA manifest + 图标
├── docs/                      # 架构图 / ER 图 / 安全设计
├── wrangler.jsonc
└── vite.config.ts
```

## 安全模型

- **Zero Knowledge**：主密码仅在浏览器派生加密密钥，永不上传；Worker 只存 AES-GCM 密文
- **密钥派生**：PBKDF2-SHA256，60 万次迭代（Argon2id 可后续接入 WASM 库）
- **正文加密**：AES-GCM 256，每次随机 12 字节 IV
- **主密钥内存态**：仅存内存，刷新页面即消失
- **AI 访问**：每个 Entry 可对每个 Agent 设置 never/ask/always，临时 Token 单次有效 + TTL
- **审计**：所有访问记录时间 / Agent / IP / Entry / 成功失败

详见 [docs/SECURITY.md](docs/SECURITY.md)。

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/vault/config` · `/api/vault/setup` | 保险库初始化信息 |
| GET | `/api/vault/tags` · `/stats` · `/audit` | 标签 / 统计 / 审计 |
| GET/POST/PUT/DELETE | `/api/entries` | Entry CRUD |
| PATCH | `/api/entries/:id/favorite` | 收藏 |
| DELETE/POST | `/api/entries/:id` · `.../restore` · `.../purge` | 回收站 |
| GET/POST | `/api/entries/:id/versions` · `.../restore` | 历史版本 |
| GET/POST/DELETE | `/api/entries/:id/attachments` · `/api/attachments/:aid` | 加密附件 |
| GET/PUT/DELETE | `/api/ai/grants/:entryId` | AI 授权 |
| POST | `/api/ai/token` | 生成临时 Token |
| GET | `/api/ai/fetch/:entryId` | AI 读取（临时 Token 鉴权） |

## 功能完成度

**已实现（MVP）：** 零知识加密 · Entry CRUD（14 种类型模板）· 标签 · 收藏 · 回收站 · 历史版本 · 加密附件（R2）· AI 授权 + 临时 Token + 审计日志 · PWA 可安装 · Apple 风格 UI · Dark Mode

**后续迭代：** Argon2id 派生 · 离线缓存（Service Worker + IndexedDB）· 导入导出（Bitwarden/KeePass/CSV）· 历史版本 Diff · Passkey/WebAuthn · 团队协作 · 浏览器插件 · MCP Server

> 设计规范参见仓库根 README 的 22 章描述。
