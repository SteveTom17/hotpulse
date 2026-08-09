import { env as workerEnv } from "cloudflare:workers";

/** 服务端环境变量（与 worker/index.ts 的 Env 保持一致并放宽类型）。 */
export interface AppEnv {
  DB?: D1Database;
  /** 置为 "true" 时强制校验 Cloudflare Access JWT；否则使用演示用户。 */
  CF_ACCESS_JWT_VERIFY?: string;
  /** Cloudflare Access 应用 Audience。 */
  CF_ACCESS_AUD?: string;
  /** Cloudflare Access 证书地址，如 https://<team>.cloudflareaccess.com/cdn-cgi/access/certs */
  CF_ACCESS_CERTS_URL?: string;
  /** 演示用户，格式：userId|email|name */
  AUTH_DEMO_USER?: string;
  /** 正式模型密钥（DeepSeek 或任意 OpenAI 兼容服务）。 */
  DEEPSEEK_API_KEY?: string;
  /** 默认 https://api.deepseek.com */
  DEEPSEEK_BASE_URL?: string;
  /** 默认 deepseek-chat */
  DEEPSEEK_MODEL?: string;
  /** "model" 使用正式模型；"demo" 使用内置演示引擎（必须显著标注）。 */
  GENERATION_ENGINE?: string;
  /** 连接器凭据加密密钥（32 字节，hex）。生产环境必填。 */
  CONNECTOR_SECRET_KEY?: string;
  /** 人工开通/管理端点密钥。 */
  ADMIN_API_KEY?: string;
  /** 全局管理员用户 ID（逗号分隔）。 */
  ADMIN_USER_IDS?: string;
  /** 申诉与投诉联系邮箱，展示在帮助与工单页。 */
  SUPPORT_EMAIL?: string;
  /** 协议版本号，如 2026-08-09-v1 */
  LEGAL_VERSION?: string;
}

/** 当前 Worker 环境。 */
export function getEnv(): AppEnv {
  return workerEnv as unknown as AppEnv;
}
