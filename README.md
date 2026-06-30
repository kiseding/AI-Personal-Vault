# 🔐 AI Personal Vault

> AI 时代的个人保险库 · 基于 Cloudflare 全栈架构 · 零知识加密 · AI Agent 安全访问

## 这是什么

不是传统密码管理器，也不是笔记软件。统一管理你所有的重要信息 —— 密码、API Key、SSH Key、Token、银行卡、身份信息、项目资料、笔记、Prompt —— 并通过细粒度临时授权让 AI Agent 按需读取。

**核心场景**：一个项目（如 NodeHub）包含 GitHub Token、Cloudflare API Token、SSH 信息、Docker Compose、域名、部署文档。你授权一个临时 Token 给 AI Agent，它一次性读取所有关联信息完成部署，无需你反复复制粘贴。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| Zero Knowledge | 主密码永不上传，浏览器端 AES-GCM 256 加密，Worker 只存密文 |
| 统一 Entry 模型 | 14 种类型模板：password / api / ssh / server / docker / database / wifi / identity / bank / license / prompt / note / document / custom |
| AI Agent 安全访问 | 每个 Entry × 每个 Agent 独立设权（never / ask / always），临时 Token 单次有效 + TTL |
| 完整数据管理 | 标签 · 收藏 · 回收站（软删除/恢复/彻底删除） · 历史版本 · 加密附件（R2） |
| 审计日志 | 所有访问记录时间 / Agent / IP / Entry / 成功失败 |
| PWA | 可安装到手机/桌面 · Dark Mode |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 · TypeScript · TailwindCSS · Web Crypto API |
| 后端 | Cloudflare Workers · Hono |
| 存储 | D1（密文/元数据） · R2（加密附件） · KV（配置/Token） |
| 加密 | PBKDF2-SHA256 派生（600,000 迭代） · AES-GCM 256 · 随机 12B IV |
| 构建 | Vite 6 · @cloudflare/vite-plugin |
| CI/CD | GitHub Actions |

## 快速开始（本地开发）

```bash
git clone https://github.com/kiseding/AI-Personal-Vault.git
cd AI-Personal-Vault
npm install
npx wrangler d1 migrations apply ai-personal-vault --local
echo "APP_TOKEN=你的随机长字符串" > .dev.vars
npm run dev
```

打开 http://localhost:8788 → 输入应用令牌 → 创建主密码 → 进入保险库。

## 部署（GitHub Actions 自动部署）

### 第 1 步：创建 Cloudflare 资源

```bash
npx wrangler login
npx wrangler d1 create ai-personal-vault
npx wrangler r2 bucket create ai-personal-vault-attachments
npx wrangler kv namespace create KV
```

记下返回的 `database_id` 和 KV `id`。

### 第 2 步：配置 GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Workers / D1 / R2 / KV 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID（Dashboard 右侧栏） |
| `D1_DATABASE_ID` | 上一步获取的 D1 database_id |
| `KV_NAMESPACE_ID` | 上一步获取的 KV namespace id |
| `APP_TOKEN` | 应用访问令牌（自定义随机长字符串） |

### 第 3 步：推送即部署

```bash
git push origin main
```

GitHub Actions 自动执行：`npm ci` → `npm run build` → D1 迁移 → 部署 Worker → 设置 APP_TOKEN Secret。

> 生产环境建议在 Worker 前叠加 **Cloudflare Access** 做身份层防护。

## 项目结构

```
├── .github/workflows/
│   └── deploy.yml               # CI/CD：push 到 main 自动部署
├── src/
│   ├── shared/types.ts          # 共享类型：Entry 模型 · 14 种模板 · AI 权限枚举
│   ├── web/crypto.ts            # 零知识加密层（PBKDF2 + AES-GCM + verify）
│   ├── lib/
│   │   ├── api.ts               # API 客户端
│   │   └── session.ts           # 内存会话（主密钥，刷新即失）
│   ├── components/
│   │   ├── Auth.tsx             # 解锁 / 首次设置
│   │   ├── Vault.tsx            # 主界面（侧栏 + 列表 + 详情）
│   │   └── EntryEditor.tsx      # 编辑器 + AI 授权面板
│   ├── App.tsx
│   └── main.tsx
├── worker/
│   ├── index.ts                 # Hono 入口（IP + 鉴权中间件）
│   ├── env.ts                   # 环境绑定类型
│   ├── middleware.ts            # Bearer Token 鉴权 + 审计日志
│   └── routes/
│       ├── entries.ts           # Entry CRUD · 标签 · 收藏 · 回收站 · 版本
│       ├── vault.ts             # 配置 · 标签 · 统计 · 审计
│       ├── attachments.ts       # R2 加密附件
│       └── ai.ts                # AI 授权 · 临时 Token · 读取
├── migrations/0001_init.sql     # D1 初始结构（8 张表 + 索引）
├── public/                      # PWA manifest + 图标
├── docs/                        # 架构图 · ER 图 · 安全设计
├── wrangler.jsonc               # Worker 配置（绑定 ID 通过环境变量注入）
└── vite.config.ts
```

