# HotPulse — 热点内容作战台

HotPulse 是面向本地生活品牌的热点内容作战台：把「发现热点 → 判断是否值得跟进 → 生成内容草案 → 人工审核 → 合规导出」串成一个工作流，并把来源、品牌事实、AI 标识和审批记录放在转化率之前。

它不是自动灌水工具：**所有内容草案都由 AI 生成、显著标注、必须经过人工审批后才能对外发布**。行为边界见 [AGENTS.md](./AGENTS.md)，完整需求与验收标准见 [requirements.md](./requirements.md)。

当前为 `0.1.0` 可运行 MVP，服务端持久化与多租户授权已就绪。

## 功能一览

| 模块 | 能力 |
|---|---|
| 热点雷达 | 授权 HTTP API 连接器（凭据 AES-256-GCM 加密、失败指数退避、限流暂停）与客户 CSV 导入（标注“客户导入”），24 小时去重、跨源归并并保留全部原始链接 |
| 趋势研判 | 热度分、增速、跨源出现次数，排序维度透明可查，展示更新时间 |
| 品牌画像 | 品牌资料与已验证事实，生成时强制引用事实、不留占位符 |
| 内容工坊 | DeepSeek/OpenAI 兼容网关生成内容包（未配置密钥时降级为显著标注的演示引擎），可编辑、保留版本历史与恢复 |
| 风险分级 | 新闻/医疗/金融/法律/未成年人/灾害/政治等议题自动升级风险，高风险议题阻断营销生成 |
| 人工审批 | 三确认审批（来源/事实/AI 标识），审批后内容锁定，可导出合规交付包 |
| 审计留痕 | 生成/编辑/审批/导出/连接器失败均可追溯；账户数据删除时审计留痕依法保留 |
| 计费试点 | 免费试用 30 额度，管理员人工开通专业版（¥399/月/工作区、150 额度/月），用量与发票留痕 |
| 用户协议 | 协议/隐私同意留痕、申诉/数据请求工单、账户数据删除 |

> 界面中的热点、品牌和数据源均为模拟数据，仅用于演示产品流程，不得直接当作真实热点或商业事实发布。

## 项目地图（10 分钟看懂结构）

```
app/                    前端页面与 API 路由（Next.js 风格 app 目录）
├── HotPulseApp.tsx      单页应用主体（工作台 UI）
└── api/                 22 个服务端路由（/api/trends、/api/packages、/api/connectors ...）
lib/                    核心库：认证、风险分级、计费、审计、连接器同步、模型网关、加密
db/schema.ts            数据库 schema（15 张表，Drizzle ORM）
drizzle/                SQL 迁移文件（0000/0001/0002，勿手动修改）
worker/index.ts         Worker 入口 + Cron 定时同步（每 30 分钟）
tests/                  10 个集成测试（node --test，使用进程内 D1 模拟）
scripts/vinext.mjs      开发/构建脚本（Vinext 框架）
wrangler.jsonc          生产部署配置（Worker + D1 + Cron + vars）
vite.config.ts          本地开发配置（Vite 8 + Cloudflare 插件）
```

## 本地运行（5 分钟）

前置条件：Node.js `>=22.13.0`（Windows 使用 PowerShell，macOS/Linux 使用 bash）。

```bash
npm install
npm run dev
```

打开 http://localhost:3000 即可体验。默认使用演示用户 + 演示引擎，**无需任何密钥或账号**：

- 首次进入需同意用户协议与隐私政策（本地内置最小可用文本）
- 创建品牌工作区 → 连接器（HTTP API / CSV 导入）→ 生成内容草案 → 审批 → 导出
- 想要真实生成效果，复制 `.dev.vars.example` 为 `.dev.vars` 并填入 `DEEPSEEK_API_KEY`，重启 `npm run dev`

其他常用命令：

```bash
npm test              # 10 个集成测试（多租户隔离/加密/审计/计费/协议流程）
npm run build         # 生产构建（输出 dist/，供部署）
npm run lint          # ESLint 检查
npm run db:generate   # schema 变更后生成迁移
npm run db:migrate:local   # 本地 D1 应用迁移
```

