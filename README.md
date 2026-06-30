# AI Personal Vault（Cloudflare Workers）

## 一、项目定位

AI Personal Vault 是一个完全基于 Cloudflare 平台部署的个人保险库（Personal Vault）。

它不是传统密码管理器，也不是传统笔记软件，而是统一管理所有重要信息，并支持 AI Agent 安全访问。

目标：

- 完全部署在 Cloudflare（Workers + D1 + R2 + KV）
- 无需 VPS
- 免费额度即可长期使用
- Zero Knowledge（零知识加密）
- 支持 PWA
- 支持 AI Agent 安全调用
- 兼顾密码管理、笔记管理、项目资料管理

---

# 二、核心功能

统一管理：

- 密码
- API Key
- SSH Key
- Token
- 身份证件
- 银行卡
- 软件许可证
- WiFi 信息
- Docker Compose
- Markdown 笔记
- Prompt
- 项目资料
- 文档
- 附件

不要区分密码和笔记。

统一叫 Entry。

---

# 三、技术栈

前端：

- React（推荐）
- TypeScript
- TailwindCSS
- PWA
- Web Crypto API

后端：

- Cloudflare Workers
- Hono
- D1
- R2
- KV

认证：

- Cloudflare Access
- GitHub OAuth（可选）
- 后续支持 Passkey

---

# 四、安全要求（最高优先级）

## Zero Knowledge

所有正文必须在浏览器加密。

Worker 永远不能保存任何明文。

Worker 永远不知道：

- 密码
- API Key
- Token
- SSH Key
- 笔记内容

Worker 只能保存 AES-GCM 加密后的密文。

主密码永远不能上传服务器。

刷新页面后立即从内存消失。

密钥派生使用：

- Argon2id（优先）
- PBKDF2（兼容）

禁止自行实现任何密码学算法。

全部使用 Web Crypto API。

---

# 五、数据结构

统一模型：

Entry

字段：

- id
- title
- type
- tags
- favorite
- icon
- encrypted_content
- created_at
- updated_at
- deleted_at

正文全部存 encrypted_content。

服务器永远不知道正文。

---

# 六、支持类型

- password
- note
- api
- ssh
- server
- docker
- database
- wifi
- identity
- bank
- license
- prompt
- document
- other

以后允许继续扩展。

---

# 七、正文模板

## Password

- 用户名
- 密码
- OTP
- 邮箱
- 网站
- 备注

---

## API

- Provider
- API Key
- Secret
- Endpoint
- 备注

---

## Server

- IP
- SSH
- Docker Compose
- 域名
- 用户名
- 密码
- 备注

---

## SSH

- Host
- User
- Port
- Private Key
- Public Key

---

## Note

Markdown。

支持：

- 标题
- 正文
- 代码块
- 图片
- 表格
- 附件

---

## Identity

- 身份证
- 护照
- 驾照
- 手机号
- 地址

---

## Bank

- 银行卡
- CVV
- 有效期
- 开户行

---

# 八、附件

支持：

- 图片
- PDF
- ZIP
- TXT
- Markdown
- DOCX

附件全部 AES 加密。

存储到 R2。

---

# 九、首页

左侧导航：

- 收藏
- 最近
- 密码
- API
- 服务器
- SSH
- 文档
- Prompt
- 身份
- 银行卡
- 附件
- 全部

这些只是筛选器，不是文件夹。

---

# 十、标签

支持无限标签。

例如：

- 工作
- 家庭
- Cloudflare
- GitHub
- Claude
- OpenAI
- 数据库
- Docker

一个 Entry 可以拥有多个标签。

---

# 十一、搜索

支持：

- 标题
- 标签
- 类型
- 正文
- 备注

正文搜索必须在浏览器完成。

服务器不能搜索正文。

---

# 十二、收藏

支持 Favorite。

首页置顶。

---

# 十三、回收站

删除后：

保留 30 天。

支持恢复。

支持彻底删除。

---

# 十四、历史版本

每次修改：

自动保存版本。

支持：

- 查看历史
- Diff
- 恢复

---

# 十五、AI Access（本项目最大特色）

每个 Entry 都可以设置 AI 权限。

例如：

Never

Ask Every Time

Always Allow

支持针对不同 Agent 单独授权：

- Claude Code
- Codex CLI
- Gemini CLI
- Cursor
- OpenCode
- GitHub Copilot

AI 调用：

GET /api/vault/{entry}

流程：

1. 验证身份
2. 检查权限
3. 返回数据

支持：

- 临时 Token
- TTL（30 秒、60 秒、5 分钟）
- 单次授权

所有访问必须记录：

- 时间
- Agent
- IP
- Entry
- 成功/失败

---

# 十六、PWA

支持：

- 安装
- 手机
- 桌面
- Dark Mode
- Light Mode

支持最近数据离线查看。

---

# 十七、导入导出

导入：

- Bitwarden
- KeePass
- CSV
- JSON

导出：

- JSON
- Markdown
- ZIP

---

# 十八、UI

要求：

- Apple 风格
- 简洁
- 响应式
- 大量留白
- 动画流畅
- 移动端优先

---

# 十九、性能

支持：

10000+ Entry。

首页：

2 秒内完成。

搜索：

100ms 内完成。

---

# 二十、未来规划

支持：

- Passkey
- TOTP
- WebAuthn
- 分享
- 团队协作
- 浏览器插件
- MCP Server
- AI SDK

---

# 二十一、开发要求

- 全程 TypeScript
- 禁止 any
- RESTful API
- 模块化设计
- 完整类型定义
- 单元测试
- E2E 测试
- Cloudflare 一键部署
- Docker 本地开发
- 完整 README
- 数据库 ER 图
- 架构图
- 安全设计文档

---

# 二十二、项目设计理念（最重要）

这个项目不是传统密码管理器。

定位是：

> AI Personal Vault（AI 时代个人保险库）

不仅保存密码，更保存所有重要资料。

未来 AI Agent 可以按权限读取指定内容，而不是让用户不断复制粘贴。

例如一个项目（NodeHub）可以包含：

- GitHub Token
- Cloudflare API Token
- Worker 名称
- Docker Compose
- SSH 信息
- 域名
- 部署文档
- 常用 Prompt
- 项目笔记

AI 只需获取该项目授权，即可完成整个开发或部署流程，而无需访问其它无关数据。

项目目标不是替代 Bitwarden，而是成为 AI 时代的个人知识与密钥中心（Personal Vault）。