## 安全模型

| 层 | 机制 |
| --- | --- |
| Zero Knowledge | 主密码仅在浏览器派生密钥，永不上传；Worker 只存 AES-GCM 密文 |
| 密钥派生 | PBKDF2-SHA256，600,000 次迭代（Argon2id 可后续接入 WASM 库） |
| 正文加密 | AES-GCM 256，每次随机 12B IV，提供机密性 + 完整性认证 |
| 主密钥 | 仅存内存，`extractable=false`，刷新页面即消失 |
| 主密码校验 | 浏览器本地解密 verifier 自检，服务器不参与验证 |
| AI 访问 | 临时 Token 单次有效 + TTL，服务器仅存 SHA-256 哈希 |
| 审计 | 所有访问异步记录到 D1，不阻塞响应 |

详见 [docs/SECURITY.md](docs/SECURITY.md)。

## AI Access 工作流

```
用户设置 grant: entry × agent = always
     ↓
用户生成临时 Token (TTL: 30s / 60s / 5min)
     ↓
用户将 Token 交付给 AI Agent（如环境变量）
     ↓
AI Agent → GET /api/ai/fetch/:id  (X-AI-Token)
     ↓
Worker 校验 Token 哈希 + grant + 过期 → 标记已用 → 写审计 → 返回密文
```

支持的 Agent：Claude Code · Codex CLI · Gemini CLI · Cursor · OpenCode · GitHub Copilot

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/vault/config` | 保险库初始化状态 |
| POST | `/api/vault/setup` | 设置主密码（salt + verifier 存 KV） |
| GET | `/api/vault/tags` · `/stats` · `/audit` | 标签 / 统计 / 审计 |
| GET/POST/PUT/DELETE | `/api/entries` | Entry CRUD |
| PATCH | `/api/entries/:id/favorite` | 收藏 |
| DELETE/POST | `/api/entries/:id` · `.../restore` · `.../purge` | 回收站 |
| GET/POST | `/api/entries/:id/versions` · `.../restore` | 历史版本 |
| GET/POST/DELETE | `/api/entries/:id/attachments` · `/api/attachments/:aid` | 加密附件 |
| GET/PUT/DELETE | `/api/ai/grants/:entryId` | AI 授权管理 |
| POST | `/api/ai/token` | 生成临时 Token |
| GET | `/api/ai/fetch/:entryId` | AI 读取（X-AI-Token 鉴权） |

## 功能完成度

**已实现（MVP）：** 零知识加密 · Entry CRUD（14 种模板） · 标签 · 收藏 · 回收站 · 历史版本 · 加密附件（R2） · AI 授权 + 临时 Token + 审计日志 · PWA · Dark Mode

**后续迭代：** Argon2id 派生 · 离线缓存（SW + IndexedDB） · 导入导出（Bitwarden/KeePass/CSV） · 历史版本 Diff · Passkey/WebAuthn · 团队协作 · 浏览器插件 · MCP Server

## 文档

- [架构设计](docs/ARCHITECTURE.md) — 总体架构 · 数据流 · AI 访问流 · 分层职责
- [数据库 ER 图](docs/ER.md) — 8 张表 · 关系 · 索引
- [安全设计](docs/SECURITY.md) — 10 节安全规范 · 部署检查清单

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（前端 HMR + Worker 边端运行时） |
| `npm run build` | 构建生产产物 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run db:migrate:local` | 应用本地 D1 迁移 |
| `npm run db:migrate:remote` | 应用远端 D1 迁移 |

## License

MIT