## 自行部署到 Cloudflare（生产）

### 1. 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com)（Worker 免费额度即可起步）
- 已登录 wrangler：`npx wrangler login`
- Node.js `>=22.13.0`

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create hotpulse-d1
```

将输出中的 `database_id` 替换到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

### 3. 配置密钥（敏感变量，勿写入仓库）

```bash
npx wrangler secret put CONNECTOR_SECRET_KEY   # 连接器凭据加密密钥，32 字节 hex：openssl rand -hex 32
npx wrangler secret put DEEPSEEK_API_KEY       # 正式模型密钥（可选，不配则用演示引擎）
npx wrangler secret put ADMIN_API_KEY          # 人工开通/管理端点密钥（可选）
```

### 4. 修改 wrangler.jsonc 中的占位 vars

| 变量 | 说明 |
|---|---|
| `CF_ACCESS_JWT_VERIFY` | 置 `"true"` 启用 Cloudflare Access 认证（生产建议）；暂不启用可留 `"false"`（仅演示用，任何人可访问） |
| `CF_ACCESS_AUD` / `CF_ACCESS_CERTS_URL` | Access 应用的 Audience Tag 与证书地址 |
| `ADMIN_USER_IDS` | 可人工开通计费的全局管理员用户 ID |
| `SUPPORT_EMAIL` | 申诉/工单页展示的联系邮箱 |

### 5. 构建、迁移、部署

```bash
npm run build
npm run db:migrate:remote   # 在远程 D1 执行全部迁移（0000/0001/0002）
npx wrangler deploy
```

部署完成后：浏览器打开 Worker 域名 → 同意协议 → 创建工作区 → 使用。Cron（每 30 分钟同步连接器）随部署自动生效。

### 6. 生产环境 checklist（上线前必做）

- [ ] 完成 1 个授权数据源的接入（平台官方 API 或有书面授权，禁止爬虫绕过）
- [ ] `CONNECTOR_SECRET_KEY` 已设置且妥善保管（丢失后已存凭据无法解密）
- [ ] 若启用 Access 认证，验证非成员用户被拒绝（多租户隔离）
- [ ] 核对 `LEGAL_VERSION` 与协议/隐私文本一致
- [ ] 测试数据删除与申诉工单流程，确认审计留痕保留

## 配置参考

| 配置项 | 位置 | 说明 |
|---|---|---|
| `CF_ACCESS_JWT_VERIFY` | vars | 认证开关；本地 dev 默认 `false`（vite.config.ts 覆盖），生产默认 `true` |
| `AUTH_DEMO_USER` | `.dev.vars` | 本地演示用户 `userId\|email\|name`，不配则用内置默认 |
| `GENERATION_ENGINE` | vars | `model` 正式模型 / `demo` 演示引擎 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | secret/vars | 模型网关地址与模型名（OpenAI 兼容） |
| `LEGAL_VERSION` | vars | 用户协议版本号 |
| `ADMIN_API_KEY` | secret | 人工开通/管理端点密钥 |

## 技术栈

- TypeScript、React 19、Vinext（Vite 8，Next.js 风格 app 目录）、Tailwind CSS 4
- Cloudflare Workers（API 路由 + Cron 定时同步）+ D1 + Drizzle ORM（15 张表）
- DeepSeek/OpenAI 兼容模型网关，AES-256-GCM 凭据加密
- 10 个集成测试（node --test + 进程内 D1 模拟），构建/测试/lint 全绿

选择这套栈的目的：一份代码同时覆盖响应式 Web、服务端接口、数据库与托管，降低试点期的部署和维护成本。

## 商业化假设（写给创业者）

建议从单一行业试点开始，而不是出售泛化“AI 文案工具”。初始报价可测试 `¥399/月/工作区`，包含行业热点研判、固定内容额度与合规导出。这个价格只是待验证假设，不是收入保证；续费应由持续使用、审批导出量和实际节省时间共同证明。当前为人工开通计费（管理员在服务端确认后激活），真实支付网关不在首版范围。

## License

[MIT](./LICENSE)
